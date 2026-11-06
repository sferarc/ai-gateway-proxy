# SvelteKit and Astro routes

Both frameworks pass a `[...path]` rest param as one string, such as `language-model` or `batch/status`, and pass `params` as a plain object. The handler's second argument types `params` as a promise, as Next.js passes it, so wrap it in `Promise.resolve` for `segmentsParam` to read the path.

## SvelteKit

At `src/routes/api/ai/[...path]/+server.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";
import type { RequestHandler } from "./$types";

const proxy = createGatewayProxy({ segmentsParam: "path" });

export const fallback: RequestHandler = ({ request, params }) =>
  proxy(request, { params: Promise.resolve(params) });
```

`fallback` answers every method the file does not export a handler for, so the `POST` model calls and the `GET` reads such as `getAvailableModels` both reach the proxy.

## Astro

At `src/pages/api/ai/[...path].ts`:

```typescript
import type { APIRoute } from "astro";
import { createGatewayProxy } from "ai-gateway-proxy";

export const prerender = false;

const proxy = createGatewayProxy({ segmentsParam: "path" });

export const ALL: APIRoute = ({ request, params }) =>
  proxy(request, { params: Promise.resolve(params) });
```

The route runs on demand, so the project needs a server adapter. `prerender = false` keeps it from being built as a static file under the default `static` output; with `output: "server"` it can go.
