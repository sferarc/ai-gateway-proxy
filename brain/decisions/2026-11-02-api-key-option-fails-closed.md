# The apiKey option fails closed

Decided by the steward on 2026-11-02 under the owner's delegation of 2026-11-01, in #130.

## Decision

`createGatewayProxy` takes an optional `apiKey`: a string, or a function of the incoming `Request` that returns one or a promise of one, resolved on every request and sent as `ai-gateway-auth-method: api-key`. When it is set it replaces `AI_GATEWAY_API_KEY` and Vercel OIDC. An empty or missing result, or a throw, answers 500 `proxy_error` without calling the gateway; the proxy never falls back to the environment key or OIDC ([[architecture/auth]]).

## Why

The only way to choose the key before was `process.env.AI_GATEWAY_API_KEY`, which is global, so a key per tenant or one read from a secret store had to mutate the environment across concurrent requests. `@ai-sdk/gateway` 4.0.131 added the same string or callback shape for its own `apiKey`.

Falling back was the alternative. It would bill a tenant whose key lookup came back empty to the operator's own credential, and hide a broken lookup behind successful calls. A caller who wants the fallback can return `process.env.AI_GATEWAY_API_KEY` from the function.

## What would reopen it

A user asking for OIDC or the environment key as a fallback, which would be a separate opt-in option rather than a change to this one.
