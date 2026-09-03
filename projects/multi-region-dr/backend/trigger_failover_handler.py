"""Lambda handler for POST /failover-state/simulate.

Flips the simulated failover state's active region and records which DR
posture was in effect. A real implementation would not normally expose
this as a public, callable action at all -- actual failover is driven by
Route 53's own health check evaluation, not a request a client sends.
This handler exists only to give the reference architecture something
concrete to invoke; it is never deployed.

Reference code only: this handler is never deployed. See
../README.md for why.
"""
import json
import os
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]

STATE_KEY = "CURRENT"
VALID_POSTURES = {"pilot-light", "warm-standby", "active-active"}
REGIONS = {"us-east-1": "us-west-2", "us-west-2": "us-east-1"}


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
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    body = json.loads(event.get("body") or "{}")
    posture = body.get("posture", "pilot-light")
    if posture not in VALID_POSTURES:
        return _respond(event, 400, {"error": "Unrecognized posture."})

    current = table.get_item(Key={"stateKey": STATE_KEY}).get("Item") or {"activeRegion": "us-east-1"}
    new_region = REGIONS[current["activeRegion"]]
    now = datetime.now(timezone.utc).isoformat()

    table.put_item(
        Item={
            "stateKey": STATE_KEY,
            "activeRegion": new_region,
            "posture": posture,
            "status": "SERVING",
            "updatedAt": now,
        }
    )

    return _respond(event, 200, {"activeRegion": new_region, "posture": posture, "status": "SERVING"})
