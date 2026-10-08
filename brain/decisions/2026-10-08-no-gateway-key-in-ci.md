# No gateway key in CI

Recorded 2026-10-08, from the comment on the Test step in `.github/workflows/ci.yml`.

## Decision

CI stores no `AI_GATEWAY_API_KEY`. `src/integration.test.ts` skips without it, so CI runs only the mocked tests.

## Why

Every integration call goes to the real AI Gateway and costs money (`ci.yml`).

## Consequences

The end-to-end path through `@ai-sdk/gateway` is checked only when someone runs the tests locally with a key ([[development/testing]]). A change to the request or streaming path should say whether that was done.

## What would reopen it

Unknown.
