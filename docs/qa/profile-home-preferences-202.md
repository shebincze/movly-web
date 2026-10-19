# Profile Home rows — web / TV (#202, root #1252)

Primary navigation no longer lists Genres; existing genre filters, catalogue grid
routes and fixed Home genre shortcuts remain. Current profile controls remain on
web/TV. Settings in both primary web and ES5 TV now expose all server-defined Home
rows, including hidden/empty rows and hero: move up/down, show/hide, Save and Reset.
Names come from the localized server document; buttons/errors support CS/SK/EN.

The sole authority is GET/PUT home/preferences. The shared ES5 state adapter validates
the selected profile, signed-safe default_order, nonnegative effective display_order,
64 lowercase hex catalogue revision and exact bounded slug identities. A draft lives
only in memory. Writes preserve document/catalog CAS tokens; Reset sends both arrays
empty. A conflict blocks writes until explicit Reload/reapply; network errors retain
the draft. Save is acknowledged only from a valid server receipt. No preference
localStorage, fallback defaults on service failure or client-invented row IDs.

Both editors capture account/profile/API context and lifecycle before reads/actions
and again after async work. Primary dialog removal aborts pending operations. TV
callbacks require the captured scope/current attached screen and generation. Policy
is verified before saving; backend owner/PIN checks remain mandatory. BFF supports
only GET/PUT, strict body/query projection, private/no-store and response profile
validation; unknown profile/body fields and malformed CAS/slugs are rejected locally.

Primary Home already renders server display_order, with no pinned hero. Existing
loader cycles reject late rows; local saves immediately invalidate the manifest.
Owner-scoped mirror changes and foreground/visibility/online refresh it. TV refreshes
on return/resume with owner revalidation and cancels old generations, rather than
keeping its former cached Home. Client-only genre shortcuts are navigation outside
the preference catalogue. No build/version, entitlement or player change.

## Verification — 2026-10-19

Full web suite619/619, zero skipped/failed; npm check and Chrome34 ES5 guard (six
scripts) passed. Eight shared-state/BFF cases include signed default ordering,
hero/empty/hidden/all-hidden, strict identities, body/reset/CAS, cross-owner/PIN
errors and private receipts. Chrome34 compatibility is a syntax/API guard; actual
runtime uses modern headless Chromium with keyboard D-pad simulation. Browser plugin
is not available, so the existing Playwright installation was used.

Actual production TV/primary/BFF → isolated Go/PostgreSQL fixture #1252:

- Primary loaded all nine eligible rows; moved csfd-tips first and hid hero selection.
  Server receipt revision6→7; Home layout omitted selection and used dense ordering.
  Independent SQL verified order/hidden and same-transaction sync revision9.
- TV read the same order/hidden state, D-pad Enter showed hero and moved it first;
  Save returned revision8. Primary's stale revision7 Save returned409 and did not
  change server state; explicit Reload admitted the new document.
- A deliberately controlled client-proxy HTTP503 preserved the draft. Explicit retry
  reached actual Go and returned revision9. Primary Reset returned revision10.
- All nine rows could be hidden (revisions11/13); both clients kept Settings/editor
  reachable on empty Home and the editor still listed every row. Actual TV Reset
  returned revisions12/14. Independent final SQL confirmed revision14 order[]/hidden[]
  and matching sync revision17. Repeated attempts here corrected harness readiness,
  not application preference semantics.
- Controlled held Reset DOM events after the actual switch to kids12522 sent zero
  preference PUTs in either client; kids document remained revision0. Wrong PIN403
  preserved kids selection; actual correct-PIN UI selection admitted profile12523
  and its own revision0 document. These are explicitly controlled held-event replays,
  not physical clicks on removed elements.
- Final completed flows reported no page errors. A persisted harness cookie snapshot
  initially predated async sync/device cookie revision; existing session anti-stale
  protection correctly refused profile selection409. A fresh own QA session was
  initialized through sync/device before replay; no guard/limiter/server was reset.

Evidence is outside Git at `/Users/shebin/Movly-verification-20261019/web-home-preferences/`.
Independent SQL receipts: sibling `profile-home-preferences/web-revision7-sql.json`
and `web-revision14-sql.json`. Other client write cohorts were held during this
bounded web cohort; defaults were restored before releasing the slot. No production
user writes, deployment, release or build increment. Own BFF/worktree/cookie cleanup
is required after final main merge; shared Go/PG cleanup belongs to its coordinator.

## Final review corrections

The final shared document validator requires dense unique display_order0..N-1;
PUT receipts in the BFF and both clients must advance beyond the submitted revision
before reporting Saved. Malformed/same-version receipt regressions cover both.
Foreground now fetches current policy/preferences for both editors: clean drafts
accept the current document; dirty drafts with unchanged base are preserved and
remain usable, while a changed base/policy preserves the draft and requires explicit
Reload/reapply. The shared reconciliation helper has focused cases for every path.

Actual isolated PINprofile12523 proof after these fixes: primary focus fetched an
unchanged base and preserved its dirty draft; actual Save advanced0→1. TV focus
fetched that new document while preserving its own dirty draft and blocked Save
until explicit Reload. TV Reset advanced1→2 and restored defaults. Both PUTs carried
expected-profile12523; profile1PUTcount0. Independent SQL verified PINrevision2
order[]/hidden[]/sync3 while concurrent adult profile1 remained exactly its separate
Macrevision15/hiddenpopular/sync18. See `focus-pin-review.json` and sibling
`profile-home-preferences/web-pin-revision2-sql.json`.

Read-only EN/SK primary and TV labels, controlled initial GET503→Reload recovery,
390px mobile primary layout and absence of preference localStorage passed. Final
state/BFF focused suite11 passed; full web suite622/622 and npm check/ES5 passed.
