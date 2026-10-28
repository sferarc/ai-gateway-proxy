# CI

`.github/workflows/ci.yml` (`CI`) runs on pushes to `main` and on every pull request, on a GitHub-hosted `ubuntu-latest` runner because the repository is public. One job, `Check`, which is the required status check on `main`.

## Steps

Steps 3 to 10 are the `check` script in `package.json`, kept as separate steps so a failure names its step. Change both together.

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, checked against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this only checks that `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`. The integration tests skip because no `AI_GATEWAY_API_KEY` is stored; `src/e2e.test.ts` covers the client to proxy to gateway path against a local fake gateway instead ([[testing]]).
8. `pnpm build`
9. `pnpm is-tree-shakable`
10. `pnpm attw`: `@arethetypeswrong/cli` packs the package with `npm pack` and checks that every resolution mode (node10, node16 from CommonJS and from ESM, bundler) finds declarations of the matching module format. Added on 2026-10-28, when it reported "Masquerading as ESM" for node16 from CommonJS ([[decisions/2025-12-28-bunchee-build]]).

Actions are pinned to full commit SHAs with the version in a trailing comment, because the organisation requires it (`ci.yml` header). Update both together.

## Branch rules on `main`

Read from the GitHub API on 2026-10-08 (ruleset `main-default`): changes through pull requests, required check `Check`, linear history, no force pushes, no deletion. Squash or rebase merges only, and merged branches are deleted.

## Related

- [[release]] for `.github/workflows/release.yml`
