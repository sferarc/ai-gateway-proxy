---
"ai-gateway-proxy": patch
---

Add a README section on protecting the proxy route: the proxy does not check who calls it, so check the caller's token, sent as the client's `apiKey`, before handing the request to the proxy.
