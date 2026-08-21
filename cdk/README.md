# Portfolio CDK app

AWS CDK (TypeScript) app that manages every AWS resource behind [mcginnisarchitecture.com](https://mcginnisarchitecture.com) and its three project backends. Deploys are triggered by GitHub Actions on push to `main` -- see the root [README's Deployment model section](../README.md#deployment-model) for how that's wired up.

## Stacks

| Stack | Owns | Notes |
| --- | --- | --- |
| `fanning-sns` | SNS fan-out demo backend (DynamoDB, SNS, SQS, Lambdas, HTTP API) | Adopted in place -- was already a CloudFormation/SAM stack; logical IDs match exactly so `cdk deploy` is a normal update, not an import. |
| `live-poll` | Real-time polling backend (DynamoDB, WebSocket API, Lambdas) | Same as above. |
| `contact-form-api` | Contact form Lambda + HTTP API | Adopted via `cdk import` -- these resources were created by hand in the console, not by any CloudFormation stack. Routes live under `/prj1_call_SES` on a stage literally named `default`, matching what's actually deployed (not the repo's aspirational `template.yaml`). |
| `portfolio-website-prod` | Production site: S3 + CloudFront + Route 53 (`mcginnisarchitecture.com`) | Adopted via `cdk import`; `BucketDeployment` publishes content and owns the DNS alias record. |
| `portfolio-website-beta` | Beta site: S3 + CloudFront + Route 53 (`betaweb.mcginnisarchitecture.com`) | Same shape as prod. |
| `portfolio-github-oidc` | GitHub Actions OIDC provider + two IAM roles | `github-actions-portfolio-cdk-deploy` (push-to-main only, can deploy) and `github-actions-portfolio-cdk-plan` (any PR, read-only). |

`lib/config.ts` holds the account/region/domain/SES constants shared across stacks. `lib/website-content.ts` assembles `website/` plus each project's `frontend/` folder into the exact production S3 key layout (including the historical `index.html` → `projectN.html` renames) at synth time -- see `PROJECT_STRUCTURE.md` in the repo root for that mapping.

## Commands

```bash
npm install
npx cdk synth [stack-name]     # emit the CloudFormation template
npx cdk diff [stack-name]      # compare against what's actually deployed
npx cdk deploy [stack-name]    # apply (omit stack-name to affect nothing -- pass a name or --all)
```

## Import maps

`import-maps/*.json` are the resource-mapping files used for the one-time `cdk import` of `contact-form-api` and the two website stacks. They're historical records of exactly which physical AWS resource each construct was adopted from -- not something you'd normally re-run, but useful if a stack ever needs to be re-imported after a `cdk destroy` + recreate of the CDK app itself.
