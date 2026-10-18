---
"ai-gateway-proxy": patch
---

Forward a successful `text/event-stream` response to a request not marked `ai-language-model-streaming: true` as is, instead of answering `500 Error proxying request to AI Gateway`. `@ai-sdk/gateway`'s video model `doGenerate` reads its result this way, so video generation through the proxy always failed. `afterResponse` does not run for these responses.
