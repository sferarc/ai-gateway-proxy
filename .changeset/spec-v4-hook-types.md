---
"ai-gateway-proxy": minor
---

Type `GatewayResponse`, `StreamContentAggregator` and the hook request on AI SDK specification version 4. `afterResponse` now receives `custom` and `reasoning-file` parts and the `citations` of `text-end`, and `file` content carries the V4 tagged `data` object. Code that reads `content`, or types a hook with `LanguageModelV3*`, needs the V4 types.
