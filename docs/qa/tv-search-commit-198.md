# TV committed-search admission (#198)

Typing changes only the optional 250ms autocomplete request. It invalidates the
committed query, aborts outstanding primary requests, removes old result controls
and leaves history untouched. Primary and natural-query searches begin after an
explicit Search/Enter, suggestion/history term or filter confirmation. Clear
returns to history/discovery idle. Returning focus cannot commit a draft; previously
loaded results may be restored locally only under the same effective policy.

Primary retry/paging use the admitted committed query. Detached callbacks, owner
changes and result generations keep their existing guards. Exact-title grouping,
deduplication and original click ranks are unchanged. A network retry of a primary
HTTP request is not an exactly-once analytics guarantee: the existing BFF purpose
and server logging semantics are unchanged by this TV-only repair.

Tests execute the actual production screen with a minimal DOM/deterministic timers:
multiple draft pauses and focus issue no primary/NLP/history; Enter commits the
full term once; focus restores matching cached results without another search;
a changed draft removes old cards; suggestion confirmation and current retry use
the committed query, while detached retry/foreign owner cannot submit.

Full web suite: 606 passed, zero failed/skipped. `npm run check` and the
Chrome34 ES5 syntax/API guards passed. Actual Chromium at 1280x720 used a new
coordinated synthetic BFF session, production TV/BFF handlers and isolated Go/PG
fixture #1210. Typing D → Duna TV198 → Duna TV198 draft proof with 1100ms pauses
and a focus cycle caused zero primary/NLP requests and zero history terms. Fresh
independent SQL at 09:30:56UTC confirmed zero rows. One explicit Enter at
09:31:06UTC sent one full-term search (HTTP200), stored one MRU term, and fresh SQL
at 09:31:19UTC confirmed exactly one new owner1/profile1 row84. A subsequent
focus cycle sent no extra primary request; page errors were empty. The unique
query intentionally returned zero matches. SQL has no purpose column and runtime
logs do not expose that header; user-query tagging is verified in unchanged BFF
source, while actual durable query persistence is independently observed.

Sanitized browser JSON/screenshot/logs are outside Git at
`/Users/shebin/Movly-verification-20261019/web-tv198/`; independent SQL/HTTP receipts
are in sibling `search1210/tv198-{draft-baseline,postdraft,postsubmit}.json`.
Browser plugin is not available; the existing Playwright installation is used.
No production requests, release or deployment.
