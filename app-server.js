"use strict";

const crypto = require("node:crypto");

// Deliberately closed BFF: neither upstream URLs nor authentication/profile
// headers are accepted from the browser. The core API remains authoritative.
function createAppHandler({
  api,
  json,
  readBody,
  HttpError,
  secret,
  production,
}) {
  const cookieName = production ? "__Host-movly-app" : "movly-app";
  const key = crypto.hkdfSync(
    "sha256",
    secret,
    "movly-web",
    "app-session-v1",
    32,
  );
  const lifetime = 12 * 60 * 60;
  function writeSession(res, session) {
    let value = "";
    if (session) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([
        cipher.update(JSON.stringify(session)),
        cipher.final(),
      ]);
      value = Buffer.concat([iv, cipher.getAuthTag(), data]).toString(
        "base64url",
      );
      if (value.length > 3800)
        throw new HttpError(502, "Přihlašovací relace je příliš velká.");
    }
    const ttl = session
      ? Math.max(0, Math.floor((session.expires - Date.now()) / 1000))
      : 0;
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${production ? "; Secure" : ""}`,
    );
  }
  function sessionFrom(req) {
    try {
      const values = (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.startsWith(`${cookieName}=`));
      if (values.length !== 1) return null;
      const value = Buffer.from(
        values[0].slice(cookieName.length + 1),
        "base64url",
      );
      if (value.length < 29 || value.length > 4096) return null;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12),
      );
      decipher.setAuthTag(value.subarray(12, 28));
      const s = JSON.parse(
        Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]),
      );
      return typeof s.token === "string" && s.token && s.expires > Date.now()
        ? s
        : null;
    } catch {
      return null;
    }
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    const expected = `${production ? "https" : "http"}://${req.headers.host}`;
    if (origin !== expected || req.headers["x-movly-app"] !== "1") {
      throw new HttpError(403, "Požadavek musí pocházet z aplikace Movly.", {
        code: "app_origin_required",
      });
    }
  }
  const headersFor = (s) => ({
    "X-Platform": "web",
    "X-Device-Type": "browser",
    "X-Client-App": "movly-web",
    "X-Movly-Profile-Authorization": "explicit-grant-v1",
    ...(s?.profile
      ? { "X-Profile-ID": String(s.profile.id), "X-Profile-Grant": s.grant }
      : {}),
  });
  async function call(s, target, method = "GET", body = null, extra = {}) {
    const identityOnly = target.startsWith("auth/") || target === "profiles";
    return (
      await api(`v1/${target}`, method, body, s?.token, s?.device, {
        ...headersFor(identityOnly ? { ...s, profile: null } : s),
        ...extra,
      })
    ).payload;
  }
  const integer = (value) =>
    (typeof value === "number" || typeof value === "string") &&
    /^[1-9]\d*$/.test(String(value)) &&
    Number.isSafeInteger(Number(value));
  function objectBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "Požadavek musí být JSON objekt.");
    return body;
  }
  const roles = ["user", "vip", "moderator", "admin"];
  function accountView(user) {
    if (
      !user ||
      typeof user.username !== "string" ||
      typeof user.is_active !== "boolean" ||
      typeof user.is_verified !== "boolean"
    ) {
      throw new HttpError(502, "API vrátilo neplatný účet.");
    }
    if (!user.is_active || !user.is_verified)
      throw new HttpError(403, "Účet musí být aktivní a ověřený.");
    const role = roles.includes(user.role) ? user.role : "user";
    return {
      username: user.username,
      displayName: user.display_name || user.username,
      role,
      canModerate: role === "moderator" || role === "admin",
    };
  }
  // Stream reports live in two tables (human-added streams and AI-imported
  // ones); the API exposes them as /stream-deletion-requests and
  // /stream-deletion-requests2. The admin view merges both and tags each row
  // with its source so review/restore calls never guess the table.
  const reportSources = {
    human: "stream-deletion-requests",
    ai: "stream-deletion-requests2",
  };
  const reportStatuses = ["pending", "approved", "rejected"];
  function reportRow(source, raw) {
    if (
      !raw ||
      !Number.isSafeInteger(raw.id) ||
      !Number.isSafeInteger(raw.stream_id) ||
      !reportStatuses.includes(raw.status) ||
      typeof raw.created_at !== "string"
    ) {
      throw new HttpError(502, "API vrátilo neplatné nahlášení streamu.");
    }
    return {
      source,
      id: raw.id,
      streamId: raw.stream_id,
      status: raw.status,
      reason: typeof raw.reason === "string" ? raw.reason : null,
      requestedBy: raw.requested_by ?? null,
      requesterName:
        typeof raw.requester_name === "string" ? raw.requester_name : null,
      reviewerName:
        typeof raw.reviewer_name === "string" ? raw.reviewer_name : null,
      reviewComment:
        typeof raw.review_comment === "string" ? raw.review_comment : null,
      reviewedAt: typeof raw.reviewed_at === "string" ? raw.reviewed_at : null,
      createdAt: raw.created_at,
      streamTitle:
        typeof raw.stream_title === "string" ? raw.stream_title : null,
      streamProvider:
        typeof raw.stream_provider === "string" ? raw.stream_provider : null,
    };
  }
  async function handleAdmin(req, res, url, s, account, target) {
    if (!account.canModerate)
      throw new HttpError(
        403,
        "Správa nahlášení vyžaduje roli moderátora nebo administrátora.",
        { code: "app_moderator_required" },
      );
    let match;
    if (target === "admin/reports" && req.method === "GET") {
      const status = url.searchParams.get("status") || "pending";
      if (status !== "all" && !reportStatuses.includes(status))
        throw new HttpError(400, "Neplatný stav nahlášení.");
      const page = Number(url.searchParams.get("page") || "1");
      const perPage = Number(url.searchParams.get("per_page") || "50");
      if (!integer(page) || !integer(perPage) || perPage > 100)
        throw new HttpError(400, "Neplatné stránkování.");
      const query = `?page=${page}&per_page=${perPage}${status === "all" ? "" : `&status=${status}`}`;
      const pages = await Promise.all(
        Object.entries(reportSources).map(async ([source, path]) => {
          const payload = await call(s, `${path}/${query}`);
          if (
            !payload ||
            !Array.isArray(payload.requests) ||
            !Number.isSafeInteger(payload.total)
          ) {
            throw new HttpError(502, "API vrátilo neplatný seznam nahlášení.");
          }
          return {
            source,
            total: payload.total,
            requests: payload.requests.map((raw) => reportRow(source, raw)),
          };
        }),
      );
      const requests = pages
        .flatMap((p) => p.requests)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      json(res, 200, {
        status,
        page,
        perPage,
        totals: Object.fromEntries(pages.map((p) => [p.source, p.total])),
        hasMore: pages.some((p) => p.total > page * perPage),
        requests,
      });
      return true;
    }
    if (
      (match = /^admin\/reports\/(human|ai)\/([1-9]\d*)\/review$/.exec(
        target,
      )) &&
      req.method === "POST"
    ) {
      const body = await readBody(req, 4096);
      if (!["approve", "reject"].includes(body.action))
        throw new HttpError(400, "Akce musí být approve nebo reject.");
      if (
        body.comment !== undefined &&
        body.comment !== null &&
        (typeof body.comment !== "string" || body.comment.length > 500)
      ) {
        throw new HttpError(400, "Komentář může mít nejvýše 500 znaků.");
      }
      const comment =
        typeof body.comment === "string" && body.comment.trim()
          ? body.comment.trim()
          : null;
      const payload = await call(
        s,
        `${reportSources[match[1]]}/${match[2]}/review`,
        "POST",
        { action: body.action, ...(comment ? { comment } : {}) },
      );
      json(res, 200, reportRow(match[1], payload));
      return true;
    }
    if (
      (match = /^admin\/streams\/(human|ai)\/([1-9]\d*)\/restore$/.exec(
        target,
      )) &&
      req.method === "POST"
    ) {
      const body = await readBody(req, 4096);
      if (
        typeof body.reason !== "string" ||
        !body.reason.trim() ||
        body.reason.length > 500
      ) {
        throw new HttpError(400, "Uveď důvod obnovení (nejvýše 500 znaků).");
      }
      const payload = await call(
        s,
        `${reportSources[match[1]]}/restore/${match[2]}`,
        "POST",
        { reason: body.reason.trim() },
      );
      json(res, 200, {
        ok: true,
        streamId: Number(match[2]),
        source: match[1],
        result: payload ?? null,
      });
      return true;
    }
    throw new HttpError(404, "Tato administrační funkce není dostupná.");
  }
  function cleanQuery(url, allowed) {
    const q = new URLSearchParams();
    for (const [k, v] of url.searchParams) {
      if (!allowed.includes(k) || q.has(k) || v.length > 250)
        throw new HttpError(400, "Neplatný filtr katalogu.");
      if (
        ["page", "cw_page", "wl_page", "limit"].includes(k) &&
        (!integer(v) || Number(v) > (k === "limit" ? 100 : 100000))
      )
        throw new HttpError(400, "Neplatné stránkování.");
      if (k === "offset" && (!/^\d+$/.test(v) || Number(v) > 100000))
        throw new HttpError(400, "Neplatné stránkování.");
      if (k === "type" && !["movie", "tv", "both"].includes(v))
        throw new HttpError(400, "Neplatný typ titulu.");
      if (
        k === "sort_by" &&
        ![
          "title",
          "year",
          "rating",
          "popularity",
          "runtime",
          "vote_count",
        ].includes(v)
      )
        throw new HttpError(400, "Neplatné řazení.");
      if (k === "sort_order" && !["asc", "desc"].includes(v))
        throw new HttpError(400, "Neplatné řazení.");
      if (k === "genre_ids" && !/^[1-9]\d*(,[1-9]\d*)*$/.test(v))
        throw new HttpError(400, "Neplatný žánr.");
      if (
        ["year_from", "year_to"].includes(k) &&
        (!integer(v) || Number(v) < 1800 || Number(v) > 2100)
      )
        throw new HttpError(400, "Neplatný rok.");
      if (k === "rating_from" && (!/^\d+(\.\d+)?$/.test(v) || Number(v) > 10))
        throw new HttpError(400, "Neplatné hodnocení.");
      q.set(k, v);
    }
    q.set("lang", "cs");
    return `?${q}`;
  }
  const routes = [
    ["GET", /^main$/, ["type", "limit", "cw_page", "wl_page"], "main/"],
    ["GET", /^main\/lists\/[a-z0-9_-]+$/, ["page", "limit"]],
    [
      "GET",
      /^titles\/filter$/,
      [
        "type",
        "genre_ids",
        "page",
        "limit",
        "sort_by",
        "sort_order",
        "year_from",
        "year_to",
        "rating_from",
      ],
    ],
    ["GET", /^titles\/genres$/, []],
    ["GET", /^titles\/[1-9]\d*$/, []],
    ["GET", /^search$/, ["q", "type", "limit", "offset"]],
    ["GET", /^watchlists$/, []],
    ["POST", /^watchlists$/, []],
    ["GET", /^watchlists\/[1-9]\d*$/, []],
    ["PUT", /^watchlists\/[1-9]\d*$/, []],
    ["DELETE", /^watchlists\/[1-9]\d*$/, []],
    ["POST", /^watchlists\/[1-9]\d*\/items$/, []],
    ["DELETE", /^watchlists\/[1-9]\d*\/items\/[1-9]\d*$/, []],
    [
      "GET",
      /^watch-history\/continue-watching\/list$/,
      ["page", "limit", "type"],
    ],
  ];
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/app/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const target = url.pathname.slice("/api/app/".length);
    if (!["GET", "HEAD"].includes(req.method)) sameOrigin(req);
    let s = sessionFrom(req);
    try {
      if (target === "login" && req.method === "POST") {
        const body = objectBody(await readBody(req, 8192));
        if (
          typeof body.username !== "string" ||
          !body.username.trim() ||
          body.username.length > 254 ||
          typeof body.password !== "string" ||
          !body.password ||
          body.password.length > 1024
        ) {
          throw new HttpError(400, "Vyplň uživatelské jméno a heslo.");
        }
        s = {
          device: `web-${crypto.randomUUID()}`,
          expires: Date.now() + lifetime * 1000,
        };
        const credentials = {
          username: body.username.trim(),
          password: `sha256:${crypto.createHash("sha256").update(body.password).digest("base64")}`,
          device_id: s.device,
          device_type: "web",
        };
        let login;
        try {
          login = await call(s, "auth/login", "POST", credentials);
        } catch (e) {
          if (e.status !== 409 || e.code !== "password_upgrade_required")
            throw e;
          login = await call(s, "auth/login", "POST", {
            ...credentials,
            password: body.password,
          });
        }
        if (typeof login?.token !== "string" || !login.token)
          throw new HttpError(502, "API nevrátilo přihlašovací relaci.");
        const account = accountView(login.user);
        s.token = login.token;
        writeSession(res, s);
        json(res, 200, { account, profile: null });
        return true;
      }
      if (!s)
        throw new HttpError(401, "Přihlas se svým účtem Movly.", {
          code: "app_session_required",
        });
      if (target === "logout" && req.method === "POST") {
        await call(s, "auth/logout", "POST");
        writeSession(res, null);
        json(res, 200, { ok: true });
        return true;
      }
      // Even API-key-readable catalog endpoints require a currently valid account.
      const account = accountView(await call(s, "auth/me"));
      if (target === "session" && req.method === "GET") {
        json(res, 200, { account, profile: s.profile || null });
        return true;
      }
      if (target.startsWith("admin/"))
        return await handleAdmin(req, res, url, s, account, target);
      if (target === "profiles" && req.method === "GET") {
        json(res, 200, await call(s, "profiles"));
        return true;
      }
      if (target === "profile" && req.method === "POST") {
        const body = objectBody(await readBody(req, 2048));
        if (!integer(body.id)) throw new HttpError(400, "Neplatný profil.");
        const next = { ...s, profile: null, grant: null };
        let grant;
        if (body.pin !== undefined) {
          if (typeof body.pin !== "string" || !/^\d{4,8}$/.test(body.pin))
            throw new HttpError(400, "PIN musí obsahovat 4 až 8 číslic.");
          const verified = await call(
            next,
            `profiles/${body.id}/pin/verify`,
            "POST",
            { pin: body.pin },
          );
          if (verified?.valid !== true || !verified.grant_token)
            throw new HttpError(502, "API nepotvrdilo oprávnění profilu.");
          grant = verified.grant_token;
        }
        const selected = await call(
          next,
          `profiles/${body.id}/select`,
          "POST",
          null,
          grant ? { "X-Profile-Grant": grant } : {},
        );
        if (
          selected?.profile_id !== Number(body.id) ||
          typeof selected.name !== "string" ||
          typeof selected.grant_token !== "string" ||
          !selected.grant_token
        ) {
          throw new HttpError(
            502,
            "API nevrátilo oprávnění vybraného profilu.",
          );
        }
        next.profile = { id: selected.profile_id, name: selected.name };
        next.grant = selected.grant_token;
        writeSession(res, next);
        json(res, 200, { profile: next.profile });
        return true;
      }
      if (!s.profile || !s.grant)
        throw new HttpError(409, "Nejdřív vyber profil.", {
          code: "app_profile_required",
        });
      const rule = routes.find(
        ([method, pattern]) => method === req.method && pattern.test(target),
      );
      if (!rule)
        throw new HttpError(
          404,
          "Tato funkce není ve webové aplikaci dostupná.",
        );
      let query = cleanQuery(url, rule[2]);
      if (/^titles\/[1-9]\d*$/.test(target))
        query +=
          "&expand=credits,seasons,recommendations,similar,watch_history";
      let body = null;
      if (["POST", "PUT"].includes(req.method)) {
        body = objectBody(await readBody(req, 8192));
        if (target.endsWith("/items")) {
          if (!integer(body.title_id))
            throw new HttpError(400, "Neplatný titul.");
          body = { title_id: Number(body.title_id), priority: 0, notes: null };
        } else {
          if (
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.trim().length > 100
          )
            throw new HttpError(400, "Název seznamu musí mít 1 až 100 znaků.");
          body = {
            name: body.name.trim(),
            description: null,
            is_public: false,
          };
        }
      }
      json(
        res,
        200,
        await call(s, `${rule[3] || target}${query}`, req.method, body),
      );
    } catch (error) {
      // Invalid PIN is a profile error, not a logout. All other API diagnostics
      // retain their real status/code instead of masquerading as empty content.
      if (error.status === 401 && target !== "profile" && target !== "login")
        writeSession(res, null);
      const status = Number.isInteger(error.status) ? error.status : 500;
      const retry = error.headers?.get("retry-after");
      if (retry && /^\d+$/.test(retry)) res.setHeader("Retry-After", retry);
      json(res, status, {
        message: error.message || "Požadavek se nepodařilo dokončit.",
        code: error.code || error.payload?.code || null,
      });
    }
    return true;
  };
}
module.exports = { createAppHandler };
