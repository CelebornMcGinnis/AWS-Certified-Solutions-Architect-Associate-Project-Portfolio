# Contact Form API — Production Architecture

Companion guide for `contact-form-api.drawio`.

This reflects the **live prod resources** as defined in `cdk/lib/contact-form-stack.ts`
and adopted via `cdk import` (see `cdk/import-maps/contact-form-api.json`) — not the
older, aspirational flow in `contact-form-api.mmd`, which shows a `POST /contact` route
that no longer matches what's actually deployed. The real route is `/prj1_call_SES` on
a stage literally named `default`.

`stage: 'beta'` deploys this exact same shape as a **completely separate stack** — its
own Lambda, IAM role, and API Gateway, wired only to the beta site origin
(`betaweb.mcginnisarchitecture.com`). Nothing is shared between prod and beta.

## Flow

1. **Website Visitor** loads the contact page from **Amazon CloudFront**, serving
   `mcginnisarchitecture.com`.
2. CloudFront's origin is an **Amazon S3** bucket holding the static site content. Both
   of these are *imported, shared infrastructure* owned by the portfolio's
   `WebsiteStack` — the contact-form stack doesn't create or manage them.
3. The page's JS submits the form via `POST` to **Amazon API Gateway** (HTTP API
   `prj1_call_SES-API`, stage `default`), on routes `GET/POST/ANY/OPTIONS /prj1_call_SES`.
   CORS is restricted to `https://mcginnisarchitecture.com`.
4. API Gateway's `AWS_PROXY` integration invokes **AWS Lambda** function
   `prj1_call_SES` (Python 3.12, 128 MB, 3s timeout).
5. The Lambda's **IAM execution role** grants `AWSLambdaBasicExecutionRole` (imported
   customer-managed copy, matched by exact ARN) plus `AmazonSESFullAccess`.
6. The Lambda calls **Amazon SES** `SendEmail` using a verified sender identity.
7. SES delivers the message to the **owner's inbox** (external, outside the AWS Cloud
   boundary — this is a personal mailbox, not an AWS resource).
8. The Lambda also writes execution logs to **Amazon CloudWatch Logs** (secondary path,
   shown below the main flow).

## Services

| Service | Role |
|---|---|
| Amazon CloudFront | CDN serving the static site (imported from `WebsiteStack`) |
| Amazon S3 | Static site origin bucket (imported from `WebsiteStack`) |
| Amazon API Gateway | HTTP API entry point for the contact form's POST request |
| AWS Lambda | `prj1_call_SES` — validates input and sends the email |
| AWS IAM | Execution role scoping the Lambda to SES + basic CloudWatch logging |
| Amazon SES | Sends the email from a verified domain identity |
| Amazon CloudWatch Logs | Captures Lambda execution logs |

## Key design decisions

- **Prod resources are hand-imported, not created fresh.** The stack uses L1 (`Cfn*`)
  constructs deliberately, to match the console-created originals exactly for
  `cdk import` — this is why the IAM policy ARN is pinned to a specific
  auto-generated policy id rather than using a clean managed-policy reference.
- **`RemovalPolicy.RETAIN` on prod, `DESTROY` on beta.** Prod resources keep a safety
  net a stack delete can't override; beta's are disposable by design.
- **DNS and SES domain verification are managed outside this CDK app entirely** — the
  `mcginnisarchitecture.com` hosted zone, SES domain/DKIM verification, the
  `no-reply.mcginnisarchitecture.com` custom MAIL FROM domain's MX/SPF, and the
  `_dmarc` policy were all set up by hand via the AWS console/CLI. `SES_FROM_ADDRESS`
  and `SES_TO_ADDRESS` (`cdk/lib/config.ts`) are the only email-related values CDK
  actually owns. Verify deliverability directly against the live account
  (`aws ses get-identity-*`, `aws route53 list-resource-record-sets`), not by reading
  this repo.
