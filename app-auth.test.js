const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAppHandler } = require("./app-server");
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
test("public account flows validate input and never forward browser authority or plaintext passwords", async () => {
  const calls = [];
  const handler = createAppHandler({ api: async (...args) => { calls.push(args); return { payload: { valid: true, ok: true } }; },
    json: (res, status, body) => Object.assign(res, { status, body }), readBody: async req => req.body,
    HttpError, secret: "synthetic-test-secret", production: false });
  async function request(path, body, origin = "http://localhost") {
    const res = { setHeader() {} };
    await handler({ method: "POST", body, headers: { host: "localhost", origin, "x-movly-app": "1" } }, res, new URL(`http://localhost/api/app/${path}`));
    return res;
  }
  // Registrace ve webové aplikaci není; brána ji nesmí přeposlat na API.
  let result = await request("register", { username: "testuser", email: "test@example.test", password: "synthetic-secret" });
  assert.equal(result.status, 401);
  assert.equal(calls.length, 0);
  result = await request("password-reset/request", { email: "test@example.test", role: "admin" });
  assert.equal(result.status, 200);
  assert.equal(calls[0][0], "v1/auth/password-reset/request");
  assert.equal(calls[0][2].role, undefined);
  assert.equal(calls[0][3], undefined);
  result = await request("password-reset/confirm", { email: "test@example.test", code: "123456", new_password: "new-secret" });
  assert.equal(result.status, 200);
  assert.match(calls.at(-1)[2].new_password, /^sha256:/);
  const count = calls.length;
  result = await request("password-reset/confirm", { email: "test@example.test", code: "123456", new_password: "123" });
  assert.equal(result.status, 400);
  assert.equal(calls.length, count);
  await assert.rejects(request("password-reset/request", {}, "https://evil.test"), /aplikace Movly/);
});
test("TV lite diagnostics are logged locally, bounded and never forwarded upstream", async () => {
  const calls = [], logs = [];
  const handler = createAppHandler({ api: async (...args) => { calls.push(args); return { payload: {} }; },
    json: (res, status, body) => Object.assign(res, { status, body }), readBody: async req => req.body,
    HttpError, secret: "synthetic-test-secret", production: false });
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    const res = { setHeader() {}, end() { this.ended = true; } };
    await handler({ method: "POST", body: { id: "abc123", events: [{ t: "keydown", s: 1.5, d: { k: 461 } }, { t: "BAD TYPE", s: 2, d: "x\ny" }, "nope"] },
      headers: { host: "localhost", origin: "http://localhost", "x-movly-app": "1" } }, res, new URL("http://localhost/api/app/tv-diagnostics"));
    assert.equal(res.statusCode, 204);
    assert.ok(res.ended);
  } finally { console.log = original; }
  assert.equal(calls.length, 0);
  assert.deepEqual(logs, ['[Movly TV] anon keydown {"at":1.5,"d":{"k":461}}']);
});
