/*
  Live Poll — WebSocket config
  -----------------------------
  1. Deploy aws/live-poll/template.yaml via `sam build && sam deploy --guided`.
  2. Copy the PollWebSocketUrl value from the stack outputs.
  3. Paste it below as poolWsUrl.

  This file is scoped to the live-poll project only — it doesn't affect
  or get affected by /project/contactform/config.js.

  Do not put real secrets in this file. Anything in a static website is public.
*/
window.APP_CONFIG = {
  pollWsUrl: "wss://dxo2k8q0td.execute-api.us-east-1.amazonaws.com/prod"
};
