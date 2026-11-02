# ai-gateway-proxy

## 0.5.0

### Minor Changes

- fa35b94: Answer an `afterRawResponse` failure after a successful embedding, image, video, speech, transcription, reranking, decision or batch call with 424 `proxy_error` instead of 500: a hook that throws, returns anything but a `Response` or nothing, or reads the body and returns nothing. AI SDK clients retry a 500, so `embed` and the other helpers paid for the call again; they do not retry a 424. A failure on an error response is still a 500.

## 0.4.0

### Minor Changes

- 6515613: Retype a gateway `authentication_error` as `proxy_error` with the message `AI Gateway rejected the proxy's credential: <message>`, keeping the status and the other fields, before `onError` runs. Only the proxy's own credential reaches the gateway, but `@ai-sdk/gateway` answered that type by telling the client its own API key was invalid; it now shows the gateway's message.

## 0.3.0

### Minor Changes

- c5f4ae3: Answer a failure after the gateway has answered a non-streamed language model call with 424 `proxy_error` instead of 500: an `afterResponse` that throws or returns an invalid result, and a success body that is not a JSON object. AI SDK clients retry a 500, so `generateText` sent the call twice more and the caller paid for it three times; they do not retry a 424.

## 0.2.0

### Minor Changes

- 8148a8f: Default `baseUrl` to `https://ai-gateway.vercel.sh/v4/ai`, the endpoint `@ai-sdk/gateway` 4.x calls on its own. The gateway versions its endpoint by AI SDK specification version, and the old default `/v1/ai` is the one `@ai-sdk/gateway` 1.x and 2.x used for version 2 calls, so version 4 bodies went to the version 2 endpoint. Set `baseUrl` to keep the old endpoint.
- e1ee662: Run the hooks on every request with a body except one whose path relative to `baseUrl` is exactly a path `@ai-sdk/gateway` uses for other calls (`embedding-model`, `image-model`, `video-model`, `video-model/start`, `video-model/status`, `speech-model`, `transcription-model`, `reranking-model`, `decision-model` and the `batch/` calls). Behavior change: the `ai-model-id` header no longer skips the hooks, so a request to any other path, or to another spelling of a listed one such as `Embedding-Model` or `batch/status/`, now runs `beforeRequest`, `afterResponse` and `onError`. Before, an unknown path with `ai-model-id`, or a spelling the path fold missed, skipped them.
- 95fa86b: Call `afterResponse` once when a stream ends, fails or is cancelled before its `finish` event, with the partial content and an `incomplete` field. `GatewayResponse.usage` is now `LanguageModelV4Usage | undefined`, which breaks code that reads it without a check. A hook that returns `usage: undefined` on `finish` now keeps the upstream usage in the client's finish event instead of dropping it.
- 1b1b42c: Give `beforeRequest`, `afterResponse` and `onError` a `modelId`, the client's `ai-language-model-id` header, on streamed and non-streamed calls. The call body does not name the model, so a hook that metered or capped usage had no way to tell which model it was for.
- e1ee662: Add the optional `beforeRawRequest` and `afterRawResponse` hooks for the calls that are not language model calls (embedding, image, video, speech, transcription, reranking, decision and batch start), so an operator can meter, audit or rewrite them. They receive the call's `kind`, `path`, `modelId` and parsed body, and `afterRawResponse` also the `Response` the proxy would send, which it may replace. The existing hooks are unchanged.
- 2f71431: Type `GatewayResponse`, `StreamContentAggregator` and the hook request on AI SDK specification version 4. `afterResponse` now receives `custom` and `reasoning-file` parts and the `citations` of `text-end`, and `file` content carries the V4 tagged `data` object. Code that reads `content`, or types a hook with `LanguageModelV3*`, needs the V4 types.
- 680b35a: Give a streamed `afterResponse` the stream's `response-metadata` as `response`, with the `id`, `modelId` and `timestamp` the provider sent, and export its type as `GatewayResponseMetadata`. The aggregator dropped these parts, so a hook on a stream could not log the provider's response id or the model that answered.
- e1ee662: Reject an `afterResponse` result with a missing or wrong-typed field instead of forwarding it. Behavior change: on a non-streamed request such a result now returns `500` with the message `afterResponse hook returned an invalid response: <problem>`, which names the field, and on a stream the original `finish` event is forwarded and the problem logged. Before, the object was sent as returned, and a stream's `finish` event lost the missing fields. A non-object result now gets the same message instead of `Error proxying request to AI Gateway`. `null` counts as an absent field and `warnings` may be left out.
- 71bf5dd: Move to `@ai-sdk/provider` 4, `@ai-sdk/provider-utils` 5 and `@vercel/oidc` 4, up from 3, 4 and 3 in 0.1.0. The public types import from `@ai-sdk/provider`, so consumers must use a matching AI SDK major. Also document every option, status and export in the README.

### Patch Changes

- 5129346: Cancel the unread upstream body when `afterRawResponse` sends another `Response`, throws or returns an invalid result, so a video call's event stream no longer stays open upstream after the client got the replacement or the 500. A replacement built on `response.body` keeps it.
- b0d54de: Send the upstream body when `afterResponse` returns `undefined` or `null` on a non-streaming response, instead of an empty body or the literal `null`.
- 114619a: Keep the gateway's `usage` when a non-streamed `afterResponse` returns a result without one, as a streamed `finish` event already does, instead of sending a body that makes `generateText` throw.
- 3255fbf: Never hand `afterResponse` a successful non-streamed body that is JSON but not an object, such as `null`, an array or a string: it is a 500 `proxy_error`, as a body that is not JSON already was, instead of a `TypeError` for `null` or a hook receiving a value that is not a `GatewayResponse`.
- 5bb7eb8: Type the 500 the proxy returns when it has no gateway credential as `proxy_error` instead of `authentication_error`. A client built on `@ai-sdk/gateway` replaced an `authentication_error` message with advice about its own API key, so it never saw that the proxy's `AI_GATEWAY_API_KEY` or OIDC token was missing.
- 4e9d848: Log why the Vercel OIDC token was unavailable when `AI_GATEWAY_API_KEY` is not set, so a misconfigured deployment shows the cause instead of only a 500.
- 4d55ce8: Return `500 Error proxying request to AI Gateway` instead of rejecting when a successful upstream body is not JSON, or when `afterResponse` or `onError` throws on a non-streamed request.
- 1f8cfe5: Send the parsed request body when `beforeRawRequest` returns `null`, as it does for `undefined`, instead of the literal `null`.
- 09af9ac: Send the parsed request body when `beforeRequest` returns `undefined` or `null`, instead of an empty body or the literal `null`.
- 5d76206: Return `500 beforeRequest hook returned an invalid request: the result must be an object` when `beforeRequest` returns a string, number, boolean or array, instead of sending it to the gateway as the request body.
- eaaeae5: Forward the gateway's `retry-after`, `retry-after-ms`, `x-ratelimit-*`, `x-vercel-id` and `x-request-id` response headers on bodyless requests such as `GET /config` too, as every other response path already did. Before, those responses carried only `content-type`.
- 1efd26f: Ship CommonJS type declarations (`dist/index.d.cts`) for the `require` export. The package had one `index.d.ts` for both conditions, which TypeScript reads as ESM in a `type: module` package, so a CommonJS project resolving with `node16` or `nodenext` was given ESM types for the CommonJS build.
- 9600e06: Keep `authorization`, `ai-gateway-*`, `ai-language-model-*` and `content-type` set by the proxy when a custom header uses a different casing, such as `Authorization`. Before, both values reached the gateway joined into one header.
- 1cce47e: Give `onError` a `GatewayError` even when the gateway answers with JSON in another shape, such as `null`, a bare string or `{ "message": ... }`. Those bodies now become a `gateway_error` naming the status and an excerpt, as non-JSON bodies already did, instead of reaching the hook as is, where reading `error.error.message` threw and the upstream status was replaced by a 500.
- 114a469: Document every path the proxy rejects with `400 Invalid path` in the `extractPath` doc comment: a segment that fails to percent-decode, or decodes to `.`, `..` or text containing `/`, `\` or a NUL byte, not only a leading `/`, `://` and dot segments.
- 0072b76: Stop following redirects from the upstream call and return `502 Upstream redirected, the proxy does not follow redirects`, so the gateway credential is never sent to another host. Return `500` when `afterResponse` returns a value that is not an object instead of forwarding it.
- f2e7c47: Forward the model routing headers `@ai-sdk/gateway` sends (`ai-model-id`, `ai-*-model-specification-version`, `ai-o11y-*`, `idempotency-key` and `accept`), so embedding and image model calls reach the right model through the proxy. `ai-language-model-id` and `ai-language-model-streaming` are now sent only when the incoming request has them.
- d3b3776: Forward the gateway's `retry-after`, `retry-after-ms`, `x-ratelimit-*` and `x-request-id` response headers alongside `x-vercel-id`, so an AI SDK client backs off for the delay the gateway asks for on a 429 instead of retrying on its own schedule.
- e8d897b: Return `500 Error proxying request to AI Gateway` instead of rejecting when `extractPath` or `beforeRequest` throws.
- 4721ba5: Say in the README and the hook doc comments that `beforeRequest`, `afterResponse` and `onError` are skipped for every request without a body, such as a bodyless `DELETE`, not only for `GET` and `HEAD`.
- d63cc1f: Run no hook on the batch calls that read or cancel a job (a path ending in `batch/status`, `batch/results` or `batch/cancel`). They send no model header and post only a batch id, so the hooks ran on them, and an `afterResponse` reading `response.usage.inputTokens` threw on a batch status body and the call came back as 500.
- 30cc4d7: Run no hook on a request with an `ai-model-id` header and no `ai-language-model-id` header, which is how `@ai-sdk/gateway` sends embedding, image and every other model call but a language model's. The hooks are typed for language model calls, so an `afterResponse` reading `response.usage.inputTokens` threw on an embedding response and the call came back as 500. A language model call runs every hook even if it also sends `ai-model-id`.
- ff48b32: Return errors the proxy raises itself (missing authentication, invalid path, invalid JSON body, missing stream body, failed upstream request) as JSON in the `GatewayError` shape with types `invalid_request_error` and `proxy_error`, so AI SDK clients can parse them. Unexpected failures are now logged with `console.error`, except when the client aborted.
- 62527ac: Return `400 Invalid request body: a language model call must be a JSON object` when a language model hook is set and the request body is JSON but not an object, such as an array or `null`, instead of handing it to `beforeRequest`, `afterResponse` or `onError` typed as call options.
- f1a24e7: Run every hook on a request whose path ends in `language-model` (matched after folding case, percent-encoding, repeated or trailing slashes and `;` parameters), whatever model headers it sends. A client could skip `beforeRequest`, `afterResponse` and `onError` on a language model call by sending `ai-model-id` without `ai-language-model-id`, and the call was still forwarded.
- ab2d9dd: Forward a `204` or `205` upstream response without a body instead of answering 500, and skip `afterResponse` for it.
- 35b6cf8: Send the upstream error body when `onError` returns an `error.code` that is neither a string nor a number, or a non-string `generationId`, which AI SDK clients reject as `Invalid error response format`, and log the problem. `GatewayError` now types the optional `error.code` and `generationId` the gateway may send.
- 81a2f08: Send the upstream error body when `onError` returns `undefined` or `null`, instead of an empty body or the literal `null`.
- 363c6cb: Send the upstream error body when `onError` returns a body without a string `error.message` or with a non-string `error.type`, instead of a body AI SDK clients cannot parse, and log the problem.
- 286b2aa: An `onError` hook that throws is logged and the upstream error body is forwarded with its status and `retry-after`, instead of a 500 that hid the gateway's error and made a 400 look retryable.
- f02d873: Describe in the option and auth doc comments what the proxy does: the default `baseUrl`, which headers override `headers`, the path `extractPath` must return, how `onError` and `afterResponse` results are sent, when authentication yields 500, and that the handler takes a Fetch `Request`.
- 4a355b9: Forward a request with no body, such as a bodyless `DELETE`, upstream without one instead of returning `400 Invalid JSON body`.
- 15a21f3: Forward `GET` and `HEAD` requests without parsing or sending a body, so `getAvailableModels()` from `@ai-sdk/gateway` works through the proxy instead of returning `400 Invalid JSON body`. The hooks do not run for these requests, and the upstream status and body are returned unchanged.
- bb0feba: Forward a request whose body is an empty stream without a body, as for a missing body, instead of answering `400 Invalid JSON body`. Node adapters, including the README's Express example, give a bodyless `DELETE` such a stream.
- 9bdd739: Forward a successful `text/event-stream` response to a request not marked `ai-language-model-streaming: true` as is, instead of answering `500 Error proxying request to AI Gateway`. `@ai-sdk/gateway`'s video model `doGenerate` reads its result this way, so video generation through the proxy always failed. `afterResponse` does not run for these responses.
- f972425: Forward a successful JSON Lines response (`application/x-ndjson`, `application/jsonl`) to a request not marked `ai-language-model-streaming: true` as is, instead of answering `500 Error proxying request to AI Gateway`. `@ai-sdk/gateway`'s batch API reads `doGetBatchResults` this way, so reading batch results through the proxy always failed. `afterResponse` does not run for these responses.
- 58b4a53: Add a README example that uses `beforeRequest`, `afterResponse` and `onError` together to cap output tokens, meter usage including streams that end before `finish`, and hide upstream server errors from the client.
- 13e1dae: Reject request paths with `.` or `..` segments (including percent-encoded ones) with `400 Invalid path`, so a caller can no longer steer the authenticated upstream request outside the configured `baseUrl`. Forward the client's abort signal to the upstream fetch and return `499` when the client disconnects, so an abandoned generation stops instead of running on.
- 2bd37cb: Forward the request body as the client sent it when neither `beforeRequest` nor `beforeRawRequest` receives it, instead of parsing and serialising it again. The round trip rounded integers past 2^53, such as a large `seed`, and built an extra full-size copy of large bodies such as base64 images or audio.
- 00780f7: Report a client that aborts `request.signal` mid-stream to `afterResponse` as `{ reason: "cancelled" }` instead of an upstream failure, and stop logging it as `upstream stream failed`. `createStreamTransformer` takes the signal as an optional fourth argument.
- 5dc7181: Read a streamed response from the gateway only as fast as the client reads it when `afterResponse` is set. The whole upstream stream was read straight away and queued in memory, so a slow client made the proxy buffer the entire response.
- d4dc1bc: Cancel the upstream stream when the client cancels a streamed response, and forward the original finish event instead of erroring the stream when `afterResponse` throws.
- 4d9679e: Keep streamed `afterResponse` content in the order each part first arrived, matching the non-streaming response, and keep text or reasoning deltas whose start part is missing instead of dropping them.
- ad2e81e: Report `finishReason` `error` to `afterResponse` when a stream sends an `error` part and ends without a `finish` event, instead of `other`, so a metering hook can tell a stream the provider failed from one that stopped for no stated reason. A `finish` part that follows the error still sets its own reason.
- f5a9e4e: Log when a streamed response fails mid-stream, or carries a non-JSON event. Client cancellations are not logged unless the hook throws, and event payloads never are.
- d7c5fc1: `afterResponse` runs once per stream. A second `finish` event from the gateway gets the first call's rewrite instead of calling the hook again, so a metering hook no longer counts the stream twice.
- 368d742: Forward the upstream `finish` event when a streamed `afterResponse` returns `undefined` or `null`, as when it throws, instead of erroring the client stream.
- d8964f0: Keep every line of a streamed event whose data spans several `data:` lines when `afterResponse` is set. Each line was written back without its `data:` prefix, so the client received only the first line.
- bd4c285: With `afterResponse` set, a streamed event whose data is valid JSON but not an object, such as `null`, is now forwarded unchanged like non-JSON data instead of erroring the client stream.
- fc319d5: Keep the `providerMetadata` of streamed text and reasoning parts on the content `afterResponse` receives, taking the latest part that carries it as `streamText` does, so a hook sees a reasoning signature or per-block metadata as the non-streaming response gives it.
- 375f433: With `afterResponse` set, a streamed `stream-start` event whose `warnings` is missing or not an array is now forwarded unchanged and adds no warnings, instead of erroring the client stream.
- 7984da2: Stream a successful non-streaming response through unread when no `afterResponse` reads it: on a language model call without the hook, and on every embedding, image, speech, transcription, reranking, decision and batch call. The proxy used to buffer, parse and re-serialise every JSON body, which held an image or video model's base64 output in memory several times over and turned a successful body that was not JSON into a 500. The client now gets the upstream bytes and `content-type`. With `afterResponse` set, a language model response is still parsed for the hook.
- d2f6d6f: Report the upstream status and a short excerpt of the body when the gateway returns a non-JSON error, such as an HTML 502 page, instead of `Unknown error`, and forward the gateway's `x-vercel-id` on proxied JSON, streamed and error responses so failures can be matched to gateway logs.

## 0.1.0

### Minor Changes

- 81f6330: Add framework-agnostic support with `extractPath` and `segmentsParam` options

  - `extractPath`: Custom function to extract the gateway path from the request URL, enabling use with Hono, Express, and other frameworks without catch-all route support
  - `segmentsParam`: Customize the name of the catch-all parameter in Next.js routes (defaults to "segments")
  - Context parameter is now optional when using `extractPath`

## 0.0.2

### Patch Changes

- ba83f6e: Add streaming support with response hooks and improved documentation

  - Add `afterResponse` hook that works with both streaming and non-streaming responses
  - Add `onError` hook for custom error handling
  - Rename `transformRequest` to `beforeRequest` for consistency
  - Add `StreamContentAggregator` for aggregating streaming content
  - Add `createStreamTransformer` for stream transformation
  - Export all types for better TypeScript support
  - Add comprehensive README
