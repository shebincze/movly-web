"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
globalThis.crypto ||= webcrypto;

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "test-support/effective-policy-v1.fixtures.json"), "utf8"));
const moduleURL = new URL("./app/effective-policy.js", `file://${__dirname}/`);

test("effective policy adapter validates canonical v1 fixtures and exact profile/catalog decisions", async () => {
  const { adaptEffectiveContentPolicy } = await import(moduleURL.href);
  assert.equal(fixtures.schema_version, 1);
  assert.equal(fixtures.cases.length, 9);
  for (const item of fixtures.cases) {
    const adapted = await adaptEffectiveContentPolicy(item.effective, {
      accountId: item.stored.user_id,
      profileId: item.stored.profile_id,
    });
    assert.deepEqual(adapted, item.effective, item.name);
    for (const title of item.titles) {
      const profileAllowed = !item.effective.is_kids || (
        !title.adult && (title.min_age == null
          ? item.effective.allow_unrated
          : title.min_age <= item.effective.max_age)
      );
      assert.equal(title.profile_allowed, profileAllowed, `${item.name}/${title.title} profile`);
      assert.equal(title.catalog_allowed, profileAllowed && !title.adult, `${item.name}/${title.title} catalog`);
    }
  }
});

test("effective policy adapter fails closed on malformed, mismatched, or forged DTOs", async () => {
  const { adaptEffectiveContentPolicy } = await import(moduleURL.href);
  const valid = fixtures.cases[0].effective,
    expected = { accountId: valid.user_id, profileId: valid.profile_id };
  for (const value of [
    null,
    { ...valid, revision: "ep1.bad" },
    { ...valid, revision: "ep1." + "0".repeat(64) },
    { ...valid, max_age: 18 },
    { ...valid, catalog_excludes_adult: false },
    { ...valid, profile_id: valid.profile_id + 1 },
  ])
    await assert.rejects(adaptEffectiveContentPolicy(value, expected), /rules|pravidla/i);
});

test("verified legacy profile projects only effective settings and shares the canonical revision", async () => {
  const { verifiedLegacyProfilePolicy } = await import(moduleURL.href);
  const adult = await verifiedLegacyProfilePolicy(
    { id: 10, is_kids: false, max_certification: 7, allow_unrated: false },
    { accountId: 1, profileId: 10 },
  );
  assert.equal(adult.revision, fixtures.cases.find((item) => item.name === "ordinary_default").effective.revision);
  assert.equal(adult.max_age, null);
  assert.equal(adult.allow_unrated, true);
  assert.equal(adult.verification_source, "verified_legacy_profile");
  const kids = await verifiedLegacyProfilePolicy(
    { id: 20, is_kids: true, max_certification: 7, allow_unrated: false },
    { accountId: 1, profileId: 20 },
  );
  assert.equal(kids.revision, fixtures.cases.find((item) => item.name === "kids_7_rated_only").effective.revision);
  await assert.rejects(verifiedLegacyProfilePolicy(
    { id: 20, is_kids: true, allow_unrated: false },
    { accountId: 1, profileId: 20 },
  ));
});

test("policy cache partitions by owner, discards stale in-flight owners and signals known revisions", async () => {
  const { invalidateApiContext } = await import("./app/api.js");
  const { effectiveContentPolicy, clearEffectivePolicyCache } = await import(moduleURL.href);
  const oldFetch = globalThis.fetch,
    oldLocation = globalThis.location,
    oldDocument = globalThis.document,
    oldCustomEvent = globalThis.CustomEvent;
  globalThis.location = { origin: "https://fixture.test" };
  const events = [];
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.document = { dispatchEvent(event) { events.push(event); } };
  try {
    clearEffectivePolicyCache();
    let release;
    globalThis.fetch = () => new Promise((resolve) => { release = resolve; });
    invalidateApiContext({ accountId: 1, profile: { id: 10 } });
    const stale = effectiveContentPolicy({ refresh: true });
    invalidateApiContext({ accountId: 2, profile: { id: 20 } });
    release({ ok: true, status: 200, json: async () => fixtures.cases[0].effective });
    await assert.rejects(stale, { name: "AbortError" });

    const first = fixtures.cases.find((item) => item.name === "kids_7_rated_only").effective,
      changed = fixtures.cases.find((item) => item.name === "kids_7_unrated_allowed").effective;
    invalidateApiContext({ accountId: 1, profile: { id: 20 } });
    const responses = [first, changed];
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => responses.shift() });
    assert.equal((await effectiveContentPolicy({ refresh: true })).revision, first.revision);
    assert.equal((await effectiveContentPolicy({ refresh: true })).revision, changed.revision);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "movly:effective-policy-changed");
    assert.equal(events[0].detail.previous, first.revision);
    assert.equal(events[0].detail.current, changed.revision);
  } finally {
    clearEffectivePolicyCache();
    globalThis.fetch = oldFetch;
    globalThis.location = oldLocation;
    globalThis.document = oldDocument;
    globalThis.CustomEvent = oldCustomEvent;
  }
});

test("effective-policy authorization failures never probe legacy profile fallback", async () => {
  const { invalidateApiContext } = await import("./app/api.js");
  const { effectiveContentPolicy, clearEffectivePolicyCache } = await import(moduleURL.href);
  const oldFetch = globalThis.fetch,
    oldLocation = globalThis.location;
  globalThis.location = { origin: "https://fixture.test" };
  try {
    clearEffectivePolicyCache();
    invalidateApiContext({ accountId: 1, profile: { id: 10 } });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 403, json: async () => ({ message: "Forbidden" }) }; };
    await assert.rejects(effectiveContentPolicy({ refresh: true }), (error) => error.status === 403);
    assert.equal(calls, 1);
  } finally {
    clearEffectivePolicyCache();
    globalThis.fetch = oldFetch;
    globalThis.location = oldLocation;
  }
});

test("unsupported policy endpoint uses only a complete selected legacy profile and otherwise stays unverified", async () => {
  const { invalidateApiContext } = await import("./app/api.js");
  const { effectiveContentPolicy, clearEffectivePolicyCache } = await import(moduleURL.href);
  const oldFetch = globalThis.fetch,
    oldLocation = globalThis.location;
  globalThis.location = { origin: "https://fixture.test" };
  try {
    clearEffectivePolicyCache();
    invalidateApiContext({ accountId: 1, profile: { id: 10 } });
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? { ok: false, status: 404, json: async () => ({ message: "not supported" }) }
        : { ok: true, status: 200, json: async () => [{ id: 10, is_kids: false, max_certification: 7, allow_unrated: false }] };
    };
    const legacy = await effectiveContentPolicy({ refresh: true });
    assert.equal(legacy.verification_source, "verified_legacy_profile");
    assert.equal(legacy.revision, fixtures.cases[0].effective.revision);
    assert.equal(calls.length, 2);

    clearEffectivePolicyCache();
    calls.length = 0;
    globalThis.fetch = async () => {
      calls.push("called");
      return calls.length === 1
        ? { ok: false, status: 404, json: async () => ({ message: "not supported" }) }
        : { ok: true, status: 200, json: async () => [{ id: 10 }] };
    };
    assert.equal(await effectiveContentPolicy({ refresh: true }), null);
  } finally {
    clearEffectivePolicyCache();
    globalThis.fetch = oldFetch;
    globalThis.location = oldLocation;
  }
});

test("unsupported endpoint refreshes legacy settings and ignores a late same-owner profile snapshot", async () => {
  const { invalidateApiContext } = await import("./app/api.js");
  const { effectiveContentPolicy, clearEffectivePolicyCache } = await import(moduleURL.href);
  const oldFetch = globalThis.fetch,
    oldLocation = globalThis.location;
  globalThis.location = { origin: "https://fixture.test" };
  try {
    clearEffectivePolicyCache();
    invalidateApiContext({ accountId: 1, profile: { id: 10 } });
    let releaseOldProfile;
    let profileReads = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("effective-content-policy"))
        return { ok: false, status: 404, json: async () => ({ message: "not supported" }) };
      assert.ok(String(url).endsWith("/profiles"));
      profileReads++;
      if (profileReads === 1)
        return new Promise((resolve) => { releaseOldProfile = () => resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 10, is_kids: false, max_certification: 7, allow_unrated: false }],
        }); });
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 10, is_kids: true, max_certification: 12, allow_unrated: false }],
      };
    };
    const stale = effectiveContentPolicy({ refresh: true });
    while (!releaseOldProfile) await new Promise((resolve) => setImmediate(resolve));
    clearEffectivePolicyCache();
    const current = await effectiveContentPolicy({ refresh: true });
    assert.equal(current.is_kids, true);
    assert.equal(current.max_age, 12);
    releaseOldProfile();
    await assert.rejects(stale, { name: "AbortError" });
    assert.equal((await effectiveContentPolicy()).revision, current.revision);
    assert.equal(profileReads, 2);
  } finally {
    clearEffectivePolicyCache();
    globalThis.fetch = oldFetch;
    globalThis.location = oldLocation;
  }
});

test("offline policy-marker storage failures do not block online policy use", async () => {
  const { invalidateApiContext } = await import("./app/api.js");
  const { effectiveContentPolicy, clearEffectivePolicyCache } = await import(moduleURL.href);
  const oldFetch = globalThis.fetch,
    oldLocation = globalThis.location,
    oldIndexedDB = globalThis.indexedDB;
  globalThis.location = { origin: "https://fixture.test" };
  globalThis.indexedDB = { open() { throw new Error("local offline storage unavailable"); } };
  try {
    clearEffectivePolicyCache();
    invalidateApiContext({ accountId: 1, profile: { id: 10 } });
    const expected = fixtures.cases.find((item) => item.name === "ordinary_default").effective;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => expected });
    const policy = await effectiveContentPolicy({ refresh: true });
    assert.equal(policy.revision, expected.revision);
  } finally {
    clearEffectivePolicyCache();
    globalThis.fetch = oldFetch;
    globalThis.location = oldLocation;
    globalThis.indexedDB = oldIndexedDB;
  }
});
