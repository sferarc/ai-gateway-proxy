# Architecture

ai-gateway-proxy is a route handler that forwards AI SDK language model calls to the Vercel AI Gateway, adding authentication and optional hooks. It has no server of its own: the caller mounts the handler in a framework route (`README.md`). Start with [[overview]].

- [[overview]]: module map, public exports and invariants
- [[proxy]]: `createGatewayProxy`, how a request is forwarded and how the hooks run
- [[auth]]: `getGatewayAuthToken`, API key first, then Vercel OIDC
- [[streaming]]: `createStreamTransformer` and `StreamContentAggregator`, the `afterResponse` hook on a streamed response
