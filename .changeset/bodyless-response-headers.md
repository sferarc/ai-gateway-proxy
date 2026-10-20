---
"ai-gateway-proxy": patch
---

Forward the gateway's `retry-after`, `retry-after-ms`, `x-ratelimit-*`, `x-vercel-id` and `x-request-id` response headers on bodyless requests such as `GET /config` too, as every other response path already did. Before, those responses carried only `content-type`.
