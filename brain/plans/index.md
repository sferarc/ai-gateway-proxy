# Plans

There is no milestone as of 2026-10-21 (`gh api repos/sferarc/ai-gateway-proxy/milestones`). [[roadmap]] lists the open gaps recorded in the architecture notes. [[post-0-2-0-gaps]] records the unknowns left once those land.

## Open issues

As of 2026-10-21 (`gh issue list --state open`), no issue is open.

## Landed on main

- #48 (e31b432): action pins updated to their latest versions. It bumped `jdx/mise-action` to v5.2.1 in `release.yml` (the publish path). The pin was confirmed in #50.
- #55 (470c224): the upstream finish event is forwarded when the hook returns nothing.
- #56 (cfa4c3b): the first npm release is prepared, with the verified publish path and a minor changeset, so the first version pull request is `0.2.0`.
- #64: gateway redirects fail closed and non-object `afterResponse` results are rejected ([[decisions/2026-10-21-fail-closed-redirects-and-hook-results]]).

## Release

The first release is held. Publishing stays off until the owner sets the npm trusted publisher, confirms `GIT_TOKEN` and sets `RELEASE_ENABLED`; the steps are in [[development/release]] (#56) and the reason in [[decisions/2026-10-08-release-off-until-enabled]].

Add a note here when a plan is too long for an issue, and link it from the issue.
