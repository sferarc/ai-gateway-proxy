---
"ai-gateway-proxy": patch
---

Read a streamed response from the gateway only as fast as the client reads it when `afterResponse` is set. The whole upstream stream was read straight away and queued in memory, so a slow client made the proxy buffer the entire response.
