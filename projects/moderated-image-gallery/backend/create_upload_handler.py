"""Lambda handler for POST /uploads (authenticated).

Creates the initial DynamoDB record for a new upload (status PENDING) and
returns a presigned S3 POST -- not a presigned PUT -- specifically so the
5MB/image-type limit is actually enforced by S3 itself via the POST
policy's conditions, not just checked client-side where it's trivial to
bypass. The moderation Lambda (moderate_upload_handler.py) picks up from
here once the browser's own POST to S3 lands.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
QUARANTINE_BUCKET = os.environ.get("QUARANTINE_BUCKET")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
PRESIGNED_POST_EXPIRES_SECONDS = 300


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(status_code, body):
    return {"statusCode": status_code, "headers": _cors_headers(), "body": json.dumps(body)}


def lambda_handler(event, context):
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    )
    owner_sub = claims.get("sub")
    if not owner_sub:
        return _respond(401, {"error": "Not authenticated."})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"error": "Invalid request body."})

    content_type = body.get("contentType")
    filename = str(body.get("filename", ""))[:120] or "upload"

    if content_type not in ALLOWED_CONTENT_TYPES:
        return _respond(400, {"error": "Only JPEG, PNG, and WebP images are allowed."})

    upload_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    table = dynamodb.Table(TABLE_NAME)
    table.put_item(
        Item={
            "uploadId": upload_id,
            "ownerSub": owner_sub,
            "status": "PENDING",
            "filename": filename,
            "contentType": content_type,
            "createdAt": now,
            "updatedAt": now,
        }
    )

    # A presigned POST (not a presigned PUT) is the only way to have S3
    # itself enforce the size/type limits via policy conditions -- a
    # presigned PUT URL has no equivalent server-side constraint, so a
    # client could ignore the declared contentType/size entirely.
    presigned = s3.generate_presigned_post(
        Bucket=QUARANTINE_BUCKET,
        Key=upload_id,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ],
        ExpiresIn=PRESIGNED_POST_EXPIRES_SECONDS,
    )

    return _respond(
        202,
        {
            "uploadId": upload_id,
            "status": "PENDING",
            "uploadUrl": presigned["url"],
            "uploadFields": presigned["fields"],
        },
    )
