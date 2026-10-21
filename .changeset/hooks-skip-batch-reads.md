---
"ai-gateway-proxy": patch
---

Run no hook on the batch calls that read or cancel a job (a path ending in `batch/status`, `batch/results` or `batch/cancel`). They send no model header and post only a batch id, so the hooks ran on them, and an `afterResponse` reading `response.usage.inputTokens` threw on a batch status body and the call came back as 500.
