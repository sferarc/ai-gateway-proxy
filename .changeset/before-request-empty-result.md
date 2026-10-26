---
"ai-gateway-proxy": patch
---

Send the parsed request body when `beforeRequest` returns `undefined` or `null`, instead of an empty body or the literal `null`.
