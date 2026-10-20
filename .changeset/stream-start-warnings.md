---
"ai-gateway-proxy": patch
---

With `afterResponse` set, a streamed `stream-start` event whose `warnings` is missing or not an array is now forwarded unchanged and adds no warnings, instead of erroring the client stream.
