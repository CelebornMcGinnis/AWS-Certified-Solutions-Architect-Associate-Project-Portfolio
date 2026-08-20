"""Lambda handler for POST /summarize (public, no authentication).

Sends pasted text to Amazon Bedrock's Nova Lite model via the Converse
API and returns a short or detailed summary. Public and unauthenticated,
so two independent limits guard against running up a real Bedrock bill:
API Gateway's stage-level throttle (see nova-summarizer-stack.ts) caps
request rate before this Lambda ever runs, and the daily counter below
caps total requests per UTC day regardless of how slowly they arrive.
"""
import json
import os
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

LENGTH_INSTRUCTIONS = {
    "short": "Summarize the following text in 2-3 concise sentences.",
    "detailed": "Summarize the following text in a detailed paragraph of 5-8 sentences, covering the main points.",
}


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
            system=[{"text": "You are a precise, neutral summarizer. Respond with only the summary itself -- no preamble, no headings."}],
            messages=[{"role": "user", "content": [{"text": f"{LENGTH_INSTRUCTIONS[length]}\n\n{text}"}]}],
            inferenceConfig={"maxTokens": 600 if length == "detailed" else 200, "temperature": 0.3},
        )
        summary = response["output"]["message"]["content"][0]["text"].strip()
    except ClientError as e:
        print(f"Bedrock error: {e}")
        return _respond(502, {"error": "The summarizer is temporarily unavailable. Please try again shortly."})

    return _respond(200, {"summary": summary, "length": length, "inputCharacterCount": len(text)})
