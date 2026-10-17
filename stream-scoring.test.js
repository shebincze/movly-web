"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Kontraktový test: všechny sekce scoring.json (shebincze/Movly contracts/stream-relevance).
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "test-support/stream-scoring.fixtures.json"), "utf8"));
const moduleURL = new URL("./app/stream-scoring.js", `file://${__dirname}/`);
const tol = fixtures.tables.tolerance;
const close = (got, exp) => (typeof exp === "number" && typeof got === "number" ? Math.abs(got - exp) <= tol : got === exp);

test("embedded tables equal scoring.json tables", async () => {
  const { TABLES } = await import(moduleURL.href);
  assert.deepEqual(JSON.parse(JSON.stringify(TABLES)), fixtures.tables);
});

test("scoring.json contract: every section passes (FAILS: 0)", async () => {
  const s = await import(moduleURL.href);
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
