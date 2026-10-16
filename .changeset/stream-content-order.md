---
"ai-gateway-proxy": patch
---

Keep streamed `afterResponse` content in the order each part first arrived, matching the non-streaming response, and keep text or reasoning deltas whose start part is missing instead of dropping them.
