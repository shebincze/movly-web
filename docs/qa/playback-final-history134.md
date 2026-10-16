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

Root actual CUA GREEN at functional442f110: BEFORE EOF, currentTime1.263693s,
readyState4, endedfalse, moving160×90 video. Destroy observer recorded1.287→0;
exactly one BFF/upstream history POST had watching/progress1/duration8/profile1,
validtrue; DELETE1/active[]. Receipt parent batch4/web-history134-preend-green.json.
Actual owner handoff at1.266s to profile2 produced history[], as intended.
No rendered local-overlay assertion is claimed; its fence is source/unit proof.
That already-admitted owner handoff left the original session active (DELETE[]),
a separate preexisting completed/admitted-session owner cleanup gap tracked in
#135, not fixed by134. Earlier EOF/completed2-write cohort is excluded from the
before-EOF proof. Receipt parent batch4/web-history134-owner.json.
