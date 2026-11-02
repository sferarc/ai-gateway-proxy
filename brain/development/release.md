# Release

Releases use changesets. Publishing is on: `.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true`, which it has been since 2026-11-01 ([[decisions/2026-10-08-release-off-until-enabled]], #112).

## The flow

1. A change that should ship carries a changeset from `pnpm changeset` (`.changeset/README.md`).
2. On a push to `main`, `changesets/action` opens or updates a version pull request from the pending changesets.
3. Merging that pull request runs the workflow again, which publishes through `pnpm release` (`pnpm build && changeset publish`).

The workflow authenticates to npm with trusted publishing: `id-token: write`, `publishConfig.provenance: true`, and no npm token stored. Each package's trusted publisher on npmjs.com must name this repository and `release.yml` (comments in `release.yml`); it does, since the runs in [[#Current state]] published through it. The action uses a sferarc-hq App token minted by `actions/create-github-app-token` from the `HQ_APP_ID` and `HQ_APP_PRIVATE_KEY` organization secrets, rather than `github.token`, because a version pull request merged by the Actions bot would otherwise not trigger the publish run. An App token does trigger workflows, and the version commits and pull requests are authored by `sferarc-hq[bot]` rather than a person, the same setup as `sferarc/openapi`.

`.changeset/config.json`: base branch `main`, public access, the default changelog generator, no auto-commit.

## Publish path as verified

Checked 2026-10-20 against `main` before #48 landed. The hash recorded then, fd2d0bb, does not resolve in this repository, so the exact commit is unknown; it is one of 685973e (#49) through 5df7d66 (#53), the `main` commits that could have been the tip on 2026-10-20 before a05f9d0 (#48).

- `release.yml` is gated on `vars.RELEASE_ENABLED == 'true'`, runs `changesets/action` (pinned SHA, v2.1.2) with `publish-script: pnpm release`, and grants `id-token: write`, `contents: write` and `pull-requests: write` to the job only. Top-level permissions are `contents: read`.
- `github-token` was `secrets.GIT_TOKEN` at the time of this check; it is now the sferarc-hq App token (see [[#Current state]]).
- Publishing relies on npm trusted publishing: no `NPM_TOKEN`, `publishConfig.provenance: true`, npm from the Node in `mise.toml`. Whether npmjs.com lists a trusted publisher for this repository is unknown and cannot be read without the owner's npm login.
- `.changeset/config.json` is sound: base `main`, `access: public`, no auto-commit, no linked or fixed groups, nothing ignored.
- #48 (a05f9d0) landed after this check and bumped the `jdx/mise-action` pin in `release.yml` to v5.2.1; the pin was verified against the upstream tag (#50). #79 (bf8546e) moved it to v5.2.3 by the weekly pin update; that pin was not checked by hand. The other claims here still hold.
- `RELEASE_ENABLED` was not set then; it is now (see [[#Current state]]).

## Current state

As of 2026-11-02:

- `RELEASE_ENABLED` is `true`, set on 2026-11-01 (`gh variable list`). The trusted publisher on npmjs.com and the shared `HQ_APP_ID` and `HQ_APP_PRIVATE_KEY` secrets are in place, so the owner steps that used to sit here are done (#112).
- npm has `0.2.0` to `0.6.0` from this repository, published between 2026-11-01 and 2026-11-02 (`npm view ai-gateway-proxy time`), each tagged `v<version>`. The earlier `0.0.1` to `0.1.0` came from the monorepo, with the tags `ai-gateway-proxy@0.0.2` and `ai-gateway-proxy@0.1.0`.
- The version pull requests ("Version Packages", for example #116 and #127) are opened and merged by `sferarc-hq[bot]`, and the run on the merge commit publishes (run 41283580134 on c16f694 published 0.2.0, run 41395716488 on b0490aa published 0.6.0).
- `release.yml` mints a sferarc-hq App token (`actions/create-github-app-token`, pinned to the same SHA as `sferarc/openapi`) and passes it to `changesets/action`, so no commit or pull request comes from a personal account (since 2026-10-31).

## Rules for contributors and agents

Never publish by hand, tag, bump the version or change `RELEASE_ENABLED`: a release is a changeset in a pull request, then the version pull request. Adding a changeset to a pull request is fine.
