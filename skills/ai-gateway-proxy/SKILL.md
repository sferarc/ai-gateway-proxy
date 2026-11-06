---
name: ai-gateway-proxy
description: Putting the Vercel AI Gateway behind your own route so the browser never holds the key, or metering and refusing calls. Use when AI SDK code runs in a browser, mobile or desktop app that must not see AI_GATEWAY_API_KEY, when adding a gateway proxy route to a Next.js, Hono, SvelteKit, Astro or Express app, or when capping, metering or refusing each caller's model calls in one place.
license: MIT
---

# ai-gateway-proxy

`ai-gateway-proxy` is an npm package with one route handler. The client's AI SDK gateway provider (`@ai-sdk/gateway`) points its `baseURL` at your route, and the handler forwards each call to the Vercel AI Gateway with the server's credential. Use it instead of a hand written fetch proxy: it handles the gateway protocol headers, streaming and error bodies that `@ai-sdk/gateway` expects.

## Decide first whether it is needed

- Every model call runs on your server (route handler, server action, job): skip the proxy and call `generateText` or `streamText` there with `@ai-sdk/gateway`, which reads `AI_GATEWAY_API_KEY` or the Vercel OIDC token itself.
- The AI SDK runs where the key must not live (browser, mobile or desktop app, code a third party runs), or calls from several clients must be checked, capped or metered in one place: use the proxy.
- The proxy does not carry WebSockets (streaming speech, streaming transcription, realtime) or `getCredits()`, `getSpendReport()`, `getGenerationInfo()` and `getToken()`, which go to the app's origin. Keep those on the server.

## Install

```bash
npm install ai-gateway-proxy
```

The client needs `ai` and `@ai-sdk/gateway`.

## Add the route

Next.js App Router, at `app/api/ai/[...segments]/route.ts`:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

export const { GET, POST, PUT, DELETE, PATCH } = createGatewayProxy();
```

For a catch-all named `[...path]`, pass `createGatewayProxy({ segmentsParam: "path" })`.

Hono, or any framework without catch-all params, takes the path from the URL with `extractPath`:

```typescript
import { Hono } from "hono";
import { createGatewayProxy } from "ai-gateway-proxy";

const app = new Hono();
const proxy = createGatewayProxy({
  extractPath: (request) => new URL(request.url).pathname.replace(/^\/api\/ai\//, ""),
});

app.all("/api/ai/*", (c) => proxy(c.req.raw));
```

SvelteKit and Astro `[...path]` routes pass `params` as a plain object, so they wrap it in a promise for `segmentsParam: "path"`, as in [references/sveltekit-astro.md](references/sveltekit-astro.md). Express and `node:http` hand over `req` and `res`, not a Fetch `Request`, so they need the adapter in [references/express.md](references/express.md). Register it before `express.json()` or any other body parser.

## Point the client at it

```typescript
import { createGateway } from "@ai-sdk/gateway";
import { streamText } from "ai";

const gateway = createGateway({
  baseURL: "https://your-app.example.com/api/ai",
  // Reaches your route only, as authorization: Bearer <apiKey>; the proxy sends its own credential upstream.
  apiKey: sessionToken,
});

const result = streamText({ model: gateway("openai/gpt-5"), prompt: "Hello" });
```

Never give the client the real gateway key. On an unprotected route any non-empty `apiKey` works.

A page on another origin than the route is blocked at the CORS preflight, which the proxy does not answer: wrap the route as in [references/cors.md](references/cors.md). A `*` in `access-control-allow-headers` does not cover `authorization`, and `retry-after` must be exposed for the AI SDK backoff.

## Server credential

Without options the proxy uses `AI_GATEWAY_API_KEY`, then the Vercel OIDC token available when deployed on Vercel. With neither it answers 500 with code `auth_not_configured`. For a key from a secret store or per tenant, pass `apiKey`: a string, or a function of the incoming `Request` (read headers or URL, not the body). A missing result answers 500 and never falls back to the environment key.

## Protect the route

The proxy does not check who calls, so an open route spends your gateway credit for anyone. Check the caller first:

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

`isValidSession` stands for the app's own session check. Do not reject callers through the `apiKey` option: its 500 is retried by the client.

## Cap, meter and refuse

`beforeRequest`, `afterResponse` and `onError` run on language model calls. `hasCredit` and `meter` stand for the app's own functions:

```typescript
import { createGatewayProxy } from "ai-gateway-proxy";

const proxy = createGatewayProxy({
  beforeRequest: async ({ request, modelId, incomingRequest }) => {
    if (!(await hasCredit(incomingRequest.headers.get("authorization"), modelId))) {
      return Response.json(
        { error: { message: "AI credit exhausted", type: "insufficient_funds" } },
        { status: 402 },
      );
    }
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
  afterResponse: async ({ modelId, response, incomingRequest, incomplete }) => {
    // usage is undefined when a stream ended before its finish event.
    await meter(incomingRequest?.headers.get("authorization"), modelId, {
      inputTokens: response.usage?.inputTokens.total,
      outputTokens: response.usage?.outputTokens.total,
      complete: incomplete === undefined,
    });
    return response;
  },
});
```

- Refuse by returning a `Response` from `beforeRequest`, with a 400, 402 or 403 in the `{ error: { message, type } }` shape. Throwing gives a 500, and a 429 or 5xx is retried by the AI SDK client.
- `request` is the client's JSON, so `maxOutputTokens` may be a string, `null`, negative or a fraction. Refuse such a value with a 400 before capping, as the sample does: `Math.min` of a string is `NaN`, which reaches the gateway as `null` and lifts the cap.
- On a stream, `afterResponse` runs once when the stream finishes, or ends early with `incomplete` set; content it returns is ignored, since the client already has it.
- Embedding, image, video, speech, transcription, reranking, decision and batch calls skip these hooks and run `beforeRawRequest` and `afterRawResponse` instead. A route that meters only language models should refuse them: `beforeRawRequest: () => Response.json({ error: { message: "Only language model calls are served", type: "invalid_request_error" } }, { status: 403 })`.

## More

- Every option, hook rule and generated error code: https://github.com/sferarc/ai-gateway-proxy#readme
- A runnable Next.js app that checks the caller and meters each caller's tokens: https://github.com/sferarc/ai-gateway-proxy/tree/main/examples/nextjs
