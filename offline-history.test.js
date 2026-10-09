const { test } = require("node:test");
const assert = require("node:assert/strict");
const { offlineSigner } = require("./offline-grant.js");
const managedRequest =
  (next) =>
  async (path, options = {}) => {
    assert.equal(options.expectedOwner.accountId, 7);
    assert.equal(options.expectedOwner.profileId, 70);
    return path === "sync/device"
      ? { device_id: "00000000-0000-0000-0000-000000000007" }
      : next(path, options);
  };
function fixture() {
  const sign = offlineSigner("test-owner-key"),
    now = Date.now();
  const receipt = sign.issue(
    {
      id: 7,
      is_active: true,
      is_verified: true,
      role: "user",
      premium_until: new Date(now + 86400000).toISOString(),
    },
    {
      id: 70,
      name: "test",
      is_kids: false,
      max_certification: 18,
      allow_unrated: true,
      has_pin: false,
    },
    { token: "fixture", device: crypto.randomUUID() },
  );
  let file = {
      id: "file",
      complete: true,
      receipt,
      identity: { titleId: 42, type: "tv", season: 1, episode: 2 },
      syncBase: {
        version: 3,
        value: {
          rating: 8,
          notes: "keep",
          is_favorite: true,
          provider_id: 2,
          ident: "source",
        },
      },
    },
    entry = null,
    active = receipt;
  const storage = {
    getFile: async () => structuredClone(file),
    active: async () => active,
    entries: async () => (entry ? [structuredClone(entry)] : []),
    update: async (id, change) => {
      const result = change(structuredClone(file), structuredClone(entry));
      if (!result) return;
      file = result.file || file;
      entry = result.entry || null;
      return structuredClone(result);
    },
  };
  return {
    storage,
    receipt,
    file: () => file,
    entry: () => entry,
    select: (value) => {
      active = value;
    },
  };
}
test("offline recording preserves exact episode identity and metadata in a durable full value", async () => {
  const { recordOfflineProgress, flushOfflineHistory } = await import(
    "./app/offline-history.js"
  );
  const f = fixture();
  await recordOfflineProgress("file", 99, 100, true, f.storage);
  assert.equal(f.file().watched, true);
  assert.equal(f.entry().draft.notes, "keep");
  let request;
  await flushOfflineHistory(
    managedRequest(async (path, { body }) => {
      request = body;
      assert.equal(path, "sync/v2/mutations");
      return {
        mutation_id: body.mutation_id,
        status: "applied",
        entity: { entity_key: body.entity_key, version: 4, value: body.value },
      };
    }),
    f.storage,
  );
  assert.equal(request.entity_key, "title:42:season:1:episode:2");
  assert.equal(request.device_id, "00000000-0000-0000-0000-000000000007");
  assert.equal(request.base_version, 3);
  assert.equal(request.value.watch_status, "completed");
  assert.equal(request.value.is_favorite, true);
  assert.equal(f.entry(), null);
  assert.equal(f.file().syncBase.version, 4);
});
test("ambiguous write retries the same mutation and never sends another profile's journal", async () => {
  const { recordOfflineProgress, flushOfflineHistory } = await import(
    "./app/offline-history.js"
  );
  const f = fixture();
  await recordOfflineProgress("file", 20, 100, false, f.storage);
  let calls = 0,
    original;
  const request = managedRequest(async (_, { body }) => {
    calls++;
    original ||= body;
    assert.deepEqual(body, original);
    if (calls === 1) throw new TypeError("response lost after commit");
    return {
      mutation_id: body.mutation_id,
      status: "applied",
      replayed: true,
      entity: { entity_key: body.entity_key, version: 4, value: body.value },
    };
  });
  await flushOfflineHistory(request, f.storage);
  assert.ok(f.entry().bound);
  f.select(
    offlineSigner("other-environment").issue(
      { id: 7, is_active: true, is_verified: true, role: "admin" },
      {
        id: 70,
        name: "test",
        is_kids: false,
        max_certification: 18,
        allow_unrated: true,
        has_pin: false,
      },
      { token: "other", device: "other" },
    ),
  );
  await flushOfflineHistory(request, f.storage);
  assert.equal(calls, 1);
  f.select(f.receipt);
  await flushOfflineHistory(request, f.storage);
  assert.equal(calls, 2);
  assert.equal(f.entry(), null);
});
test("conflict keeps local history durable until an explicit server resolution", async () => {
  const { recordOfflineProgress, flushOfflineHistory, resolveOfflineConflict } =
    await import("./app/offline-history.js");
  const f = fixture();
  await recordOfflineProgress("file", 30, 100, false, f.storage);
  await flushOfflineHistory(
    managedRequest(async (_, { body }) => {
      throw Object.assign(new Error("conflict"), {
        status: 409,
        body: {
          conflict: { id: 9, server_version: 5 },
          mutation_id: body.mutation_id,
        },
      });
    }),
    f.storage,
  );
  assert.equal(f.entry().conflict.id, 9);
  await recordOfflineProgress("file", 40, 100, false, f.storage);
  await resolveOfflineConflict(
    managedRequest(async (path, { body }) => {
      assert.equal(path, "sync/v2/conflicts/9/resolve");
      assert.equal(body.resolution, "server");
      return {
        mutation_id: body.mutation_id,
        status: "resolved_server",
        entity: {
          entity_key: "title:42:season:1:episode:2",
          version: 5,
          value: { progress_seconds: 90, watch_status: "watching" },
        },
      };
    }),
    "file",
    "server",
    f.storage,
  );
  assert.equal(f.entry(), null);
  assert.equal(f.file().position, 90);
});

test("a profile switch during device lookup never binds or sends the old journal", async () => {
  const { recordOfflineProgress, flushOfflineHistory } = await import(
    "./app/offline-history.js"
  );
  const f = fixture();
  await recordOfflineProgress("file", 20, 100, false, f.storage);
  let calls = 0;
  await flushOfflineHistory(async (path) => {
    calls++;
    assert.equal(path, "sync/device");
    f.select(
      offlineSigner("test-owner-key").issue(
        { id: 7, is_active: true, is_verified: true, role: "admin" },
        {
          id: 71,
          name: "other",
          is_kids: false,
          max_certification: 18,
          allow_unrated: true,
          has_pin: false,
        },
        { token: "other", device: "other" },
      ),
    );
    return { device_id: "00000000-0000-0000-0000-000000000007" };
  }, f.storage);
  assert.equal(calls, 1);
  assert.ok(f.entry().draft);
  assert.equal(f.entry().bound, undefined);
});
test("a rejected revoked device rebinds without discarding the original base or ambiguous progress", async () => {
  const { recordOfflineProgress, flushOfflineHistory } = await import(
    "./app/offline-history.js"
  );
  const f = fixture();
  await recordOfflineProgress("file", 20, 100, false, f.storage);
  const attempts = [];
  let deviceId = "00000000-0000-0000-0000-000000000007";
  const request = async (path, { body } = {}) => {
    if (path === "sync/device") return { device_id: deviceId };
    attempts.push(body);
    if (attempts.length === 1) throw new TypeError("ambiguous commit");
    if (attempts.length === 2)
      throw Object.assign(new Error("revoked"), {
        status: 403,
        code: "sync_v2_device_unavailable",
      });
    throw Object.assign(new Error("conflict"), {
      status: 409,
      body: { conflict: { id: 3, server_version: 4 } },
    });
  };
  await flushOfflineHistory(request, f.storage);
  deviceId = "00000000-0000-0000-0000-000000000008";
  await flushOfflineHistory(request, f.storage);
  await flushOfflineHistory(request, f.storage);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.notEqual(attempts[2].mutation_id, attempts[0].mutation_id);
  assert.equal(attempts[2].device_id, deviceId);
  assert.equal(attempts[2].base_version, 3);
  assert.deepEqual(attempts[2].value, attempts[0].value);
  assert.equal(f.entry().conflict.server_version, 4);
});
test("stale conflict resolution reloads the reviewed revision and requires a fresh explicit choice", async () => {
  const { recordOfflineProgress, flushOfflineHistory, resolveOfflineConflict } =
    await import("./app/offline-history.js");
  const f = fixture();
  await recordOfflineProgress("file", 30, 100, false, f.storage);
  await flushOfflineHistory(
    managedRequest(async (_, { body }) => {
      throw Object.assign(new Error("conflict"), {
        status: 409,
        body: {
          conflict: { id: 9, server_version: 5 },
          mutation_id: body.mutation_id,
        },
      });
    }),
    f.storage,
  );
  let firstID;
  const request = managedRequest(async (path, { body }) => {
    if (path.startsWith("sync/v2/snapshot/pages"))
      return {
        coverage: ["watch_history"],
        has_more: false,
        entities: [
          {
            entity_type: "watch_history",
            entity_key: "title:42:season:1:episode:2",
            version: 6,
            value: { progress_seconds: 80, watch_status: "watching" },
          },
        ],
      };
    if (!firstID) {
      firstID = body.mutation_id;
      throw Object.assign(new Error("changed again"), {
        status: 409,
        code: "sync_v2_conflict_stale",
      });
    }
    assert.notEqual(body.mutation_id, firstID);
    assert.equal(body.expected_server_version, 6);
    return {
      mutation_id: body.mutation_id,
      status: "resolved_server",
      entity: {
        entity_key: "title:42:season:1:episode:2",
        version: 6,
        value: { progress_seconds: 80, watch_status: "watching" },
      },
    };
  });
  await assert.rejects(
    resolveOfflineConflict(request, "file", "server", f.storage),
    /changed again/,
  );
  assert.equal(f.entry().conflict.server_version, 6);
  assert.equal(f.entry().resolution, null);
  await resolveOfflineConflict(request, "file", "server", f.storage);
  assert.equal(f.entry(), null);
  assert.equal(f.file().position, 80);
});
