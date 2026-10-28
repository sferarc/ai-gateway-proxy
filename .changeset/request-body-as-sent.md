---
"ai-gateway-proxy": patch
---

Forward the request body as the client sent it when neither `beforeRequest` nor `beforeRawRequest` receives it, instead of parsing and serialising it again. The round trip rounded integers past 2^53, such as a large `seed`, and built an extra full-size copy of large bodies such as base64 images or audio.
