---
"ai-gateway-proxy": patch
---

Report `finishReason` `error` to `afterResponse` when a stream sends an `error` part and ends without a `finish` event, instead of `other`, so a metering hook can tell a stream the provider failed from one that stopped for no stated reason. A `finish` part that follows the error still sets its own reason.
