---
"ai-gateway-proxy": patch
---

Return `500 Error proxying request to AI Gateway` instead of rejecting when a successful upstream body is not JSON, or when `afterResponse` or `onError` throws on a non-streamed request.
