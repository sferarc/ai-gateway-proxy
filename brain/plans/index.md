# Plans

There is no milestone as of 2026-10-21 (`gh api repos/sferarc/ai-gateway-proxy/milestones`). [[roadmap]] lists the open gaps recorded in the architecture notes.

## Open issues

As of 2026-10-21 (`gh issue list --state open`), two issues wait on the owner:

- #8: "needs-human: weekly action refresh re-renders the full stack policy into this public repository".
- #50: "Confirm the jdx/mise-action v5.2.1 pin in #48 before it lands", labelled `needs-human`. #48 landed with the pin in `.github/workflows/release.yml`, so the owner needs to confirm it or close the issue.

#15 is closed (2026-10-20). It asked for #9 to be closed as superseded by #14 (#53).

## Landed on main

- #48 (e31b432): action pins updated to their latest versions. It landed before #50 was resolved, bumped `jdx/mise-action` to v5.2.1 in `release.yml` (the publish path) and re-rendered `.github/workflows/hq-stack.yml`, which is what #8 is about.
- #55 (470c224): the upstream finish event is forwarded when the hook returns nothing.
- #56 (cfa4c3b): the first npm release is prepared, with the verified publish path and a minor changeset, so the first version pull request is `0.2.0`.

## Release

The first release is held. Publishing stays off until the owner sets the npm trusted publisher, confirms `GIT_TOKEN` and sets `RELEASE_ENABLED`; the steps are in [[development/release]] (#56) and the reason in [[decisions/2026-10-08-release-off-until-enabled]].

Add a note here when a plan is too long for an issue, and link it from the issue.
