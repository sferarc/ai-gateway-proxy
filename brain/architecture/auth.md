# Authentication

`getGatewayAuthToken()` in `src/auth.ts` returns `{ token, authMethod }` or `null`:

1. `AI_GATEWAY_API_KEY` from the environment, as `authMethod: "api-key"`.
2. Otherwise `getVercelOidcToken()` from `@vercel/oidc`, as `authMethod: "oidc"`. This works when deployed on Vercel (`README.md`, "Authentication").
3. Otherwise `null`, and the proxy answers 500 ([[proxy]]). Before returning `null` it writes one `console.error` line, `AI Gateway auth: no AI_GATEWAY_API_KEY and Vercel OIDC token unavailable:` followed by the OIDC error's message (or `String(error)` for a non-Error). Only the message is logged, never the error object or any token.

The method is sent upstream as `ai-gateway-auth-method`. The proxy's `authorization` and `ai-gateway-auth-method` always win over the caller's `headers`, matched case-insensitively, so a custom `Authorization` cannot replace or be appended to the gateway credential ([[proxy]] step 7; `keeps gateway headers authoritative over custom headers in any casing` in `src/proxy.test.ts`). The key is read on every request, not cached. Both branches and the `null` case are tested in `src/proxy.test.ts` ("authentication"); the failure log is tested in `src/auth.test.ts`. Added in 195a421 (monorepo #12).
