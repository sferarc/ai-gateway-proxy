---
"ai-gateway-proxy": patch
---

An `onError` hook that throws is logged and the upstream error body is forwarded with its status and `retry-after`, instead of a 500 that hid the gateway's error and made a 400 look retryable.
