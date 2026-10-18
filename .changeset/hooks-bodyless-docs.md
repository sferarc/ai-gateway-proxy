---
"ai-gateway-proxy": patch
---

Say in the README and the hook doc comments that `beforeRequest`, `afterResponse` and `onError` are skipped for every request without a body, such as a bodyless `DELETE`, not only for `GET` and `HEAD`.
