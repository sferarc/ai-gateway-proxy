# ai-gateway-proxy

## 0.0.2

### Patch Changes

- ba83f6e: Add streaming support with response hooks and improved documentation

  - Add `afterResponse` hook that works with both streaming and non-streaming responses
  - Add `onError` hook for custom error handling
  - Rename `transformRequest` to `beforeRequest` for consistency
  - Add `StreamContentAggregator` for aggregating streaming content
  - Add `createStreamTransformer` for stream transformation
  - Export all types for better TypeScript support
  - Add comprehensive README
