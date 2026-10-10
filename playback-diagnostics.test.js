const { test } = require("node:test");
const assert = require("node:assert/strict");
test("playback diagnostics never copy secret error messages, unknown codes or providers", async () => {
  const { playbackDiagnostics } = await import("./app/playback-diagnostics.js");
  const secret = "https://private.invalid/?token=secret Bearer password";
  const diagnostic = playbackDiagnostics("video_analysis", secret, { message: secret, status: 503, stack: secret }, secret);
  assert.equal(diagnostic.stage, "video_analysis");
  assert.equal(diagnostic.provider, "other");
  assert.equal(diagnostic.error_code, "video_analysis_failed");
  assert.equal(diagnostic.http_status, 503);
  assert.ok(!JSON.stringify(diagnostic).includes("secret"));
});
test("browser media and HLS failure codes preserve bounded technical facts", async () => {
  const { playbackDiagnostics } = await import("./app/playback-diagnostics.js");
  assert.equal(playbackDiagnostics("playback", "webshare", { mediaCode: 3 }).error_code, "browser_media_3");
  assert.equal(playbackDiagnostics("playback", "webshare", {}, "hls_network_failed").error_code, "hls_network_failed");
  assert.equal(playbackDiagnostics("playback", "webshare", { status: 999 }).http_status, undefined);
});
