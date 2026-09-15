# Real-Time Operations Dashboard — Architecture

Companion guide for `realtime-ops-dashboard.drawio`.

**Reference architecture only.** Reflects `cdk/lib/realtime-ops-dashboard-stack.ts`,
which is real, `cdk synth`-checked, compilable code — but it is deliberately **never
instantiated** in `cdk/bin/portfolio.ts`. Kinesis bills per shard-hour regardless of
traffic (~$15–20/month minimum for one shard), which isn't justified for a portfolio
demo that would otherwise sit idle almost all the time. The live page's demo simulates
this flow client-side instead.

## Flow

1. **Producers** call `PutRecords` on an **Amazon Kinesis Data Stream** (`EventStream`,
   1 shard, 24-hour retention).
2. A **Kinesis Event Source Mapping** invokes the `AggregateEventsFunction` Lambda in
   batches (batch size 100, 2-second max batching window, 3 retry attempts, partial-
   batch-failure reporting enabled) — not a per-record invocation.
3. That Lambda writes atomic increments to **Amazon DynamoDB** (`RollupsTable`,
   partitioned by `region`).
4. **Website Visitor (dashboard)** polls `GET /rollups` via **Amazon API Gateway**,
   answered by a separate read-only `GetRollupsFunction` Lambda.

This is modeled directly on `workflow-visualizer-stack.ts`'s shape (same
stage/origin/removalPolicy pattern, same Lambda defaults) — the diagram matches the
real stack closely, with the batching/retry details of the event source mapping
omitted for readability.

## Services

| Service | Role |
|---|---|
| Amazon Kinesis Data Streams | Ingests raw events from producers, 1 shard |
| AWS Lambda | Batched aggregation consumer (event-source-mapped) plus a read-only rollups API handler |
| Amazon DynamoDB | `RollupsTable`, atomically incremented per region |
| Amazon API Gateway | HTTP API for the dashboard's `GET /rollups` poll |

## Key design decisions

- **Never deployed, by design** — the per-shard-hour Kinesis cost is the specific
  reason, independent of how idle the rest of the stack would be.
- **Batched consumption, not per-record.** The event source mapping batches up to 100
  records or 2 seconds, whichever comes first, and reports partial-batch failures so a
  single bad record doesn't fail the whole batch.
- **Read and write paths are fully separate Lambdas.** The dashboard's poll never
  touches the stream directly — it only ever reads the rollup table the aggregation
  consumer maintains.
