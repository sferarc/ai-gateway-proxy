---
"ai-gateway-proxy": patch
---

The `afterRawResponse` doc comment says a failed hook after a successful call is answered with a 424 `proxy_error`, the status the proxy sends since the gateway's billed answer stopped being retried, and keeps the 500 for an upstream error status.
