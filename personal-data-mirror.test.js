const { test } = require("node:test");
const assert = require("node:assert/strict");
const deltaFixtures = require("./test-support/personal-delta-v1.fixtures.json");

const deviceId = "11111111-1111-4111-8111-111111111111";
const policyRevision = `ep1.${"a".repeat(64)}`;
const accountId = 7, profileId = 70;
const iso = "2026-10-15T12:00:00Z";
function context(overrides = {}) {
  return {
    user_id: accountId, profile_id: profileId, device_id: deviceId,
    environment: "api.fixture.movly.test", instance_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    policy_revision: policyRevision, catalog_epoch: "9007199254740993", ...overrides,
  };
}
function rating(id, score = 6) {
  return { id, title_id: 42, rating: score, is_public: false, created_at: iso, updated_at: iso };
}
function hidden(id, titleId = 42) {
  return { id, title_id: titleId, source: "continue_watching", hidden_at: iso };
}
function entity(type, id, version, operation, value) {
  return { entity_type: type, entity_id: id, version, operation, ...(operation === "upsert" ? { [type]: value } : {}) };
}
function page(entities, { mode = "snapshot", more = false, cursor = "changes-cursor", highwater = "4", contextValue = context() } = {}) {
  return {
    schema_version: 1, context: contextValue, mode, entities, has_more: more,
    next_cursor: cursor, highwater, profile_revision: "0", expires_at: "2026-11-14T12:00:00Z",
  };
}
function harness() {
  const records = new Map();
  const storage = {
    records,
    get: async (key) => structuredClone(records.get(key)),
    update: async (key, change) => {
      const value = change(structuredClone(records.get(key) || { partition: key }));
      if (value) records.set(key, structuredClone(value));
      return structuredClone(value || null);
    },
    pending: [{ mutation_id: "mutation-kept", base_revision: "19", value: { progress_seconds: 15 } }],
    conflicts: [{ conflict_id: 8 }],
  };
  let owner = { accountId, profileId }, contextKey = "account-7-profile-70-generation-1";
  const policy = { user_id: accountId, profile_id: profileId, revision: policyRevision };
  const options = {
    storage, getContextKey: () => contextKey, getOwner: () => owner,
    getOrigin: () => "https://web.fixture.movly.test", getPolicy: async () => policy, limit: 2,
  };
  return { storage, options, policy, setOwner(next) { owner = next; contextKey += "-changed"; } };
}

test("snapshot pages stage before atomically publishing the final mirror", async () => {
  const { syncPersonalDataMirror } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const request = async (path, options) => {
    assert.deepEqual(options.expectedOwner, { accountId, profileId });
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("snapshot") && !path.includes("cursor="))
      return page([entity("rating", 3, "9007199254740993", "upsert", rating(3))], { more: true, cursor: "opaque-snapshot-next", highwater: "9007199254740994" });
    if (path.includes("cursor=opaque-snapshot-next")) {
      const staged = [...h.storage.records.values()][0];
      assert.equal(staged.complete, false);
      assert.equal(staged.cursor, null);
      assert.equal(staged.staging.cursor, "opaque-snapshot-next");
      return page([entity("hidden_title", 4, "9007199254740994", "upsert", hidden(4))], { cursor: "opaque-completed-cursor", highwater: "9007199254740994" });
    }
    assert.fail(`unexpected request ${path}`);
  };
  assert.deepEqual(await syncPersonalDataMirror(request, h.options), { status: "complete", pages: 2 });
  const stored = [...h.storage.records.values()][0];
  assert.equal(stored.complete, true);
  assert.deepEqual(stored.identity, { origin: "https://web.fixture.movly.test", userId: accountId, deviceId, profileId });
  assert.equal(stored.cursor, "opaque-completed-cursor");
  assert.equal(stored.highwater, "9007199254740994");
  assert.equal(stored.context.catalog_epoch, "9007199254740993");
  assert.equal(stored.entities["rating:3"].version, "9007199254740993");
  assert.equal(stored.entities["hidden_title:4"].value.title_id, 42);
});

test("changes from another device refresh the title rating and hidden state without legacy reads", async () => {
  const { syncPersonalDataMirror, personalDataForTitle } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const request = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("profile-data/snapshot"))
      return page([entity("rating", 3, "8", "upsert", rating(3, 6))], { cursor: "cursor-8", highwater: "8" });
    if (path.includes("profile-data/changes"))
      return page([
        entity("rating", 3, "9007199254740993", "upsert", rating(3, 9.5)),
        entity("hidden_title", 4, "9007199254740994", "upsert", hidden(4)),
      ], { mode: "changes", cursor: "cursor-9007199254740994", highwater: "9007199254740994" });
    assert.fail(`legacy endpoint must not be called when the mirror is complete: ${path}`);
  };
  await syncPersonalDataMirror(request, h.options); const state = await personalDataForTitle(42, request, h.options);
  assert.deepEqual(state, { hidden: true, mine: { has_rated: true, rating: rating(3, 9.5) }, verified: true });
  const stored = [...h.storage.records.values()][0];
  assert.equal(stored.cursor, "cursor-9007199254740994");
  assert.equal(stored.entities["rating:3"].version, "9007199254740993");
  assert.deepEqual(h.storage.pending, [{ mutation_id: "mutation-kept", base_revision: "19", value: { progress_seconds: 15 } }]);
});

test("410 replaces only the mirror while preserving pending mutation and conflict records", async () => {
  const { syncPersonalDataMirror } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const first = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    return page([entity("rating", 3, "1", "upsert", rating(3))], { cursor: "old-cursor", highwater: "1" });
  };
  await syncPersonalDataMirror(first, h.options);
  const resetRequest = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("profile-data/changes"))
      throw Object.assign(new Error("reset"), { status: 410, body: { reset_required: true, preserve_pending_mutations: true } });
    if (path.includes("profile-data/snapshot")) {
      assert.equal(path.includes("cursor="), false);
      return page([entity("rating", 3, "2", "upsert", rating(3, 7))], { cursor: "new-cursor", highwater: "2" });
    }
    assert.fail(`unexpected ${path}`);
  };
  assert.deepEqual(await syncPersonalDataMirror(resetRequest, h.options), { status: "complete", pages: 1 });
  const stored = [...h.storage.records.values()][0];
  assert.equal(stored.cursor, "new-cursor");
  assert.equal(stored.entities["rating:3"].value.rating, 7);
  assert.deepEqual(h.storage.pending, [{ mutation_id: "mutation-kept", base_revision: "19", value: { progress_seconds: 15 } }]);
  assert.deepEqual(h.storage.conflicts, [{ conflict_id: 8 }]);
});

test("malformed counters and owner changes cannot advance or publish the mirror", async () => {
  const { syncPersonalDataMirror } = await import("./app/personal-data-mirror.js");
  const h = harness();
  let phase = "malformed";
  const request = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("snapshot")) return page([entity("rating", 3, "1", "upsert", rating(3))], { cursor: "cursor-1", highwater: "1" });
    if (path.includes("changes")) {
      const response = page([], { mode: "changes", cursor: "cursor-2", highwater: "2" });
      if (phase === "malformed") response.highwater = 9007199254740993;
      else h.setOwner({ accountId: 8, profileId: 80 });
      return response;
    }
    assert.fail(`unexpected ${path}`);
  };
  await syncPersonalDataMirror(request, h.options);
  const cursor = [...h.storage.records.values()][0].cursor;
  await assert.rejects(syncPersonalDataMirror(request, h.options), /malformed/);
  assert.equal([...h.storage.records.values()][0].cursor, cursor);
  phase = "owner";
  await assert.rejects(syncPersonalDataMirror(request, h.options), { name: "AbortError" });
  assert.equal([...h.storage.records.values()][0].cursor, cursor);
});

test("an unsupported delta endpoint leaves the existing legacy path available", async () => {
  const { syncPersonalDataMirror, personalDataForTitle } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const request = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    throw Object.assign(new Error("unsupported"), { status: 404 });
  };
  assert.deepEqual(await syncPersonalDataMirror(request, h.options), { status: "unsupported" });
  assert.equal(await personalDataForTitle(42, request, h.options), null);
  assert.equal([...h.storage.records.values()].every((record) => !record.complete), true);
});


test("typed known-route errors do not invalidate or reset the verified mirror", async () => {
  const { syncPersonalDataMirror, personalDataForTitle } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const good = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("profile-data/changes"))
      return page([], { mode: "changes", cursor: "known-cursor-2", highwater: "1" });
    return page([entity("rating", 3, "1", "upsert", rating(3))], { cursor: "known-cursor", highwater: "1" });
  };
  await syncPersonalDataMirror(good, h.options);
  const before = structuredClone([...h.storage.records.values()][0]);
  const unavailable = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    throw Object.assign(new Error("profile device is forbidden"), { status: 404, code: "sync_v2_device_unavailable" });
  };
  assert.equal(await personalDataForTitle(42, unavailable, h.options), null);
  assert.deepEqual([...h.storage.records.values()][0], before);
  const recovered = await syncPersonalDataMirror(good, h.options);
  assert.deepEqual(recovered, { status: "complete", pages: 1 });
});


test("canonical backend wire fixtures apply as exact snapshot and delta pages", async () => {
  const { syncPersonalDataMirror } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const first = deltaFixtures.valid_pages[0].page;
  const delta = structuredClone(deltaFixtures.valid_pages[1].page);
  // The backend fixtures are independent examples; a changes cursor is pinned
  // to the snapshot context, so align this example into one valid sequence.
  delta.context.catalog_epoch = first.context.catalog_epoch;
  h.options.getOwner = () => ({ accountId: first.context.user_id, profileId: first.context.profile_id });
  h.options.getPolicy = async () => ({
    user_id: first.context.user_id, profile_id: first.context.profile_id,
    revision: first.context.policy_revision,
  });
  let mode = "snapshot";
  const request = async (path) => {
    if (path === "sync/device") return { device_id: first.context.device_id };
    if (path.includes("profile-data/snapshot")) return first;
    if (path.includes("profile-data/changes")) { mode = "changes"; return delta; }
    assert.fail(`unexpected canonical fixture request in ${mode}: ${path}`);
  };
  assert.deepEqual(await syncPersonalDataMirror(request, h.options), { status: "complete", pages: 1 });
  assert.deepEqual(await syncPersonalDataMirror(request, h.options), { status: "complete", pages: 1 });
  const record = [...h.storage.records.values()][0];
  assert.equal(record.complete, true);
  assert.equal(record.entities["rating:3"].operation, "delete");
  assert.equal(record.entities["hidden_title:4"].operation, "delete");
  assert.equal(record.highwater, delta.highwater);
});

test("a staged partial snapshot is never returned as current personal data", async () => {
  const { syncPersonalDataMirror, personalDataForTitle } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const request = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    if (path.includes("profile-data/snapshot") && !path.includes("cursor="))
      return page([entity("rating", 3, "1", "upsert", rating(3))], { more: true, cursor: "snapshot-next", highwater: "1" });
    throw Object.assign(new Error("temporary failure"), { status: 503 });
  };
  await assert.rejects(syncPersonalDataMirror(request, h.options), { status: 503 });
  const stored = [...h.storage.records.values()][0];
  assert.equal(stored.complete, false);
  assert.equal(stored.entities["rating:3"], undefined);
  assert.equal(await personalDataForTitle(42, request, h.options), null);
});

test("a changes page cannot cross catalog epochs or advance the prior cursor", async () => {
  const { syncPersonalDataMirror } = await import("./app/personal-data-mirror.js");
  const h = harness();
  const initial = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    return page([entity("rating", 3, "1", "upsert", rating(3))], { cursor: "cursor-1", highwater: "1" });
  };
  await syncPersonalDataMirror(initial, h.options);
  const before = structuredClone([...h.storage.records.values()][0]);
  const changedEpoch = async (path) => {
    if (path === "sync/device") return { device_id: deviceId };
    const response = page([entity("rating", 3, "2", "upsert", rating(3, 9))], { mode: "changes", cursor: "cursor-2", highwater: "2" });
    response.context.catalog_epoch = "9007199254740994";
    return response;
  };
  await assert.rejects(syncPersonalDataMirror(changedEpoch, h.options), { name: "AbortError" });
  assert.deepEqual([...h.storage.records.values()][0], before);
  assert.deepEqual(h.storage.pending, [{ mutation_id: "mutation-kept", base_revision: "19", value: { progress_seconds: 15 } }]);
});
