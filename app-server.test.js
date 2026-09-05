"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAppHandler } = require("./app-server");

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function fakeResponse() {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
  };
  return res;
}
function json(res, status, payload) {
  res.statusCode = status;
  res.body = payload;
}

function makeHandler(role, calls) {
  const user = {
    username: "mod",
    display_name: "Mod",
    is_active: true,
    is_verified: true,
    role,
  };
  const listPayload = (source) => ({
    requests:
      source === "stream-deletion-requests"
        ? [
            {
              id: 5,
              stream_id: 500,
              status: "pending",
              reason: "Nefunkční odkaz",
              requested_by: 7,
              requester_name: "honza",
              created_at: "2026-09-01T10:00:00Z",
              updated_at: "2026-09-01T10:00:00Z",
              stream_title: "Shrek",
              stream_provider: "WebShare",
            },
          ]
        : [
            {
              id: 9,
              stream_id: 900,
              status: "pending",
              reason: null,
              requested_by: 8,
              created_at: "2026-09-03T10:00:00Z",
              updated_at: "2026-09-03T10:00:00Z",
              stream_title: "Dune",
              stream_provider: "HellSpy",
            },
          ],
    total: 1,
    page: 1,
    per_page: 50,
    total_pages: 1,
  });
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "v1/auth/login") return { payload: { token: "tok-1", user } };
    if (path === "v1/auth/me") return { payload: user };
    if (path.startsWith("v1/stream-deletion-requests2/?"))
      return { payload: listPayload("stream-deletion-requests2") };
    if (path.startsWith("v1/stream-deletion-requests/?"))
      return { payload: listPayload("stream-deletion-requests") };
    if (/review$/.test(path))
      return {
        payload: {
          id: 9,
          stream_id: 900,
          status: body.action === "approve" ? "approved" : "rejected",
          reason: null,
          requested_by: 8,
          created_at: "2026-09-03T10:00:00Z",
          updated_at: "2026-09-05T10:00:00Z",
          reviewer_name: "mod",
          review_comment: body.comment ?? null,
        },
      };
    if (/restore\//.test(path)) return { payload: { restored: true } };
    if (path === "v1/stream-reports/trusted-reporters" && method === "GET")
      return {
        payload: {
          reporters: [
            {
              user_id: 7,
              username: "honza",
              display_name: "Honza",
              granted_by: 1,
              granted_by_name: "mod",
              note: "ověřený",
              created_at: "2026-09-05T10:00:00Z",
            },
          ],
          total: 1,
        },
      };
    if (path === "v1/stream-reports/trusted-reporters" && method === "POST")
      return {
        payload: {
          user_id: 12,
          username: body.username,
          display_name: null,
          granted_by: 1,
          granted_by_name: "mod",
          note: body.note ?? null,
          created_at: "2026-09-05T11:00:00Z",
        },
      };
    if (/^v1\/stream-reports\/trusted-reporters\/\d+$/.test(path) && method === "DELETE")
      return { payload: null };
    throw new HttpError(404, `unexpected ${method} ${path}`);
  };
  return createAppHandler({
    api,
    json,
    readBody: async (req) => req.body,
    HttpError,
    secret: "test-secret-test-secret",
    production: false,
  });
}

async function login(handle) {
  const res = fakeResponse();
  const req = {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "x-movly-app": "1",
    },
    body: { username: "mod", password: "pw" },
  };
  await handle(req, res, new URL("http://localhost/api/app/login"));
  assert.equal(res.statusCode, 200);
  return res.headers["set-cookie"].split(";")[0];
}

function requestFor(cookie, method, target, body) {
  return {
    method,
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "x-movly-app": "1",
      cookie,
    },
    body,
  };
}

test("admin endpoints require a moderator or admin role", async () => {
  const calls = [];
  const handle = makeHandler("vip", calls);
  const cookie = await login(handle);
  const res = fakeResponse();
  await handle(
    requestFor(cookie, "GET", "admin/reports"),
    res,
    new URL("http://localhost/api/app/admin/reports"),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "app_moderator_required");
});

test("session exposes role and canModerate", async () => {
  const handle = makeHandler("moderator", []);
  const cookie = await login(handle);
  const res = fakeResponse();
  await handle(
    requestFor(cookie, "GET", "session"),
    res,
    new URL("http://localhost/api/app/session"),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account.role, "moderator");
  assert.equal(res.body.account.canModerate, true);
});

test("report list merges both tables, tags the source and sorts newest first", async () => {
  const calls = [];
  const handle = makeHandler("admin", calls);
  const cookie = await login(handle);
  const res = fakeResponse();
  await handle(
    requestFor(cookie, "GET", "admin/reports"),
    res,
    new URL("http://localhost/api/app/admin/reports?status=pending"),
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.requests.map((r) => [r.source, r.id, r.streamId]),
    [
      ["ai", 9, 900],
      ["human", 5, 500],
    ],
  );
  assert.deepEqual(res.body.totals, { human: 1, ai: 1 });
  assert.equal(res.body.requests[1].requesterName, "honza");
  assert.ok(
    calls.some(
      (c) =>
        c.path ===
        "v1/stream-deletion-requests/?page=1&per_page=50&status=pending",
    ),
  );
  assert.ok(
    calls.some(
      (c) =>
        c.path ===
        "v1/stream-deletion-requests2/?page=1&per_page=50&status=pending",
    ),
  );
});

test("review and restore target the table named in the URL and validate input", async () => {
  const calls = [];
  const handle = makeHandler("admin", calls);
  const cookie = await login(handle);
  let res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/reports/ai/9/review", {
      action: "approve",
      comment: "  nejde přehrát ",
    }),
    res,
    new URL("http://localhost/api/app/admin/reports/ai/9/review"),
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "approved");
  const review = calls.find((c) => /review$/.test(c.path));
  assert.equal(review.path, "v1/stream-deletion-requests2/9/review");
  assert.deepEqual(review.body, {
    action: "approve",
    comment: "nejde přehrát",
  });

  res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/reports/human/5/review", {
      action: "delete",
    }),
    res,
    new URL("http://localhost/api/app/admin/reports/human/5/review"),
  );
  assert.equal(res.statusCode, 400);

  res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/streams/human/500/restore", {
      reason: "",
    }),
    res,
    new URL("http://localhost/api/app/admin/streams/human/500/restore"),
  );
  assert.equal(res.statusCode, 400);

  res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/streams/human/500/restore", {
      reason: "funguje",
    }),
    res,
    new URL("http://localhost/api/app/admin/streams/human/500/restore"),
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(
    calls.find((c) => /restore\//.test(c.path)).path,
    "v1/stream-deletion-requests/restore/500",
  );
});

test("trusted reporters: list, add and remove go through the API", async () => {
  const calls = [];
  const handle = makeHandler("moderator", calls);
  const cookie = await login(handle);
  let res = fakeResponse();
  await handle(
    requestFor(cookie, "GET", "admin/trusted-reporters"),
    res,
    new URL("http://localhost/api/app/admin/trusted-reporters"),
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.reporters[0], {
    userId: 7,
    username: "honza",
    displayName: "Honza",
    grantedByName: "mod",
    note: "ověřený",
    createdAt: "2026-09-05T10:00:00Z",
  });

  res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/trusted-reporters", { username: "  " }),
    res,
    new URL("http://localhost/api/app/admin/trusted-reporters"),
  );
  assert.equal(res.statusCode, 400);

  res = fakeResponse();
  await handle(
    requestFor(cookie, "POST", "admin/trusted-reporters", {
      username: " pepa ",
      note: " známý ",
    }),
    res,
    new URL("http://localhost/api/app/admin/trusted-reporters"),
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.username, "pepa");
  assert.equal(res.body.userId, 12);
  const add = calls.find(
    (c) => c.path === "v1/stream-reports/trusted-reporters" && c.method === "POST",
  );
  assert.deepEqual(add.body, { username: "pepa", note: "známý" });

  res = fakeResponse();
  await handle(
    requestFor(cookie, "DELETE", "admin/trusted-reporters/7"),
    res,
    new URL("http://localhost/api/app/admin/trusted-reporters/7"),
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(
    calls.find((c) => c.method === "DELETE").path,
    "v1/stream-reports/trusted-reporters/7",
  );
});

test("trusted reporters are hidden from plain users", async () => {
  const handle = makeHandler("user", []);
  const cookie = await login(handle);
  const res = fakeResponse();
  await handle(
    requestFor(cookie, "GET", "admin/trusted-reporters"),
    res,
    new URL("http://localhost/api/app/admin/trusted-reporters"),
  );
  assert.equal(res.statusCode, 403);
});
