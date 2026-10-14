# Proxy

`createGatewayProxy(options)` in `src/proxy.ts` returns a handler `(request, context?) => Promise<Response>` with `GET`, `POST`, `PUT`, `DELETE` and `PATCH` properties that point at the same function, so a Next.js route can export them directly (`README.md`).

## Request path

1. Authenticate with [[auth]]. No credential returns `500 AI Gateway authentication not configured`.
2. Resolve the upstream path. `extractPath(request)` wins when given; otherwise the catch-all route param named by `segmentsParam` (default `segments`) is joined with `/`; otherwise the path is empty. `extractPath` and `segmentsParam` came in 8b8c5ca so Hono, Express and similar frameworks work without catch-all routes (`CHANGELOG.md` 0.1.0).
3. Build the upstream URL as `baseUrl/path` plus the incoming query string. `baseUrl` defaults to `https://ai-gateway.vercel.sh/v1/ai`.
4. A `GET` or `HEAD` request, such as `@ai-sdk/gateway`'s `getAvailableModels()` reading `GET {baseURL}/config`, stops here and goes through `forwardBodylessRequest`: it is sent upstream with no body and only the caller's `headers` plus `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version`, and the upstream status and body come back unchanged with the upstream `content-type`. None of the hooks run, since they are typed for `LanguageModelV3CallOptions`, and that includes `onError` on a non-OK status. A thrown fetch returns 500, or 499 when the client aborted. Before this, every `GET` returned `400 Invalid JSON body` (tests under `bodyless requests` in `src/proxy.test.ts`, including one that drives `createGatewayProvider({ fetch })` into the handler).
5. Parse the body as JSON (`LanguageModelV3CallOptions`). Invalid JSON returns 400.
6. Run `beforeRequest`, which may replace the body.
7. `fetch` upstream with the request's method, the re-serialised body and the headers from `buildRequestHeaders`: `content-type`, the caller's `headers`, then `authorization: Bearer`, `ai-gateway-auth-method`, `ai-gateway-protocol-version` (`0.0.1`), `ai-language-model-id` and `ai-language-model-streaming`, the last two copied from the incoming request.
8. On a non-OK status, parse the error body (falling back to `{ error: { message: statusText, type: "gateway_error" } }`) and pass it to `onError`, which may return a replacement body or a whole `Response`.
9. On success, a streamed request (incoming `ai-language-model-streaming: true`) goes through [[streaming]]; otherwise the JSON body goes through `afterResponse` and is re-serialised.
10. Any thrown error from step 7 onwards returns `500 Error proxying request to AI Gateway`. That includes a non-JSON success body and a throwing `afterResponse` or `onError`, which is why the handler `await`s `handleJsonResponse` and `createErrorResponse` inside its `try`: a bare `return promise` lets the rejection escape the `catch` (tests under `error handling` in `src/proxy.test.ts`). A throwing `afterResponse` on a streamed request errors the stream instead, since the response has already started ([[streaming]]).

Tests: `src/proxy.test.ts` mocks `fetch` and `@vercel/oidc` and covers each step, the hooks and the HTTP method exports.
