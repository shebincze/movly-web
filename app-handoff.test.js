"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("app link opens the title in the installed Movly app", async () => {
  const { appTitleLink } = await import("./app/app-handoff.js");
  assert.equal(appTitleLink({ id: 42, type: "movie" }), "movly://title/42?type=movie");
  assert.equal(appTitleLink({ id: 7, type: "tv" }), "movly://title/7?type=tv");
});

test("silently dropped audio is detected per browser engine", async () => {
  const { audioMissing } = await import("./app/app-handoff.js");
  assert.equal(audioMissing({ mozHasAudio: false }), true);
  assert.equal(audioMissing({ mozHasAudio: true, webkitAudioDecodedByteCount: 0 }), false);
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 0, webkitDecodedFrameCount: 120 }), true);
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 0, webkitVideoDecodedByteCount: 10000 }), true);
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 0, getVideoPlaybackQuality: () => ({totalVideoFrames: 120}) }), true);
  // Android native HLS publishes zeros for every decode counter even while playing AAC.
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 0, webkitVideoDecodedByteCount: 0, webkitDecodedFrameCount: 0, getVideoPlaybackQuality: () => ({totalVideoFrames: 0}) }), false);
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 0 }), false);
  assert.equal(audioMissing({ webkitAudioDecodedByteCount: 4096 }), false);
  assert.equal(audioMissing({ audioTracks: { length: 0 } }), true);
  // Bez signálu prohlížeče nic nehlásíme.
  assert.equal(audioMissing({}), false);
});

test("format and stream errors offer the app, a transient network error does not", async () => {
  const { unplayableInBrowser } = await import("./app/app-handoff.js");
  assert.equal(unplayableInBrowser({ mediaCode: 4 }), true);
  assert.equal(unplayableInBrowser({ mediaCode: 3 }), true);
  assert.equal(unplayableInBrowser({ mediaCode: 2 }), false);
  assert.equal(unplayableInBrowser({ hlsFatal: "networkError" }), true);
  assert.equal(unplayableInBrowser({}), false);
});

test("providers whose links bind to the server IP are marked app-only like the server", async () => {
  const { appOnlyProvider } = await import("./app/app-handoff.js");
  const { directSource } = require("./direct-media");
  for (const name of ["VOE", "Streamtape", "ČT", "Česká televize"]) {
    assert.equal(appOnlyProvider(name), true, name);
    assert.throws(() => directSource("https://cdn.example.net/a.mp4", {}, name), { code: "app_required" }, name);
  }
  for (const name of ["Přehraj.to", "Hellspy", "SKTorrent", "Webshare"]) assert.equal(appOnlyProvider(name), false, name);
});
