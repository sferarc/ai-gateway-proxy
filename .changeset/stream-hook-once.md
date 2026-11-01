---
"ai-gateway-proxy": patch
---

`afterResponse` runs once per stream. A second `finish` event from the gateway gets the first call's rewrite instead of calling the hook again, so a metering hook no longer counts the stream twice.
