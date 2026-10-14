---
"ai-gateway-proxy": patch
---

Keep `authorization`, `ai-gateway-*`, `ai-language-model-*` and `content-type` set by the proxy when a custom header uses a different casing, such as `Authorization`. Before, both values reached the gateway joined into one header.
