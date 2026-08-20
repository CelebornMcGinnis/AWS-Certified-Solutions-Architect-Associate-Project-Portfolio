"""Lambda handler for POST /habits.

No authentication -- the caller supplies an ownerId (the browser's
localStorage-generated device id) directly in the request body, and it's
trusted as-is. This is a deliberate, disclosed tradeoff for an anonymous
demo, not a real access-control boundary; see habit-tracker-stack.ts.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_NAME_LENGTH = 80


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def _respond(status_code, body):
    return {"statusCode": status_code, "headers": _cors_headers(), "body": json.dumps(body)}


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid request body."})

    owner_id = str(body.get("ownerId", "")).strip()
    name = str(body.get("name", "")).strip()[:MAX_NAME_LENGTH]

    if not owner_id:
        return _respond(400, {"error": "Missing ownerId."})
    if not name:
        return _respond(400, {"error": "Habit name is required."})

    habit_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    table = dynamodb.Table(HABITS_TABLE)
    item = {
        "habitId": habit_id,
        "ownerId": owner_id,
        "name": name,
        "createdAt": now,
        "currentStreak": 0,
        "longestStreak": 0,
    }
    table.put_item(Item=item)

    return _respond(
        201,
        {
            "habitId": habit_id,
            "name": name,
            "createdAt": now,
            "currentStreak": 0,
            "longestStreak": 0,
            "lastCheckInDate": None,
        },
    )
