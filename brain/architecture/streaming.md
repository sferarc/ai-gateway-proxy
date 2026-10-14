# Streaming

A request is treated as streaming when it carries `ai-language-model-streaming: true` (`src/proxy.ts`).

- **No `afterResponse` hook:** the upstream body is returned as is, keeping its `content-type` (default `text/event-stream`).
- **With `afterResponse`:** `createStreamTransformer` (`src/stream.ts`) parses the SSE body with `EventSourceParserStream` from `@ai-sdk/provider-utils`. Every event is forwarded immediately and also fed to a `StreamContentAggregator`. On the `finish` event it calls `afterResponse` with the aggregated `GatewayResponse` and emits a rewritten `finish` event carrying the hook's `finishReason`, `usage` and `providerMetadata`. Content has already been streamed by then, so the hook can only change that metadata (doc comment on `afterResponse` in `src/types.ts`). If the hook throws, the error is logged with `console.error` and the upstream `finish` event is forwarded instead, so the stream still completes (#11).

`DONE` and `[DONE]` markers and non-JSON events pass through unchanged.

## Logging

`createStreamTransformer` logs to the console so a truncated or unmetered stream leaves a server-side trace. It never logs event payloads, request bodies or tokens.

- `console.error("upstream stream failed, erroring the client stream:", error)` when reading the upstream body fails mid-stream (connection reset, decoder error). The client stream is then errored with the same error.
- `console.warn` once when the upstream ends without a `finish` event, saying `afterResponse` was not called.
- `console.warn` once per stream on the first non-JSON, non-`DONE` event. The event itself is still forwarded unchanged.
- `console.error("afterResponse hook failed, forwarding original finish event:", error)` when the hook throws.

A client cancel is not logged: `cancel` sets a flag that suppresses both the error and the missing-`finish` warning, and still cancels the upstream with the same reason. Covered by `src/stream.test.ts`, which spies on `console.warn` and `console.error` and checks that payload text never reaches them.

Cancelling the returned stream cancels the parsed upstream reader with the same reason (`cancel(reason) { return reader.cancel(reason) }` in `createStreamTransformer`, #11), so a client that goes away stops the upstream read instead of leaving it running.

## Behavior pinned by `src/stream.test.ts`

The `createStreamTransformer` suite tests the transformer on its own, with an in-memory source:

- "passes text events through unchanged"
- "passes [DONE] and non-JSON data through"
- "replaces the finish event with the hook result"
- "forwards the original finish event when the hook throws": the output is the upstream `finish` and `[DONE]`, and `console.error` is called once.
- "cancels the source when the output stream is cancelled": the source's `cancel` receives the reason given to the reader.
- "parses an event split across chunks mid-JSON": SSE parsing buffers a partial event until the rest arrives.

`StreamContentAggregator` builds text and reasoning blocks from their start, delta and end parts, collects tool calls, tool results, tool approval requests, files and sources, takes warnings from `stream-start`, and finalises any unterminated block on `finish`. Covered by `src/stream.test.ts`. `src/proxy-stream.test.ts` drives `createGatewayProxy` with a mocked SSE upstream and an `afterResponse` spy, and runs in CI without a key; `src/integration.test.ts` calls the real gateway and needs one ([[development/testing]]).

## Behavior pinned by `src/proxy-stream.test.ts`

- The hook runs exactly once, on `finish`, with the upstream `usage`, `finishReason` and `providerMetadata` unchanged and the content in stream order, an unterminated text block appended last.
- The client gets the hook's `finishReason`, `usage` and `providerMetadata` in the `finish` event. Every other event, `[DONE]` included, is forwarded byte for byte. Status and `content-type` come from the upstream.
- An upstream body error mid-stream errors the client stream, and the hook does not run.
- Cancelling the client body cancels the upstream body with the same reason.
- An upstream that ends without a `finish` event closes the client stream cleanly and the hook never runs.

## Open question: streams that end without `finish`

When the upstream stream ends, errors or is cancelled before `finish`, `afterResponse` is not called, so a consumer metering usage in the hook records nothing for that request. The end and error cases are now logged (see Logging above), but the hook contract is unchanged. Calling the hook with partial content and unknown usage, or adding a separate signal, would change the public contract; that is the owner's decision and is not made. The current behavior is pinned so any change is deliberate.
