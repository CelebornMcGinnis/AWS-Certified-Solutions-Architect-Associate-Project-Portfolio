/*
  AWS API Gateway setup
  ---------------------
  1. Deploy a POST route in API Gateway, for example POST /contact.
  2. Copy the invoke URL from API Gateway.
  3. Replace apiEndpoint below with the full URL for that POST route.

  Example shapes:
  - HTTP API default stage: https://abc123.execute-api.us-east-1.amazonaws.com/contact
  - REST API with stage:    https://abc123.execute-api.us-east-1.amazonaws.com/prod/contact

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  apiEndpoint: "https://nkgtp7h93d.execute-api.us-east-1.amazonaws.com/default/prj1_call_SES",

  // Optional. Use only for an API Gateway usage-plan key or similar public client value.
  // This is visible to site visitors and should not be treated as a secret.
  apiKey: "",

  // Add extra request headers only when your API Gateway CORS config allows them.
  headers: {},

  // After a successful submission, redirect to success.html.
  // Set to false to show an inline success message instead.
  redirectOnSuccess: true,
  successUrl: "success.html",

  // Abort the browser request after this many milliseconds.
  requestTimeoutMs: 10000
};
