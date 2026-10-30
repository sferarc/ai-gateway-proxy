# Toolchain

## Node and pnpm

`mise.toml` pins Node and pnpm exactly (Node `26.12.1` and pnpm `12.14.0` as of #80, e960769; the weekly dependency update moves them, so read `mise.toml` for the current pair), with `lockfile = true`; `mise.lock` records their checksums per platform. `mise install` in the repository root provides both. After changing a version in `mise.toml`, run `mise lock` and commit both files. `package.json` `packageManager` names the same pnpm. There is no `engines` field, so the supported Node range for consumers is unknown.

## Commands

From `package.json`. `pnpm check` is the one to run before a pull request; the rest are its steps and helpers.

```bash
pnpm install --frozen-lockfile
pnpm check            # everything CI runs, in CI order, stopping at the first failure
pnpm lint             # biome check . (lint and format, read-only)
pnpm fix              # biome check --write .
pnpm knip             # unused files, exports and dependencies
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:integration # only src/integration.test.ts; skipped without AI_GATEWAY_API_KEY
pnpm build            # bunchee, emits dist/index.{mjs,cjs,d.ts,d.cts}
pnpm is-tree-shakable # after build
pnpm attw             # after build: declarations match each module format
pnpm changeset        # describe a change for the next release
```

`pnpm install` also installs lefthook hooks (`lefthook.yml`): a pre-commit job that runs `biome check --write` on staged JS, TS and JSON and restages them, and a commit-msg job that refuses Claude Code attribution in a commit.

## Lint and format

Biome only (`biome.json`): tabs, 100 columns, double quotes, the recommended preset with a few rules off. There is no ESLint.

## TypeScript

`tsconfig.json`: `strict`, `module` `ESNext`, `moduleResolution` `bundler`, `isolatedModules`, `skipLibCheck`. `lib` keeps `dom` beside `ESNext`: without it the fetch types come from `@types/node`, where `Request.json()` and `Response.json()` return `Promise<unknown>`, and the proxy and its tests stop typechecking. The `typescript` package is 7. bunchee emits declarations through the TypeScript 6 JavaScript API, so `@typescript/typescript6` is installed as a shim and ignored by knip (`pnpm-workspace.yaml`, `knip.json`). See [[decisions/2026-10-08-typescript6-shim-for-bunchee]].

## Dependencies

Every version lives in the `catalog` of `pnpm-workspace.yaml`, and `package.json` refers to it as `catalog:`. `catalogMode: strict` makes `pnpm add` refuse a version outside the catalog, and `saveExact` keeps entries exact. `overrides` carries security floors for `postcss`, `rollup` and `undici` from the monorepo. `allowBuilds` lets only lefthook run its install script.
