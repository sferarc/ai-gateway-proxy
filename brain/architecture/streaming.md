# Streaming

A request is treated as streaming when it carries `ai-language-model-streaming: true` (`src/proxy.ts`).

- **No `afterResponse` hook:** the upstream body is returned as is, keeping its `content-type` (default `text/event-stream`).
- **With `afterResponse`:** `createStreamTransformer` (`src/stream.ts`) parses the SSE body with `EventSourceParserStream` from `@ai-sdk/provider-utils`. Every event is forwarded immediately and also fed to a `StreamContentAggregator`. On the `finish` event it calls `afterResponse` with the aggregated `GatewayResponse` and emits a rewritten `finish` event carrying the hook's `finishReason`, `usage` and `providerMetadata`. Content has already been streamed by then, so the hook can only change that metadata (doc comment on `afterResponse` in `src/types.ts`).

`DONE` and `[DONE]` markers and non-JSON events pass through unchanged.

`StreamContentAggregator` builds text and reasoning blocks from their start, delta and end parts, collects tool calls, tool results, tool approval requests, files and sources, takes warnings from `stream-start`, and finalises any unterminated block on `finish`. Covered by `src/stream.test.ts`; the end-to-end path is in `src/integration.test.ts` ([[development/testing]]).
