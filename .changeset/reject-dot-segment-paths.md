---
"ai-gateway-proxy": patch
---

Reject request paths with `.` or `..` segments (including percent-encoded ones) with `400 Invalid path`, so a caller can no longer steer the authenticated upstream request outside the configured `baseUrl`. Forward the client's abort signal to the upstream fetch and return `499` when the client disconnects, so an abandoned generation stops instead of running on.
