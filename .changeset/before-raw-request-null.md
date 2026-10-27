---
"ai-gateway-proxy": patch
---

Send the parsed request body when `beforeRawRequest` returns `null`, as it does for `undefined`, instead of the literal `null`.
