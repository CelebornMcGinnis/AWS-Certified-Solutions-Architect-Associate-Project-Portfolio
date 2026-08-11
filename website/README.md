# Portfolio Website

This folder contains the public-facing homepage, custom error page, shared stylesheet, and visual assets for the McGinnis Architecture AWS project portfolio.

## Current website features

- Responsive portfolio homepage and project cards
- Custom `404.html` page with project navigation and `noindex` metadata
- Light and dark themes with the selected theme stored in `localStorage`
- Separate light-mode and dark-mode logo assets
- Navigation to the Contact Form, Movie Poll, and SNS Notification Fan-Out projects
- Project-page “On this page” navigation for major sections
- Desktop and mobile menus that close after selection, outside clicks, or scrolling
- LinkedIn and GitHub footer links
- AWS service icons and certification badges

## Contents

```text
website/
├── index.html
├── 404.html
├── styles.css
├── README.md
└── assets/
    ├── favicon.png
    ├── github.png
    ├── heart-badge.png
    ├── linkedin.png
    ├── logo.png
    ├── logo_darkmode.png
    ├── aws-icons/
    └── badges/
```

## Recommended hosting architecture

The static website is designed for an AWS hosting path such as:

- Amazon S3 for private static object storage
- Amazon CloudFront for HTTPS, content delivery, and custom error responses
- Amazon Route 53 for DNS
- AWS Certificate Manager for the TLS certificate

Upload `404.html` to the site root. In CloudFront, map missing-object responses to `/404.html` and return HTTP status `404`. For a private S3 origin, map both origin response codes `403` and `404`, because a request for a missing object may return either code depending on the origin configuration.

See [`../docs/architecture/portfolio-site.mmd`](../docs/architecture/portfolio-site.mmd).

## Repository versus production paths

The repository stores each project's frontend beside its backend and SAM template for easier review. The deployed site uses the original static paths:

| Repository file | Production location |
| --- | --- |
| `website/index.html` | `/index.html` |
| `website/404.html` | `/404.html` |
| `website/styles.css` | `/styles.css` |
| `website/assets/*` | `/assets/*` |
| `projects/contact-form-api/frontend/*` | `/project/contactform/*` |
| `projects/realtime-polling-app/frontend/*` | `/project/polling/*` |
| `projects/sns-notification-fan-out/frontend/*` | `/project/fanningsns/*` |

The HTML intentionally retains those production-relative URLs. See [`../PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) for the complete file mapping.
