# ai-gateway-proxy

For apps whose [AI SDK](https://ai-sdk.dev) code runs where a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key must not live: a browser, a mobile or desktop app, or code a third party runs. The client calls a route in your app, and ai-gateway-proxy forwards the call to the gateway from your server.

- **The gateway credential stays on the server:** the proxy authenticates with an API key or Vercel OIDC and never sends it to the client ([Authentication](#authentication)).
- **You decide who may call:** your route can check the caller's session or token before handing the call to the proxy ([Protecting the route](#protecting-the-route)).
- **Each call can be capped, metered, rewritten or refused:** `beforeRequest`, `afterResponse` and `onError` handle language model calls, and `beforeRawRequest` and `afterRawResponse` the other calls (embedding, image, video, speech, transcription, reranking, decision, batch start) ([Example: cap, meter and mask](#example-cap-meter-and-mask), [Refusing a call](#refusing-a-call), [Raw hooks](#raw-hooks)).
- **Streams are forwarded as they arrive:** each SSE event reaches the client as the gateway sends it, and `afterResponse` gets the aggregated result when the stream finishes ([`afterResponse`](#afterresponse)).

The handler takes a Fetch `Request` and returns a `Response`, so it plugs into Next.js, Hono, `Bun.serve`, `Deno.serve`, Cloudflare Workers, Netlify Functions, SvelteKit, Astro, React Router and TanStack Start directly, into Nuxt through h3's `toWebRequest`, and into Express, Fastify, Koa or `node:http` through a small adapter ([Quick Start](#quick-start)).

## When you do not need it

If every model call already runs on your own server, such as in a route handler, a server action or a background job, call the gateway there with the AI SDK's [AI Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) and skip the proxy. That provider reads `AI_GATEWAY_API_KEY` or the Vercel OIDC token on the server itself, so the key never leaves it, and any check or metering is your own code around `generateText` or `streamText`.

The proxy is for the other cases: a client that must not hold the key, or calls from several clients that you want to check, cap or meter in one place.

It does not carry every gateway call either. Streaming speech, streaming transcription and realtime open WebSockets, which the HTTP-only handler cannot carry, and the credits, spend report, generation info and `getToken` calls go to your app's origin instead of the route ([Protecting the route](#protecting-the-route) lists each one).

## Installation

```bash
npm install ai-gateway-proxy
```

To have a coding agent set it up, install the [agent skill](skills/ai-gateway-proxy/SKILL.md) with `npx skills add sferarc/ai-gateway-proxy`. It covers when the proxy is needed, the route per framework, the client, protecting the route and metering, without loading this README.

## Quick Start

### Next.js App Router

Create a catch-all route at `app/api/ai/[...segments]/route.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

export const { GET, POST, PUT, DELETE, PATCH } = createGatewayProxy();
```

The handler reads the path from the route's `segments` param. For a differently named catch-all, such as `app/api/ai/[...path]/route.ts`, pass `createGatewayProxy({ segmentsParam: "path" })`.

[`examples/nextjs`](examples/nextjs) is a runnable App Router app built on this route: it checks the caller as in [Protecting the route](#protecting-the-route), caps each caller's output tokens with `beforeRequest`, charging the cap until `afterResponse` reports the usage so a cancelled stream still counts, and streams from the browser with `streamText`.

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

### Bun

`Bun.serve` takes Fetch handlers too, so the route is the proxy with `extractPath` under a wildcard route (Bun 1.2.3 or later):

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

Pass the request alone: Bun calls a route with the server as its second argument, which is not the `{ params }` context the handler takes.

### Deno

`Deno.serve` calls one Fetch handler for every request, so check the path before handing it to the proxy:

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

Run it with `deno run --allow-net --allow-env server.ts`: without `--allow-env` the proxy cannot read `AI_GATEWAY_API_KEY`. As with Bun, pass the request alone, since Deno's second argument is the connection info.

### Cloudflare Workers

A Worker gets its secrets as the `env` argument of `fetch` and has no Vercel OIDC, so pass the key with `apiKey` and create the proxy inside `fetch`, where `env` is in reach:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

interface Env {
  AI_GATEWAY_API_KEY: string;
}

export default {
  fetch(request: Request, env: Env) {
    if (!new URL(request.url).pathname.startsWith("/api/ai/")) {
      return new Response("Not found", { status: 404 });
    }
    const proxy = createGatewayProxy({
      apiKey: () => env.AI_GATEWAY_API_KEY,
      extractPath: (request) => {
        const url = new URL(request.url);
        return url.pathname.replace(/^\/api\/ai\//, "");
      },
    });
    return proxy(request);
  },
};
```

Store the key with `npx wrangler secret put AI_GATEWAY_API_KEY`. The function form of `apiKey` never falls back to `process.env` or OIDC, so a missing secret answers 500 `api_key_missing` instead of looking elsewhere. Call the proxy with the request alone: `fetch` also gets `env` and the execution context, neither of which is the `{ params }` context the handler takes.

### Netlify Functions

A Netlify Function takes a Fetch `Request` and routes by its `config.path`, so a function file such as `netlify/functions/ai.mts` is the proxy with `extractPath` under a wildcard path:

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

Netlify has no Vercel OIDC, so set `AI_GATEWAY_API_KEY` in the site's environment variables with the Functions scope; the proxy reads it from `process.env`. Pass the request alone: Netlify calls the function with its `Context` as the second argument, whose `params` holds the path's named groups, not the `segments` the handler would read.

### SvelteKit

Create a rest route at `src/routes/api/ai/[...path]/+server.ts`. SvelteKit passes `params.path` as one string such as `language-model`, which `segmentsParam` reads once the params are wrapped in a promise:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";
import type { RequestHandler } from "./$types";

const proxy = createGatewayProxy({ segmentsParam: "path" });

export const fallback: RequestHandler = ({ request, params }) =>
  proxy(request, { params: Promise.resolve(params) });
```

`fallback` answers every method the file does not export a handler for, so the `POST` model calls and the `GET` reads such as `getAvailableModels` both reach the proxy.

### Astro

Create a rest route at `src/pages/api/ai/[...path].ts`. Astro also passes `params.path` as one string:

```typescript
import type { APIRoute } from "astro";
import { createGatewayProxy } from "ai-gateway-proxy";

export const prerender = false;

const proxy = createGatewayProxy({ segmentsParam: "path" });

export const ALL: APIRoute = ({ request, params }) =>
  proxy(request, { params: Promise.resolve(params) });
```

The route runs on demand, so the project needs a server adapter. `prerender = false` keeps it from being built as a static file under the default `static` output; with `output: "server"` it can go.

### React Router

In React Router framework mode, a route module that exports `loader` and `action` and no component answers requests directly. Create `app/routes/ai-proxy.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";
import type { Route } from "./+types/ai-proxy";

const proxy = createGatewayProxy({ segmentsParam: "*" });

export const loader = ({ request, params }: Route.LoaderArgs) =>
  proxy(request, { params: Promise.resolve(params) });

export const action = ({ request, params }: Route.ActionArgs) =>
  proxy(request, { params: Promise.resolve(params) });
```

Then register it as a splat route in `app/routes.ts`, which passes the rest of the path as `params["*"]`:

```typescript
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // ...your other routes
  route("api/ai/*", "routes/ai-proxy.ts"),
] satisfies RouteConfig;
```

`loader` answers the `GET` reads such as `getAvailableModels`, and `action` the `POST` model calls.

### TanStack Start

In TanStack Start, a file route with `server.handlers` answers requests directly. Create a splat route at `src/routes/api/ai/$.ts`, which passes the rest of the path as `params._splat`:

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

### Nuxt

Create a catch-all server route at `server/api/ai/[...path].ts`. Nitro passes the rest of the path as the `path` router param, one string such as `batch/status`. A server route gets an h3 event rather than a Fetch `Request`, so `toWebRequest` builds one from it:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({ segmentsParam: "path" });

export default defineEventHandler((event) =>
  proxy(toWebRequest(event), { params: Promise.resolve(getRouterParams(event)) }),
);
```

`defineEventHandler`, `toWebRequest` and `getRouterParams` are auto-imported in server routes, from the h3 v1 that Nuxt 3 and 4 ship. A file without a method suffix such as `.post.ts` answers every method, so the `POST` model calls and the `GET` reads such as `getAvailableModels` both reach the proxy, and h3 streams the returned `Response` back as the gateway sends it.

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

### Fastify

Fastify reaches the same `handle` through `request.raw` and `reply.raw`, the `node:http` objects underneath. Move `handle` and its `proxy` from the Express section into their own module, here `./gateway-handle.ts`, and export `handle`. Fastify parses JSON bodies before the route runs, so the route lives in a plugin whose content type parser leaves the body unread for the proxy:

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

### Koa

Koa reaches the same `handle` through `ctx.req` and `ctx.res`, the `node:http` objects underneath, with `handle` exported from `./gateway-handle` as in the Fastify section. Koa itself leaves the body unread, but a body parser such as `@koa/bodyparser` consumes it, so the route is a middleware that runs before the parser:

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

### Client

Point the AI SDK's gateway provider at the route. It sends `ai-language-model-streaming: true` for `streamText` and the like, which is how the proxy knows to stream.

```typescript
import { createGateway } from "@ai-sdk/gateway";
import { generateText } from "ai";

const gateway = createGateway({
  baseURL: "https://your-app.example.com/api/ai",
  // Reaches your route only: the proxy sends its own credential upstream. See Protecting the route.
  apiKey: "unused",
});

const { text } = await generateText({
  model: gateway("openai/gpt-5"),
  prompt: "Hello",
});
```

### Protecting the route

The proxy authenticates itself to the gateway but does not check who calls it, so a route set up as above answers anyone who can reach it, on your gateway credit. Check the caller before handing the request to the proxy. The client's `apiKey` reaches your route as `authorization: Bearer <apiKey>`, and the proxy replaces that header upstream, so it can carry the caller's own token:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy();

async function handler(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token || !(await isValidSession(token))) {
    // Not authentication_error: @ai-sdk/gateway replaces that message with advice about gateway keys.
    return Response.json(
      { error: { message: "Sign in to use the AI route", type: "invalid_request_error" } },
      { status: 401 },
    );
  }
  return proxy(request, context);
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
```

`isValidSession` stands for your own session or token check. On the client, pass the caller's token as `apiKey`, as in `createGateway({ baseURL, apiKey: sessionToken })`. A rejected call throws a `GatewayInvalidRequestError` with `statusCode` 401 and your message, and the AI SDK does not retry it. Do not reject callers through the `apiKey` option instead: a missing key answers `500`, which clients retry.

Some gateway client calls do not go through the proxy:

- Streaming speech and transcription (the gateway models' `doStream`) open a WebSocket to `speech-model` or `transcription-model` under `baseURL`. The proxy handles HTTP requests only, so it cannot carry those connections. Generating speech or a transcription without streaming does go through the proxy.
- Realtime (`experimental_realtime`) opens a WebSocket to `realtime-model` under `baseURL`, which the proxy cannot carry for the same reason.
- `getCredits()`, `getSpendReport()` and `getGenerationInfo()` request `/v1/credits`, `/v1/report` and `/v1/generation` at the origin of `baseURL`, which is your app's host and not the proxy route.
- `getToken()` on `experimental_realtime`, `experimental_transcription` and `experimental_speech` posts to `/v1/realtime/client-secrets` at the same origin, and the WebSocket URL it returns is under `baseURL`, so neither reaches the proxy.

### Calling from another origin

A page served from another origin than the route, such as `app.example.com` calling `api.example.com`, needs CORS headers on the route. The client sends `authorization`, `content-type` and `ai-*` headers, so the browser first sends an `OPTIONS` preflight, which the proxy does not answer, and the proxy forwards no `access-control-*` header. Answer the preflight and add the headers to every response:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy();
const allowedOrigins = new Set(["https://app.example.com"]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ vary: "origin" });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    // Not safelisted, so without this the AI SDK cannot read the backoff of a cross-origin 429.
    headers.set("access-control-expose-headers", "retry-after, retry-after-ms");
  }
  return headers;
}

export function OPTIONS(request: Request) {
  const headers = corsHeaders(request);
  headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, PATCH");
  // A "*" would not cover authorization, so allow the headers the client asks for.
  headers.set("access-control-allow-headers", request.headers.get("access-control-request-headers") ?? "");
  headers.set("access-control-max-age", "600");
  return new Response(null, { status: 204, headers });
}

async function handler(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  const response = await proxy(request, context);
  const headers = new Headers(response.headers);
  corsHeaders(request).forEach((value, name) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
```

`allowedOrigins` lists the origins of your pages. A stream keeps flowing, since the response body is passed through. The preflight carries no `authorization` header, so when the route is also protected as above, keep `OPTIONS` outside the session check and run the check inside `handler`. CORS only stops a browser page on another origin from reading the answer; it does not stop other callers, so it does not replace that check. Other frameworks need the same headers.

## Authentication

Without the `apiKey` option, the proxy gets a credential on every request with `getGatewayAuthToken()`, in this order:

1. **API key:** the `AI_GATEWAY_API_KEY` environment variable
2. **OIDC:** a Vercel OIDC token, available when deployed on Vercel

`getGatewayAuthToken()` is exported. It resolves to `{ token, authMethod: "api-key" | "oidc" }`, or `null` when neither is available, in which case the proxy answers `500` with a `proxy_error` (see below). The proxy sends the token upstream as `authorization: Bearer <token>` with `ai-gateway-auth-method`, so the credential never reaches the client.

To take the key from somewhere else, such as a secret store or a key per tenant, pass `apiKey`: a string, or a function of the incoming `Request` that returns one or a promise of one. It runs on every request, before the body is read, so read the request's headers or URL, not its body. When `apiKey` is set it replaces the environment variable and OIDC: an empty or missing result, or a throw, answers `500` with a `proxy_error` without calling the gateway, and never falls back to the operator's own credential.

```typescript
const proxy = createGatewayProxy({
  apiKey: async (request) => keyForTenant(request.headers.get("x-tenant-id")),
});
```

## Options

`createGatewayProxy(options?)` returns a handler `(request: Request, context?) => Promise<Response>`. The same function is also exposed as its `GET`, `POST`, `PUT`, `DELETE` and `PATCH` properties.

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `AI_GATEWAY_API_KEY`, then Vercel OIDC | `string \| (request) => string \| undefined \| Promise<...>`. The gateway API key, resolved on every request; see Authentication. |
| `baseUrl` | `https://ai-gateway.vercel.sh/v4/ai` | Gateway URL that the extracted path and the incoming query string are appended to. |
| `headers` | none | Extra headers for every upstream request. The proxy's own `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version` override entries with the same name in any casing, as does `content-type` on requests with a body. On requests with a body, the incoming request's `ai-language-model-*`, `ai-model-id` and `ai-*-model-specification-version` headers replace any entries describing the model call, and its `ai-o11y-*`, `idempotency-key` and `accept` headers override entries with the same name. No other incoming header is forwarded, so the client's `authorization` and cookies never reach the gateway. Like `apiKey`, it may be a function of the incoming request that returns the headers or a promise of them, called on every request, so the headers can follow the caller: a `null` or `undefined` result sends none, and a throw or a result that is not an object of strings answers 500 `proxy_error` without calling the gateway. |
| `teamIdOrSlug` | none | Vercel team ID or slug, sent upstream as `x-vercel-ai-gateway-team` on every request, for a credential that can access several teams, such as a Vercel access token passed as `apiKey`. It overrides a `headers` entry with the same name in any casing. The client's own team header is never forwarded, since the proxy's credential is the one the gateway checks. Like `apiKey`, it may be a function of the incoming request, called on every request, so the team can follow the caller: an empty, `null` or `undefined` result sends no team, and a throw or a result that is not a string answers 500 `proxy_error` without calling the gateway. |
| `fetch` | the global `fetch` | `(input, init) => Promise<Response>`. Sends every upstream request, for instance through an instrumented `fetch` or one with an outbound proxy dispatcher. It receives `redirect: "manual"` and the client's `signal`; honour both, or redirects and client aborts are not handled as described below. A redirect it returns is still refused with a 502. |
| `segmentsParam` | `"segments"` | Name of the catch-all route param read from `context.params` when `extractPath` is not set, joined with `/`. Use `"path"` for `app/api/ai/[...path]/route.ts`. |
| `extractPath` | none | `(request) => string \| Promise<string>`. Returns the upstream path relative to `baseUrl`, such as `language-model`. Takes precedence over `segmentsParam`. |
| `beforeRequest` | none | `({ request, modelId, incomingRequest }) => LanguageModelV4CallOptions \| Response`. Receives the parsed JSON body and returns the body to send upstream. Returning `undefined` or `null` sends the parsed body and logs an error. Any other result that is not an object, such as a string or an array, returns a 500 without calling the gateway. A returned `Response` is sent to the client as is, without calling the gateway or running `afterResponse` or `onError`; see below. |
| `afterResponse` | none | `({ request, modelId, incomingRequest, response }) => GatewayResponse`. Runs on a successful response; see below. |
| `onError` | none | `({ request, modelId, incomingRequest, error, status }) => GatewayError \| Response`. Runs when the gateway returns a non-OK status; see below. |
| `beforeRawRequest` | none | `({ kind, path, modelId, request, incomingRequest }) => unknown`. Runs on the calls that are not language model calls; see below. |
| `afterRawResponse` | none | `({ kind, path, modelId, request, incomingRequest, response }) => Response \| undefined`. Runs on the response to those calls; see below. |

Each hook may also return a promise. `beforeRequest`, `afterResponse` and `onError` are typed for language model calls, and every hook runs only for requests with a body. Their `modelId` is the client's `ai-language-model-id` header, such as `openai/gpt-5`, since the call body does not name the model; it is `undefined` when the request has no such header. Every hook also gets `incomingRequest`, the `Request` the handler was called with, so it can tell who is calling from the request's headers or URL; its body has already been read, so use `request` for the body. A `GET` or `HEAD` request, such as the provider's `GET /config` model list, and any other request whose body is missing or empty, such as a bodyless `DELETE`, is forwarded without a body and without running any hook, and the upstream status and body come back unchanged, except that a redirect is answered with a 502 and a gateway `authentication_error` is retyped as below. A request body that neither `beforeRequest` nor `beforeRawRequest` receives is sent upstream as the client sent it; once either hook runs, the body it returns or leaves in place is serialised again.

Path matching fails closed: the language model hooks run on every request with a body except one whose path relative to `baseUrl` is exactly one of the paths `@ai-sdk/gateway` uses for calls that are not language model calls:

| Path | Call |
| --- | --- |
| `embedding-model`, `image-model`, `video-model`, `video-model/start`, `speech-model`, `transcription-model`, `reranking-model`, `decision-model` | Model calls of the other kinds |
| `batch/start` | Starting a batch |
| `video-model/status`, `batch/status`, `batch/results`, `batch/cancel` | Reading or cancelling a job |

The match is exact and ignores headers, so a request to any other path, including a different spelling of a listed one (`Embedding-Model`, `embedding-model/`, `embedding%2Dmodel`) or a listed path under a further prefix (`ai/embedding-model`), runs the language model hooks, and a client cannot turn them off by sending `ai-model-id` or dropping `ai-language-model-id`. Set `baseUrl` to the URL the client's paths are relative to, so the listed paths match.

The path, whether from `extractPath` or the route param, must stay relative: one that starts with `/`, contains `://`, or has a segment that fails to percent-decode, decodes to `.` or `..` or contains `/`, `\` or a NUL byte is rejected with `400 Invalid path` before anything is sent upstream.

### `afterResponse`

- **Non-streamed responses:** receives the gateway's JSON body as `response`, and the value it returns is sent to the client instead, with the gateway's `usage` when the result has none, as on a stream, since an AI SDK client reads usage from every result. `undefined` or `null` forwards the upstream body. Any other result is checked against `GatewayResponse` (see "Result validation" below), and one that fails is answered with a 424 naming the problem instead of being sent. A hook that throws, or a gateway body that is not a JSON object, is a 424 too. The gateway has already answered, and billed, the call by then, and an AI SDK client retries a 5xx but not a 424, so the call is not paid for again.
- **Streamed responses:** every event is forwarded to the client as it arrives. When the `finish` event comes, the hook receives the aggregated response, and the `finishReason`, `usage` and `providerMetadata` it returns replace those in the `finish` event; content changes have no effect because the content has already been sent. The aggregated response also carries `response`, the `id`, `modelId` and `timestamp` (the ISO string sent over the wire) of the stream's `response-metadata` parts, the latest value of each winning, so a hook can log the provider's response id or the model that answered; it is absent when no part carried them. If the hook throws, or returns a result that fails the check below, `undefined` or `null`, the error is logged and the original `finish` event is forwarded. If the stream ends, fails or is cancelled before its `finish` event, the hook runs once with the content received so far, `incomplete` set (`{ reason: "ended" }`, `{ reason: "error", error }` or `{ reason: "cancelled", cancelReason }`), `response.usage` `undefined` and `response.finishReason` `error` when the read failed or the stream sent an `error` part, `other` otherwise. A client that leaves counts as `cancelled` whether the framework cancels the response body or aborts `request.signal`, and is not logged. Nothing can be rewritten then, so its return value is ignored and a throw is logged. `response.usage` is typed `LanguageModelV4Usage | undefined`, so a hook that meters usage must handle `undefined`.
- **Event streams and JSON Lines on other calls:** a successful `text/event-stream` or JSON Lines (`application/x-ndjson`, `application/jsonl`) response to a request without `ai-language-model-streaming: true`, such as the video model's `doGenerate` or the batch API's `doGetBatchResults`, is forwarded as is and the hook does not run, since it is not a language model response.
- **No content:** a `204` or `205` response is forwarded with no body and no `content-type`, keeping the allowlisted headers, and the hook does not run, since there is no response to pass it.
- **Without the hook:** a successful non-streamed response, like any successful response to a call that skips the hook, is forwarded with the gateway's bytes and `content-type` instead of being parsed and re-serialised, so a large image or video body is not held in memory.

#### Result validation

A result is rejected when it is not an object or when a field is missing or has the wrong type:

- `content`: an array of objects, each with a string `type`
- `finishReason`: an object with a string `unified`, and `raw` a string or absent
- `usage`: absent, or an object whose `inputTokens` and `outputTokens` are objects with number or absent counts; when absent, the gateway's `usage` is sent
- `warnings`: absent or an array; `@ai-sdk/gateway` reads a missing one as none
- `providerMetadata`: absent or an object

`null` is accepted wherever a field may be absent, since a body that went through JSON cannot hold `undefined`. Other fields are not checked and are forwarded as returned. A rejected result is logged with `console.error` as `afterResponse hook returned an invalid response: <problem>`, and on a non-streamed request the client gets the same message as a 424 `proxy_error`.

### `onError`

Receives `{ request, error, status }`, where `error` is the gateway's JSON error body. When the body is not JSON of the form `{ error: { message } }`, such as an HTML page from a load balancer, `error` is `{ error: { message: "AI Gateway returned <status>: <excerpt>", type: "gateway_error" } }`, with the first 200 characters of the body as the excerpt. Return a replacement body to send it as JSON with the upstream status, or return a `Response` to send that as is. Returning `undefined` or `null`, as a hook that only logs does, forwards the error body unchanged, and so does a result that is not of the form `{ error: { message, type?, code? }, generationId? }` with a string `message`, a string or absent `type`, a string, number or absent `code` and a string or absent `generationId`, which an AI SDK client could not parse; the problem is logged. A hook that throws is logged and the error body is forwarded too, so the client keeps the upstream status and `retry-after` rather than a 500 it would retry. A `generationId` you return reaches the client, which appends it to the error message as `[<id>]`. Without `onError`, the error body is sent with the upstream status. An error typed `authentication_error` is about the proxy's own credential, since the client's never reaches the gateway, so the proxy retypes it as `proxy_error` with code `credential_rejected` and prefixes the message with `AI Gateway rejected the proxy's credential: ` before `onError` runs; `@ai-sdk/gateway` would otherwise replace the message with advice about the client's own key. `status` stays the gateway's, such as 401.

### Example: cap, meter and mask

The three language model hooks together: cap output tokens, record usage, and keep upstream server errors from the client. `meter` stands for your own function.

```typescript
createGatewayProxy({
  beforeRequest: ({ request }) => {
    // The body is the client's JSON, so the type does not hold until it is checked here.
    const requested: unknown = request.maxOutputTokens;
    if (requested !== undefined && (!Number.isSafeInteger(requested) || (requested as number) < 1)) {
      return Response.json(
        { error: { message: "maxOutputTokens must be a positive integer", type: "invalid_request_error" } },
        { status: 400 },
      );
    }
    return { ...request, maxOutputTokens: Math.min(request.maxOutputTokens ?? 1024, 1024) };
  },
  afterResponse: async ({ request, modelId, response, incomplete }) => {
    // usage is undefined when a stream ended before its finish event.
    await meter({
      modelId,
      inputTokens: response.usage?.inputTokens.total,
      outputTokens: response.usage?.outputTokens.total,
      maxOutputTokens: request.maxOutputTokens,
      complete: incomplete === undefined,
    });
    return response;
  },
  onError: ({ error, status }) =>
    status >= 500
      ? { error: { message: "The model provider is unavailable", type: "gateway_error" } }
      : error,
});
```

`request` is the client's JSON, so `maxOutputTokens` may be a string, `null`, negative or a fraction; `Math.min` of a string is `NaN`, which reaches the gateway as `null` and lifts the cap, so `beforeRequest` answers 400 to any value that is not a positive integer. `afterResponse` returns `response` unchanged, so the client gets the gateway's body on a non-streamed call and the upstream `finish` event on a stream. `request` is the body after `beforeRequest`, so `maxOutputTokens` is the capped value.

### Refusing a call

To turn a call away before it reaches the gateway, such as when a quota is spent, return a `Response` from `beforeRequest` or `beforeRawRequest`. A hook that throws gets a 500, which an AI SDK client retries, running the hook again each time; a 402 or 403 in the `GatewayError` shape is not retried, and its `message` becomes the client's error message. `hasCredit` stands for your own check of the caller's balance, and `incomingRequest` carries the caller's `authorization` header as in "Protecting the route".

```typescript
createGatewayProxy({
  beforeRequest: async ({ request, modelId, incomingRequest }) =>
    (await hasCredit(incomingRequest.headers.get("authorization"), modelId))
      ? request
      : Response.json(
          { error: { message: "AI credit exhausted", type: "insufficient_funds" } },
          { status: 402 },
        ),
});
```

### Raw hooks

`beforeRawRequest` and `afterRawResponse` run where the language model hooks do not: on a request with a body whose path is exactly one of the model call paths in the table above or `batch/start`. They are untyped, since each kind has its own body. They do not run on the job reads (`video-model/status`, `batch/status`, `batch/results`, `batch/cancel`) or on bodyless requests.

Both receive `kind` (`"embedding"`, `"image"`, `"video"`, `"speech"`, `"transcription"`, `"reranking"`, `"decision"` or `"batch"`), `path` (such as `video-model/start`), `modelId` (the client's `ai-model-id` header, which is the only place an embedding or image call names its model), `request`, the parsed JSON body, and `incomingRequest`, the `Request` the handler was called with.

- **`beforeRawRequest`:** a returned value replaces the body sent upstream; `undefined` or `null` sends it as is. A returned `Response` is sent to the client as is, without calling the gateway or running `afterRawResponse`.
- **`afterRawResponse`:** also receives `response`, the `Response` the proxy would send: the upstream status, `content-type` and the allowlisted headers below, with the upstream body on success (a video call's event stream included) and the `GatewayError` body described under `onError` on a failure. Return a `Response` to send that instead, or nothing to send `response`. The body can be read once, so read `response.clone()` when returning nothing; a hook that reads `response` itself and returns nothing, or returns anything but a `Response`, is a failure like a throw. A failure on a successful `response` is a 424, since the gateway has already answered, and billed, the call and an AI SDK client retries a 5xx but not a 424; on an error `response` it is a 500. When the hook sends another `Response`, throws or returns an invalid result, the proxy cancels `response`'s body unless the hook read it, piped it or built the returned `Response` on it, so the upstream request ends. It does not run on a redirect or when the upstream request fails.

```typescript
createGatewayProxy({
  afterRawResponse: async ({ kind, modelId, response }) => {
    if (kind === "embedding" && response.ok) {
      const { usage } = await response.clone().json();
      await meter(modelId, usage);
    }
  },
});
```

## Responses the proxy generates

Apart from forwarding the gateway's own responses, the handler can answer with a JSON `GatewayError` body, `{ "error": { "message", "type", "code" } }`, with the `type`, `code` and `message` below (`499` has an empty body). Branch on `code`, a `ProxyErrorCode`: it stays the same across releases, while a message may be reworded. `@ai-sdk/gateway` builds the same error from the body with or without it.

| Status | Type | Code | Message | When |
| --- | --- | --- | --- | --- |
| 500 | `proxy_error` | `auth_not_configured` | `AI Gateway authentication not configured: set AI_GATEWAY_API_KEY or deploy on Vercel with OIDC enabled` | `getGatewayAuthToken()` returned `null`. The type is not `authentication_error`, which `@ai-sdk/gateway` replaces with advice about the client's own key. |
| 500 | `proxy_error` | `api_key_missing` | `AI Gateway authentication not configured: the apiKey option gave no key` | The `apiKey` option resolved to an empty or missing key, or threw; the reason is logged without the key. The gateway is not called. |
| 500 | `proxy_error` | `team_option_failed` | `AI Gateway team not configured: the teamIdOrSlug option failed` | The `teamIdOrSlug` function threw or returned something other than a string, `null` or `undefined`; only the error message is logged. The gateway is not called. |
| 500 | `proxy_error` | `headers_option_failed` | `AI Gateway headers not configured: the headers option failed` | The `headers` function threw or returned something other than an object of strings, `null` or `undefined`; only the error message is logged. The gateway is not called. |
| upstream, such as 401 | `proxy_error` | `credential_rejected` | `AI Gateway rejected the proxy's credential: <message>` | The gateway answered with an error typed `authentication_error`, for a call with a body or a bodyless one such as `GET /config`; see `onError` above. The other fields of the error are kept, except `code`, which the proxy sets. |
| 400 | `invalid_request_error` | `invalid_path` | `Invalid path` | The path is not a safe relative path under `baseUrl`. |
| 400 | `invalid_request_error` | `invalid_json_body` | `Invalid JSON body` | A request other than `GET` or `HEAD` has a non-empty body that is not JSON. |
| 400 | `invalid_request_error` | `invalid_request_body` | `Invalid request body: a language model call must be a JSON object` | The body is JSON but not an object, such as an array or `null`, on a path that runs `beforeRequest`, `afterResponse` or `onError`, and one of them is set. No hook runs and the gateway is not called. |
| 499 | none | none | none | The client aborted the request (`request.signal`) before the handler returned. The signal is passed to the upstream `fetch`, so the abort also cancels the upstream request. |
| 500 | `proxy_error` | `proxy_failed` | `Error proxying request to AI Gateway` | Anything else that throws: `extractPath`, `beforeRequest`, `beforeRawRequest`, the upstream `fetch`, or an `afterRawResponse` failure on an error response. To refuse a call without a retryable 500, return a `Response` from the request hook instead (see "Refusing a call"). |
| 500 | `proxy_error` | `before_request_invalid` | `beforeRequest hook returned an invalid request: the result must be an object` | `beforeRequest` returned a value other than an object, `undefined` or `null`. The gateway is not called. |
| 424 | `proxy_error` | `after_response_failed` | `Error processing the AI Gateway response` | After the gateway answered a non-streamed call with `afterResponse` set: `afterResponse` threw, or the success body was not a JSON object. After a successful call with `afterRawResponse` set: the hook threw, returned anything but a `Response` or nothing, or read the body and returned no `Response`. The status is one AI SDK clients do not retry, since the gateway has billed the call. |
| 424 | `proxy_error` | `after_response_invalid` | `afterResponse hook returned an invalid response: <problem>` | `afterResponse` on a non-streamed request returned a result that fails the result validation above. |
| 500 | `proxy_error` | `no_response_body` | `No response body` | A successful streamed response arrived without a body. |
| 502 | `proxy_error` | `upstream_redirect` | `Upstream redirected, the proxy does not follow redirects` | The gateway answered with a 3xx status. The proxy sets `redirect: "manual"`, runs no `onError` and forwards no `Location`. |

## Other exports

- `createStreamTransformer(body, request, afterResponse, signal?)` and `StreamContentAggregator`: the pieces the proxy uses to run `afterResponse` on a stream, for building your own streaming handler. Pass `signal` when the upstream `fetch` uses it too, so an abort is reported as `cancelled` rather than as an upstream failure.
- Types: `CreateGatewayProxyOptions`, `CreateGatewayProxyFn`, `CreateGatewayProxyResult`, `GatewayResponse`, `GatewayResponseMetadata`, `GatewayError`, `IncompleteStream`, `ModelCallKind`, `ProxyErrorCode`, the `error.code` values above, `RawRequestContext`, `RawResponseContext`, `GatewayAuthToken`, `GatewayApiKey`, the type of the `apiKey` option, `GatewayTeamIdOrSlug`, the type of the `teamIdOrSlug` option, and `GatewayHeaders`, the type of the `headers` option.

## Documentation

This README is the documentation and matches the code: [Options](#options) covers every option, [Responses the proxy generates](#responses-the-proxy-generates) every status and message the proxy answers with itself, and [Raw hooks](#raw-hooks) the calls other than language model calls. [`CHANGELOG.md`](CHANGELOG.md) lists what changed in each release.

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
