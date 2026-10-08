# Authentication

`getGatewayAuthToken()` in `src/auth.ts` returns `{ token, authMethod }` or `null`:

1. `AI_GATEWAY_API_KEY` from the environment, as `authMethod: "api-key"`.
2. Otherwise `getVercelOidcToken()` from `@vercel/oidc`, as `authMethod: "oidc"`. This works when deployed on Vercel (`README.md`, "Authentication").
3. Otherwise `null`, and the proxy answers 500 ([[proxy]]).

The method is sent upstream as `ai-gateway-auth-method`. The key is read on every request, not cached. Both branches and the `null` case are tested in `src/proxy.test.ts` ("authentication"). Added in 8b9dde6.
