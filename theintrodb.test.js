"use strict";
// Kontrakt contracts/playback-segments (TheIntroDB v4 klientský lookup, movly-web#166). Fixtures jsou
// doslovná kopie cases.json z hlavního repa (test-support/playback-segments-fixture-source.md).
// Testy nikdy nevolají skutečné api.theintrodb.org: fetch je vždy podvržený.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fixturePath = path.join(__dirname, "test-support/playback-segments.fixtures.json");
const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const load = () => import("./app/theintrodb.js");
const ident = (c) => ({ ...(typeof c.identity === "string" ? data.identities[c.identity] : c.identity), ...(c.identityPatch || {}) });
// Python reference serializuje `body` do textu; chybějící tělo je JSON null.
const asResponse = (r) => ({ status: r.status, headers: r.headers || {}, bodyText: "bodyText" in r ? r.bodyText : JSON.stringify(r.body === undefined ? null : r.body) });

test("vendored fixture matches the recorded source SHA-256 and embedded constants", async () => {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(fixturePath)).digest("hex");
  assert.match(fs.readFileSync(path.join(__dirname, "test-support/playback-segments-fixture-source.md"), "utf8"), new RegExp(sha));
  const { THEINTRODB } = await load();
  assert.deepEqual({ ...THEINTRODB }, data.constants);
  assert.equal(data.version, 1);
});

test("contract request section: URL and cache key", async () => {
  const { theIntroDbRequest, theIntroDbCacheKey } = await load();
  assert.ok(data.request.length >= 14);
  for (const c of data.request) {
    assert.equal(theIntroDbRequest(ident(c)), c.url, c.name);
    assert.equal(theIntroDbCacheKey(ident(c)), c.cacheKey, c.name + "#cacheKey");
  }
});

test("contract parse section", async () => {
  const { parseTheIntroDb } = await load();
  assert.ok(data.parse.length >= 52);
  for (const c of data.parse) assert.deepEqual(parseTheIntroDb(ident(c), asResponse(c.response), c.nowMs ?? data.nowMs), c.expect, c.name);
});

test("contract merge section", async () => {
  const { mergePlaybackSegments } = await load();
  assert.ok(data.merge.length >= 16);
  for (const c of data.merge)
    assert.deepEqual(mergePlaybackSegments(c.durationMs ?? data.durationMs, c.theintrodb, c.server, c.nowS ?? data.nowS), c.expect, c.name);
});

test("oversized bodies are an error before JSON parsing, numeric-looking Retry-After is not a date", async () => {
  const { parseTheIntroDb } = await load();
  const episode = data.identities.episode;
  const big = JSON.stringify({ type: "tv", tvdb_id: 1, season: 1, episode: 1, pad: "x".repeat(data.constants.maxBodyBytes) });
  assert.deepEqual(parseTheIntroDb(episode, { status: 200, headers: {}, bodyText: big }, data.nowMs), { result: "error", reason: "too_large", cooldown: { scope: "global", ms: 30000 } });
  assert.equal(parseTheIntroDb(episode, { status: 200, headers: {}, bodyText: "", tooLarge: true }, data.nowMs).reason, "too_large");
  for (const value of ["1.5", "-5", " 12 x"])
    assert.equal(parseTheIntroDb(episode, { status: 429, headers: { "Retry-After": value }, bodyText: "{}" }, data.nowMs).cooldown.ms, 60000, value);
});

test("web identity: series tmdb_id + TMDB season/episode, movie without coordinates, tvdb never sent", async () => {
  const { theIntroDbIdentity, theIntroDbRequest } = await load();
  const ep = theIntroDbIdentity({ movie: false, episode: { season_number: 2, episode_number: 3, tvdb_id: 999 }, tmdbId: 1396, imdbId: "tt0903747", durationMs: 3500192 });
  assert.deepEqual(ep, { kind: "episode", tmdbId: 1396, imdbId: "tt0903747", tvdbId: null, season: 2, episode: 3, durationMs: 3500192 });
  assert.equal(theIntroDbRequest(ep), "https://api.theintrodb.org/v4/media?tmdb_id=1396&season=2&episode=3&duration_ms=3500000&details=true");
  const movie = theIntroDbIdentity({ movie: true, episode: null, tmdbId: null, imdbId: "tt0133093", durationMs: 8160000 });
  assert.equal(theIntroDbRequest(movie), "https://api.theintrodb.org/v4/media?imdb_id=tt0133093&duration_ms=8160000&details=true");
  assert.equal(theIntroDbRequest(theIntroDbIdentity({ movie: false, episode: { season_number: 0, episode_number: 1 }, tmdbId: 1396, durationMs: 3500192 })), null, "specials");
  assert.equal(theIntroDbRequest(theIntroDbIdentity({ movie: true, tmdbId: 0, imdbId: "", durationMs: 8160000 })), null);
});

// Podvržený fetch, který zaznamená volání. respond(url, init) vrací Response nebo vyhodí.
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return respond(url, init, calls.length); };
  fn.calls = calls;
  return fn;
}
const ok = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const episodeBody = { tvdb_id: 81189, type: "tv", season: 1, episode: 1, intro: [{ start_ms: 228664, end_ms: 246143, confidence: 0.9 }] };
const episodeIdentity = (patch = {}) => ({ ...data.identities.episode, ...patch });

test("fetch goes straight to api.theintrodb.org: anonymous GET, no credentials, no referrer, no own headers", async () => {
  const { createTheIntroDbClient } = await load();
  const fetch = fakeFetch(() => ok(episodeBody));
  const client = createTheIntroDbClient({ fetch });
  const result = await client.lookup(episodeIdentity());
  assert.equal(result.result, "segments");
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(new URL(url).origin, "https://api.theintrodb.org");
  assert.ok(!/\/api\/app\/|localhost|movly/i.test(url), "never through the BFF");
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.mode, "cors");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers, undefined, "no custom headers → no CORS preflight, no tokens");
  assert.equal(init.body, undefined);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(init).sort(), ["cache", "credentials", "method", "mode", "referrerPolicy", "signal"]);
});

test("BFF and servers never proxy TheIntroDB", () => {
  for (const file of ["server.js", "app-server.js", "sources-server.js", "providers-server.js", "app/api.js"])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), "utf8"), /api\.theintrodb\.org\/|theintrodb\.org\/v\d/, file);
  const intro = fs.readFileSync(path.join(__dirname, "app/intro-skip.js"), "utf8");
  assert.doesNotMatch(intro, /api\(["'`][^"'`]*theintrodb/i);
});

test("network/CORS failure: one attempt per page, then only server segments", async () => {
  const { createTheIntroDbClient, mergePlaybackSegments } = await load();
  let t = 1000;
  const fetch = fakeFetch(() => { throw new TypeError("Failed to fetch"); });
  const client = createTheIntroDbClient({ fetch, now: () => t });
  const first = await client.lookup(episodeIdentity());
  assert.deepEqual(first, { result: "error", reason: "network", cooldown: { scope: "global", ms: 30000 } });
  for (const patch of [{}, { episode: 2 }, { tmdbId: 1399 }]) {
    t += 86400000; // ani po dni ne: blokace platí do konce života stránky
    const again = await client.lookup(episodeIdentity(patch));
    assert.equal(again.result, "error");
    assert.equal(again.reason, "cooldown");
  }
  assert.equal(fetch.calls.length, 1, "exactly one request on the page");
  assert.equal(client.blocked, true);
  const server = { stale: false, expires_at: t / 1000 + 3600, segments: [{ id: "intro:1:2", kind: "intro", start_ms: 228000, end_ms: 247000, source: "introdb", auto_eligible: false }] };
  assert.deepEqual(mergePlaybackSegments(3500192, first, server, t / 1000), [{ id: "intro:228000:247000", kind: "intro", start_ms: 228000, end_ms: 247000, source: "introdb", auto_eligible: false }]);
});

test("timeout aborts after 5 s and is a network error", async () => {
  const { createTheIntroDbClient } = await load();
  const timers = [];
  const fetch = fakeFetch((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  const client = createTheIntroDbClient({ fetch, setTimer: (fn, ms) => { timers.push(ms); queueMicrotask(fn); return 1; }, clearTimer: () => {} });
  const result = await client.lookup(episodeIdentity());
  assert.deepEqual(timers, [5000]);
  assert.equal(result.reason, "network");
});

test("in-memory cache: 1 h TTL, 50 entries oldest out, none cached, errors not cached, single-flight", async () => {
  const { createTheIntroDbClient } = await load();
  let t = 0;
  let mode = "ok";
  const fetch = fakeFetch((url) => {
    if (mode === "404") return new Response("{}", { status: 404 });
    if (mode === "500") return new Response("{}", { status: 500 });
    const u = new URL(url);
    return ok({ ...episodeBody, episode: Number(u.searchParams.get("episode")) });
  });
  const client = createTheIntroDbClient({ fetch, now: () => t });
  const [a, b] = await Promise.all([client.lookup(episodeIdentity()), client.lookup(episodeIdentity())]);
  assert.equal(fetch.calls.length, 1, "single-flight");
  assert.equal(a, b);
  t = 3599999; await client.lookup(episodeIdentity()); assert.equal(fetch.calls.length, 1, "cached < 1 h");
  t = 3600000; await client.lookup(episodeIdentity()); assert.equal(fetch.calls.length, 2, "expired after 1 h");
  for (let e = 2; e <= 51; e++) await client.lookup(episodeIdentity({ episode: e }));
  assert.equal(client.size, 50);
  const before = fetch.calls.length;
  await client.lookup(episodeIdentity({ episode: 51 })); assert.equal(fetch.calls.length, before, "newest kept");
  await client.lookup(episodeIdentity({ episode: 1 })); assert.equal(fetch.calls.length, before + 1, "oldest evicted");
  mode = "404";
  assert.deepEqual(await client.lookup(episodeIdentity({ episode: 100 })), { result: "none", reason: "not_found" });
  const afterNone = fetch.calls.length;
  await client.lookup(episodeIdentity({ episode: 100 })); assert.equal(fetch.calls.length, afterNone, "none is cached");
  mode = "500";
  assert.equal((await client.lookup(episodeIdentity({ episode: 101 }))).reason, "status");
  t += 30000; mode = "ok";
  assert.equal((await client.lookup(episodeIdentity({ episode: 101 }))).result, "segments", "error was not cached, cooldown elapsed");
});

test("cooldown: 429 global blocks every lookup, media scope only that key", async () => {
  const { createTheIntroDbClient } = await load();
  let t = 0, mode = "global";
  const fetch = fakeFetch((url) => {
    if (mode === "global") return new Response("{}", { status: 429, headers: { "Retry-After": "120" } });
    if (mode === "media") return new Response(JSON.stringify({ code: "specific_media_usage_limit_exceeded" }), { status: 429 });
    const u = new URL(url);
    return ok({ ...episodeBody, episode: Number(u.searchParams.get("episode")) });
  });
  const client = createTheIntroDbClient({ fetch, now: () => t });
  assert.deepEqual((await client.lookup(episodeIdentity())).cooldown, { scope: "global", ms: 120000 });
  mode = "ok"; t = 119999;
  assert.deepEqual(await client.lookup(episodeIdentity({ episode: 5 })), { result: "error", reason: "cooldown", cooldown: { scope: "global", ms: 1 } });
  assert.equal(fetch.calls.length, 1);
  t = 120000; assert.equal((await client.lookup(episodeIdentity({ episode: 5 }))).result, "segments");
  mode = "media";
  assert.deepEqual((await client.lookup(episodeIdentity({ episode: 6 }))).cooldown, { scope: "media", ms: 60000 });
  mode = "ok"; t += 1000;
  assert.equal((await client.lookup(episodeIdentity({ episode: 6 }))).reason, "cooldown");
  assert.equal((await client.lookup(episodeIdentity({ episode: 7 }))).result, "segments", "other media not blocked");
  t += 59000; assert.equal((await client.lookup(episodeIdentity({ episode: 6 }))).result, "segments");
});

test("invalid identity never calls TheIntroDB", async () => {
  const { createTheIntroDbClient } = await load();
  const fetch = fakeFetch(() => ok(episodeBody));
  const client = createTheIntroDbClient({ fetch });
  assert.equal(await client.lookup(episodeIdentity({ season: 0 })), null);
  assert.equal(await client.lookup(episodeIdentity({ tmdbId: null })), null);
  assert.equal(await client.lookup(episodeIdentity({ durationMs: 4999 })), null);
  assert.equal(fetch.calls.length, 0);
});

test("body is read with a 256 KiB cap, declared or streamed", async () => {
  const { createTheIntroDbClient } = await load();
  const huge = "x".repeat(data.constants.maxBodyBytes + 1);
  let declared = true;
  const fetch = fakeFetch(() => declared
    ? new Response(huge, { status: 200, headers: { "content-length": String(huge.length) } })
    : new Response(new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode(huge.slice(0, 65536))); c.close(); } }), { status: 200 }));
  const client = createTheIntroDbClient({ fetch });
  assert.equal((await client.lookup(episodeIdentity())).reason, "too_large");
  declared = false;
  const other = createTheIntroDbClient({ fetch });
  assert.equal((await other.lookup(episodeIdentity())).reason, "too_large");
});

test("TheIntroDB results never touch browser storage", async () => {
  const { createTheIntroDbClient } = await load();
  const touched = [];
  const trap = (name) => new Proxy({}, { get: (_, prop) => { touched.push(`${name}.${String(prop)}`); return () => {}; } });
  const saved = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, indexedDB: globalThis.indexedDB, caches: globalThis.caches };
  Object.assign(globalThis, { localStorage: trap("localStorage"), sessionStorage: trap("sessionStorage"), indexedDB: trap("indexedDB"), caches: trap("caches") });
  try {
    const client = createTheIntroDbClient({ fetch: fakeFetch(() => ok(episodeBody)) });
    await client.lookup(episodeIdentity());
    await client.lookup(episodeIdentity({ episode: 2 }));
    await createTheIntroDbClient({ fetch: fakeFetch(() => { throw new TypeError("cors"); }) }).lookup(episodeIdentity());
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  }
  assert.deepEqual(touched, []);
});

test("CSP allows the browser to reach api.theintrodb.org and the service worker ignores it", () => {
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(server, /connect-src 'self' https:\/\/api\.theintrodb\.org;/);
  const sw = fs.readFileSync(path.join(__dirname, "app/offline-sw.js"), "utf8");
  assert.match(sw, /if \(url\.origin !== self\.location\.origin \|\| event\.request\.method !== "GET"\) return;/, "cross-origin fetches bypass the offline cache");
});

test("attribution next to the skip setting in cs/sk/en, skipping is not behind Premium", async () => {
  const intro = fs.readFileSync(path.join(__dirname, "app/intro-skip.js"), "utf8");
  assert.match(intro, /translateUI\("Časy úvodů, rekapitulací a titulků: "\)/);
  assert.match(intro, /href:"https:\/\/theintrodb\.org"/);
  assert.doesNotMatch(intro + fs.readFileSync(path.join(__dirname, "app/theintrodb.js"), "utf8"), /premium/i);
  const { translations } = await import("./app/translations.js");
  assert.deepEqual(translations["Časy úvodů, rekapitulací a titulků: "], ["Časy úvodov, rekapitulácií a titulkov: ", "Intro, recap and credits timestamps: "]);
});
