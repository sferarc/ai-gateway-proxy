# ai-gateway-proxy

A route handler that forwards AI SDK language model calls to the Vercel AI Gateway, with API key or Vercel OIDC authentication and `beforeRequest`, `afterResponse` and `onError` hooks. A TypeScript library on npm. `README.md` is the user documentation.

## Knowledge Base

Read `brain/` files relevant to your task before acting. Update after changes.

| Topic | Doc |
| --- | --- |
| Module map, exports, invariants | `brain/architecture/overview.md` |
| `createGatewayProxy`, the request path and hooks | `brain/architecture/proxy.md` |
| API key and OIDC authentication | `brain/architecture/auth.md` |
| Streaming and `afterResponse` | `brain/architecture/streaming.md` |
| Node, pnpm, mise, commands | `brain/development/toolchain.md` |
| Tests, and the integration tests that need a key | `brain/development/testing.md` |
| CI and branch rules | `brain/development/ci.md` |
| Releasing with changesets | `brain/development/release.md` |
| Decisions, dated | `brain/decisions/index.md` |
| Plans | `brain/plans/index.md` |

## Brain

The `brain/` directory is an Obsidian vault: persistent notes on how the library works and why.

- **Read first.** Read brain files relevant to your task before acting.
- **Write** after mistakes, corrections, or notable learnings about the code.
- **Structure:** One topic per file. Directories with `[[wikilink]]` indexes.
- **Verifiable:** Cite the file, test, commit or pull request behind a claim, and mark unknowns as unknown.
- **Public:** This repository is public. Keep notes to the code and the project's own process.
- **Maintain:** Delete outdated notes rather than letting them drift.

## Ground rules

- Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm exec lefthook validate`, `pnpm knip`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm is-tree-shakable` before opening a pull request. CI runs exactly these, and `Check` is required to merge.
- Never add an `AI_GATEWAY_API_KEY` to CI or spend money on the gateway: the integration tests skip without it on purpose.
- Add a changeset (`pnpm changeset`) for a change that should ship.
- No em or en dashes in prose. Commit subjects are imperative with a conventional prefix.
- Never publish, tag, bump the version or set `RELEASE_ENABLED`: releases are the owner's step (`brain/development/release.md`).
