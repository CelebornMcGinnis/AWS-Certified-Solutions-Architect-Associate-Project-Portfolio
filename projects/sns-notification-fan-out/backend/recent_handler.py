"""Lambda handler for GET /notify/recent.

Reads back recent rows from the delivery log table and groups the two
per-subscriber rows for each message id into one entry, so the page can
render a single row with two status badges.

Queries the RecentIndex GSI (constant partition key, triggeredAt as the
sort key) rather than scanning the base table. A Scan reads items in
whatever order they happen to sit in on disk — unrelated to recency —
so once the table holds more than a handful of items, a Scan(Limit=N)
can easily miss the newest rows entirely. A Query against an index
sorted by triggeredAt, read in descending order, is the only way to
reliably get "the N most recent rows" regardless of table size.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_ROWS = 10
GSI_PK_VALUE = "ALL"


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        # This endpoint is polled repeatedly by the same client while
        # watching a fan-out complete — without this, nothing stops an
        # intermediate cache (or the browser itself) from just replaying
        # the first response instead of hitting the Lambda again.
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    # Each triggered message writes up to 2 rows (logger + notifier), so
    # reading 4x the row cap comfortably covers MAX_ROWS distinct
    # message ids even when a row's partner hasn't landed yet.
    result = table.query(
        IndexName="RecentIndex",
        KeyConditionExpression=Key("gsiPk").eq(GSI_PK_VALUE),
        ScanIndexForward=False,  # descending — newest triggeredAt first
        Limit=MAX_ROWS * 4,
    )
    items = result.get("Items", [])

    by_message = {}
    for item in items:
        message_id = item["messageId"]
        entry = by_message.setdefault(
            message_id,
            {"messageId": message_id, "triggeredAt": item.get("triggeredAt"), "logger": False, "notifier": False},
        )
        if item["subscriber"] == "logger":
            entry["logger"] = True
        if item["subscriber"] == "notifier":
            entry["notifier"] = True
            entry["emailStatus"] = item.get("emailStatus")

    rows = sorted(by_message.values(), key=lambda r: r.get("triggeredAt") or "", reverse=True)[:MAX_ROWS]

    return {
        "statusCode": 200,
        "headers": _cors_headers(),
        "body": json.dumps({"rows": rows}),
    }
