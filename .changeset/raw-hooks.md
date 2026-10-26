---
"ai-gateway-proxy": minor
---

Add the optional `beforeRawRequest` and `afterRawResponse` hooks for the calls that are not language model calls (embedding, image, video, speech, transcription, reranking, decision and batch start), so an operator can meter, audit or rewrite them. They receive the call's `kind`, `path`, `modelId` and parsed body, and `afterRawResponse` also the `Response` the proxy would send, which it may replace. The existing hooks are unchanged.
