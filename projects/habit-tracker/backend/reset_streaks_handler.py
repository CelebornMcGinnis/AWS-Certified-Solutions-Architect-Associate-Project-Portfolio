"""Lambda handler invoked once daily by EventBridge Scheduler (see the
DailyStreakReset schedule in habit-tracker-stack.ts) -- not wired to any
API Gateway route.

Walks every habit and zeroes currentStreak for any that didn't check in
yesterday. A full Scan is the right tool here, unlike the "N most
recent" GSIs used elsewhere on this site: this job genuinely needs every
row, not a bounded recent window, so there's no ordering problem for a
Scan to get wrong -- completeness is all that matters, and at this
project's scale a Scan stays cheap indefinitely.
"""
import os
from datetime import date, timedelta

import boto3

dynamodb = boto3.resource("dynamodb")

HABITS_TABLE = os.environ.get("HABITS_TABLE")


def lambda_handler(event, context):
    table = dynamodb.Table(HABITS_TABLE)

    today_str = date.today().isoformat()
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()

    scan_kwargs = {}
    while True:
        page = table.scan(**scan_kwargs)

        for habit in page.get("Items", []):
            current_streak = int(habit.get("currentStreak", 0))
            last_check_in_date = habit.get("lastCheckInDate")

            if current_streak > 0 and last_check_in_date not in (today_str, yesterday_str):
                table.update_item(
                    Key={"habitId": habit["habitId"]},
                    UpdateExpression="SET currentStreak = :zero",
                    ExpressionAttributeValues={":zero": 0},
                )

        if "LastEvaluatedKey" not in page:
            break
        scan_kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
