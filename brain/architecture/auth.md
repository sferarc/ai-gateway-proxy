# Authentication

`getGatewayAuthToken()` in `src/auth.ts` returns `{ token, authMethod }` or `null`:

1. `AI_GATEWAY_API_KEY` from the environment, as `authMethod: "api-key"`.
2. Otherwise `getVercelOidcToken()` from `@vercel/oidc`, as `authMethod: "oidc"`. This works when deployed on Vercel (`README.md`, "Authentication").
3. Otherwise `null`, and the proxy answers 500 ([[proxy]]).

The method is sent upstream as `ai-gateway-auth-method`. The proxy's `authorization` and `ai-gateway-auth-method` always win over the caller's `headers`, matched case-insensitively, so a custom `Authorization` cannot replace or be appended to the gateway credential ([[proxy]] step 7; `keeps gateway headers authoritative over custom headers in any casing` in `src/proxy.test.ts`). The key is read on every request, not cached. Both branches and the `null` case are tested in `src/proxy.test.ts` ("authentication"). Added in 8b9dde6.
