# Roadmap

There is no milestone on the repository. This note collects the open gaps recorded in [[architecture/proxy]] and [[architecture/streaming]] (the proxy gaps came out of #47, the open question out of #18) so the next shift can pick from one list. Each item names its source and what blocks it. Items under Needs the owner need a decision on the public contract before any code.

## Needs the owner

1. **Streams that end without `finish`.** `afterResponse` is not called when the upstream ends, errors or is cancelled before `finish`, so a consumer metering usage records nothing. Options are calling the hook with partial content and unknown usage, or a separate signal. Both change the public contract. Source: "Open question" in [[architecture/streaming]]. The current behavior is pinned by tests.

## Can be done without the owner

2. **Language model calls that send `ai-model-id` alone.** Whether the gateway serves a `/language-model` call without `ai-language-model-id` is unknown, and if it does, that call skips the hooks. Settle it against the gateway docs or a recorded request before changing the check. Source: step 6 of [[architecture/proxy]].

## Order

Item 2 fixes behavior without changing the public API. Item 1 waits on the owner.

Update this note when an item lands or a new gap is recorded in the architecture notes.
