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

COLOR_TEXT = "#172033"
COLOR_MUTED = "#5f6b7a"
COLOR_ACCENT_BG = "#eef0fd"
COLOR_ACCENT_TEXT = "#3454d1"
COLOR_BG = "#f6f7fb"


def _email_wrapper(inner_html):
    """Same minimal full-document wrapper contact-form-api's
    lambda_function.py uses -- email clients render more consistently
    with a real <html>/<head>/<body> structure than a bare fragment."""
    return (
        "<!doctype html>"
        "<html>"
        "<head>"
        '<meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        "</head>"
        f'<body style="margin:0; padding:24px 16px; background:{COLOR_BG};">'
        f'<div style="max-width:520px; margin:0 auto; font-family:-apple-system,'
        f'BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">'
        f"{inner_html}"
        "</div>"
        "</body>"
        "</html>"
    )


def _notify_email_html(message, triggered_at):
    return _email_wrapper(
        f'<div style="background:#fff; border-radius:16px; padding:28px; '
        f'box-shadow:0 24px 60px rgba(23,32,51,0.12);">'
        f'<p style="display:inline-block; font-size:12px; font-weight:700; '
        f'text-transform:uppercase; letter-spacing:0.04em; color:{COLOR_ACCENT_TEXT}; '
        f'background:{COLOR_ACCENT_BG}; padding:4px 10px; border-radius:999px; margin:0 0 14px;">'
        f"SNS Fan-Out Demo</p>"
        f'<h1 style="font-size:19px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">A test notification was triggered</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 16px;">{message}</p>'
        f'<p style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; margin:0;">'
        f"Triggered at: {triggered_at}</p>"
        f"</div>"
    )


def _notify_email_text(message, triggered_at):
    return f"{message}\n\nTriggered at: {triggered_at}"


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        sns_record = record["Sns"]
        attrs = sns_record.get("MessageAttributes", {})
        message_id = attrs.get("clientMessageId", {}).get("Value", sns_record.get("MessageId"))
        triggered_at = attrs.get("triggeredAt", {}).get("Value", sns_record.get("Timestamp"))

        message = sns_record.get("Message")
        email_status = "sent"
        try:
            ses.send_email(
                Source=ADMIN_EMAIL,
                Destination={"ToAddresses": [SNS_TO_EMAIL]},
                Message={
                    "Subject": {"Data": "SNS demo: test notification triggered"},
                    "Body": {
                        "Html": {"Data": _notify_email_html(message, triggered_at)},
                        "Text": {"Data": _notify_email_text(message, triggered_at)},
                    },
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
