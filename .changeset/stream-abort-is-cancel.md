---
"ai-gateway-proxy": patch
---

Report a client that aborts `request.signal` mid-stream to `afterResponse` as `{ reason: "cancelled" }` instead of an upstream failure, and stop logging it as `upstream stream failed`. `createStreamTransformer` takes the signal as an optional fourth argument.
