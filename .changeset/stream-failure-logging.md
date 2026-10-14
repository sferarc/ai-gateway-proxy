---
"ai-gateway-proxy": patch
---

Log when a streamed response fails mid-stream, ends without a `finish` event (so `afterResponse` is not called), or carries a non-JSON event. Client cancellations are not logged, and event payloads never are.
