---
"ai-gateway-proxy": minor
---

Retype a gateway `authentication_error` as `proxy_error` with the message `AI Gateway rejected the proxy's credential: <message>`, keeping the status and the other fields, before `onError` runs. Only the proxy's own credential reaches the gateway, but `@ai-sdk/gateway` answered that type by telling the client its own API key was invalid; it now shows the gateway's message.
