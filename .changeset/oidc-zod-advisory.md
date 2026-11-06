---
"ai-gateway-proxy": patch
---

Raise `@vercel/oidc` to 4.0.6 so installs resolve `zod` 4.6.6 or later, which fixes the high advisory GHSA-mrhx-c7xc-m3w5 that `@vercel/oidc` 4.0.5 pulled in through `@vercel/cli-config`.
