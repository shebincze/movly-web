# Web production Home rollout and acceptance

Production: https://movly.sheri.cz/app/, PX LXC 214, movly-web service.
Issues: #10, #14, #17; profile-selection regression #21.

The release overlays only seven Home files on `resume-stream-20261010-dfe3231-v3`:
`app-server.js`, `app/catalog.js`, `app/api.js`, `app/styles.css`,
`app/offline-sw.js`, `app/home.js`, `app/home-state.js`.
The existing player, recommendations module, playback server, sources server,
provider resolver and server entry point remain from the live baseline.

`prepare-home-production.py` reproduces all seven deployed files from an
export of that baseline. It checks the patch before applying it and emits a
SHA256 manifest. Use a new destination directory. Exported production data,
credentials, session storage and binaries are excluded from Git.
Activation used `/run/lock/movly-web-release.lock`, a baseline-path check,
preactivation hashes and syntax checks, atomic symlink replacement, service
restart and HTTP smoke checks, with rollback on failure.
The active release is `home-101417-20261010-5ea99b6-v2`.

## Verification

- Main source: syntax checks and all 129 Node tests pass locally; Actions disabled.
- Runtime overlay: 6 Home/profile gateway tests pass; earlier 10 Home/resume
  tests passed on the production overlay before the child-profile fix.
- Reproducibility: every one of the seven generated files equals the deployed
  payload byte for byte. Server, player, source and playback digests unchanged.
- Signed-in Chromium on macOS: real Home API and images, personal rows, profile
  switches between two adults and child; child policy max certification 7.
- Fresh read from production PostgreSQL confirms web view actions stored for
  the selected profiles. No credentials or raw session identifiers in this note.
- Home configuration canary: a temporary themed row appeared first immediately,
  moved to last after a database order change, disappeared after disabling.
  The row was deleted in a finally block; existing configuration was preserved.
- Home collection link renders 19 continue-watching items. Marvel collection
  page 2 uses the same Home endpoint and returns 30 of 89 items, 3 pages.
- Manual film source picker: Database, Database AI, Recommended (3), other
  providers; no autoplay. Chromium 1440x1000 and 390x844: no horizontal overflow.
- Real Hellspy movie playback decoded 1280-wide video and advanced time.
  After a new browser session, the same saved source resumed from second 89,
  selected Czech audio 0 via its stable selector and subtitles off.

## Profile authorization fix

The canonical backend deliberately issues no management grant when selecting
children. The web previously rejected successful selection without that grant
with HTTP 502. Accept the selected identity, omit absent grant headers, clear
any earlier management grant and continue to let the backend validate access.
Malformed supplied grants remain rejected. A regression test starts with an
adult grant, selects a PIN-protected child without a returned management grant,
and confirms Home uses the child identity without the previous grant.

## Acceptance boundaries

The current browser is Chromium with an emulated mobile viewport; this is not
physical mobile Safari acceptance. The selected movie offered one audio track
and no subtitle tracks. Broader track switching, real episode completion/next
playback, invalid-source fallback, fresh login and other browsers still require
explicit evidence before closing the full acceptance issues.
The observed offline-grant 403 belongs to the account's offline entitlement;
it does not prevent Home or streaming playback.
