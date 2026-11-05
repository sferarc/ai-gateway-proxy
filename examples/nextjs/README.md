# Next.js example

A minimal App Router app that puts ai-gateway-proxy behind a caller check and meters each caller's usage. The page in the browser calls `streamText` through the route with the caller's token, and the gateway key never leaves the server.

- `app/api/ai/[...segments]/route.ts`: the proxy route. It answers 401 to a request without a known caller token. In `beforeRequest` it caps `maxOutputTokens` to what is left of the caller's output token limit and charges that cap at once, so concurrent calls cannot spend the same remainder, and refuses with 403 once the limit is spent. `afterResponse` replaces the cap with the usage the gateway reports, and `onError` releases it. A call that reports no usage keeps its cap charged, since the gateway still bills what it generated: a stream the client cancels before its finish event, or a call whose upstream request fails. Embedding, image, video and the other calls that are not language model calls are not metered, so `beforeRawRequest` refuses them with 403.
- `app/api/usage/route.ts`: the signed-in caller's totals.
- `app/page.tsx`: a prompt form that streams the answer and shows the totals.
- `lib/callers.ts`: two demo tokens, `demo-token-alice` and `demo-token-bob`, standing in for your session check. Replace it before deploying anywhere reachable.
- `lib/usage.ts`: the totals, in memory, so they reset on restart and are not shared between server instances. Use your database in a real app.

## Run it

From the repository root, with the toolchain from `mise.toml`:

```bash
pnpm install --frozen-lockfile
pnpm build
cd examples/nextjs
AI_GATEWAY_API_KEY=<your key> pnpm dev
```

Open http://localhost:3000, pick a caller and send a prompt. Every prompt is a paid gateway call on your key. On Vercel, the proxy can use the project's OIDC token instead of `AI_GATEWAY_API_KEY` (see Authentication in the main README).

The example uses the built package in `dist`, so run `pnpm build` again after changing `src`. Its scripts use webpack: with Turbopack, Next.js takes this repository's own `src/proxy.ts` for its proxy (middleware) file and fails the build.
