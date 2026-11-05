# Calling the route from another origin

A page served from another origin than the route, such as `app.example.com` calling `api.example.com`, is blocked by the browser unless the route sends CORS headers. The client sends `authorization`, `content-type` and `ai-*` headers, so the browser first sends an `OPTIONS` preflight, which the proxy does not answer, and the proxy forwards no `access-control-*` header. Wrap the route to answer the preflight and add the headers to every response. Next.js App Router, at `app/api/ai/[...segments]/route.ts`:

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

Two traps the wrapper avoids:

- `access-control-allow-headers: *` does not cover `authorization`, so a preflight answered with `*` still blocks every call that carries the client's `apiKey`. Echo `access-control-request-headers` instead.
- `retry-after` and `retry-after-ms` are not CORS safelisted response headers. Without `access-control-expose-headers` the AI SDK cannot read them on a 429 and falls back to its own backoff.

Set `allowedOrigins` to the origins of your pages. A stream keeps flowing, since the response body is passed through. The preflight carries no `authorization` header, so when the route is also protected (the "Protect the route" sample in SKILL.md), keep `OPTIONS` outside the session check and run the check inside `handler`. CORS only stops a browser page on another origin from reading the answer; it does not stop other callers, so it never replaces that check. Hono, Express and other frameworks need the same headers on the same responses.

This is the wrapper from the package README, where a test runs it between a real `@ai-sdk/gateway` client and a fake gateway through a fetch that applies the browser's CORS checks.
