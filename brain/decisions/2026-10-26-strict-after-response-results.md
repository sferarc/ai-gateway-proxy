# Reject invalid afterResponse results

Decided by the owner on 2026-10-26 in #70, extending [[2026-10-21-fail-closed-redirects-and-hook-results]].

## Decision

An `afterResponse` result is checked by `gatewayResponseProblem` (`src/hook-result.ts`). On a non-streamed request a result with a missing or wrong-typed field returns 500 `proxy_error` with a message naming the field; on a stream the original `finish` event is forwarded and the problem logged. `undefined` and `null` keep the earlier fallback to the upstream body on a non-streamed request.

## Why

A malformed result was serialised as returned, so the client got a body its parser rejects, or a `finish` event missing fields, with nothing pointing at the hook. A 500 that names the field puts the error where the bug is.

## Where it is lenient

`null` counts as absent, since a JSON body cannot hold `undefined`. `warnings` may be missing because `@ai-sdk/gateway` reads it as `responseBody.warnings ?? []` in `doGenerate`. `finishReason.unified` is checked as a string, not against the current list, so a new value from the gateway does not turn into a 500. Fields beyond the `GatewayResponse` type pass unchecked.

## What would reopen it

A real gateway response that a hook returning it unchanged fails, which item 3 of [[plans/post-0-2-0-gaps]] has not ruled out.

See [[architecture/proxy]] step 9 and [[architecture/streaming]].
