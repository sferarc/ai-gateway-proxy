---
"ai-gateway-proxy": patch
---

The `afterResponse` doc comment says an invalid non-streamed result is answered with a 424 `proxy_error`, the status the proxy has sent since the gateway's billed answer stopped being retried, instead of a 500.
