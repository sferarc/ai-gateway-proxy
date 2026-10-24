# bunchee builds the package

Recorded 2025-12-28, from commit 195a421 (monorepo pull request #12).

## Decision

The build moved from tsup to bunchee, which reads `package.json` `exports` and emits `dist/index.mjs`, `dist/index.cjs` and `dist/index.d.ts`.

## Why

"Switch build system from tsup to bunchee for better ESM exports" (195a421 message body). Nothing more specific is recorded.

## Consequences

bunchee's declaration build needs the TypeScript 6 API ([[2026-10-08-typescript6-shim-for-bunchee]]).

## What would reopen it

Unknown.
