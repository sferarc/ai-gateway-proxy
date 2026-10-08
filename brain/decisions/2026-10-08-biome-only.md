# Biome is the only linter

Recorded 2026-10-08, from `biome.json`, `.github/workflows/ci.yml` and #1.

## Decision

Biome lints and formats (`pnpm lint`, `pnpm fix`, and the lefthook pre-commit job). ESLint is not used: no ESLint package is installed, and the `.eslintrc.js` left over from the monorepo was removed in #1.

## Why

One tool for lint and format, and the one CI checks.

## What would reopen it

A rule Biome cannot express that the project needs.
