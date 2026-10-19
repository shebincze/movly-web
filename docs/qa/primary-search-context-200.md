# Primary Search action context (#200)

Outer routing cancellation protects responses and rendering, but it did not revoke
already held DOM event handlers. In the controlled regression a saved-filter Save
control was retained from adult1, the actual profile UI switched to kids12102, and
then a scheduled click replay ran on the disconnected old node. This is explicitly
a controlled held-event replay, not a physical click on an already removed button
or a claim of bypassing backend authorization. On main c7df37a the actual BFF/Go
POST returned200 and fresh PostgreSQL read showed row15 in kids12102 with the old
movie/audio[zz]/countries[US] definition. The row was removed through that current
kids session; independent SQL confirmed absence.

Search and shared filter-builder action admission now capture API context, route
signal/hash and effective-policy generation, plus DOM attachment. They reject stale
navigation, history changes and saved mutations before prompts/requests; after
await they recheck before toast/refresh. API mutation/facet requests retain the
route signal. Search suggestion choices also carry their response generation;
primary cards and pagination use the same admission. Existing response guards and
backend owner/PIN/content-policy fences remain. Catalogue cache refreshes unrelated
to effective policy do not invalidate this policy generation.

Post-fix actual Chromium1280x900 + production BFF/Go/isolatedPG1210 replayed held
Save/Delete/Apply/filter form/search form/history/suggestion controls after the
actual profile switch. No prompt, primary search, mutation or hash change occurred.
Current adult Save still created row16 in profile1; fresh SQL confirmed its complete
definition and zero kids Primary rows. Current adult UI Delete returned200 and
removed the saved button. Explicit units exercise the production admission helper
for abort/context/hash/disconnect/policy and pagination boundaries.

Browser plugin unavailable; existing Playwright used. Controlled responses are not
needed for this Go saved-row proof. No production accounts/writes, deploy or release.
Sanitized browser receipts/scripts/screenshots are outside Git under
`/Users/shebin/Movly-verification-20261019/web-primary201/`; independent SQL receipts
are in sibling `search1210/primary201-*.txt`. Own BFF/cookie/worktree cleanup follows
merge; shared Go/PG belongs to its owner.

Final full suite: 609 passed, zero failed/skipped; npm check and ES5 guards passed.
Additional browser regression rejected an older suggestion generation after editing
its draft while the old node still existed. A controlled same-owner effective-policy
event invalidated existing Save/Submit admission without changing backend policy.
Fresh final SQL confirmed IDs15/16 absent and zero `Primary%` saved rows in kids12102.
