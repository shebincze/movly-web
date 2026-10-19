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

Actual Chromium TV/BFF/Go/PostgreSQL draft-zero/explicit-one acceptance and final
integration checks are recorded in the external `web-tv198` evidence directory.
Browser plugin is not available; the existing Playwright installation is used.
No production requests, release or deployment.
