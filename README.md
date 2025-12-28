# ai-gateway-proxy

A lightweight proxy handler for [Vercel AI Gateway](https://vercel.com/docs/ai/ai-gateway).

## Features

- **Request/Response Hooks** - Transform requests and responses with `beforeRequest`, `afterResponse`, and `onError` hooks
- **Streaming Support** - Full SSE streaming with content aggregation using AI SDK V3 protocol
- **Next.js Integration** - Works seamlessly with Next.js App Router catch-all routes

## Installation

```bash
npm install ai-gateway-proxy
```

```bash
pnpm add ai-gateway-proxy
```

```bash
yarn add ai-gateway-proxy
```

## Quick Start

Create a catch-all route at `app/api/ai/[...segments]/route.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

export const { GET, POST, PUT, DELETE, PATCH } = createGatewayProxy();
```

## Authentication

The proxy automatically handles authentication using one of the following methods (in priority order):

### API Key

Set the `AI_GATEWAY_API_KEY` environment variable:

```bash
AI_GATEWAY_API_KEY=your-api-key
```

### OIDC (Vercel)

When deployed on Vercel, the proxy automatically uses [Vercel OIDC](https://vercel.com/docs/security/oidc) for authentication. No additional configuration is required.

## Configuration

### Custom Base URL

```typescript
createGatewayProxy({
  baseUrl: "https://ai-gateway.vercel.sh/v1/ai",
});
```

### Additional Headers

```typescript
createGatewayProxy({
  headers: {
    "x-custom-header": "value",
  },
});
```

### Request Transformation

Transform the request body before sending to the gateway:

```typescript
createGatewayProxy({
  beforeRequest: ({ request }) => {
    // Modify the request body
    return {
      ...request,
      // Add custom modifications
    };
  },
});
```

### Response Transformation

Transform the response after receiving from the gateway. For streaming responses, this is called when the stream completes with aggregated content:

```typescript
createGatewayProxy({
  afterResponse: ({ request, response }) => {
    // Log usage, modify metadata, etc.
    console.log("Usage:", response.usage);
    return response;
  },
});
```

### Error Handling

Custom error handling with the `onError` hook:

```typescript
createGatewayProxy({
  onError: ({ request, error, status }) => {
    // Log errors, modify error response, or return a custom Response
    console.error("Gateway error:", error);

    // Return modified error
    return error;

    // Or return a custom Response
    // return new Response("Custom error", { status: 500 });
  },
});
```

## API Reference

### `createGatewayProxy(options?)`

Creates a proxy handler for the AI Gateway.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `"https://ai-gateway.vercel.sh/v1/ai"` | The base URL of the AI Gateway |
| `headers` | `Record<string, string>` | `{}` | Additional headers to include in requests |
| `beforeRequest` | `(ctx) => request` | - | Transform request before sending |
| `afterResponse` | `(ctx) => response` | - | Transform response after receiving |
| `onError` | `(ctx) => error \| Response` | - | Custom error handling |

#### Returns

A handler function with named exports for HTTP methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`.

### `getGatewayAuthToken()`

Retrieves the authentication token for the AI Gateway.

```typescript
import { getGatewayAuthToken } from "ai-gateway-proxy";

const auth = await getGatewayAuthToken();
// { token: "...", authMethod: "api-key" | "oidc" }
```

### `StreamContentAggregator`

Aggregates streaming content into a complete response. Used internally by the proxy for `afterResponse` hooks on streaming requests.

```typescript
import { StreamContentAggregator } from "ai-gateway-proxy";

const aggregator = new StreamContentAggregator();
aggregator.process(streamPart);
const response = aggregator.getResponse();
```

### `createStreamTransformer(body, requestBody, afterResponse)`

Creates a transform stream that passes through SSE events while aggregating content and calling the `afterResponse` hook on completion.

## Types

```typescript
import type {
  CreateGatewayProxyOptions,
  CreateGatewayProxyFn,
  CreateGatewayProxyResult,
  GatewayResponse,
  GatewayError,
} from "ai-gateway-proxy";
```

## License

MIT
