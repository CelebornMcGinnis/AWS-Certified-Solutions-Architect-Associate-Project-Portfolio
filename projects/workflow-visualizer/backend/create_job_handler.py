"""Lambda handler for POST /jobs.

Writes the initial DynamoDB item for a new job (status SUBMITTED) and
starts a Step Functions execution to run it through VALIDATING ->
PROCESSING -> COMPLETE. Every real status transition after this point is
written by the state machine itself, via its native DynamoDB integration
-- not by any Lambda -- so this handler's only two jobs are "create the
row" and "kick off the workflow".
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")

TABLE_NAME = os.environ.get("TABLE_NAME")
STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]

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

    job_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    table.put_item(
        Item={
            "jobId": job_id,
            "gsiPk": GSI_PK_VALUE,
            "status": "SUBMITTED",
            "createdAt": now,
            "updatedAt": now,
        }
    )

    try:
        sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            name=job_id,
            input=json.dumps({"jobId": job_id}),
        )
    except ClientError as err:
        print(f"StartExecution failed for job {job_id}: {err}")
        return _respond(event, 502, {"error": "Couldn't start the workflow. Please try again."})

    return _respond(event, 202, {"jobId": job_id, "status": "SUBMITTED", "createdAt": now})
