"""Lambda handler triggered by S3 ObjectCreated on the quarantine bucket.

Runs the newly-uploaded image through Rekognition's content moderation
check and resolves it one of two ways:

- Flagged: the object is deleted from quarantine immediately -- per the
  site's own decision not to retain content someone uploaded specifically
  to test the moderation boundary -- and the upload's DynamoDB record
  flips to REJECTED. No moderation category is stored or ever surfaced
  back to the visitor, only the fact that it was rejected.
- Clean: the object is copied to the public gallery bucket, removed from
  quarantine, and the record flips to APPROVED. Setting `galleryPk` only
  now (never at upload time) is what makes the gallery's recency GSI
  naturally include just approved images -- nothing has to filter PENDING
  or REJECTED rows back out at read time.
"""
import os
from datetime import datetime, timezone

import boto3

s3 = boto3.client("s3")
rekognition = boto3.client("rekognition")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
QUARANTINE_BUCKET = os.environ.get("QUARANTINE_BUCKET")
GALLERY_BUCKET = os.environ.get("GALLERY_BUCKET")

GALLERY_GSI_PK = "APPROVED"


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        upload_id = record["s3"]["object"]["key"]
        now = datetime.now(timezone.utc).isoformat()

        result = rekognition.detect_moderation_labels(
            Image={"S3Object": {"Bucket": QUARANTINE_BUCKET, "Name": upload_id}}
        )
        flagged = bool(result.get("ModerationLabels"))

        if flagged:
            s3.delete_object(Bucket=QUARANTINE_BUCKET, Key=upload_id)
            table.update_item(
                Key={"uploadId": upload_id},
                UpdateExpression="SET #s = :status, updatedAt = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":status": "REJECTED", ":now": now},
            )
        else:
            s3.copy_object(
                Bucket=GALLERY_BUCKET,
                Key=upload_id,
                CopySource={"Bucket": QUARANTINE_BUCKET, "Key": upload_id},
            )
            s3.delete_object(Bucket=QUARANTINE_BUCKET, Key=upload_id)
            table.update_item(
                Key={"uploadId": upload_id},
                UpdateExpression="SET #s = :status, updatedAt = :now, galleryPk = :galleryPk",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":status": "APPROVED",
                    ":now": now,
                    ":galleryPk": GALLERY_GSI_PK,
                },
            )
