---
"ai-gateway-proxy": patch
---

Log when a streamed response fails mid-stream, or carries a non-JSON event. Client cancellations are not logged unless the hook throws, and event payloads never are.
