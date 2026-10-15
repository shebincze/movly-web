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
  nativeResolver,
  partyStream,
} = {}) {
  const calls = [];
  const fixture = createFixture();
  const handler = createAppHandler({
    production,
    providerClient,
    playbackEngine,
    nativeResolver,
    partyStream,
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
      res.body = { message: e.message, ...e.payload };
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

test("catalog batch BFF forwards only the bounded route body and selected UI language", async () => {
  const h = harness(), selected = await h.selected();
  h.calls.length = 0;
  const identities = [{type:"movie",tmdb_id:7},{type:"tv",tmdb_id:7}];
  const response = await h.request("titles/batch", {method:"POST", cookie:selected.cookie,
    headers:{"x-movly-language":"en"}, body:{items:identities,language:"cs",extra:"discard"}});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.results.map(x=>x.type), ["movie","tv"]);
  const call = h.calls.at(-1);
  assert.equal(call[0], "v1/titles/batch");
  assert.equal(call[1], "POST");
  assert.deepEqual(call[2], {items:identities,language:"en"});
  assert.equal(call[5]["X-Profile-ID"], "1");
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
test("session revocation clears cookie once and stale requests cannot overwrite a later login", async () => {
  const h = harness(),
    s = await h.selected();
  const logout = await h.request("logout", { method: "POST", cookie: s.cookie });
  assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
  const r = await h.request("main", { cookie: s.cookie });
  assert.equal(r.status, 401);
  assert.equal(r.headers["Set-Cookie"], undefined);
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
test("malformed profile management grant fails closed", async () => {
  const h = harness({
      override: (p) =>
        p.endsWith("/select")
          ? { payload: { profile_id: 1, name: "Test", grant_token: 123 } }
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
  const h = harness({
    providerClient: {
      searchFiles: async () => [
        {
          provider_name: "Hellspy",
          source_stream_id: "42/hash",
          file_name: "Duna Cast druha 2024.mkv",
          available: true,
        },
      ],
    },
    playbackEngine: {
      start: async () => {
        transcodes++;
        return {};
      },
    },
  });
  const selected = await h.selected();
  const found = await h.request("sources/1/hellspy", {
    cookie: selected.cookie,
  });
  const result = await h.request("download", {
    method: "POST",
    cookie: selected.cookie,
    body: { source: "live", title_id: 1, ticket: found.body.streams[0].ticket },
  });
  assert.equal(result.status, 200);
  assert.match(result.body.url, /^\/api\/app\/download\/[a-f0-9]{48}$/);
  assert.equal(transcodes, 0);
  assert.equal(
    (await h.request(result.body.url.replace("/api/app/", ""))).status,
    401,
  );
  const other = await h.selected();
  assert.equal(
    (
      await h.request(result.body.url.replace("/api/app/", ""), {
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.request("download", {
        method: "POST",
        cookie: other.cookie,
        body: {
          source: "live",
          title_id: 1,
          ticket: found.body.streams[0].ticket,
        },
      })
    ).status,
    403,
  );
});
test("party preparation forwards only through an authenticated profile session", async () => {
  const h = harness({
    override: (path) =>
      path.startsWith("v1/party/")
        ? { party_id: "a".repeat(32), version: 1 }
        : undefined,
  });
  const path = "party/" + "a".repeat(32) + "/preparation";
  assert.equal(
    (await h.request(path, { method: "POST", body: { action: "ready" } }))
      .status,
    401,
  );
  const selected = await h.selected();
  assert.equal(
    (
      await h.request(path, {
        method: "POST",
        cookie: selected.cookie,
        body: {
          action: "ready",
          device_id: "00000000-0000-0000-0000-000000000001",
          ready: true,
          is_host: false,
        },
      })
    ).status,
    200,
  );
  const forwarded = h.calls.find((call) => call[0].startsWith("v1/" + path));
  assert.equal(forwarded[1], "POST");
  assert.equal(forwarded[2].ready, true);
});
test("v2 party readiness preserves optional round zero and rejects lossy or malformed rounds", async () => {
  const h = harness({ override: path => path.startsWith("v1/party/") ? { payload: { party_id: "a".repeat(32), version: 1 } } : undefined });
  const selected = await h.selected(), path = `party/v2/${"a".repeat(32)}/preparation`;
  const base = { action: "ready", device_id: "00000000-0000-0000-0000-000000000001", ready: false, is_host: false };
  for (const round of [undefined, null, 0, 7, Number.MAX_SAFE_INTEGER]) {
    const response = await h.request(path, { method: "POST", cookie: selected.cookie, body: { ...base, ...(round === undefined ? {} : { expected_round: round }) } });
    assert.equal(response.status, 200);
    assert.equal(h.calls.at(-1)[2].expected_round, round);
    assert.equal(Object.hasOwn(h.calls.at(-1)[2], "expected_round"), round !== undefined);
  }
  for (const round of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await h.request(path, { method: "POST", cookie: selected.cookie, body: { ...base, expected_round: round } })).status, 400);
  }
});

test("party capabilities is an authenticated read and preserves old-route absence", async () => {
  let absent = false;
  const h = harness({ override: path => {
    if (path === "v1/party/v2/capabilities") {
      if (absent) throw Object.assign(new Error("absent"), { status: 404 });
      return { status: 200, payload: { preparation_rounds: true } };
    }
  } });
  assert.equal((await h.request("party/v2/capabilities")).status, 401);
  const login = await h.login();
  const response = await h.request("party/v2/capabilities", { cookie: login.cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { preparation_rounds: true });
  assert.equal(h.calls.at(-1)[1], "GET");
  assert.equal((await h.request("party/v2/capabilities?url=https://other.invalid", { cookie: login.cookie })).status, 400);
  absent = true;
  assert.equal((await h.request("party/v2/capabilities", { cookie: login.cookie })).status, 404);
});

test("party capabilities rejects unexpected successful upstream status before any mutation", async () => {
  for (const status of [201, 202, 206]) {
    const h = harness({ override: path => path === "v1/party/v2/capabilities"
      ? { status, payload: { preparation_rounds: true } } : undefined });
    const login = await h.login();
    h.calls.length = 0;
    const response = await h.request("party/v2/capabilities", { cookie: login.cookie });
    assert.equal(response.status, 502, `unexpected upstream ${status}`);
    assert.equal(response.body.code, "party_capabilities_unexpected_status");
    assert.equal(h.calls.filter(call => call[0] === "v1/party/v2/capabilities").length, 1);
    assert.ok(h.calls.every(call => call[1] === "GET"));
    assert.equal(response.headers["Set-Cookie"], undefined);
  }
});

test("old and v2 party HTTP and SSE use explicit authenticated prefixes and closed bodies", async () => {
  const streams = [], h = harness({ override: path => /^v1\/party(?:\/v2)?(?:[/?]|$)/.test(path) ? { payload: { ok: true } } : undefined,
    partyStream: async (target, token, device, headers, res) => { streams.push({ target, token, device, headers }); res.status = 200; } });
  const selected = await h.selected(), id = "a".repeat(32);
  for (const prefix of ["party", "party/v2"]) {
    for (const [suffix, method, body] of [["", "POST", { title_id: 42 }], ["join", "POST", { code: "ABCDEF" }], [id, "GET"],
      [`${id}/preparation`, "POST", { device_id: "00000000-0000-0000-0000-000000000001", action: "ready", ready: true, is_host: false, expected_round: 3 }],
      [`${id}/state`, "PUT", { status: "paused", position_sec: 2 }], [`${id}/leave`, "POST", {}]]) {
      const target = prefix + (suffix ? `/${suffix}` : "");
      const response = await h.request(target, { method, cookie: selected.cookie, ...(body ? { body: { ...body, url: "https://other.invalid" } } : {}) });
      assert.equal(response.status, 200, target);
      const sent = h.calls.at(-1);
      assert.equal(sent[0], `v1/${target}?lang=cs`); assert.equal(sent[1], method);
      assert.equal(sent[2]?.url, undefined);
      assert.equal(sent[5]["X-Profile-ID"], "1");
      if (suffix.endsWith("preparation")) assert.equal(sent[2].expected_round, prefix === "party/v2" ? 3 : undefined);
    }
    assert.equal((await h.request(`${prefix}/${id}/events`, { cookie: selected.cookie })).status, 200);
    assert.equal(streams.at(-1).target, `${prefix}/${id}/events`);
    assert.equal(streams.at(-1).token, "fixture-token-only");
    assert.equal(streams.at(-1).headers["X-Profile-ID"], "1");
  }
  for (const target of ["party/v3", `party/v2x/${id}`, "party/v2/capabilities/extra", `party/v2/${id}/arbitrary`])
    assert.equal((await h.request(target, { cookie: selected.cookie })).status, 404, target);
  for (const expected_round of ["ignored", -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await h.request(`party/${id}/preparation`, { method: "POST", cookie: selected.cookie,
      body: { device_id: "00000000-0000-0000-0000-000000000001", action: "ready", ready: false, is_host: false, expected_round } })).status, 200);
    assert.equal(Object.hasOwn(h.calls.at(-1)[2], "expected_round"), false);
  }
});

test("v2 readiness forwards typed round mismatch without cookie mutation or replay", async () => {
  const h = harness({ override: path => { if (/^v1\/party\/v2\/.+\/preparation/.test(path)) throw Object.assign(new Error("stale round"), { status: 409, code: "party_preparation_round_mismatch" }); } });
  const selected = await h.selected();
  const response = await h.request(`party/v2/${"a".repeat(32)}/preparation`, { method: "POST", cookie: selected.cookie,
    body: { device_id: "00000000-0000-0000-0000-000000000001", action: "ready", ready: true, is_host: false, expected_round: 1 } });
  assert.equal(response.status, 409); assert.equal(response.body.code, "party_preparation_round_mismatch");
  assert.equal(response.cookie, undefined);
  assert.equal(h.calls.filter(call => /^v1\/party/.test(call[0])).length, 1);
});

test("native provider tickets keep URLs/credentials server-side and reports bind the canonical table", async () => {
  const resolved = [];
  const h = harness({
    nativeResolver: async (request) => {
      resolved.push(request);
      if (request.action === "search")
        return {
          streams: [
            {
              id: "ct|123",
              provider_name: "ČT",
              source_stream_id: "123",
              file_name: "Test",
              origin: "Ceskatelevize",
              direct_url: "https://provider.test/private",
              headers: { Cookie: "private" },
            },
          ],
          warnings: [],
        };
      return {
        url: "https://provider.test/stream.m3u8",
        headers: { Referer: "https://provider.test/" },
      };
    },
    playbackEngine: {
      start: async (_s, url, options) => ({
        url,
        trusted: options.trustedProvider,
      }),
      analyze: async () => ({
        streams: [
          { codec_type: "video", codec_name: "h264", width: 320, height: 180 },
        ],
      }),
    },
    override: (path, method, body) => {
      if (path.startsWith("v1/streaming/titles/1/streams"))
        return {
          payload: {
            streams: [{ id: 10, provider_name: "ČT", source_stream_id: "123" }],
          },
        };
      if (path === "v1/stream-deletion-requests/" && method === "POST")
        return { payload: { id: 1, ...body } };
    },
  });
  const selected = await h.selected();
  const sources = await h.request("sources/1/native", {
    cookie: selected.cookie,
  });
  assert.equal(sources.status, 200);
  assert.equal(sources.body.streams[0].direct_url, undefined);
  assert.equal(sources.body.streams[0].headers, undefined);
  // Resolver dostane jen identifikaci titulu, ne celý detail (limit vstupu 64 KB).
  assert.deepEqual(Object.keys(resolved[0].title).sort(), ["imdb_id", "original_title", "title", "tmdb_id", "type", "year"]);
  const ticketBody = JSON.parse(
    Buffer.from(sources.body.streams[0].ticket.split(".")[0], "base64url"),
  );
  assert.equal(ticketBody.direct_url, undefined);
  assert.equal(ticketBody.headers, undefined);
  assert.equal(ticketBody.ident, null);
  const selection = {
    title_id: 1,
    source: "live",
    ticket: sources.body.streams[0].ticket,
  };
  const playback = await h.request("playback", {
    method: "POST",
    cookie: selected.cookie,
    body: { ...selection, url: "https://evil.test" },
  });
  assert.equal(playback.status, 200);
  assert.equal(playback.body.trusted, true);
  assert.equal(
    resolved.at(-1).source.direct_url,
    "https://provider.test/private",
  );
  const foreign = await h.request("playback", {
    method: "POST",
    cookie: selected.cookie,
    body: { ...selection, title_id: 2 },
  });
  assert.equal(foreign.status, 403);
  const report = await h.request("streams/report", {
    method: "POST",
    cookie: selected.cookie,
    body: {
      title_id: 1,
      source: "human",
      stream_id: 10,
      reason: "Nesprávný film",
      requested_by: 999,
    },
  });
  assert.equal(report.status, 200);
  assert.deepEqual(h.calls.at(-1).slice(0, 3), [
    "v1/stream-deletion-requests/",
    "POST",
    { stream_id: 10, reason: "Nesprávný film" },
  ]);
});

test("stream upload uses analyzed metadata and accepts only identified duplicate success", async () => {
  let duplicate = false;
  const h = harness({
    nativeResolver: async (request) =>
      request.action === "search"
        ? {
            streams: [
              {
                id: "pt|123",
                provider_name: "Přehraj.to",
                source_stream_id: "123",
                file_name: "Duna",
                origin: "PrehrajTo",
              },
            ],
            warnings: [],
          }
        : { url: "https://provider.test/video.mp4" },
    playbackEngine: {
      analyze: async () => ({
        format: { size: "1234" },
        streams: [
          {
            codec_type: "video",
            codec_name: "hevc",
            width: 1920,
            height: 1080,
          },
          { codec_type: "audio", tags: { language: "eng" } },
        ],
      }),
    },
    override: (path, method, body) => {
      if (path === "v1/streaming/providers")
        return { payload: [{ id: 12, name: "Přehraj.to" }] };
      if (path === "v1/streaming/streams") {
        if (duplicate)
          throw Object.assign(new Error("Already exists"), {
            status: 409,
            payload: { existing_stream_id: 50 },
          });
        return { payload: { id: 50 } };
      }
    },
  });
  const selected = await h.selected();
  const found = await h.request("sources/1/native", {
    cookie: selected.cookie,
  });
  const selection = {
    title_id: 1,
    source: "live",
    ticket: found.body.streams[0].ticket,
  };
  const result = await h.request("streams/upload", {
    method: "POST",
    cookie: selected.cookie,
    body: { ...selection, video_height: 9999 },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.id, 50);
  const stored = h.calls.find((c) => c[0] === "v1/streaming/streams")[2];
  assert.equal(stored.video_height, 1080);
  assert.equal(stored.file_size, 1234);
  assert.equal(stored.provider_id, 12);
  duplicate = true;
  assert.equal(
    (
      await h.request("streams/upload", {
        method: "POST",
        cookie: selected.cookie,
        body: selection,
      })
    ).body.id,
    50,
  );
});

test("tracking uses selected profile and never forwards browser credentials or scope", async () => {
  const h = harness({
    override: (path) =>
      path.startsWith("v1/integrations")
        ? { payload: { items: [] } }
        : undefined,
  });
  const session = await h.selected();
  const r = await h.request("integrations/trakt/authorization/poll", {
    method: "POST",
    cookie: session.cookie,
    body: {
      id: "12345678-1234-1234-1234-123456789abc",
      user_id: 8,
      profile_id: 80,
      access_token: "browser-token",
      client_secret: "browser-secret",
    },
    headers: { "X-Profile-ID": "80" },
  });
  assert.equal(r.status, 200);
  const call = h.calls.at(-1);
  assert.deepEqual(call[2], { id: "12345678-1234-1234-1234-123456789abc" });
  assert.equal(call[5]["X-Profile-ID"], "1");
  assert.equal(call[3], "fixture-token-only");
});
test("tracking rejects unknown providers, malformed code, foreign origins and anonymous callers", async () => {
  const h = harness();
  const s = await h.selected();
  const before = h.calls.length;
  for (const path of [
    "integrations/unknown/authorization",
    "integrations/trakt/token",
    "integrations/trakt/authorization/poll",
  ]) {
    const r = await h.request(path, {
      method: "POST",
      cookie: s.cookie,
      body: { id: "PRIVATE-DEVICE-CODE" },
    });
    assert.ok([400, 404].includes(r.status));
  }
  const cross = await h.request("integrations/simkl/import", {
    method: "POST",
    cookie: s.cookie,
    body: {},
    origin: "https://evil.test",
  });
  assert.equal(cross.status, 403);
  const anon = await h.request("integrations");
  assert.equal(anon.status, 401);
  assert.equal(
    h.calls.slice(before).filter(([path]) => path.startsWith("v1/integrations"))
      .length,
    0,
  );
});

test("Premium requires an eligible account and forwards only the plan ID", async () => {
  const user = {
    id: 7,
    username: "test",
    is_active: true,
    is_verified: true,
    role: "user",
    coins: 250,
    premium_purchase_enabled: true,
    is_from_light: false,
    premium_until: null,
  };
  const h = harness({
    override: (path, method, body) =>
      path === "v1/auth/me"
        ? { payload: user }
        : path.startsWith("v1/auth/premium/plans")
          ? { payload: [{ id: 1, price_coins: 100, duration_days: 30 }] }
          : path.startsWith("v1/auth/premium/purchase")
            ? { payload: { success: true, coins_remaining: 150 } }
            : undefined,
  });
  const s = await h.selected();
  assert.equal(
    (await h.request("auth/premium/plans", { cookie: s.cookie })).status,
    200,
  );
  assert.equal(
    (
      await h.request("auth/premium/purchase", {
        cookie: s.cookie,
        method: "POST",
        body: { plan_id: 1, coins: 99999, user_id: 123 },
      })
    ).status,
    200,
  );
  const purchase = h.calls.find(([p]) =>
    p.startsWith("v1/auth/premium/purchase"),
  );
  assert.deepEqual(purchase[2], { plan_id: 1 });
  user.is_from_light = true;
  assert.equal(
    (
      await h.request("auth/premium/purchase", {
        cookie: s.cookie,
        method: "POST",
        body: { plan_id: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    h.calls.filter(([p]) => p.startsWith("v1/auth/premium/purchase")).length,
    1,
  );
});
test("offline BFF resolves the real managed device, honors owner boundaries and preserves conflict evidence", async () => {
  const managed = "00000000-0000-0000-0000-000000000007";
  const user = { id: 7, username: "test", is_active: true, is_verified: true };
  const h = harness({
    override: (path, method, body) => {
      if (path === "v1/auth/me") return { payload: user };
      if (path === "v1/auth/bootstrap")
        return { payload: { user, session: { device_id: managed } } };
      if (path.startsWith("v1/sync/v2/mutations"))
        throw new HttpError(409, "conflict", {
          status: "conflict",
          mutation_id: body.mutation_id,
          entity: { entity_key: body.entity_key, version: 5 },
          conflict: { id: 9, server_version: 5 },
        });
      if (path.startsWith("v1/sync/v2/snapshot/pages"))
        return {
          payload: {
            coverage: ["watch_history"],
            entities: [],
            has_more: false,
          },
        };
    },
  });
  const s = await h.selected(),
    owner = {
      "x-movly-expected-account": "7",
      "x-movly-expected-profile": "1",
    };
  const device = await h.request("sync/device", {
    cookie: s.cookie,
    headers: owner,
  });
  assert.equal(device.status, 200);
  assert.equal(device.body.device_id, managed);
  const bootstrap = h.calls.find(([p]) => p === "v1/auth/bootstrap");
  assert.equal(
    bootstrap[5]["X-Movly-Auth-Bootstrap-Mode"],
    "explicit-upgrade-v1",
  );
  assert.equal(
    (
      await h.request("sync/device", {
        cookie: device.cookie,
        headers: { ...owner, "x-movly-expected-profile": "2" },
      })
    ).status,
    409,
  );
  const value = {
    title_id: 1,
    season_number: null,
    episode_number: null,
    progress_seconds: 30,
    duration_seconds: 100,
    watch_status: "watching",
    rating: null,
    notes: null,
    is_favorite: false,
    device_type: "web",
    platform: "web",
    provider_id: null,
    ident: null,
  };
  const result = await h.request("sync/v2/mutations", {
    cookie: device.cookie,
    headers: owner,
    method: "POST",
    body: {
      device_id: managed,
      mutation_id: "00000000-0000-0000-0000-000000000070",
      entity_type: "watch_history",
      entity_key: "title:1:season:null:episode:null",
      base_version: 3,
      operation: "upsert",
      value,
      profile_id: 2,
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.conflict.id, 9);
  assert.equal(result.body.conflict.server_version, 5);
  const mutation = h.calls.find(([p]) => p.startsWith("v1/sync/v2/mutations"));
  assert.equal(mutation[5]["X-Profile-ID"], "1");
  assert.equal(mutation[2].profile_id, undefined);
  assert.equal(
    (
      await h.request(
        "sync/v2/snapshot/pages?limit=100&page_token=" + "a".repeat(300),
        {
          cookie: device.cookie,
          headers: { ...owner, "x-movly-language": "en" },
        },
      )
    ).status,
    200,
  );
  assert.match(h.calls.at(-1)[0], /lang=en/);
});
test("hidden title mutations stay distinct from watch status and reject invalid scope", async () => {
  const h = harness({
      override: (path) =>
        path.startsWith("v1/user/hidden-titles")
          ? { payload: { success: true } }
          : undefined,
    }),
    s = await h.selected();
  assert.equal(
    (
      await h.request("user/hidden-titles", {
        cookie: s.cookie,
        method: "POST",
        body: {
          title_id: 20,
          source: "continue_watching",
          watch_status: "dropped",
        },
      })
    ).status,
    200,
  );
  const mutation = h.calls.find(([p]) => p.startsWith("v1/user/hidden-titles"));
  assert.deepEqual(mutation[2], { title_id: 20, source: "continue_watching" });
  assert.equal(
    (
      await h.request("user/hidden-titles", {
        cookie: s.cookie,
        method: "POST",
        body: { title_id: 20, source: "other" },
      })
    ).status,
    400,
  );
});

test("feedback requires authentication and rejects foreign-origin writes", async () => {
  const h = harness();
  assert.equal((await h.request("feedback/items")).status, 401);
  const login = await h.login(); const start = h.calls.length;
  const response = await h.request("feedback/items/1/vote", { method: "PUT", cookie: login.cookie, origin: "https://foreign.test" });
  assert.equal(response.status, 403); assert.equal(h.calls.length, start);
});
test("feedback forwards Premium consumer routes in account scope without a selected profile", async () => {
  const h = harness({ override: (path) => path === "v1/auth/me" ? { payload: { id: 1, role: "premium", username: "test", is_active: true, is_verified: true } } : undefined }); const login = await h.login();
  assert.equal((await h.request("feedback/items?kind=idea&limit=25", { cookie: login.cookie })).status, 200);
  assert.match(h.calls.at(-1)[0], /^v1\/feedback\/items\?kind=idea&limit=25/);
  assert.equal((await h.request("feedback/items/1/vote", { method: "PUT", cookie: login.cookie })).status, 200);
  assert.equal(h.calls.at(-1)[1], "PUT");
  assert.equal((await h.request("feedback/items/1/vote", { method: "DELETE", cookie: login.cookie })).status, 200);
  assert.equal(h.calls.at(-1)[1], "DELETE");
  for (const [path, method] of [["feedback/items/1", "PATCH"], ["feedback/items/1/merge", "POST"], ["feedback/items/1/vote", "POST"], ["feedback/items/1/unknown", "GET"]]) {
    assert.equal((await h.request(path, { method, cookie: login.cookie, body: {} })).status, 404);
  }
  assert.equal((await h.request("feedback/items?owner_id=999", { cookie: login.cookie })).status, 400);
});
test("feedback administration requires the server role and preserves PATCH body", async () => {
  const member = harness(); const login = await member.login();
  assert.equal((await member.request("admin/feedback/items", { cookie: login.cookie })).status, 403);
  const admin = harness({ override: (path) => path === "v1/auth/me" ? { payload: { id: 1, role: "admin", username: "test", is_active: true, is_verified: true } } : undefined });
  const session = await admin.login();
  const body = { request_id: "11111111-1111-4111-8111-111111111111", status: "ready_for_release", visible: true, releases: [], message: "Oprava je připravená." };
  assert.equal((await admin.request("admin/feedback/items/1", { cookie: session.cookie, method: "PATCH", body })).status, 200);
  const call = admin.calls.at(-1);
  assert.match(call[0], /^v1\/admin\/feedback\/items\/1/); assert.equal(call[1], "PATCH"); assert.deepEqual(call[2], body);
});

test("search discovery marks user queries but not additional result pages", async () => {
  const h = harness();
  const s = await h.selected();
  for (const [offset, purpose] of [[0, "user-query"], [24, "pagination"]]) {
    const r = await h.request(`search?q=matrix&type=both&limit=24&offset=${offset}`, { cookie: s.cookie });
    assert.equal(r.status, 200);
    assert.equal(h.calls.at(-1)[5]["X-Movly-Search-Purpose"], purpose);
  }
});

test("autocomplete and trending searches use only validated current-language reads", async () => {
  const h = harness();
  const s = await h.selected();
  for (const [path, target, expected] of [
    ["autocomplete?q=duna&limit=7", "v1/autocomplete", { q: "duna", limit: "7", lang: "cs" }],
    ["trending-searches?limit=12", "v1/trending-searches", { limit: "12", lang: "cs" }],
  ]) {
    const r = await h.request(path, {
      cookie: s.cookie,
      headers: path.startsWith("autocomplete") ? { "x-movly-language": "en" } : {},
    });
    assert.equal(r.status, 200);
    const [actual] = h.calls.at(-1);
    assert.equal(actual.split("?")[0], target);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(actual.split("?")[1])), {
      ...expected,
      lang: path.startsWith("autocomplete") ? "en" : "cs",
    });
  }
  for (const path of ["autocomplete?limit=7", "autocomplete?q=x&unexpected=1", "trending-searches?q=ignored"]) {
    const rejected = await h.request(path, { cookie: s.cookie });
    assert.equal(rejected.status, 400, path);
  }
});

test("catalog filter BFF forwards supported country and source filters and rejects malformed codes", async () => {
  const h = harness();
  const s = await h.selected();
  const r = await h.request("titles/filter?countries=CZ,US&has_streams=true", { cookie: s.cookie });
  assert.equal(r.status, 200);
  assert.match(h.calls.at(-1)[0], /countries=CZ%2CUS/);
  assert.match(h.calls.at(-1)[0], /has_streams=true/);
  for (const query of ["countries=CZE", "countries=CZ,,US", "has_streams=maybe"]) {
    assert.equal((await h.request(`titles/filter?${query}`, { cookie: s.cookie })).status, 400, query);
  }
});

test("effective policy BFF is read-only, selected-profile scoped and closed to arbitrary query", async () => {
  const h = harness();
  const s = await h.selected();
  const r = await h.request("profiles/effective-content-policy", { cookie: s.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile_id, 1);
  const call = h.calls.at(-1);
  assert.equal(call[0].split("?")[0], "v1/profiles/effective-content-policy");
  assert.equal(call[5]["X-Profile-ID"], "1");
  assert.equal((await h.request("profiles/effective-content-policy?profile_id=2", { cookie: s.cookie })).status, 400);
});

test("search clicks pin the selected profile and accept only validated click payloads", async () => {
  const h = harness({ override: (path) => path.split("?")[0] === "v1/track-search" ? { payload: { status: "success" } } : undefined });
  const s = await h.selected();
  const body = { query: " matrix ", title_id: 7, interaction_type: "click", position_in_results: 2, profile_id: 900 };
  const r = await h.request("track-search", { method: "POST", cookie: s.cookie, body });
  assert.equal(r.status, 200);
  const call = h.calls.at(-1);
  assert.equal(call[5]["X-Profile-ID"], "1");
  assert.deepEqual(call[2], { query: "matrix", title_id: 7, interaction_type: "click", position_in_results: 2, language: "cs" });
  const before = h.calls.filter((c) => c[0].split("?")[0] === "v1/track-search").length;
  for (const patch of [{ interaction_type: "view" }, { position_in_results: 0 }, { title_id: -1 }, { query: " " }]) {
    const rejected = await h.request("track-search", { method: "POST", cookie: s.cookie, body: { ...body, ...patch } });
    assert.equal(rejected.status, 400);
  }
  assert.equal(h.calls.filter((c) => c[0].split("?")[0] === "v1/track-search").length, before);
});

test("Home gateway preserves authenticated profile, selectors and policy scope", async()=>{
 const h=harness(),s=await h.selected();
 const r=await h.request("home?section=resume&page=2&include_highlights=true",{cookie:s.cookie});
 assert.equal(r.status,200);assert.equal(r.body.sections[0].slug,"resume");
 assert.equal(r.body.viewer_scope.profile_id,1);assert.equal(r.body.viewer_scope.account_id,1);
 const upstream=h.calls.find(c=>c[0].startsWith("v1/home?"));
 assert.equal(upstream[5]["X-Profile-ID"],"1");assert.equal(upstream[5]["X-Profile-Grant"],"grant-1");
 const q=new URL(upstream[0],"https://test").searchParams;assert.equal(q.get("page"),"2");assert.equal(q.get("section"),"resume");
 for(const query of ["section=a&collection=b","page=0","section=../bad","include_highlights=yes","include_inactive=true"]) {
  assert.equal((await h.request("home?"+query,{cookie:s.cookie})).status,400);
 }
 assert.equal((await h.request("home")).status,401);
});
test("Home tracking validates actions and rejects stale profile ownership",async()=>{
 const h=harness(),s=await h.selected();
 const body={request_id:"rec-test",title_id:1,action:"view",position:1,section:"for_you",list_slug:"recommendations",platform:"evil",session_id:"forged"};
 const r=await h.request("recommendations/action",{cookie:s.cookie,method:"POST",body});assert.equal(r.status,200);
 const sent=h.calls.find(c=>c[0].startsWith("v1/recommendations/action"));assert.equal(sent[2].platform,"web");assert.equal(sent[2].session_id,undefined);
 assert.equal((await h.request("recommendations/action",{cookie:s.cookie,method:"POST",body:{...body,action:"delete"}})).status,400);
 assert.equal((await h.request("recommendations/action",{cookie:s.cookie,method:"POST",body,headers:{"x-movly-expected-account":"1","x-movly-expected-profile":"2"}})).status,409);
});

test("Home gateway reflects current child policy instead of stale profile cookie metadata",async()=>{
 let kids=false;
 const h=harness({override:path=>path==="v1/profiles"?{payload:[{id:1,name:"Profile",has_pin:false,is_kids:kids,max_certification:kids?7:18,allow_unrated:!kids}]}:undefined}),s=await h.selected();
 const first=await h.request("home",{cookie:s.cookie});assert.equal(first.body.viewer_scope.is_kids,false);
 kids=true;const changed=await h.request("home",{cookie:s.cookie});
 assert.equal(changed.body.viewer_scope.is_kids,true);assert.equal(changed.body.viewer_scope.max_certification,7);assert.equal(changed.body.viewer_scope.allow_unrated,false);
});

test("Home refuses a policy change during load and carries scope even on upstream failure",async()=>{
 let kids=false,fail=false;
 const h=harness({override:path=>{
  if(path==="v1/profiles")return {payload:[{id:1,name:"Profile",has_pin:false,is_kids:kids,max_certification:kids?7:18,allow_unrated:!kids}]};
  if(path.startsWith("v1/home?")) {kids=true;if(fail)throw new HttpError(500,"upstream failure");}
 }}),s=await h.selected();
 let r=await h.request("home",{cookie:s.cookie});assert.equal(r.status,409);assert.equal(r.body.code,"home_policy_changed");assert.equal(r.body.viewer_scope.max_certification,7);
 fail=true;r=await h.request("home",{cookie:s.cookie});assert.equal(r.status,500);assert.equal(r.body.viewer_scope.is_kids,true);assert.equal(r.body.sections,undefined);
});

test("remembered live source survives a fresh BFF/session without another provider search and rejects another profile/title", async () => {
  let searches = 0; const played = [];
  const first = harness({providerClient: {searchFiles: async () => { searches++; return [{provider_name: "Hellspy",
    source_stream_id: "42/hash", file_name: "Duna Cast druha 2024 1080p.mkv", available: true}]; }}});
  const selected = await first.selected();
  const found = await first.request("sources/1/hellspy", {cookie: selected.cookie});
  assert.equal(found.status, 200);
  const ticket = found.body.streams[0].resume_ticket;
  assert.equal(typeof ticket, "string");
  const beforeResume = searches;
  const restarted = harness({playbackEngine: {start: async (_s, url, options) => {
    played.push({url, options}); return {id: "resumed"}; }}});
  const fresh = await restarted.selected();
  const response = await restarted.request("playback", {method: "POST", cookie: fresh.cookie,
    body: {source: "resume", title_id: 1, ticket, offset: 123, audio: 1, subtitle: -1, audio_selector: "remembered-audio", subtitle_selector: "off"}});
  assert.equal(response.status, 200);
  assert.equal(searches, beforeResume);
  assert.equal(played[0].url, "https://api.hellspy.to/gw/video/42/hash/download");
  assert.equal(played[0].options.offset, 123); assert.equal(played[0].options.audioSelector, "remembered-audio");
  assert.equal(played[0].options.subtitleSelector, "off");
  const otherProfile = await restarted.request("profile", {method: "POST", cookie: fresh.cookie, body: {id: 2, pin: "1234"}});
  assert.equal(otherProfile.status, 200);
  for (const [cookie, title_id, altered] of [[otherProfile.cookie, 1, ticket], [fresh.cookie, 2, ticket], [fresh.cookie, 1, ticket + "A"]]) {
    const denied = await restarted.request("playback", {method: "POST", cookie, body: {source: "resume", title_id, ticket: altered}});
    assert.equal(denied.status, 403);
  }
  assert.equal(played.length, 1);
});
test("manual audio review is bound to profile/source and reuses the measured tracks", async () => {
  let probes = 0;
  let stored;
  const h = harness({
    nativeResolver: async request => request.action === "search" ? { streams: [{ id: "pt|123", provider_name: "Přehraj.to", source_stream_id: "123", file_name: "fixture", origin: "PrehrajTo" }], warnings: [] } : { url: "https://provider.test/video.mp4" },
    playbackEngine: { analyze: async () => { probes++; return { streams: [{ codec_type: "video", width: 1920, height: 1080 }, { codec_type: "audio", index: 1, tags: { language: "eng" } }, { codec_type: "audio", index: 2, tags: { language: "und" } }] }; } },
    override: (path, method, body) => {
      if (path === "v1/streaming/providers") return { payload: [{ id: 12, name: "Přehraj.to" }] };
      if (path === "v1/streaming/streams") { stored = body; return { payload: { id: 50 } }; }
    }
  });
  const session = await h.selected();
  const found = await h.request("sources/1/native", { cookie: session.cookie });
  const selection = { title_id: 1, source: "live", ticket: found.body.streams[0].ticket };
  const first = await h.request("streams/upload", { method: "POST", cookie: session.cookie, body: selection });
  assert.equal(first.status, 409); assert.equal(first.body.code, "audio_confirmation_required"); assert.deepEqual(first.body.unknown_audio_tracks, [2]); assert.equal(stored, undefined);
  const confirmation = { ...selection, audio_review_id: first.body.audio_review_id, confirmed_audio_languages: ["cs"] };
  const forged = await h.request("streams/upload", { method: "POST", cookie: session.cookie, body: { ...confirmation, audio_review_id: "forged" } });
  assert.equal(forged.status, 403); assert.equal(stored, undefined);
  const result = await h.request("streams/upload", { method: "POST", cookie: session.cookie, body: confirmation });
  assert.equal(result.status, 200); assert.equal(probes, 1);
  assert.deepEqual(stored.audio_streams.map(t => t.audio_language), ["eng", "cze"]);
  const reused = await h.request("streams/upload", { method: "POST", cookie: session.cookie, body: confirmation });
  assert.equal(reused.status, 403);
});

test("authorized child selection without a management grant clears the adult grant", async () => {
  const h = harness({ override: (path, method, body, token, device, headers) => {
    if (path === "v1/profiles/2/select") {
      assert.equal(headers["X-Profile-Grant"], "pin-grant");
      return { payload: { profile_id: 2, name: "Chráněný profil" } };
    }
    if (path.startsWith("v1/home?")) return { payload: { version: 1, sections: [] } };
  } });
  const adult = await h.selected();
  const child = await h.request("profile", { method: "POST", cookie: adult.cookie, body: { id: 2, pin: "1234" } });
  assert.equal(child.status, 200);
  assert.equal(child.body.profile.id, 2);
  const home = await h.request("home", { cookie: child.cookie });
  assert.equal(home.status, 200);
  assert.equal(home.body.viewer_scope.profile_id, 2);
  assert.equal(home.body.viewer_scope.is_kids, true);
  const call = h.calls.findLast(c => c[0].startsWith("v1/home?"));
  assert.equal(call[5]["X-Profile-ID"], "2");
  assert.equal(Object.hasOwn(call[5], "X-Profile-Grant"), false);
});

test("profile listing is identity-only while creation retains the adult management grant", async () => {
  const h = harness({ override: (path, method, body, token, device, headers) => {
    if (path === "v1/profiles" && method === "POST") {
      assert.equal(headers["X-Profile-ID"], "1");
      assert.equal(headers["X-Profile-Grant"], "grant-1");
      return { payload: { id: 3, name: body.name } };
    }
  } });
  const adult = await h.selected();
  assert.equal((await h.request("profiles", { cookie: adult.cookie })).status, 200);
  const listCall = h.calls.findLast(c => c[0] === "v1/profiles" && c[1] === "GET");
  assert.equal(Object.hasOwn(listCall[5], "X-Profile-ID"), false);
  assert.equal(Object.hasOwn(listCall[5], "X-Profile-Grant"), false);
  const created = await h.request("profiles", { method: "POST", cookie: adult.cookie, body: { name: "New QA profile" } });
  assert.equal(created.status, 200);
  assert.equal(created.body.id, 3);
});

test("profile notification defaults require selection and preserve multiple selections",async()=>{
  const h=harness(),unselected=await h.login();
  assert.equal((await h.request("notifications/defaults",{cookie:unselected.cookie})).status,409);
  const login=await h.request("profile",{cookie:unselected.cookie,method:"POST",body:{id:1}});
  const preferences={events:["stream_available","czsk_available"],channels:["in_app","email"],use_defaults:false};
  const save=await h.request("notifications/defaults",{cookie:login.cookie,method:"PUT",body:preferences});
  assert.equal(save.status,200);assert.deepEqual(save.body.preferences,preferences);
  const read=await h.request("notifications/defaults",{cookie:login.cookie});assert.deepEqual(read.body.effective,preferences);
  assert.equal(h.calls.findLast(c=>c[0].startsWith("v1/notifications/defaults"))[5]["X-Profile-ID"],"1");
  assert.equal((await h.request("notifications/defaults",{cookie:login.cookie,headers:{"x-movly-expected-account":"1","x-movly-expected-profile":"2"}})).status,409);
  const series=await h.request("notifications/series/20",{cookie:login.cookie,method:"PUT",body:{events:[],channels:[],use_defaults:true}});
  assert.equal(series.status,200);assert.deepEqual(series.body.effective,preferences);
  const custom={events:["episode_released"],channels:["desktop"],use_defaults:false};
  const override=await h.request("notifications/series/20",{cookie:login.cookie,method:"PUT",body:custom});assert.deepEqual(override.body.effective,{...custom,channels:preferences.channels});
  const defaults=await h.request("notifications/defaults",{cookie:login.cookie});assert.deepEqual(defaults.body.effective,preferences);
  const updated={...preferences,channels:["mobile_push","in_app"]};
  assert.equal((await h.request("notifications/defaults",{cookie:login.cookie,method:"PUT",body:updated})).status,200);
  const retained=await h.request("notifications/series/20",{cookie:login.cookie});
  assert.deepEqual(retained.body.preferences.events,custom.events);
  assert.deepEqual(retained.body.effective.channels,updated.channels);
  await h.request("notifications/series/20",{cookie:login.cookie,method:"PUT",body:{events:[],channels:[],use_defaults:false}});
  assert.deepEqual((await h.request("notifications/series/20",{cookie:login.cookie})).body.effective.events,[]);
  assert.equal((await h.request("notifications/defaults")).status,401);
  assert.equal((await h.request("notifications/series/20",{cookie:login.cookie,method:"PUT",body:custom,headers:{"x-movly-expected-account":"999","x-movly-expected-profile":"undefined"}})).status,409);
  const second=await h.request("profile",{cookie:login.cookie,method:"POST",body:{id:2,pin:"1234"}});
  assert.equal(second.status,200);
  const separate=await h.request("notifications/defaults",{cookie:second.cookie});
  assert.deepEqual(separate.body.preferences.channels,[]);
  assert.equal(h.calls.findLast(c=>c[0].startsWith("v1/notifications/defaults"))[5]["X-Profile-ID"],"2");
  assert.equal((await h.request("notifications/defaults",{cookie:second.cookie,headers:{"x-movly-expected-account":"1","x-movly-expected-profile":"1"}})).status,409);

});

test('external list reads and exact TMDB metadata retain selected scope and block mutations', async () => {
  const h=harness({override:path=>path.startsWith('v1/integrations/')?{payload:{provider:'trakt',status:'ready',lists:[]}}:path.startsWith('v1/tmdb/')?{payload:{id:42,title:'Český titul'}}:undefined});
  const session=await h.selected();
  for(const path of ['integrations/trakt/lists','integrations/simkl/lists','tmdb/550?type=movie']) {
    const r=await h.request(path,{cookie:session.cookie,headers:{'X-Profile-ID':'80'}});
    assert.equal(r.status,200); assert.equal(h.calls.at(-1)[5]['X-Profile-ID'],'1');
  }
  const relevant=()=>h.calls.filter(call=>/^v1\/(integrations|tmdb)\//.test(call[0])).length;
  const before=relevant();
  for(const path of ['integrations/unknown/lists','integrations/trakt/lists?profile_id=80','tmdb/550?type=both'])
    assert.notEqual((await h.request(path,{cookie:session.cookie})).status,200);
  assert.notEqual((await h.request('integrations/trakt/lists',{method:'POST',cookie:session.cookie,body:{}})).status,200);
  assert.equal(relevant(),before);
});
test("title facts and season watched use closed, validated upstream calls", async () => {
  const h = harness({
    override: (path, method) => {
      if (path.startsWith("v1/titles/1/facts")) return { payload: { title_id: 1, region: "CZ", age_rating: null, creators: [], watch_providers: [] } };
      if (path.split("?")[0] === "v1/watch-history/season" && method === "POST") return { payload: { episodes_updated: 3 } };
    },
  }),
    s = await h.selected();
  const facts = await h.request("titles/1/facts?region=CZ", { cookie: s.cookie });
  assert.equal(facts.status, 200, JSON.stringify(facts.body));
  assert.match(h.calls.at(-1)[0], /^v1\/titles\/1\/facts\?region=CZ/);
  assert.equal((await h.request("titles/1/facts?region=cz1", { cookie: s.cookie })).status, 400);
  assert.equal((await h.request("titles/1/facts?evil=1", { cookie: s.cookie })).status, 400);
  const season = await h.request("watch-history/season", {
    method: "POST",
    cookie: s.cookie,
    body: { title_id: 1, season_number: 2, watch_status: "completed", user_id: 999, profile_id: 7 },
  });
  assert.equal(season.status, 200, JSON.stringify(season.body));
  assert.deepEqual(h.calls.at(-1)[2], { title_id: 1, season_number: 2, watch_status: "completed" });
  const count = h.calls.length;
  for (const body of [
    { title_id: 1, season_number: 0, watch_status: "completed" },
    { title_id: 1, season_number: 2, watch_status: "watching" },
    { title_id: "x", season_number: 2, watch_status: "completed" },
  ])
    assert.equal((await h.request("watch-history/season", { method: "POST", cookie: s.cookie, body })).status, 400);
  assert.equal(h.calls.filter((c) => c[0].split("?")[0] === "v1/watch-history/season").length, 1);
  assert.ok(h.calls.length >= count);
});
test("playback segments reuse account validation for 60 s, other playback calls always validate", async () => {
  const handled = [];
  const h = harness({ playbackEngine: { handle: async (_s, _req, _res, id, file) => { handled.push(file); return file === "status" ? { ready: true } : null; } } });
  const selected = await h.selected();
  const id = "c".repeat(48);
  const validations = () => h.calls.filter(([p]) => p.startsWith("v1/watchlists")).length;
  const before = validations();
  for (const file of ["index.m3u8", "index0.ts", "index1.ts", "index2.ts"])
    await h.request(`playback/${id}/${file}`, { cookie: selected.cookie });
  assert.equal(validations() - before, 1);
  await h.request(`playback/${id}/status`, { cookie: selected.cookie });
  assert.equal(validations() - before, 2);
  assert.deepEqual(handled, ["index.m3u8", "index0.ts", "index1.ts", "index2.ts", "status"]);
});

test("intro preferences and segment lookup remain bound to the selected profile", async()=>{
  const h=harness(), login=await h.login();
  assert.equal((await h.request("playback/preferences",{cookie:login.cookie})).status,409);
  const first=await h.request("profile",{cookie:login.cookie,method:"POST",body:{id:1}});
  assert.equal((await h.request("playback/preferences",{cookie:first.cookie})).body.intro_skip_mode,"manual");
  assert.equal((await h.request("playback/preferences",{cookie:first.cookie,method:"PUT",body:{intro_skip_mode:"auto"}})).status,200);
  assert.equal((await h.request("playback/preferences",{cookie:first.cookie})).body.intro_skip_mode,"auto");
  assert.equal(h.calls.findLast(c=>c[0]==="v1/playback/preferences")[5]["X-Profile-ID"],"1");
  for(const body of [{intro_skip_mode:"unknown"},{intro_skip_mode:"auto",profile_id:2},{}])
    assert.equal((await h.request("playback/preferences",{cookie:first.cookie,method:"PUT",body})).status,400);
  const query="playback/segments?title_id=20&season=1&episode=1&duration_ms=180000";
  const segments=await h.request(query,{cookie:first.cookie,headers:{"x-profile-id":"999"}});
  assert.equal(segments.status,200);assert.equal(segments.body.duration_ms,180000);
  const upstream=h.calls.at(-1);assert.equal(upstream[5]["X-Profile-ID"],"1");assert.ok(upstream[0].includes("duration_ms=180000"));
  assert.equal((await h.request(query,{cookie:first.cookie,method:"POST"})).status,405);
  assert.equal((await h.request("playback/preferences",{cookie:first.cookie,headers:{"x-movly-expected-account":"1","x-movly-expected-profile":"2"}})).status,409);
  const second=await h.request("profile",{cookie:first.cookie,method:"POST",body:{id:2,pin:"1234"}});
  assert.equal((await h.request("playback/preferences",{cookie:second.cookie})).body.intro_skip_mode,"manual");
  assert.equal((await h.request(query)).status,401);
});
