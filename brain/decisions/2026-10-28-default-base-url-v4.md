# Default baseUrl follows @ai-sdk/gateway

Recorded 2026-10-28, from `DEFAULT_BASE_URL` in `src/proxy.ts` and the default `baseURL` in `@ai-sdk/gateway`'s `dist/index.js`.

## Decision

`baseUrl` defaults to `https://ai-gateway.vercel.sh/v4/ai`, the URL `@ai-sdk/gateway` 4.x calls when it has no `baseURL`. Before this the default was `https://ai-gateway.vercel.sh/v1/ai`, unchanged since the initial commit.

## Why

The gateway client puts the AI SDK specification version in the path: `@ai-sdk/gateway` 1.x and 2.x default to `/v1/ai` (specification version 2), 3.x to `/v3/ai` and 4.x to `/v4/ai` (read from each major's `dist/index.mjs` on unpkg on 2026-10-28). The proxy forwards the body the client built, and since #60 types its hooks on version 4, so version 4 bodies were going to the version 2 endpoint. Whether the gateway still serves version 4 bodies correctly at `/v1/ai`, for example by reading `ai-language-model-specification-version`, is unknown: checking it needs a key and paid calls ([[decisions/2026-10-08-no-gateway-key-in-ci]]). Matching the client means a proxied call reaches the same URL as a direct one.

`defaults to the baseUrl @ai-sdk/gateway calls without a proxy` in `src/proxy.test.ts` compares the two URLs, so a gateway major that moves its endpoint fails that test when the dev dependency is bumped.

## Why minor

Every caller that does not set `baseUrl` now reaches a different upstream URL, so it is filed as `minor` like the other 0.x behavior changes ([[2026-10-21-hook-on-unfinished-streams]]). A caller that needs the old endpoint sets `baseUrl` to it.

## What would reopen it

A gateway answer showing `/v1/ai` and `/v4/ai` differ in a way that breaks a proxied call, or a supported range of `@ai-sdk/gateway` majors wider than 4.x, which would need the path chosen per request rather than one default.
