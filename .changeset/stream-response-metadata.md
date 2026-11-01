---
"ai-gateway-proxy": minor
---

Give a streamed `afterResponse` the stream's `response-metadata` as `response`, with the `id`, `modelId` and `timestamp` the provider sent, and export its type as `GatewayResponseMetadata`. The aggregator dropped these parts, so a hook on a stream could not log the provider's response id or the model that answered.
