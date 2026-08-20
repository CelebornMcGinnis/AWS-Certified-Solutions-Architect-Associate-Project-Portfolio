"""Lambda handler for POST /summarize (public, no authentication).

Sends pasted text to Amazon Bedrock's Nova Lite model via the Converse
API and returns a structured title/bullets/takeaways summary. Public
and unauthenticated, so two independent limits guard against running
up a real Bedrock bill: API Gateway's stage-level throttle (see
nova-summarizer-stack.ts) caps request rate before this Lambda ever
runs, and the daily counter below caps total requests per UTC day
regardless of how slowly they arrive.
"""
import json
import os
import re
from datetime import date

import boto3
from botocore.exceptions import ClientError

bedrock = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")

USAGE_TABLE = os.environ.get("USAGE_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID")
MAX_INPUT_CHARS = int(os.environ.get("MAX_INPUT_CHARS", "6000"))
DAILY_REQUEST_LIMIT = int(os.environ.get("DAILY_REQUEST_LIMIT", "50"))

SYSTEM_PROMPT = (
    "You are a precise, neutral summarizer. Respond with ONLY a single JSON object "
    'matching this exact schema, and nothing else -- no markdown, no code fences, no '
    'commentary: {"title": string, "bullets": array of strings, "takeaways": array of '
    'strings}. "title" is a short descriptive title for the text, under 10 words. '
    '"bullets" are the main points, one clause each. "takeaways" are practical '
    "implications or conclusions, not just a restatement of the bullets."
)

LENGTH_INSTRUCTIONS = {
    "short": "Summarize the following text as JSON with up to 3 bullets and exactly 1 takeaway.",
    "detailed": "Summarize the following text as JSON with up to 6 bullets and up to 3 takeaways, covering the main points in more depth.",
}


def _extract_json_object(raw_text):
    """Nova Lite reliably follows a JSON-only instruction, but strips a
    stray code fence defensively in case one slips through anyway."""
    text = raw_text.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    return json.loads(text)


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def _respond(status_code, body):
    return {"statusCode": status_code, "headers": _cors_headers(), "body": json.dumps(body)}


def _try_reserve_daily_request():
    """Atomically increments today's counter, but only if it's still
    under the limit -- the increment and the limit check happen as one
    conditional DynamoDB write, so concurrent requests can't both read
    an under-limit count and both proceed past it."""
    table = dynamodb.Table(USAGE_TABLE)
    today = date.today().isoformat()
    try:
        table.update_item(
            Key={"date": today},
            UpdateExpression="ADD #c :incr",
            ConditionExpression="attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames={"#c": "count"},
            ExpressionAttributeValues={":incr": 1, ":limit": DAILY_REQUEST_LIMIT},
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid request body."})

    text = str(body.get("text", "")).strip()
    length = body.get("length") if body.get("length") in LENGTH_INSTRUCTIONS else "short"

    if not text:
        return _respond(400, {"error": "Please paste some text to summarize."})
    if len(text) > MAX_INPUT_CHARS:
        return _respond(400, {"error": f"That text is too long -- please keep it under {MAX_INPUT_CHARS} characters."})

    if not _try_reserve_daily_request():
        return _respond(
            429,
            {"error": "This demo has reached its request limit for today. Please try again tomorrow."},
        )

    try:
        response = bedrock.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": f"{LENGTH_INSTRUCTIONS[length]}\n\n{text}"}]}],
            inferenceConfig={"maxTokens": 700 if length == "detailed" else 350, "temperature": 0.3},
        )
        raw_text = response["output"]["message"]["content"][0]["text"]
    except ClientError as e:
        print(f"Bedrock error: {e}")
        return _respond(502, {"error": "The summarizer is temporarily unavailable. Please try again shortly."})

    try:
        parsed = _extract_json_object(raw_text)
        title = str(parsed.get("title", "")).strip()
        bullets = [str(b).strip() for b in parsed.get("bullets", []) if str(b).strip()]
        takeaways = [str(t).strip() for t in parsed.get("takeaways", []) if str(t).strip()]
        if not title or not bullets:
            raise ValueError("Missing required fields")
    except (json.JSONDecodeError, ValueError, AttributeError) as e:
        # Nova Lite occasionally drifts from the requested JSON shape --
        # fall back to the raw text as a single bullet rather than
        # failing the whole request over a formatting slip.
        print(f"Could not parse structured summary, falling back to raw text: {e}")
        title = "Summary"
        bullets = [raw_text.strip()]
        takeaways = []

    return _respond(
        200,
        {"title": title, "bullets": bullets, "takeaways": takeaways, "length": length, "inputCharacterCount": len(text)},
    )
