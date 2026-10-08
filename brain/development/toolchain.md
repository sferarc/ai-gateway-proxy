# Toolchain

## Node and pnpm

`mise.toml` pins Node `26.10.0` and pnpm `12.10.1`, with `lockfile = true`; `mise.lock` records their checksums per platform. `mise install` in the repository root provides both. After changing a version in `mise.toml`, run `mise lock` and commit both files. `package.json` `packageManager` names the same pnpm. There is no `engines` field, so the supported Node range for consumers is unknown.

## Commands

From `package.json` and `README.md`:

```bash
pnpm install --frozen-lockfile
pnpm lint             # biome check . (lint and format, read-only)
pnpm fix              # biome check --write .
pnpm knip             # unused files, exports and dependencies
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # bunchee, emits dist/index.{mjs,cjs,d.ts}
pnpm is-tree-shakable # after build
pnpm changeset        # describe a change for the next release
```

`pnpm install` also installs lefthook hooks (`lefthook.yml`): a pre-commit job that runs `biome check --write` on staged JS, TS and JSON and restages them, and a commit-msg job that refuses Claude Code attribution in a commit.

## Lint and format

Biome only (`biome.json`): tabs, 100 columns, double quotes, the recommended preset with a few rules off. There is no ESLint.

## TypeScript

`tsconfig.json`: `strict`, `module` `ESNext`, `moduleResolution` `bundler`, `isolatedModules`, `skipLibCheck`. The `typescript` package is 7. bunchee emits declarations through the TypeScript 6 JavaScript API, so `@typescript/typescript6` is installed as a shim and ignored by knip (`pnpm-workspace.yaml`, `knip.json`). See [[decisions/2026-10-08-typescript6-shim-for-bunchee]].

## Dependencies

Every version lives in the `catalog` of `pnpm-workspace.yaml`, and `package.json` refers to it as `catalog:`. `catalogMode: strict` makes `pnpm add` refuse a version outside the catalog, and `saveExact` keeps entries exact. `overrides` carries security floors for `postcss`, `rollup` and `undici` from the monorepo. `allowBuilds` lets only lefthook run its install script.
