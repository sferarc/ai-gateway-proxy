# Hooks receive the incoming request

Decided by the steward on 2026-11-03 under the owner's delegation of 2026-11-01, in #143.

## Decision

Every hook context carries `incomingRequest`, the `Request` the handler was called with ([[architecture/proxy]] step 6 and "Raw hooks"). It is a new field, so existing hooks keep working. The body has already been read by then, so the parsed body stays in `request`. On `afterResponse` and `onError` it is typed optional, like `modelId`, because `createStreamTransformer` calls `afterResponse` without it; the proxy always sets it.

## Why

A hook could not tell who was calling. The README's "Refusing a call" example checked credit by `modelId` alone, and the "cap, meter and mask" example metered usage it could not attribute to a caller. The only way to reach the caller's headers was to wrap the handler and pass them through `AsyncLocalStorage`. The `apiKey` option already received the `Request`, so the hooks now match it.

The name `incomingRequest` keeps `request` for the body, which every hook already used for it.

## What would reopen it

A need for the hooks to read the request body as a stream, which would mean not reading it before the hooks run.
