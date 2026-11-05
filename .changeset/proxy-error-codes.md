---
"ai-gateway-proxy": minor
---

Add a stable `error.code` to every error body the proxy generates itself, such as `api_key_missing`, `invalid_path` or `after_response_failed`, and export the codes as the `ProxyErrorCode` type. Callers can branch on the code instead of the message, which may be reworded between releases. A gateway `authentication_error` retyped as `proxy_error` now carries `credential_rejected` instead of the gateway's own code.
