# ai-gateway-proxy

A lightweight proxy handler for [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

## Features

- **Request/Response Hooks** - Transform requests and responses with `beforeRequest`, `afterResponse`, and `onError` hooks
- **Streaming Support** - Full SSE streaming with content aggregation using AI SDK V3 protocol
- **Framework Agnostic** - Works with Next.js, Hono, Express, and other frameworks

## Installation

```bash
npm install ai-gateway-proxy
```

## Quick Start

### Next.js App Router

Create a catch-all route at `app/api/ai/[...segments]/route.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

export const { GET, POST, PUT, DELETE, PATCH } = createGatewayProxy();
```

### Hono / Other Frameworks

For frameworks without catch-all route support, use the `extractPath` option:

```typescript
import { Hono } from "hono";
import { createGatewayProxy } from "ai-gateway-proxy";

const app = new Hono();

const proxy = createGatewayProxy({
  extractPath: (request) => {
    const url = new URL(request.url);
    return url.pathname.replace(/^\/api\/ai\//, "");
  },
});

app.all("/api/ai/*", (c) => proxy(c.req.raw));
```

## Authentication

The proxy automatically handles authentication using one of the following methods (in priority order):

1. **API Key** - Set `AI_GATEWAY_API_KEY` environment variable
2. **OIDC** - Automatic when deployed on Vercel

## Documentation

For full documentation including configuration options, hooks, and API reference, see the [documentation](https://sferadev.com/docs/packages/ai-gateway-proxy).

## License

MIT

## Development

The toolchain is pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed:

```bash
mise install
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

The integration tests call the real AI Gateway and run only when `AI_GATEWAY_API_KEY` is set. Add a changeset with `pnpm changeset` for any change that should be released.
