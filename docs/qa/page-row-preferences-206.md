# Per-page rows — web #206 / Movly #1265

Primary Settings offers one Home/Movies/Series selector. Visibility switches enter
an in-memory draft immediately; Edit exposes handle-only Pointer Events dragging
and ArrowUp/Down keyboard alternatives. Done sends one complete CAS document when
dirty, and exits only on an admitted advancing receipt. A clean Done only exits.
Cancellation restores the prior order. Regular list scrolling remains available.
Reset captures the page/generation around confirmation; stale controls are detached
and fenced before mutation. No authoritative preferences are stored locally.

TV has three editor entries and new Movies/Series screens using existing typed
/main. Explicit Up/Down/Show/Hide/Save remain appropriate to D-pad input. More/paging
uses existing /main/lists/{slug} with the captured movie/tv type. Home legacy remains.
Full typed reload replaces primary personal-list splicing. Server ordering and
visibility are authoritative; all-hidden pages retain reachable Settings.

/pages/{home|movies|series}/preferences is a strict owner/PIN-fenced BFF projection.
The page is path-only; legacy /home/preferences shape remains unchanged. Documents
require exact page/profile, signed default order, dense display order and advancing
PUT revision. Failed saves preserve the draft. A CAS conflict remains blocked until
explicit Reload; background/focus reconciliation cannot silently rebase it.

All feeds/editors use bounded 30s metadata polling while visible, plus foreground,
local preference and existing scoped mirror invalidations. Reads are sequential,
cancel on hidden/unmount and compare page/profile/document/catalogue/policy. Shared
modern policy probes use context lifetime while their consumers enforce captured
owner/page/generation admission. Content and metadata requests remain cancellable.
New TV content uses before/after effective-policy checks. No new SSE/content route.

Author evidence (outside Git):
`/Users/shebin/Movly-verification-20261019/web-page-preferences/`.
Controlled production-DOM tests passed at390x844: visibility tap, keyboard reorder,
mouse pointer and emulated touch handle drag, zero movement writes, one Done write,
controlled503 retry/draft preservation, page-switch detached handle rejection and
TV Movies remote Enter/Save. Preference responses here are browser-controlled;
this is not durable API/SQL proof. Screenshots reviewed for compactness, long labels
and usable handles. The preview's unsupported personal-data mirror warning is a
fixture limitation; no production page errors were observed in completed flows.

Actual coordinated Go/SQL persistence, peer sync and final owner/PIN/CAS cohorts
are pending the backend runtime. No deployment, release or version increment.

The personal-change → full Movie reload → immediate Series route transition exposed
an old page aborting a shared policy postvalidation probe. Controlled preview showed
`Context changed` on Series before correction. Home/typed catalogue/collection policy
probes now use context lifetime; their content requests and render admission still
check the captured abort signal/context/generation. The same transition renders the
Series feed after correction. No shared policy module or content route was changed.

Exact final local suite627/627 and npm check/six ES5 scripts passed. Additional
controlled DOM regressions: touchCancel restores draft before a successful touch
reorder; same-page Series→Home→Series rejects held old Done/Reset with zero writes;
409 remains blocked with draft visible across foreground GET until explicit Reload.
Actual 30s timer detected a changed Series document and reloaded full typed /main;
blur cancelled metadata reads for a complete interval, focus reconciled again.
Personal mutations requested full typed /main and no /main/personal; typed collection
links retained movie/tv. Receipts: lifecycle-conflict.json, emulated-touch.json,
feed-poll.json. These remain controlled preview evidence, not actual Go persistence.

Typed cache review correction: every cached page entry performs a required full
reload before exposing rails, covering preferences changed while another page was
visible. A required refresh always paints its admitted response even when list JSON
is unchanged, so its loading state cannot persist indefinitely. Three executable
feed regressions cover unchanged refresh, newer response winning and aborted route
admission. Final630/630 tests and check/ES5 passed. The completed browser polling
receipt additionally confirms cached Movies/Series entries request a new full feed
and unchanged personal refresh returns usable rails.

Independent review corrections: only the new page DTO/write paths enforce literal
ASCII string slugs and exact64hex hashes, rejecting coercion and terminal newlines.
Legacy Home admission remains unchanged. The first admitted metadata read now forces
one reconciliation after installing its baseline. Restarting the same watcher keeps
that baseline, avoiding a reload loop. Controlled barriers held an old content feed
until the first metadata was already newer: exactly one second full feed rendered
the current state. An initial editor document0 followed by held metadata1 released
after a user toggle preserved the dirty draft, blocked Done and required Reload,
without a PUT. Receipt: initial-handshake.json. Final633/633, check/ES5 and renewed
touch/lifecycle browser regressions passed after these corrections.
