#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AWS_ACCOUNT, AWS_REGION, APEX_CERTIFICATE_ARN, WILDCARD_CERTIFICATE_ARN } from '../lib/config';
import { FanningSnsStack } from '../lib/fanning-sns-stack';
import { LivePollStack } from '../lib/live-poll-stack';
import { ContactFormStack } from '../lib/contact-form-stack';
import { WebsiteStack } from '../lib/website-stack';
import { GitHubOidcStack } from '../lib/github-oidc-stack';

const env = { account: AWS_ACCOUNT, region: AWS_REGION };
const app = new cdk.App();

// Both website stacks' existing S3/CloudFront resources are now imported,
// so content publishing (BucketDeployment) and the Route53 alias record(s)
// -- which can't be part of an import changeset -- are safe to manage here.
const manageContent = true;

// Stack names match the existing live CloudFormation stacks exactly so
// `cdk import` adopts them in place instead of creating new ones.
new FanningSnsStack(app, 'fanning-sns', { env });
new LivePollStack(app, 'live-poll', { env });

new ContactFormStack(app, 'contact-form-api', { env });

new WebsiteStack(app, 'portfolio-website-prod', {
  env,
  stage: 'prod',
  domainName: 'mcginnisarchitecture.com',
  bucketName: 'mcginnisarchitecture-prod-website-942960194803-us-east-1-an',
  certificateArn: APEX_CERTIFICATE_ARN,
  comment: 'McGinnisArchitecture Prod Website',
  customErrorResponses: [
    { errorCode: 403, responsePagePath: '/index.html', responseCode: 200, errorCachingMinTtl: 10 },
    { errorCode: 404, responsePagePath: '/index.html', responseCode: 200, errorCachingMinTtl: 10 },
  ],
  createAaaaRecord: false,
  manageContent,
  webAclId: 'arn:aws:wafv2:us-east-1:942960194803:global/webacl/CreatedByCloudFront-7737fc15/748f67d8-c668-4be9-9d0f-e93e6037a39a',
});

new WebsiteStack(app, 'portfolio-website-beta', {
  env,
  stage: 'beta',
  domainName: 'betaweb.mcginnisarchitecture.com',
  bucketName: 'mcginnisarchitecture-beta-website-942960194803-us-east-1-an',
  certificateArn: WILDCARD_CERTIFICATE_ARN,
  comment: 'beta environment for the McGinnisArchitecture webpage',
  createAaaaRecord: true,
  manageContent,
  webAclId: 'arn:aws:wafv2:us-east-1:942960194803:global/webacl/CreatedByCloudFront-17dac3ad/83d6d067-3c62-45f4-9b93-d097179721cd',
});

new GitHubOidcStack(app, 'portfolio-github-oidc', {
  env,
  githubRepo: 'CelebornMcGinnis/AWS-Certified-Solutions-Architect-Associate-Project-Portfolio',
});
