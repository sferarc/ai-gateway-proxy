# No retryable status after an answered call

Decided by the owner on 2026-11-01 in #109; the status was picked by the lane that shipped it.

## Decision

When the gateway has answered a non-streamed language model call and the proxy then fails on it, the client gets 424 `proxy_error` instead of 500. That covers an `afterResponse` that throws, an `afterResponse` result that fails validation, and a success body that is not a JSON object or not JSON at all (`handleJsonResponse` in `src/proxy.ts`). The invalid-result message still names the problem; the others say `Error processing the AI Gateway response`. A client abort during that step is still 499.

The same holds for `afterRawResponse` on the other model calls (#117): when the response it receives is `ok`, a hook that throws, returns anything but a `Response` or nothing, or reads the body and returns nothing is a 424 `Error processing the AI Gateway response` (`applyAfterRawResponse` in `src/proxy.ts`). On an error response it stays a 500, so a gateway 429 or 503 the client would retry is still retried.

## Why

`@ai-sdk/gateway` and `@ai-sdk/provider` set `isRetryable` from the status alone: 408, 409, 429 and any 5xx. `generateText` in `ai` retries such an error twice by default, so each 500 reached the gateway three times and paid for the same call three times (pinned in #107). The owner chose a non-retryable status over forwarding the upstream body (which skips the hook's check) or keeping the 500 and documenting `maxRetries: 0`.

## Why 424

Every retryable status is out, so it had to be a 4xx. 424 Failed Dependency says the request depended on a step that failed, which is the hook or the body here. 400 and 422 read as a problem with the client's own request. With type `proxy_error`, `@ai-sdk/gateway` builds a `GatewayInternalServerError` that keeps the proxy's message, status 424 and `isRetryable: false` (`makes generateText call the gateway once when ...` under `afterResponse hook` and `makes embed call the gateway once when afterRawResponse ...` under `raw hooks` in `src/proxy.test.ts`).

## Why minor

Callers that matched on a 500 for these failures see a different status, so it is filed as `minor` like the other 0.x behavior changes ([[2026-10-21-hook-on-unfinished-streams]]).

## Not covered

Failures before the gateway call (`beforeRequest`, `extractPath`, a throwing `fetch`) stay 500, since a retry costs nothing there. Streams are unaffected: the response has started before `afterResponse` runs.

## What would reopen it

An AI SDK client that retries 424, or a gateway field that lets the proxy mark an error non-retryable while keeping a 5xx.

See [[architecture/proxy]] steps 9 and 10 and [[2026-10-26-strict-after-response-results]].
