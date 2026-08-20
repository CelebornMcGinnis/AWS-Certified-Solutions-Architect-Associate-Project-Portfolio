"""Lambda handler triggered by an SNS notification from a CloudWatch
Alarm (see DlqMessageNearExpiryAlarm in fanning-sns-stack.ts).

The alarm watches the dead-letter queue's ApproximateAgeOfOldestMessage
metric and fires once the oldest message has been sitting for 2+ days
-- 2 days before the queue's 4-day retention period would delete it
for good, and permanently lose whatever notification failed 3 times to
land. The alarm re-evaluates (and this Lambda re-sends) every 6 hours
while the condition still holds, so a stuck message keeps surfacing
until someone actually deals with it, rather than a single email
getting missed in an inbox.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3

sqs = boto3.client("sqs")
ses = boto3.client("ses")
cloudwatch = boto3.client("cloudwatch")

SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS")
SES_TO_ADDRESS = os.environ.get("SES_TO_ADDRESS")
DLQ_URL = os.environ.get("DLQ_URL")
DLQ_NAME = os.environ.get("DLQ_NAME")
STAGE = os.environ.get("STAGE", "prod")
RETENTION_DAYS = 4


def _oldest_message_age_seconds():
    """ApproximateAgeOfOldestMessage is a CloudWatch-only metric, not an
    SQS queue attribute -- GetQueueAttributes has no equivalent, so this
    re-reads the same metric the alarm itself is watching, most recent
    datapoint first."""
    now = datetime.now(timezone.utc)
    result = cloudwatch.get_metric_statistics(
        Namespace="AWS/SQS",
        MetricName="ApproximateAgeOfOldestMessage",
        Dimensions=[{"Name": "QueueName", "Value": DLQ_NAME}],
        StartTime=now - timedelta(hours=1),
        EndTime=now,
        Period=300,
        Statistics=["Maximum"],
    )
    datapoints = result.get("Datapoints", [])
    if not datapoints:
        return 0
    latest = max(datapoints, key=lambda dp: dp["Timestamp"])
    return int(latest["Maximum"])

COLOR_TEXT = "#172033"
COLOR_MUTED = "#5f6b7a"
COLOR_WARN_BG = "#fdecec"
COLOR_WARN_TEXT = "#982727"
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


def _alert_email_html(stage, message_count, oldest_age_seconds, alarm_name, state_reason):
    days = oldest_age_seconds // 86400
    hours = (oldest_age_seconds % 86400) // 3600
    days_left = max(RETENTION_DAYS - (oldest_age_seconds // 86400), 0)

    return _email_wrapper(
        f'<div style="background:#fff; border-radius:16px; padding:28px; '
        f'box-shadow:0 24px 60px rgba(23,32,51,0.12);">'
        f'<p style="display:inline-block; font-size:12px; font-weight:700; '
        f'text-transform:uppercase; letter-spacing:0.04em; color:{COLOR_WARN_TEXT}; '
        f'background:{COLOR_WARN_BG}; padding:4px 10px; border-radius:999px; margin:0 0 14px;">'
        f"SNS Fan-Out ({stage}) &middot; DLQ Alert</p>"
        f'<h1 style="font-size:19px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">A message is close to expiring in the dead-letter queue</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 8px;">'
        f"<strong>Oldest message age:</strong> {days}d {hours}h "
        f"(retention is {RETENTION_DAYS} days &mdash; about {days_left}d left before it's permanently deleted)</p>"
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 16px;">'
        f"<strong>Messages currently in the queue:</strong> {message_count}</p>"
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_MUTED}; margin:0;">'
        f"Triggered by CloudWatch alarm <strong>{alarm_name}</strong>: {state_reason}</p>"
        f"</div>"
    )


def _alert_email_text(stage, message_count, oldest_age_seconds, alarm_name, state_reason):
    days = oldest_age_seconds // 86400
    hours = (oldest_age_seconds % 86400) // 3600
    days_left = max(RETENTION_DAYS - (oldest_age_seconds // 86400), 0)
    return (
        f"SNS Fan-Out ({stage}) -- DLQ Alert\n\n"
        f"A message in the dead-letter queue is {days}d {hours}h old "
        f"(retention is {RETENTION_DAYS} days -- about {days_left}d left before deletion).\n"
        f"Messages currently in queue: {message_count}\n"
        f"Triggered by alarm: {alarm_name} ({state_reason})"
    )


def lambda_handler(event, context):
    for record in event.get("Records", []):
        sns_message = json.loads(record["Sns"]["Message"])
        alarm_name = sns_message.get("AlarmName", "unknown alarm")
        state_reason = sns_message.get("NewStateReason", "")

        attrs = sqs.get_queue_attributes(
            QueueUrl=DLQ_URL,
            AttributeNames=["ApproximateNumberOfMessages"],
        )["Attributes"]
        message_count = int(attrs.get("ApproximateNumberOfMessages", 0))
        oldest_age_seconds = _oldest_message_age_seconds()

        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [SES_TO_ADDRESS]},
            Message={
                "Subject": {"Data": f"[Action needed] SNS fan-out ({STAGE}) DLQ message nearing expiry"},
                "Body": {
                    "Html": {"Data": _alert_email_html(STAGE, message_count, oldest_age_seconds, alarm_name, state_reason)},
                    "Text": {"Data": _alert_email_text(STAGE, message_count, oldest_age_seconds, alarm_name, state_reason)},
                },
            },
        )
