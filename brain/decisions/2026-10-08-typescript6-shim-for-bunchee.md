# TypeScript 7 with a TypeScript 6 shim for bunchee

Recorded 2026-10-08, from the comment in `pnpm-workspace.yaml`.

## Decision

The catalog pins `typescript` 7 and also `@typescript/typescript6` 6, which `knip.json` listed under `ignoreDependencies` while nothing imported it by name in `src/`. Since #183, `src/skill.test.ts` imports it to type check the agent skill's samples, since TypeScript 7 has no compiler API, so knip sees it used and the exception is gone.

## Why

bunchee emits declarations through the TypeScript 6 JavaScript API, which TypeScript 7 dropped, and looks for this shim by name (`pnpm-workspace.yaml`).

## What would reopen it

bunchee building `.d.ts` on TypeScript 7 alone. Then move `src/skill.test.ts` to whatever compiler API TypeScript 7 offers, or keep the shim for that test alone.
