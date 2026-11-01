# Roadmap

GitHub Issues are the source of truth for pending work, progress and priority: open issues labelled `product:ai-gateway-proxy`, and the `roadmap` tracking issues below. This note keeps the vision and the phases only; file new work as an issue, not here.

## Vision

A small route handler that lets an AI SDK client reach the Vercel AI Gateway through the caller's own server, with the caller's credential and hooks, and that forwards everything else unchanged. Gaps come from [[architecture/proxy]] and [[architecture/streaming]].

## Phases

- **First npm release**, #113: the publish path is built and held until the owner enables it ([[development/release]]). Child: #112.
- **Owner questions on gateway errors and call coverage**, #114: each changes the public contract or needs paid gateway calls. Children: #109 (a proxy 500 after a billed answer makes the client retry), #110 (a gateway 401 blames the client's own key), #70 (non-language-model calls against the real gateway, item 3 of [[post-0-2-0-gaps]]), #111 (client calls that bypass the handler, "Calls that do not reach the handler" in [[architecture/proxy]]).

Close a phase's tracking issue when its children are closed, and update its line here.

Landed: hooks on streams that end without `finish` ([[decisions/2026-10-21-hook-on-unfinished-streams]]); `modelId` on the language model hooks, so `afterResponse` can meter per model ([[architecture/proxy]] step 6).
