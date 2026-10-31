---
"ai-gateway-proxy": patch
---

Send the upstream error body when `onError` returns an `error.code` that is neither a string nor a number, or a non-string `generationId`, which AI SDK clients reject as `Invalid error response format`, and log the problem. `GatewayError` now types the optional `error.code` and `generationId` the gateway may send.
