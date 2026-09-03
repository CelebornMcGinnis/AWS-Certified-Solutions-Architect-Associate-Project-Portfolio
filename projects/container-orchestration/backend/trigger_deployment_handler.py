"""Lambda handler for POST /deployment/trigger.

Forces a new rolling deployment of the ECS service on its current task
definition -- the same effect a fresh `aws ecs update-service
--force-new-deployment` (or a real CI/CD pipeline pushing a new image tag)
would have. ECS's own rolling-update controller does the rest: it starts
new tasks alongside the old ones, waits for each to pass its health check,
then drains an old task, repeating until every task is on the new
deployment -- this handler only has to ask for that to start, not orchestrate
it step by step.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

ecs = boto3.client("ecs")

CLUSTER_NAME = os.environ.get("CLUSTER_NAME")
SERVICE_NAME = os.environ.get("SERVICE_NAME")
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
    try:
        result = ecs.update_service(
            cluster=CLUSTER_NAME,
            service=SERVICE_NAME,
            forceNewDeployment=True,
        )
    except ClientError as err:
        print(f"update_service failed for {SERVICE_NAME}: {err}")
        return _respond(event, 502, {"error": "Couldn't start a new deployment. Please try again."})

    deployment = (result.get("service") or {}).get("deployments") or [{}]
    return _respond(
        event,
        202,
        {
            "serviceName": SERVICE_NAME,
            "status": "DEPLOYING",
            "taskDefinition": (deployment[0].get("taskDefinition") or "").rsplit("/", 1)[-1],
        },
    )
