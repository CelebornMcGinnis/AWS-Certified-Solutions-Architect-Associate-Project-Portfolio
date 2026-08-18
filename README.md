# McGinnis Architecture — AWS Solutions Architect Portfolio

A hands-on AWS cloud architecture portfolio containing the static website, serverless application code, an AWS CDK app that manages all of it, and technical documentation behind the projects featured on McGinnis Architecture.

## Repository description

A full-stack AWS cloud solutions portfolio showcasing deployed serverless architectures built with Amazon API Gateway, AWS Lambda, Amazon SNS, Amazon SQS, Amazon SES, Amazon DynamoDB, Amazon S3, Amazon CloudFront, Amazon Route 53, and related services. The projects demonstrate infrastructure as code, event-driven design, real-time communication, frontend-to-cloud integration, reliability controls, and operational documentation aligned with AWS Certified Solutions Architect – Associate concepts.

## Portfolio contents

| Area | Description |
| --- | --- |
| [`website/`](website/) | Public-facing portfolio homepage, custom 404 page, shared stylesheet, branding, AWS service icons, certification badges, and social assets. |
| [`projects/contact-form-api/`](projects/contact-form-api/) | Serverless contact form using API Gateway, Lambda, and SES. |
| [`projects/realtime-polling-app/`](projects/realtime-polling-app/) | WebSocket polling application using API Gateway, Lambda, DynamoDB, and SES. |
| [`projects/sns-notification-fan-out/`](projects/sns-notification-fan-out/) | Event-driven notification demo using SNS fan-out, direct Lambda delivery, an SQS-buffered branch, SES, and DynamoDB. |
| [`docs/architecture/`](docs/architecture/) | Mermaid source diagrams for the portfolio and each AWS solution. |
| [`cdk/`](cdk/) | AWS CDK (TypeScript) app that owns every AWS resource in this portfolio -- website hosting and all three project backends. |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | Detailed repository layout and production-path mapping. |

## Featured projects

### 1. Contact Form API

A low-cost serverless backend for a static contact form. API Gateway receives the browser request, Lambda validates the submission and applies anti-spam controls, and SES delivers the message to the site owner.

**AWS services:** API Gateway HTTP API, Lambda, SES, IAM, CloudWatch Logs

**Project:** [`projects/contact-form-api/`](projects/contact-form-api/)

### 2. Real-Time Polling App

A WebSocket-based movie poll that stores connections and voting state in DynamoDB, synchronizes results across connected browsers, and sends lifecycle notifications through SES.

**AWS services:** API Gateway WebSocket API, Lambda, DynamoDB, SES, IAM, CloudWatch Logs

**Project:** [`projects/realtime-polling-app/`](projects/realtime-polling-app/)

### 3. SNS Notification Fan-Out

A live event-driven demonstration in which one API request publishes a message to Amazon SNS. SNS delivers the same event to two independent branches: a directly subscribed Lambda that sends an SES email and an SQS-buffered Lambda that records delivery activity in DynamoDB. A separate read Lambda returns recent results to the browser.

**AWS services:** API Gateway HTTP API, Lambda, SNS, SQS, DynamoDB, SES, IAM, CloudWatch Logs

**Project:** [`projects/sns-notification-fan-out/`](projects/sns-notification-fan-out/)

## Repository structure

```text
.
├── README.md
├── PROJECT_STRUCTURE.md
├── LICENSE
├── .gitignore
├── .github/
│   ├── workflows/
│   │   ├── cdk-pr.yml
│   │   └── cdk-deploy.yml
│   └── dependabot.yml
├── cdk/
│   ├── bin/portfolio.ts
│   └── lib/
├── website/
│   ├── index.html
│   ├── 404.html
│   ├── styles.css
│   ├── assets/
│   └── README.md
├── projects/
│   ├── contact-form-api/
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── infrastructure/
│   │   ├── docs/
│   │   └── README.md
│   ├── realtime-polling-app/
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── infrastructure/
│   │   ├── docs/
│   │   └── README.md
│   └── sns-notification-fan-out/
│       ├── frontend/
│       ├── backend/
│       ├── infrastructure/
│       ├── docs/
│       └── README.md
└── docs/
    └── architecture/
```

## Architecture diagrams

- [Portfolio hosting, custom error routing, and project connections](docs/architecture/portfolio-site.mmd)
- [Contact Form API](docs/architecture/contact-form-api.mmd)
- [Real-Time Polling App](docs/architecture/realtime-polling-app.mmd)
- [SNS Notification Fan-Out](docs/architecture/sns-notification-fan-out.mmd)

The project READMEs embed Mermaid diagrams so GitHub can render them directly. The standalone `.mmd` files contain reusable Mermaid source; see [`docs/architecture/README.md`](docs/architecture/README.md) for preview options.

## Deployment model

All AWS infrastructure -- website hosting (S3 + CloudFront + Route 53, prod and beta) and all three project backends -- is managed by the CDK app under [`cdk/`](cdk/). Six stacks: `fanning-sns`, `live-poll`, `contact-form-api`, `portfolio-website-prod`, `portfolio-website-beta`, `portfolio-github-oidc`.

**Changes ship on merge.** Pushing to `main` (touching `cdk/`, `website/`, or `projects/**`) triggers [`.github/workflows/cdk-deploy.yml`](.github/workflows/cdk-deploy.yml), which runs `cdk deploy --all` via a GitHub Actions OIDC role -- no AWS keys stored in GitHub. A pull request touching those paths triggers [`.github/workflows/cdk-pr.yml`](.github/workflows/cdk-pr.yml), which posts a `cdk diff` comment so you can see exactly what would change before merging.

The website stacks' `BucketDeployment` construct publishes `website/` and each project's `frontend/` folder to the documented production paths and invalidates CloudFront automatically -- there's no manual `aws s3 sync` or `create-invalidation` step anymore.

To deploy by hand instead (e.g. while iterating locally):

```bash
cd cdk
npm install
npx cdk diff --all     # preview
npx cdk deploy --all   # apply
```

Each project's `infrastructure/template.yaml` is kept as a reference to the original SAM-based design; it's not what's actually deployed anymore -- the equivalent (and in a couple of cases, corrected-to-match-reality) resource definitions live in `cdk/lib/*.ts`. See [`cdk/README.md`](cdk/README.md) for the stack-to-resource mapping.

The static hosting layer's CloudFront distributions are configured with custom error responses so missing objects fall back to `index.html` (prod) with an HTTP 200, matching the deployed configuration; see the CDK stack for specifics per environment.

## Security and operational notes

- Browser-side `config.js` values are public by nature and must not contain secrets.
- AWS credentials, local SAM build output, environment files, and deployment configuration are excluded through `.gitignore`.
- GitHub Actions authenticates to AWS via OIDC (no long-lived access keys). The PR workflow's role can only read/diff; only the `main`-branch deploy workflow's role can actually change resources.
- The SNS fan-out API includes API Gateway throttling, DynamoDB TTL, and an SQS dead-letter queue.
- SES identities and any sandbox recipients must be verified before email-based demonstrations will work.
- The custom 404 page uses `noindex` so search engines do not index error responses as normal content.

## License

The source code is available under the [MIT License](LICENSE). Personal branding, logos, custom graphics, and portfolio identity assets remain the property of their owner and are not granted for reuse by the MIT license.
