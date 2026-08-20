"""Lambda handler for GET /products (public, no authentication).

Returns the fixed catalog (backend/catalog.py) merged with each
product's live stock count -- a product nobody has ordered yet has no
row in InventoryTable at all, so its default stock is reported instead
of a missing value.
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
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    table = dynamodb.Table(INVENTORY_TABLE)
    products = []
    for product_id, info in CATALOG.items():
        item = table.get_item(Key={"productId": product_id}).get("Item")
        stock = int(item["stock"]) if item else info["defaultStock"]
        products.append(
            {
                "productId": product_id,
                "name": info["name"],
                "unitPrice": info["unitPrice"],
                "stock": stock,
            }
        )
    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"products": products})}
