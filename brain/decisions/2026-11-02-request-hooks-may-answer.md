# Request hooks may answer the client

Decided by the steward on 2026-11-02 under the owner's delegation of 2026-11-01, in #140.

## Decision

`beforeRequest` and `beforeRawRequest` may return a `Response`, or a promise of one. The proxy sends it to the client as is, without calling the gateway or running `afterResponse`, `onError` or `afterRawResponse` ([[architecture/proxy]] step 6 and "Raw hooks"). The README shows a 402 refusal under "Refusing a call", pinned by `src/readme-example.test.ts`.

## Why

A hook that checks a quota or prepaid credit had no way to refuse a call except to throw, which answers 500 `Error proxying request to AI Gateway`. `@ai-sdk/gateway` retries every 5xx, so `generateText` sent the refused call three times and the client saw a generic failure instead of the reason. `onError` and `afterRawResponse` already accept a `Response`, so the request hooks now match them. A `Response` result used to be serialised as `{}` and sent upstream, so no working caller relied on it.

Wrapping the handler, as the README's route protection example does, also refuses calls, but the wrapper sees neither the parsed body nor the hook's `modelId` without reading the request itself.

## What would reopen it

A need to run `afterResponse` or `onError` on the hook's own answer, such as metering refusals, which would be a separate option.
