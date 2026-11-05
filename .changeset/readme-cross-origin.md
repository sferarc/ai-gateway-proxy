---
"ai-gateway-proxy": patch
---

Document how to serve the proxy route to a browser page on another origin: answer the CORS preflight, allow the headers the client sends and expose `retry-after` so the AI SDK backoff still works.
