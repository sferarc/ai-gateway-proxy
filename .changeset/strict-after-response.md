---
"ai-gateway-proxy": minor
---

Reject an `afterResponse` result with a missing or wrong-typed field instead of forwarding it. Behavior change: on a non-streamed request such a result now returns `500` with the message `afterResponse hook returned an invalid response: <problem>`, which names the field, and on a stream the original `finish` event is forwarded and the problem logged. Before, the object was sent as returned, and a stream's `finish` event lost the missing fields. A non-object result now gets the same message instead of `Error proxying request to AI Gateway`. `null` counts as an absent field and `warnings` may be left out.
