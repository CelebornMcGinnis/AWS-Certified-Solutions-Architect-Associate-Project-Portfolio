"""Lambda handler for POST /orders (public, no authentication).

Validates the order against the fixed catalog, writes the initial
PENDING record, and starts the order state machine -- the same
create-then-StartExecution pattern workflow-visualizer's
create_job_handler.py uses. Every real status transition after this
happens inside the state machine itself (order-processing-stack.ts),
not in this Lambda.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3

from catalog import CATALOG, MAX_QUANTITY_PER_ORDER

sfn = boto3.client("stepfunctions")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def _respond(status_code, body):
    return {"statusCode": status_code, "headers": _cors_headers(), "body": json.dumps(body)}


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid request body."})

    owner_id = str(body.get("ownerId", "")).strip()
    product_id = body.get("productId")
    simulate_failure = bool(body.get("simulateFailure"))

    try:
        quantity = int(body.get("quantity", 0))
    except (TypeError, ValueError):
        quantity = 0

    if not owner_id:
        return _respond(400, {"error": "Missing ownerId."})
    if product_id not in CATALOG:
        return _respond(400, {"error": "Unknown product."})
    if quantity < 1 or quantity > MAX_QUANTITY_PER_ORDER:
        return _respond(400, {"error": f"Quantity must be between 1 and {MAX_QUANTITY_PER_ORDER}."})

    product = CATALOG[product_id]
    order_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    total_price = round(product["unitPrice"] * quantity, 2)

    table = dynamodb.Table(TABLE_NAME)
    table.put_item(
        Item={
            "orderId": order_id,
            "ownerId": owner_id,
            "productId": product_id,
            "productName": product["name"],
            "unitPrice": str(product["unitPrice"]),
            "quantity": quantity,
            "totalPrice": str(total_price),
            "status": "PENDING",
            "createdAt": now,
            "updatedAt": now,
        }
    )

    sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=order_id,
        input=json.dumps(
            {
                "orderId": order_id,
                "productId": product_id,
                "quantity": quantity,
                "simulateFailure": simulate_failure,
            }
        ),
    )

    return _respond(
        202,
        {
            "orderId": order_id,
            "status": "PENDING",
            "productName": product["name"],
            "quantity": quantity,
            "totalPrice": total_price,
        },
    )
