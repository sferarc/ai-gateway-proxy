# ai-gateway-proxy

## 0.1.0

### Minor Changes

- 81f6330: Add framework-agnostic support with `extractPath` and `segmentsParam` options

  - `extractPath`: Custom function to extract the gateway path from the request URL, enabling use with Hono, Express, and other frameworks without catch-all route support
  - `segmentsParam`: Customize the name of the catch-all parameter in Next.js routes (defaults to "segments")
  - Context parameter is now optional when using `extractPath`

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
