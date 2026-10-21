---
"ai-gateway-proxy": patch
---

Send the upstream body when `afterResponse` returns `undefined` or `null` on a non-streaming response, instead of an empty body or the literal `null`.
