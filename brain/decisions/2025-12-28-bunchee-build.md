# bunchee builds the package

Recorded 2025-12-28, from commit 195a421 (monorepo pull request #12).

## Decision

The build moved from tsup to bunchee, which reads `package.json` `exports` and emits `dist/index.mjs`, `dist/index.cjs` and their declarations, `dist/index.d.ts` and, since 2026-10-28, `dist/index.d.cts`.

## Why

"Switch build system from tsup to bunchee for better ESM exports" (195a421 message body). Nothing more specific is recorded.

## Consequences

bunchee's declaration build needs the TypeScript 6 API ([[2026-10-08-typescript6-shim-for-bunchee]]).

bunchee emits one declaration file per `types` entry it finds in `exports`. Until 2026-10-28 the `.` export had a single `types` beside `import` and `require`, so only `dist/index.d.ts` was built, and in a `type: module` package TypeScript reads a `.d.ts` as ESM. A CommonJS consumer resolving with `node16` or `nodenext` was then given ESM types for the CommonJS `dist/index.cjs`, which `@arethetypeswrong/cli` 0.18.5 reports as "Masquerading as ESM" ([FalseESM](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseESM.md)). The `import` and `require` conditions now each carry their own `types`, and bunchee builds `dist/index.d.cts` for `require`. `pnpm attw` in `check` and CI keeps it that way ([[development/ci]]); it exits 1 on the old map.

## What would reopen it

Unknown.
