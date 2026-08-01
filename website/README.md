# Portfolio Website

This folder contains the static website files for the McGinnis Architecture AWS project portfolio.

## Purpose

The website acts as the public-facing entry point for the portfolio. It presents the cloud architecture work, links to individual AWS solution pages, and visually communicates the AWS services and certifications behind the projects.

## Contents

```text
website/
├── index.html
├── styles.css
└── assets/
    ├── logo.png
    ├── favicon.png
    ├── heart-badge.png
    ├── aws-icons/
    └── badges/
```

## Recommended hosting architecture

The static site can be hosted with:

- Amazon S3 for static object storage
- Amazon CloudFront for content delivery and HTTPS
- Amazon Route 53 for domain DNS
- AWS Certificate Manager for TLS certificates

See `../docs/architecture/portfolio-site.mmd` for the portfolio hosting architecture.

## Notes

Project-specific pages and scripts are kept under `../projects/` so each solution can be documented, deployed, and reviewed independently. If this structure is used for production hosting, update any relative links in `index.html` so they point to the deployed project page locations.
