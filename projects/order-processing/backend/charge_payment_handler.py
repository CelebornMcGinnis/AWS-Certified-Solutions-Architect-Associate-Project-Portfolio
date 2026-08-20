"""Step Functions task Lambda -- simulates charging payment.

A real payment failure would come back from a processor's API; this
demo approximates it with an explicit simulateFailure flag the visitor
can set, so the failure/compensation path can be triggered on demand
for a demo instead of waiting on random chance.
"""
import os
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")
ORDERS_TABLE = os.environ.get("ORDERS_TABLE")


def lambda_handler(event, context):
    order_id = event["orderId"]

    if event.get("simulateFailure"):
        return {"success": False, "reason": "Payment declined (simulated failure)."}

    dynamodb.Table(ORDERS_TABLE).update_item(
        Key={"orderId": order_id},
        UpdateExpression="SET #s = :s, updatedAt = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "PAYMENT_CHARGED", ":t": datetime.now(timezone.utc).isoformat()},
    )
    return {"success": True}
