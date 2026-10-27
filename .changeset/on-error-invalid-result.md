---
"ai-gateway-proxy": patch
---

Send the upstream error body when `onError` returns a body without a string `error.message` or with a non-string `error.type`, instead of a body AI SDK clients cannot parse, and log the problem.
