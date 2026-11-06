# Overview

A TypeScript library published to npm as `ai-gateway-proxy`, shipped as ESM and CJS, each with its own type declarations (`dist/index.d.ts` and `dist/index.d.cts`, from the `import` and `require` conditions of `package.json` `exports`, built by bunchee and checked by `pnpm attw`; [[decisions/2025-12-28-bunchee-build]]). The public surface is `src/index.ts`. The npm page summary and search keywords are `description` and `keywords` in `package.json` (#160); the keywords name the frameworks and uses the README covers, such as `nextjs`, `hono`, `express`, `streaming` and `metering` (#179).

## Modules

| Module | Exports | Role |
| --- | --- | --- |
| `src/proxy.ts` | `createGatewayProxy` | Builds the handler that forwards a request upstream. See [[proxy]] |
| `src/auth.ts` | `getGatewayAuthToken`, `GatewayAuthToken`, `GatewayApiKey` | Picks the credential, from the `apiKey` option when set. See [[auth]] |
| `src/stream.ts` | `createStreamTransformer`, `StreamContentAggregator` | Parses the SSE response and rebuilds the full response for `afterResponse`. See [[streaming]] |
| `src/hook-result.ts` | `isRecord`, `gatewayResponseProblem`, `gatewayErrorProblem`, internal | Checks hook inputs and results: `isRecord` the request body and a `beforeRequest` result ([[proxy]] steps 5 and 6), `gatewayErrorProblem` an `onError` result (step 8, #77), `gatewayResponseProblem` an `afterResponse` result (step 9) |
| `src/types.ts` | `CreateGatewayProxyOptions`, `CreateGatewayProxyFn`, `CreateGatewayProxyResult`, `GatewayResponse`, `GatewayResponseMetadata`, `GatewayError`, `IncompleteStream`, `ModelCallKind`, `RawRequestContext`, `RawResponseContext` | Option, hook context and result types |

## Agent skill

`skills/ai-gateway-proxy/SKILL.md` is an Agent Skills skill (https://agentskills.io) that tells a coding agent when the proxy is needed and how to set it up; `npx skills add sferarc/ai-gateway-proxy` installs it from the repository, not from the npm package, whose `files` hold only `dist` (#183). Its `references/` hold the README's Express adapter, cross-origin (CORS) wrapper (#215), SvelteKit and Astro routes (#221), React Router route (#228) and Nuxt server route (#231) verbatim. It restates the README, which stays the authority, so a change to an option or hook rule the skill names updates both. `src/skill.test.ts` type checks its samples ([[development/testing]]).

## Agent instructions

`AGENTS.md` at the root holds the repository rules for coding agents (the `check` command, changesets, no hand releases, prose rules, the `brain/` index), read by the tools that follow https://agents.md. `CLAUDE.md` is the single line `@AGENTS.md`, so Claude Code imports the same file and the rules have one source (#185). Edit `AGENTS.md`, never `CLAUDE.md`.

## Context7

`context7.json` at the root configures the Context7 docs index (https://context7.com) that agents query through its MCP server (#184). It indexes the Markdown of the README, `CHANGELOG.md`, `examples/` and `skills/`, excludes `brain/`, `.changeset/`, `.github/`, `src/`, `AGENTS.md` and `CLAUDE.md`, and gives agents rules that restate the README, starting with the proxy not being OpenAI compatible. Setting `excludeFiles` turns off Context7's default exclusions, which would drop the changelog. Context7 reads the file from `main` when it refreshes the library, so an edit lands on the next refresh. `src/context7.test.ts` holds it to the schema limits ([[development/testing]]).

## Runtime dependencies

`@ai-sdk/provider` (the `LanguageModelV4*` types), `@ai-sdk/provider-utils` (`EventSourceParserStream`) and `@vercel/oidc` (`getVercelOidcToken`), all from `package.json` `dependencies`. Versions are pinned in the `catalog` of `pnpm-workspace.yaml`.

## Protocol

The handler speaks the AI SDK gateway language model protocol, version 4 types, as the `@ai-sdk/gateway` provider sends it (doc comment on `createGatewayProxy` in `src/proxy.ts`). The client is expected to be an `@ai-sdk/gateway` provider whose `baseURL` points at the proxy route (`src/e2e.test.ts` against a local fake gateway, `src/integration.test.ts` against the real one). The GitHub repository description says "OpenAI-compatible"; nothing in `src/` handles the OpenAI API shape, so that description does not match the code.

## Invariants

- **Tree-shakable.** `package.json` sets `sideEffects: false` and CI runs `pnpm is-tree-shakable` after the build (`.github/workflows/ci.yml`). Consumers rely on unused exports being dropped.
- **The caller cannot override authentication.** `withGatewayHeaders` sets `authorization`, `ai-gateway-auth-method` and `ai-gateway-protocol-version` on a `Headers` built from the custom `headers` option, so they replace a custom entry in any casing instead of being sent beside it (#22). On requests with a body, `buildRequestHeaders` also drops custom entries naming the model call and takes those from the incoming request (#33). Both request paths go through `withGatewayHeaders` (`src/proxy.ts`, [[proxy]] steps 4 and 7).
- **Headers cross the proxy only by allowlist.** Incoming request headers reach upstream only when they match `MODEL_CALL_HEADER` or `REQUEST_METADATA_HEADER`, and upstream response headers reach the client only when they match `FORWARDED_RESPONSE_HEADER` (#30, #33, #34; [[proxy]] steps 7 and 9). Widening either one decides whether the client's cookies and credentials reach the gateway, or the gateway's `set-cookie` reaches the client.
- **Failures become responses, not throws.** Missing auth returns 500, a path that would leave `baseUrl` `400 Invalid path` (#10), an unparseable body `400 Invalid JSON body`, a body that is not a JSON object on a language model hook path `400 Invalid request body` ([[proxy]] step 5), and a client abort 499 with no body (#10). A failed `fetch` and a throwing `extractPath`, `beforeRequest` or `beforeRawRequest` return `500 Error proxying request to AI Gateway` and are logged with `console.error` (#5, #17). A failure after the gateway has answered, and billed, a call is a 424 `proxy_error` instead, since an AI SDK client retries a 5xx but not a 424: on a non-streamed language model path with `afterResponse`, a success body that is not a JSON object or a throwing hook gives `424 Error processing the AI Gateway response` and an invalid hook result `424 afterResponse hook returned an invalid response: <problem>` ([[proxy]] step 9); an `afterRawResponse` that throws, returns anything but a `Response` or nothing, or reads the body and returns no `Response` gives the same `Error processing the AI Gateway response` 424 after a successful call, and stays a 500 on an upstream error status, since retrying a failed call costs nothing ([[proxy]] raw hooks; `ANSWERED_CALL_FAILURE_STATUS` in `src/proxy.ts`; [[decisions/2026-11-01-no-retry-after-answered-call]], #117). Every error body the proxy produces itself is JSON in the `GatewayError` shape, typed `invalid_request_error` or `proxy_error`. A throwing `afterResponse` on a stream is logged and the original `finish` event is forwarded, since the response has already started (#11, `src/stream.ts`), and a throwing `onError` is logged and the upstream error forwarded ([[proxy]] step 8). See [[proxy]]; tested under `request handling` and `error handling` in `src/proxy.test.ts` and by `forwards the original finish event when the hook throws` in `src/stream.test.ts`.

## History

The package was developed in the SferaDev/SferaDev monorepo and moved to its own repository in a8cb76e. See [[decisions/2026-10-08-standalone-repository]].
