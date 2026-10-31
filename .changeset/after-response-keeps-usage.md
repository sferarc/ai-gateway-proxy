---
"ai-gateway-proxy": patch
---

Keep the gateway's `usage` when a non-streamed `afterResponse` returns a result without one, as a streamed `finish` event already does, instead of sending a body that makes `generateText` throw.
