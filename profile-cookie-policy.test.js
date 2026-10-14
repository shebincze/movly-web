"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createAppHandler} = require("./app-server");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
test("late profile, provider and revocation responses never overwrite a newer session cookie", async () => {
  const user = {id: 1, username: "fixture", is_active: true, is_verified: true};
  const profiles = [1, 2, 3].map(id => ({id, name: `Profile ${id}`}));
  const selections = new Map();
  let providerGate, providerStarted, staleReadGate, staleReadStarted;
  const handle = createAppHandler({
    secret: "synthetic-cookie-regression-secret", production: false, HttpError,
    readBody: async req => req.body,
    json: (res, status, body) => { res.statusCode = status; res.body = body; },
    providerClient: {login: async () => { providerStarted.resolve(); await providerGate.promise; return {token: "fixture-provider", username: "fixture"}; }},
    api: async (path, method) => {
      if (path === "v1/auth/login") return {payload: {token: "fixture-token", user}};
      if (path === "v1/auth/me") return {payload: user};
      if (path === "v1/auth/logout") return {payload: {ok: true}};
      if (path === "v1/profiles") return {payload: profiles};
      if (path === "v1/watchlists?lang=cs") return {payload: []};
      const selection = /^v1\/profiles\/([123])\/select$/.exec(path);
      if (selection) {
        const id = Number(selection[1]), gate = selections.get(id);
        if (gate) { gate.started.resolve(); await gate.finish.promise; }
        return {payload: {profile_id: id, name: `Profile ${id}`, grant_token: `grant-${id}`}};
      }
      if (path.startsWith("v1/main/") && staleReadGate) {
        staleReadStarted.resolve(); await staleReadGate.promise;
        throw new HttpError(401, "Expired old response", {code: "invalid_or_expired_session"});
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  });
  async function request(cookie, target, body) {
    const res = {headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }};
    const req = {method: body === undefined ? "GET" : "POST", body,
      headers: {host: "localhost", origin: "http://localhost", "x-movly-app": "1", cookie}};
    await handle(req, res, new URL(`http://localhost/api/app/${target}`));
    return res;
  }
  const cookie = res => res.headers["set-cookie"]?.split(";")[0];
  const login = await request("", "login", {username: "fixture", password: "fixture"});
  const initial = await request(cookie(login), "profile", {id: 1});
  for (const id of [2, 3]) selections.set(id, {started: deferred(), finish: deferred()});
  const first = request(cookie(initial), "profile", {id: 2});
  const late = request(cookie(initial), "profile", {id: 3});
  await Promise.all([2, 3].map(id => selections.get(id).started.promise));
  selections.get(2).finish.resolve();
  const accepted = await first;
  assert.equal(accepted.statusCode, 200);
  selections.get(3).finish.resolve();
  const discarded = await late;
  assert.equal(discarded.statusCode, 409);
  assert.equal(discarded.headers["set-cookie"], undefined);
  assert.equal((await request(cookie(accepted), "session")).body.profile.id, 2);
  selections.clear();

  providerGate = deferred(); providerStarted = deferred();
  const provider = request(cookie(accepted), "providers/webshare", {username: "fixture", password: "fixture"});
  await providerStarted.promise;
  const changed = await request(cookie(accepted), "profile", {id: 3});
  providerGate.resolve();
  const providerResult = await provider;
  assert.equal(providerResult.statusCode, 409);
  assert.equal(providerResult.headers["set-cookie"], undefined);
  assert.equal((await request(cookie(changed), "session")).body.profile.id, 3);

  staleReadGate = deferred(); staleReadStarted = deferred();
  const staleRead = request(cookie(changed), "main?type=movie");
  await staleReadStarted.promise;
  const newest = await request(cookie(changed), "profile", {id: 1});
  staleReadGate.resolve();
  const staleError = await staleRead;
  assert.equal(staleError.statusCode, 401);
  assert.equal(staleError.headers["set-cookie"], undefined);
  assert.equal((await request(cookie(newest), "session")).body.profile.id, 1);

  providerGate = deferred(); providerStarted = deferred();
  const pendingProvider = request(cookie(newest), "providers/webshare", {username: "fixture", password: "fixture"});
  await providerStarted.promise;
  const logout = await request(cookie(newest), "logout", {});
  assert.equal(logout.statusCode, 200);
  providerGate.resolve();
  const afterLogout = await pendingProvider;
  assert.equal(afterLogout.statusCode, 409);
  assert.equal(afterLogout.headers["set-cookie"], undefined);
});
