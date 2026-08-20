"""Lambda handler for GET /gallery (public, no auth required).

Returns the most recently approved images as presigned GET URLs, which
also happens to be exactly what "download for testing" needs -- each
returned imageUrl is a direct, time-limited link to the raw image bytes
in the gallery bucket, so a plain <a download> in the frontend is enough
to save one back out.

Queries the GalleryIndex GSI rather than the base table for the same
reason recent_jobs_handler.py and recent_handler.py in the other
projects do: a Scan can't reliably answer "the N most recent rows" once
the table holds more than a handful of items, since it reads items in
whatever order they happen to sit in on disk. Here that GSI also does
double duty as the approved/not-approved filter -- only items the
moderation Lambda has set galleryPk on show up in it at all.
"""
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
GALLERY_BUCKET = os.environ.get("GALLERY_BUCKET")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_ROWS = 20
IMAGE_URL_EXPIRES_SECONDS = 3600
GALLERY_GSI_PK = "APPROVED"


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    result = table.query(
        IndexName="GalleryIndex",
        KeyConditionExpression=Key("galleryPk").eq(GALLERY_GSI_PK),
        ScanIndexForward=False,  # newest first
        Limit=MAX_ROWS,
    )

    images = [
        {
            "uploadId": item["uploadId"],
            "filename": item.get("filename"),
            "createdAt": item.get("createdAt"),
            "imageUrl": s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": GALLERY_BUCKET, "Key": item["uploadId"]},
                ExpiresIn=IMAGE_URL_EXPIRES_SECONDS,
            ),
        }
        for item in result.get("Items", [])
    ]

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"images": images})}
