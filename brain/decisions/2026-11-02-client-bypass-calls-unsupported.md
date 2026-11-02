# Client calls that bypass the handler stay unsupported

Delegated by the owner on 2026-11-01 and decided by the steward with the recommended default in #111.

## Decision

The proxy does not carry the `@ai-sdk/gateway` calls that never reach a `Request` to `Response` handler. They stay documented as unsupported, under Client in `README.md` and in "Calls that do not reach the handler" in [[architecture/proxy]]:

- the WebSocket connections of streaming speech and transcription (`doStream`) and of the realtime model, opened under `baseURL`;
- `getCredits`, `getSpendReport` and `getGenerationInfo`, sent to `/v1/*` at the origin of `baseURL`;
- `getToken` on the realtime, transcription and speech models, which posts to `/v1/realtime/client-secrets` at that origin.

`src/client-bypass.test.ts` pins the URLs the client builds, so a client release that moves any of them under `baseURL` fails a test instead of changing the contract silently.

## Why

Carrying either group changes what the proxy is. The WebSocket calls need an upgrade-capable server, which a `Request` to `Response` handler on Next.js, Hono or a fetch runtime cannot be. The `/v1/*` calls need routes outside the catch-all the proxy is mounted on, so a caller would mount extra handlers at fixed paths on their app's origin. No user has asked for either, and the language model, embedding, image, video, batch and non-streamed speech and transcription calls already go through.

## What would reopen it

A user asking for one of these calls, which becomes its own scoped issue, or an `@ai-sdk/gateway` release that sends any of them as plain HTTP under `baseURL`, which the pinning test reports.
