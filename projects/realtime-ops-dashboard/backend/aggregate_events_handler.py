"""Kinesis-triggered Lambda: aggregates a batch of stream records into
DynamoDB rollup counters.

Not invoked over HTTP -- an EventSourceMapping on the Kinesis Data Stream
calls this with a batch of records at a time. Each record is expected to
be a small JSON event of the shape {"region": "us-east-1", ...}. Counts
are applied with an atomic ADD update expression rather than a
read-modify-write cycle, so concurrent batches (this function can run
with multiple concurrent pollers, one per shard) never clobber each
other's counts.
"""
import base64
import json
import os
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")


def _decode_record(record):
    payload = base64.b64decode(record["kinesis"]["data"])
    return json.loads(payload)


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    now = datetime.now(timezone.utc).isoformat()

    processed = 0
    for record in event.get("Records", []):
        try:
            body = _decode_record(record)
        except (ValueError, KeyError) as err:
            print(f"Skipping unparseable record {record.get('kinesis', {}).get('sequenceNumber')}: {err}")
            continue

        region = body.get("region", "unknown")

        table.update_item(
            Key={"region": region},
            UpdateExpression="ADD eventCount :one SET updatedAt = :now",
            ExpressionAttributeValues={":one": 1, ":now": now},
        )
        processed += 1

    print(f"Aggregated {processed} of {len(event.get('Records', []))} records in this batch.")
    return {"batchItemFailures": []}
