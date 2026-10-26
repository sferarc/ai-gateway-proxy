---
"ai-gateway-proxy": patch
---

Send the upstream error body when `onError` returns `undefined` or `null`, instead of an empty body or the literal `null`.
