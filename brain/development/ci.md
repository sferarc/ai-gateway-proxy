# CI

`.github/workflows/ci.yml` (`CI`) runs on pushes to `main` and on every pull request, on a GitHub-hosted `ubuntu-latest` runner because the repository is public. One job, `Check`, which is the required status check on `main`.

## Steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, checked against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this only checks that `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`. The integration tests skip because no `AI_GATEWAY_API_KEY` is stored ([[testing]]).
8. `pnpm build`
9. `pnpm is-tree-shakable`

Actions are pinned to full commit SHAs with the version in a trailing comment, because the organisation requires it (`ci.yml` header). Update both together.

## Branch rules on `main`

Read from the GitHub API on 2026-10-08 (ruleset `main-default`): changes through pull requests, required check `Check`, linear history, no force pushes, no deletion. Squash or rebase merges only, and merged branches are deleted.

## Related

- [[release]] for `.github/workflows/release.yml`
