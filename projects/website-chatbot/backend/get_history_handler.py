"""Lambda handler for GET /chat/history (Cognito-authenticated).

Returns this visitor's recent conversation, oldest first, so the
frontend can restore where a reload left off. Messages are genuinely
short-lived -- each one carries a 24-hour DynamoDB TTL set at write
time in chat_handler.py, not a manual cleanup job.

Queries with ScanIndexForward=False (newest first) so a Limit actually
caps at the most *recent* rows rather than the oldest, then reverses
the page in Python back into chronological order for display.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_ROWS = 50


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    owner_sub = claims.get("sub")
    if not owner_sub:
        return {"statusCode": 401, "headers": _cors_headers(), "body": json.dumps({"error": "Not authenticated."})}

    table = dynamodb.Table(TABLE_NAME)
    result = table.query(
        KeyConditionExpression=Key("ownerSub").eq(owner_sub),
        ScanIndexForward=False,  # newest first, so Limit keeps the most recent rows
        Limit=MAX_ROWS,
    )

    messages = [
        {"role": item.get("role"), "text": item.get("text"), "source": item.get("source")}
        for item in reversed(result.get("Items", []))
    ]

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"messages": messages})}
