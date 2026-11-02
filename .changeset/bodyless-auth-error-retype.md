---
"ai-gateway-proxy": minor
---

Retype a gateway `authentication_error` on a bodyless request, such as `@ai-sdk/gateway`'s `getAvailableModels()` (`GET /config`), as `proxy_error` with the message `AI Gateway rejected the proxy's credential: <message>`, as calls with a body already do. The client was told its own key was invalid when the proxy's was rejected. Other bodyless errors still come back as received.
