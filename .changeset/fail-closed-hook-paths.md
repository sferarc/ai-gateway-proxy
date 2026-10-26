---
"ai-gateway-proxy": minor
---

Run the hooks on every request with a body except one whose path relative to `baseUrl` is exactly a path `@ai-sdk/gateway` uses for other calls (`embedding-model`, `image-model`, `video-model`, `video-model/start`, `video-model/status`, `speech-model`, `transcription-model`, `reranking-model`, `decision-model` and the `batch/` calls). Behavior change: the `ai-model-id` header no longer skips the hooks, so a request to any other path, or to another spelling of a listed one such as `Embedding-Model` or `batch/status/`, now runs `beforeRequest`, `afterResponse` and `onError`. Before, an unknown path with `ai-model-id`, or a spelling the path fold missed, skipped them.
