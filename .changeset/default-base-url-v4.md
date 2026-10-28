---
"ai-gateway-proxy": minor
---

Default `baseUrl` to `https://ai-gateway.vercel.sh/v4/ai`, the endpoint `@ai-sdk/gateway` 4.x calls on its own. The gateway versions its endpoint by AI SDK specification version, and the old default `/v1/ai` is the one `@ai-sdk/gateway` 1.x and 2.x used for version 2 calls, so version 4 bodies went to the version 2 endpoint. Set `baseUrl` to keep the old endpoint.
