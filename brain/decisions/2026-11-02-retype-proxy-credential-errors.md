# Retype gateway authentication errors as proxy errors

Decided by the owner on 2026-11-01 in #110; the message wording was picked by the lane that shipped it.

## Decision

When the gateway answers a call that carries a body with an error typed `authentication_error`, the proxy retypes it as `proxy_error` and prefixes the message with `AI Gateway rejected the proxy's credential: `, keeping the status, `code`, `param`, `generationId` and the allowlisted headers (`retypeProxyCredentialError` in `src/proxy.ts`, step 8 of [[architecture/proxy]]). It happens before `onError`, so the hook and a hook that falls back both see the retyped error.

## Why

The proxy authenticates upstream with its own `AI_GATEWAY_API_KEY` or Vercel OIDC token ([[architecture/auth]]); the client's credential never reaches the gateway, so an authentication error there is always about the proxy's. `@ai-sdk/gateway` 4.0.126 answers `authentication_error` with `GatewayAuthenticationError.createContextualError`, which drops the gateway's message for advice about the client's own key (`createGatewayErrorFromResponse` in its `dist/index.js`), pointing whoever debugs a misconfigured proxy at the wrong key (pinned in #108). The owner chose the rewrite over forwarding unchanged and documenting an `onError` recipe. Step 1 already types a missing credential `proxy_error` for the same reason.

## Why this shape

`proxy_error` is not a type the client maps, so it builds a `GatewayInternalServerError` that keeps the message and the upstream status; 401 is not retryable, so `generateText` does not resend the call. The prefix says whose credential failed, which the type alone does not tell a person reading the error. Keeping the 401 leaves `onError` and logs able to tell the case apart.

## Not covered

A bodyless request, such as `@ai-sdk/gateway`'s `GET /config` model list, is passed through unread, so its 401 still carries `authentication_error`. Changing that means reading bodyless error bodies, tracked in #120.

## What would reopen it

A gateway route that checks a credential the client sends itself, or an `@ai-sdk/gateway` release that keeps the message for `authentication_error`.

## Why minor

Callers that matched on `authentication_error` in `onError` or on the client see a different type and message, so it is filed as `minor` like the other 0.x behavior changes ([[2026-11-01-no-retry-after-answered-call]]).
