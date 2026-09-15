# Workflow Visualizer — Architecture

Companion guide for `workflow-visualizer.drawio`.

Reflects the actual CDK stack in `cdk/lib/workflow-visualizer-stack.ts`. This is a
greenfield stack — both `workflow-visualizer` (prod) and `workflow-visualizer-beta`
are entirely separate, freshly-created stacks with nothing shared between them.

## Flow

1. **Website Visitor** submits a job from the frontend.
2. **Amazon API Gateway** (HTTP API) routes `POST /jobs` to the `CreateJobFunction`
   Lambda.
3. That Lambda writes the initial job record to **Amazon DynamoDB** (`JobsTable`) and
   calls `StartExecution` on the **AWS Step Functions** state machine.
4. The state machine owns every status transition itself, using Step Functions' native
   DynamoDB SDK integration — `VALIDATING` → (5s wait) → `PROCESSING` → (8s wait) →
   `COMPLETE`. There is deliberately **no Lambda inside the state machine** — each
   `DynamoUpdateItem` task talks to DynamoDB directly.
5. Two read-path Lambdas (`GetJobFunction` for `GET /jobs/{jobId}`, `RecentJobsFunction`
   for `GET /jobs/recent`, backed by a `RecentIndex` GSI) let the frontend poll job
   status and list recent jobs.

The diagram simplifies this to a single "submit_job" Lambda for readability — in the
real stack, create/get/recent are three separate Lambda functions sharing one table.

## Services

| Service | Role |
|---|---|
| Amazon API Gateway | HTTP API for `POST /jobs`, `GET /jobs/{id}`, `GET /jobs/recent` |
| AWS Lambda | Create/get/list-recent handlers (Python 3.13) |
| AWS Step Functions | Standard workflow driving the VALIDATING→PROCESSING→COMPLETE transitions |
| Amazon DynamoDB | `JobsTable`, written directly by both Lambda and Step Functions |

## Key design decisions

- **No Lambda glue inside the state machine.** Every status transition is a
  `DynamoUpdateItem` task calling DynamoDB's API directly — cheaper and simpler than a
  Lambda-backed task for pure data writes.
- **Both stages destroy cleanly.** Neither prod nor beta has ever held real user data,
  so both use `RemovalPolicy.DESTROY` — no orphaned tables from a stack teardown.
