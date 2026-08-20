"""Lambda handler for GET /habits?ownerId=... (no authentication).

Lists every habit belonging to the caller's device id, newest first.
Queries the OwnerIndex GSI rather than scanning the base table for the
same reason every other "list mine" endpoint on this site does: a Scan
can't reliably answer "this owner's habits" at all without reading the
whole table, let alone in a useful order.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_ROWS = 50


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    owner_id = (event.get("queryStringParameters") or {}).get("ownerId", "").strip()
    if not owner_id:
        return {"statusCode": 400, "headers": _cors_headers(), "body": json.dumps({"error": "Missing ownerId."})}

    table = dynamodb.Table(HABITS_TABLE)
    result = table.query(
        IndexName="OwnerIndex",
        KeyConditionExpression=Key("ownerId").eq(owner_id),
        ScanIndexForward=False,  # newest first
        Limit=MAX_ROWS,
    )

    habits = [
        {
            "habitId": item["habitId"],
            "name": item.get("name"),
            "createdAt": item.get("createdAt"),
            "currentStreak": int(item.get("currentStreak", 0)),
            "longestStreak": int(item.get("longestStreak", 0)),
            "lastCheckInDate": item.get("lastCheckInDate"),
        }
        for item in result.get("Items", [])
    ]

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"habits": habits})}
