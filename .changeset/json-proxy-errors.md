---
"ai-gateway-proxy": patch
---

Return errors the proxy raises itself (missing authentication, invalid path, invalid JSON body, missing stream body, failed upstream request) as JSON in the `GatewayError` shape with types `invalid_request_error` and `proxy_error`, so AI SDK clients can parse them. Unexpected failures are now logged with `console.error`, except when the client aborted.
