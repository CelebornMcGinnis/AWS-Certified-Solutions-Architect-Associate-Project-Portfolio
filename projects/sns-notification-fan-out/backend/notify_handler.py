"""Lambda handler subscribed directly to the SNS topic (no queue).

Sends a one-line email via SES to a fixed admin address, then writes its
own delivery row to DynamoDB, keyed by the client-generated message id
so the page's live log table can match it back to the button click that
triggered it.

No visitor email is ever collected or used here — this always emails
the site owner, purely as proof this branch of the fan-out fired.
"""
import os
import time

import boto3
from botocore.exceptions import ClientError

ses = boto3.client("ses")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")  # sender (From)
SNS_TO_EMAIL = os.environ.get("SNS_TO_EMAIL")  # recipient (To)

TTL_SECONDS = 60 * 60 * 24  # rows expire after a day — this is a live
                             # demo log, not a durable record store.


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        sns_record = record["Sns"]
        attrs = sns_record.get("MessageAttributes", {})
        message_id = attrs.get("clientMessageId", {}).get("Value", sns_record.get("MessageId"))
        triggered_at = attrs.get("triggeredAt", {}).get("Value", sns_record.get("Timestamp"))

        email_status = "sent"
        try:
            ses.send_email(
                Source=ADMIN_EMAIL,
                Destination={"ToAddresses": [SNS_TO_EMAIL]},
                Message={
                    "Subject": {"Data": "SNS demo: test notification triggered"},
                    "Body": {"Text": {"Data": f"{sns_record.get('Message')}\n\nTriggered at: {triggered_at}"}},
                },
            )
        except ClientError as err:
            print(f"SES send failed: {err}")
            email_status = "failed"

        table.put_item(
            Item={
                "messageId": message_id,
                "subscriber": "notifier",
                "gsiPk": "ALL",
                "triggeredAt": triggered_at,
                "emailStatus": email_status,
                "ttl": int(time.time()) + TTL_SECONDS,
            }
        )
