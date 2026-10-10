# Web production Home rollout and acceptance

Production: https://movly.sheri.cz/app/, PX LXC 214, movly-web service.
Issues: #10, #14, #17; profile-selection regression #21; track-switch race #24; creation grant #25.

The release overlays seven Home files and the scoped player fix on `resume-stream-20261010-dfe3231-v3`:
`app-server.js`, `app/catalog.js`, `app/api.js`, `app/styles.css`,
`app/offline-sw.js`, `app/home.js`, `app/home-state.js`, `app/player.js`.
The recommendations module, playback server, sources server,
provider resolver and server entry point remain from the live baseline.

`prepare-home-production.py` reproduces all eight deployed files from an
export of that baseline. It checks the patch before applying it and emits a
SHA256 manifest. Use a new destination directory. Exported production data,
credentials, session storage and binaries are excluded from Git.
Activation used `/run/lock/movly-web-release.lock`, a baseline-path check,
preactivation hashes and syntax checks, atomic symlink replacement, service
restart and HTTP smoke checks, with rollback on failure.
The active release is `home-101417-20261010-2ed7d2d-v4`.

## Verification

- Main source: syntax checks and all 130 Node tests pass locally; Actions disabled.
- Runtime overlay: 7 Home/profile gateway tests pass; earlier 10 Home/resume
  tests passed on the production overlay before the child-profile fix.
- Reproducibility: every one of the eight generated files equals the deployed
  payload byte for byte. Server, source and playback-server digests unchanged; player has the reviewed race fix.
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

## Extended live acceptance

- Installed mobile WebKit at 390x844 renders real Home images and plays the
  saved Hellspy movie through native HLS; real video time advances, width 1280.
  Chromium exposes NetworkInformation; WebKit does not. Neither is a physical
  phone test. A stylesheet CSP warning appeared during screenshot tooling;
  no application inline stylesheet was present. Offline-grant 403 is the
  account's offline entitlement and does not prevent Home or streaming.
- Production PostgreSQL confirms both view and click actions for the correct
  profile after clicking a visible recommendation.
- Browser-local controlled network failure: retain nine existing rows for the
  same profile with a retry alert; switching profile clears all previous rows
  while the request fails. Restoring fetch and retry restores nine fresh rows.
  The production API was not disrupted by this failure simulation.
- Deliberately invalidating the saved source ticket only in browser storage
  returns to the manual picker, with no video/autoplay. Original memory restored.
- Real American Horror Story S1E1 playback via Hellspy, seeking to the final
  six seconds and natural completion: fresh API read confirms 100% completed;
  S1E2 automatically starts and advances from its own stored position.
- Another real movie source contains CZ/EN audio and four subtitle tracks.
  Rapid EN audio + EN SDH subtitle changes exposed #24. The fixed player emits
  only the final request (audio 1, subtitle 3), advances actual decoded video,
  and stores stable English audio/subtitle selectors. A user-confirmed new login
  resumes the same source from second 296 with those two selectors.

## Remaining acceptance boundaries

A fully new profile could not be created on this account: all five profile
slots are occupied. The first creation attempt exposed #25, where the gateway
stripped adult management headers for POST profiles. After the fix and fresh
adult selection, the request correctly reaches the backend's five-profile
limit (400), instead of an authorization error. No existing profile was deleted
or quota bypassed. A new-profile fallback still needs an account with a free
slot. Existing child profile without watch history was verified separately.

Physical phone/desktop Safari and Firefox are not established by engine tests.
Any outstanding acceptance must remain in open tracking instead of being
inferred from this merge or a test count.
