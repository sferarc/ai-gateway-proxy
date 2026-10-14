# Testing

`pnpm test` runs vitest over the `*.test.ts` files in `src/` (`vitest.config.ts`, node environment, globals). On 2026-10-15 without a key, on vitest 5.0.4: 4 files, 86 tests, 73 passed and 13 skipped.

| File | What it covers |
| --- | --- |
| `src/proxy.test.ts` | The request path with `fetch` and `@vercel/oidc` mocked: auth selection, URL and header building, the three hooks, error handling, method exports |
| `src/stream.test.ts` | Two suites. `StreamContentAggregator`: each stream part type. `createStreamTransformer` in isolation: pass-through, `[DONE]` and non-JSON data, `finish` replaced by the hook result, original `finish` forwarded when the hook throws, cancellation reaching the source, an event split across chunks |
| `src/proxy-stream.test.ts` | `createGatewayProxy` streaming with an `afterResponse` spy over a mocked SSE upstream: the usage and content the hook sees, the rewritten `finish` the client gets, no `finish`, upstream error, client cancel |
| `src/integration.test.ts` | Real calls through the proxy to the AI Gateway |

## Integration tests

`src/integration.test.ts` starts a local HTTP server running the proxy, points an `@ai-sdk/gateway` provider at it, and calls `generateText` and `streamText` against the model `google/gemini-2.0-flash`. The whole suite is `describe.skipIf(!AI_GATEWAY_API_KEY)`, so without the key it is skipped, not failed.

`vitest.config.ts` loads `.env` through dotenv, so a local `.env` (gitignored) with `AI_GATEWAY_API_KEY` turns them on. Every run spends money on the gateway, and CI deliberately has no key ([[ci]], [[decisions/2026-10-08-no-gateway-key-in-ci]]). Do not add one to run them.

## Related

- [[architecture/proxy]] and [[architecture/streaming]] for what the tests pin
