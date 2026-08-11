# McGinnis Architecture — AWS Solutions Architect Portfolio

A hands-on AWS cloud architecture portfolio containing the static website, serverless application code, AWS SAM infrastructure templates, and technical documentation behind the projects featured on McGinnis Architecture.

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

Each project has an independent AWS SAM template under its `infrastructure/` folder:

```bash
cd projects/<project-name>/infrastructure
sam build
sam deploy --guided
```

After deployment, copy the relevant stack output into that project's `frontend/config.js`, then publish the static files to the paths documented in [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md). The HTML intentionally retains the production-relative URLs used by the deployed website.

For the static hosting layer, upload `website/404.html` with the other website files and configure CloudFront custom error responses so missing objects return `/404.html` with an HTTP 404 status. With a private S3 origin, configure both 403 and 404 origin responses because a missing object can surface as either response depending on the origin setup.

## Security and operational notes

- Browser-side `config.js` values are public by nature and must not contain secrets.
- AWS credentials, local SAM build output, environment files, and deployment configuration are excluded through `.gitignore`.
- The SNS fan-out API includes API Gateway throttling, DynamoDB TTL, and an SQS dead-letter queue.
- SES identities and any sandbox recipients must be verified before email-based demonstrations will work.
- The custom 404 page uses `noindex` so search engines do not index error responses as normal content.

## License

The source code is available under the [MIT License](LICENSE). Personal branding, logos, custom graphics, and portfolio identity assets remain the property of their owner and are not granted for reuse by the MIT license.
