"""Lambda handler for GET /habits/{id}/checkins?ownerId=&days= (no auth).

Returns the checked-in dates for one habit over the last N days, for
rendering the frontend's calendar grid. A plain range Query against the
base table's own key (habitId + date) is enough here -- unlike the
"recent across everyone" GSIs elsewhere on this site, this is already
scoped to one habit and date itself is the sort key, so no separate
index is needed.
"""
import json
import os
from datetime import date, timedelta

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")
CHECKINS_TABLE = os.environ.get("CHECKINS_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

DEFAULT_DAYS = 30
MAX_DAYS = 90


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    query = event.get("queryStringParameters") or {}
    owner_id = query.get("ownerId", "").strip()
    habit_id = (event.get("pathParameters") or {}).get("id")
    if not owner_id:
        return {"statusCode": 400, "headers": _cors_headers(), "body": json.dumps({"error": "Missing ownerId."})}

    habits_table = dynamodb.Table(HABITS_TABLE)
    habit = habits_table.get_item(Key={"habitId": habit_id}).get("Item")
    if not habit or habit.get("ownerId") != owner_id:
        return {"statusCode": 404, "headers": _cors_headers(), "body": json.dumps({"error": "Habit not found."})}

    try:
        days = min(max(int(query.get("days", DEFAULT_DAYS)), 1), MAX_DAYS)
    except ValueError:
        days = DEFAULT_DAYS

    since = (date.today() - timedelta(days=days - 1)).isoformat()

    checkins_table = dynamodb.Table(CHECKINS_TABLE)
    result = checkins_table.query(
        KeyConditionExpression=Key("habitId").eq(habit_id) & Key("date").gte(since),
    )
    dates = [item["date"] for item in result.get("Items", [])]

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"dates": dates})}
