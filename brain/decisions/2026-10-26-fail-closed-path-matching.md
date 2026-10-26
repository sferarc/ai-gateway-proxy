# Fail closed on hook path matching

Decided by the owner on 2026-10-26 in #70, superseding [[2026-10-21-language-model-path-runs-hooks]].

## Decision

The hooks for language model calls run on every request with a body except one whose path relative to `baseUrl` is exactly a listed path: the other model kinds, batch start, and the video status and batch reads (`NON_LANGUAGE_MODEL_PATHS` and `READ_PATHS` in `src/proxy.ts`). Headers no longer decide it, and no spelling is folded.

## Why

The earlier rule skipped the hooks on `ai-model-id` and folded a few spellings of `language-model`, so a path the fold missed or an unknown path skipped the hooks. Whether the gateway serves such paths is unobservable without a paid call. An exact skip list needs no gateway knowledge: a client can only skip the hooks by posting to a path the gateway serves as another kind of call.

## Cost

An unusual spelling of a real non-language-model call, or a `baseUrl` one level above the client's paths, runs hooks typed for language model calls. The official client sends neither. A request to an unknown path with `ai-model-id` now runs the hooks, which is the behavior change in the changeset.

## What would reopen it

A new `@ai-sdk/gateway` path for a call that is not a language model call: add it to the list, with a test.

See [[architecture/proxy]] step 6.
