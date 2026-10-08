# bunchee builds the package

Recorded 2025-12-28, from commit 8b9dde6 (monorepo pull request #12).

## Decision

The build moved from tsup to bunchee, which reads `package.json` `exports` and emits `dist/index.mjs`, `dist/index.cjs` and `dist/index.d.ts`.

## Why

"Better ESM exports" (8b9dde6 message). Nothing more specific is recorded.

## Consequences

bunchee's declaration build needs the TypeScript 6 API ([[2026-10-08-typescript6-shim-for-bunchee]]).

## What would reopen it

Unknown.
