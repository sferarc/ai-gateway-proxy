# ai-gateway-proxy

A lightweight proxy handler for [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

## Features

- **Request and response hooks:** transform requests and responses with `beforeRequest`, `afterResponse` and `onError`
- **Streaming:** forwards the gateway's SSE stream as it arrives and gives `afterResponse` the aggregated result when the stream finishes (AI SDK V4 protocol)
- **Fetch handler:** takes a Fetch `Request` and returns a `Response`, so it plugs into Next.js and Hono directly and into Express or `node:http` through a small adapter

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

The handler reads the path from the route's `segments` param. For a differently named catch-all, such as `app/api/ai/[...path]/route.ts`, pass `createGatewayProxy({ segmentsParam: "path" })`.

### Hono

For frameworks without catch-all route params, use the `extractPath` option:

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

### Express

The handler takes a Fetch `Request`, not an Express `req`, so convert in both directions. Register the route before any body parser such as `express.json()`, which would consume the body the proxy needs to read.

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import express from "express";
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({
  extractPath: (request) => new URL(request.url).pathname.replace(/^\/api\/ai\//, ""),
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(new URL(req.url ?? "/", `http://${req.headers.host}`), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: "half",
    signal: controller.signal,
  } as RequestInit);

  const response = await proxy(request);

  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  // Rejects when the client disconnects mid-stream; the abort above has already cancelled upstream.
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), res).catch(() => {});
}

const app = express();
app.all("/api/ai/*splat", handle);
app.listen(3000);
```

`/api/ai/*splat` is Express 5 syntax; Express 4 uses `/api/ai/*`. `handle` only uses `node:http` types, so it also works as a plain `createServer(handle)` callback.

### Client

Point the AI SDK's gateway provider at the route. It sends `ai-language-model-streaming: true` for `streamText` and the like, which is how the proxy knows to stream.

```typescript
import { createGateway } from "@ai-sdk/gateway";
import { generateText } from "ai";

const gateway = createGateway({
  baseURL: "https://your-app.example.com/api/ai",
  // The proxy adds the real credentials upstream.
  apiKey: "unused",
});

const { text } = await generateText({
  model: gateway("openai/gpt-5"),
  prompt: "Hello",
});
```

## Authentication

The proxy gets a credential on every request with `getGatewayAuthToken()`, in this order:

1. **API key:** the `AI_GATEWAY_API_KEY` environment variable
2. **OIDC:** a Vercel OIDC token, available when deployed on Vercel

`getGatewayAuthToken()` is exported. It resolves to `{ token, authMethod: "api-key" | "oidc" }`, or `null` when neither is available, in which case the proxy answers `500 AI Gateway authentication not configured`. The proxy sends the token upstream as `authorization: Bearer <token>` with `ai-gateway-auth-method`, so the credential never reaches the client.

## Options

`createGatewayProxy(options?)` returns a handler `(request: Request, context?) => Promise<Response>`. The same function is also exposed as its `GET`, `POST`, `PUT`, `DELETE` and `PATCH` properties.

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | `https://ai-gateway.vercel.sh/v1/ai` | Gateway URL that the extracted path and the incoming query string are appended to. |
| `headers` | none | Extra headers for every upstream request. The proxy's own `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version` override entries with the same name in any casing, as does `content-type` on requests with a body. On requests with a body, the incoming request's `ai-language-model-*`, `ai-model-id` and `ai-*-model-specification-version` headers replace any entries describing the model call, and its `ai-o11y-*`, `idempotency-key` and `accept` headers override entries with the same name. No other incoming header is forwarded, so the client's `authorization` and cookies never reach the gateway. |
| `segmentsParam` | `"segments"` | Name of the catch-all route param read from `context.params` when `extractPath` is not set, joined with `/`. Use `"path"` for `app/api/ai/[...path]/route.ts`. |
| `extractPath` | none | `(request) => string \| Promise<string>`. Returns the upstream path relative to `baseUrl`, such as `language-model`. Takes precedence over `segmentsParam`. |
| `beforeRequest` | none | `({ request }) => LanguageModelV4CallOptions`. Receives the parsed JSON body and returns the body to send upstream. |
| `afterResponse` | none | `({ request, response }) => GatewayResponse`. Runs on a successful response; see below. |
| `onError` | none | `({ request, error, status }) => GatewayError \| Response`. Runs when the gateway returns a non-OK status; see below. |

Each hook may also return a promise. The hooks are typed for language model calls and run only for requests with a body. A `GET` or `HEAD` request, such as the provider's `GET /config` model list, and any other request whose body is missing or empty, such as a bodyless `DELETE`, is forwarded without a body and without running any hook, and the upstream status and body come back unchanged, except that a redirect is answered with a 502 as below. A request carrying `ai-model-id`, which `@ai-sdk/gateway` sends on every model call but a language model's (embedding, image, video, speech, transcription, reranking, decision and batch start), is forwarded with its body and runs no hook either, since its body and response are not language model ones. A request that also carries `ai-language-model-id`, or whose path ends in `language-model` once case, percent-encoding, repeated or trailing slashes and `;` parameters are folded away, is a language model call and runs every hook, so a client cannot turn the hooks off by adding `ai-model-id` or by dropping `ai-language-model-id`. The batch calls that read or cancel a job, whose upstream path ends in `batch/status`, `batch/results` or `batch/cancel`, send neither header and post only a batch id, so they run no hook either. Any other request with a body and neither header runs the hooks.

The path, whether from `extractPath` or the route param, must stay relative: one that starts with `/`, contains `://`, or has a segment that decodes to `.` or `..` or contains `/`, `\` or a NUL byte is rejected with `400 Invalid path` before anything is sent upstream.

### `afterResponse`

- **Non-streamed responses:** receives the gateway's JSON body as `response`, and the value it returns is sent to the client instead. The value must be a JSON object; a primitive, an array or a function is a 500, and `undefined` or `null` forwards the upstream body.
- **Streamed responses:** every event is forwarded to the client as it arrives. When the `finish` event comes, the hook receives the aggregated response, and the `finishReason`, `usage` and `providerMetadata` it returns replace those in the `finish` event; content changes have no effect because the content has already been sent. If the hook throws, the error is logged and the original `finish` event is forwarded. If the stream ends without a `finish` event, the hook does not run.
- **Event streams and JSON Lines on other calls:** a successful `text/event-stream` or JSON Lines (`application/x-ndjson`, `application/jsonl`) response to a request without `ai-language-model-streaming: true`, such as the video model's `doGenerate` or the batch API's `doGetBatchResults`, is forwarded as is and the hook does not run, since it is not a language model response.

### `onError`

Receives `{ request, error, status }`, where `error` is the gateway's JSON error body. When the body is not JSON of the form `{ error: { message } }`, such as an HTML page from a load balancer, `error` is `{ error: { message: "AI Gateway returned <status>: <excerpt>", type: "gateway_error" } }`, with the first 200 characters of the body as the excerpt. Return a replacement body to send it as JSON with the upstream status, or return a `Response` to send that as is. Without `onError`, the error body is sent with the upstream status.

## Responses the proxy generates

Apart from forwarding the gateway's own responses, the handler can answer with:

| Status | Body | When |
| --- | --- | --- |
| 500 | `AI Gateway authentication not configured` | `getGatewayAuthToken()` returned `null`. |
| 400 | `Invalid path` | The path is not a safe relative path under `baseUrl`. |
| 400 | `Invalid JSON body` | A request other than `GET` or `HEAD` has a non-empty body that is not JSON. |
| 499 | empty | The client aborted the request (`request.signal`) before the handler returned. The signal is passed to the upstream `fetch`, so the abort also cancels the upstream request. |
| 500 | `Error proxying request to AI Gateway` | Anything else that throws: `extractPath`, `beforeRequest`, the upstream `fetch`, a successful non-streamed response that is not JSON, `afterResponse` on a non-streamed request, or `onError`. |
| 500 | `No response body` | A successful streamed response arrived without a body. |
| 502 | `Upstream redirected, the proxy does not follow redirects` | The gateway answered with a 3xx status. The proxy sets `redirect: "manual"`, runs no `onError` and forwards no `Location`. |

## Other exports

- `createStreamTransformer(body, request, afterResponse)` and `StreamContentAggregator`: the pieces the proxy uses to run `afterResponse` on a stream, for building your own streaming handler.
- Types: `CreateGatewayProxyOptions`, `CreateGatewayProxyFn`, `CreateGatewayProxyResult`, `GatewayResponse`, `GatewayError` and `GatewayAuthToken`.

## Documentation

More guides are on the [documentation site](https://sferadev.com/docs/packages/ai-gateway-proxy). Where it differs from this README, this README matches the code.

## Development

The toolchain is pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed:

```bash
mise install
pnpm install --frozen-lockfile
pnpm check
```

The integration tests call the real AI Gateway and run only when `AI_GATEWAY_API_KEY` is set (`pnpm test:integration`). Add a changeset with `pnpm changeset` for any change that should be released.

## License

MIT
