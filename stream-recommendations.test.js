const { test } = require("node:test");
const assert = require("node:assert/strict");
const ctx = { title: "Fixture Movie", displayMaxRank: 4, downlinkMbps: 10, runtimeMinutes: 120 };
const stream = (id, height = 720, extra = {}) => ({ id, origin: 2, provider_name: "Webshare", file_name: "Fixture Movie 2024", video_height: height, ...extra });
const demoted = (reason) => ({ bucket: "demoted", reason });
test("recommendations follow the contract score: tier penalty, display cap, overload, dedupe and limit", async () => {
  const { recommendedStreams } = await import("./app/stream-recommendations.js");
  const streams = [stream(1), stream(2, 1080), stream(3, 2160), stream(4, 480)];
  // 10 Mbps → doporučený tier 720p: 1080p −2, 2160p −6 (total < 0 vypadne).
  assert.deepEqual(recommendedStreams([...streams, ...streams], ctx).map(s => s.id), [1, 2, 4]);
  assert.deepEqual(recommendedStreams(streams, { ...ctx, downlinkMbps: 200 }).map(s => s.id), [3, 2, 1]);
  // Nad stropem displeje quality = 0; položka není vyloučená, jen padá v pořadí.
  assert.deepEqual(recommendedStreams(streams, { ...ctx, downlinkMbps: 200, displayMaxRank: 1 }).map(s => s.id), [1, 4, 3]);
  // 45 GB / 120 min ≈ 50 Mbps na 10 Mbps lince: bitrate 0, adaptace −2 −5 → total < 0.
  assert.equal(recommendedStreams([stream(5, 1080, { file_size: 45e9 })], ctx).length, 0);
});
test("sections put databases first, then recommendations, providers and Podobné last", async () => {
  const { streamPickerSections } = await import("./app/stream-recommendations.js");
  const sources = [stream(1), stream(2, 2160), stream(3, 720, { origin: 1 }), stream(4, 720, { origin: 0 }),
    stream(5, 2160, { relevance: demoted("seasonPack"), file_name: "Fixture Movie S01 COMPLETE" })];
  const groups = streamPickerSections(sources, ctx);
  assert.deepEqual(groups.map(g => g.name), ["Databáze", "Databáze AI", "Doporučené", "Webshare", "Podobné"]);
  assert.deepEqual(groups.flatMap(g => g.streams).map(s => s.id), [4, 3, 1, 2, 5]);
  assert.deepEqual(streamPickerSections(sources, null).map(g => g.key).slice(-1), ["similar"]);
  assert.equal(streamPickerSections(sources, null).some(g => g.key === "recommended"), false);
  assert.equal(streamPickerSections([sources[1]], ctx).some(g => g.key === "recommended"), false);
});
test("demoted items are never recommended or eligible for automatic selection", async () => {
  const { eligible, recommendedStreams, demotionLabel } = await import("./app/stream-recommendations.js");
  for (const reason of ["bonusContent", "seasonPack", "yearMismatch", null]) {
    const item = stream(1, 1080, { relevance: demoted(reason), file_name: "Fixture Movie 2024 Trailer" });
    assert.equal(recommendedStreams([item], { ...ctx, downlinkMbps: 200 }).length, 0, String(reason));
    assert.equal(eligible(item, ctx), false, String(reason));
  }
  assert.equal(demotionLabel(stream(1, 720, { relevance: demoted("bonusContent") })), "bonus / trailer");
  assert.equal(demotionLabel(stream(1, 720, { relevance: demoted("seasonPack") })), "celá sezóna");
  assert.equal(demotionLabel(stream(1, 720, { relevance: demoted(null) })), "název nesedí");
});
test("accepted verdict replaces the legacy name check; items without a verdict keep it", async () => {
  const { eligible, recommendedStreams } = await import("./app/stream-recommendations.js");
  const renamed = stream(1, 720, { file_name: "Fixture.Movie.(2024).CZ.dabing.mkv", relevance: { bucket: "accepted", reason: null } });
  assert.equal(eligible(renamed, ctx), true);
  assert.equal(eligible({ ...renamed, relevance: null, file_name: "Different Movie" }, ctx), false);
  assert.equal(recommendedStreams([stream(1)], ctx, () => false).length, 0);
  for (const extra of [{ available: false }, { file_name: "Different Movie" }, { origin: 0 }]) assert.equal(recommendedStreams([stream(1, 720, extra)], ctx).length, 0);
  assert.equal(recommendedStreams([stream(1)], { ...ctx, year: 2023 }).length, 0);
  assert.equal(recommendedStreams([stream(1, 720, { file_name: "Fixture Movie S01E03" })], { ...ctx, season: 1, episode: 2 }).length, 0);
  assert.equal(recommendedStreams([stream(1, 720, { file_name: "Fixture Movie S01E02" })], { ...ctx, season: 1, episode: 2 }).length, 1);
  assert.equal(recommendedStreams([stream(1)], { ...ctx, downlinkMbps: undefined }).length, 1);
});
test("primary language is a hard condition and scores +100", async () => {
  const { recommendedStreams, eligible } = await import("./app/stream-recommendations.js");
  const cs = { ...ctx, primaryLanguage: "cs" };
  assert.equal(recommendedStreams([stream(1, 720, { audio_languages: ["en"] })], cs).length, 0);
  assert.equal(eligible(stream(1, 720, { audio_languages: ["CZ", "EN"] }), cs), true);
  // Databázový kód „cze" se normalizuje na cs; položka bez jazyka do Doporučených nejde.
  assert.equal(eligible(stream(1, 720, { origin: 0, audio_languages: ["cze"] }), cs), true);
  assert.deepEqual(recommendedStreams([stream(1, 720), stream(2, 480, { audio_languages: ["cs"] })], cs).map(s => s.id), [2]);
});
test("resolver scoring payload, sort modes and facets use the shared contract", async () => {
  const { scoringCandidate, sortStreams, facetStreams, facetOptions } = await import("./app/stream-recommendations.js");
  const fromResolver = stream(2, null, { quality: "FHD", scoring: { quality_rank: 2, hdr: "HDR10", size_bytes: 8e9, duration_seconds: null,
    bitrate_kbps: null, video_codec: "H.265", audio_tracks: [{ language: "CZ", codec: "DTS", channels: 6 }], subtitle_tracks: [{ language: "en", forced: false }],
    is_3d: false, is_database: false } });
  const candidate = scoringCandidate(fromResolver, 120);
  assert.equal(candidate.qualityRank, 2);
  assert.equal(candidate.durationSeconds, 7200);
  assert.deepEqual(candidate.audioTracks, [{ language: "CZ", codec: "DTS", channels: 6 }]);
  const legacy = scoringCandidate(stream(9, 2160, { file_name: "Fixture Movie 2024 3D HSBS DDP 5.1", audio_languages: ["CS/EN"], audio_codec: "EAC3", file_size: 0 }), null);
  assert.deepEqual(legacy.audioTracks.map(t => [t.language, t.channels]), [["CS", 6], ["EN", 6]]);
  assert.equal(legacy.is3D, true);
  assert.equal(legacy.sizeBytes, null);
  const items = [stream(1, 720, { file_size: 3e9 }), fromResolver, stream(3, 2160, { file_size: 20e9, hdr_type: "Dolby Vision" }), stream(4, 1080)];
  const ids = (list) => list.map(s => s.id);
  assert.deepEqual(ids(sortStreams(items, "quality", ctx)), [3, 2, 4, 1]);
  assert.deepEqual(ids(sortStreams(items, "size", ctx)), [3, 2, 1, 4]);
  assert.deepEqual(ids(sortStreams(items, { mode: "custom", normalization: "lexicographic", weights: { sizeSmall: 8 } }, ctx)), [1, 2, 3, 4]);
  const facets = (filter) => { const r = facetStreams(items, { languages: [], resolutions: [], dynamicRanges: [], ...filter }, ctx); return [ids(r.items), r.relaxed]; };
  assert.deepEqual(facets({}), [[1, 2, 3, 4], false]);
  assert.deepEqual(facets({ resolutions: [2] }), [[2, 4], false]);
  assert.deepEqual(facets({ resolutions: [1, 4] }), [[1, 3], false]);
  assert.deepEqual(facets({ dynamicRanges: ["DV"] }), [[3], false]);
  assert.deepEqual(facets({ languages: ["audio_cs", "sub_en"] }), [[2], false]);
  assert.deepEqual(facets({ languages: ["audio_cs"], resolutions: [4] }), [[1, 2, 3, 4], true]);
  assert.deepEqual(facetOptions(items, ctx), { audio: ["cs"], subtitles: ["en"], resolutions: [1, 2, 4], dynamicRanges: ["SDR", "HDR10", "DV"] });
});
