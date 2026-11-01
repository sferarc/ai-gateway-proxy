---
"ai-gateway-proxy": patch
---

Never hand `afterResponse` a successful non-streamed body that is JSON but not an object, such as `null`, an array or a string: it is a 500 `proxy_error`, as a body that is not JSON already was, instead of a `TypeError` for `null` or a hook receiving a value that is not a `GatewayResponse`.
