# A language model path runs every hook

Decided 2026-10-21, closing the roadmap item on `ai-model-id` without `ai-language-model-id`. Superseded on 2026-10-26 by [[2026-10-26-fail-closed-path-matching]], which runs the hooks on every path but an exact list.

A request whose resolved upstream pathname ends in `language-model` runs `beforeRequest`, `afterResponse` and `onError` whatever model headers it carries. Before this, the proxy skipped the hooks on `ai-model-id` without `ai-language-model-id`, so a client could skip them on a language model call by dropping one header.

Why: the official `@ai-sdk/gateway` client never sends that combination, but a hostile client sets its own headers, so the client's behavior settles nothing. Whether the gateway serves the call is unobservable without a paid call. Keying on the path needs neither answer, since the gateway serves by path. The path is folded first (percent-decoding, case, repeated and trailing slashes, `;` parameters), because `isSafePath` accepts those spellings and the gateway may serve them as the same route. Only those folds are enforced.

What would reopen it: a gateway model call that is not a language model call and posts to a path ending in `/language-model`.

See [[architecture/proxy]] step 6.
