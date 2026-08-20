/*
  AWS API Gateway + Cognito setup
  -------------------------------
  Every value below is filled in automatically at deploy time by
  cdk/lib/website-stack.ts, from that stage's actual backend stack
  outputs -- no manual editing needed. This file is a template checked
  into source control, not the literal file that ends up in S3.

  Do not put real secrets in this file. Anything in a static website is
  public -- the Cognito app client below has no secret by design, and
  the user pool client only ever performs the direct-from-browser
  USER_PASSWORD_AUTH flow.
*/
window.APP_CONFIG = {
  apiBase: "__API_ENDPOINT__",

  cognito: {
    userPoolId: "__COGNITO_USER_POOL_ID__",
    clientId: "__COGNITO_USER_POOL_CLIENT_ID__"
  },

  // Abort each browser request after this many milliseconds -- Bedrock
  // inference can take a few seconds, longer than this site's other,
  // non-AI endpoints need.
  requestTimeoutMs: 20000
};
