# Repository Structure and File Mapping

How the repository is laid out and how project folders become pages on the site. Deployment is covered in [`README.md`](README.md) and `CLAUDE.md`.

## Root

```text
/
├── README.md
├── PROJECT_STRUCTURE.md
├── CLAUDE.md
├── LICENSE
├── website/             homepage, 404, styles, shared assets
├── projects/            one folder per project
├── cdk/                 the CDK app (the only deploy path)
├── docs/architecture/   diagrams
└── .github/workflows/   cdk-deploy-beta, cdk-deploy-prod, cdk-pr
```

## Website

```text
website/
├── index.html
├── 404.html
├── styles.css
├── site.webmanifest
└── assets/          images (WebP where possible), icons, badges, shared scripts
```

Pages use absolute paths (`/assets/...`, `/project/<name>/...`), so they only work when served from a site root. Inline scripts and styles are not allowed (the site's content security policy blocks them); shared behaviour lives in `assets/*.js`.

At build time `cdk/lib/website-content.ts` copies `website/` into `cdk/.website-dist-<stage>`, then adds the stage-specific project cards and navigation, canonical tags, a fingerprinted stylesheet (`styles.<hash>.css`), and `robots.txt`/`sitemap.xml`. Beta is `noindex`.

## Projects

```text
projects/<name>/
├── frontend/             page(s) and script.js; config.js is generated at deploy time
├── backend/              Lambda source (live-backend projects and reference builds)
├── homepage-card.html    card injected into the homepage for stages that ship it
└── README.md             older projects and reference builds only
```

Each project is one entry in the `PROJECTS` array in `cdk/lib/website-content.ts`. That entry sets its URL folder (`destPrefix`), any file renames, and which stages ship it. The three oldest projects keep their original page names.

| Project folder | Site path | Backend |
| --- | --- | --- |
| `contact-form-api` | `/project/contactform/project1.html` | live (`contact-form-stack.ts`) |
| `realtime-polling-app` | `/project/polling/project2.html` | live (`live-poll-stack.ts`) |
| `sns-notification-fan-out` | `/project/fanningsns/project3.html` | live (`fanning-sns-stack.ts`) |
| `workflow-visualizer` | `/project/workflow/` | live |
| `moderated-image-gallery` | `/project/gallery/` | live |
| `habit-tracker` | `/project/habits/project6.html` | live |
| `nova-summarizer` | `/project/summarizer/` | live |
| `order-processing` | `/project/orders/` | live |
| `website-chatbot` | `/project/chatbot/` | live |
| `linkedin-post-pipeline` | `/project/linkedin/` | none (simulated showcase) |
| `payday-compass` | `/project/paydaycompass/` | none (architecture walkthrough of a separate product) |
| `multi-region-dr` | `/project/dr/` | reference build, never deployed |
| `data-lake-analytics` | `/project/datalake/` | reference build, never deployed |
| `container-orchestration` | `/project/containers/` | reference build, never deployed |
| `vpc-network-design` | `/project/vpc/` | reference build, never deployed |
| `realtime-ops-dashboard` | `/project/opsdash/` | reference build, never deployed |

Reference builds have a real, compilable stack file in `cdk/lib/` that is deliberately never imported by `cdk/bin/portfolio.ts`, so `cdk deploy` can never touch it. Their frontends make no backend calls; every interaction is simulated in `script.js`. They are labelled "Reference build" on the homepage. See the top of each stack file for the cost reasoning.

The first three projects also contain an `infrastructure/template.yaml` (AWS SAM). Those templates are historical; deployment goes through `cdk/`.

## CDK app

```text
cdk/
├── bin/portfolio.ts      instantiates each stack for prod and beta
├── lib/                  one stack file per project, plus website-stack.ts and website-content.ts
├── scripts/              check-dist.mjs, smoke-test.mjs, lighthouse-summary.mjs
└── lighthouserc.beta.json
```

## Architecture documentation

```text
docs/architecture/
├── README.md
├── <project>.drawio      source for the diagram (most projects)
├── <project>.md          Mermaid diagram (older projects)
└── <project>.mmd         reusable Mermaid source (first three projects, plus the portfolio site)
```

The diagram images shown on project pages are exported from the `.drawio` files and live at `projects/<name>/frontend/architecture.webp`.

## Files intentionally not committed

```text
.DS_Store
*.zip
.env
.env.*
.aws/
__pycache__/
.venv/
node_modules/
cdk/.website-dist-*
cdk/cdk.out/
cdk/.lighthouseci/
*.log
```
