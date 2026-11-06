# TanStack Start server route

In TanStack Start, a file route with `server.handlers` answers requests directly. Create a splat route at `src/routes/api/ai/$.ts`, which passes the rest of the path as one string in `params._splat`, such as `language-model` or `batch/status`. `params` is a plain object, so wrap it in `Promise.resolve` for `segmentsParam: "_splat"` to read the path:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({ segmentsParam: "_splat" });

export const Route = createFileRoute("/api/ai/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, { params: Promise.resolve(params) }),
      POST: ({ request, params }) => proxy(request, { params: Promise.resolve(params) }),
    },
  },
});
```

`GET` answers the reads such as `getAvailableModels`, and `POST` the model calls; the gateway client sends no other method.
