---
"ai-gateway-proxy": minor
---

Add an `apiKey` option to `createGatewayProxy`: a string, or a function of the incoming request that returns the gateway API key, resolved on every request. When set it replaces `AI_GATEWAY_API_KEY` and Vercel OIDC, and an empty result or a throw answers 500 `proxy_error` without calling the gateway.
