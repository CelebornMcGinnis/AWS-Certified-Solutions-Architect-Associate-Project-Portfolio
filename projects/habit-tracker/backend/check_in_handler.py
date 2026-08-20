"""Lambda handler for POST /habits/{id}/checkins (no authentication).

Marks the caller's habit checked in for today (the server's own UTC
clock decides "today" -- a client-supplied date would just be one more
thing an anonymous caller could fake) and updates the streak. Idempotent:
checking in twice on the same day leaves the streak untouched instead of
double-counting.

Streak math:
- last check-in was yesterday -> streak continues, +1
- last check-in was today already -> no-op, streak unchanged
- anything else (gap, or no prior check-in at all) -> streak restarts at 1
longestStreak is a running high-water mark, never decremented here --
only ResetStreaksFunction (reset_streaks_handler.py) ever lowers
currentStreak, and it never touches longestStreak.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")
CHECKINS_TABLE = os.environ.get("CHECKINS_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


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
    habit_id = (event.get("pathParameters") or {}).get("id")
    if not owner_id:
        return _respond(400, {"error": "Missing ownerId."})

    habits_table = dynamodb.Table(HABITS_TABLE)
    result = habits_table.get_item(Key={"habitId": habit_id})
    habit = result.get("Item")
    if not habit or habit.get("ownerId") != owner_id:
        return _respond(404, {"error": "Habit not found."})

    now = datetime.now(timezone.utc)
    today = now.date()
    today_str = today.isoformat()
    yesterday_str = (today - timedelta(days=1)).isoformat()
    last_check_in_date = habit.get("lastCheckInDate")
    current_streak = int(habit.get("currentStreak", 0))
    longest_streak = int(habit.get("longestStreak", 0))

    if last_check_in_date != today_str:
        checkins_table = dynamodb.Table(CHECKINS_TABLE)
        checkins_table.put_item(Item={"habitId": habit_id, "date": today_str, "checkedInAt": now.isoformat()})

        current_streak = current_streak + 1 if last_check_in_date == yesterday_str else 1
        longest_streak = max(longest_streak, current_streak)

        habits_table.update_item(
            Key={"habitId": habit_id},
            UpdateExpression="SET currentStreak = :cur, longestStreak = :longest, lastCheckInDate = :today",
            ExpressionAttributeValues={":cur": current_streak, ":longest": longest_streak, ":today": today_str},
        )

    return _respond(
        200,
        {
            "habitId": habit_id,
            "currentStreak": current_streak,
            "longestStreak": longest_streak,
            "lastCheckInDate": today_str,
        },
    )
