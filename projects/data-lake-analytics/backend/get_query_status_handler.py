"""Lambda handler for GET /query/{queryExecutionId}.

Reference implementation only -- see this project's README for why the
corresponding CDK stack (cdk/lib/data-lake-analytics-stack.ts) is never
actually deployed. If it were, this handler would poll an Athena query
execution's status and, once it succeeds, translate its column-oriented
result set into the same {columns, rows} shape the frontend already
renders for the client-side demo.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

athena = boto3.client("athena")

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "*").split(",") if o.strip()]


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
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _respond(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body),
    }


def _rows_from_result_set(result_set):
    rows = result_set.get("Rows", [])
    if not rows:
        return [], []
    columns = [cell.get("VarCharValue", "") for cell in rows[0].get("Data", [])]
    data_rows = []
    for row in rows[1:]:
        data_rows.append([cell.get("VarCharValue", "") for cell in row.get("Data", [])])
    return columns, data_rows


def lambda_handler(event, context):
    query_execution_id = (event.get("pathParameters") or {}).get("queryExecutionId")
    if not query_execution_id:
        return _respond(event, 400, {"error": "queryExecutionId is required."})

    try:
        execution = athena.get_query_execution(QueryExecutionId=query_execution_id)
    except ClientError as err:
        print(f"GetQueryExecution failed for {query_execution_id}: {err}")
        return _respond(event, 404, {"error": "Query execution not found."})

    state = execution["QueryExecution"]["Status"]["State"]
    if state in ("QUEUED", "RUNNING"):
        return _respond(event, 200, {"state": state})
    if state in ("FAILED", "CANCELLED"):
        reason = execution["QueryExecution"]["Status"].get("StateChangeReason", "Query did not complete.")
        return _respond(event, 200, {"state": state, "error": reason})

    try:
        results = athena.get_query_results(QueryExecutionId=query_execution_id)
    except ClientError as err:
        print(f"GetQueryResults failed for {query_execution_id}: {err}")
        return _respond(event, 502, {"error": "Query succeeded but results couldn't be read."})

    columns, rows = _rows_from_result_set(results["ResultSet"])
    return _respond(event, 200, {"state": state, "columns": columns, "rows": rows})
