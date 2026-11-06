# Bun and Deno servers

`Bun.serve` and `Deno.serve` take Fetch handlers, so the proxy needs no adapter. Neither passes catch-all params, so the proxy takes the path from the URL with `extractPath`, and the handler is called with the request alone: each runtime passes a second argument of its own, which is not the `{ params }` context the handler takes.

## Bun

`Bun.serve` routes the wildcard to the proxy (Bun 1.2.3 or later):

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({
  extractPath: (request) => {
    const url = new URL(request.url);
    return url.pathname.replace(/^\/api\/ai\//, "");
  },
});

Bun.serve({
  routes: {
    "/api/ai/*": (request) => proxy(request),
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
```

Bun calls a route with the server as its second argument, so `routes: { "/api/ai/*": proxy }` would hand the proxy the server as its context.

## Deno

`Deno.serve` calls one handler for every request, so it checks the path before handing the request to the proxy:

```typescript
import { createGatewayProxy } from "npm:ai-gateway-proxy";

const proxy = createGatewayProxy({
  extractPath: (request) => {
    const url = new URL(request.url);
    return url.pathname.replace(/^\/api\/ai\//, "");
  },
});

Deno.serve((request) => {
  if (new URL(request.url).pathname.startsWith("/api/ai/")) return proxy(request);
  return new Response("Not found", { status: 404 });
});
```

Run it with `deno run --allow-net --allow-env server.ts`: without `--allow-env` the proxy cannot read `AI_GATEWAY_API_KEY`. Deno's second argument is the connection info, so pass the request alone here too.

These are the servers from the package README, where a test runs each with the runtime stubbed between a real `@ai-sdk/gateway` client and a fake gateway.
