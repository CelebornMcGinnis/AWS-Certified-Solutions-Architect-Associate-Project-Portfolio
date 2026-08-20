/*
  AWS API Gateway setup
  ---------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual nova-summarizer
  stack output -- no manual editing needed. This file is a template
  checked into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  apiBase: "__API_ENDPOINT__",

  // Abort each browser request after this many milliseconds -- Bedrock
  // inference can take a few seconds, longer than this site's other,
  // non-AI endpoints need.
  requestTimeoutMs: 25000,

  // Kept in sync with MAX_INPUT_CHARS in summarize_handler.py -- purely
  // a client-side heads-up before submitting; the server enforces the
  // real limit regardless of what this says.
  maxInputChars: 6000
};
