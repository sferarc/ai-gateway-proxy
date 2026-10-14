---
"ai-gateway-proxy": patch
---

Describe in the option and auth doc comments what the proxy does: the default `baseUrl`, which headers override `headers`, the path `extractPath` must return, how `onError` and `afterResponse` results are sent, when authentication yields 500, and that the handler takes a Fetch `Request`.
