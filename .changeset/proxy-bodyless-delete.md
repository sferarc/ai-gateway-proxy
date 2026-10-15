---
"ai-gateway-proxy": patch
---

Forward a request with no body, such as a bodyless `DELETE`, upstream without one instead of returning `400 Invalid JSON body`.
