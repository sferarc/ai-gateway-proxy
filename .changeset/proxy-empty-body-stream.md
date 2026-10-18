---
"ai-gateway-proxy": patch
---

Forward a request whose body is an empty stream without a body, as for a missing body, instead of answering `400 Invalid JSON body`. Node adapters, including the README's Express example, give a bodyless `DELETE` such a stream.
