"""Lambda handler for GET /orders/{id}?ownerId=... (no authentication,
owner-only). Same non-distinguishing 404 pattern used across this
site's other projects -- knowing another visitor's orderId shouldn't
be enough to confirm it exists.

Polled by the frontend to show the order's live status as the state
machine advances (or compensates) it.
"""
import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    owner_id = (event.get("queryStringParameters") or {}).get("ownerId", "").strip()
    order_id = (event.get("pathParameters") or {}).get("id")
    if not owner_id:
        return {"statusCode": 400, "headers": _cors_headers(), "body": json.dumps({"error": "Missing ownerId."})}

    table = dynamodb.Table(TABLE_NAME)
    item = table.get_item(Key={"orderId": order_id}).get("Item")

    if not item or item.get("ownerId") != owner_id:
        return {"statusCode": 404, "headers": _cors_headers(), "body": json.dumps({"error": "Order not found."})}

    return {
        "statusCode": 200,
        "headers": _cors_headers(),
        "body": json.dumps(
            {
                "orderId": item["orderId"],
                "productName": item.get("productName"),
                "quantity": int(item["quantity"]) if item.get("quantity") is not None else None,
                "totalPrice": item.get("totalPrice"),
                "status": item.get("status"),
                "failureReason": item.get("failureReason"),
                "createdAt": item.get("createdAt"),
                "updatedAt": item.get("updatedAt"),
            }
        ),
    }
