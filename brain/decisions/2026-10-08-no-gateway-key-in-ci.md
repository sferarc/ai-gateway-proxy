# No gateway key in CI

Recorded 2026-10-08, from the comment on the Test step in `.github/workflows/ci.yml`.

## Decision

CI stores no `AI_GATEWAY_API_KEY`. `src/integration.test.ts` skips without it, so CI runs only the mocked tests.

## Why

Every integration call goes to the real AI Gateway and costs money (`ci.yml`).

## Consequences

Against the real gateway, the path through `@ai-sdk/gateway` is checked only when someone runs the tests locally with a key ([[development/testing]]). Since #29, `src/e2e.test.ts` drives a real `@ai-sdk/gateway` client through the proxy to a local fake gateway in CI, so the client to proxy wiring is covered without a key; what the fake cannot show is how the real gateway answers. A change to the request or streaming path should say whether the keyed run was done.

## What would reopen it

Unknown.
