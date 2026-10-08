# Release

Releases use changesets. Publishing is off: `.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true`, and only the owner sets it ([[decisions/2026-10-08-release-off-until-enabled]]).

## The flow once enabled

1. A change that should ship carries a changeset from `pnpm changeset` (`.changeset/README.md`).
2. On a push to `main`, `changesets/action` opens or updates a version pull request from the pending changesets.
3. Merging that pull request runs the workflow again, which publishes through `pnpm release` (`pnpm build && changeset publish`).

The workflow authenticates to npm with trusted publishing: `id-token: write`, `publishConfig.provenance: true`, and no npm token stored. Each package's trusted publisher on npmjs.com must name this repository and `release.yml` (comments in `release.yml`). Whether that is configured for this repository is unknown; the published versions came from the monorepo. The action uses the `GIT_TOKEN` secret rather than `github.token`, because a version pull request merged by the Actions bot would otherwise not trigger the publish run.

`.changeset/config.json`: base branch `main`, public access, the default changelog generator, no auto-commit.

## Current state

As of 2026-10-08: npm has `0.0.1`, `0.0.2` and `0.1.0`, all published on 2025-12-28 from the monorepo (`npm view ai-gateway-proxy`). `package.json` is `0.1.0`. The repository carries the monorepo's tags `ai-gateway-proxy@0.0.2` and `ai-gateway-proxy@0.1.0`. There are no pending changesets.

## Rules for contributors and agents

Never publish, tag, bump the version or set `RELEASE_ENABLED`. Adding a changeset to a pull request is fine.
