---
"ai-gateway-proxy": patch
---

Forward `GET` and `HEAD` requests without parsing or sending a body, so `getAvailableModels()` from `@ai-sdk/gateway` works through the proxy instead of returning `400 Invalid JSON body`. The hooks do not run for these requests, and the upstream status and body are returned unchanged.
