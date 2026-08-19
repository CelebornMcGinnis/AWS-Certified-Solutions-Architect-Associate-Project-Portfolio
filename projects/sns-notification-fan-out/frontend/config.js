/*
  AWS API Gateway setup
  ---------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual fanning-sns stack
  output -- no manual editing needed. This file is a template checked
  into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  apiBase: "__API_ENDPOINT__",

  // Optional. Use only for an API Gateway usage-plan key or similar public client value.
  // This is visible to site visitors and should not be treated as a secret.
  apiKey: "",

  // Add extra request headers only when your API Gateway CORS config allows them.
  headers: {},

  // Abort each browser request after this many milliseconds.
  requestTimeoutMs: 10000,

  // How long to wait after a successful trigger before the first poll of
  // GET /notify/recent, and how often to re-poll while waiting for both
  // fan-out branches to show up. The SQS-buffered branch is the slower
  // of the two — a Lambda cold start on that path alone can take several
  // seconds, so this window is generous (~76s total) rather than giving
  // up too early and leaving the row stuck on "pending" until the next
  // manual page refresh.
  firstPollDelayMs: 1500,
  pollIntervalMs: 2500,
  maxPolls: 30
};
