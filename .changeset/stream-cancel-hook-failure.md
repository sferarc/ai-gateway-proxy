---
"ai-gateway-proxy": patch
---

Cancel the upstream stream when the client cancels a streamed response, and forward the original finish event instead of erroring the stream when `afterResponse` throws.
