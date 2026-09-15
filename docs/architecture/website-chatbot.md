# Website Chatbot — Architecture

Companion guide for `website-chatbot.drawio`.

Reflects the actual CDK stack in `cdk/lib/website-chatbot-stack.ts`. Auth is a
**shared Cognito user pool** with `moderated-image-gallery` (`SharedAuthStack`) — one
account signs in to both projects.

## Flow

1. **Website Visitor** signs in via the shared **Amazon Cognito** user pool, then calls
   **Amazon API Gateway** (JWT-authorized) `POST /chat`.
2. The `ChatFunction` Lambda first tries a small deterministic FAQ layer in code; if
   that doesn't answer, it calls **Amazon Bedrock** `InvokeModel` (Nova Lite, via
   inference profile `us.amazon.nova-lite-v1:0`) through a **Bedrock Guardrail**
   (`ApplyGuardrail`) — content filters for the standard harm categories plus one
   denied topic (financial/investment advice), invoked at its `DRAFT` version rather
   than a published numbered version.
3. The response always reports which path answered it — `faq`, `ai`, or `guardrail`
   if the guardrail itself blocked the request — so the UI never implies every answer
   came from the same place.
4. Every message (visitor's and assistant's) is written to **Amazon DynamoDB**
   (`ConversationsTable`, partitioned by `ownerSub`) with a 24-hour TTL attribute —
   conversation history expires on its own, no cleanup job.
5. `GET /chat/history` (also JWT-authorized) reads it back via a second Lambda.

The browser never talks to Bedrock directly — `ChatFunction` is the only thing
holding Bedrock permissions.

## Services

| Service | Role |
|---|---|
| Amazon Cognito | Shared user pool (with `moderated-image-gallery`) for sign-in |
| Amazon API Gateway | HTTP API, both routes JWT-authorized |
| AWS Lambda | `ChatFunction` (FAQ + Bedrock) and `HistoryFunction` |
| Amazon Bedrock | Nova Lite inference profile, invoked through a Guardrail |
| Amazon DynamoDB | `ConversationsTable`, TTL-expired after 24 hours |

## Key design decisions

- **A deterministic FAQ layer answers first.** Only questions it can't handle reach
  Bedrock — cheaper, faster, and the response always discloses which path (`faq` vs
  `ai`) actually answered.
- **The guardrail's denied topic is deliberately easy to demo.** "What stock should I
  buy?" visibly gets blocked without needing to type anything actually offensive to
  prove the content filters exist.
- **TTL, not a cleanup job.** Every message carries a DynamoDB TTL attribute — history
  is genuinely short-lived by table configuration, not by a scheduled deletion.
- **No real data, full teardown.** Both stages use `RemovalPolicy.DESTROY`.
