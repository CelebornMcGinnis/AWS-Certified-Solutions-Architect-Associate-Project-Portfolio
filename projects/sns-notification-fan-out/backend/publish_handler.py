"""Lambda handler for triggering the SNS fan-out demo.

Triggered by API Gateway (HTTP API) on POST /notify. Publishes a single
message to the SNS topic and returns the message id right away — it
doesn't wait for either subscriber to finish, since the whole point of
the demo is watching them complete asynchronously via the live log
table on the page.

Collects no visitor data: the request body is ignored beyond an
optional short note, and nothing personal is ever read from it.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

sns = boto3.client("sns")

# Comma-separated list, e.g. "https://mcginnisarchitecture.com,https://betaweb.mcginnisarchitecture.com" --
# API Gateway's own CORS config (set on the API, not here) handles the
# OPTIONS preflight, but this Lambda's actual GET/POST response still has
# to set its own Access-Control-Allow-Origin header, and a browser rejects
# a wildcard *and* a mismatched single value alike. So reflect back
# whichever of the configured origins the request actually came from.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]
TOPIC_ARN = os.environ.get("TOPIC_ARN")

NOTE_MAX_LENGTH = 140


def _resolve_origin(event):
    if "*" in ALLOWED_ORIGINS:
        return "*"
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        return origin
    # Non-browser caller (curl, server-to-server) or an origin outside the
    # allowlist -- fall back to the first configured origin so the header
    # is always present and deterministic rather than "null".
    return ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "*"


def _cors_headers(event):
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": _resolve_origin(event),
        "Vary": "Origin",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(event, 400, {"error": "Invalid JSON body."})

    note = str(body.get("note", ""))[:NOTE_MAX_LENGTH] or "Test notification triggered from the website demo."

    message_id = uuid.uuid4().hex
    triggered_at = datetime.now(timezone.utc).isoformat()

    try:
        sns.publish(
            TopicArn=TOPIC_ARN,
            Message=note,
            MessageAttributes={
                "clientMessageId": {"DataType": "String", "StringValue": message_id},
                "triggeredAt": {"DataType": "String", "StringValue": triggered_at},
            },
        )
    except ClientError as err:
        print(f"SNS publish failed: {err}")
        return _respond(event, 502, {"error": "Publish failed."})

    return _respond(event, 202, {"messageId": message_id, "triggeredAt": triggered_at})
