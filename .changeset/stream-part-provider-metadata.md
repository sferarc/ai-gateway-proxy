---
"ai-gateway-proxy": patch
---

Keep the `providerMetadata` of streamed text and reasoning parts on the content `afterResponse` receives, taking the latest part that carries it as `streamText` does, so a hook sees a reasoning signature or per-block metadata as the non-streaming response gives it.
