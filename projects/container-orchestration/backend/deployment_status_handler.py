"""Lambda handler for GET /deployment/status.

Reads the ECS service's current deployment state directly from the ECS API
-- no separate status table. A rolling deployment naturally produces two
active deployments while it's in flight (PRIMARY, the new task definition
rolling in, and ACTIVE, the old one rolling out), so the response reports
both counts rather than a single "percent done" figure the frontend would
have to guess at.
"""
import json
import os

import boto3

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
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    result = ecs.describe_services(cluster=CLUSTER_NAME, services=[SERVICE_NAME])
    services = result.get("services") or []
    if not services:
        return _respond(event, 404, {"error": "Service not found."})

    service = services[0]
    deployments = [
        {
            "status": d.get("status"),
            "taskDefinition": (d.get("taskDefinition") or "").rsplit("/", 1)[-1],
            "desiredCount": d.get("desiredCount"),
            "runningCount": d.get("runningCount"),
            "rolloutState": d.get("rolloutState"),
        }
        for d in service.get("deployments") or []
    ]

    return _respond(
        event,
        200,
        {
            "serviceName": service.get("serviceName"),
            "status": service.get("status"),
            "desiredCount": service.get("desiredCount"),
            "runningCount": service.get("runningCount"),
            "deployments": deployments,
        },
    )
