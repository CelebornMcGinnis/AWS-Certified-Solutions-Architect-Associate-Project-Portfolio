"""Lambda handler for POST /chat (Cognito-authenticated).

Checks the message against a small deterministic FAQ first (see
faq.py); only questions that don't match go to Bedrock's Nova Lite
model, guarded by a Bedrock Guardrail. Every response says which path
answered -- "faq", "ai", or "guardrail" if the guardrail itself blocked
the request -- rather than presenting every answer as if it came from
the same place. Both the visitor's message and the assistant's reply
are written to ConversationsTable with a 24-hour TTL.
"""
import json
import os
import time
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from faq import match_faq

bedrock = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID")
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "DRAFT")

MAX_MESSAGE_CHARS = 1000
TTL_SECONDS = 60 * 60 * 24  # messages expire after 24 hours

SYSTEM_PROMPT = (
    "You are a friendly, concise assistant embedded on a personal AWS portfolio "
    "website. Answer in 1-3 short sentences. If you don't know something specific "
    "about this site, say so plainly instead of guessing."
)


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def _respond(status_code, body):
    return {"statusCode": status_code, "headers": _cors_headers(), "body": json.dumps(body)}


def _save_message(owner_sub, role, text, source):
    now = datetime.now(timezone.utc)
    dynamodb.Table(TABLE_NAME).put_item(
        Item={
            "ownerSub": owner_sub,
            # A uuid suffix guards against two same-turn writes (user
            # then assistant) ever landing on the same sort key, even
            # though ISO timestamps already include microseconds.
            "createdAt": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
            "role": role,
            "text": text,
            "source": source,
            "ttl": int(time.time()) + TTL_SECONDS,
        }
    )


def lambda_handler(event, context):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    owner_sub = claims.get("sub")
    if not owner_sub:
        return _respond(401, {"error": "Not authenticated."})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid request body."})

    message = str(body.get("message", "")).strip()
    if not message:
        return _respond(400, {"error": "Please enter a message."})
    if len(message) > MAX_MESSAGE_CHARS:
        return _respond(400, {"error": f"Please keep messages under {MAX_MESSAGE_CHARS} characters."})

    _save_message(owner_sub, "user", message, None)

    faq_answer = match_faq(message)
    if faq_answer:
        _save_message(owner_sub, "assistant", faq_answer, "faq")
        return _respond(200, {"reply": faq_answer, "source": "faq"})

    try:
        response = bedrock.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": message}]}],
            inferenceConfig={"maxTokens": 300, "temperature": 0.4},
            guardrailConfig={
                "guardrailIdentifier": GUARDRAIL_ID,
                "guardrailVersion": GUARDRAIL_VERSION,
                "trace": "enabled",
            },
        )
    except ClientError as e:
        print(f"Bedrock error: {e}")
        return _respond(502, {"error": "The assistant is temporarily unavailable. Please try again shortly."})

    reply = response["output"]["message"]["content"][0]["text"].strip()
    source = "guardrail" if response.get("stopReason") == "guardrail_intervened" else "ai"

    _save_message(owner_sub, "assistant", reply, source)
    return _respond(200, {"reply": reply, "source": source})
