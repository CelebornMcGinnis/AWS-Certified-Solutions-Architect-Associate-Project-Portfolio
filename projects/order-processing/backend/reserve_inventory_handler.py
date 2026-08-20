"""Step Functions task Lambda -- attempts to atomically reserve stock
for an order.

Returns {"success": true} or {"success": false, "reason": ...} rather
than raising, so the state machine branches on this ordinary business
outcome with a Choice state instead of ASL-level error handling --
running out of stock is an expected result here, not an exception.

Stock is lazily seeded to each product's default the first time it's
ever ordered. DynamoDB's if_not_exists() function can only be used
inside an UpdateExpression, not a ConditionExpression, so seeding has
to be its own conditional write (guarded by attribute_not_exists, so a
concurrent first-order race just no-ops on the loser) before the
actual reserve-with-a-numeric-floor conditional update runs.
"""
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from catalog import CATALOG

dynamodb = boto3.resource("dynamodb")

INVENTORY_TABLE = os.environ.get("INVENTORY_TABLE")
ORDERS_TABLE = os.environ.get("ORDERS_TABLE")


def _ensure_seeded(table, product_id, default_stock):
    try:
        table.put_item(
            Item={"productId": product_id, "stock": default_stock},
            ConditionExpression="attribute_not_exists(productId)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Already seeded -- either an earlier order, or a concurrent
        # request that won the same race. Either way, nothing to do.


def lambda_handler(event, context):
    product_id = event["productId"]
    quantity = event["quantity"]
    order_id = event["orderId"]
    default_stock = CATALOG[product_id]["defaultStock"]

    inventory_table = dynamodb.Table(INVENTORY_TABLE)
    _ensure_seeded(inventory_table, product_id, default_stock)

    try:
        inventory_table.update_item(
            Key={"productId": product_id},
            UpdateExpression="SET stock = stock - :qty",
            ConditionExpression="stock >= :qty",
            ExpressionAttributeValues={":qty": quantity},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {
                "success": False,
                "reason": f"Only a limited quantity of {CATALOG[product_id]['name']} is available -- please try a smaller quantity.",
            }
        raise

    dynamodb.Table(ORDERS_TABLE).update_item(
        Key={"orderId": order_id},
        UpdateExpression="SET #s = :s, updatedAt = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "INVENTORY_RESERVED", ":t": datetime.now(timezone.utc).isoformat()},
    )
    return {"success": True}
