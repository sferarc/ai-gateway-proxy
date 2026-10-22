# Plans

There is no milestone as of 2026-10-22 (`gh api repos/sferarc/ai-gateway-proxy/milestones`). [[roadmap]] lists the open gaps recorded in the architecture notes. [[post-0-2-0-gaps]] records the unknowns left once those land.

## Open issues

As of 2026-10-22 (`gh issue list --state open`), no issue is open.

## Landed on main

- #48 (e31b432): action pins updated to their latest versions. It bumped `jdx/mise-action` to v5.2.1 in `release.yml` (the publish path). The pin was confirmed in #50.
- #55 (470c224): the upstream finish event is forwarded when the hook returns nothing.
- #56 (cfa4c3b): the first npm release is prepared, with the verified publish path and a minor changeset, so the first version pull request is `0.2.0`.
- #57 (0ffa695): the plans index refresh after #55 and #56.
- #58 (b0d54de): the upstream body is forwarded when `afterResponse` returns nothing.
- #59 (f1a24e7): a `language-model` path runs every hook ([[decisions/2026-10-21-language-model-path-runs-hooks]]).
- #60 (2f71431): the hooks are typed on specification version 4.
- #61 (95fa86b): `afterResponse` runs on streams that end without `finish` ([[decisions/2026-10-21-hook-on-unfinished-streams]]).
- #62 (d3d10b3), #63 (953b5bc): the gap proposal [[post-0-2-0-gaps]] and the plans index refresh.
- #64 (0072b76): gateway redirects fail closed and non-object `afterResponse` results are rejected ([[decisions/2026-10-21-fail-closed-redirects-and-hook-results]]).
- #65 (1ccbb88): the README describes the proxy's error bodies as the code sends them.
- #66 (50d6250): tests pin the folded language model and batch read path spellings.

## Release

The first release is held. Publishing stays off until the owner sets the npm trusted publisher, confirms `GIT_TOKEN` and sets `RELEASE_ENABLED`; the steps are in [[development/release]] (#56) and the reason in [[decisions/2026-10-08-release-off-until-enabled]].

Add a note here when a plan is too long for an issue, and link it from the issue.
