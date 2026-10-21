---
"ai-gateway-proxy": patch
---

Forward the upstream `finish` event when a streamed `afterResponse` returns `undefined` or `null`, as when it throws, instead of erroring the client stream.
