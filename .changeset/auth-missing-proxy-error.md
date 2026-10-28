---
"ai-gateway-proxy": patch
---

Type the 500 the proxy returns when it has no gateway credential as `proxy_error` instead of `authentication_error`. A client built on `@ai-sdk/gateway` replaced an `authentication_error` message with advice about its own API key, so it never saw that the proxy's `AI_GATEWAY_API_KEY` or OIDC token was missing.
