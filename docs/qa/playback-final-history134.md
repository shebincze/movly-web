# Final HLS history snapshot (#134)

Closing HLS before EOF called `hls.destroy()` before the final history closure.
The pinned engine synchronously clears the media clock when detaching, so the
closure's zero-clock guard silently skipped the history request. This predates
#131: root's actual CUA run using exact main8856451 player bytes observed
4.671184s immediately before destroy, then0 immediately after; no history POST.

The final save starts synchronously after pause, before HLS detach. Its rejection
handler is attached immediately; media teardown does not await the network.
After detach, stop awaits that save and retains existing error toast/session
DELETE behavior. The history closure checks captured account/profile/generation
before either the local card overlay or HTTP, preventing old-owner publication.

Local verification: actual production history/stop excerpts with a destroy that
clears the clock reproduce3 baseline failures; fixed4 tests cover before-EOF,
ended status, pending request/immediate detach, rejection cleanup, and changed
owner without overlay/history. A clean owner-guard negative control has3 passes
and1 expected failure; an earlier overlapping-output attempt is excluded.
Full Node suite323/323, zero failures/skips/cancellations; syntax and ES5 checks
pass. External receipts: next-five-batch4/web/history134-{unit-red,unit-green,
owner-red-clean,full-final,check-final}.log. Controlled owner-negative source
inputs are retained separately. No production/provider/durable-history claim.

The root-owned CUA fixture uses production static player modules, real locally
generated HLS, and synthetic authenticated API/controlled playback engine. This
fix does not address completed-response reconciliation (#135/Movly#650) or the
unknown original Movly#723 report. No deployment or release.
