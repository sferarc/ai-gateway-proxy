# Streaming

A request is treated as streaming when it carries `ai-language-model-streaming: true` (`src/proxy.ts`).

- **No `afterResponse` hook:** the upstream body is returned as is, keeping its `content-type` (default `text/event-stream`) and the allowlisted upstream response headers ([[proxy]] step 9).
- **With `afterResponse`:** `createStreamTransformer` (`src/stream.ts`) parses the SSE body with `EventSourceParserStream` from `@ai-sdk/provider-utils`. Every event is forwarded immediately and also fed to a `StreamContentAggregator`. On the `finish` event it calls `afterResponse` with the aggregated `GatewayResponse` and emits a rewritten `finish` event carrying the hook's `finishReason`, `usage` and `providerMetadata`. A hook `usage` of `undefined` keeps the upstream usage, so a hook cannot strip it. Content has already been streamed by then, so the hook can only change that metadata (doc comment on `afterResponse` in `src/types.ts`). If the hook throws, the error is logged with `console.error` and the upstream `finish` event is forwarded instead, so the stream still completes (#11).

`DONE` and `[DONE]` markers and events whose data is not a JSON object pass through unchanged without reaching the aggregator. That covers valid JSON that is not an object, such as `null`, `42` or `"text"`: it used to reach `StreamContentAggregator.process`, whose `part.type` read threw on `null` and errored the client stream, where the same upstream with no hook reached the client intact. Pinned by "passes JSON data that is not an object through like non-JSON data".

A `stream-start` part whose `warnings` is missing or not an array adds no warnings. The aggregator used to spread `part.warnings` unchecked, so such a part threw `part.warnings is not iterable` and errored the client stream, where the same upstream with no hook reached the client intact. Pinned by "passes a stream-start without a warnings array through and still calls the hook".

Events are re-encoded with `sseEvent` (`src/stream.ts`), which writes one `data:` field per line. The parser joins a multi-line event's `data:` lines with `\n`; writing that back as a single `data: ${data}` field left bare lines that the client's SSE parser ignores, so it received only the first line. Only the data field is re-emitted: `event:`, `id:` and `retry:` fields are not forwarded on this path. Pinned by "keeps every line of an event whose data spans several data lines".

## Logging

`createStreamTransformer` logs to the console so a truncated or unmetered stream leaves a server-side trace. It never logs event payloads, request bodies or tokens.

- `console.error("upstream stream failed, erroring the client stream:", error)` when reading the upstream body fails mid-stream (connection reset, decoder error). The client stream is then errored with the same error.
- `console.error("afterResponse hook failed on an unfinished stream:", error)` when the hook throws on a stream that ended, failed or was cancelled before `finish`.
- `console.warn` once per stream on the first non-`DONE` event whose data is not a JSON object ("is not a JSON object, passing it through unparsed"). The event itself is still forwarded unchanged.
- `console.error("afterResponse hook failed, forwarding original finish event:", error)` when the hook throws.

A client cancel is not logged unless the hook throws: `cancel` sets a flag that suppresses the read error log, calls the hook with `incomplete` set, and cancels the upstream with the same reason without waiting for the hook.

A client can also leave through `request.signal`, which [[proxy]] step 7 passes to the upstream `fetch`. Aborting it errors the upstream body with the signal's reason (checked against Node's `fetch` on 2026-10-27), so a pending read rejects unless the framework cancels the response body first. The README's Express adapter aborts on `close`; whether its `pipeline` cancels the body before that rejection lands is not checked. Before this, that read failure went down the upstream failure path: it was logged as `upstream stream failed` and the hook got `{ reason: "error", error }` with `finishReason` `error`, so a metering hook counted every client disconnect as a gateway failure. The proxy now passes `request.signal` as `createStreamTransformer`'s optional fourth argument, and a read that fails once that signal has aborted is reported as `{ reason: "cancelled", cancelReason: signal.reason }` without a log. Without the argument, as for a caller building their own handler, the old behavior holds. Pinned by "reports a client abort mid-stream to the hook as cancelled ..." in `src/proxy-stream.test.ts` and "reports a read that fails after the given signal aborted as a cancel ..." in `src/stream.test.ts`. `startProxyServer` in `src/test-server.ts` cancels the body inside its abort listener, which runs before the read rejects, so the e2e tests did not show this. Covered by `src/stream.test.ts`, which spies on `console.warn` and `console.error` and checks that payload text never reaches them.

## Backpressure

The returned stream reads the upstream in `pull`, one event per call, so the upstream is read only as fast as the client reads. It used to loop over the whole upstream in `start`, which enqueued every event whatever the client's pace: a slow client made the proxy hold the entire response in memory, and an endless upstream ran the process out of heap. Pinned by "reads the upstream only as fast as the client reads" in `src/stream.test.ts`. The pass-through path with no `afterResponse` returns the upstream body as is and always kept backpressure.

Cancelling the returned stream cancels the parsed upstream reader with the same reason (`cancel(reason) { return reader.cancel(reason) }` in `createStreamTransformer`, #11), so a client that goes away stops the upstream read instead of leaving it running.

## Behavior pinned by `src/stream.test.ts`

The `createStreamTransformer` suite tests the transformer on its own, with an in-memory source:

- "passes text events through unchanged"
- "passes [DONE] and non-JSON data through"
- "replaces the finish event with the hook result"
- "forwards the original finish event when the hook throws": the output is the upstream `finish` and `[DONE]`, and `console.error` is called once.
- "cancels the source when the output stream is cancelled": the source's `cancel` receives the reason given to the reader.
- "parses an event split across chunks mid-JSON": SSE parsing buffers a partial event until the rest arrives.

`StreamContentAggregator` reports `usage` as `undefined` and `finishReason` as `other` until it sees `finish`. It builds text and reasoning blocks from their start, delta and end parts, collects tool calls, tool results, tool approval requests, files and sources, and takes warnings from `stream-start`. Covered by `src/stream.test.ts`.

- **Arrival order.** A text or reasoning block takes its slot in `content` when it starts, and its deltas fill that slot in place, so `content` follows the order in which each part first appeared, as the non-streaming response does. Before this, blocks were appended on their `-end` part, so a tool call that arrived while a text block was still open landed ahead of that text. Pinned by "keeps blocks in the order they started when a tool call arrives before text-end" and, through the transformer, "passes the hook content in the order each block started".
- **Missing start parts.** A delta for an id with no open block opens one at that point instead of being dropped, so a provider that skips `text-start` or `reasoning-start` still has its text reach the hook ("keeps deltas for a text id that had no text-start"). The earlier test "ignores deltas for unknown text ids" pinned the dropping behavior and was replaced.
- **Unterminated blocks.** A block with no `-end` part stays where it started; `finish` only closes the open ids ("finalizes incomplete text content on finish" and its reasoning twin).

Beyond the transformer, `src/proxy-stream.test.ts` drives `createGatewayProxy` with a mocked SSE upstream and an `afterResponse` spy, and `src/e2e.test.ts` streams through a real `@ai-sdk/gateway` client to a local fake gateway; both run in CI without a key. `src/integration.test.ts` calls the real gateway and needs one ([[development/testing]]).

## Behavior pinned by `src/proxy-stream.test.ts`

- The hook runs exactly once, on `finish`, with the upstream `usage`, `finishReason` and `providerMetadata` unchanged and the content in stream order, an unterminated text block kept at the position it started.
- The client gets the hook's `finishReason`, `usage` and `providerMetadata` in the `finish` event. Every other event, `[DONE]` included, is forwarded byte for byte. Status and `content-type` come from the upstream.
- An upstream body error mid-stream errors the client stream, and the hook runs once with `incomplete.reason` `error`.
- Cancelling the client body cancels the upstream body with the same reason, and the hook runs once with `incomplete.reason` `cancelled`.
- An upstream that ends without a `finish` event closes the client stream cleanly and the hook runs once with `incomplete.reason` `ended`, partial content and `usage` undefined.

## Specification version 4 parts

The hook types are specification version 4 (`LanguageModelV4*` from `@ai-sdk/provider`), the version `@ai-sdk/gateway` 4.x sends in `ai-language-model-specification-version` ([[proxy]] step 7). `GatewayResponse`, `StreamContentAggregator` and the request type of the hooks moved from V3 in a changeset (`.changeset/spec-v4-hook-types.md`), since `GatewayResponse` is public. Every event is still forwarded to the client unchanged; only what `afterResponse` receives changed. Against `@ai-sdk/provider` 4.0.29 (`dist/index.d.ts`):

- `finish`, `usage` and `finishReason` have the same shape, so metering in the hook is unaffected.
- `custom` and `reasoning-file` parts are pushed into `content` at the position they arrive, like `file`. Pinned by "includes custom content", "includes reasoning-file content" and "keeps custom and reasoning-file parts in arrival order around text".
- `citations` on `text-end` are set on the text block with that id. A `text-end` with no open block adds nothing, and a block without citations has no `citations` key. Pinned by the `citations` suite in `src/stream.test.ts`. `providerMetadata` on the text parts is still dropped.
- `file` parts keep the tagged `data` object, now typed as such. The aggregator does not convert it, and over the wire a `url` variant is a string, not a `URL`, so the type is a promise the JSON parse does not check. Pinned by "includes file content" and "passes version 4 parts to the hook and forwards them unchanged".

## Streams that end without `finish`

When the upstream ends, errors or is cancelled before `finish`, `createStreamTransformer` calls `afterResponse` once through `reportIncomplete` (`src/stream.ts`), so a consumer metering usage sees the request. The context carries `incomplete` (`IncompleteStream` in `src/types.ts`), `response.content` holds what arrived, `response.usage` is `undefined` and `response.finishReason` is `error` for a failed read and `other` otherwise. The return value is ignored, since no `finish` event is left to rewrite, and a throw is logged. A flag keeps the hook to one call per stream, and it never runs after `finish` was seen. Decision and why it is a minor change: [[decisions/2026-10-21-hook-on-unfinished-streams]]. Pinned by the unfinished-stream tests in `src/stream.test.ts`, `src/proxy-stream.test.ts` and `src/e2e.test.ts`.

## Invalid hook results

`createStreamTransformer` checks the hook's result with `gatewayResponseProblem` (`src/hook-result.ts`, the same check as [[proxy]] step 9) before it builds the rewritten `finish` event. A result that fails, `undefined` and `null` included, is logged once as `afterResponse hook returned an invalid response, forwarding original finish event: <problem>` and the upstream `finish` event is forwarded, as for a throwing hook. Before #70's decision, `undefined` and `null` were caught only because the field reads threw inside the `try`, and an object missing fields produced a `finish` event without them ([[decisions/2026-10-26-strict-after-response-results]]). A hook `usage` that is absent or `null` still keeps the upstream usage. Pinned by "forwards the original finish event when the hook returns undefined", "... null" and "forwards the original finish event and names the problem when the hook returns ..." in `src/stream.test.ts`.
