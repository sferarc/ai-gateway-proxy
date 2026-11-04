---
"ai-gateway-proxy": minor
---

Let `headers` be a function of the incoming request, as `apiKey` and `teamIdOrSlug` are, so a proxy serving several callers can send per-caller upstream headers. A `null` or `undefined` result sends none; a throw or a result that is not an object of strings answers 500 `proxy_error` without calling the gateway.
