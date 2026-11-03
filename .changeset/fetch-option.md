---
"ai-gateway-proxy": minor
---

Add a `fetch` option to `createGatewayProxy`, so the upstream call can go through an instrumented `fetch`, an outbound proxy dispatcher or a test double instead of the global.
