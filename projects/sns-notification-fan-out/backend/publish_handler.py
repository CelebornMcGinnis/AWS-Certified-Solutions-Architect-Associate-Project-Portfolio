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

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
TOPIC_ARN = os.environ.get("TOPIC_ARN")

NOTE_MAX_LENGTH = 140


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid JSON body."})

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
        return _respond(502, {"error": "Publish failed."})

    return _respond(202, {"messageId": message_id, "triggeredAt": triggered_at})
