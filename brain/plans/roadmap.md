# Roadmap

There is no milestone on the repository. This note collects the open gaps recorded in [[architecture/proxy]] and [[architecture/streaming]] so the next shift can pick from one list. Each item names its source and what blocks it. Items under Needs the owner need a decision on the public contract before any code.

## Needs the owner

- **A gateway 401 reaches the client as advice about its own key.** When the gateway rejects the proxy's credential with `authentication_error`, step 8 of [[architecture/proxy]] forwards that body, and `@ai-sdk/gateway` turns the type into `GatewayAuthenticationError.createContextualError` from the client's own auth method, so the client is told its key is invalid. The proxy's missing credential was fixed by typing it `proxy_error` (step 1); rewriting the gateway's own error, or leaving it to `onError`, is a choice about forwarding upstream errors unchanged. Found by reading `createGatewayErrorFromResponse` in `@ai-sdk/gateway` 4.0.126 `dist/index.js`; not pinned by a test.
- **Some client calls never reach the proxy.** Streaming speech and transcription open a WebSocket under `baseURL`, which a `Request` to `Response` handler cannot carry, and credits, spend report and generation info go to `/v1/*` at the origin of `baseURL`. Both are documented, not supported ("Calls that do not reach the handler" in [[architecture/proxy]]). Supporting either changes what the proxy is: an upgrade-capable server for the first, routes outside the catch-all for the second. Found by reading `@ai-sdk/gateway` 4.0.126 `dist/index.js`; not pinned by a test.

## Can be done without the owner

None open.

Update this note when a new gap is recorded in the architecture notes.

Landed: hooks on streams that end without `finish` ([[decisions/2026-10-21-hook-on-unfinished-streams]]).
