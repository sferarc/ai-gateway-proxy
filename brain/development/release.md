# Release

Releases use changesets. Publishing is off: `.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true`, and only the owner sets it ([[decisions/2026-10-08-release-off-until-enabled]]).

## The flow once enabled

1. A change that should ship carries a changeset from `pnpm changeset` (`.changeset/README.md`).
2. On a push to `main`, `changesets/action` opens or updates a version pull request from the pending changesets.
3. Merging that pull request runs the workflow again, which publishes through `pnpm release` (`pnpm build && changeset publish`).

The workflow authenticates to npm with trusted publishing: `id-token: write`, `publishConfig.provenance: true`, and no npm token stored. Each package's trusted publisher on npmjs.com must name this repository and `release.yml` (comments in `release.yml`). Whether that is configured for this repository is unknown; the published versions came from the monorepo. The action uses the `GIT_TOKEN` secret rather than `github.token`, because a version pull request merged by the Actions bot would otherwise not trigger the publish run.

`.changeset/config.json`: base branch `main`, public access, the default changelog generator, no auto-commit.

## Publish path as verified

Checked 2026-10-20 against `main` before #48 landed. The hash recorded then, fd2d0bb, does not resolve in this repository, so the exact commit is unknown; it is one of 685973e (#49) through 5df7d66 (#53), the `main` commits that could have been the tip on 2026-10-20 before a05f9d0 (#48).

- `release.yml` is gated on `vars.RELEASE_ENABLED == 'true'`, runs `changesets/action` (pinned SHA, v2.1.2) with `publish-script: pnpm release`, and grants `id-token: write`, `contents: write` and `pull-requests: write` to the job only. Top-level permissions are `contents: read`.
- `github-token` is `secrets.GIT_TOKEN`. `gh secret list --org sferarc` shows `GIT_TOKEN` as an organization secret visible to all repositories (created 2026-03-18). The repository has no secret of its own. Its scopes are unknown; it must be able to push branches and open pull requests here.
- Publishing relies on npm trusted publishing: no `NPM_TOKEN`, `publishConfig.provenance: true`, npm from the Node in `mise.toml`. Whether npmjs.com lists a trusted publisher for this repository is unknown and cannot be read without the owner's npm login.
- `.changeset/config.json` is sound: base `main`, `access: public`, no auto-commit, no linked or fixed groups, nothing ignored.
- #48 (a05f9d0) landed after this check and bumped the `jdx/mise-action` pin in `release.yml` to v5.2.1; the pin was verified against the upstream tag (#50). The other claims here still hold.
- `RELEASE_ENABLED` is not set (`gh variable list` shows only the `HQ_*` variables).

## Current state

As of 2026-10-20:

- npm has `0.0.1`, `0.0.2` and `0.1.0`, all published on 2025-12-28 from the monorepo (`npm view ai-gateway-proxy versions time`). `package.json` is `0.1.0`.
- The repository carries the monorepo's tags `ai-gateway-proxy@0.0.2` and `ai-gateway-proxy@0.1.0`.
- Every pending changeset names `ai-gateway-proxy`. Each shipped `src` fix since 0.1.0 has one (matched by `git log --diff-filter=A -- .changeset` against `git log -- src`), and `update-runtime-dependencies.md` covers the dependency changes and the README rewrite. Test-only and tooling commits ship nothing and have none.
- The runtime dependencies moved majors since 0.1.0: `@ai-sdk/provider` 3 to 4, `@ai-sdk/provider-utils` 4 to 5, `@vercel/oidc` 3 to 4 (`npm view ai-gateway-proxy@0.1.0 dependencies` against the catalog in `pnpm-workspace.yaml`). The public types import from `@ai-sdk/provider`, so `update-runtime-dependencies.md` is `minor` and the first version pull request is `0.2.0`.

## Owner steps to publish

1. On npmjs.com, open `ai-gateway-proxy` settings, Trusted Publisher, add GitHub Actions with owner `sferarc`, repository `ai-gateway-proxy`, workflow `release.yml`, no environment.
2. Confirm `GIT_TOKEN` can push branches and open pull requests in `sferarc/ai-gateway-proxy` (it is already shared with the repository).
3. Set the repository variable `RELEASE_ENABLED` to `true`. The next push to `main` opens the version pull request; merging it publishes.

## Rules for contributors and agents

Never publish, tag, bump the version or set `RELEASE_ENABLED`. Adding a changeset to a pull request is fine.
