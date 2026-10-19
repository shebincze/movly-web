# TV search parity (#189)

The ES5 TV screen now uses the existing authenticated BFF/search contracts for
name search, query-plus-structured filters, deterministic natural-query parsing,
autocomplete, popular query/title discovery and profile-owned saved filter CRUD.
It does not add a framework or change playback. Filter choices include dynamic
genres/facets, genre any/all, year/rating/runtime ranges, quality/HDR/availability,
multiple audio/subtitle/original languages/countries, and sorting. Loading a saved
filter preserves its unknown language/country choices. Saved filters store the
structured definition; they do not store the current query text.

Local history shares the modern web key `movly.searchHistory.v2.<environment>:<account>:<profile>`
and its 20 bounded text terms. The environment is the opaque BFF-provided upstream
identity, never a client-provided URL. Unknown environment disables persistence.
Remove/clear controls and text-only DOM construction avoid injecting catalogue or
history strings into HTML. Discovery/autocomplete require a verified adult profile
policy; kids and unknown policies suppress them. Facet choices require the explicit
`policy_scoped:true` capability returned through the BFF's fixed upstream opt-in.

Suggestions have a 250ms debounce, an eight-item cap, cancellation and generation/
query/owner checks. Down enters the suggestion list; Up returns to the input;
Enter selects and Escape closes it. Other controls use the existing spatial/D-pad
navigation. Search paging preserves filters and the title query; original result
positions are retained in click feedback. Errors have retry controls and degraded
searches display an incomplete-results notice. Returning to a focused search tab
rechecks session ownership before exposing old data.

## Evidence on 2026-10-19

Browser plugin not available; local Playwright Chromium at 1280x720 exercised the
actual TV DOM with XHR through the unmodified production BFF components, actual Go
router/API-key/session/profile authorization and isolated PostgreSQL fixture #1210.
No production requests, accounts, writes, deployment or release were involved.
ES5 syntax/API guards target Chrome34 compatibility; the runtime proof uses modern
Chromium and keyboard D-pad simulation.

- Full web suite: 594 passed; `npm run check`, ES5 guard and diff check passed.
- Actual suggestions with ArrowDown/Escape/Enter, scoped history remove/clear,
  natural-query interpretation, combined `q=Matrix`/year1990/1080p HTTP200 passed.
- A deliberately delayed real autocomplete response did not replace a newer query.
  Controlled HTTP503 followed by the Retry action recovered actual search results.
- Another actual session profile selection followed by focus revalidation reset
  the old TV screen. Kids showed no adult history, global query/title discovery or
  autocomplete requests. Page errors were empty in completed flows.
- Actual TV POST and PUT plus fresh SQL and independent Go reads preserved multiple
  languages/subtitles/countries, the unknown saved code `zz`, year1990 and ownership.
  Attempts to PUT or DELETE that row from another profile returned404; fresh SQL
  confirmed it was unchanged.
- Remaining before final acceptance: actual TV DELETE and final dynamic-facet UI
  selection after the shared QA login rate window expires. One initial facet test
  incorrectly assumed the controlled dataset contained an English audio option;
  the corrected test selects an actually returned facet. HTTP facet response itself
  was200 with `policy_scoped:true`. Do not claim the remaining UI/delete checks yet.

The initial actual saved-filter run found BFF #192: the generic list-body projection
silently discarded `filter`. Central BFF fixes are included only as dependencies;
the final TV PR must rebase after the primary BFF PR merges. Before that fix, SQL
showed only defaults; after it, actual POST/PUT and fresh SQL matched all fields.

Sanitized receipts, scripts and screenshots remain outside Git at
`/Users/shebin/Movly-verification-20261019/web-tv189/`; independent SQL receipts are
owned by the fixture agent in the sibling `search1210/` evidence directory. Own TV
loopback server/worktree remain active until the final acceptance and merge, then
must be removed. Shared Go/PG fixture cleanup belongs to its owner.
