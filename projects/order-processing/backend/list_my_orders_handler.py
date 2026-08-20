"""Lambda handler for GET /orders/mine?ownerId=... (no authentication --
same anonymous device-id pattern as the habit tracker). Queries the
OwnerIndex GSI for the same reason every other "list mine" endpoint on
this site does: a Scan can't answer "this owner's orders" without
reading the whole table.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_ROWS = 20


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    owner_id = (event.get("queryStringParameters") or {}).get("ownerId", "").strip()
    if not owner_id:
        return {"statusCode": 400, "headers": _cors_headers(), "body": json.dumps({"error": "Missing ownerId."})}

    table = dynamodb.Table(TABLE_NAME)
    result = table.query(
        IndexName="OwnerIndex",
        KeyConditionExpression=Key("ownerId").eq(owner_id),
        ScanIndexForward=False,  # newest first
        Limit=MAX_ROWS,
    )

    orders = [
        {
            "orderId": item["orderId"],
            "productName": item.get("productName"),
            "quantity": int(item["quantity"]) if item.get("quantity") is not None else None,
            "totalPrice": item.get("totalPrice"),
            "status": item.get("status"),
            "createdAt": item.get("createdAt"),
        }
        for item in result.get("Items", [])
    ]

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"orders": orders})}
