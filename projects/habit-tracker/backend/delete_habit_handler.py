"""Lambda handler for DELETE /habits/{id}?ownerId=... (no authentication).

Verifies the caller's ownerId matches the habit's before deleting
anything -- the same non-distinguishing 404 pattern used across this
site's other projects, so a guessed habitId can't confirm whether it
belongs to someone else. Also deletes every check-in row for that habit;
otherwise they'd sit in CheckInsTable forever, orphaned under a habitId
nothing points to anymore.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")
CHECKINS_TABLE = os.environ.get("CHECKINS_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def lambda_handler(event, context):
    owner_id = (event.get("queryStringParameters") or {}).get("ownerId", "").strip()
    habit_id = (event.get("pathParameters") or {}).get("id")
    if not owner_id:
        return {"statusCode": 400, "headers": _cors_headers(), "body": json.dumps({"error": "Missing ownerId."})}

    habits_table = dynamodb.Table(HABITS_TABLE)
    result = habits_table.get_item(Key={"habitId": habit_id})
    item = result.get("Item")

    if not item or item.get("ownerId") != owner_id:
        return {"statusCode": 404, "headers": _cors_headers(), "body": json.dumps({"error": "Habit not found."})}

    checkins_table = dynamodb.Table(CHECKINS_TABLE)
    checkins = checkins_table.query(KeyConditionExpression=Key("habitId").eq(habit_id))
    with checkins_table.batch_writer() as batch:
        for checkin in checkins.get("Items", []):
            batch.delete_item(Key={"habitId": habit_id, "date": checkin["date"]})

    habits_table.delete_item(Key={"habitId": habit_id})

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"deleted": True})}
