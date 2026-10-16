---
"ai-gateway-proxy": patch
---

Keep every line of a streamed event whose data spans several `data:` lines when `afterResponse` is set. Each line was written back without its `data:` prefix, so the client received only the first line.
