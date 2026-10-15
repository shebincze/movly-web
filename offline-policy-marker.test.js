const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { offlineSigner } = require("./offline-grant");

function installIndexedDB() {
  const stores = new Map(["files", "chunks", "settings", "history", "downloads"].map(name => [name, new Map()]));
  let failSettingsWrites = false;
  globalThis.indexedDB = {
    open() {
      const request = {};
      setTimeout(() => {
        request.result = {
          objectStoreNames: { contains: name => stores.has(name) },
          close() {},
          transaction(names, mode) {
            const tx = { error: null };
            if (mode === "readwrite" && names === "settings" && failSettingsWrites) {
              tx.objectStore = () => ({
                get(key) { const request = {}; setTimeout(() => { request.result = stores.get("settings").get(key); request.onsuccess?.(); }, 0); return request; },
                put() { setTimeout(() => tx.onabort?.(), 0); return {}; },
              });
              return tx;
            }
            let pending = 0;
            const complete = () => setTimeout(() => { if (pending === 0) tx.oncomplete?.(); }, 0);
            tx.objectStore = name => ({
              get(key) {
                const result = {};
                pending++;
                setTimeout(() => { result.result = stores.get(name).get(key); pending--; result.onsuccess?.(); complete(); }, 0);
                return result;
              },
              put(value, key) {
                stores.get(name).set(key === undefined ? value.id : key, value);
                complete();
                return {};
              },
            });
            return tx;
          },
        };
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
  return { stores, setFailSettingsWrites(value) { failSettingsWrites = value; } };
}

const revision = (char) => `ep1.${char.repeat(64)}`;
const policy = (revisionValue, isKids = false) => ({
  schema_version: 1, user_id: 1, profile_id: 2, revision: revisionValue,
  is_kids: isKids, age_controls_active: isKids, max_age: isKids ? 7 : null,
  allow_unrated: !isKids, exclude_adult: isKids, catalog_excludes_adult: true,
});

test("known kids revision supersedes an old adult grant; ordinary first/equivalent snapshots do not", async () => {
  const { effectivePolicySupersedesGrant, mayRead } = await import("./app/offline-store.js");
  const now = Date.now(), signer = offlineSigner("synthetic-test-secret");
  const user = { id: 1, username: "test", role: "user", is_active: true, is_verified: true,
    premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const grant = signer.issue(user, profile, { token: "session", device: "browser" }, now);
  const signed = await (await import("./app/offline-store.js")).verifiedGrant(grant);

  assert.equal(effectivePolicySupersedesGrant(null, policy(revision("a")), signed), null);
  assert.equal(effectivePolicySupersedesGrant(policy(revision("a")), policy(revision("a")), signed), null);
  assert.deepEqual(
    effectivePolicySupersedesGrant(policy(revision("a")), policy(revision("b"), true), signed),
    { user_id: 1, profile_id: 2, previous_revision: revision("a"), current_revision: revision("b") },
  );
  assert.deepEqual(
    effectivePolicySupersedesGrant(null, policy(revision("b"), true), signed),
    { user_id: 1, profile_id: 2, previous_revision: null, current_revision: revision("b") },
  );

  const file = { complete: true, receipt: grant };
  assert.equal(await mayRead(file, { ...grant, effectivePolicy: policy(revision("a")) }), true);
  assert.equal(await mayRead(file, { ...grant, effectivePolicy: policy(revision("b"), true),
    supersededPolicy: { user_id: 1, profile_id: 2, previous_revision: revision("a"), current_revision: revision("b") } }), false);
});

test("a fresh unrestricted matching grant has no superseded marker and remains readable", async () => {
  const { mayRead } = await import("./app/offline-store.js");
  const now = Date.now(), signer = offlineSigner("synthetic-test-secret");
  const user = { id: 1, username: "test", role: "user", is_active: true, is_verified: true,
    premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const prior = signer.issue(user, profile, { token: "old", device: "browser" }, now - 1000);
  const fresh = signer.issue(user, profile, { token: "new", device: "browser" }, now);
  assert.equal(await mayRead({ complete: true, receipt: prior }, { ...fresh,
    effectivePolicy: policy(revision("c")) }), true);
});

test("policy marker persists beside the signed grant across reads and a matching fresh grant clears it", async () => {
  const { stores } = installIndexedDB();
  const { get, put, observeEffectivePolicy, storeFreshOfflineGrant, mayRead, hasSupersededPolicyMarker } = await import("./app/offline-store.js");
  const now = Date.now(), signer = offlineSigner("synthetic-test-secret");
  const user = { id: 1, username: "test", role: "user", is_active: true, is_verified: true,
    premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const oldPolicy = policy(revision("d")), kidsPolicy = policy(revision("e"), true);
  const receipt = signer.issue(user, profile, { token: "session", device: "browser" }, now);
  const originalSignedBytes = JSON.stringify(receipt);
  await storeFreshOfflineGrant(receipt, oldPolicy);
  await observeEffectivePolicy(oldPolicy);
  const history = { id: "pending", state: "unsent" };
  await put("history", history);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  stores.get("files").set(id, { id, complete: true, size: 1, receipt });
  assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 200);

  await observeEffectivePolicy(kidsPolicy);
  let active = await get("settings", "active");
  assert.equal(JSON.stringify({ payload: active.payload, signature: active.signature, publicKey: active.publicKey }), originalSignedBytes);
  assert.equal(active.supersededPolicy.current_revision, kidsPolicy.revision);
  assert.equal(await hasSupersededPolicyMarker(active), true);
  assert.equal(await mayRead({ complete: true, receipt }, active), false);
  // Re-evaluate a fresh worker instance against the same persisted IndexedDB
  // stores, matching the browser restart path.
  assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 403);
  assert.deepEqual(stores.get("history").get("pending"), history);

  // A new, verified unrestricted receipt matching a validated current policy
  // renews the existing owner record and clears only its local marker.
  const renewed = signer.issue(user, profile, { token: "renewed", device: "browser" }, Date.now());
  await storeFreshOfflineGrant(renewed, oldPolicy);
  active = await get("settings", "active");
  assert.equal(active.supersededPolicy, undefined);
  assert.equal(await hasSupersededPolicyMarker(active), false);
  assert.equal(await mayRead({ complete: true, receipt }, active), true);
  assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 200);
  assert.deepEqual(stores.get("history").get("pending"), history);

  // A pre-feature signed adult grant has no persisted tuple. First ordinary
  // adult snapshot is equivalent; first kids snapshot is incompatible by the
  // BFF issuer's adult-only grant contract.
  await put("settings", receipt, "active");
  await observeEffectivePolicy(oldPolicy);
  assert.equal(await mayRead({ complete: true, receipt }, await get("settings", "active")), true);
  await observeEffectivePolicy(kidsPolicy);
  active = await get("settings", "active");
  assert.equal(active.supersededPolicy.previous_revision, oldPolicy.revision);
  assert.equal(await mayRead({ complete: true, receipt }, active), false);
  assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 403);

  await put("settings", receipt, "active");
  await observeEffectivePolicy(kidsPolicy);
  active = await get("settings", "active");
  assert.equal(active.supersededPolicy.previous_revision, null);
  assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 403);
});

test("a read-only IndexedDB failure uses a receipt-bound CacheStorage marker that survives worker restart", async () => {
  const oldIndexedDB = globalThis.indexedDB, oldCaches = globalThis.caches, oldSelf = globalThis.self;
  const fixture = installIndexedDB(), { stores } = fixture;
  const cacheEntries = new Map(), cache = {
    async put(request, response) { cacheEntries.set(request.url, response.clone()); },
    async match(request) { return cacheEntries.get(request.url)?.clone(); },
    async delete(request) { return cacheEntries.delete(request.url); },
  };
  globalThis.caches = { async open() { return cache; } };
  globalThis.self = { location: { origin: "https://fixture.invalid" } };
  try {
    const { put, observeEffectivePolicy, storeFreshOfflineGrant, mayRead, denyOfflineGrant } = await import("./app/offline-store.js");
    const now = Date.now(), signer = offlineSigner("synthetic-test-secret");
    const user = { id: 1, username: "test", role: "user", is_active: true, is_verified: true,
      premium_until: new Date(now + 86400000).toISOString() };
    const profile = { id: 2, name: "Adult", is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
    const receipt = signer.issue(user, profile, { token: "read-only", device: "browser" }, now);
    await storeFreshOfflineGrant(receipt, policy(revision("f")));
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", file = { id, complete: true, size: 1, receipt };
    stores.get("files").set(id, file);
    const pendingHistory = { id: "pending", state: "unsent", position_ms: 321 };
    stores.get("history").set(pendingHistory.id, pendingHistory);
    fixture.setFailSettingsWrites(true);
    await observeEffectivePolicy(policy(revision("1"), true));
    const active = stores.get("settings").get("active");
    assert.equal(active.supersededPolicy, undefined, "the IndexedDB write is intentionally unavailable");
    assert.equal(await mayRead(file, active), false, "CacheStorage fallback closes the current read gate");
    assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 403,
      "a fresh service-worker instance reads the persisted marker fallback");
    assert.equal(stores.get("settings").get("active").payload, receipt.payload,
      "the original signed receipt remains available for proof/recovery");
    assert.deepEqual(stores.get("history").get("pending"), pendingHistory,
      "pending history remains unchanged");

    fixture.setFailSettingsWrites(false);
    const renewed = signer.issue(user, profile, { token: "renewed", device: "browser" }, Date.now());
    await storeFreshOfflineGrant(renewed, policy(revision("2")));
    assert.equal(await mayRead(file, stores.get("settings").get("active")), true,
      "a newly verified matching unrestricted grant remains readable");
    fixture.setFailSettingsWrites(true);
    assert.equal(await denyOfflineGrant(renewed), true, "an authoritative denial persists a receipt-bound fallback if IndexedDB cannot clear it");
    assert.equal(await mayRead(file, stores.get("settings").get("active")), false,
      "a valid signed grant is not restored by bypassing an authoritative 403");
    assert.equal(await serviceWorkerMediaStatus(stores, id, mayRead), 403,
      "the denial fallback remains enforced by a fresh worker instance");
  } finally {
    globalThis.indexedDB = oldIndexedDB;
    globalThis.caches = oldCaches;
    globalThis.self = oldSelf;
  }
});

test("clearing a denied grant is owner-conditional and preserves pending history", async () => {
  const { stores } = installIndexedDB();
  const { put, clearActiveGrantIfMatches } = await import("./app/offline-store.js");
  const old = { payload: "old-payload", signature: "old-signature" }, current = { payload: "new-payload", signature: "new-signature" };
  const pending = { id: "pending-denial", state: "unsent", position_ms: 45 };
  await put("settings", current, "active");
  await put("history", pending);
  assert.equal(await clearActiveGrantIfMatches(old), false, "a stale denial cannot clear the newer owner's grant");
  assert.deepEqual(await (await import("./app/offline-store.js")).get("settings", "active"), current);
  assert.equal(await clearActiveGrantIfMatches(current), true, "the matching denied grant is removed");
  assert.equal(await (await import("./app/offline-store.js")).get("settings", "active"), null);
  assert.deepEqual(stores.get("history").get(pending.id), pending, "the outbox entry is untouched");
});

async function serviceWorkerMediaStatus(stores, id, mayRead) {
  const source = fs.readFileSync(require.resolve("./app/offline-sw.js"), "utf8").replace(/^import .*;\n/, "");
  const handlers = new Map(), self = { location: { origin: "https://fixture.invalid" },
    addEventListener: (name, handler) => handlers.set(name, handler) };
  vm.runInNewContext(source, {
    self, URL, Set, Response, Request, ReadableStream,
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => null },
    fetch: async () => new Response(null, { status: 404 }),
    get: async (store, key) => stores.get(store).get(key), mayRead, CHUNK_BYTES: 512 * 1024,
    OFFLINE_CACHE_NAME: "movly-offline-shell-v23-offline-policy-marker",
  });
  let response;
  handlers.get("fetch")({ request: new Request(`https://fixture.invalid/app/offline-media/${id}.mp4`),
    respondWith: value => { response = value; } });
  return (await response).status;
}
