---
"ai-gateway-proxy": patch
---

Forward a successful JSON Lines response (`application/x-ndjson`, `application/jsonl`) to a request not marked `ai-language-model-streaming: true` as is, instead of answering `500 Error proxying request to AI Gateway`. `@ai-sdk/gateway`'s batch API reads `doGetBatchResults` this way, so reading batch results through the proxy always failed. `afterResponse` does not run for these responses.
