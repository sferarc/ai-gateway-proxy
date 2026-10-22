# Fail closed on redirects and malformed hook results

Recorded 2026-10-21, from `src/proxy.ts` and the owner's decision on the proxy gap list (#62).

## Decision

The upstream `fetch` uses `redirect: "manual"`, and any 3xx answer returns 502 `proxy_error` without following `Location`. An `afterResponse` result that is not an object, or is an array, throws and returns the usual 500 instead of being forwarded. A hook that returns nothing keeps the fallback from #55: the upstream body is sent and one line is logged. No new hook was added for either case.

## Why

`fetch` follows redirects by default and resends the request, so a redirecting upstream or `baseUrl` would receive the gateway bearer token and the request body. The proxy has no reason to follow one, so it refuses. A string or number from a hook was serialised into the body, which a client cannot parse as a response.

## What would reopen it

A gateway endpoint that legitimately answers with a redirect the proxy must follow.
