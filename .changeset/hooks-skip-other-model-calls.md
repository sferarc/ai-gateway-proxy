---
"ai-gateway-proxy": patch
---

Run no hook on a request with an `ai-model-id` header and no `ai-language-model-id` header, which is how `@ai-sdk/gateway` sends embedding, image and every other model call but a language model's. The hooks are typed for language model calls, so an `afterResponse` reading `response.usage.inputTokens` threw on an embedding response and the call came back as 500. A language model call runs every hook even if it also sends `ai-model-id`.
