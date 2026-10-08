# Standalone repository

Recorded 2026-10-08, from commit 9f416d6.

## Decision

The proxy moved out of the SferaDev/SferaDev monorepo into `sferarc/ai-gateway-proxy`. The workspace configs it inherited became local files (`biome.json`, `knip.json`, `lefthook.yml`, `pnpm-workspace.yaml`, `tsconfig.json`), the toolchain moved to Node 26 and pnpm 12 through mise, and a changesets release workflow was added, switched off ([[2026-10-08-release-off-until-enabled]]).

## Why

So it can build, test and release on its own (9f416d6 message).

## Consequences

- History before 9f416d6 is the monorepo's. Pull request numbers in those commit subjects, such as `(#12)` and `(#16)`, refer to the monorepo, not to this repository.
- The `overrides` security floors in `pnpm-workspace.yaml` were carried over from the monorepo.
- The README still links to documentation hosted outside this repository; whether it is kept current is unknown.

## What would reopen it

Unknown. Nothing in the repository says.
