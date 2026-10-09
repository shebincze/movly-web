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
  let result = await request("register", { username: "testuser", email: "test@example.test", password: "synthetic-secret", user_id: 999, role: "admin" });
  assert.equal(result.status, 201);
  assert.equal(calls[0][0], "v1/auth/register");
  assert.match(calls[0][2].password, /^sha256:/);
  assert.equal(calls[0][2].role, undefined);
  assert.equal(calls[0][3], undefined);
  result = await request("password-reset/request", { email: "test@example.test" });
  assert.equal(result.status, 200);
  result = await request("password-reset/confirm", { email: "test@example.test", code: "123456", new_password: "new-secret" });
  assert.equal(result.status, 200);
  assert.match(calls.at(-1)[2].new_password, /^sha256:/);
  const count = calls.length;
  result = await request("password-reset/confirm", { email: "test@example.test", code: "123456", new_password: "123" });
  assert.equal(result.status, 400);
  assert.equal(calls.length, count);
  await assert.rejects(request("register", {}, "https://evil.test"), /aplikace Movly/);
});
