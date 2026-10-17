const { test } = require("node:test");
const assert = require("node:assert/strict");
const sync = import("./app/party-sync.js");

// Minimal HTML5 media model: a seek completes after a latency that depends on
// whether the target was buffered and on how far the server already produced.
function engine({ position = 0, buffered = [[0, 30]], bufferedLatency = 50, unbufferedLatency = 1200, produced = Infinity, productionRate = 0, startLatency = 100 } = {}) {
  const e = { position, playing: false, seeking: false, ready: true, rate: 1, buffered: buffered.map((r) => [...r]), produced, seeks: [], plays: 0, pauses: 0 };
  let seekDone = null, startAt = null;
  e.apply = (now, step) => {
    if (step.seekTo !== null) {
      // A browser clamps a seek beyond `seekable` (the produced edge) to that edge.
      const to = Math.min(step.seekTo, e.produced);
      e.seeks.push({ at: now, to, requested: step.seekTo });
      const inBuffer = e.buffered.some(([s, end]) => to >= s && to + 1 <= end);
      e.position = to;
      e.seeking = true;
      e.ready = false;
      seekDone = { at: now + (inBuffer ? bufferedLatency : unbufferedLatency), to, inBuffer };
    }
    if (step.play === true && !e.playing) { e.playing = true; e.plays++; startAt = now + startLatency; }
    if (step.play === false && e.playing) { e.playing = false; e.pauses++; }
    e.rate = step.rate;
  };
  e.advance = (now, dt) => {
    e.produced += productionRate * dt / 1000;
    if (e.seeking && seekDone && now >= seekDone.at) {
      e.seeking = false;
      e.ready = true;
      if (!seekDone.inBuffer) e.buffered.push([seekDone.to - 0.5, seekDone.to + 20]);
      seekDone = null;
    }
    if (e.playing && !e.seeking && now >= startAt) e.position += (dt / 1000) * e.rate;
  };
  return e;
}

// Runs the follower against a room trajectory; room(now) -> {target, playing}.
async function run({ e, room, until, dt = 100, from = 0 }) {
  const { createPartyFollower } = await sync;
  const follower = createPartyFollower();
  const log = [];
  for (let now = from; now <= until; now += dt) {
    const r = room(now);
    const step = follower.tick({ now, position: e.position, seeking: e.seeking, ready: e.ready, playing: e.playing,
      target: r.target, roomPlaying: r.playing, waiting: false, buffered: e.buffered, duration: 1500,
      produced: Number.isFinite(e.produced) ? e.produced : null });
    e.apply(now, step);
    log.push({ now, drift: e.position - r.target, step, seeking: e.seeking, playing: e.playing });
    e.advance(now, dt);
  }
  return log;
}
const settledAfter = (log, from, limit = 1) => {
  const after = log.filter((x) => x.now >= from);
  for (let i = after.length - 1; i >= 0; i--) if (Math.abs(after[i].drift) >= limit) return i + 1 < after.length ? (after[i + 1].now - from) / 1000 : null;
  return 0;
};

test("bufferedAt requires the target and a short run-up inside one buffered range", async () => {
  const { bufferedAt } = await sync;
  assert.equal(bufferedAt([[0, 10]], 5), true);
  assert.equal(bufferedAt([[0, 10]], 9.5), false);
  assert.equal(bufferedAt([[0, 4], [6, 10]], 4.5), false);
  assert.equal(bufferedAt(null, 1), false);
});

test("host +10 s outside the buffer: one prepared seek lands ahead and starts on the room clock (#146)", async () => {
  // Playing room at 20 s; member in sync; buffer ends at 24 s. Host jumps +10 s at t=2 s.
  const e = engine({ position: 18, buffered: [[0, 24]], unbufferedLatency: 1200 });
  e.playing = true;
  const room = (now) => ({ playing: true, target: 18 + now / 1000 + (now >= 2000 ? 10 : 0) });
  const log = await run({ e, room, until: 15000 });
  const seeks = e.seeks.filter((s) => s.at >= 2000);
  assert.equal(seeks.length, 1, JSON.stringify(e.seeks));
  assert.ok(seeks[0].to > room(2000).target, "the landing is ahead of the room");
  const settle = settledAfter(log, 2000, 1);
  assert.ok(settle !== null && settle <= 5, `settled in ${settle}s`);
  assert.ok(Math.abs(log.at(-1).drift) < 0.35, `final drift ${log.at(-1).drift}`);
  assert.ok(log.filter((x) => x.now >= 2000).every((x) => Math.abs(x.drift) <= 11), "never further than the jump itself");
});

test("a load slower than the lead gets exactly one retry and never a seek loop (#146)", async () => {
  const e = engine({ position: 10, buffered: [[0, 14]], unbufferedLatency: 4000 });
  e.playing = true;
  const room = (now) => ({ playing: true, target: 10 + now / 1000 + (now >= 1000 ? 30 : 0) });
  const log = await run({ e, room, until: 40000 });
  const seeks = e.seeks.filter((s) => s.at >= 1000);
  assert.ok(seeks.length >= 2 && seeks.length <= 3, `bounded seeks: ${JSON.stringify(seeks)}`);
  assert.equal(log.filter((x) => /retry/.test(x.step.diagnostic || "")).length, 1);
  assert.ok(Math.abs(log.at(-1).drift) < 0.5, `final drift ${log.at(-1).drift}`);
});

test("target beyond the produced edge waits for production instead of a clamped seek loop (#146)", async () => {
  // Server produced up to 26 s and produces at 2x real time; the host jumps +30 s.
  const e = engine({ position: 20, buffered: [[0, 26]], unbufferedLatency: 300, produced: 26, productionRate: 2 });
  e.playing = true;
  const room = (now) => ({ playing: true, target: 20 + now / 1000 + (now >= 1000 ? 30 : 0) });
  const log = await run({ e, room, until: 60000 });
  const after = e.seeks.filter((s) => s.at >= 1000);
  assert.equal(after.length, 2, `one edge seek, one landing: ${JSON.stringify(after)}`);
  assert.ok(after[0].requested === after[0].to && after[0].to < room(after[0].at).target, "the first seek only moves to the produced edge, never clamped");
  assert.ok(after[1].requested === after[1].to, "the landing is produced when it is sought");
  assert.ok(log.some((x) => /await_production/.test(x.step.diagnostic || "")));
  const settle = settledAfter(log, 1000, 1);
  assert.ok(settle !== null && settle < 45, `settled in ${settle}s`);
  assert.ok(Math.abs(log.at(-1).drift) < 0.35, `final drift ${log.at(-1).drift}`);
});
test("production that stops advancing abandons the wait instead of holding forever (#146)", async () => {
  const e = engine({ position: 20, buffered: [[0, 26]], produced: 26, productionRate: 0 });
  e.playing = true;
  const room = (now) => ({ playing: true, target: 20 + now / 1000 + (now >= 1000 ? 30 : 0) });
  const log = await run({ e, room, until: 30000 });
  assert.ok(log.some((x) => /abandoned production/.test(x.step.diagnostic || "")));
  assert.ok(e.seeks.length <= 4, JSON.stringify(e.seeks));
  assert.equal(log.at(-1).playing, true, "plays again instead of holding the member paused");
});

test("paused room keeps the buffer for a small offset and seeks once per target otherwise", async () => {
  // Small offset outside the buffer (it starts at the member): nothing is loaded while paused.
  let e = engine({ position: 50.6, buffered: [[50.5, 70]] });
  await run({ e, room: () => ({ playing: false, target: 50 }), until: 3000 });
  assert.equal(e.seeks.length, 0);
  // The same offset inside the buffer is a free MSE seek, issued once.
  e = engine({ position: 50.6, buffered: [[40, 60]] });
  await run({ e, room: () => ({ playing: false, target: 50 }), until: 3000 });
  assert.deepEqual(e.seeks.map((s) => s.to), [50]);
  // A large offset outside the buffer is loaded once, during the pause.
  e = engine({ position: 10, buffered: [[0, 20]] });
  await run({ e, room: () => ({ playing: false, target: 50 }), until: 5000 });
  assert.deepEqual(e.seeks.map((s) => s.to), [50]);
});

test("resume with a small pause difference plays without a seek and slews the rest (#146)", async () => {
  // Member paused 0.6 s after the room and its buffer starts there, so the
  // resume target is not buffered: no seek, the slew closes the gap.
  const e = engine({ position: 20.6, buffered: [[20.6, 60]], unbufferedLatency: 1500 });
  const room = (now) => ({ playing: now >= 1000, target: 20 + Math.max(0, now - 1000) / 1000 });
  const log = await run({ e, room, until: 12000 });
  assert.equal(e.seeks.length, 0, JSON.stringify(e.seeks));
  assert.ok(log.some((x) => x.step.rate === 0.95), "slows down to let the room catch up");
  assert.ok(log.filter((x) => x.now > 1000).every((x) => Math.abs(x.drift) < 1), "stays within 1 s");
  assert.ok(Math.abs(log.at(-1).drift) < 0.3, `final drift ${log.at(-1).drift}`);
});

test("a lasting large drift resyncs at most twice per room trajectory", async () => {
  // A member that cannot keep up: playback runs at 70 % of real time.
  const e = engine({ position: 0, buffered: [[0, 2000]], bufferedLatency: 50 });
  e.playing = true;
  const originalAdvance = e.advance;
  e.advance = (now, dt) => originalAdvance(now, dt * 0.7);
  const room = (now) => ({ playing: true, target: now / 1000 });
  await run({ e, room, until: 60000 });
  assert.ok(e.seeks.length <= 3, `${e.seeks.length} seeks`);
});
