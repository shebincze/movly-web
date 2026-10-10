const { test } = require("node:test");
const assert = require("node:assert/strict");
const ctx = { title: "Fixture Movie", displayMaxRank: 4, downlinkMbps: 10, runtimeMinutes: 120 };
const stream = (id, height = 720, extra = {}) => ({ id, origin: 2, provider_name: "Webshare", file_name: "Fixture Movie 2024", video_height: height, ...extra });
test("recommendations respect bandwidth, display, file size, dedupe and limit", async () => {
  const { recommendedStreams } = await import("./app/stream-recommendations.js");
  const streams = [stream(1), stream(2, 1080), stream(3, 2160), stream(4, 480)];
  assert.deepEqual(recommendedStreams([...streams, ...streams], ctx).map(s => s.id), [1, 4]);
  assert.deepEqual(recommendedStreams(streams, { ...ctx, downlinkMbps: 200 }).map(s => s.id), [3, 2, 1]);
  assert.deepEqual(recommendedStreams(streams, { ...ctx, downlinkMbps: 200, displayMaxRank: 1 }).map(s => s.id), [1, 4]);
  assert.equal(recommendedStreams([stream(5, 1080, { file_size: 45e9 })], ctx).length, 0);
});
test("sections put both databases before recommendations and preserve each row once", async () => {
  const { streamPickerSections } = await import("./app/stream-recommendations.js");
  const sources = [stream(1), stream(2, 2160), stream(3, 720, { origin: 1 }), stream(4, 720, { origin: 0 })];
  const groups = streamPickerSections(sources, ctx);
  assert.deepEqual(groups.map(g => g.name), ["Databáze", "Databáze AI", "Doporučené", "Webshare"]);
  assert.deepEqual(groups.flatMap(g => g.streams).map(s => s.id), [4, 3, 1, 2]);
  assert.equal(streamPickerSections(sources, null).some(g => g.key === "recommended"), false);
  assert.equal(streamPickerSections([sources[1]], ctx).some(g => g.key === "recommended"), false);
});
test("unsupported, unavailable, wrong title/year/episode and language sources are excluded", async () => {
  const { recommendedStreams } = await import("./app/stream-recommendations.js");
  assert.equal(recommendedStreams([stream(1)], ctx, () => false).length, 0);
  for (const extra of [{ available: false }, { file_name: "Different Movie" }, { origin: 0 }]) assert.equal(recommendedStreams([stream(1, 720, extra)], ctx).length, 0);
  assert.equal(recommendedStreams([stream(1)], { ...ctx, year: 2023 }).length, 0);
  assert.equal(recommendedStreams([stream(1, 720, { file_name: "Fixture Movie S01E03" })], { ...ctx, season: 1, episode: 2 }).length, 0);
  assert.equal(recommendedStreams([stream(1, 720, { file_name: "Fixture Movie S01E02" })], { ...ctx, season: 1, episode: 2 }).length, 1);
  assert.equal(recommendedStreams([stream(1, 720, { audio_languages: ["en"] })], { ...ctx, preferredLanguage: "cs" }).length, 0);
  assert.equal(recommendedStreams([stream(1)], { ...ctx, downlinkMbps: undefined }).length, 1);
});
