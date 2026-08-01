# Recommended GitHub Repository Structure

This file explains the cleaned repository layout and where each current file should live.

## Root

```text
/
├── README.md
├── PROJECT_STRUCTURE.md
├── .gitignore
├── website/
├── projects/
├── docs/
└── archive/
```

### Root files

| File | Purpose |
| --- | --- |
| `README.md` | Main portfolio overview for GitHub visitors. |
| `PROJECT_STRUCTURE.md` | Explains the repository organization and file mapping. |
| `.gitignore` | Keeps system files, local config, and build outputs out of Git. |

## Website

```text
website/
├── index.html
├── styles.css
├── assets/
│   ├── logo.png
│   ├── favicon.png
│   ├── heart-badge.png
│   ├── aws-icons/
│   │   ├── apigateway.png
│   │   ├── cloudfront.png
│   │   ├── dynamodb.png
│   │   ├── lambda.png
│   │   ├── route53.png
│   │   ├── s3.png
│   │   └── ses.png
│   └── badges/
│       ├── cloud-essentials-training.png
│       ├── cloud-practitioner.png
│       ├── solutions-architect-associate.png
│       └── well-architected-proficient.png
└── README.md
```

### Website file mapping

| Original file/location | New location | Rename? |
| --- | --- | --- |
| `index.html` | `website/index.html` | No |
| `styles.css` | `website/styles.css` | No |
| `assets/logo.png` | `website/assets/logo.png` | No |
| `assets/favicon.png` | `website/assets/favicon.png` | No |
| `assets/heart-badge.png` | `website/assets/heart-badge.png` | No |
| `assets/aws-icons/*` | `website/assets/aws-icons/*` | No |
| `assets/badges/*` | `website/assets/badges/*` | No |

## Contact Form API Project

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

### Contact Form API file mapping

| Original file/location | New location | Rename? |
| --- | --- | --- |
| `project/contactform/project1.html` | `projects/contact-form-api/frontend/index.html` | Yes |
| `project/contactform/success.html` | `projects/contact-form-api/frontend/success.html` | No |
| `project/contactform/script.js` | `projects/contact-form-api/frontend/script.js` | No |
| `project/contactform/config.js` | `projects/contact-form-api/frontend/config.js` | No |
| `project/contactform/lambda_function.py` | `projects/contact-form-api/backend/lambda_function.py` | No |
| `project/contactform/requirements.txt` | `projects/contact-form-api/backend/requirements.txt` | No |
| `project/contactform/template.yaml` | `projects/contact-form-api/infrastructure/template.yaml` | No, but `CodeUri` should point to `../backend/` |
| `project/contactform/README.md` | `projects/contact-form-api/README.md` | Replace with project-focused README |

## Real-Time Polling App Project

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

### Real-Time Polling App file mapping

| Original file/location | New location | Rename? |
| --- | --- | --- |
| `project/polling/project2.html` | `projects/realtime-polling-app/frontend/index.html` | Yes |
| `project/polling/script.js` | `projects/realtime-polling-app/frontend/script.js` | No |
| `project/polling/config.js` | `projects/realtime-polling-app/frontend/config.js` | No |
| `project/polling/vote_handler.py` | `projects/realtime-polling-app/backend/vote_handler.py` | No |
| `project/polling/on_connect.py` | `projects/realtime-polling-app/backend/on_connect.py` | No |
| `project/polling/on_disconnect.py` | `projects/realtime-polling-app/backend/on_disconnect.py` | No |
| `project/polling/email_utils.py` | `projects/realtime-polling-app/backend/email_utils.py` | No |
| `project/polling/requirements.txt` | `projects/realtime-polling-app/backend/requirements.txt` | No |
| `project/polling/template.yaml` | `projects/realtime-polling-app/infrastructure/template.yaml` | No, but `CodeUri` should point to `../backend/` |
| `project/polling/README.md` | `projects/realtime-polling-app/README.md` | Replace with project-focused README |

## Archive

```text
archive/
├── 20260716/
├── 20260720/
├── 20260722/
├── 20260724/
├── 20260725/
└── 20260727/
```

Use `archive/` only for meaningful checkpoints. Remove `.DS_Store`, `__MACOSX`, duplicate CSS files, and other local system files before committing.

## Recommended renames

| Current name | Recommended name | Reason |
| --- | --- | --- |
| `project/` | `projects/` | Standard plural directory for multiple projects. |
| `project/contactform/` | `projects/contact-form-api/` | Clear, readable project name. |
| `project/polling/` | `projects/realtime-polling-app/` | Explains what the app demonstrates. |
| `project1.html` | `index.html` | Each project frontend gets its own default page. |
| `project2.html` | `index.html` | Each project frontend gets its own default page. |
| `Archive/` | `archive/` | Lowercase folder names are cleaner and common in Git repos. |

## Files to avoid committing

```text
.DS_Store
__MACOSX/
.aws-sam/
samconfig.toml
.env
*.log
__pycache__/
```
