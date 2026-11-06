# Cloudflare Workers

A Worker gets its secrets as the `env` argument of `fetch` and has no Vercel OIDC, so the proxy takes the key with `apiKey` and is created inside `fetch`, where `env` is in reach. The Worker passes no catch-all params either, so the proxy takes the path from the URL with `extractPath`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

interface Env {
  AI_GATEWAY_API_KEY: string;
}

export default {
  fetch(request: Request, env: Env) {
    if (!new URL(request.url).pathname.startsWith("/api/ai/")) {
      return new Response("Not found", { status: 404 });
    }
    const proxy = createGatewayProxy({
      apiKey: () => env.AI_GATEWAY_API_KEY,
      extractPath: (request) => {
        const url = new URL(request.url);
        return url.pathname.replace(/^\/api\/ai\//, "");
      },
    });
    return proxy(request);
  },
};
```

Store the key with `npx wrangler secret put AI_GATEWAY_API_KEY`. The function form of `apiKey` never falls back to `process.env` or OIDC, so a missing secret answers 500 `api_key_missing` instead of looking elsewhere.

Call the proxy with the request alone: `fetch` also gets `env` and the execution context, neither of which is the `{ params }` context the handler takes.

This is the Worker from the package README, where a test calls its `fetch` with an `env` and an execution context between a real `@ai-sdk/gateway` client and a fake gateway, while `process.env` holds a different key that must never reach the gateway.
