# Testing

`pnpm test` runs vitest over the `*.test.ts` files in `src/` (`vitest.config.ts`, node environment, globals). On 2026-10-08 without a key: 3 files, 52 tests, 39 passed and 13 skipped.

| File | What it covers |
| --- | --- |
| `src/proxy.test.ts` | The request path with `fetch` and `@vercel/oidc` mocked: auth selection, URL and header building, the three hooks, error handling, method exports |
| `src/stream.test.ts` | `StreamContentAggregator` over each stream part type |
| `src/integration.test.ts` | Real calls through the proxy to the AI Gateway |

## Integration tests

`src/integration.test.ts` starts a local HTTP server running the proxy, points an `@ai-sdk/gateway` provider at it, and calls `generateText` and `streamText` against the model `google/gemini-2.0-flash`. The whole suite is `describe.skipIf(!AI_GATEWAY_API_KEY)`, so without the key it is skipped, not failed.

`vitest.config.ts` loads `.env` through dotenv, so a local `.env` (gitignored) with `AI_GATEWAY_API_KEY` turns them on. Every run spends money on the gateway, and CI deliberately has no key ([[ci]], [[decisions/2026-10-08-no-gateway-key-in-ci]]). Do not add one to run them.

## Related

- [[architecture/proxy]] and [[architecture/streaming]] for what the tests pin
