"""Lambda handler for GET /jobs/{jobId}.

Reads back one job's current status. The browser polls this repeatedly
while a job is running to render the VALIDATING -> PROCESSING -> COMPLETE
timeline live -- the actual status transitions all come from the Step
Functions state machine writing directly to DynamoDB, this just reads
whatever the table currently says.
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
        # Polled repeatedly while watching a job run -- same reasoning as
        # the SNS fan-out project's recent_handler.py.
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    job_id = (event.get("pathParameters") or {}).get("jobId")
    if not job_id:
        return {
            "statusCode": 400,
            "headers": _cors_headers(event),
            "body": json.dumps({"error": "Missing jobId."}),
        }

    table = dynamodb.Table(TABLE_NAME)
    result = table.get_item(Key={"jobId": job_id})
    item = result.get("Item")

    if not item:
        return {
            "statusCode": 404,
            "headers": _cors_headers(event),
            "body": json.dumps({"error": "Job not found."}),
        }

    return {
        "statusCode": 200,
        "headers": _cors_headers(event),
        "body": json.dumps(
            {
                "jobId": item["jobId"],
                "status": item.get("status"),
                "createdAt": item.get("createdAt"),
                "updatedAt": item.get("updatedAt"),
            }
        ),
    }
