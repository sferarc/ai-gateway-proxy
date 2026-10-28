---
"ai-gateway-proxy": minor
---

Give `beforeRequest`, `afterResponse` and `onError` a `modelId`, the client's `ai-language-model-id` header, on streamed and non-streamed calls. The call body does not name the model, so a hook that metered or capped usage had no way to tell which model it was for.
