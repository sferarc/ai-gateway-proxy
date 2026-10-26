# Decisions

Dated records of choices a later change could undo by accident. Each says what was decided, why, and what would reopen it. Newest first.

- [[2026-10-26-strict-after-response-results]]: an `afterResponse` result with a missing or wrong-typed field is rejected, not forwarded
- [[2026-10-26-fail-closed-path-matching]]: the hooks run on every path except an exact list of other-call paths, whatever the headers
- [[2026-10-21-fail-closed-redirects-and-hook-results]]: the upstream call never follows a redirect, and a non-object `afterResponse` result is an error
- [[2026-10-21-hook-on-unfinished-streams]]: `afterResponse` also runs on streams that end, fail or are cancelled before `finish`, as a minor change
- [[2026-10-21-language-model-path-runs-hooks]]: a `/language-model` path runs every hook, whatever model headers the client sends (superseded by the fail-closed list)
- [[2026-10-08-standalone-repository]]: the proxy left the SferaDev/SferaDev monorepo for its own repository
- [[2026-10-08-release-off-until-enabled]]: `release.yml` does nothing until the owner sets `RELEASE_ENABLED`
- [[2026-10-08-no-gateway-key-in-ci]]: CI stores no `AI_GATEWAY_API_KEY`, so the integration tests skip there
- [[2026-10-08-typescript6-shim-for-bunchee]]: TypeScript 7, with the TypeScript 6 API installed for bunchee's declarations
- [[2026-10-08-biome-only]]: Biome is the only linter and formatter
- [[2025-12-28-bunchee-build]]: bunchee builds the package, replacing tsup
