"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const policy = require("./app/tv/diagnostics.js");
const { createAppHandler } = require("./app-server");
const marker = "SYNTH64_PRIVATE_MARKER";
function node(tag, parentNode = null, attrs = {}) {
  return { tagName: tag, parentNode, getAttribute: key => attrs[key] ?? null };
}
test("TV key diagnostics exclude typing, form/editable ancestors and editable active elements", () => {
  const button = node("BUTTON");
  for (const target of [node("INPUT"), node("TEXTAREA"), node("SELECT"), node("FORM"), node("SPAN", node("FORM")), node("SPAN", node("DIV", null, { contenteditable: "" })), node("SPAN", node("DIV", null, { contenteditable: "true" }))]) {
    assert.equal(policy.keyEvent("keydown", { target, keyCode: 13, key: marker }, button), null);
    assert.equal(policy.keyEvent("keyup", { target: button, keyCode: 461 }, target), null);
  }
  for (const k of [48, 49, 57, 65, 83, 97, 229]) assert.equal(policy.keyEvent("keydown", { target: button, keyCode: k, key: marker }, button), null);
  assert.deepEqual(policy.keyEvent("keydown", { target: button, keyCode: 461, key: marker, keyIdentifier: marker, which: 65 }, button), { t: "keydown", s: 0, d: { k: 461 } });
});
test("TV diagnostic schema discards free-form representations and preserves bounded media controls", () => {
  const hostile = { m: marker, src: marker, p: marker, reason: marker, details: marker, key: marker, keyIdentifier: marker, ua: marker, token: marker, nested: { secret: marker } };
  for (const t of ["boot", "error", "api", "fail", "session", "engine", "hls-error", "beat", "playing", "video", "video-error"]) {
    const safe = policy.sanitize(t, { ...hostile, stage: marker, type: marker, engine: marker, e: marker, ev: marker, st: marker, l: marker, media: hostile }, marker);
    assert.doesNotMatch(JSON.stringify(safe), /SYNTH64_PRIVATE_MARKER/);
    assert.equal(safe.s, 0);
  }
  assert.equal(policy.sanitize(marker, hostile, 1), null);
  assert.equal(policy.sanitize("keydown", { k: 65, key: marker }, 1), null);
  assert.deepEqual(policy.sanitize("playing", { engine: "hls.js", w: 1920, h: 1080, url: marker }, 1.25), { t: "playing", s: 1.3, d: { w: 1920, h: 1080, engine: "hls.js" } });
  assert.deepEqual(policy.sanitize("beat", { ct: 12.4, buf: 20, dur: Infinity, rs: 4, ns: 3, p: false }, Infinity), { t: "beat", s: 0, d: { ct: 12.4, buf: 20, rs: 4, ns: 3, p: false } });
});
test("local TV BFF log sink rejects hostile old-client text including ID/timestamp/nested data", async () => {
  const logs = [], upstream = [];
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const handler = createAppHandler({ api: async (...args) => { upstream.push(args); }, json() {}, readBody: async req => req.body, HttpError, secret: "synthetic-secret", production: false });
  const original = console.log;
  console.log = line => logs.push(line);
  try {
    const res = { setHeader() {}, end() {} };
    await handler({ method: "POST", headers: { host: "localhost", origin: "http://localhost", "x-movly-app": "1" }, body: { id: marker, events: [
      { t: "error", s: marker, d: { m: marker, src: `https://fixture.invalid/?token=${marker}`, l: 7, c: 9, stage: "runtime" } },
      { t: "api", s: 1, d: { p: marker, c: marker, m: marker, stage: "search", st: 503 } },
      { t: "hls-error", s: { secret: marker }, d: { type: "networkError", details: marker, reason: marker, fatal: true, code: 503 } },
      { t: "boot", s: 2, d: { ua: marker, media: { hls: "maybe", mse: "std", token: marker } } },
      { t: "keydown", s: 3, d: { k: 65, key: marker } },
      { t: "keydown", s: 4, d: { k: 461, key: marker, keyIdentifier: marker } },
      { t: marker, s: 5, d: marker },
      { t: "playing", s: 6, d: { engine: "native", w: 1280, h: 720, src: marker } }
    ] } }, res, new URL("http://localhost/api/app/tv-diagnostics"));
    assert.equal(res.statusCode, 204);
  } finally { console.log = original; }
  assert.deepEqual(upstream, []);
  assert.doesNotMatch(logs.join("\n"), /SYNTH64_PRIVATE_MARKER|https:|keyIdentifier|reason|details|ua/);
  assert.equal(logs.length, 6);
  assert.ok(logs.some(line => line.includes('"k":461')));
  assert.ok(logs.some(line => line.includes('"w":1280') && line.includes('"engine":"native"')));
  assert.ok(logs.some(line => line.includes('"st":503')));
});
