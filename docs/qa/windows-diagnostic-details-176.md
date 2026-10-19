# Windows diagnostic dashboard (#176)

The daily Windows aggregate view now optionally renders up to100 bounded diagnostic rows: occurrence/receipt UTC timestamps, event, closed error kind and four-part numeric version. It supports older responses without diagnostics and rejects raw kind/version labels or oversized detail arrays. No raw exception text, file paths, user/session/device identities or dumps are displayed. Diagnostic retries use backend event identity dedup; legacy counters retain their existing at-least-once behavior.

Verified2026-10-19 on backend a4fca68 (shebincze/Movly#1178/#1171), web3b6df65 integrated with free-service mainabdb29b at8a12039. Full `npm run check` and579/579 tests passed after integration. Final explanatory copy also passed check and focused client-telemetry tests.

Actual Safari27/macOS27 read the real Go API/PostgreSQL through the opt-in loopback client-quality fixture. Production Windows sender probe made3 HTTP204 requests for2 unique metadata identities. After Go process/pool restart, both fresh SQL and admin summary returned2 details/2 aggregate events. Dashboard displayed other/io classifications, numeric1.2.3.4 version and both UTC timestamps, with1 aggregate for each event. One report followed actual process kill; the managedI/O report was an explicit synthetic privacy/classification fixture and does not prove a native/WinUI crash handler.

Closed QA login/principal seam is explicit, and no production account/deployment was involved. Local detailed evidence lives outside the repository at `/Users/shebin/Movly-verification-20261019/telemetry757/`: diagnostics-dashboard.jpg, diagnostics-dashboard-ax.txt, diagnostics-delivered.json, diagnostics-restarted.json and validation logs. No release/deployment.
