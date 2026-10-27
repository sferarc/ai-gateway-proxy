---
"ai-gateway-proxy": patch
---

Cancel the unread upstream body when `afterRawResponse` sends another `Response`, throws or returns an invalid result, so a video call's event stream no longer stays open upstream after the client got the replacement or the 500. A replacement built on `response.body` keeps it.
