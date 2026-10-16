"use strict";
// #135: relace dřívějšího profilu nebo zrušeného startu musí jít uklidit bez oslabení vlastníka.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createPlayback } = require("./playback-server");
const { createAppHandler } = require("./app-server");
const { createFixture } = require("./test-support/app-fixture.cjs");

async function mkv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "movly-owner-cleanup-")), file = path.join(dir, "input.mkv");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-threads", "1", "-c:a", "aac", file], { timeout: 15000 });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const source = async (_url, range) => {
    const size = (await fs.stat(file)).size, start = range ? Number(range.match(/\d+/)[0]) : 0;
    const stream = createReadStream(file, { start });
    stream.statusCode = range ? 206 : 200;
    stream.headers = { "content-type": "video/x-matroska", "content-length": String(size - start), "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${size - 1}/${size}` } : {}) };
    return stream;
  };
  return { dir, source };
}
const status = (engine, s, id) => engine.handle(s, { method: "GET" }, null, id, "status");

test("real engine: same browser replaces the previous profile, other browsers stay fenced", { timeout: 60000 }, async () => {
  const { dir, source } = await mkv(), engine = createPlayback({ requestMedia: source });
  const first = { token: "account", device: "device", profile: { id: 1 }, grant: null },
    second = { ...first, profile: { id: 2 }, grant: "grant" },
    stranger = { token: "other", device: "device-2", profile: { id: 1 }, grant: null };
  try {
    const old = await engine.start(first, "https://h1.webshare.cz/test", { clientKey: "a".repeat(32) });
    await assert.rejects(engine.start(stranger, "https://h1.webshare.cz/test"), { status: 429 });
    // Dřív: 429 „využívá jiný uživatel“ až do 180s nečinnosti.
    const replacement = await engine.start(second, "https://h1.webshare.cz/test");
    await assert.rejects(status(engine, first, old.id), { status: 404 });
    await assert.rejects(status(engine, second, old.id), { status: 404 });
    assert.ok(await status(engine, second, replacement.id));
    // Cizí vlastník relaci neukončí ani klíčem, ani úklidem vlastníka.
    assert.equal(await engine.stopOwner(first), 0);
    assert.equal(await engine.stopPending(second, "a".repeat(32)), false);
    assert.ok(await status(engine, second, replacement.id));
    assert.equal(await engine.stopOwner(second), 1);
    await assert.rejects(status(engine, second, replacement.id), { status: 404 });
    const pending = await engine.start(second, "https://h1.webshare.cz/test", { clientKey: "b".repeat(32) });
    assert.equal(await engine.stopPending(first, "b".repeat(32)), false);
    assert.equal(await engine.stopPending(second, "c".repeat(32)), false);
    assert.equal(await engine.stopPending(second, "b".repeat(32)), true);
    await assert.rejects(status(engine, second, pending.id), { status: 404 });
    // Po uvolnění může začít jiný prohlížeč.
    const free = await engine.start(stranger, "https://h1.webshare.cz/test");
    assert.ok(await status(engine, stranger, free.id));
  } finally { await engine.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

async function bff() {
  const calls = [];
  const engine = {
    async start(s, _url, options) { calls.push(["start", s.profile.id, options.clientKey ?? null]); return { id: "a".repeat(48) }; },
    async handle() { return { stopped: true }; },
    async stopOwner(s) { calls.push(["stopOwner", s.profile.id, s.grant ?? null]); return 1; },
    async stopPending(s, key) { calls.push(["stopPending", s.profile.id, key]); return key === "d".repeat(32); },
  };
  class HttpError extends Error { constructor(status, message, payload) { super(message); this.status = status; this.payload = payload; } }
  const api = createFixture();
  const handler = createAppHandler({ secret: "synthetic-owner-cleanup-only", production: false, HttpError, playbackEngine: engine,
    readBody: async req => { let raw = ""; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {}; },
    json: (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); },
    api: async (p, ...args) => p.startsWith("v1/streaming/titles/1/streams")
      ? { payload: { streams: [{ id: 11, provider_name: "Hellspy", source_stream_id: "42/hash", available: true }] } } : api(p, ...args) });
  const server = http.createServer(async (req, res) => {
    try { await handler(req, res, new URL(req.url, "http://localhost")); }
    catch (e) { if (!res.headersSent) { res.writeHead(e.status || 500); res.end(JSON.stringify({ message: e.message })); } }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const request = async (target, method = "GET", body) => {
    const response = await fetch(`${origin}/api/app/${target}`, { method, headers: { origin, "X-Movly-App": "1",
      "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  return { calls, request, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

test("BFF stops the previous owner on profile change and logout, never on reselect", async () => {
  const h = await bff();
  try {
    assert.equal((await h.request("login", "POST", { username: "test", password: "movly-test" })).status, 200);
    assert.equal((await h.request("profile", "POST", { id: 1 })).status, 200);
    assert.deepEqual(h.calls, [], "no previous profile to clean up");
    assert.equal((await h.request("profile", "POST", { id: 1 })).status, 200);
    assert.deepEqual(h.calls, [], "reselecting the same owner keeps its playback");
    assert.equal((await h.request("profile", "POST", { id: 2, pin: "1234" })).status, 200);
    assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["stopOwner", 1]);
    assert.equal((await h.request("logout", "POST")).status, 200);
    assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["stopOwner", 2]);
  } finally { await h.close(); }
});

test("BFF forwards the client key and cleans a pending creation only for the current owner", async () => {
  const h = await bff();
  try {
    await h.request("login", "POST", { username: "test", password: "movly-test" });
    await h.request("profile", "POST", { id: 1 });
    const created = await h.request("playback", "POST", { title_id: 1, source: "human", stream_id: 11, client_key: "d".repeat(32) });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.deepEqual(h.calls.at(-1), ["start", 1, "d".repeat(32)]);
    assert.deepEqual(await h.request(`playback/pending/${"d".repeat(32)}`, "DELETE"), { status: 200, data: { stopped: true } });
    assert.deepEqual(h.calls.at(-1), ["stopPending", 1, "d".repeat(32)]);
    assert.deepEqual((await h.request(`playback/pending/${"e".repeat(32)}`, "DELETE")).data, { stopped: false });
    assert.equal((await h.request("playback/pending/not-a-key", "DELETE")).status, 404);
  } finally { await h.close(); }
});
