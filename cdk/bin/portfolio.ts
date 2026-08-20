#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AWS_ACCOUNT, AWS_REGION, APEX_CERTIFICATE_ARN, WILDCARD_CERTIFICATE_ARN } from '../lib/config';
import { FanningSnsStack } from '../lib/fanning-sns-stack';
import { LivePollStack } from '../lib/live-poll-stack';
import { ContactFormStack } from '../lib/contact-form-stack';
import { WorkflowVisualizerStack } from '../lib/workflow-visualizer-stack';
import { ModeratedImageGalleryStack } from '../lib/moderated-image-gallery-stack';
import { HabitTrackerStack } from '../lib/habit-tracker-stack';
import { NovaSummarizerStack } from '../lib/nova-summarizer-stack';
import { OrderProcessingStack } from '../lib/order-processing-stack';
import { WebsiteChatbotStack } from '../lib/website-chatbot-stack';
import { WebsiteStack } from '../lib/website-stack';
import { GitHubOidcStack } from '../lib/github-oidc-stack';
import { ProjectKey } from '../lib/website-content';

const env = { account: AWS_ACCOUNT, region: AWS_REGION };
const app = new cdk.App();

// Applies to every stack in the app -- lets `aws resourcegroupstaggingapi`
// (or just eyeballing the console) reliably answer "what belongs to this
// portfolio" without relying on naming conventions alone.
cdk.Tags.of(app).add('Project', 'mcginnisarchitecture-portfolio');

// Both website stacks' existing S3/CloudFront resources are now imported,
// so content publishing (BucketDeployment) and the Route53 alias record(s)
// -- which can't be part of an import changeset -- are safe to manage here.
const manageContent = true;

// Every backend is deployed twice, once per stage, as fully independent
// stacks -- prod keeps today's already-live resources exactly as they are
// (same stack id, same physical names); beta gets its own brand-new
// table(s)/Lambda(s)/API, wired only to the beta site origin. Nothing is
// shared between a project's two stacks, so `cdk destroy <any-one-stack>`
// can only ever affect that stack's own resources -- never its prod/beta
// counterpart, another project, or anything else in the account.
const fanningSnsProd = new FanningSnsStack(app, 'fanning-sns', { env, stage: 'prod' });
const fanningSnsBeta = new FanningSnsStack(app, 'fanning-sns-beta', { env, stage: 'beta' });

const livePollProd = new LivePollStack(app, 'live-poll', { env, stage: 'prod' });
const livePollBeta = new LivePollStack(app, 'live-poll-beta', { env, stage: 'beta' });

const contactFormProd = new ContactFormStack(app, 'contact-form-api', { env, stage: 'prod' });
const contactFormBeta = new ContactFormStack(app, 'contact-form-api-beta', { env, stage: 'beta' });

// workflow-visualizer previously existed as a single bare-named stack that
// had only ever served beta traffic (never linked from prod) -- that stack
// was destroyed and recreated as this prod/beta pair so its naming matches
// the other three projects' convention exactly (bare id = prod, -beta
// suffix = beta). No real user data was lost (test runs only).
const workflowVisualizerProd = new WorkflowVisualizerStack(app, 'workflow-visualizer', { env, stage: 'prod' });
const workflowVisualizerBeta = new WorkflowVisualizerStack(app, 'workflow-visualizer-beta', { env, stage: 'beta' });

// Backend-first, like workflow-visualizer's initial rollout. The frontend
// now exists too (see website-content.ts's PROJECTS entry), gated to
// stages: ['beta'] there until it's reviewed and promoted to prod.
const moderatedImageGalleryProd = new ModeratedImageGalleryStack(app, 'moderated-image-gallery', { env, stage: 'prod' });
const moderatedImageGalleryBeta = new ModeratedImageGalleryStack(app, 'moderated-image-gallery-beta', { env, stage: 'beta' });

// Same backend-first rollout again -- frontend gated to stages: ['beta']
// in website-content.ts until reviewed.
const habitTrackerProd = new HabitTrackerStack(app, 'habit-tracker', { env, stage: 'prod' });
const habitTrackerBeta = new HabitTrackerStack(app, 'habit-tracker-beta', { env, stage: 'beta' });

// Same backend-first rollout again -- frontend gated to stages: ['beta']
// in website-content.ts until reviewed.
const novaSummarizerProd = new NovaSummarizerStack(app, 'nova-summarizer', { env, stage: 'prod' });
const novaSummarizerBeta = new NovaSummarizerStack(app, 'nova-summarizer-beta', { env, stage: 'beta' });

// Same backend-first rollout again -- frontend gated to stages: ['beta']
// in website-content.ts until reviewed.
const orderProcessingProd = new OrderProcessingStack(app, 'order-processing', { env, stage: 'prod' });
const orderProcessingBeta = new OrderProcessingStack(app, 'order-processing-beta', { env, stage: 'beta' });

// Same backend-first rollout again -- frontend gated to stages: ['beta']
// in website-content.ts until reviewed.
const websiteChatbotProd = new WebsiteChatbotStack(app, 'website-chatbot', { env, stage: 'prod' });
const websiteChatbotBeta = new WebsiteChatbotStack(app, 'website-chatbot-beta', { env, stage: 'beta' });

for (const stack of [fanningSnsProd, livePollProd, contactFormProd, workflowVisualizerProd, moderatedImageGalleryProd, habitTrackerProd, novaSummarizerProd, orderProcessingProd, websiteChatbotProd]) {
  cdk.Tags.of(stack).add('Stage', 'prod');
}
for (const stack of [fanningSnsBeta, livePollBeta, contactFormBeta, workflowVisualizerBeta, moderatedImageGalleryBeta, habitTrackerBeta, novaSummarizerBeta, orderProcessingBeta, websiteChatbotBeta]) {
  cdk.Tags.of(stack).add('Stage', 'beta');
}

const prodApiEndpoints: Record<ProjectKey, string> = {
  contactForm: contactFormProd.apiEndpoint,
  livePoll: livePollProd.webSocketUrl,
  fanningSns: fanningSnsProd.apiEndpoint,
  workflowVisualizer: workflowVisualizerProd.apiEndpoint,
  moderatedImageGallery: moderatedImageGalleryProd.apiEndpoint,
  habitTracker: habitTrackerProd.apiEndpoint,
  novaSummarizer: novaSummarizerProd.apiEndpoint,
  orderProcessing: orderProcessingProd.apiEndpoint,
  websiteChatbot: websiteChatbotProd.apiEndpoint,
};
const betaApiEndpoints: Record<ProjectKey, string> = {
  contactForm: contactFormBeta.apiEndpoint,
  livePoll: livePollBeta.webSocketUrl,
  fanningSns: fanningSnsBeta.apiEndpoint,
  workflowVisualizer: workflowVisualizerBeta.apiEndpoint,
  moderatedImageGallery: moderatedImageGalleryBeta.apiEndpoint,
  habitTracker: habitTrackerBeta.apiEndpoint,
  novaSummarizer: novaSummarizerBeta.apiEndpoint,
  orderProcessing: orderProcessingBeta.apiEndpoint,
  websiteChatbot: websiteChatbotBeta.apiEndpoint,
};

// moderated-image-gallery's config.js needs its stage's Cognito ids too,
// not just the API endpoint -- see buildConfigJsSources() in
// website-content.ts for how these extra tokens get resolved at deploy time.
const prodExtraConfigReplacements = {
  moderatedImageGallery: {
    __COGNITO_USER_POOL_ID__: moderatedImageGalleryProd.userPoolId,
    __COGNITO_USER_POOL_CLIENT_ID__: moderatedImageGalleryProd.userPoolClientId,
  },
  websiteChatbot: {
    __COGNITO_USER_POOL_ID__: websiteChatbotProd.userPoolId,
    __COGNITO_USER_POOL_CLIENT_ID__: websiteChatbotProd.userPoolClientId,
  },
};
const betaExtraConfigReplacements = {
  moderatedImageGallery: {
    __COGNITO_USER_POOL_ID__: moderatedImageGalleryBeta.userPoolId,
    __COGNITO_USER_POOL_CLIENT_ID__: moderatedImageGalleryBeta.userPoolClientId,
  },
  websiteChatbot: {
    __COGNITO_USER_POOL_ID__: websiteChatbotBeta.userPoolId,
    __COGNITO_USER_POOL_CLIENT_ID__: websiteChatbotBeta.userPoolClientId,
  },
};

const websiteProd = new WebsiteStack(app, 'portfolio-website-prod', {
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
  apiEndpoints: prodApiEndpoints,
  extraConfigReplacements: prodExtraConfigReplacements,
});

const websiteBeta = new WebsiteStack(app, 'portfolio-website-beta', {
  env,
  stage: 'beta',
  domainName: 'betaweb.mcginnisarchitecture.com',
  bucketName: 'mcginnisarchitecture-beta-website-942960194803-us-east-1-an',
  certificateArn: WILDCARD_CERTIFICATE_ARN,
  comment: 'beta environment for the McGinnisArchitecture webpage',
  customErrorResponses: [
    { errorCode: 403, responsePagePath: '/index.html', responseCode: 200, errorCachingMinTtl: 10 },
    { errorCode: 404, responsePagePath: '/index.html', responseCode: 200, errorCachingMinTtl: 10 },
  ],
  createAaaaRecord: true,
  manageContent,
  webAclId: 'arn:aws:wafv2:us-east-1:942960194803:global/webacl/CreatedByCloudFront-17dac3ad/83d6d067-3c62-45f4-9b93-d097179721cd',
  apiEndpoints: betaApiEndpoints,
  extraConfigReplacements: betaExtraConfigReplacements,
});

cdk.Tags.of(websiteProd).add('Stage', 'prod');
cdk.Tags.of(websiteBeta).add('Stage', 'beta');

new GitHubOidcStack(app, 'portfolio-github-oidc', {
  env,
  githubRepoSubject: 'CelebornMcGinnis@25270109/AWS-Certified-Solutions-Architect-Associate-Project-Portfolio@1319607228',
});
