/*
  AWS API Gateway setup
  ---------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual contact-form-api
  stack output -- no manual editing needed. This file is a template
  checked into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  apiEndpoint: "__API_ENDPOINT__",

  // Optional. Use only for an API Gateway usage-plan key or similar public client value.
  // This is visible to site visitors and should not be treated as a secret.
  apiKey: "",

  // Add extra request headers only when your API Gateway CORS config allows them.
  headers: {},

  // Abort the browser request after this many milliseconds.
  requestTimeoutMs: 10000
};
