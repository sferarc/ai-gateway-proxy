---
"ai-gateway-proxy": patch
---

Return `500 beforeRequest hook returned an invalid request: the result must be an object` when `beforeRequest` returns a string, number, boolean or array, instead of sending it to the gateway as the request body.
