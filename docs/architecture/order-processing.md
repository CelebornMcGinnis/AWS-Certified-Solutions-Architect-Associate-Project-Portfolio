# Order Processing — Architecture

Companion guide for `order-processing.drawio`.

Reflects the actual CDK stack in `cdk/lib/order-processing-stack.ts`. Unlike
`workflow-visualizer`'s state machine (a single happy-path progression), this one
demonstrates Step Functions' other signature strength: a **Saga-style compensating
transaction**.

## Flow

1. **Website Visitor** calls **Amazon API Gateway** `POST /orders`. The
   `CreateOrderFunction` Lambda writes the order to **Amazon DynamoDB**
   (`OrdersTable`) and starts the **AWS Step Functions** state machine.
2. **Reserve Inventory** (Lambda task) decrements stock in a separate `InventoryTable`.
   If insufficient stock, the state machine branches straight to `FAILED` — no
   compensation needed, since nothing was reserved.
3. **Charge Payment** (Lambda task) runs next. A visitor can opt in to a simulated
   payment failure. If payment fails **after** inventory was already reserved, the
   state machine runs **Release Inventory** (undoing the reservation) before marking
   the order `FAILED` — this is the compensating transaction.
4. On success, the order is marked `SHIPPED` directly via a `DynamoUpdateItem` task —
   same native-integration pattern as `workflow-visualizer`, no Lambda glue for the
   final status write.
5. Each task Lambda returns an ordinary `{success, reason}` payload rather than
   raising on a business failure — out-of-stock and a declined payment are expected
   outcomes here, branched on with a Step Functions `Choice` state, not ASL-level
   error handling.

The diagram simplifies this to a single "Order Saga" node between Lambda and
DynamoDB — the real state machine has three task Lambdas (reserve, charge, release)
plus branching logic, shown above.

## Services

| Service | Role |
|---|---|
| Amazon API Gateway | HTTP API for catalog, order creation, order status |
| AWS Lambda | Reserve/charge/release Step Functions tasks, plus API-facing create/get/list/reset-inventory handlers |
| AWS Step Functions | Standard workflow implementing the reserve→charge→ship saga with compensation |
| Amazon DynamoDB | `OrdersTable` (+`OwnerIndex` GSI) and a separate `InventoryTable` |

## Key design decisions

- **Compensation only where it's actually needed.** Insufficient stock short-circuits
  before any compensating action is required; a declined payment does need one,
  since inventory was already reserved by that point.
- **Business failures are data, not exceptions.** Task Lambdas return
  `{success: false, reason}` and let a Step Functions `Choice` state branch on it,
  rather than throwing and relying on ASL retry/catch semantics for an expected
  outcome.
- **A visitor can reset inventory.** `POST /inventory/reset` restores every product's
  stock to its catalog default, so testing the failure paths doesn't lock out
  further orders for anyone else on the shared demo.
- **No real orders or stock — full teardown.** Both stages use `RemovalPolicy.DESTROY`.
