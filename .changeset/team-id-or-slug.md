---
"ai-gateway-proxy": minor
---

Add a `teamIdOrSlug` option that sends `x-vercel-ai-gateway-team` on every upstream request, so a credential that can access several teams, such as a Vercel access token, is scoped to one team as `@ai-sdk/gateway` does.
