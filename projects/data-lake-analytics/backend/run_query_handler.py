"""Lambda handler for POST /query.

Reference implementation only -- see this project's README for why the
corresponding CDK stack (cdk/lib/data-lake-analytics-stack.ts) is never
actually deployed. If it were, this handler would map a preset query id
to a real SQL string and kick off an asynchronous Athena query against
the Glue Data Catalog, scoped to a dedicated workgroup so results land in
a known S3 prefix and per-query data-scanned limits are enforced.
"""
import json
import os
import uuid

import boto3
from botocore.exceptions import ClientError

athena = boto3.client("athena")

WORKGROUP_NAME = os.environ.get("WORKGROUP_NAME")
GLUE_DATABASE = os.environ.get("GLUE_DATABASE")
GLUE_TABLE = os.environ.get("GLUE_TABLE")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]

# A fixed set of preset queries, not an open SQL input -- a public,
# unauthenticated endpoint that ran arbitrary visitor-supplied SQL against
# a real Athena workgroup would have no cost ceiling.
PRESET_QUERIES = {
    "byCategory": "SELECT category, COUNT(*) AS orders, SUM(units) AS units FROM {table} GROUP BY category ORDER BY units DESC",
    "byRegion": "SELECT region, SUM(revenue) AS revenue FROM {table} GROUP BY region ORDER BY revenue DESC",
    "topProducts": "SELECT product, SUM(units) AS units FROM {table} GROUP BY product ORDER BY units DESC",
}


def _resolve_origin(event):
    if "*" in ALLOWED_ORIGINS:
        return "*"
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        return origin
    return ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "*"


def _cors_headers(event):
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": _resolve_origin(event),
        "Vary": "Origin",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(event, 400, {"error": "Request body must be valid JSON."})

    query_id = payload.get("queryId")
    template = PRESET_QUERIES.get(query_id)
    if not template:
        return _respond(event, 400, {"error": "Unknown queryId. Expected one of: " + ", ".join(PRESET_QUERIES)})

    sql = template.format(table=f"{GLUE_DATABASE}.{GLUE_TABLE}")
    client_request_token = uuid.uuid4().hex

    try:
        result = athena.start_query_execution(
            QueryString=sql,
            QueryExecutionContext={"Database": GLUE_DATABASE},
            WorkGroup=WORKGROUP_NAME,
            ClientRequestToken=client_request_token,
        )
    except ClientError as err:
        print(f"StartQueryExecution failed for queryId={query_id}: {err}")
        return _respond(event, 502, {"error": "Couldn't start the query. Please try again."})

    return _respond(event, 202, {"queryExecutionId": result["QueryExecutionId"], "queryId": query_id})
