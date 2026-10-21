# Testing

`pnpm test` (also a step of `pnpm check`) runs vitest over the `*.test.ts` files in `src/` (`vitest.config.ts`, node environment; the suites import `describe`, `it` and `expect` from `vitest` rather than relying on globals). On 2026-10-21 at `main` cfa4c3b without a key, on vitest 5.0.5: 6 files, 159 tests, 146 passed and 13 skipped (the skipped file is `src/integration.test.ts`).

| File | What it covers |
| --- | --- |
| `src/proxy.test.ts` | The request path with `fetch` and `@vercel/oidc` mocked: auth selection, URL and header building, the three hooks, error handling, method exports |
| `src/auth.test.ts` | The `console.error` line `getGatewayAuthToken` writes when OIDC is unavailable, that it carries only the error message, and that nothing is logged when a key or OIDC token is found ([[architecture/auth]]) |
| `src/stream.test.ts` | Two suites. `StreamContentAggregator`: each stream part type, content in the order each block started, deltas without a start part. `createStreamTransformer` in isolation: pass-through, `[DONE]` and non-JSON data, `finish` replaced by the hook result, original `finish` forwarded when the hook throws, cancellation reaching the source, the failure and missing-`finish` logs, an event split across chunks |
| `src/proxy-stream.test.ts` | `createGatewayProxy` streaming with an `afterResponse` spy over a mocked SSE upstream: the usage and content the hook sees, the rewritten `finish` the client gets, no `finish`, upstream error, client cancel |
| `src/e2e.test.ts` | A real `@ai-sdk/gateway` client calling `generateText` and `streamText` through the proxy over HTTP to a local fake gateway: text round-trip, the path and gateway headers upstream, `beforeRequest` reaching upstream, `afterResponse` content in both modes, client aborts closing the upstream request |
| `src/integration.test.ts` | Real calls through the proxy to the AI Gateway |
| `src/test-server.ts` | Not a test: `startProxyServer`, the node:http bridge both suites above serve the proxy with |

## Keyless end-to-end tests

`src/e2e.test.ts` runs in CI. It stubs `AI_GATEWAY_API_KEY` with a dummy through `vi.stubEnv`, starts a node:http fake gateway on `127.0.0.1` that records each request and answers `POST /v1/ai/language-model` with a canned JSON result or SSE stream (the `LanguageModelV4` generate result and stream parts that `@ai-sdk/gateway` 4.x parses in `doGenerate` and `doStream`), and points the proxy's `baseUrl` at it. No outbound network and no real key.

`startProxyServer` aborts `request.signal` when the client disconnects and cancels the response body, as a framework route handler does. The two abort tests separate the paths: an abort before the gateway answers can only reach upstream through the signal passed to `fetch` (#10), and the mid-stream abort runs with `forwardAbortSignal: false`, so only the stream cancellation in `createStreamTransformer` (#11) can close upstream. Removing either one fails its test.

## Integration tests

`src/integration.test.ts` starts a local HTTP server running the proxy, points an `@ai-sdk/gateway` provider at it, and calls `generateText` and `streamText` against the model `google/gemini-2.0-flash`. The whole suite is `describe.skipIf(!AI_GATEWAY_API_KEY)`, so without the key it is skipped, not failed.

`pnpm test:integration` runs only this file. `vitest.config.ts` loads `.env` through dotenv, so a local `.env` (gitignored) with `AI_GATEWAY_API_KEY` turns them on. Every run spends money on the gateway, and CI deliberately has no key ([[ci]], [[decisions/2026-10-08-no-gateway-key-in-ci]]). Do not add one to run them.

## Related

- [[architecture/proxy]] and [[architecture/streaming]] for what the tests pin
