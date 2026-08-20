"""Step Functions compensation task -- runs only when payment fails
after inventory was already reserved for the order.

Adds the reserved quantity back to stock, undoing
reserve_inventory_handler.py's decrement. This is the actual
Saga-style compensating action this project exists to demonstrate: the
state machine doesn't just report the failure, it undoes the part of
the transaction that already succeeded.
"""
import os

import boto3

dynamodb = boto3.resource("dynamodb")
INVENTORY_TABLE = os.environ.get("INVENTORY_TABLE")


def lambda_handler(event, context):
    product_id = event["productId"]
    quantity = event["quantity"]

    dynamodb.Table(INVENTORY_TABLE).update_item(
        Key={"productId": product_id},
        UpdateExpression="ADD stock :qty",
        ExpressionAttributeValues={":qty": quantity},
    )
    return {"released": True}
