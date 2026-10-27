---
"ai-gateway-proxy": patch
---

Return `400 Invalid request body: a language model call must be a JSON object` when a language model hook is set and the request body is JSON but not an object, such as an array or `null`, instead of handing it to `beforeRequest`, `afterResponse` or `onError` typed as call options.
