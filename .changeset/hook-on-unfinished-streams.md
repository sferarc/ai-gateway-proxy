---
"ai-gateway-proxy": major
---

Call `afterResponse` once when a stream ends, fails or is cancelled before its `finish` event, with the partial content and an `incomplete` field. `GatewayResponse.usage` is now `LanguageModelV3Usage | undefined`, which breaks code that reads it without a check.
