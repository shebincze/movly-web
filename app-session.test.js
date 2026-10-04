"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createAppHandler } = require("./app-server");
const { createFixture } = require("./test-support/app-fixture.cjs");
class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}
function harness({
  production = false,
  override,
  providerClient,
  playbackEngine,
} = {}) {
  const calls = [];
  const fixture = createFixture();
  const handler = createAppHandler({
    production,
    providerClient,
    playbackEngine,
    secret: "test-secret-for-isolated-app-only",
    HttpError,
    json: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
    readBody: async (req) => req.body,
    api: async (...args) => {
      calls.push(args);
      const result = override?.(...args);
      return result === undefined ? fixture(...args) : result;
    },
  });
  async function request(
    path,
    {
      method = "GET",
      body,
      cookie,
      origin = production ? "https://movly.test" : "http://movly.test",
      headers = {},
    } = {},
  ) {
    const req = Readable.from([]);
    req.method = method;
    req.body = body;
    req.headers = {
      host: "movly.test",
      origin,
      "x-movly-app": "1",
      ...(cookie ? { cookie } : {}),
      ...headers,
    };
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
    };
    try {
      await handler(req, res, new URL(`http://movly.test/api/app/${path}`));
    } catch (e) {
      res.status = e.status;
      res.body = { message: e.message };
    }
    return { ...res, cookie: res.headers["Set-Cookie"]?.split(";")[0] };
  }
  async function login() {
    return request("login", {
      method: "POST",
      body: { username: "test", password: "movly-test" },
    });
  }
  async function selected() {
    const l = await login();
    return request("profile", {
      method: "POST",
      cookie: l.cookie,
      body: { id: 1 },
    });
  }
  return { request, login, selected, calls };
}
test("anonymous catalog never calls API-key-readable upstream", async () => {
  const h = harness(),
    r = await h.request("main");
  assert.equal(r.status, 401);
  assert.equal(h.calls.length, 0);
});
test("login keeps bearer encrypted in HttpOnly cookie with production flags", async () => {
  const h = harness({ production: true }),
    r = await h.login();
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes("fixture-token"));
  assert.match(r.headers["Set-Cookie"], /^__Host-movly-app=/);
  assert.match(
    r.headers["Set-Cookie"],
    /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/,
  );
  assert.ok(!r.cookie.includes("fixture-token"));
  assert.equal(h.calls[0][5]["X-Platform"], "web");
  assert.equal(h.calls[0][2].device_type, "web");
});
test("cross-origin login and mutation rejected before upstream", async () => {
  const h = harness();
  const r = await h.request("login", {
    method: "POST",
    origin: "https://evil.test",
    body: { username: "test", password: "movly-test" },
  });
  assert.equal(r.status, 403);
  assert.equal(h.calls.length, 0);
});
test("tampered encrypted cookie rejected", async () => {
  const h = harness(),
    l = await h.login();
  const r = await h.request("main", {
    cookie: l.cookie.replace(/=(.)/, (_, c) => `=${c === "A" ? "B" : "A"}`),
  });
  assert.equal(r.status, 401);
});
test("profile selection supplies explicit identity and ignores client overrides", async () => {
  const h = harness(),
    s = await h.selected();
  assert.equal(s.status, 200);
  const r = await h.request("main?type=movie&limit=12", {
    cookie: s.cookie,
    headers: { "x-profile-id": "999", "x-profile-grant": "evil" },
  });
  assert.equal(r.status, 200);
  const c = h.calls.at(-1);
  assert.equal(
    c[0],
    "v1/main/?type=movie&limit=12&lang=cs&expand=watch_history,streams,ratings",
  );
  assert.equal(c[5]["X-Profile-ID"], "1");
  assert.equal(c[5]["X-Profile-Grant"], "grant-1");
});
test("session without selected profile cannot read catalog", async () => {
  const h = harness(),
    l = await h.login(),
    r = await h.request("search?q=test", { cookie: l.cookie });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "app_profile_required");
});
test("wrong PIN preserves login; valid PIN obtains selected grant", async () => {
  const h = harness(),
    l = await h.login();
  const bad = await h.request("profile", {
    method: "POST",
    cookie: l.cookie,
    body: { id: 2, pin: "0000" },
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.cookie, undefined);
  const good = await h.request("profile", {
    method: "POST",
    cookie: l.cookie,
    body: { id: 2, pin: "1234" },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.profile.id, 2);
  assert.ok(!JSON.stringify(good.body).includes("grant"));
});
test("session revocation blocks catalog and clears cookie", async () => {
  const h = harness(),
    s = await h.selected();
  await h.request("logout", { method: "POST", cookie: s.cookie });
  const r = await h.request("main", { cookie: s.cookie });
  assert.equal(r.status, 401);
  assert.match(r.headers["Set-Cookie"], /Max-Age=0/);
});
test("closed routes reject arbitrary proxies, filters and mutation paths", async () => {
  const h = harness(),
    s = await h.selected();
  for (const path of [
    "streaming/arbitrary-url",
    "titles/1?expand=streams",
    "main?type=movie&type=tv",
    "main?limit=99999",
  ]) {
    const r = await h.request(path, { cookie: s.cookie });
    assert.ok([400, 404].includes(r.status));
  }
  assert.ok(!h.calls.some((c) => c[0].includes("streaming/")));
});
test("watchlist changes use canonical upstream and strip extra fields", async () => {
  const h = harness(),
    s = await h.selected();
  const created = await h.request("watchlists", {
    method: "POST",
    cookie: s.cookie,
    body: { name: " Nový ", is_public: true, user_id: 999 },
  });
  assert.equal(created.status, 200);
  assert.deepEqual(h.calls.at(-1)[2], {
    name: "Nový",
    description: null,
    is_public: false,
  });
  const id = created.body.id;
  await h.request(`watchlists/${id}/items`, {
    method: "POST",
    cookie: s.cookie,
    body: { title_id: 1 },
  });
  const items = await h.request(`watchlists/${id}`, { cookie: s.cookie });
  assert.equal(items.body[0].title_id, 1);
  const dup = await h.request(`watchlists/${id}/items`, {
    method: "POST",
    cookie: s.cookie,
    body: { title_id: 1 },
  });
  assert.equal(dup.status, 409);
  await h.request(`watchlists/${id}/items/${items.body[0].id}`, {
    method: "DELETE",
    cookie: s.cookie,
  });
  assert.deepEqual(
    (await h.request(`watchlists/${id}`, { cookie: s.cookie })).body,
    [],
  );
});
test("partial upstream results remain explicitly degraded", async () => {
  const payload = {
    lists: [],
    total_lists: 0,
    degraded: true,
    degraded_sources: ["recommendations"],
  };
  const h = harness({
      override: (p) => (p.startsWith("v1/main/") ? { payload } : undefined),
    }),
    s = await h.selected();
  assert.deepEqual(
    (await h.request("main", { cookie: s.cookie })).body,
    payload,
  );
});
test("missing profile grant fails closed", async () => {
  const h = harness({
      override: (p) =>
        p.endsWith("/select")
          ? { payload: { profile_id: 1, name: "Test" } }
          : undefined,
    }),
    l = await h.login();
  const r = await h.request("profile", {
    method: "POST",
    cookie: l.cookie,
    body: { id: 1 },
  });
  assert.equal(r.status, 502);
  assert.equal(r.cookie, undefined);
});
test("expired grant cannot block logout or profile re-selection", async () => {
  const h = harness(),
    s = await h.selected();
  await h.request("profiles", { cookie: s.cookie });
  const identities = h.calls.filter((c) =>
    ["v1/auth/me", "v1/profiles"].includes(c[0]),
  );
  assert.ok(identities.every((c) => !c[5]["X-Profile-Grant"]));
  await h.request("logout", { method: "POST", cookie: s.cookie });
  assert.equal(h.calls.at(-1)[5]["X-Profile-Grant"], undefined);
});
test("malformed JSON body returns 400 instead of internal error", async () => {
  const h = harness();
  for (const body of [null, [], 4])
    assert.equal(
      (await h.request("login", { method: "POST", body })).status,
      400,
    );
});
test("selected and restored profile exposes canonical avatar", async () => {
  const h = harness(),
    s = await h.selected();
  assert.match(s.body.profile.avatar_url, /res.cloudinary.com\/dsnzqq6kh/);
  const restored = await h.request("session", { cookie: s.cookie });
  assert.equal(restored.body.profile.avatar_url, s.body.profile.avatar_url);
});
test("profile edits only accept avatars returned by the API", async () => {
  const h = harness(),
    s = await h.selected();
  const r = await h.request("profiles/1", {
    method: "PUT",
    cookie: s.cookie,
    body: { name: "Test", avatar_url: "https://evil.test/tracker.png" },
  });
  assert.equal(r.status, 400);
  assert.ok(!h.calls.some((c) => c[0] === "v1/profiles/1" && c[1] === "PUT"));
});
test("overview retains canonical envelope and bounded previews", async () => {
  const h = harness(),
    s = await h.selected();
  const r = await h.request("watchlists/overview?preview_limit=12", {
    cookie: s.cookie,
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.watchlists));
  assert.equal(
    (
      await h.request("watchlists/overview?preview_limit=100", {
        cookie: s.cookie,
      })
    ).status,
    400,
  );
});
test("playback and provider access revalidate profile grant", async () => {
  let revoked = false;
  const h = harness({
      override: (path) => {
        if (revoked && path === "v1/watchlists?lang=cs")
          throw new HttpError(403, "Grant revoked", {
            code: "profile_access_grant_revoked",
          });
      },
    }),
    s = await h.selected();
  revoked = true;
  for (const path of [
    "providers/webshare",
    "download/" + "a".repeat(48),
    "playback/" + "a".repeat(48) + "/status",
  ])
    assert.equal((await h.request(path, { cookie: s.cookie })).status, 403);
});
test("rating request preserves privacy and rejects invalid values", async () => {
  const h = harness({
      override: (path) =>
        path.startsWith("v1/ratings/?") ? { payload: { id: 9 } } : undefined,
    }),
    s = await h.selected();
  const r = await h.request("ratings?title_id=1", {
    method: "POST",
    cookie: s.cookie,
    body: { rating: 8.5, is_public: false, user_id: 999 },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.at(-1)[2], { rating: 8.5, is_public: false });
  assert.equal(
    (
      await h.request("ratings?title_id=1", {
        method: "POST",
        cookie: s.cookie,
        body: { rating: 11 },
      })
    ).status,
    400,
  );
});

test("native Home, detail and filmography use canonical expanded endpoints", async () => {
  const h = harness(),
    s = await h.selected();
  for (const path of [
    "themed-lists",
    "themed-lists/top-home?limit=10",
    "titles/1",
    "titles/1/similar?limit=18",
    "people/50",
    "people/50/filmography",
  ]) {
    const r = await h.request(path, { cookie: s.cookie });
    assert.equal(r.status, 200, path);
  }
  assert.ok(
    h.calls.some(
      (c) =>
        c[0].includes("themed-lists/top-home") &&
        c[0].includes("include_inactive=true"),
    ),
  );
  assert.ok(
    h.calls.some(
      (c) => c[0].includes("titles/1?") && c[0].includes("collection,videos"),
    ),
  );
});
test("live sources require profile, isolate signed selection and reject foreign episodes", async () => {
  const played = [];
  const h = harness({
      providerClient: {
        searchFiles: async () => [
          {
            provider_name: "Hellspy",
            source_stream_id: "42/hash",
            file_name: "Duna Cast druha 2024 1080p.mkv",
            available: true,
          },
        ],
      },
      playbackEngine: {
        start: async (s, url) => {
          played.push(url);
          return { id: "test" };
        },
      },
    }),
    s = await h.selected();
  assert.equal((await h.request("sources/1/hellspy")).status, 401);
  assert.equal(
    (await h.request("sources/20/hellspy?episode_id=999", { cookie: s.cookie }))
      .status,
    404,
  );
  const unconnected = await h.request("sources/1/webshare", {
    cookie: s.cookie,
  });
  assert.equal(unconnected.body.state, "not_connected");
  const found = await h.request("sources/1/hellspy", { cookie: s.cookie });
  assert.equal(found.status, 200);
  assert.equal(found.body.streams.length, 1);
  const ticket = found.body.streams[0].ticket;
  const other = await h.selected();
  assert.equal(
    (
      await h.request("playback", {
        method: "POST",
        cookie: other.cookie,
        body: { source: "live", title_id: 1, ticket },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.request("playback", {
        method: "POST",
        cookie: s.cookie,
        body: { source: "live", title_id: 2, ticket },
      })
    ).status,
    403,
  );
  const ok = await h.request("playback", {
    method: "POST",
    cookie: s.cookie,
    body: { source: "live", title_id: 1, ticket },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(played, [
    "https://api.hellspy.to/gw/video/42/hash/download",
  ]);
});

test("stream download resolves the selected source without transcoding and binds link to its session", async () => {
  let transcodes = 0;
  const h = harness({ providerClient: { searchFiles: async () => [{provider_name:"Hellspy", source_stream_id:"42/hash", file_name:"Duna Cast druha 2024.mkv", available:true}] }, playbackEngine: { start: async () => { transcodes++; return {}; } } });
  const selected = await h.selected();
  const found = await h.request("sources/1/hellspy", {cookie:selected.cookie});
  const result = await h.request("download", {method:"POST",cookie:selected.cookie,body:{source:"live",title_id:1,ticket:found.body.streams[0].ticket}});
  assert.equal(result.status,200);
  assert.match(result.body.url,/^\/api\/app\/download\/[a-f0-9]{48}$/);
  assert.equal(transcodes,0);
  assert.equal((await h.request(result.body.url.replace("/api/app/",""))).status,401);
  const other = await h.selected();
  assert.equal((await h.request(result.body.url.replace("/api/app/",""),{cookie:other.cookie})).status,404);
  assert.equal((await h.request("download",{method:"POST",cookie:other.cookie,body:{source:"live",title_id:1,ticket:found.body.streams[0].ticket}})).status,403);
});
test("party preparation forwards only through an authenticated profile session", async () => {
  const h = harness({override: path => path.startsWith("v1/party/") ? {party_id:"a".repeat(32),version:1} : undefined});
  const path = "party/"+"a".repeat(32)+"/preparation";
  assert.equal((await h.request(path,{method:"POST",body:{action:"ready"}})).status,401);
  const selected=await h.selected();
  assert.equal((await h.request(path,{method:"POST",cookie:selected.cookie,body:{action:"ready",device_id:"00000000-0000-0000-0000-000000000001",ready:true,is_host:false}})).status,200);
  const forwarded=h.calls.find(call=>call[0].startsWith("v1/"+path));
  assert.equal(forwarded[1],"POST");
  assert.equal(forwarded[2].ready,true);
});
