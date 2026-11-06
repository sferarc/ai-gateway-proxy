# Nuxt server route

Create a catch-all server route at `server/api/ai/[...path].ts`. Nitro passes the rest of the path as the `path` router param, one string such as `batch/status`. A server route gets an h3 event rather than a Fetch `Request`, so `toWebRequest` builds one from it:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({ segmentsParam: "path" });

export default defineEventHandler((event) =>
  proxy(toWebRequest(event), { params: Promise.resolve(getRouterParams(event)) }),
);
```

`defineEventHandler`, `toWebRequest` and `getRouterParams` are auto-imported in server routes, from the h3 v1 that Nuxt 3 and 4 ship. A file without a method suffix such as `.post.ts` answers every method, so the `POST` model calls and the `GET` reads such as `getAvailableModels` both reach the proxy, and h3 streams the returned `Response` back as the gateway sends it.
