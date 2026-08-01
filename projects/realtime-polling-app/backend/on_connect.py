import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
connections_table = dynamodb.Table(os.environ["CONNECTIONS_TABLE"])


def lambda_handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    logger.info("CONNECT connectionId=%s", connection_id)

    connections_table.put_item(
        Item={"connectionId": connection_id, "connectedAt": int(time.time())}
    )

    # No email here on purpose — everything worth knowing (connection ID,
    # final vote, and the results table) already goes out in the
    # disconnect email (see on_disconnect.py), so a separate connect
    # notification would just be noise without new information.

    # Deliberately NOT pushing initial results here. Posting to the same
    # connection from within its own $connect invocation is unreliable —
    # API Gateway doesn't reliably treat the connection as postable until
    # after this handler returns. The client sends a separate "sync"
    # message right after the connection opens instead (handled by
    # vote_handler.py), which is a fully separate invocation and doesn't
    # hit this race.
    return {"statusCode": 200}
