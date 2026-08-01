import logging
import os

import boto3
from boto3.dynamodb.conditions import Key

import email_utils

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
connections_table = dynamodb.Table(os.environ["CONNECTIONS_TABLE"])
tallies_table = dynamodb.Table(os.environ["TALLIES_TABLE"])

POLL_ID = "movie-poll"


def lambda_handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    logger.info("DISCONNECT connectionId=%s", connection_id)

    # Read the connection record BEFORE deleting it — this is the only
    # place voterId/lastOption live (vote_handler.py tags them there on
    # each vote), and we need them for the email below.
    existing = connections_table.get_item(Key={"connectionId": connection_id}).get("Item") or {}
    last_option = existing.get("lastOption")

    connections_table.delete_item(Key={"connectionId": connection_id})

    try:
        remaining_connections = connections_table.scan(Select="COUNT").get("Count", 0)
    except Exception:
        remaining_connections = "unknown"

    tallies = {}
    response = tallies_table.query(KeyConditionExpression=Key("pollId").eq(POLL_ID))
    for item in response.get("Items", []):
        tallies[item["option"]] = max(int(item.get("voteCount", 0)), 0)

    email_utils.send_notification(
        subject="Live Poll — connection closed, current stats",
        html_body=email_utils.disconnect_email(
            connection_id, remaining_connections, tallies, last_option, email_utils.format_timestamp()
        ),
        text_body=email_utils.disconnect_email_text(
            connection_id, remaining_connections, tallies, last_option, email_utils.format_timestamp()
        ),
    )

    return {"statusCode": 200}
