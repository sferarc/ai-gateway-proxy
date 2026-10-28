---
"ai-gateway-proxy": patch
---

Stream a successful non-streaming response through unread when no `afterResponse` reads it: on a language model call without the hook, and on every embedding, image, speech, transcription, reranking, decision and batch call. The proxy used to buffer, parse and re-serialise every JSON body, which held an image or video model's base64 output in memory several times over and turned a successful body that was not JSON into a 500. The client now gets the upstream bytes and `content-type`. With `afterResponse` set, a language model response is still parsed for the hook.
