# CI

`.github/workflows/ci.yml` (`CI`) runs on pushes to `main` and on every pull request, on a GitHub-hosted `ubuntu-latest` runner because the repository is public. One job, `Check`, which is the required status check on `main`.

## Steps

Steps 3 to 11 are the `check` script in `package.json`, kept as separate steps so a failure names its step. Change both together.

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, checked against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this only checks that `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`. The integration tests skip because no `AI_GATEWAY_API_KEY` is stored; `src/e2e.test.ts` covers the client to proxy to gateway path against a local fake gateway instead ([[testing]]).
8. `pnpm build`
9. `pnpm typecheck:example`: `tsc --noEmit` in `examples/nextjs`, which resolves `ai-gateway-proxy` to `dist`, so it runs after the build. The app is never started in CI, since that would call the gateway; step 7 runs its proxy route against `src` with `fetch` mocked (`src/example-nextjs.test.ts`, #180, [[toolchain]]).
10. `pnpm is-tree-shakable`
11. `pnpm attw`: `@arethetypeswrong/cli` packs the package with `npm pack` and checks that every resolution mode (node10, node16 from CommonJS and from ESM, bundler) finds declarations of the matching module format. Added on 2026-10-28, when it reported "Masquerading as ESM" for node16 from CommonJS ([[decisions/2025-12-28-bunchee-build]]).
12. `pnpm --filter . audit --prod --audit-level high` (#223), below. It stays out of `pnpm check`: its result depends on the advisory database, not on the code.

## Runtime advisories

The last `Check` step fails on a high or critical advisory in the root package's `dependencies` (`@ai-sdk/provider`, `@ai-sdk/provider-utils`, `@vercel/oidc` and what they pull in), which is what consumers install with `ai-gateway-proxy`. An advisory there blocks every pull request and release until it is bumped or accepted. Dev dependencies and moderate or lower advisories do not fail it.

`--filter .` limits the audit to the root importer. A plain `pnpm audit --prod` reads every importer in the workspace lockfile, so it also audits the production dependencies of `examples/nextjs` (`next`, `react`, `react-dom`, `ai`, `@ai-sdk/gateway`): 50 dependencies and 53 optional ones on 2026-11-06, against 32 and 14 with the filter. A `next` advisory would then block every pull request and release although the package does not ship `next`. The example's dependencies come from HQ's updater like the rest. Dependabot security updates stay off; dependency bumps keep coming from HQ's updater (sferarc/hq#989).

Accepted advisories go in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, one GHSA per line with a comment giving the reason and the condition that ends the exception. pnpm reads that list itself, so the CI step passes no `--ignore`. The list was empty when the step landed.

When the step was added on 2026-11-06, it exited 1 on GHSA-mrhx-c7xc-m3w5 (zod below 4.6.6, high) through `@vercel/oidc` 4.0.5, whose `@vercel/cli-config` 0.3.5 pins `zod` 4.1.11. The same pull request raised `@vercel/oidc` to 4.0.6 (`@vercel/cli-config` 0.3.6, `zod` `^4.6.6`), after which the step exits 0. It did not take 4.0.7, published on 2026-11-05 under a day earlier, since that needed a `minimumReleaseAgeExclude` and 4.0.6 already fixes the advisory.

Actions are pinned to full commit SHAs with the version in a trailing comment, because the organisation requires it (`ci.yml` header). Update both together.

## HQ approved stack

`.github/workflows/hq-stack.yml` (`HQ approved stack`) runs on pull requests, pushes to `main` and by hand, with two jobs: `Approved stack` and `No Claude attribution`. Its header says it is rendered in sferarc/hq and refreshed by the weekly action pin update (#3, #4, then #12, #48, #79), so do not edit it here. It is not the required check on `main`.

## Branch rules on `main`

Read from the GitHub API on 2026-10-08 (ruleset `main-default`): changes through pull requests, required check `Check`, linear history, no force pushes, no deletion. Squash or rebase merges only, and merged branches are deleted.

## Related

- [[release]] for `.github/workflows/release.yml`
