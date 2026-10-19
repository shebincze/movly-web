"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Kontraktový test: všechny sekce scoring.json (shebincze/Movly contracts/stream-relevance).
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "test-support/stream-scoring.fixtures.json"), "utf8"));
const scoring = require("./app/tv/stream-scoring.js");
const tol = fixtures.tables.tolerance;
const close = (got, exp) => (typeof exp === "number" && typeof got === "number" ? Math.abs(got - exp) <= tol : got === exp);

test("embedded tables equal scoring.json tables", async () => {
  const { TABLES } = scoring;
  assert.deepEqual(JSON.parse(JSON.stringify(TABLES)), fixtures.tables);
});

test("TV ES5 scoring.json contract: every section passes (FAILS: 0)", async () => {
  const s = scoring;
  const counts = {}, failures = [];
  const check = (section, id, ok, detail) => {
    counts[section] = (counts[section] || 0) + 1;
    if (!ok) failures.push(`${section} ${JSON.stringify(id)}: ${detail}`);
  };
  for (const c of fixtures.languageCode) { const got = s.languageCode(c.token); check("languageCode", c.token, got === c.expected, `${got}`); }
  for (const c of fixtures.codecKey) { const got = s.codecKey(c.value); check("codecKey", c.value, got === c.expected, got); }
  for (const c of fixtures.dynamicRange) { const got = s.dynamicRange(c.hdr); check("dynamicRange", c.hdr, got === c.expected, got); }
  for (const c of fixtures.channelsFromName) { const got = s.channelsFromName(c.name); check("channelsFromName", c.name, got === c.expected, `${got}`); }
  for (const c of fixtures.effectiveBitrate) {
    const got = s.effectiveBitrateMbps(c.candidate);
    check("effectiveBitrate", c.candidate, (got === null) === (c.expected === null) && (got === null || close(got, c.expected)), `${got}`);
  }
  for (const c of fixtures.parseRange) {
    const r = s.parseRange(c.spec), got = r && { min: r.min, max: r.max };
    check("parseRange", c.spec, JSON.stringify(got) === JSON.stringify(c.expected), JSON.stringify(got));
  }
  for (const c of fixtures.score) {
    const got = s.score(fixtures.settings[c.settings], c.candidate);
    const bad = Object.entries(c.expected).filter(([k, v]) => !close(got[k], v));
    check("score", c.id, !bad.length, JSON.stringify(Object.fromEntries(bad.map(([k, v]) => [k, [got[k], v]]))));
  }
  for (const c of fixtures.sort) {
    const got = s.sortOrder(fixtures.settings[c.settings], c.spec, c.candidates).map((i) => c.candidates[i].id);
    check("sort", c.id, JSON.stringify(got) === JSON.stringify(c.expected), JSON.stringify(got));
  }
  for (const c of fixtures.facets) {
    const { items, relaxed } = s.applyFacets(c.filter, c.candidates);
    const got = { items: items.map((x) => x.id), relaxed };
    check("facets", c.id, JSON.stringify(got) === JSON.stringify({ items: c.expected, relaxed: c.relaxed }), JSON.stringify(got));
  }
  for (const [section, n] of Object.entries(counts)) console.log(`${section}: ${n} případů`);
  console.log(`FAILS: ${failures.length}`);
  assert.deepEqual(failures, []);
  assert.deepEqual([counts.score, counts.sort, counts.facets], [57, 24, 13]);
});

test("TV source adapter and recommendation agree with the modern picker", async () => {
  const modern = await import('./app/stream-recommendations.js');
  const ctx = {title:'Movie',year:2025,primaryLanguage:'cs',displayMaxRank:2,runtimeMinutes:100,downlinkMbps:20};
  const sources = [
    {id:1,origin:2,provider_name:'webshare',file_name:'Movie 2025',video_height:1080,file_size:4e9,audio_languages:['en'],bitrate_kbps:6500},
    {id:2,origin:3,provider_name:'hellspy',file_name:'Movie 2025',video_height:720,file_size:3e9,audio_languages:['CZ/EN'],bitrate_kbps:6500},
    {id:3,origin:2,provider_name:'webshare',file_name:'Movie 2025',relevance:{bucket:'demoted'},video_height:1080,audio_languages:['cs']},
    {id:4,origin:4,provider_name:'stremio',file_name:'opaque provider label',relevance:{bucket:'accepted'},scoring:{quality_rank:2,size_bytes:4e9,bitrate_kbps:12500,audio_tracks:[{language:'cze',codec:'aac',channels:6}]}},
    {id:5,origin:0,file_name:'Movie 2025',video_height:1080,audio_languages:['cs']},
    {id:6,origin:2,file_name:'Movie 2025',available:false,video_height:1080,audio_languages:['cs']},
    {id:7,origin:4,file_name:'Movie 2025',quality:'4k',audio_languages:['cs'],audio_codec:'atmos',subtitle_languages:['en']},
  ];
  assert.deepEqual(scoring.settings(ctx), modern.scoringSettings(ctx));
  for (const source of sources) assert.deepEqual(scoring.candidate(source,100),modern.scoringCandidate(source,100));
  const playable = s => s.id !== 7;
  const identity = s => s.file_name === 'Movie 2025';
  assert.equal(scoring.recommended(sources,ctx,playable,identity)?.id,modern.recommendedStreams(sources,ctx,playable)[0]?.id);
  assert.equal(scoring.recommended(sources,ctx,playable,identity)?.id,4);
  // Accepted relevance bypasses old filename matching; demoted, unavailable,
  // disconnected, database and wrong audio sources never become recommended.
  assert.equal(scoring.recommended(sources.filter(s => s.id !== 4),ctx,playable,identity)?.id,2);
  assert.equal(scoring.recommended(sources.filter(s => ![2,4].includes(s.id)),ctx,playable,identity),null);
  const equal = sources[1];
  assert.equal(scoring.recommended([equal,{...equal,id:100}],ctx,playable,identity),equal);
});

test("ES5 scoring loads and runs without modern collection or string APIs", () => {
  const vm = require('node:vm');
  const context=vm.createContext({});
  vm.runInContext('Map=undefined; Set=undefined; Array.from=undefined; Object.entries=undefined; Array.prototype.includes=undefined; String.prototype.includes=undefined; String.prototype.startsWith=undefined;',context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'app/tv/stream-scoring.js'),'utf8'),context);
  const tv=context.MovlyTvScoring;
  for (const c of fixtures.score) {
    const got=tv.score(fixtures.settings[c.settings],c.candidate);
    for (const [key,value] of Object.entries(c.expected)) assert.ok(close(got[key],value),`${c.id}:${key}`);
  }
});
