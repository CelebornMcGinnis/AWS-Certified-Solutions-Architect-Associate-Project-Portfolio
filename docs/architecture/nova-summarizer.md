# Nova Lite Summarizer — Architecture

Companion guide for `nova-summarizer.drawio`.

Reflects the actual CDK stack in `cdk/lib/nova-summarizer-stack.ts` — the first
GenAI project on this site, and a public, unauthenticated one backed by a real
foundation-model call, which is a genuine cost risk if left unguarded.

## Flow

1. **Website Visitor** pastes text and calls **Amazon API Gateway** (HTTP API)
   `POST /summarize`.
2. The `$default` stage applies **rate/burst throttling** (2 req/s, burst 5) before
   Lambda ever runs — this stops a rapid burst of requests outright.
3. The `SummarizeFunction` Lambda checks and atomically increments a **daily request
   counter** in **Amazon DynamoDB** (`UsageTable`, keyed by date) — this is a second,
   independent limit (200/day prod, 50/day beta) that catches a slow, sustained
   trickle of requests that per-second throttling can't.
4. If under budget, the Lambda calls **Amazon Bedrock** `InvokeModel` against Nova
   Lite, via its cross-region **inference profile** id
   (`us.amazon.nova-lite-v1:0`) rather than a bare foundation-model id — Bedrock
   requires this for on-demand throughput on newer model families.
5. The summary is returned directly in the API response.

## Services

| Service | Role |
|---|---|
| Amazon API Gateway | HTTP API with stage-level rate/burst throttling |
| AWS Lambda | `SummarizeFunction` — checks/increments budget, calls Bedrock |
| Amazon Bedrock | Nova Lite inference profile for text summarization |
| Amazon DynamoDB | `UsageTable` — one row per day, atomically incremented |

## Key design decisions

- **Two independent limits, not one.** API Gateway throttling stops bursts;
  the DynamoDB daily counter stops sustained trickle abuse — neither alone covers
  both failure modes for a public, unpaid foundation-model endpoint.
- **Wildcard resource on the Bedrock IAM permission, not a pinned model ARN.** An
  inference profile routes a single invocation across whichever underlying regional
  model ARNs it currently maps to, so scoping to one region's ARN would be both
  fragile and incomplete (same reasoning the Rekognition permission in
  `moderated-image-gallery` uses).
- **No real data, full teardown.** The usage table is just a rolling daily counter,
  so both stages use `RemovalPolicy.DESTROY`.
