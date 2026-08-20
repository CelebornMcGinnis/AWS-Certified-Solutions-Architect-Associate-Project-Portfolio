/*
  AWS API Gateway setup
  ---------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual habit-tracker stack
  output -- no manual editing needed. This file is a template checked
  into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is
  public. There's nothing to keep secret here anyway -- this project has
  no accounts; see script.js for how the device id is generated.
*/
window.APP_CONFIG = {
  apiBase: "__API_ENDPOINT__",

  // Abort each browser request after this many milliseconds.
  requestTimeoutMs: 10000,

  // How many days of history the calendar grid shows.
  calendarDays: 28
};
