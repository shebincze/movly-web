# Desktop Search parity — independent runtime QA, 19 October 2026

Tested product head `921c60389273092ed31b238535d9d9f190db9051` (primary #187/#188/#190/#192). Independent source review also identified overlapping exact/supplemental results in preceding `367b2c4`; author fixed this in `921c603` with disjoint displayed sets and original rank retention. No remaining blocking finding in this reviewed primary scope.

## Environment and boundaries

Actual production desktop app and BFF from this worktree on own loopback port18387, actual Go/PostgreSQL #1210 fixture on8001 at final backend `cfdb730` with selected-profile policy and facets opt-in. Fresh own BFF login/device session was created normally; no shared platform token was reused, no entitlement/PIN/content-policy gate disabled. Subsequent runs reused only the reviewer's private0600 browser state. No production requests or release.

Browser plugin not available; `frontend-testing-debugging` fallback used existing bundled Playwright/Chromium,1440×1000. Browser UI was not replaced or seeded with synthetic DOM. Fault tests intercept only the specified HTTP response; all normal responses and delayed-response payloads come from actual Go. No new browser dependencies installed. System Homebrew Node had a missing dylib; bundled Node24 was used without changing the installation.

## Verified interactions

1. Empty Search obtains real PostgreSQL popular-title IDs, hydrates their catalogue details and renders actual title cards. Hydration source is bounded to8 IDs and2 concurrent workers, retaining rank and current owner/policy admission.
2. Search text `1917` coexists with quality2160; real `/titles/filter` request contains title q plus minimum video height and the hash uses distinct `quality`.
3. Applying an existing actual saved filter preserves the current unsent text draft. Reset removes criteria while preserving the latest draft.
4. Clearing text returns to empty Search. Real local history uses opaque32hex environment + stable account ID + profile ID; legacy username keys are not adopted.
5. Exact-title group renders from actual name results. Rendered title IDs are unique across sections, and clicking the exact result submits the original server result position rather than the reordered display position.
6. A controlled503 on discovery shows the real retry control; retry recovers actual Go title cards.
7. An actual adult discovery response is held while the BFF switches to the actual kids profile and the page reloads. Releasing the old response cannot publish adult discovery; adult history remains hidden. Local adult history key remains partitioned.
8. Page identity/nonempty production content and normal interactions pass. No page JavaScript errors were captured. Expected controlled503 is not treated as a product error.

## Evidence and limitations

External evidence: `/Users/shebin/Movly-verification-20261019/web-primary187-review/` contains `qa.cjs`, `server.cjs`, `result.json` with8 passing assertions/HTTP request receipts, `popular.png`, `exact-click.png`, `kids-after-delayed.png`, initial DOM and logs. Screenshots are viewport evidence; popular sections can be below the long filter sidebar. The JSON/DOM assertions establish their actual rendered cards. No credentials/cookies are committed or included in receipts.

Author's full local checks:593/593 tests and syntax/ES5 check passed. This reviewer did not duplicate that suite. Separate #192 UI→BFF→Go→SQL persisted document/readback proof was supplied by the filter/TV owners; this browser cohort consumes a real existing saved document and does not claim independent SQL write verification. Strict malformed write/PIN cases remain covered by their dedicated contract/runtime cohorts.

Unverified by this cohort: Safari/Firefox, responsive mobile viewport, real TV hardware, exhaustive screen-reader coverage, or release behavior. #191 multifacet editor and #189 TV interface are separate scopes. This QA does not certify those implementations. The existing structured-filter branch uses catalogue behavior rather than name-search click analytics; this is not an additional change in the reviewed slice.

Own browser and own BFF server were stopped after QA. No reviewer build/cache/worktree was created; retained scripts, screenshots and redacted receipts are intentional evidence outside checkout. Parent owns the active source worktree and its final cleanup.
