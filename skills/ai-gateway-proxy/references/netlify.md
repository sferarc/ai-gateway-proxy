# Netlify Functions

A Netlify Function takes a Fetch `Request` and is routed by the `path` in its exported `config`, so the function file, such as `netlify/functions/ai.mts`, is the proxy with `extractPath` under a wildcard path:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({
  extractPath: (request) => {
    const url = new URL(request.url);
    return url.pathname.replace(/^\/api\/ai\//, "");
  },
});

export default (request: Request) => proxy(request);

export const config = { path: "/api/ai/*" };
```

Netlify has no Vercel OIDC, so set `AI_GATEWAY_API_KEY` in the site's environment variables with the Functions scope; the proxy reads it from `process.env`. Without it the proxy answers 500 `auth_not_configured`.

Call the proxy with the request alone: Netlify passes its `Context` as the second argument, and its `params` holds the path's named groups, not the `{ params }` context with `segments` the handler takes.

This is the function from the package README, where a test matches its `config.path` with `URLPattern` as Netlify does and calls it with a Netlify-like `Context` between a real `@ai-sdk/gateway` client and a fake gateway.
