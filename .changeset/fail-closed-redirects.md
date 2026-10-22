---
"ai-gateway-proxy": patch
---

Stop following redirects from the upstream call and return `502 Upstream redirected, the proxy does not follow redirects`, so the gateway credential is never sent to another host. Return `500` when `afterResponse` returns a value that is not an object instead of forwarding it.
