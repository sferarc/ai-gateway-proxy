# Plans

There is no milestone as of 2026-10-20 (`gh api repos/sferarc/ai-gateway-proxy/milestones`). [[roadmap]] lists the open gaps recorded in the architecture notes.

## Open issues

As of 2026-10-21 (`gh issue list --state open`), both wait on the owner:

- #8: "needs-human: weekly action refresh re-renders the full stack policy into this public repository".
- #50: "Confirm the jdx/mise-action v5.2.1 pin in #48 before it lands", labelled `needs-human`. #48 has since merged (`e31b432`) with the pin unconfirmed, so the check now covers what is on `main`.

Merged since the last sync: #48 (action pins), #55 (the upstream `finish` event is forwarded when the hook returns nothing, `470c224`) and #56 (first release preparation, `cfa4c3b`).

Known pending item: the first release from this repository waits on the owner ([[decisions/2026-10-08-release-off-until-enabled]]).

Add a note here when a plan is too long for an issue, and link it from the issue.
