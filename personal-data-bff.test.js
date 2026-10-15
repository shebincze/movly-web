"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAppHandler } = require("./app-server");

class HttpError extends Error {
  constructor(status, message, payload = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
}

function request(cookie, method, body) {
  return { method, headers: { host: "localhost", origin: "http://localhost", "x-movly-app": "1", ...(cookie ? { cookie } : {}) }, body };
}

async function setup(upstreamError) {
  const user = { id: 1, username: "fixture", is_active: true, is_verified: true, role: "user" };
  const handle = createAppHandler({
    secret: "synthetic-personal-data-bff-test-secret",
    production: false,
    HttpError,
    readBody: async (req) => req.body,
    json: (res, status, body) => { res.statusCode = status; res.body = body; },
    api: async (path) => {
      if (path === "v1/auth/login") return { payload: { token: "fixture-token", user } };
      if (path === "v1/auth/me") return { payload: user };
      if (path === "v1/profiles/7/select") return { payload: { profile_id: 7, name: "Fixture" } };
      if (path === "v1/profiles") return { payload: [{ id: 7, name: "Fixture" }] };
      if (path.startsWith("v1/sync/v2/profile-data/")) throw upstreamError;
      throw new Error(`unexpected upstream path ${path}`);
    },
  });
  const login = response();
  await handle(request(null, "POST", { username: "fixture", password: "secret" }), login, new URL("http://localhost/api/app/login"));
  const cookie = login.headers["set-cookie"].split(";")[0];
  const select = response();
  await handle(request(cookie, "POST", { id: 7 }), select, new URL("http://localhost/api/app/profile"));
  assert.equal(select.statusCode, 200);
  return { handle, cookie: select.headers["set-cookie"].split(";")[0] };
}

test("personal delta BFF preserves only a validated typed 410 reset envelope", async () => {
  for (const reason of ["expired", "retention", "policy_changed", "catalog_changed", "environment_changed"]) {
    const { handle, cookie } = await setup(new HttpError(410, "upstream internal detail", {
      code: "personal_delta_reset_required", reason, reset_required: true,
      preserve_pending_mutations: true, snapshot_path: "/sync/v2/profile-data/snapshot",
    }));
    const res = response();
    await handle(request(cookie, "GET"), res, new URL("http://localhost/api/app/sync/v2/profile-data/changes?device_id=11111111-1111-4111-8111-111111111111&cursor=opaque"));
    assert.equal(res.statusCode, 410);
    assert.deepEqual(res.body, {
      message: "Osobní data je potřeba znovu synchronizovat.",
      code: "personal_delta_reset_required", reason, reset_required: true,
      preserve_pending_mutations: true, snapshot_path: "/sync/v2/profile-data/snapshot",
    });
  }
});

test("personal delta BFF rejects malformed or unrelated 410 payloads without leaking them", async (t) => {
  const invalid = [
    new HttpError(410, "private upstream message", { code: "personal_delta_reset_required", reason: "environment_changed", reset_required: true, preserve_pending_mutations: false, snapshot_path: "/sync/v2/profile-data/snapshot", secret: "do-not-leak" }),
    new HttpError(410, "private upstream message", { code: "another_problem", reason: "environment_changed", reset_required: true, preserve_pending_mutations: true, snapshot_path: "/sync/v2/profile-data/snapshot", secret: "do-not-leak" }),
    new HttpError(409, "private upstream message", { code: "personal_delta_reset_required", reason: "environment_changed", reset_required: true, preserve_pending_mutations: true, snapshot_path: "/sync/v2/profile-data/snapshot", secret: "do-not-leak" }),
  ];
  for (const error of invalid) {
    await t.test(`${error.status} ${error.payload.code}`, async () => {
      const { handle, cookie } = await setup(error);
      const res = response();
      await handle(request(cookie, "GET"), res, new URL("http://localhost/api/app/sync/v2/profile-data/changes?device_id=11111111-1111-4111-8111-111111111111&cursor=opaque"));
      assert.equal(res.statusCode, error.status);
      assert.equal(res.body.code, error.status === 410 ? null : error.payload.code);
      assert.equal(res.body.reason, undefined);
      assert.equal(res.body.secret, undefined);
      assert.equal(res.body.secret, undefined);
      if (error.status === 410) assert.doesNotMatch(JSON.stringify(res.body), /private upstream message|do-not-leak/);
    });
  }
});
