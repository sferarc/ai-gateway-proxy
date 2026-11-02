---
"ai-gateway-proxy": minor
---

Answer a failure after the gateway has answered a non-streamed language model call with 424 `proxy_error` instead of 500: an `afterResponse` that throws or returns an invalid result, and a success body that is not a JSON object. AI SDK clients retry a 500, so `generateText` sent the call twice more and the caller paid for it three times; they do not retry a 424.
