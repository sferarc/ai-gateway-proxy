# Streaming

A request is treated as streaming when it carries `ai-language-model-streaming: true` (`src/proxy.ts`).

- **No `afterResponse` hook:** the upstream body is returned as is, keeping its `content-type` (default `text/event-stream`) and the allowlisted upstream response headers ([[proxy]] step 9).
- **With `afterResponse`:** `createStreamTransformer` (`src/stream.ts`) parses the SSE body with `EventSourceParserStream` from `@ai-sdk/provider-utils`. Every event is forwarded immediately and also fed to a `StreamContentAggregator`. On the `finish` event it calls `afterResponse` with the aggregated `GatewayResponse` and emits a rewritten `finish` event carrying the hook's `finishReason`, `usage` and `providerMetadata`. Content has already been streamed by then, so the hook can only change that metadata (doc comment on `afterResponse` in `src/types.ts`). If the hook throws, the error is logged with `console.error` and the upstream `finish` event is forwarded instead, so the stream still completes (#11).

`DONE` and `[DONE]` markers and events whose data is not a JSON object pass through unchanged without reaching the aggregator. That covers valid JSON that is not an object, such as `null`, `42` or `"text"`: it used to reach `StreamContentAggregator.process`, whose `part.type` read threw on `null` and errored the client stream, where the same upstream with no hook reached the client intact. Pinned by "passes JSON data that is not an object through like non-JSON data".

A `stream-start` part whose `warnings` is missing or not an array adds no warnings. The aggregator used to spread `part.warnings` unchecked, so such a part threw `part.warnings is not iterable` and errored the client stream, where the same upstream with no hook reached the client intact. Pinned by "passes a stream-start without a warnings array through and still calls the hook".

Events are re-encoded with `sseEvent` (`src/stream.ts`), which writes one `data:` field per line. The parser joins a multi-line event's `data:` lines with `\n`; writing that back as a single `data: ${data}` field left bare lines that the client's SSE parser ignores, so it received only the first line. Only the data field is re-emitted: `event:`, `id:` and `retry:` fields are not forwarded on this path. Pinned by "keeps every line of an event whose data spans several data lines".

## Logging

`createStreamTransformer` logs to the console so a truncated or unmetered stream leaves a server-side trace. It never logs event payloads, request bodies or tokens.

- `console.error("upstream stream failed, erroring the client stream:", error)` when reading the upstream body fails mid-stream (connection reset, decoder error). The client stream is then errored with the same error.
- `console.warn` once when the upstream ends without a `finish` event, saying `afterResponse` was not called.
- `console.warn` once per stream on the first non-`DONE` event whose data is not a JSON object ("is not a JSON object, passing it through unparsed"). The event itself is still forwarded unchanged.
- `console.error("afterResponse hook failed, forwarding original finish event:", error)` when the hook throws.

A client cancel is not logged: `cancel` sets a flag that suppresses both the error and the missing-`finish` warning, and still cancels the upstream with the same reason. Covered by `src/stream.test.ts`, which spies on `console.warn` and `console.error` and checks that payload text never reaches them.

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

`StreamContentAggregator` builds text and reasoning blocks from their start, delta and end parts, collects tool calls, tool results, tool approval requests, files and sources, and takes warnings from `stream-start`. Covered by `src/stream.test.ts`.

- **Arrival order.** A text or reasoning block takes its slot in `content` when it starts, and its deltas fill that slot in place, so `content` follows the order in which each part first appeared, as the non-streaming response does. Before this, blocks were appended on their `-end` part, so a tool call that arrived while a text block was still open landed ahead of that text. Pinned by "keeps blocks in the order they started when a tool call arrives before text-end" and, through the transformer, "passes the hook content in the order each block started".
- **Missing start parts.** A delta for an id with no open block opens one at that point instead of being dropped, so a provider that skips `text-start` or `reasoning-start` still has its text reach the hook ("keeps deltas for a text id that had no text-start"). The earlier test "ignores deltas for unknown text ids" pinned the dropping behavior and was replaced.
- **Unterminated blocks.** A block with no `-end` part stays where it started; `finish` only closes the open ids ("finalizes incomplete text content on finish" and its reasoning twin).

Beyond the transformer, `src/proxy-stream.test.ts` drives `createGatewayProxy` with a mocked SSE upstream and an `afterResponse` spy, and `src/e2e.test.ts` streams through a real `@ai-sdk/gateway` client to a local fake gateway; both run in CI without a key. `src/integration.test.ts` calls the real gateway and needs one ([[development/testing]]).

## Behavior pinned by `src/proxy-stream.test.ts`

- The hook runs exactly once, on `finish`, with the upstream `usage`, `finishReason` and `providerMetadata` unchanged and the content in stream order, an unterminated text block kept at the position it started.
- The client gets the hook's `finishReason`, `usage` and `providerMetadata` in the `finish` event. Every other event, `[DONE]` included, is forwarded byte for byte. Status and `content-type` come from the upstream.
- An upstream body error mid-stream errors the client stream, and the hook does not run.
- Cancelling the client body cancels the upstream body with the same reason.
- An upstream that ends without a `finish` event closes the client stream cleanly and the hook never runs.

## Specification version 4 parts

The proxy forwards `ai-language-model-specification-version` from the client ([[proxy]] step 7), and `@ai-sdk/gateway` 4.x sends `4`, so the gateway can answer with `LanguageModelV4StreamPart` events while `StreamContentAggregator` is typed against `LanguageModelV3StreamPart`. Every event is still forwarded to the client unchanged; the gap is only in what `afterResponse` receives. Comparing the two unions in `@ai-sdk/provider` 4.0.27 (`dist/index.d.ts`):

- `finish`, `usage` and `finishReason` have the same shape, so metering in the hook is unaffected.
- V4 adds `custom` and `reasoning-file` parts. The aggregator has no case for them, so they are missing from the aggregated `content`.
- V4 `text-end` may carry `citations`. The aggregator builds text blocks as `{ type, text }`, so citations are dropped, as `providerMetadata` already is.
- V4 `file` parts carry `data` as a tagged object (`SharedV4FileData...`) instead of V3's `string | Uint8Array`. The aggregator pushes the part as is, so the hook receives the V4 shape under a V3 type. The non-streaming `afterResponse` body has the same type mismatch.

Moving the hook types to V4 changes the public `GatewayResponse` type, so it is left for a deliberate change rather than made here.

## Open question: streams that end without `finish`

When the upstream stream ends, errors or is cancelled before `finish`, `afterResponse` is not called, so a consumer metering usage in the hook records nothing for that request. The end and error cases are now logged (see Logging above), but the hook contract is unchanged. Calling the hook with partial content and unknown usage, or adding a separate signal, would change the public contract; that is the owner's decision and is not made. The current behavior is pinned so any change is deliberate.

## Hook result without stream metadata

`createStreamTransformer` reads `modifiedResponse.finishReason`, `usage` and `providerMetadata` inside the `try` that catches a throwing hook (`src/stream.ts`). An `afterResponse` that returns `undefined` or `null`, which a JavaScript caller can do, is therefore handled like a throwing hook: `console.error` once and the upstream `finish` event is forwarded. Before, the reads sat outside the `try` and errored the client stream. Pinned by "forwards the original finish event when the hook returns undefined" and "... null". A result that is an object missing some of those fields is not validated: the missing fields are left out of the rewritten `finish` event.
