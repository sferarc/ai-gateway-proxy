# Roadmap

There is no milestone on the repository. This note collects the open gaps recorded in [[architecture/proxy]] and [[architecture/streaming]] (the proxy gaps came out of #47, the V4 parts section out of #33 and the open question out of #18) so the next shift can pick from one list. Each item names its source and what blocks it. Items under Needs the owner need a decision on the public contract before any code.

## Needs the owner

1. **Streams that end without `finish`.** `afterResponse` is not called when the upstream ends, errors or is cancelled before `finish`, so a consumer metering usage records nothing. Options are calling the hook with partial content and unknown usage, or a separate signal. Both change the public contract. Source: "Open question" in [[architecture/streaming]]. The current behavior is pinned by tests.
2. **Hook types on specification version 4.** `StreamContentAggregator` and `GatewayResponse` are typed for V3 while `@ai-sdk/gateway` 4.x sends `4`. The hook misses `custom` and `reasoning-file` parts and `citations` on `text-end`, and receives V4 `file` data under a V3 type. Moving to V4 changes the public `GatewayResponse` type. Source: "Specification version 4 parts" in [[architecture/streaming]].

## Can be done without the owner

3. **Hook result without stream metadata.** An `afterResponse` that returns `undefined` or `null` errors the client stream instead of forwarding the upstream `finish` event. Source: "Known gap" in [[architecture/streaming]]. The fix is to read the result inside the `try` or validate it, and add a test.
4. **Language model calls that send `ai-model-id` alone.** Whether the gateway serves a `/language-model` call without `ai-language-model-id` is unknown, and if it does, that call skips the hooks. Settle it against the gateway docs or a recorded request before changing the check. Source: step 6 of [[architecture/proxy]].

## Order

Items 3 and 4 first, since they fix behavior without changing the public API. Items 1 and 2 wait on the owner, and item 2 is best done together with a V4 type bump in a major or minor release the owner picks ([[development/release]]).

Update this note when an item lands or a new gap is recorded in the architecture notes.
