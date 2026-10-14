---
"ai-gateway-proxy": patch
---

Report the upstream status and a short excerpt of the body when the gateway returns a non-JSON error, such as an HTML 502 page, instead of `Unknown error`, and forward the gateway's `x-vercel-id` on proxied JSON, streamed and error responses so failures can be matched to gateway logs.
