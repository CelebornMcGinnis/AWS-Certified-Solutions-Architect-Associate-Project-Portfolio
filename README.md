# McGinnis Architecture — AWS Solutions Architect Portfolio

A hands-on AWS cloud architecture portfolio: the static website, the serverless code behind each project, the AWS CDK app that deploys all of it, and the architecture documentation. Live at [mcginnisarchitecture.com](https://mcginnisarchitecture.com).

## Repository description

A full-stack AWS cloud solutions portfolio showcasing deployed serverless architectures built with Amazon API Gateway, AWS Lambda, Amazon SNS, Amazon SQS, Amazon SES, Amazon DynamoDB, Amazon S3, Amazon CloudFront, Amazon Route 53, Amazon Cognito, Amazon Bedrock, AWS Step Functions, and related services. The projects demonstrate infrastructure as code, event-driven design, real-time communication, frontend-to-cloud integration, reliability controls, and operational documentation aligned with AWS Certified Solutions Architect – Associate concepts.

## Portfolio contents

| Area | Description |
| --- | --- |
| [`website/`](website/) | Homepage, custom 404 page, shared stylesheet, branding, AWS service icons, certification badges, and social assets. |
| [`projects/`](projects/) | One folder per project: `frontend/` (the page and its script), usually `backend/` (Lambda source), and a `homepage-card.html` fragment. |
| [`cdk/`](cdk/) | The single AWS CDK app that hosts the site and deploys every project backend, in two independent stages (beta and prod). |
| [`docs/architecture/`](docs/architecture/) | Architecture diagrams: draw.io sources for most projects, Mermaid for the original three. |
| [`.github/workflows/`](.github/workflows/) | The deploy and pull-request workflows. |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | Detailed layout and how project folders map to site URLs. |

## Projects

### Live backends (deployed to AWS in both stages)

| Project | What it shows | Key services |
| --- | --- | --- |
| Contact Form API | Serverless form backend with anti-spam controls | API Gateway, Lambda, SES |
| Real-Time Polling App | WebSocket poll with live result sync | API Gateway WebSocket, Lambda, DynamoDB, SES |
| SNS Notification Fan-Out | One event, two independent delivery branches | SNS, SQS, Lambda, SES, DynamoDB |
| Workflow Visualizer | A state machine whose execution is drawn live | Step Functions, Lambda, DynamoDB |
| Moderated Image Gallery | Upload, automated moderation, approved gallery behind login | S3, Rekognition, Cognito, Lambda |
| Habit Tracker | Anonymous, device-local habit data with a daily scheduled streak reset | API Gateway, Lambda, DynamoDB, EventBridge Scheduler |
| Nova Summarizer | Text summarization with a foundation model | Bedrock, Lambda, API Gateway |
| Order Processing | Multi-step order workflow orchestrated as a state machine | Step Functions, Lambda, DynamoDB |
| Website Chatbot | A site assistant with a login-gated limit | Bedrock, Cognito, Lambda, DynamoDB |

### Showcase and reference builds (no live backend)

- **LinkedIn Post Pipeline** — a simulated demo of a pipeline that drafts, queues for approval, and publishes LinkedIn posts. The real pipeline runs outside this repo; the page here is a showcase with an architecture diagram and a pricing estimate.
- **PaydayCompass** — an architecture walkthrough of a separate, real personal finance app: one overview diagram plus flows for the payday calculator, the daily recurring processor, AI auto-categorizing, and sign-in and sharing. No demo, and security is described only at a high level. The diagrams are draw.io sources in `docs/architecture/paydaycompass-*.drawio`.
- **Reference builds** — Multi-Region DR, Data Lake & Analytics, Container Orchestration, VPC Network Design, and Real-Time Ops Dashboard. Each has a real, compilable CDK stack file that is deliberately never deployed (the running cost wasn't justified for a portfolio), and a frontend that simulates everything client-side. The homepage labels them "Reference build".

Every project page ends with a "What I'd Change Next" section listing the known gaps.

## Repository structure

```text
.
├── README.md
├── PROJECT_STRUCTURE.md
├── CLAUDE.md
├── LICENSE
├── website/                 homepage, 404, styles, shared assets
├── projects/<name>/         frontend/, backend/, homepage-card.html
├── cdk/                     CDK app, build pipeline, check scripts
│   ├── bin/portfolio.ts     stack instantiation (prod + beta)
│   ├── lib/                 one stack file per project, plus the website stack
│   └── scripts/             check-dist, smoke-test, lighthouse-summary
├── docs/architecture/       diagrams
└── .github/workflows/       cdk-deploy-beta, cdk-deploy-prod, cdk-pr
```

## Deployment model

Everything deploys through the CDK app in `cdk/`, driven by GitHub Actions. There are two fully independent stages:

| Stage | Address | How it deploys |
| --- | --- | --- |
| beta | `betaweb.mcginnisarchitecture.com` | Automatically on every push to `main` that touches `cdk/`, `website/`, or `projects/` |
| prod | `mcginnisarchitecture.com` | Manually, by running the workflow and typing `deploy` to confirm |

`cdk/lib/website-content.ts` is the single registry of which projects ship to which stage. At build time it stages the site and each project's frontend, generates navigation, canonical tags, a fingerprinted stylesheet, and `robots.txt`/`sitemap.xml`. Beta is `noindex`; prod is indexable.

Each workflow checks the staged site offline before deploying (broken links, accessibility basics, content-security-policy violations) and smoke-tests the live site afterwards. Beta deploys also run a warn-only Lighthouse report, attached to the run as an artifact.

To work locally:

```bash
cd cdk
npm ci
npm run build                      # type-check
npx cdk synth portfolio-website-beta
npm run check:dist -- .website-dist-beta
```

Do not deploy with `sam deploy`. The older per-project SAM templates under `projects/*/infrastructure/` are historical and are no longer the deploy path.

## Security and operational notes

- Browser-side `config.js` values are public by nature and must not contain secrets.
- AWS credentials, environment files, and deployment configuration are excluded through `.gitignore`.
- The site sends HSTS, a strict content security policy (no inline script or style), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` headers from a CloudFront Function.
- Public demo APIs use API Gateway throttling (fan-out, summarizer), DynamoDB TTL on demo data, and an SQS dead-letter queue on the fan-out project.
- SES identities and any sandbox recipients must be verified before email-based demonstrations will work.
- The custom 404 page is served with a real 404 status and is `noindex`.

## License

The source code is available under the [MIT License](LICENSE). Personal branding, logos, custom graphics, and portfolio identity assets remain the property of their owner and are not granted for reuse by the MIT license.
