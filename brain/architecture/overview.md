# Overview

A TypeScript library published to npm as `ai-gateway-proxy`, shipped as ESM and CJS with type declarations (`package.json` `exports`, built by bunchee). The public surface is `src/index.ts`.

## Modules

| Module | Exports | Role |
| --- | --- | --- |
| `src/proxy.ts` | `createGatewayProxy` | Builds the handler that forwards a request upstream. See [[proxy]] |
| `src/auth.ts` | `getGatewayAuthToken`, `GatewayAuthToken` | Picks the credential. See [[auth]] |
| `src/stream.ts` | `createStreamTransformer`, `StreamContentAggregator` | Parses the SSE response and rebuilds the full response for `afterResponse`. See [[streaming]] |
| `src/types.ts` | `CreateGatewayProxyOptions`, `CreateGatewayProxyFn`, `CreateGatewayProxyResult`, `GatewayResponse`, `GatewayError` | Option and result types |

## Runtime dependencies

`@ai-sdk/provider` (the `LanguageModelV3*` types), `@ai-sdk/provider-utils` (`EventSourceParserStream`) and `@vercel/oidc` (`getVercelOidcToken`), all from `package.json` `dependencies`. Versions are pinned in the `catalog` of `pnpm-workspace.yaml`.

## Protocol

The handler speaks the AI SDK gateway language model protocol, version 3 types, as the `@ai-sdk/gateway` provider sends it (doc comment on `createGatewayProxy` in `src/proxy.ts`). The client is expected to be an `@ai-sdk/gateway` provider whose `baseURL` points at the proxy route (`src/integration.test.ts`). The GitHub repository description says "OpenAI-compatible"; nothing in `src/` handles the OpenAI API shape, so that description does not match the code.

## Invariants

- **Tree-shakable.** `package.json` sets `sideEffects: false` and CI runs `pnpm is-tree-shakable` after the build (`.github/workflows/ci.yml`). Consumers rely on unused exports being dropped.
- **The caller cannot override authentication.** In `buildRequestHeaders` the custom `headers` option is spread before `authorization` and the `ai-gateway-*` and `ai-language-model-*` headers, so those always win (`src/proxy.ts`).
- **Failures become responses, not throws.** Missing auth returns 500, an unparseable body 400, and a failed `fetch` 500 (`src/proxy.ts`, tested in `src/proxy.test.ts`).

## History

The package was developed in the SferaDev/SferaDev monorepo and moved to its own repository in 9f416d6. See [[decisions/2026-10-08-standalone-repository]].
