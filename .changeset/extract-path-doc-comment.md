---
"ai-gateway-proxy": patch
---

Document every path the proxy rejects with `400 Invalid path` in the `extractPath` doc comment: a segment that fails to percent-decode, or decodes to `.`, `..` or text containing `/`, `\` or a NUL byte, not only a leading `/`, `://` and dot segments.
