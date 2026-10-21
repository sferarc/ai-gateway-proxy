---
"ai-gateway-proxy": minor
---

Call `afterResponse` once when a stream ends, fails or is cancelled before its `finish` event, with the partial content and an `incomplete` field. `GatewayResponse.usage` is now `LanguageModelV4Usage | undefined`, which breaks code that reads it without a check. A hook that returns `usage: undefined` on `finish` now keeps the upstream usage in the client's finish event instead of dropping it.
