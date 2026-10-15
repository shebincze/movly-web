# Accepted mirror context and visible catalogue (#126, Movly #647)

A same-owner `catalog_changed`/instance reset could complete the new personal mirror while Movies/Series still showed its old `/main` DOM and five-minute cache. The personal revision need not change when catalogue eligibility changes. The browser baseline reproduced this with actual catalogue/API/mirror modules and IndexedDB: fresh `/main` and `/main/personal` contained version 2 while visible and cached personal/curated rows remained version 1. No synthetic personal-changed event was used.

A fully validated typed410 reset fences the catalogue synchronously before replacement storage/snapshot work, even if either subsequently fails. Malformed410 and network-only failures do not invalidate catalogue state. Completed mirror publications carry their exact API generation/account/profile and whether an initial/context transition occurred; the completed snapshot does not duplicate an already published reset invalidation. Unchanged empty changes pages do not invalidate catalogue data. The catalogue accepts only current-owner publications, clears its cache/epoch and refreshes the still-visible Movies/Series page belonging to that generation. Policy changes use the same path. Required refresh removes old rows while loading and offers retry on failure; ordinary stale-while-revalidate keeps its existing behavior. Existing full/personal request epoch checks fence late replies. Local user-state overlays and durable pending history/base revisions/conflicts are untouched. No personal-changed event is synthesized, so offline.js does not re-enter mirror sync.

Actual Chromium controls cover:

- baseline RED and accepted catalogue-epoch reset GREEN with unchanged personal revision;
- empty unchanged delta with no catalogue request;
- held old personal and full catalogue responses released after newer context acceptance;
- same-owner instance-only reset and validated policy change;
- old-owner event rejection;
- failed required refresh hides old rows, then actual retry succeeds;
- valid reset followed by failed snapshot or failing actual IndexedDB update boundary still refreshes/fences the catalogue;
- malformed410 and network-only controls do not invalidate;
- pending IndexedDB history/base/conflict preservation and no mirror-sync feedback loop.

The browser fixture uses a loopback HTTP protocol server and synthetic owner; it does not establish production authentication, live backend database integration, deployment or release. Parent #647 remains open for other consumer/acceptance gaps. Private reproducible fixture and RED/GREEN JSON/screenshots/logs live outside the checkout at `/Users/shebin/.codex/visualizations/2026/10/15/web-mirror-catalog647/`.
