# Release stays off until the owner enables it

Recorded 2026-10-08, from `.github/workflows/release.yml` and commit 9f416d6.

## Decision

The `Release` job has `if: vars.RELEASE_ENABLED == 'true'`. Until the repository variable is set, every run on `main` is skipped, so merging a changeset publishes nothing.

## Why

The first release from this repository is the owner's decision (`release.yml` header comment). Earlier versions were published from the monorepo, and a trusted publisher for this repository may not exist yet ([[development/release]]).

## Consequences

- Only the owner sets `RELEASE_ENABLED`. Contributors and automated sessions never set it, publish, tag or bump the version.
- Changesets can still be added; they accumulate until release is enabled.

## What would reopen it

The owner enabling releases.
