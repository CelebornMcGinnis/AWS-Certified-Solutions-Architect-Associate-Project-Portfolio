"""Lambda handler for GET /uploads/mine (authenticated).

Lists the caller's own upload history, newest first -- pending, approved,
and rejected all included, so a visitor can see the full outcome of
everything they've tried, not just what made it into the public gallery.
Approved rows get a presigned GET URL for the actual image; pending/
rejected rows never had (or no longer have) an object to link to, so
those are omitted rather than pointing at nothing.
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


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }


def lambda_handler(event, context):
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    )
    caller_sub = claims.get("sub")
    if not caller_sub:
        return {"statusCode": 401, "headers": _cors_headers(), "body": json.dumps({"error": "Not authenticated."})}

    table = dynamodb.Table(TABLE_NAME)
    result = table.query(
        IndexName="OwnerIndex",
        KeyConditionExpression=Key("ownerSub").eq(caller_sub),
        ScanIndexForward=False,  # newest first
        Limit=MAX_ROWS,
    )

    uploads = []
    for item in result.get("Items", []):
        entry = {
            "uploadId": item["uploadId"],
            "status": item.get("status"),
            "filename": item.get("filename"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        if item.get("status") == "APPROVED":
            entry["imageUrl"] = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": GALLERY_BUCKET, "Key": item["uploadId"]},
                ExpiresIn=IMAGE_URL_EXPIRES_SECONDS,
            )
        uploads.append(entry)

    return {"statusCode": 200, "headers": _cors_headers(), "body": json.dumps({"uploads": uploads})}
