---
"ai-gateway-proxy": patch
---

Forward the gateway's `retry-after`, `retry-after-ms`, `x-ratelimit-*` and `x-request-id` response headers alongside `x-vercel-id`, so an AI SDK client backs off for the delay the gateway asks for on a 429 instead of retrying on its own schedule.
