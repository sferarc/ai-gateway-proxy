# Koa route

Koa reaches the same `handle` as the Express adapter in [express.md](express.md) through `ctx.req` and `ctx.res`, the `node:http` objects underneath. Move `handle` and its `proxy` from that adapter into their own module, here `./gateway-handle.ts`, and export `handle`, as for the Fastify route in [fastify.md](fastify.md). Koa itself leaves the body unread, but a body parser such as `@koa/bodyparser` consumes it, which leaves the proxy nothing to forward, so the route is a middleware that runs before the parser:

```typescript
import type { Middleware } from "koa";
import { handle } from "./gateway-handle";

export const gatewayRoute: Middleware = async (ctx, next) => {
  if (!ctx.path.startsWith("/api/ai/")) return next();
  ctx.respond = false;
  await handle(ctx.req, ctx.res);
};
```

Register it with `app.use(gatewayRoute)` ahead of the body parser. Other paths go on to the rest of the app, and `ctx.respond = false` stops Koa from sending a reply of its own once the middleware returns, while `handle` writes the response.

This is the route from the package README, where a test runs it in a real Koa app between a real `@ai-sdk/gateway` client and a fake gateway.
