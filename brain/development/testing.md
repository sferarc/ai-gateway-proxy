# Testing

`pnpm test` (also a step of `pnpm check`) runs vitest over the `*.test.ts` files in `src/` (`vitest.config.ts`, node environment; the suites import `describe`, `it` and `expect` from `vitest` rather than relying on globals). On 2026-10-23 at `main` 5f9f069 plus `redirect.test.ts`, without a key, on vitest 5.0.5: 8 files, 209 tests, 196 passed and 13 skipped (the skipped file is `src/integration.test.ts`).

| File | What it covers |
| --- | --- |
| `src/proxy.test.ts` | The request path with `fetch` and `@vercel/oidc` mocked: auth selection, URL and header building, the three hooks, error handling, method exports |
| `src/auth.test.ts` | The `console.error` line `getGatewayAuthToken` writes when OIDC is unavailable, that it carries only the error message, and that nothing is logged when a key or OIDC token is found ([[architecture/auth]]) |
| `src/stream.test.ts` | Two suites. `StreamContentAggregator`: each stream part type, content in the order each block started, deltas without a start part. `createStreamTransformer` in isolation: pass-through, `[DONE]` and non-JSON data, `finish` replaced by the hook result, original `finish` forwarded when the hook throws, cancellation reaching the source, the failure and missing-`finish` logs, an event split across chunks |
| `src/proxy-stream.test.ts` | `createGatewayProxy` streaming with an `afterResponse` spy over a mocked SSE upstream: the usage and content the hook sees, the rewritten `finish` the client gets, no `finish`, upstream error, client cancel |
| `src/e2e.test.ts` | A real `@ai-sdk/gateway` client calling `generateText` and `streamText` through the proxy over HTTP to a local fake gateway: text round-trip, the path and gateway headers upstream, `beforeRequest` reaching upstream, `afterResponse` content in both modes, client aborts closing the upstream request |
| `src/non-language-model.test.ts` | Keyless, over HTTP to a local fake gateway: embedding, image, video and batch start calls from `@ai-sdk/gateway` reach the upstream path unchanged with the proxy's key and auth method, the response comes back, and `beforeRequest`, `afterResponse` and `onError` never run. Documents current behavior, not a contract; the fake responses follow the client's schemas, so it leaves gap 3 in [[plans/post-0-2-0-gaps]] |
| `src/redirect.test.ts` | Keyless, over HTTP: a local fake gateway answers 301, 302, 307 and 308 with a `Location` pointing at a second local listener, on a `generateText` and a `streamText` call. The client gets 502 `proxy_error` `Upstream redirected, the proxy does not follow redirects`, the second listener receives no request (so no bearer token or body leaves), and `onError` does not run. Complements the mock-fetch `redirects` tests in `src/proxy.test.ts` ([[decisions/2026-10-21-fail-closed-redirects-and-hook-results]]) |
| `src/readme-example.test.ts` | The README's "Example: cap, meter and mask" hooks, copied into `readmeProxy`, over mocked `fetch`: the `maxOutputTokens` cap reaching upstream, metering a non-streamed call, a finished stream and a stream without `finish` (usage `undefined`), the body and `finish` event forwarded unchanged, a 5xx masked and a 4xx forwarded. Edit the README example and `readmeProxy` together |
| `src/readme-adapter.test.ts` | The README's Express adapter, copied into `readmeHandle` and served with `createServer(handle)`, between a real `@ai-sdk/gateway` client and a local fake gateway: a `generateText` body read through `Readable.toWeb`, a stream piped back with `afterResponse` seeing the aggregated usage, and a client disconnect mid-stream closing upstream and reaching `afterResponse` as `cancelled` with nothing logged. Edit the README adapter and `readmeHandle` together |
| `src/integration.test.ts` | Real calls through the proxy to the AI Gateway |
| `src/test-server.ts` | Not a test: `startProxyServer`, the node:http bridge that `e2e.test.ts`, `non-language-model.test.ts`, `redirect.test.ts` and `integration.test.ts` serve the proxy with |

## Keyless end-to-end tests

`src/e2e.test.ts` runs in CI. It stubs `AI_GATEWAY_API_KEY` with a dummy through `vi.stubEnv`, starts a node:http fake gateway on `127.0.0.1` that records each request and answers `POST /v4/ai/language-model` with a canned JSON result or SSE stream (the `LanguageModelV4` generate result and stream parts that `@ai-sdk/gateway` 4.x parses in `doGenerate` and `doStream`), and points the proxy's `baseUrl` at it. No outbound network and no real key.

`startProxyServer` aborts `request.signal` when the client disconnects and cancels the response body, as a framework route handler does. The two abort tests separate the paths: an abort before the gateway answers can only reach upstream through the signal passed to `fetch` (#10), and the mid-stream abort runs with `forwardAbortSignal: false`, so only the stream cancellation in `createStreamTransformer` (#11) can close upstream. Removing either one fails its test.

## Integration tests

`src/integration.test.ts` starts a local HTTP server running the proxy, points an `@ai-sdk/gateway` provider at it, and calls `generateText` and `streamText` against the model `google/gemini-2.0-flash`. The whole suite is `describe.skipIf(!AI_GATEWAY_API_KEY)`, so without the key it is skipped, not failed.

`pnpm test:integration` runs only this file. `vitest.config.ts` loads `.env` through dotenv, so a local `.env` (gitignored) with `AI_GATEWAY_API_KEY` turns them on. Every run spends money on the gateway, and CI deliberately has no key ([[ci]], [[decisions/2026-10-08-no-gateway-key-in-ci]]). Do not add one to run them.

## Related

- [[architecture/proxy]] and [[architecture/streaming]] for what the tests pin
