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
} = {}) {
  const calls = [];
  const fixture = createFixture();
  const handler = createAppHandler({
    production,
    providerClient,
    playbackEngine,
    nativeResolver,
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
test("feedback forwards consumer routes in account scope without a selected profile", async () => {
  const h = harness(); const login = await h.login();
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
