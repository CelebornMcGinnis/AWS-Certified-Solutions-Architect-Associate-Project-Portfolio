"""Lambda handler triggered by the SQS queue subscribed to the SNS topic.

This is the buffered half of the fan-out, as opposed to notify_handler's
direct subscription. SQS wraps the original SNS envelope as a JSON
string in the message body.
"""
import json
import os
import time

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
TTL_SECONDS = 60 * 60 * 24


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        sns_envelope = json.loads(record["body"])
        attrs = sns_envelope.get("MessageAttributes", {})
        message_id = attrs.get("clientMessageId", {}).get("Value", sns_envelope.get("MessageId"))
        triggered_at = attrs.get("triggeredAt", {}).get("Value", sns_envelope.get("Timestamp"))

        table.put_item(
            Item={
                "messageId": message_id,
                "subscriber": "logger",
                "gsiPk": "ALL",
                "triggeredAt": triggered_at,
                "ttl": int(time.time()) + TTL_SECONDS,
            }
        )
