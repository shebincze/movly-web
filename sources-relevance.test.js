"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const r = require("./sources-relevance"),
  c = require("./test-support/stream-relevance.cases.json");
for (const k of ["normalize", "tokenize"])
  for (const f of c[k])
    test(`canonical ${k}: ${f.input}`, () =>
      assert.deepEqual(r[k](f.input), f.expected));
for (const f of c.titleVariants)
  test(`canonical variants: ${f.title}`, () =>
    assert.deepEqual(
      r.titleVariants(f.title, f.originalTitle, f.allTitles, f.extraTitles),
      { variants: f.expectedVariants, fullTitles: f.expectedFullTitles },
    ));
for (const f of c.patterns)
  test(`canonical patterns: ${f.variants}`, () =>
    assert.deepEqual(r.patterns(f.variants).sort(), f.expected.sort()));
for (const f of c.fuzzyEquals)
  test(`canonical fuzzy: ${f.expected}/${f.actual}`, () =>
    assert.equal(r.fuzzy(f.expected, f.actual), f.result));
for (const f of c.tokenGate)
  test(`canonical token gate: ${JSON.stringify(f)}`, () =>
    assert.equal(r.tokenGate(f.pattern, r.tokenize(f.name)), f.qualifies));
for (const f of c.episodeSlot)
  test(`canonical slot: ${f.name}`, () =>
    assert.deepEqual(r.episodeSlot(r.tokenize(f.name)), f.expected));
for (const f of c.providerType)
  test(`canonical type: ${f.name}`, () =>
    assert.deepEqual(r.providerType(f.name), f.expected));
for (const f of c.earlyProviderGate)
  test(`canonical early: ${f.name}`, () =>
    assert.equal(
      r.earlyGate(f.kind, f.title, f.year, f.season, f.episode, f.name),
      f.expected,
    ));
for (const f of c.trailerFilter)
  test(`canonical trailers: ${f.variants}`, () =>
    assert.deepEqual(
      r.filterTrailers(f.variants, f.candidates).map((c) => c.name),
      f.expectedKeptNames,
    ));
for (const f of c.relevance)
  test(`canonical evaluate: ${f.id}`, () =>
    assert.deepEqual(
      r.evaluate(c.relevanceRequests[f.request], f.candidate),
      f.expected,
    ));
