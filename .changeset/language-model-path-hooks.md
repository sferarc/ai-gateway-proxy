---
"ai-gateway-proxy": patch
---

Run every hook on a request whose path ends in `language-model`, whatever model headers it sends. A client could skip `beforeRequest`, `afterResponse` and `onError` on a language model call by sending `ai-model-id` without `ai-language-model-id`, and the call was still forwarded.
