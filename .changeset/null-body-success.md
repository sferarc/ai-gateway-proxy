---
"ai-gateway-proxy": patch
---

Forward a `204` or `205` upstream response without a body instead of answering 500, and skip `afterResponse` for it.
