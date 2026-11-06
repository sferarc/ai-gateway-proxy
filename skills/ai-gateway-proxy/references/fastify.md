# Fastify route

Fastify reaches the same `handle` as the Express adapter in [express.md](express.md) through `request.raw` and `reply.raw`, the `node:http` objects underneath. Move `handle` and its `proxy` from that adapter into their own module, here `./gateway-handle.ts`, and export `handle`. Do not register the Express route as is: Fastify parses JSON bodies before the route runs, which leaves the proxy nothing to read. The route lives in a plugin whose content type parser leaves the body unread for the proxy:

```typescript
import type { FastifyInstance } from "fastify";
import { handle } from "./gateway-handle";

export async function gatewayRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, _payload, done) => done(null));

  app.all("/api/ai/*", async (request, reply) => {
    reply.hijack();
    await handle(request.raw, reply.raw);
  });
}
```

Register it with `app.register(gatewayRoutes)`. The plugin keeps the parser change to its own routes, so the rest of the app still gets parsed JSON bodies, and `reply.hijack()` stops Fastify from sending a reply of its own while `handle` writes the response.

This is the route from the package README, where a test runs it in a real Fastify app between a real `@ai-sdk/gateway` client and a fake gateway.
