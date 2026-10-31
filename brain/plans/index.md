# Plans

There was no milestone as of 2026-10-22 (`gh api repos/sferarc/ai-gateway-proxy/milestones`; not rechecked on 2026-10-24). [[roadmap]] lists the open gaps recorded in the architecture notes. [[post-0-2-0-gaps]] records the unknowns left once those land.

## Open issues

As of 2026-10-30 (`gh issue list --state all`), one issue is open: #70 asked the owner to decide the owner-blocked items in [[post-0-2-0-gaps]], and leaves item 3's paid gateway check with the owner. The owner decided on 2026-10-26 to build items 1, 2 and 4: fail-closed path matching, raw hooks for the other calls, and strict `afterResponse` validation, which landed in #73. #70 is still open for item 3. No pull request was open on 2026-10-30.

## Landed on main

- #48 (a05f9d0): action pins updated to their latest versions. It bumped `jdx/mise-action` to v5.2.1 in `release.yml` (the publish path). The pin was confirmed in #50.
- #55 (368d742): the upstream finish event is forwarded when the hook returns nothing.
- #56 (71bf5dd): the first npm release is prepared, with the verified publish path and a minor changeset, so the first version pull request is `0.2.0`.
- #57 (0ffa695): the plans index refresh after #55 and #56.
- #58 (b0d54de): the upstream body is forwarded when `afterResponse` returns nothing.
- #59 (f1a24e7): a `language-model` path runs every hook ([[decisions/2026-10-21-language-model-path-runs-hooks]]).
- #60 (2f71431): the hooks are typed on specification version 4.
- #61 (95fa86b): `afterResponse` runs on streams that end without `finish` ([[decisions/2026-10-21-hook-on-unfinished-streams]]).
- #62 (d3d10b3), #63 (953b5bc): the gap proposal [[post-0-2-0-gaps]] and the plans index refresh.
- #64 (0072b76): gateway redirects fail closed and non-object `afterResponse` results are rejected ([[decisions/2026-10-21-fail-closed-redirects-and-hook-results]]).
- #65 (1ccbb88): the README describes the proxy's error bodies as the code sends them.
- #66 (50d6250): tests pin the folded language model and batch read path spellings.
- #67 (2705147): the [[post-0-2-0-gaps]] and plans index refresh after #59 to #66.
- #68 (5f9f069): `src/non-language-model.test.ts` pins embedding, image, video and batch start passthrough against a fake gateway. Gap 3 in [[post-0-2-0-gaps]] stays open, since the real gateway's responses are still unobserved.
- #69 (6dedaab): `src/redirect.test.ts` pins the refusal to follow gateway redirects over real HTTP ([[decisions/2026-10-21-fail-closed-redirects-and-hook-results]]).
- #71 (464ee03): brain hashes that did not resolve replaced, and #67 to #70 logged here.
- #73 (e1ee662): items 1, 2 and 4 of [[post-0-2-0-gaps]] built on the #70 decision ([[decisions/2026-10-26-fail-closed-path-matching]], [[decisions/2026-10-26-strict-after-response-results]], "Raw hooks" in [[architecture/proxy]]).
- #72, #75, #77, #78, #81, #82 (81a2f08 to 62527ac): a hook result or request body the proxy cannot use is handled instead of forwarded as is; each is a step of [[architecture/proxy]].
- #83, #85, #87, #90, #92 (5129346 to 2bd37cb): request and response bodies forwarded without needless reads, bodyless 204 and 205, and the missing credential typed `proxy_error` ([[architecture/proxy]]).
- #84, #91, #95 (00780f7, fc319d5, ad2e81e): stream fixes for client aborts, `providerMetadata` and error parts ([[architecture/streaming]]).
- #86 (8148a8f): `baseUrl` defaults to `/v4/ai` ([[decisions/2026-10-28-default-base-url-v4]]).
- #96 (1b1b42c): the language model hooks get the client's `modelId`, so `afterResponse` can meter per model (listed as landed in [[roadmap]]).
- #98 (1efd26f): CommonJS type declarations for the `require` export, checked by `pnpm attw` ([[development/ci]] step 10).
- #74, #88, #89, #93, #97: README and doc comment changes with the tests that pin them ([[development/testing]]).
- #76, #79, #80: the weekly dependency updates (#76, #80) and action pin update (#79); #76 (dc6c3e2) moved the Node pin to `26.12.1` ([[development/toolchain]], [[development/release]]).

## Release

The first release is held. Publishing stays off until the owner sets the npm trusted publisher, shares the `HQ_APP_*` secrets with the repository and sets `RELEASE_ENABLED`; the steps are in [[development/release]] (#56) and the reason in [[decisions/2026-10-08-release-off-until-enabled]].

Add a note here when a plan is too long for an issue, and link it from the issue.
