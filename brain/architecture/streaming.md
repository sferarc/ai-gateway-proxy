# Streaming

A request is treated as streaming when it carries `ai-language-model-streaming: true` (`src/proxy.ts`).

- **No `afterResponse` hook:** the upstream body is returned as is, keeping its `content-type` (default `text/event-stream`).
- **With `afterResponse`:** `createStreamTransformer` (`src/stream.ts`) parses the SSE body with `EventSourceParserStream` from `@ai-sdk/provider-utils`. Every event is forwarded immediately and also fed to a `StreamContentAggregator`. On the `finish` event it calls `afterResponse` with the aggregated `GatewayResponse` and emits a rewritten `finish` event carrying the hook's `finishReason`, `usage` and `providerMetadata`. Content has already been streamed by then, so the hook can only change that metadata (doc comment on `afterResponse` in `src/types.ts`).

`DONE` and `[DONE]` markers and non-JSON events pass through unchanged.

`StreamContentAggregator` builds text and reasoning blocks from their start, delta and end parts, collects tool calls, tool results, tool approval requests, files and sources, takes warnings from `stream-start`, and finalises any unterminated block on `finish`. Covered by `src/stream.test.ts`. `src/proxy-stream.test.ts` drives `createGatewayProxy` with a mocked SSE upstream and an `afterResponse` spy, and runs in CI without a key; `src/integration.test.ts` calls the real gateway and needs one ([[development/testing]]).

## Behavior pinned by `src/proxy-stream.test.ts`

- The hook runs exactly once, on `finish`, with the upstream `usage`, `finishReason` and `providerMetadata` unchanged and the content in stream order, an unterminated text block appended last.
- The client gets the hook's `finishReason`, `usage` and `providerMetadata` in the `finish` event. Every other event, `[DONE]` included, is forwarded byte for byte. Status and `content-type` come from the upstream.
- An upstream body error mid-stream errors the client stream, and the hook does not run.
- Cancelling the client body cancels the upstream body with the same reason.
- An upstream that ends without a `finish` event closes the client stream cleanly and the hook never runs.

## Open question: streams that end without `finish`

When the upstream stream ends, errors or is cancelled before `finish`, `afterResponse` is not called, so a consumer metering usage in the hook records nothing for that request. Calling the hook with partial content and unknown usage, or adding a separate signal, would change the public contract; that is the owner's decision and is not made. The current behavior is pinned so any change is deliberate.
