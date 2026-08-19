"""Lambda handler for GET /jobs/recent.

Returns the most recently submitted jobs (any status) so the page can
show a small trickle of other visitors' demo runs, not just the one you
personally submitted -- same idea as the SNS fan-out project's
recent_handler.py, including why this queries a GSI instead of scanning:
a Scan reads items in whatever order they happen to sit in on disk,
unrelated to recency, so it can't reliably answer "the N most recent
rows" once the table holds more than a handful of items.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]

MAX_ROWS = 10
GSI_PK_VALUE = "ALL"


def _resolve_origin(event):
    if "*" in ALLOWED_ORIGINS:
        return "*"
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        return origin
    return ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "*"


def _cors_headers(event):
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": _resolve_origin(event),
        "Vary": "Origin",
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    result = table.query(
        IndexName="RecentIndex",
        KeyConditionExpression=Key("gsiPk").eq(GSI_PK_VALUE),
        ScanIndexForward=False,  # descending -- newest createdAt first
        Limit=MAX_ROWS,
    )

    jobs = [
        {
            "jobId": item["jobId"],
            "status": item.get("status"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in result.get("Items", [])
    ]

    return {
        "statusCode": 200,
        "headers": _cors_headers(event),
        "body": json.dumps({"jobs": jobs}),
    }
