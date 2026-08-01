# McGinnis Architecture — AWS Solutions Architect Portfolio

A portfolio of hands-on AWS cloud architecture projects designed, deployed, and documented to demonstrate practical solutions aligned with AWS Certified Solutions Architect – Associate concepts. This repository contains the static portfolio website, serverless application code, AWS SAM infrastructure templates, and architecture documentation for each project.

## Repository Description

A full-stack AWS cloud architecture portfolio showcasing deployed serverless solutions built with services such as Amazon API Gateway, AWS Lambda, Amazon SES, Amazon DynamoDB, Amazon S3, Amazon CloudFront, and Amazon Route 53. The repository supports a public portfolio website and individual project implementations that demonstrate architecture design, infrastructure as code, frontend integration, and operational documentation.

## Portfolio Contents

| Area | Description |
| --- | --- |
| `website/` | Static portfolio website files and visual assets used for the public McGinnis Architecture site. |
| `projects/contact-form-api/` | Serverless contact form solution using API Gateway, Lambda, and SES. |
| `projects/realtime-polling-app/` | Real-time polling application using API Gateway WebSockets, Lambda, DynamoDB, and SES. |
| `docs/architecture/` | Mermaid architecture diagrams for the overall site and each solution. |
| `archive/` | Prior development snapshots retained for reference only. |

## Featured Projects

### Contact Form API

A serverless contact form backend that receives form submissions from the static website, validates input in Lambda, and sends notifications through Amazon SES.

**AWS services used:** API Gateway HTTP API, Lambda, SES, IAM, CloudWatch Logs

**Project path:** `projects/contact-form-api/`

### Real-Time Polling App

A WebSocket-based polling solution that lets users submit live votes, synchronizes vote totals across connected clients, stores state in DynamoDB, and sends owner notifications through SES.

**AWS services used:** API Gateway WebSocket API, Lambda, DynamoDB, SES, IAM, CloudWatch Logs

**Project path:** `projects/realtime-polling-app/`

## Repository Structure

```text
.
├── README.md
├── PROJECT_STRUCTURE.md
├── .gitignore
├── website/
│   ├── index.html
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
│   └── realtime-polling-app/
│       ├── frontend/
│       ├── backend/
│       ├── infrastructure/
│       ├── docs/
│       └── README.md
├── docs/
│   └── architecture/
└── archive/
```

## Architecture Diagrams

- Overall portfolio architecture: `docs/architecture/portfolio-site.mmd`
- Contact form architecture: `docs/architecture/contact-form-api.mmd`
- Real-time polling architecture: `docs/architecture/realtime-polling-app.mmd`

The diagrams are written in Mermaid so they render directly in GitHub Markdown.

## Deployment Notes

Each project contains its own infrastructure template under `infrastructure/template.yaml`. The templates are written for AWS SAM and can be deployed independently.

General deployment flow:

```bash
cd projects/<project-name>/infrastructure
sam build
sam deploy --guided
```

After deployment, copy the relevant API output value into the corresponding frontend `config.js` file, then redeploy or re-upload the static website assets.

## Purpose

This repository is intended to show the work behind the portfolio, not just the final webpage. It demonstrates how individual AWS services can be combined into practical, user-facing cloud solutions with clear architecture, organized source code, infrastructure as code, and project-level documentation.
