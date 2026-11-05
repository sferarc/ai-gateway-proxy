# Roadmap

GitHub Issues are the source of truth for pending work, progress and priority: open issues labelled `product:ai-gateway-proxy`, and the `roadmap` tracking issues below. This note keeps the vision and the phases only; file new work as an issue, not here.

## Vision

A small route handler that lets an AI SDK client reach the Vercel AI Gateway through the caller's own server, with the caller's credential and hooks, and that forwards everything else unchanged. Gaps come from [[architecture/proxy]] and [[architecture/streaming]].

## Phases

- **Owner questions on gateway errors and call coverage**, #114: each changes the public contract or needs paid gateway calls. Children: #109 (a proxy 500 after a billed answer makes the client retry; decided, [[decisions/2026-11-01-no-retry-after-answered-call]]), #110 (a gateway 401 blamed the client's own key; decided, [[decisions/2026-11-02-retype-proxy-credential-errors]]), #70 (non-language-model calls against the real gateway, item 3 of [[post-0-2-0-gaps]]), #111 (client calls that bypass the handler; decided, they stay unsupported, [[decisions/2026-11-02-client-bypass-calls-unsupported]]).
- **Positioning, proof and listing**, #181: the README opening, the Next.js example, when the proxy is not needed and the npm keywords have landed; the repository description, website and topics, the old docs pages and sponsorship wait on the owner (sferarc/hq#888, sferarc/hq#889, sferarc/hq#890).
- **Findable and usable by AI agents**, #186: error codes, the agent skill, `context7.json` and `AGENTS.md` have landed; the repository description (#157) waits on sferarc/hq#888, the Context7 submission (#203) on an owner sign in, and the sferarc.com description, llms.txt and structured data are sferarc/platform#2957, sferarc/platform#2954 and sferarc/platform#2959.

Close a phase's tracking issue when its children are closed, and update its line here.

Landed: the first npm release, #113: the owner enabled publishing on 2026-11-01 and every version from 0.2.0 on ships from this repository ([[development/release]], child #112); hooks on streams that end without `finish` ([[decisions/2026-10-21-hook-on-unfinished-streams]]); `modelId` on the language model hooks, so `afterResponse` can meter per model ([[architecture/proxy]] step 6).
