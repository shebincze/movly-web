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
  let current = snapshot(), intercept;
  const calls = [], timers = new Map();
  class Events { static OPEN = 1; readyState = 1; addEventListener() {} close() {} }
  const context = vm.createContext({
    translateUI: value => value, waitingForParty: () => false, effectivePartyPosition: () => 0,
    api: async (path, options = {}) => {
      calls.push({ path, ...options });
      if (intercept) { const result = intercept(path, options); if (result !== undefined) return result; }
      return structuredClone(current);
    }, imageURL: () => null, el: () => ({}), button: () => ({}), showDialog() {}, toast() {},
    sessionStorage: { getItem: () => "00000000-0000-0000-0000-000000000001" },
    EventSource: Events, Date, setInterval: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
  });
  const source = fs.readFileSync("app/party.js", "utf8")
    .replace(/^import .*;\n/gm, "").replace(/\bexport /g, "");
  vm.runInContext(source + "\nglobalThis.subject = { activate, deliver: fresh => apply(fresh, generation), partyState, beginPartyPlayback, endPartyPlayback, reportPartyReady };", context);
  const subject = context.subject;
  return { ...subject, calls,
    async start() { await subject.activate(current, false); calls.length = 0; },
    set(next) { current = next; },
    event(next) { current = next; subject.deliver(structuredClone(next)); },
    intercept(fn) { intercept = fn; },
    async tick() { await [...timers.values()][0](); },
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

test("an older server omitting preparation.round receives explicit expected_round zero", async () => {
  const h = harness(), missing = snapshot(); delete missing.preparation.round;
  h.set(missing); await h.start();
  const player = h.beginPartyPlayback(42, 101);
  assert.equal(h.reportPartyReady(true, player), true); await h.tick();
  assert.equal(h.readyCalls()[0].body.expected_round, 0);
  assert.equal(Object.hasOwn(h.readyCalls()[0].body, "expected_round"), true);
});

test("explicit invalid server rounds never become readiness wire values", async () => {
  for (const round of [null, "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const h = harness(); h.set(snapshot(round)); await h.start();
    const player = h.beginPartyPlayback(42, 101);
    assert.equal(h.reportPartyReady(true, player), false); await h.tick();
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
  assert.equal(h.calls.at(-1).path, `party/${"a".repeat(32)}`);
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
    if (path === `party/${"a".repeat(32)}`) return new Promise(resolve => { finish = resolve; reading(); });
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
    if (path === `party/${"a".repeat(32)}`) return new Promise(resolve => { finish = resolve; reading(); });
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
