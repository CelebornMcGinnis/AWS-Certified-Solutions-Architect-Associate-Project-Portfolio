/*
  AWS API Gateway setup
  ---------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual order-processing
  stack output -- no manual editing needed. This file is a template
  checked into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  apiBase: "__API_ENDPOINT__",

  // Abort each browser request after this many milliseconds.
  requestTimeoutMs: 10000,

  // How long to wait after submitting before the first status poll, and how
  // often to re-poll while the order is still moving. The full pipeline
  // (reserve -> charge -> ship, or the failure/compensation path) resolves
  // in well under this window.
  firstPollDelayMs: 1000,
  pollIntervalMs: 1500,
  maxPolls: 20
};
