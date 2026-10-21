# Call afterResponse on streams without finish

Recorded 2026-10-21, from `src/stream.ts`, `src/types.ts` and the open question that was in [[architecture/streaming]] (#18).

## Decision

`afterResponse` runs once when a stream ends, fails or is cancelled before its `finish` event. It gets the partial content, `usage` `undefined`, `finishReason` `error` or `other`, and a new `incomplete` field naming the reason. Its return value is ignored.

## Why

A consumer that meters usage in the hook recorded nothing for these requests and could not tell them from requests that never happened. Reusing the existing hook keeps metering in one place; a separate hook would mean a second option for the same lifecycle.

## Why minor

`GatewayResponse.usage` is now `LanguageModelV3Usage | undefined`, so code reading `response.usage.inputTokens` stops compiling. This is a breaking type change, but the package is 0.x and files breaking changes as `minor` (see `update-runtime-dependencies.md` and [[development/release]]), so the next version stays 0.2.0 and 1.0.0 remains the owner's call. Hooks that never touch `usage` only see an extra call. It should ship in the same release as the V4 type bump in [[plans/roadmap]].

## What would reopen it

A need to tell a failed read from a cancel beyond `incomplete`, or a hook that must rewrite what the client sees when a stream breaks.
