---
"ai-gateway-proxy": patch
---

Give `onError` a `GatewayError` even when the gateway answers with JSON in another shape, such as `null`, a bare string or `{ "message": ... }`. Those bodies now become a `gateway_error` naming the status and an excerpt, as non-JSON bodies already did, instead of reaching the hook as is, where reading `error.error.message` threw and the upstream status was replaced by a 500.
