---
"ai-gateway-proxy": minor
---

Every hook receives `incomingRequest`, the `Request` the handler was called with, so a hook can meter or refuse a call per caller from its headers or URL instead of wrapping the handler.
