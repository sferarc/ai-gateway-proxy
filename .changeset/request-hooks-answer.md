---
"ai-gateway-proxy": minor
---

`beforeRequest` and `beforeRawRequest` may return a `Response`, which is sent to the client without calling the gateway, so a hook can refuse a call with a status AI SDK clients do not retry instead of throwing into a retried 500.
