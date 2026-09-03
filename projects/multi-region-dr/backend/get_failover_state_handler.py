"""Lambda handler for GET /failover-state.

Reads the current simulated failover state from DynamoDB. In a real
deployment, this same handler would run unmodified in both the primary
and standby regions -- neither copy is hardcoded as "the real one" --
reading from the DynamoDB Global Table replica local to whichever
region happens to be serving the request.

Reference code only: this handler is never deployed. See
../README.md for why.
"""
import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]

STATE_KEY = "CURRENT"


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
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    item = table.get_item(Key={"stateKey": STATE_KEY}).get("Item")
    if not item:
        item = {
            "stateKey": STATE_KEY,
            "activeRegion": "us-east-1",
            "posture": "pilot-light",
            "status": "SERVING",
        }

    return _respond(event, 200, {
        "activeRegion": item["activeRegion"],
        "posture": item["posture"],
        "status": item["status"],
    })
