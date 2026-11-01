# Overview

A TypeScript library published to npm as `ai-gateway-proxy`, shipped as ESM and CJS, each with its own type declarations (`dist/index.d.ts` and `dist/index.d.cts`, from the `import` and `require` conditions of `package.json` `exports`, built by bunchee and checked by `pnpm attw`; [[decisions/2025-12-28-bunchee-build]]). The public surface is `src/index.ts`.

## Modules

| Module | Exports | Role |
| --- | --- | --- |
| `src/proxy.ts` | `createGatewayProxy` | Builds the handler that forwards a request upstream. See [[proxy]] |
| `src/auth.ts` | `getGatewayAuthToken`, `GatewayAuthToken` | Picks the credential. See [[auth]] |
| `src/stream.ts` | `createStreamTransformer`, `StreamContentAggregator` | Parses the SSE response and rebuilds the full response for `afterResponse`. See [[streaming]] |
| `src/hook-result.ts` | `isRecord`, `gatewayResponseProblem`, `gatewayErrorProblem`, internal | Checks hook inputs and results: `isRecord` the request body and a `beforeRequest` result ([[proxy]] steps 5 and 6), `gatewayErrorProblem` an `onError` result (step 8, #77), `gatewayResponseProblem` an `afterResponse` result (step 9) |
| `src/types.ts` | `CreateGatewayProxyOptions`, `CreateGatewayProxyFn`, `CreateGatewayProxyResult`, `GatewayResponse`, `GatewayResponseMetadata`, `GatewayError`, `IncompleteStream`, `ModelCallKind`, `RawRequestContext`, `RawResponseContext` | Option, hook context and result types |

## Runtime dependencies

`@ai-sdk/provider` (the `LanguageModelV4*` types), `@ai-sdk/provider-utils` (`EventSourceParserStream`) and `@vercel/oidc` (`getVercelOidcToken`), all from `package.json` `dependencies`. Versions are pinned in the `catalog` of `pnpm-workspace.yaml`.

## Protocol

The handler speaks the AI SDK gateway language model protocol, version 4 types, as the `@ai-sdk/gateway` provider sends it (doc comment on `createGatewayProxy` in `src/proxy.ts`). The client is expected to be an `@ai-sdk/gateway` provider whose `baseURL` points at the proxy route (`src/e2e.test.ts` against a local fake gateway, `src/integration.test.ts` against the real one). The GitHub repository description says "OpenAI-compatible"; nothing in `src/` handles the OpenAI API shape, so that description does not match the code.

## Invariants

- **Tree-shakable.** `package.json` sets `sideEffects: false` and CI runs `pnpm is-tree-shakable` after the build (`.github/workflows/ci.yml`). Consumers rely on unused exports being dropped.
- **The caller cannot override authentication.** `withGatewayHeaders` sets `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version` on a `Headers` built from the custom `headers` option, so they replace a custom entry in any casing instead of being sent beside it (#22). On requests with a body, `buildRequestHeaders` also drops custom entries naming the model call and takes those from the incoming request (#33). Both request paths go through `withGatewayHeaders` (`src/proxy.ts`, [[proxy]] steps 4 and 7).
- **Headers cross the proxy only by allowlist.** Incoming request headers reach upstream only when they match `MODEL_CALL_HEADER` or `REQUEST_METADATA_HEADER`, and upstream response headers reach the client only when they match `FORWARDED_RESPONSE_HEADER` (#30, #33, #34; [[proxy]] steps 7 and 9). Widening either one decides whether the client's cookies and credentials reach the gateway, or the gateway's `set-cookie` reaches the client.
- **Failures become responses, not throws.** Missing auth returns 500, a path that would leave `baseUrl` `400 Invalid path` (#10), an unparseable body `400 Invalid JSON body`, a body that is not a JSON object on a language model hook path `400 Invalid request body` ([[proxy]] step 5), and a client abort 499 with no body (#10). A failed `fetch`, a non-JSON success body on a language model path with `afterResponse`, and a throwing `extractPath`, `beforeRequest`, `afterResponse`, `onError`, `beforeRawRequest` or `afterRawResponse` return `500 Error proxying request to AI Gateway` and are logged with `console.error` (#5, #17). Every error body the proxy produces itself is JSON in the `GatewayError` shape, typed `invalid_request_error` or `proxy_error`. A throwing `afterResponse` on a stream is logged and the original `finish` event is forwarded, since the response has already started (#11, `src/stream.ts`). See [[proxy]]; tested under `request handling` and `error handling` in `src/proxy.test.ts` and by `forwards the original finish event when the hook throws` in `src/stream.test.ts`.

## History

The package was developed in the SferaDev/SferaDev monorepo and moved to its own repository in a8cb76e. See [[decisions/2026-10-08-standalone-repository]].
