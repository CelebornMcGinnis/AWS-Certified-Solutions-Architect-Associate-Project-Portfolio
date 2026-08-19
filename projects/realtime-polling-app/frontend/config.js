/*
  Live Poll — WebSocket config
  -----------------------------
  The endpoint URL below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual live-poll stack
  output -- no manual editing needed. This file is a template checked
  into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  pollWsUrl: "__API_ENDPOINT__"
};
