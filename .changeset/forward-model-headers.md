---
"ai-gateway-proxy": patch
---

Forward the model routing headers `@ai-sdk/gateway` sends (`ai-model-id`, `ai-*-model-specification-version`, `ai-o11y-*`, `idempotency-key` and `accept`), so embedding and image model calls reach the right model through the proxy. `ai-language-model-id` and `ai-language-model-streaming` are now sent only when the incoming request has them.
