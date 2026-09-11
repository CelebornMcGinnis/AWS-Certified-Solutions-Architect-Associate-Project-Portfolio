# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An AWS Solutions Architect portfolio: a static marketing site (`website/`) plus ~14 small serverless demo "projects" (`projects/<name>/`), each with its own frontend, Lambda backend, and (for most) a real deployed AWS stack. Infrastructure for the whole thing — website hosting, every project's backend, and DNS records it touches — lives in a single unified CDK app under `cdk/`, deployed to two fully independent stages: **prod** (`mcginnisarchitecture.com`) and **beta** (`betaweb.mcginnisarchitecture.com`).

`README.md` and `PROJECT_STRUCTURE.md` describe an older per-project AWS SAM deployment model (`sam build && sam deploy --guided` from each project's `infrastructure/template.yaml`). That model is stale for the three projects it still exists for (`contact-form-api`, `realtime-polling-app`, `sns-notification-fan-out`) — those SAM templates are no longer the deploy path. **All actual deployment today goes through `cdk/`**, driven by GitHub Actions. Don't `sam deploy` anything.

## Commands

All commands run from `cdk/` (the only Node project in the repo — there is no root `package.json`, and no lint script exists anywhere):

```bash
cd cdk
npm run build        # tsc type-check (no emit step you need to worry about; cdk.json runs tsc+tsx itself)
npm run watch         # tsc -w
npm test              # jest via @swc/jest — note: no test files currently exist in the repo, only jest's own config
npx cdk synth [stack] # synthesize CloudFormation
npx cdk diff [stack]  # compare against deployed stacks
npx cdk deploy <stack> --require-approval never   # deploy one or more named stacks
```

Stack names are the CDK ids passed to each `new XyzStack(app, 'id', ...)` call in `cdk/bin/portfolio.ts` (e.g. `fanning-sns`, `fanning-sns-beta`, `portfolio-website-prod`) — always operate on named stacks, not `--all`, unless you specifically mean to touch everything.

There's no local dev server config for the static site. Its HTML uses absolute paths (`/assets/...`, `/project/<name>/...`), so opening files directly via `file://` breaks navigation and icons. To preview locally, stage `website/*` at a server root alongside `projects/<name>/frontend/*` copied to `project/<destPrefix>/` (see the `destPrefix` mapping in `cdk/lib/website-content.ts`), then serve with e.g. `python3 -m http.server`.

## Deploy model (GitHub Actions, not manual CLI use in normal operation)

Three workflows in `.github/workflows/`:

- **`cdk-deploy-beta.yml`**: auto-deploys every approved beta stack on every push to `main` touching `cdk/**`, `website/**`, or `projects/**` — **`main` is always live on beta**. Also runnable manually (deploy or destroy one/several stacks, no confirmation required — beta is meant to be freely destroyable).
- **`cdk-deploy-prod.yml`**: **manual-only**, never triggered by a push. Requires typing `deploy`/`destroy` into a confirmation input matching the chosen action. No default stack list for destroy (must name stacks explicitly).
- **`cdk-pr.yml`**: on PRs touching those same paths, runs `cdk diff --all` and posts it as a PR comment.

Both deploy workflows hand-maintain an explicit allow-list of stack names (not derived from `cdk/lib/` automatically) — adding a new project's beta *or* prod stack means editing that workflow file on purpose, one line at a time. `portfolio-github-oidc` is excluded from both; it's deployed manually and rarely since it governs the GitHub OIDC trust policy.

**Working agreement (see the comments in `cdk-deploy-prod.yml`): touch beta or prod in a given change, never both.**

## Architecture: how one backend becomes two independent stacks

`cdk/bin/portfolio.ts` instantiates almost every stack **twice** — once with `stage: 'prod'`, once with `stage: 'beta'` — as fully independent CloudFormation stacks with their own tables/Lambdas/APIs. Nothing is shared between a project's two stacks, so destroying one can never affect its counterpart, another project, or the shared resources below. Two exceptions share state across projects on purpose: `SharedAuthStack` (one Cognito user pool per stage) is imported by both `ModeratedImageGalleryStack` and `WebsiteChatbotStack` for a common login.

The two `WebsiteStack` instances (`portfolio-website-prod`, `portfolio-website-beta`) own the S3/CloudFront/Route53 resources for each stage's site and import already-existing infrastructure rather than creating it fresh.

## Architecture: `cdk/lib/website-content.ts` is the single source of truth for what ships where

Every project is one entry in its `PROJECTS` array: `frontendDir`, `destPrefix` (production URL path), per-file `rename` map, and a `stages` array (`['beta']`, `['prod']`, or both) that governs three things at once:

1. Which projects' frontend files get copied into a stage's build output (`buildWebsiteContentDir()`).
2. Which projects' `homepageCardFile` HTML fragment and nav links get injected into `website/index.html` at its `<!-- STAGE_ONLY_PROJECT_CARDS -->`, `<!-- STAGE_ONLY_NAV_LINKS -->`, and `<!-- STAGE_ONLY_MOBILE_NAV_LINKS -->` marker comments — a project not yet promoted to prod (`stages: ['beta']`) simply produces no output for those markers on a prod build.
3. Which projects get a `config.js` generated with their real API endpoint (and, for Cognito-backed projects, user pool ids) substituted in via CloudFormation token resolution — `hasApiKey()` skips this for reference-only projects, which have no `key` at all.

A project without a `key` in its `ProjectMapping` has a real, compilable CDK stack file (e.g. `container-orchestration-stack.ts`) that is **deliberately never imported into `cdk/bin/portfolio.ts`**, ships `stages: ['beta']` only, and has zero backend calls in its frontend (`script.js` simulates everything client-side) — labeled "Reference build" on the homepage (`.project-card.is-reference` vs. `.is-live`) with an in-page cost-justification disclaimer. There are currently five of these (`container-orchestration`, `data-lake-analytics`, `multi-region-dr`, `vpc-network-design`, `realtime-ops-dashboard`); see the top of each of their stack files for the specific cost reasoning.

Three projects (`contact-form-api`, `realtime-polling-app` → `livePoll`, `sns-notification-fan-out` → `fanningSns`) have permanent, hand-written homepage cards directly in `website/index.html` rather than a `homepageCardFile` — they're still full entries in `PROJECTS` (with `stages`, `navLinkHtml`, etc.) so the nav dropdown can interleave them alphabetically with everything else.

## Frontend conventions shared across every project detail page

Every `projects/<name>/frontend/index.html` reuses the same header/footer/mobile-sidebar/dark-mode-toggle chrome, and most "how it works" sections use a shared, generic animated-diagram component defined once in `website/styles.css`: `.flow-diagram` → `.flow-track` → `.flow-node`/`.flow-connector`/`.flow-dot`, driven by a small autoplay/click-to-jump script (copy it from an existing project's `script.js`, e.g. `workflow-visualizer`, rather than reinventing it). On desktop it's a single horizontal row; below 760px it collapses into a fixed 2-column zigzag grid via **per-page** `grid-column`/`grid-row` overrides scoped by a page-specific class (`.contact-diagram`, `.workflow-diagram`, `.containers-diagram`, etc.) inside one shared `@media (max-width: 760px)` block in `styles.css` — a new project's diagram needs its own scoping class and its own set of position rules added there, following the existing entries' pattern exactly (same `[data-node]` values as the desktop markup).

Desktop nav is a plain `<nav>`, entirely hidden below 760px in favor of a separate `.mobile-sidebar` component — don't assume the desktop nav markup responsively collapses into the mobile one; they're two different DOM trees.

## Domain, DNS, and email are not managed by this CDK app

`HostedZone.fromHostedZoneAttributes(...)` (in `website-stack.ts` and `multi-region-dr-stack.ts`) **imports** the existing `mcginnisarchitecture.com` hosted zone rather than creating it. The zone's other records (SES domain/DKIM verification, the `no-reply.mcginnisarchitecture.com` custom MAIL FROM domain's MX/SPF, `_dmarc` policy) were set up by hand via the AWS console/CLI and aren't tracked anywhere in this repo. `SES_FROM_ADDRESS`/`SES_TO_ADDRESS` (`cdk/lib/config.ts`) are the only email-related values CDK actually owns — everything else about deliverability has to be checked directly against the live AWS account (`aws ses get-identity-*`, `aws route53 list-resource-record-sets`), not by reading this codebase.
