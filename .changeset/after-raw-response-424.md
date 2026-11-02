---
"ai-gateway-proxy": minor
---

Answer an `afterRawResponse` failure after a successful embedding, image, video, speech, transcription, reranking, decision or batch call with 424 `proxy_error` instead of 500: a hook that throws, returns anything but a `Response` or nothing, or reads the body and returns nothing. AI SDK clients retry a 500, so `embed` and the other helpers paid for the call again; they do not retry a 424. A failure on an error response is still a 500.
