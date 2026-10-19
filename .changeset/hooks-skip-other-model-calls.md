---
"ai-gateway-proxy": patch
---

Run no hook on a request with an `ai-model-id` header, which `@ai-sdk/gateway` sends on embedding, image and every other model call but a language model's. The hooks are typed for language model calls, so an `afterResponse` reading `response.usage.inputTokens` threw on an embedding response and the call came back as 500.
