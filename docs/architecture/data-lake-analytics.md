# Data Lake & Analytics — Architecture

Companion guide for `data-lake-analytics.drawio`.

**Reference architecture only.** Reflects `cdk/lib/data-lake-analytics-stack.ts`,
which is real, `cdk synth`-checked, compilable code — but it is deliberately **never
instantiated** in `cdk/bin/portfolio.ts`. An S3 + Glue + Athena data lake is cheap at
rest, but QuickSight's per-seat licensing (~$9–24/user/month) isn't justified for a
portfolio demo that would otherwise sit idle.

## Flow

1. Raw order data lands in a **Raw Zone S3 bucket** (parquet, under `orders/`).
2. An **AWS Glue** crawler (`RawZoneCrawler`, on a daily 03:00 UTC schedule) catalogs
   it into a Glue database; a `CfnTable` also pre-declares the expected schema
   explicitly, rather than leaving it purely to crawler inference.
3. **Website Visitor** calls **Amazon API Gateway** `POST /query`. The
   `RunQueryFunction` Lambda starts an **Amazon Athena** query (`StartQueryExecution`)
   against a dedicated **Athena workgroup** — scoped to a 1 GB per-query
   data-scanned safety ceiling and its own results bucket.
4. `GET /query/{id}` polls query status/results via a second Lambda
   (`GetQueryExecution`/`GetQueryResults`).
5. **Amazon QuickSight** is shown as the dashboard layer in the diagram, but it is
   **deliberately not provisioned by this stack** — QuickSight is an account-level,
   seat-based subscription, not a per-stack resource, so a CDK construct here
   wouldn't reflect how it's actually adopted in practice.

## Services

| Service | Role |
|---|---|
| Amazon S3 | Raw zone (source parquet) and a separate query-results bucket (7-day lifecycle) |
| AWS Glue | Database + crawler + pre-declared table schema for the orders data |
| Amazon Athena | Ad-hoc SQL, scoped to a dedicated workgroup with a per-query scan cap |
| AWS Lambda | Query-start and query-status handlers, each scoped to one workgroup ARN |
| Amazon API Gateway | HTTP API fronting the two Lambdas |
| Amazon QuickSight | Dashboard layer (account-level subscription, not stack-provisioned) |

## Key design decisions

- **Never deployed, by design** — QuickSight's per-seat cost is the specific reason,
  not the data lake itself (S3 + Glue + Athena is cheap to leave idle).
- **A per-query data-scanned cutoff, not just IAM scoping.** The Athena workgroup
  enforces a 1 GB ceiling per query on top of least-privilege IAM, so even an
  authorized caller can't accidentally run up a large scan.
- **L1 Glue constructs, not an L2/alpha module.** `CfnDatabase`/`CfnCrawler`/`CfnTable`
  are what this repo's installed `aws-cdk-lib` version actually ships for Glue.
- **The table schema is pre-declared, not purely crawler-inferred** — a `CfnTable`
  documents the expected columns explicitly, so the schema this project's queries
  depend on doesn't rely solely on what the crawler happens to detect.
