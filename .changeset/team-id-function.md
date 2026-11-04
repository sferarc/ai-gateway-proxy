---
"ai-gateway-proxy": minor
---

Let `teamIdOrSlug` be a function of the incoming request, as `apiKey` is, so a proxy holding one multi-team Vercel token can pick the team per caller. An empty, `null` or `undefined` result sends no team; a throw or a result that is not a string answers 500 `proxy_error` without calling the gateway.
