# Browser direct playback and actual segment data — 2026-10-19

Scope: web #155 and web portion of root #1113. No deployment, publication, production writes or provider-account changes. Physical-device requirements were waived by the owner in favor of simulator/VM checks. Synthetic local Movly catalogue/session and generated media are distinguished from actual provider reads below.

## Direct playback

Unmodified shared source picker/player ran against local synthetic session/catalogue and HTTP-generated H.264 fixtures. Android used its own API36 ARM64 emulator, Chrome133, port5586; Chromium151 and WebKit26.5 used Playwright. Browser plugin had no available browser surface, so Playwright was used. Native Safari27/macOS27 and Safari/iOS27 Simulator were operated through Device Hub/CUA.

| Browser | AAC MP4 / AAC HLS | H.264+AC3 MKV | H.264+AC3 MP4 | Actual Sosac MP4 |
|---|---|---|---|---|
| Chromium151 | decoded, no app offer | silent audio detected, app offered | silent audio detected, app offered | 1280px video, progressing frames/audio |
| WebKit26.5 | decoded, no app offer | unsupported format, app offered | supported by platform, decoded | 1280px video, progressing frames/audio |
| Android Chrome133/API36 | decoded, no app offer after #179 | silent audio detected, app offered | silent audio detected, app offered | 1280px video, progressing frames/audio |
| Native Safari27/macOS27 | MP4 decoded | unsupported format, app offered | not separately checked | actual video observed at7.76s, readyState4, width1280,195frames; fullscreen control verified |
| Safari/iOS27 simulator | generated MP4 rendered progressing testsrc | unsupported format, app offered | not separately checked | not claimed |

Android native HLS reports **all** decode counters as zero while video progresses. #179 fixes the false missing-audio warning by requiring a populated video decode counter before trusting zero audio bytes. Positive AC3 detection remains intact. A lack of reliable metrics remains unknown, not evidence of audio support.

The iPhone fullscreen control expanded the player across the browser content using the existing page-fullscreen fallback. Safari chrome remains visible; this is not a claim of native AVPlayer fullscreen. Screenshot: [iPhone fullscreen](evidence/web155-1113-20261019/ios-safari-fullscreen.png), [MKV handoff](evidence/web155-1113-20261019/ios-safari-mkv-offer.png).

Actual Sosac source came from the existing authorized account via the real resolver adapter, stored only in a0600 private input outside Git. The URL stayed in process memory and was never logged or placed in argv. The synthetic BFF issued that actual direct source; no whole movie was downloaded or saved.

Actual anonymous Hellspy: Mac resolved its API download endpoint and fetched1024 bytes; an authorized Contabo SSH process fetched1024 bytes from the **exact same signed CDN URL**. Both returned206 with MP4 content type. Independent egress fingerprints differed. URL transferred over SSH stdin only. [Sanitized result](evidence/web155-1113-20261019/hellspy-cross-ip-summary.json), [egress comparison](evidence/web155-1113-20261019/egress-fingerprints.json). This establishes cross-IP link validity; the second network was not called production deployment.

## TV ES5

Actual TV app ran at1280×720 in Chromium, with synthetic API/session and generated media fulfilled at an HTTPS fixture host. MP4 used file engine and HLS native engine; both rendered320px and progressed beyond1s with no page errors. A stalled unsupported source displayed the actionable failure message at25.373s measured from playback API response; the production watchdog is25000ms after attach. This is a nominal25s watchdog observation, not strict proof of an end-to-end ≤25.000s deadline. No physical Smart TV claim. [Failure screen](evidence/web155-1113-20261019/tv-unsupported.png).

## Actual provider segment data in the shared player

Anonymous live TheIntroDB v4 and IntroDB.app responses were saved unchanged in [real-intro-data](evidence/web155-1113-20261019/real-intro-data). Generated long-duration media provided controllable seek positions; no commercial episode/movie was downloaded for these segment tests. BFF fixture translated the real numeric segments into the production web segment contract without changing their boundaries.

| Case | Actual data and observed browser action |
|---|---|
| Breaking Bad1396 S1E1 | IntroDB.app credits3431000–3500000ms. At3435s the existing Next button highlighted and clicking it opened the next-episode source picker. |
| Mandalorian82856 S2E1 | IntroDB.app recap1000–144000ms. Manual skip moved to144s. TheIntroDB recap3906–120662ms differs, so this is not an auto-consensus claim. |
| Matrix603 | TheIntroDB credits start7726802ms, end=null. Exact saved response replayed at the TheIntroDB client boundary with CORS enabled; player used actual8160s duration and skipped to8159s. Live localhost request lacked Access-Control-Allow-Origin, so no live browser CORS success is claimed. |
| Infinity War tt4154756 | IntroDB.app outro8251000–8852000ms and post_credits8852000–8947000ms. Skip moved to8852s, preserving the scene after credits. This is a **movie**, not the episode post-credits acceptance requested by #1113. |
| Party role | Two independent shared-player browser pages used controlled legacy party HTTP/SSE protocol and the actual Breaking Bad credits above. Host saw Skip credits; member saw neither Skip credits nor Next. This is role UI evidence, not actual Go party-service/two-network acceptance. |

[Runtime results](evidence/web155-1113-20261019/intro-ui-results.json), [party role result](evidence/web155-1113-20261019/party-credits-results.json). The local account/catalogue data are explicit QA fixtures; no production profile/watch history was changed.

## Remaining acceptance

- Real Webshare account cross-IP/codec coverage: no configured usable token/password found; admin Providers screen showed Webshare disconnected. Native sandbox preferences denied access; no TCC changes or bypass attempted. Existing account metadata alone is not a usable session. No account creation, purchase or terms acceptance.
- Full actual Go Party + web clients on two networks subsequently passed; see the follow-up below.
- #1113 specifically asks for an **episode** with a real post-credits scene. Bounded provider reads found actual movie post-credits data; queried episode responses had post_credits=null. A final TheIntroDB Mandalorian S2E8 probe returned403 and was not retried. The episode requirement remains open.
- Strict TV error deadline across real browser engines cannot be inferred from Chromium's25.373s observation.

Validation of #179: `npm run check`, full579 tests passed after rebase onto Premium-restoring main d7fe16a. Actions disabled. Detailed local harness/scripts/logs retained outside the checkout at `/Users/shebin/.codex/logs/movly/web155-1113-20261019/`.


## Follow-up: actual Go Party across two networks and Hellspy gateway fix (#183)

The real Go API ran the opt-in `PARTY725_FIXTURE_INSTANCE=web155` fixture from root PR1193 with its own PostgreSQL54265, Go18266 and local BFF18265. Both named synthetic QA users had current Premium; authentication, PIN verification, profile grant, friendship, room membership, readiness, SSE and state transport used actual production handlers and store. No production database was touched. The public anonymous Hellspy source metadata was inserted only in that owned fixture database; it was deliberately attached to a synthetic QA title.

Network: host Chromium151 used the Mac directly. Member Chromium151 used existing authorized Hetzner SSH SOCKS egress, with a remote **loopback-only**18275 reverse forward to the Mac BFF. Independent browser requests produced distinct egress fingerprints. No public listener or server/firewall/SSH configuration was changed. Contabo explicitly denied forwarding and was not modified or bypassed.

First, generated HTTPS-fixture HLS proved actual Go/BFF/role/readiness/state behavior across those paths: both640px players progressed; host UI seek25s and pause yielded both25.018s paused, no page errors. Media fixture fulfillment is explicitly controlled and was not called a real provider.

Then actual anonymous Hellspy exposed #183: Mac browser followed the API gateway302→CDN206, but the member's gateway request failed `ERR_BLOCKED_BY_ORB` and the app offered handoff. The same signed CDN URL resolved on Mac returned206/1024bytes from Hetzner. The backend correctly kept the room paused with host ready/member not ready.

The fix resolves only the official gateway on the BFF using `Range: bytes=0-0`, `redirect: manual`, a15s timeout and response-body cancellation. It validates the returned HTTPS Location with no userinfo, sends that direct CDN URL to the browser and sanitizes upstream failures to502. It does not proxy media or follow arbitrary URLs server-side. Live, remembered and download selections retain profile/title binding.

After the fix, **both real direct CDN requests returned206** and both Chromium players decoded1920px, progressed and entered released readiness round1, with no page errors. Host UI seek25s was allowed to settle before pause; the room clock advanced during network/seek processing. After pause, host27.532s/member27.377s differed by155ms and both were paused. Fresh PostgreSQL readback confirmed room `e4a7e88a78258f4a011d3ea4c2a090ca`, status paused, position27.377, version13, updated_by host1, two distinct members, two ready devices, and released preparation round1. This is actual two-egress browser/provider/Go/BFF proof, not physical-device or production-deployment proof.

Evidence: [controlled two-network runtime](evidence/web155-1113-20261019/network-party-results.json), [actual Hellspy runtime](evidence/web155-1113-20261019/network-hellspy-party-results.json), [fenced PostgreSQL readback](evidence/web155-1113-20261019/party-postgres-readback.txt), [member after fix](evidence/web155-1113-20261019/network-hellspy-party-member.png), [gateway failure before fix](evidence/web155-1113-20261019/network-hellspy-party-failure-1.png). No signed URL, session token or real credentials are committed. Small playback/range reads only; no whole commercial title was saved.
