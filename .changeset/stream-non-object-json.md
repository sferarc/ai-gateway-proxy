---
"ai-gateway-proxy": patch
---

With `afterResponse` set, a streamed event whose data is valid JSON but not an object, such as `null`, is now forwarded unchanged like non-JSON data instead of erroring the client stream.
