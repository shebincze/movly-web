const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
async function moduleForTest() {
  const source = await fs.readFile(path.join(__dirname, "app/playback-memory.js"), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
function storage() { const values = new Map(); return { values, getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) }; }
test("playback source and tracks survive a new session and never cross owners or episodes", async () => {
  const m = await moduleForTest(), s = storage(), episode = {id: 23, season_number: 1, episode_number: 2};
  m.setPlaybackOwner({id: 1}, {id: 2});
  const source = {title_id: 10, source: "human", stream_id: 30, url: "https://cdn.invalid/?token=secret", headers: {Cookie: "secret"}};
  m.rememberPlayback(10, episode, source, {index: 1, key: "cs|Czech"}, {index: -1, key: "off"}, m.playbackOwner(), s);
  m.setPlaybackOwner(null, null); m.setPlaybackOwner({id: 1}, {id: 2});
  const saved = m.recalledPlayback(10, episode, m.playbackOwner(), s);
  assert.equal(saved.selection.stream_id, 30); assert.equal(saved.subtitle.key, "off");
  assert.equal([...s.values.values()].join("").includes("secret"), false);
  for (const [account, profile] of [[1,3], [3,2]]) {
    m.setPlaybackOwner({id: account}, {id: profile});
    assert.equal(m.recalledPlayback(10, episode, m.playbackOwner(), s), null);
  }
  m.setPlaybackOwner({id: 1}, {id: 2});
  assert.equal(m.recalledPlayback(10, {...episode, episode_number: 3}, m.playbackOwner(), s), null);
});
test("a late player callback cannot overwrite another profile and live session tickets are never saved", async () => {
  const m = await moduleForTest(), s = storage();
  m.setPlaybackOwner({id: 1}, {id: 2}); const captured = m.playbackOwner();
  m.setPlaybackOwner({id: 1}, {id: 3});
  m.rememberPlayback(10, null, {source: "human", stream_id: 1}, {}, {}, captured, s);
  assert.equal(s.values.size, 0);
  m.rememberPlayback(10, null, {source: "live", ticket: "ephemeral"}, {index: 0, key: "audio"}, {index: -1, key: "off"}, m.playbackOwner(), s);
  assert.equal(s.values.size, 0);
  m.rememberPlayback(10, null, {source: "live", ticket: "ephemeral", resume_selection: {source: "resume", ticket: "durable"}}, {index: 0, key: "audio"}, {index: -1, key: "off"}, m.playbackOwner(), s);
  assert.equal(m.recalledPlayback(10, null, m.playbackOwner(), s).selection.ticket, "durable");
});

test("old callbacks stay invalid after switching A to B to A and malformed records fall back safely", async () => {
  const m = await moduleForTest(), s = storage();
  m.setPlaybackOwner({id: 1}, {id: 2}); const old = m.playbackOwner();
  m.setPlaybackOwner({id: 1}, {id: 3}); m.setPlaybackOwner({id: 1}, {id: 2});
  m.rememberPlayback(10, null, {source: "human", stream_id: 1}, {index: 0, key: "audio"}, {index: -1, key: "off"}, old, s);
  assert.equal(s.values.size, 0);
  m.rememberPlayback(10, null, {source: "human", stream_id: 1}, {index: 0, key: "audio"}, {index: -1, key: "off"}, m.playbackOwner(), s);
  const key = [...s.values.keys()][0]; s.setItem(key, '{"selection":{"source":"human"}}');
  assert.equal(m.recalledPlayback(10, null, m.playbackOwner(), s), null);
});
