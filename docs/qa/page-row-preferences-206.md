# Per-page rows — web #206 / Movly #1265

Settings offers Home, Movies and Series using the frozen page-preferences API.
Primary web has compact visibility switches, a sticky top Edit/Done toolbar,
handle-only pointer dragging and ArrowUp/Down keyboard reorder. A first switch
change enters an in-memory draft. Done sends one complete CAS write when dirty;
clean Done exits without a write. Touch cancellation restores the previous order.
TV has three editor entries, D-pad Up/Down/Show/Hide/Save and new Movies/Series
screens. Existing typed /main and /main/lists/{slug} routes supply content and
pagination. Full typed reload replaces personal-list splicing. Server order and
visibility are authoritative; even an all-hidden page keeps Settings reachable.

The BFF validates closed page paths, exact four-field bodies, literal ASCII slugs,
64-character catalogue hashes, dense display positions, signed default positions,
profile identity and advancing PUT receipts. New page writes reject duplicate raw
JSON keys before normalization. Legacy Home wire parsing and response shape remain
unchanged. No authoritative preference is stored locally. Owner/session/page/policy
and render-generation guards reject stale responses and held old DOM actions.
Conflicts preserve the visible draft and block save until explicit Reload.

Visible pages/editors reconcile metadata every 30 seconds without overlapping
reads, and on foreground/online/scoped changes. Hidden/unmounted consumers cancel
reads. An initial admitted baseline forces one reconciliation, covering content
captured before a newer first metadata response; it does not cause a reload loop.
Dirty drafts are preserved and blocked when their base changes. Shared policy
probes use context lifetime; content requests and their consumers keep their own
abort and context admission. No new content or SSE route was introduced.

## Local checks and controlled browser coverage

Final 634/634 tests and npm check passed, including all six ES5 guard scripts.
Production DOM tests in modern Chromium at 390×844 cover switch taps, keyboard
reorder, pointer and emulated-touch handle drag, touch cancellation, zero writes
while moving, one Done write, and a sticky top clean Done with no PUT. TV browser
coverage at 1920×1080 includes remote Enter and Save. This is browser runtime and
ES5 compatibility checking, not a claim about physical legacy TV hardware.

Controlled fixtures cover a 503 preserving draft/retry, real HTTP duplicate-key
rejection before upstream forwarding, sticky 409 across foreground, held stale
Done/Reset/handle events across page ABA, the old-feed/first-metadata barrier,
30-second polling and blur cancellation, cached entry refresh, unchanged refresh
recovery, and full typed reload after personal changes. These controlled responses
are distinguished from the actual Go/SQL checks below. The preview reports an
unsupported personal-data mirror warning; completed flows had no page errors.

## Actual isolated Go/PostgreSQL acceptance

Evidence is outside Git at
`/Users/shebin/Movly-verification-20261019/web-page-preferences/`.
Normal independent primary and TV BFF sessions first read common profile 1. After
Android's real writer committed Movies revision 2 and Series revision 1, both web
editors reconciled the shared-first/primary-hidden document and typed feeds through
metadata polling. Our common-profile cohort sent no preference PUT.

All our preference mutations then used dedicated profile 126541. Actual primary
Movies keyboard reorder/hide and Series emulated-touch reorder/hide each persisted
revision 1. Independent TV reads matched. Both clients paginated the existing
shared rail with the captured movie/tv type: page 1 had 30 items and page 2 had 5.
A TV peer save won while a primary write was held at its browser transport; releasing
the stale write produced actual Go 409. Its draft remained visible and blocked
until explicit Reload. Hiding all 12 Series rows produced an empty typed feed in
both clients while Settings and all hidden editor rows remained reachable.

Resets restored Movies revision 4 and Series revision 3. A Home hide/reorder then
reset finished at Home revision 2. Actual legacy /home/preferences equalled the new
Home document minus page, including the same revision/hash. Independent fresh SQL
confirmed all three final order/hidden arrays empty and all rows visible, with sync
revision 10 matching the final transaction. Durable receipts from the coordinator:

- `/Users/shebin/Movly-verification-20261019/page-preferences/web-own-movies1-series1-sql.json`
- `/Users/shebin/Movly-verification-20261019/page-preferences/web-own-checkpoint2-movies3-series2-allhidden.json`
- `/Users/shebin/Movly-verification-20261019/page-preferences/web-own-final-defaults-home2-movies4-series3.json`

Actual profile switches and PIN selection were exercised in both clients. Controlled
held detached DOM events sent no preference mutation after owner change or ABA;
this is callback replay, not a physical click on a removed node. An actual BFF write
with the former owner header returned 409. Wrong PIN returned 403 and kept the old
profile; correct PIN admitted fresh reads. Kids and PIN documents stayed revision 0.
The final toolbar read-only replay used actual Go metadata, scrolled the 12-row
editor and verified top Done stayed reachable and clean Done sent zero PUT.
Receipts include actual-common-peer.json, actual-own-save.json, actual-paging.json,
actual-cas-allhidden.json, actual-reset-home.json, actual-owner-pin.json and
actual-toolbar-readonly.json, alongside reviewed PNGs and browser scripts.

The existing web login creates an unmanaged session; optional /sync/device returns
409 as expected. It is not evidence of managed-device mirror operation. Cross-peer
updates above were observed through the bounded metadata watcher. The coordinator's
`typed-feeds-and-web-auth-readonly-diagnosis.json` records that existing limitation.
No production writes, deployment, release or version increment occurred.
