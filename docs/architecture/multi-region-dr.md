# Multi-Region Disaster Recovery — Architecture

Companion guide for `multi-region-dr.drawio`.

**Reference architecture only.** Reflects `cdk/lib/multi-region-dr-stack.ts`, which is
real, `cdk synth`-checked, compilable code — but it is deliberately **never
instantiated** in `cdk/bin/portfolio.ts`. Running a second region continuously (even
at the cheapest "pilot light" posture) costs real money whether or not a failover
ever happens, which isn't justified for a portfolio demo.

## What the code actually models vs. what the diagram shows

The stack as written models **one region's half** of a two-region failover pair (the
primary) — it is not two full parallel stacks. A real deployment would instantiate
this same stack twice (once per region), each pointed at a DynamoDB **Global Table**
replica local to that region, with Route 53 holding one `PRIMARY` and one `SECONDARY`
record set. The diagram shows that intended two-region end state for clarity; the code
itself only builds the primary side plus the health check.

## Flow (as coded)

1. `GET /failover-state` and `POST /failover-state/simulate` (Lambda-backed, behind
   **Amazon API Gateway**) read/write a `FailoverStateTable` in **Amazon DynamoDB** —
   kept single-region here since the stack is never actually deployed to a second
   region; a real deployment would use `replicationRegions` for a true Global Table.
2. **Only for the `prod` stage**, the stack also creates a **Route 53** HTTPS health
   check against `/failover-state` and a `PRIMARY` failover `ARecord`. Beta skips this
   — a health check against a beta endpoint that's never deployed would just sit
   permanently unhealthy.
3. The failover record's target is `192.0.2.1`, the RFC 5737 TEST-NET-1 address
   reserved for documentation — it can't collide with a real address and is never
   actually resolved by anyone, since an `HttpApi` has no built-in Route 53 alias
   target the way a CloudFront distribution or ALB does.

## Services

| Service | Role |
|---|---|
| Amazon Route 53 | Health check + `PRIMARY` failover record (prod stage only) |
| Amazon API Gateway | HTTP API for failover-state read/simulate |
| AWS Lambda | Get/trigger-failover handlers |
| Amazon DynamoDB | `FailoverStateTable` (single-region here; Global Table in a real deployment) |

## Key design decisions

- **Never deployed, by design** — a second always-on region is the specific cost this
  demo avoids, independent of how cheap any individual resource is.
- **Health check and failover record are prod-only.** Wiring them up for a
  never-deployed beta endpoint would just create a permanently-failing health check.
- **The failover target is a reserved test address**, not a placeholder that could
  accidentally resolve to something real if this were ever deployed as-is.
