# Release stays off until the owner enables it

Recorded 2026-10-08, from `.github/workflows/release.yml` and commit a8cb76e.

Status: the owner enabled releases on 2026-11-01. `RELEASE_ENABLED` is `true` and 0.2.0 was the first version published from this repository (#112, [[development/release]]). The gate stays in `release.yml`, so unsetting the variable stops publishing again.

## Decision

The `Release` job has `if: vars.RELEASE_ENABLED == 'true'`. Until the repository variable is set, every run on `main` is skipped, so merging a changeset publishes nothing.

## Why

The first release from this repository is the owner's decision (`release.yml` header comment). Earlier versions were published from the monorepo, and a trusted publisher for this repository may not exist yet ([[development/release]]).

## Consequences

- Only the owner sets `RELEASE_ENABLED`. Contributors and automated sessions never set it, publish, tag or bump the version.
- Changesets can still be added; they accumulate until release is enabled.

## What would reopen it

The owner enabling releases, which happened on 2026-11-01.
