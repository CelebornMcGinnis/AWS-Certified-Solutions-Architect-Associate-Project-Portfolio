"""Lambda handler for GET /uploads/{id} (authenticated, owner-only).

Polled by the frontend right after a submission to show live status --
PENDING while the moderation Lambda hasn't run yet, then APPROVED or
REJECTED. Deliberately checks that the caller's own JWT sub matches the
upload's ownerSub before returning anything; without that check, knowing
another visitor's uploadId would be enough to watch their upload resolve.
"""
import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ.get("TABLE_NAME")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


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

    upload_id = (event.get("pathParameters") or {}).get("id")
    table = dynamodb.Table(TABLE_NAME)
    result = table.get_item(Key={"uploadId": upload_id})
    item = result.get("Item")

    if not item or item.get("ownerSub") != caller_sub:
        # Same 404 whether the upload doesn't exist or belongs to someone
        # else -- not distinguishing the two avoids confirming to a caller
        # that a given uploadId belongs to another visitor at all.
        return {"statusCode": 404, "headers": _cors_headers(), "body": json.dumps({"error": "Upload not found."})}

    return {
        "statusCode": 200,
        "headers": _cors_headers(),
        "body": json.dumps(
            {
                "uploadId": item["uploadId"],
                "status": item.get("status"),
                "filename": item.get("filename"),
                "createdAt": item.get("createdAt"),
                "updatedAt": item.get("updatedAt"),
            }
        ),
    }
