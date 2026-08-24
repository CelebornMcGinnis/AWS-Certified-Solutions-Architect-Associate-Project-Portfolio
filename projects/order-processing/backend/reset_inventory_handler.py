"""Lambda handler for POST /inventory/reset (public, no authentication --
matches this demo's other unauthenticated routes).

Stock is only ever decremented (reserve) or incremented back (release);
there's no path that restores it to a full, testable level once a
visitor has driven a few products to zero. This overwrites every
catalog product's stock straight back to its catalog.py defaultStock,
so testing can continue without waiting on anyone else's session to
release inventory.
"""
import json
import os

import boto3

from catalog import CATALOG

dynamodb = boto3.resource("dynamodb")
INVENTORY_TABLE = os.environ.get("INVENTORY_TABLE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    }


def lambda_handler(event, context):
    table = dynamodb.Table(INVENTORY_TABLE)
    for product_id, info in CATALOG.items():
        table.put_item(Item={"productId": product_id, "stock": info["defaultStock"]})
    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"reset": True})}
