# Repository Structure and File Mapping

This repository separates the public website, project-specific frontend code, Lambda source, infrastructure as code, and architecture documentation. The layout is optimized for GitHub review while preserving the production-relative paths used by the deployed static site.

## Root

```text
/
├── README.md
├── PROJECT_STRUCTURE.md
├── LICENSE
├── .gitignore
├── website/
├── projects/
└── docs/
```

| File | Purpose |
| --- | --- |
| `README.md` | Portfolio overview, featured projects, architecture links, and deployment guidance. |
| `PROJECT_STRUCTURE.md` | Repository layout and source-to-production mapping. |
| `LICENSE` | MIT license for source code, subject to the branding notice in the README. |
| `.gitignore` | Excludes local files, credentials, SAM artifacts, virtual environments, logs, and ZIP savepoints. |

## Website

```text
website/
├── README.md
├── index.html
├── 404.html
├── styles.css
└── assets/
    ├── favicon.png
    ├── github.png
    ├── heart-badge.png
    ├── linkedin.png
    ├── logo.png
    ├── logo_darkmode.png
    ├── aws-icons/
    │   ├── apigateway.png
    │   ├── cloudfront.png
    │   ├── dynamodb.png
    │   ├── lambda.png
    │   ├── route53.png
    │   ├── s3.png
    │   ├── ses.png
    │   ├── sns.png
    │   └── sqs.png
    └── badges/
        ├── cloud-essentials-training.png
        ├── cloud-practitioner.png
        ├── solutions-architect-associate.png
        └── well-architected-proficient.png
```

### Website source mapping

| Website savepoint path | Repository path | Production path |
| --- | --- | --- |
| `index.html` | `website/index.html` | `/index.html` |
| `404.html` | `website/404.html` | `/404.html` |
| `styles.css` | `website/styles.css` | `/styles.css` |
| `assets/*` | `website/assets/*` | `/assets/*` |

The current site includes dark mode, social links, SNS/SQS service icons, responsive desktop and mobile navigation, project-page section links, and a custom 404 page. The page markup keeps absolute production URLs where needed so the same files can be deployed under the public paths shown above.

For CloudFront, configure custom error responses for origin codes `403` and `404`, serve `/404.html`, and return HTTP status `404`. The 403 mapping is important for private S3 origins because a missing object can be reported as 403 rather than 404.

## Contact Form API

```text
projects/contact-form-api/
├── README.md
├── frontend/
│   ├── index.html
│   ├── success.html
│   ├── script.js
│   └── config.js
├── backend/
│   ├── lambda_function.py
│   └── requirements.txt
├── infrastructure/
│   └── template.yaml
└── docs/
    └── architecture.mmd
```

| Website savepoint path | Repository path | Production path |
| --- | --- | --- |
| `project/contactform/project1.html` | `projects/contact-form-api/frontend/index.html` | `/project/contactform/project1.html` |
| `project/contactform/success.html` | `projects/contact-form-api/frontend/success.html` | `/project/contactform/success.html` |
| `project/contactform/script.js` | `projects/contact-form-api/frontend/script.js` | `/project/contactform/script.js` |
| `project/contactform/config.js` | `projects/contact-form-api/frontend/config.js` | `/project/contactform/config.js` |
| `project/contactform/lambda_function.py` | `projects/contact-form-api/backend/lambda_function.py` | Lambda deployment package |
| `project/contactform/requirements.txt` | `projects/contact-form-api/backend/requirements.txt` | Lambda deployment package |
| `project/contactform/template.yaml` | `projects/contact-form-api/infrastructure/template.yaml` | AWS SAM template |

The infrastructure template intentionally uses `CodeUri: ../backend/` because it lives in a separate `infrastructure/` folder.

## Real-Time Polling App

```text
projects/realtime-polling-app/
├── README.md
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── config.js
├── backend/
│   ├── vote_handler.py
│   ├── on_connect.py
│   ├── on_disconnect.py
│   ├── email_utils.py
│   └── requirements.txt
├── infrastructure/
│   └── template.yaml
└── docs/
    └── architecture.mmd
```

| Website savepoint path | Repository path | Production path |
| --- | --- | --- |
| `project/polling/project2.html` | `projects/realtime-polling-app/frontend/index.html` | `/project/polling/project2.html` |
| `project/polling/script.js` | `projects/realtime-polling-app/frontend/script.js` | `/project/polling/script.js` |
| `project/polling/config.js` | `projects/realtime-polling-app/frontend/config.js` | `/project/polling/config.js` |
| `project/polling/*.py` | `projects/realtime-polling-app/backend/*.py` | Lambda deployment package |
| `project/polling/requirements.txt` | `projects/realtime-polling-app/backend/requirements.txt` | Lambda deployment package |
| `project/polling/template.yaml` | `projects/realtime-polling-app/infrastructure/template.yaml` | AWS SAM template |

The infrastructure template intentionally uses `CodeUri: ../backend/` for each function.

## SNS Notification Fan-Out

```text
projects/sns-notification-fan-out/
├── README.md
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── config.js
├── backend/
│   ├── publish_handler.py
│   ├── notify_handler.py
│   ├── log_handler.py
│   ├── recent_handler.py
│   └── requirements.txt
├── infrastructure/
│   └── template.yaml
└── docs/
    └── architecture.mmd
```

| Website savepoint path | Repository path | Production path |
| --- | --- | --- |
| `project/fanningsns/project3.html` | `projects/sns-notification-fan-out/frontend/index.html` | `/project/fanningsns/project3.html` |
| `project/fanningsns/script.js` | `projects/sns-notification-fan-out/frontend/script.js` | `/project/fanningsns/script.js` |
| `project/fanningsns/config.js` | `projects/sns-notification-fan-out/frontend/config.js` | `/project/fanningsns/config.js` |
| `project/fanningsns/*.py` | `projects/sns-notification-fan-out/backend/*.py` | Lambda deployment package |
| `project/fanningsns/requirements.txt` | `projects/sns-notification-fan-out/backend/requirements.txt` | Lambda deployment package |
| `project/fanningsns/template.yaml` | `projects/sns-notification-fan-out/infrastructure/template.yaml` | AWS SAM template |

The repository name is more descriptive than the original working folder name. Existing deployed Lambda function names beginning with `fanningsns-` are retained to avoid unnecessary resource replacement. The infrastructure template uses `CodeUri: ../backend/` for the repository layout.

## Reference-only projects (beta only, never deployed)

Five projects exist purely as documented, compilable architecture and demo code, and are intentionally never deployed to AWS: each has a real `cdk/lib/<name>-stack.ts` that is never imported by `cdk/bin/portfolio.ts`, so `cdk deploy` can never touch it, and a frontend with zero backend calls — no `config.js`, no `fetch()`/XHR anywhere, every "demo" interaction simulated client-side in `script.js`. They ship to the beta site only (`stages: ['beta']` in `cdk/lib/website-content.ts`), never to prod, and are labeled with a distinct "Reference build" badge on the homepage and an in-page disclaimer so the site never implies they're actually running.

Unlike the six newest live projects below (`workflow-visualizer` onward, which have no `README.md`/`docs/` because their real deployed backend is the documentation), these five keep a `README.md` with an embedded Mermaid architecture diagram — a deliberate exception, since there's no live backend to explore in place of it.

```text
projects/<name>/
├── README.md
├── frontend/
│   ├── index.html
│   └── script.js
├── backend/
│   ├── *.py
│   └── requirements.txt
└── homepage-card.html
```

| Project folder | Production path | Stack file | Purpose |
| --- | --- | --- | --- |
| `projects/multi-region-dr` | `/project/dr/index.html` | `cdk/lib/multi-region-dr-stack.ts` | Pilot light / warm standby / active-active failover across two regions |
| `projects/data-lake-analytics` | `/project/datalake/index.html` | `cdk/lib/data-lake-analytics-stack.ts` | S3 → Glue → Athena → QuickSight analytics pipeline |
| `projects/container-orchestration` | `/project/containers/index.html` | `cdk/lib/container-orchestration-stack.ts` | ECS Fargate rolling/blue-green deployment pipeline |
| `projects/vpc-network-design` | `/project/vpc/index.html` | `cdk/lib/vpc-network-design-stack.ts` | Multi-tier VPC: public/private/isolated subnets, NAT, route tables, security groups |
| `projects/realtime-ops-dashboard` | `/project/opsdash/index.html` | `cdk/lib/realtime-ops-dashboard-stack.ts` | Kinesis Data Streams → Lambda aggregation → DynamoDB rollups → live dashboard |

Note: the six newest CDK-based projects (`workflow-visualizer`, `moderated-image-gallery`, `habit-tracker`, `nova-summarizer`, `order-processing`, `website-chatbot`) don't have a section in this document — that's drift, not a rule, since their infrastructure lives entirely in `cdk/lib/*.ts` rather than a per-project `infrastructure/template.yaml`. These five reference-only projects get a section here because their defining trait — a real stack file that's deliberately never wired into `bin/portfolio.ts` — is exactly the kind of thing a future reader can't discover just by browsing `cdk/lib/`.

## Architecture documentation

```text
docs/architecture/
├── README.md
├── portfolio-site.mmd
├── contact-form-api.mmd
├── realtime-polling-app.mmd
└── sns-notification-fan-out.mmd
```

The portfolio diagram includes the static hosting path and CloudFront custom error response flow. Each project also keeps a copy of its project diagram at `projects/<project-name>/docs/architecture.mmd` so the documentation remains self-contained.

No additional project-specific Mermaid file was needed for the August 11 website update because the Lambda, API, storage, and messaging architectures did not change. The existing portfolio diagram was updated for the new 404 path.

## Files intentionally not committed

```text
.DS_Store
__MACOSX/
*.zip
.aws-sam/
samconfig.toml
.env
.env.*
.aws/
__pycache__/
.venv/
node_modules/
*.log
```

Savepoint ZIP files should remain outside the repository. Git history already provides versioned checkpoints for committed work.
