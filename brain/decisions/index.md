# Decisions

Dated records of choices a later change could undo by accident. Each says what was decided, why, and what would reopen it. Newest first.

- [[2026-10-08-standalone-repository]]: the proxy left the SferaDev/SferaDev monorepo for its own repository
- [[2026-10-08-release-off-until-enabled]]: `release.yml` does nothing until the owner sets `RELEASE_ENABLED`
- [[2026-10-08-no-gateway-key-in-ci]]: CI stores no `AI_GATEWAY_API_KEY`, so the integration tests skip there
- [[2026-10-08-typescript6-shim-for-bunchee]]: TypeScript 7, with the TypeScript 6 API installed for bunchee's declarations
- [[2026-10-08-biome-only]]: Biome is the only linter and formatter
- [[2025-12-28-bunchee-build]]: bunchee builds the package, replacing tsup
