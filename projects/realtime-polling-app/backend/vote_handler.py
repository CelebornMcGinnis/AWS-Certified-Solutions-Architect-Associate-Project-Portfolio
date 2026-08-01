import json
import logging
import os
import time

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
votes_table = dynamodb.Table(os.environ["VOTES_TABLE"])
tallies_table = dynamodb.Table(os.environ["TALLIES_TABLE"])
connections_table = dynamodb.Table(os.environ["CONNECTIONS_TABLE"])

apigw_client = boto3.client(
    "apigatewaymanagementapi",
    endpoint_url=os.environ["WEBSOCKET_ENDPOINT"],
)

# Movie-poll options. If you change the poll, update this list to match
# the OPTIONS array in project/live-poll/index.html.
VALID_OPTIONS = {"fury-road", "matrix", "mission", "la-la-land", "jurassic-park"}


def lambda_handler(event, context):
    connection_id = event["requestContext"]["connectionId"]

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return {"statusCode": 400}

    action = body.get("action")
    poll_id = body.get("pollId")

    if action == "sync":
        return handle_sync(connection_id, poll_id)
    return handle_vote(connection_id, body, poll_id)


def handle_sync(connection_id, poll_id):
    """A client just connected and is asking for the current results.
    This runs as its own invocation (not inside $connect), so the
    connection is guaranteed to already be postable."""
    if not poll_id:
        return {"statusCode": 400}

    tallies = {}
    response = tallies_table.query(KeyConditionExpression=Key("pollId").eq(poll_id))
    for item in response.get("Items", []):
        tallies[item["option"]] = max(int(item.get("voteCount", 0)), 0)

    try:
        apigw_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps({"type": "results", "tallies": tallies}).encode("utf-8"),
        )
    except apigw_client.exceptions.GoneException:
        connections_table.delete_item(Key={"connectionId": connection_id})

    return {"statusCode": 200}


def handle_vote(connection_id, body, poll_id):
    option = body.get("option")
    voter_id = body.get("voterId")

    if not poll_id or option not in VALID_OPTIONS or not voter_id:
        return {"statusCode": 400}

    existing = votes_table.get_item(
        Key={"pollId": poll_id, "voterId": voter_id}
    ).get("Item")
    previous_option = existing.get("option") if existing else None
    changed = previous_option is not None and previous_option != option

    if previous_option != option:
        # NOTE: these are two sequential updates rather than one atomic
        # transaction. For a low-stakes demo poll that's an acceptable
        # tradeoff, but a production vote system should use
        # dynamodb.meta.client.transact_write_items so the vote record and
        # both tally updates succeed or fail together.
        votes_table.put_item(
            Item={
                "pollId": poll_id,
                "voterId": voter_id,
                "option": option,
                "votedAt": int(time.time()),
            }
        )

        tallies_table.update_item(
            Key={"pollId": poll_id, "option": option},
            UpdateExpression="ADD voteCount :inc",
            ExpressionAttributeValues={":inc": 1},
        )

        if previous_option:
            tallies_table.update_item(
                Key={"pollId": poll_id, "option": previous_option},
                UpdateExpression="ADD voteCount :dec",
                ExpressionAttributeValues={":dec": -1},
            )

    # Tag this connection with the voter's current pick, so on_disconnect.py
    # can include "what they voted for" in its summary email — the
    # connections table doesn't otherwise know anything about voters, only
    # that a connection exists.
    connections_table.update_item(
        Key={"connectionId": connection_id},
        UpdateExpression="SET voterId = :v, lastOption = :o",
        ExpressionAttributeValues={":v": voter_id, ":o": option},
    )

    tallies = {}
    response = tallies_table.query(KeyConditionExpression=Key("pollId").eq(poll_id))
    for item in response.get("Items", []):
        tallies[item["option"]] = max(int(item.get("voteCount", 0)), 0)

    payload = json.dumps(
        {
            "type": "results",
            "tallies": tallies,
            "event": {"option": option, "changed": changed},
        }
    ).encode("utf-8")

    connections = connections_table.scan().get("Items", [])
    logger.info("Broadcasting to %d connection(s)", len(connections))
    for conn in connections:
        try:
            apigw_client.post_to_connection(
                ConnectionId=conn["connectionId"], Data=payload
            )
            logger.info("Broadcast ok -> %s", conn["connectionId"])
        except apigw_client.exceptions.GoneException:
            logger.warning("Connection %s was gone, removing", conn["connectionId"])
            connections_table.delete_item(
                Key={"connectionId": conn["connectionId"]}
            )
        except Exception:
            logger.exception("Broadcast failed -> %s", conn["connectionId"])
            continue

    return {"statusCode": 200}
