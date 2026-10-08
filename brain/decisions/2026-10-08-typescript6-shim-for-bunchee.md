# TypeScript 7 with a TypeScript 6 shim for bunchee

Recorded 2026-10-08, from the comment in `pnpm-workspace.yaml`.

## Decision

The catalog pins `typescript` 7 and also `@typescript/typescript6` 6, which `knip.json` lists under `ignoreDependencies` because nothing imports it by name in `src/`.

## Why

bunchee emits declarations through the TypeScript 6 JavaScript API, which TypeScript 7 dropped, and looks for this shim by name (`pnpm-workspace.yaml`).

## What would reopen it

bunchee building `.d.ts` on TypeScript 7 alone. Then remove the shim and its knip exception.
