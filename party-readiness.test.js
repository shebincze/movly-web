"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function snapshot(round = 0, episode = 101, version = round + 1) {
  return { party_id: "a".repeat(32), title_id: 42, episode_id: episode,
    version, server_time: new Date().toISOString(), preparation: { round, devices: [] } };
}
function harness() {
  let current = snapshot(), intercept, contextRevision = 0;
  const calls = [], timers = new Map(), streams = [];
  class Events {
    static OPEN = 1; readyState = 1; handlers = new Map();
    constructor(url) { this.url = url; streams.push(this); }
    addEventListener(event, callback) { this.handlers.set(event, callback); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    translateUI: value => value, waitingForParty: () => false, effectivePartyPosition: () => 0,
    apiContextKey: () => String(contextRevision), location: { origin: "https://fixture.invalid" }, DOMException,
    api: async (path, options = {}) => {
      calls.push({ path, ...options });
      if (intercept) { const result = intercept(path, options); if (result !== undefined) return result; }
      if (path === "party/v2/capabilities") return { preparation_rounds: true };
      return structuredClone(current);
    }, imageURL: () => null, el: () => ({}), button: () => ({}), showDialog() {}, toast() {},
    sessionStorage: { getItem: () => "00000000-0000-0000-0000-000000000001" },
    EventSource: Events, Date, setInterval: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
  });
  const source = fs.readFileSync("app/party.js", "utf8")
    .replace(/^import .*;\n/gm, "").replace(/\bexport /g, "");
  vm.runInContext(source + "\nglobalThis.subject = { activate, deliver: fresh => apply(fresh, generation), partyState, beginPartyPlayback, endPartyPlayback, reportPartyReady, leaveParty, partyTransport, enter: typeof enterParty === 'undefined' ? undefined : enterParty };", context);
  const subject = context.subject;
  return { ...subject, calls, streams,
    async start() { await subject.activate(current, false); calls.length = 0; },
    set(next) { current = next; },
    event(next) { current = next; subject.deliver(structuredClone(next)); },
    intercept(fn) { intercept = fn; },
    changeContext() { contextRevision++; },
    async tick() { await [...timers.values()][0]?.(); },
    readyCalls() { return calls.filter(call => call.body?.action === "ready"); },
  };
}

test("readiness carries initial round zero and same-episode restart resends a fresh decision", async () => {
  const h = harness(); await h.start();
  const player = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, player); await h.tick();
  assert.equal(h.readyCalls()[0].body.expected_round, 0);
  h.event(snapshot(1));
  await h.tick();
  assert.equal(h.readyCalls().length, 1, "A new round must not reuse the old boolean");
  h.reportPartyReady(true, player); await h.tick();
  assert.equal(h.readyCalls().length, 2);
  assert.equal(h.readyCalls()[1].body.expected_round, 1);
});

test("legacy capability absence keeps the original wire without expected_round", async () => {
  const h = harness(), missing = snapshot(); delete missing.preparation.round;
  h.intercept(path => { if (path === "party/v2/capabilities") throw Object.assign(new Error("absent"), { status: 404 }); });
  h.set(missing); await h.start();
  const player = h.beginPartyPlayback(42, 101);
  assert.equal(h.reportPartyReady(true, player), true); await h.tick();
  assert.equal(h.readyCalls()[0].body.expected_round, undefined);
  assert.equal(Object.hasOwn(h.readyCalls()[0].body, "expected_round"), false);
  assert.equal(h.readyCalls()[0].path, `party/${"a".repeat(32)}/preparation`);
});

test("v2 rejects preparation objects missing round while null before registration is legitimate", async () => {
  const invalid = harness(), missing = snapshot(); delete missing.preparation.round;
  invalid.set(missing);
  await assert.rejects(invalid.start(), /protokol|round|kolo/i);
  assert.equal(invalid.calls.some(call => call.method === "POST"), false);
  const valid = harness(), unregistered = snapshot(); unregistered.preparation = null;
  valid.set(unregistered);
  valid.intercept((_path, options) => options.body?.action === "register" ? snapshot() : undefined);
  await valid.start();
  const player = valid.beginPartyPlayback(42, 101); valid.reportPartyReady(true, player); await valid.tick();
  assert.equal(valid.readyCalls()[0].body.expected_round, 0);
});

test("explicit invalid server rounds never become readiness wire values", async () => {
  for (const round of [null, "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const h = harness(); h.set(snapshot(round));
    await assert.rejects(h.start(), /protokol|round|kolo/i);
    assert.equal(h.readyCalls().length, 0);
  }
});

test("another episode and an older player attempt cannot publish readiness", async () => {
  const h = harness(); await h.start();
  const old = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, old); await h.tick();
  h.event(snapshot(1, 102));
  assert.equal(h.reportPartyReady(true, old), false); await h.tick();
  assert.equal(h.readyCalls().length, 1);
  const fresh = h.beginPartyPlayback(42, 102);
  h.reportPartyReady(true, fresh);
  h.endPartyPlayback(old); h.reportPartyReady(false, old); await h.tick();
  assert.equal(h.readyCalls()[1].body.ready, true);
  assert.equal(h.readyCalls()[1].body.expected_round, 1);
  h.endPartyPlayback(fresh); await h.tick();
  assert.equal(h.readyCalls()[2].body.ready, false);
  assert.equal(h.reportPartyReady(true, fresh), false, "Stopped callbacks stay stopped");
});

for (const value of [true, false]) test(`stale ${value} reconciles a typed 409 without relabeling or replay`, async () => {
  const h = harness(); await h.start(); const player = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(value, player);
  h.intercept((path, options) => {
    if (options.body?.action === "ready") {
      h.set(snapshot(2, 102));
      throw Object.assign(new Error("stale round"), {status: 409, code: "party_preparation_round_mismatch"});
    }
  });
  await h.tick();
  assert.equal(h.partyState().preparation.round, 2);
  assert.equal(h.readyCalls()[0].body.expected_round, 0);
  assert.equal(h.calls.at(-1).path, `party/v2/${"a".repeat(32)}`);
  h.intercept(null); h.reportPartyReady(value, player); await h.tick();
  assert.equal(h.readyCalls().length, 1, "Old episode must not be retried with the current round");
  const fresh = h.beginPartyPlayback(42, 102); h.reportPartyReady(true, fresh); await h.tick();
  assert.equal(h.readyCalls()[1].body.expected_round, 2);
  assert.equal(h.readyCalls()[1].body.ready, true);
});

test("in-flight old-round success does not suppress a new-round decision", async () => {
  const h = harness(); await h.start(); const player = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, player); let finish;
  h.intercept((_path, options) => options.body?.action === "ready" ? new Promise(resolve => { finish = resolve; }) : undefined);
  const pending = h.tick();
  h.event(snapshot(1)); h.reportPartyReady(true, player);
  finish(snapshot()); await pending;
  h.intercept(null); await h.tick();
  assert.deepEqual(h.readyCalls().map(call => call.body.expected_round), [0, 1]);
});

test("same-episode typed 409 requires a new sample before readiness can be sent again", async () => {
  const h = harness(); await h.start(); const player = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, player);
  h.intercept((_path, options) => {
    if (options.body?.action === "ready") {
      h.set(snapshot(1));
      throw Object.assign(new Error("stale"), { status: 409, code: "party_preparation_round_mismatch" });
    }
  });
  await h.tick(); h.intercept(null); await h.tick();
  assert.equal(h.readyCalls().length, 1);
  h.reportPartyReady(false, player); await h.tick();
  assert.equal(h.readyCalls()[1].body.expected_round, 1);
  assert.equal(h.readyCalls()[1].body.ready, false);
});

test("a reconciliation completing after rejoin cannot clear a new-party sample", async () => {
  const h = harness(); await h.start(); const old = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, old); let finish, reading;
  const readStarted = new Promise(resolve => { reading = resolve; });
  h.intercept((path, options) => {
    if (options.body?.action === "ready") throw Object.assign(new Error("stale"), { status: 409, code: "party_preparation_round_mismatch" });
    if (path === `party/v2/${"a".repeat(32)}`) return new Promise(resolve => { finish = resolve; reading(); });
  });
  const pending = h.tick(); await readStarted;
  await h.start();
  const fresh = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, fresh);
  finish(snapshot(1)); await pending;
  h.intercept(null); await h.tick();
  assert.equal(h.readyCalls().length, 1);
  assert.equal(h.readyCalls()[0].body.ready, true);
});

test("old 409 reconciliation preserves a new player attempt sampled while GET is pending", async () => {
  const h = harness(); await h.start(); const old = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, old); let finish, reading;
  const readStarted = new Promise(resolve => { reading = resolve; });
  h.intercept((path, options) => {
    if (options.body?.action === "ready") throw Object.assign(new Error("stale"), { status: 409, code: "party_preparation_round_mismatch" });
    if (path === `party/v2/${"a".repeat(32)}`) return new Promise(resolve => { finish = resolve; reading(); });
  });
  const pending = h.tick(); await readStarted;
  h.event(snapshot(1));
  const fresh = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, fresh);
  finish(snapshot(1)); await pending;
  h.intercept(null); await h.tick();
  assert.deepEqual(h.readyCalls().map(call => [call.body.expected_round, call.body.ready]), [[0, true], [1, true]]);
});

test("a delayed 409 cannot clear a newer decision already sampled before the error arrives", async () => {
  const h = harness(); await h.start(); const old = h.beginPartyPlayback(42, 101);
  h.reportPartyReady(true, old); let reject;
  h.intercept((_path, options) => options.body?.action === "ready" ? new Promise((_resolve, fail) => { reject = fail; }) : undefined);
  const pending = h.tick();
  h.event(snapshot(1));
  const fresh = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, fresh);
  reject(Object.assign(new Error("stale"), { status: 409, code: "party_preparation_round_mismatch" }));
  await pending; h.intercept(null); await h.tick();
  assert.deepEqual(h.readyCalls().map(call => [call.body.expected_round, call.body.ready]), [[0, true], [1, true]]);
});

test("leaving and rejoining invalidates callbacks even for the same party and episode", async () => {
  const h = harness(); await h.start(); const old = h.beginPartyPlayback(42, 101);
  await h.start();
  assert.equal(h.reportPartyReady(true, old), false);
  const fresh = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, fresh); await h.tick();
  assert.equal(h.readyCalls().length, 1);
});

for (const action of ["", "join"]) test(`capability negotiation binds ${action || "create"}, subsequent HTTP and SSE to one prefix`, async () => {
  for (const modern of [false, true]) {
    const h = harness(), prefix = modern ? "party/v2" : "party";
    if (!modern) h.intercept(path => { if (path === "party/v2/capabilities") throw Object.assign(new Error("absent"), { status: 404 }); });
    await h.enter(action, action ? { code: "ABCDEF" } : { title_id: 42 });
    assert.equal(h.calls[0].path, "party/v2/capabilities");
    assert.equal(h.calls[0].method, undefined);
    assert.equal(h.calls[1].path, prefix + (action ? "/join" : ""));
    assert.equal(h.streams[0].url, `/api/app/${prefix}/${"a".repeat(32)}/events`);
    const player = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, player); await h.tick();
    await h.partyTransport(false, 2); await h.leaveParty();
    for (const call of h.calls.filter(call => call.path !== "party/v2/capabilities")) {
      assert.ok(call.path === prefix || call.path.startsWith(prefix + "/"));
      if (!modern) assert.equal(Object.hasOwn(call.body || {}, "expected_round"), false);
    }
  }
});

test("401, network and malformed capabilities never fall back or issue a mutation", async () => {
  for (const outcome of [Object.assign(new Error("unauthorized"), { status: 401 }), new TypeError("offline"),
    Object.assign(new Error("bad gateway"), { status: 502 }), { preparation_rounds: false }, {}, null, { preparation_rounds: "true" }]) {
    for (const action of ["", "join"]) {
      const h = harness();
      h.intercept(path => {
        if (path === "party/v2/capabilities") { if (outcome instanceof Error) throw outcome; return outcome; }
      });
      await assert.rejects(h.enter(action, { title_id: 42, code: "ABCDEF" }));
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].path, "party/v2/capabilities");
      assert.equal(h.calls[0].method, undefined);
      assert.equal(h.streams.length, 0);
    }
  }
});

test("a failed mutation is never retried through the other protocol", async () => {
  for (const action of ["", "join"]) for (const status of [401, 404, 409, 502]) {
    const h = harness();
    h.intercept((_path, options) => { if (options.method === "POST") throw Object.assign(new Error("mutation failed"), { status }); });
    await assert.rejects(h.enter(action, { title_id: 42, code: "ABCDEF" }));
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].path, "party/v2" + (action ? "/join" : ""));
    assert.equal(h.streams.length, 0);
  }
});

test("capability decisions cannot cross a context A to B to A transition", async () => {
  const h = harness(); let finish;
  h.intercept(path => path === "party/v2/capabilities" ? new Promise(resolve => { finish = resolve; }) : undefined);
  const pending = h.enter("join", { code: "ABCDEF" });
  h.changeContext(); h.changeContext(); finish({ preparation_rounds: true });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.streams.length, 0);
});

test("an active party is locally invalidated on context change without leaving in the new context", async () => {
  const h = harness(); await h.enter("", { title_id: 42 });
  const oldPlayer = h.beginPartyPlayback(42, 101); h.reportPartyReady(true, oldPlayer);
  const before = h.calls.length;
  h.changeContext(); h.changeContext();
  h.streams[0].handlers.get("party")({ data: JSON.stringify(snapshot(1)) });
  assert.equal(h.partyState(), null);
  assert.equal(h.streams[0].closed, true);
  await h.tick(); await h.leaveParty();
  assert.equal(h.calls.length, before);
  assert.equal(h.reportPartyReady(true, oldPlayer), false);
  h.intercept(path => { if (path === "party/v2/capabilities") throw Object.assign(new Error("absent"), { status: 404 }); });
  await h.enter("join", { code: "ABCDEF" });
  assert.equal(h.calls[before].path, "party/v2/capabilities");
  assert.equal(h.streams.at(-1).url, `/api/app/party/${"a".repeat(32)}/events`);
});

test("an in-flight creation cannot activate or register after its context changes", async () => {
  const h = harness(); let finish;
  h.intercept((_path, options) => options.method === "POST" ? new Promise(resolve => { finish = resolve; }) : undefined);
  const pending = h.enter("", { title_id: 42 });
  await new Promise(resolve => setImmediate(resolve));
  h.changeContext(); finish(snapshot());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(h.streams.length, 0);
  assert.equal(h.partyState(), null);
});
