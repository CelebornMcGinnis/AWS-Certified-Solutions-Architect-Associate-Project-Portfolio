"""Lambda handler for GET /rollups.

Returns the current per-region rollup counters as JSON, for the dashboard
to poll on an interval. A plain Scan is fine here -- unlike the "recent
items" GSI pattern used elsewhere in this portfolio, this table only ever
holds one row per region (a handful of items total), so there's no
recency ordering to get wrong and no scale concern.
"""
import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]


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
    result = table.scan()

    rollups = [
        {
            "region": item["region"],
            "eventCount": int(item.get("eventCount", 0)),
            "updatedAt": item.get("updatedAt"),
        }
        for item in result.get("Items", [])
    ]

    return {
        "statusCode": 200,
        "headers": _cors_headers(event),
        "body": json.dumps({"rollups": rollups}),
    }
