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
