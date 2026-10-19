"use strict";
const { createWorkTiming } = require("./playback-work-timing");
const validPlaybackAttempt = require("./playback-attempt-policy");
const tvDiagnosticPolicy = require("./app/tv/diagnostics.js");

const crypto = require("node:crypto");
const providers = require("./providers-server");
const liveSources = require("./sources-server");
const { directSource, appRequired } = require("./direct-media");
const nativeProviders = require("./native-providers");
const { offlineSigner } = require("./offline-grant");

function feedbackPremiumActive(value, now = Date.now()) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [, y, month, d, h, minute, second, sign, oh = "0", om = "0"] = m;
  const probe = new Date(Date.UTC(+y, +month - 1, +d));
  return probe.getUTCFullYear() === +y && probe.getUTCMonth() === +month - 1 && probe.getUTCDate() === +d && +h < 24 && +minute < 60 && +second < 60 && +oh < 24 && +om < 60 && !(sign === "-" && +oh === 0 && +om === 0) && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}

// Deliberately closed BFF: neither upstream URLs nor authentication/profile
// headers are accepted from the browser. The core API remains authoritative.
function createAppHandler({
  api,
  json,
  readBody,
  HttpError,
  secret,
  production,
  offlineEnvironment = "local",
  providerClient = providers,
  nativeResolver = nativeProviders.run,
  partyStream,
}) {
  const sourceTickets = liveSources.tickets(secret);
  const resumeTickets = liveSources.tickets(secret, { resumable: true });
  const sourceSearches = new Map();
  const nativeSelections = new Map();
  const offline = offlineSigner(secret, offlineEnvironment);
  // Opaque, stable upstream identity for local profile data; never expose its URL.
  const environment = crypto.createHash("sha256").update(`movly-api-environment-v1:${offlineEnvironment}`).digest("hex").slice(0, 32);
  const cookieName = production ? "__Host-movly-app" : "movly-app";
  const key = crypto.hkdfSync(
    "sha256",
    secret,
    "movly-web",
    "app-session-v1",
    32,
  );
  const lifetime = 12 * 60 * 60;
  // Cookie responses can finish out of order. Only the current revision may
  // change the session; retain no provider credentials in this registry.
  const sessionRevisions = new Map();
  let pruneRevisionsAt = 0;
  function sessionKey(session) {
    return crypto.createHash("sha256").update(`${session.token}:${session.device}`).digest("hex");
  }
  function writeSession(res, session, previous = session) {
    const now = Date.now();
    if (now >= pruneRevisionsAt) {
      for (const [id, state] of sessionRevisions) if (state.expires <= now) sessionRevisions.delete(id);
      pruneRevisionsAt = now + 60_000;
    }
    const id = previous ? sessionKey(previous) : null;
    const revision = previous?.revision || 0;
    const current = id ? sessionRevisions.get(id) : null;
    if (session && previous?.expires <= now)
      throw new HttpError(409, "Aktivní profil se změnil.", { code: "app_context_changed" });
    if (current && (current.revision !== revision || current.revoked)) {
      if (!session) return false; // A stale error/logout must not clear a newer cookie.
      throw new HttpError(409, "Aktivní profil se změnil.", { code: "app_context_changed" });
    }
    let value = "";
    if (session) {
      session.revision = revision + 1;
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
    if (id) sessionRevisions.set(id, { revision: revision + 1, expires: previous.expires, revoked: !session });
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
      ? { "X-Profile-ID": String(s.profile.id), ...(s.grant ? { "X-Profile-Grant": s.grant } : {}) }
      : {}),
  });
  async function upstreamCall(s, target, method = "GET", body = null, extra = {}, options = {}) {
    const identityOnly = (target.startsWith("auth/") && !/^auth\/(?:devices|sessions|device\/push-id)(?:[/?]|$)/.test(target)) || (target === "profiles" && method === "GET");
    const {workTiming, ...requestOptions} = options;
    let response;
    try { response = await api(`v1/${target}`, method, body, s?.token, s?.device, {
        ...headersFor(identityOnly ? { ...s, profile: null } : s),
        ...(/^(?:admin\/)?feedback(?:\/|$)/.test(target) ? { "X-Movly-Feedback-Diagnostics": "1" } : {}),
        ...extra,
      }, requestOptions); } catch(error) { workTiming?.merge(error.headers); throw error; }
    workTiming?.merge(response.headers);
    return response.payload;
  }
  const call = upstreamCall;
  const integer = (value) =>
    (typeof value === "number" || typeof value === "string") &&
    /^[1-9]\d*$/.test(String(value)) &&
    Number.isSafeInteger(Number(value));
  function objectBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "Požadavek musí být JSON objekt.");
    return body;
  }
  const roles = ["user", "premium", "vip", "moderator", "admin"];
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
      id: Number.isSafeInteger(user.id) && user.id > 0 ? user.id : null,
      username: user.username,
      displayName: user.display_name || user.username,
      role,
      coins:
        Number.isSafeInteger(user.coins) && user.coins >= 0 ? user.coins : 0,
      premiumUntil: user.premium_until || null,
      premiumPurchaseEnabled: user.premium_purchase_enabled === true,
      isFromLight: user.is_from_light === true,
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
  function trustedRow(raw) {
    if (
      !raw ||
      !Number.isSafeInteger(raw.user_id) ||
      typeof raw.username !== "string"
    ) {
      throw new HttpError(
        502,
        "API vrátilo neplatného důvěryhodného uživatele.",
      );
    }
    return {
      userId: raw.user_id,
      username: raw.username,
      displayName:
        typeof raw.display_name === "string" ? raw.display_name : null,
      grantedByName:
        typeof raw.granted_by_name === "string" ? raw.granted_by_name : null,
      note: typeof raw.note === "string" ? raw.note : null,
      createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
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
          const requests =
            payload && payload.requests == null ? [] : payload?.requests;
          if (
            !payload ||
            !Array.isArray(requests) ||
            !Number.isSafeInteger(payload.total)
          ) {
            throw new HttpError(502, "API vrátilo neplatný seznam nahlášení.");
          }
          return {
            source,
            total: payload.total,
            requests: requests.map((raw) => reportRow(source, raw)),
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
    if (target === "admin/trusted-reporters" && req.method === "GET") {
      const payload = await call(s, "stream-reports/trusted-reporters");
      if (!payload || !Array.isArray(payload.reporters)) {
        throw new HttpError(
          502,
          "API vrátilo neplatný seznam důvěryhodných uživatelů.",
        );
      }
      json(res, 200, {
        reporters: payload.reporters.map(trustedRow),
        total: payload.reporters.length,
      });
      return true;
    }
    if (target === "admin/trusted-reporters" && req.method === "POST") {
      const body = await readBody(req, 4096);
      if (
        typeof body.username !== "string" ||
        !body.username.trim() ||
        body.username.length > 255
      ) {
        throw new HttpError(400, "Zadej uživatelské jméno.");
      }
      if (
        body.note !== undefined &&
        body.note !== null &&
        (typeof body.note !== "string" || body.note.length > 500)
      ) {
        throw new HttpError(400, "Poznámka může mít nejvýše 500 znaků.");
      }
      const note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : undefined;
      const payload = await call(
        s,
        "stream-reports/trusted-reporters",
        "POST",
        { username: body.username.trim(), ...(note ? { note } : {}) },
      );
      json(res, 201, trustedRow(payload));
      return true;
    }
    if (
      (match = /^admin\/trusted-reporters\/([1-9]\d*)$/.exec(target)) &&
      req.method === "DELETE"
    ) {
      await call(s, `stream-reports/trusted-reporters/${match[1]}`, "DELETE");
      json(res, 200, { ok: true, userId: Number(match[1]) });
      return true;
    }
    throw new HttpError(404, "Tato administrační funkce není dostupná.");
  }
  function cleanQuery(url, allowed, language = "cs") {
    const q = new URLSearchParams();
    for (const [k, v] of url.searchParams) {
      if (
        !allowed.includes(k) ||
        q.has(k) ||
        v.length > (k === "page_token" ? 1024 : 250)
      )
        throw new HttpError(400, "Neplatný filtr katalogu.");
      if (
        ["page", "cw_page", "wl_page", "limit"].includes(k) &&
        (!integer(v) || Number(v) > (k === "limit" ? 100 : 100000))
      )
        throw new HttpError(400, "Neplatné stránkování.");
      if (k === "preview_limit" && (!integer(v) || Number(v) > 20))
        throw new HttpError(400, "Neplatný počet náhledů.");
      if (["title_id", "episode_id"].includes(k) && !integer(v))
        throw new HttpError(400, "Neplatný titul nebo epizoda.");
      if (k === "region" && !/^[A-Z]{2}$/.test(v))
        throw new HttpError(400, "Neplatný region.");
      if (k === "offset" && (!/^\d+$/.test(v) || Number(v) > 100000))
        throw new HttpError(400, "Neplatné stránkování.");
      if (["section", "collection"].includes(k) && !/^[a-z0-9_-]{1,100}$/.test(v))
        throw new HttpError(400, "Neplatná řada Domů.");
      if (k === "include_highlights" && !["true", "false"].includes(v))
        throw new HttpError(400, "Neplatný filtr katalogu.");
      if (k === "has_streams" && !["true", "false", "1", "0"].includes(v))
        throw new HttpError(400, "Neplatný filtr dostupného zdroje.");
      if (k === "countries" && !/^[A-Za-z]{2}(,[A-Za-z]{2})*$/.test(v))
        throw new HttpError(400, "Neplatné kódy zemí původu.");
      if (k === "subtitle_language" && !/^[A-Za-z]{2,3}(,[A-Za-z]{2,3})*$/.test(v))
        throw new HttpError(400, "Neplatné jazyky titulků.");
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
    if (q.has("section") && q.has("collection")) throw new HttpError(400, "Neplatná řada Domů.");
    q.set("lang", language);
    return `?${q}`;
  }
  function cleanPersonalDataQuery(url, allowed) {
    const q = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key) || q.has(key) || value.length > (key === "cursor" ? 4096 : 64))
        throw new HttpError(400, "Neplatné stránkování osobních dat.");
      if (key === "limit" && (!/^[1-9]\d*$/.test(value) || Number(value) > 1000))
        throw new HttpError(400, "Neplatná velikost stránky osobních dat.");
      if (key === "device_id" && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))
        throw new HttpError(400, "Neplatné zařízení osobních dat.");
      if (key === "cursor" && !value)
        throw new HttpError(400, "Neplatný kurzor osobních dat.");
      q.append(key, value);
    }
    if (!q.has("device_id")) throw new HttpError(400, "Chybí zařízení osobních dat.");
    return q.size ? `?${q}` : "";
  }
  const routes = [
    ["GET", /^notifications\/(?:defaults|series\/[1-9]\d*)$/, []],
    ["PUT", /^notifications\/(?:defaults|series\/[1-9]\d*)$/, []],
    ["GET", /^notifications\/inbox$/, ["before"]],
    ["GET", /^notifications\/system-inbox$/, []],
    ["PUT", /^notifications\/system-inbox\/[1-9]\d*\/delivered$/, []],
    ["PUT", /^notifications\/inbox\/[1-9]\d*\/read$/, []],
    ["GET", /^auth\/premium\/plans$/, []],
    ["POST", /^auth\/premium\/purchase$/, []],
    ["GET", /^user\/hidden-titles$/, ["source", "limit", "offset"]],
    ["POST", /^user\/hidden-titles$/, []],
    ["DELETE", /^user\/hidden-titles\/[1-9]\d*$/, ["source"]],
    ["GET", /^sync\/v2\/conflicts$/, ["limit", "cursor", "status"]],
    ["GET", /^sync\/v2\/snapshot\/pages$/, ["limit", "page_token"]],
    ["GET", /^sync\/v2\/profile-data\/(?:snapshot|changes)$/, ["limit", "cursor", "device_id"]],
    ["POST", /^sync\/v2\/mutations$/, []],
    ["POST", /^sync\/v2\/conflicts\/[1-9]\d*\/resolve$/, []],
    ["GET", /^integrations$/, []],
    ["GET", /^integrations\/(?:trakt|simkl)\/lists$/, []],
    ["GET", /^tmdb\/[1-9]\d*$/, ["type"]],
    ["GET", /^profiles\/effective-content-policy$/, []],
    ["POST", /^titles\/batch$/, []],
    [
      "POST",
      /^integrations\/(?:trakt|simkl)\/(?:authorization(?:\/poll)?|sync|import)$/,
      [],
    ],
    ["DELETE", /^integrations\/(?:trakt|simkl)$/, []],
    ["POST", /^party(?:\/join)?$/, []],
    ["GET", /^party\/[a-f0-9]{32}$/, []],
    ["POST", /^party\/[a-f0-9]{32}\/(?:preparation|leave)$/, []],
    ["PUT", /^party\/[a-f0-9]{32}\/state$/, []],
    ["POST", /^party\/v2(?:\/join)?$/, []],
    ["GET", /^party\/v2\/[a-f0-9]{32}$/, []],
    ["POST", /^party\/v2\/[a-f0-9]{32}\/(?:preparation|leave)$/, []],
    ["PUT", /^party\/v2\/[a-f0-9]{32}\/state$/, []],
    ["GET", /^home$/, ["section", "collection", "page", "include_highlights", "layout_only"]],
    ["POST", /^recommendations\/action$/, []],
    ["GET", /^themed-lists$/, []],
    ["GET", /^themed-lists\/[a-z0-9_-]+$/, ["page", "limit"]],
    ["GET", /^titles\/[1-9]\d*\/similar$/, ["limit"]],
    ["GET", /^people\/[1-9]\d*(?:\/filmography)?$/, ["type"]],
    ["GET", /^friends(?:\/(?:requests|privacy|activity))?$/, ["limit"]],
    ["POST", /^friends\/requests$/, []],
    ["POST", /^friends\/requests\/[1-9]\d*\/accept$/, []],
    ["DELETE", /^friends\/[1-9]\d*$/, []],
    ["POST", /^friends\/[1-9]\d*\/block$/, []],
    ["PUT", /^friends\/privacy$/, []],
    ["GET", /^watchlists\/overview$/, ["preview_limit"]],
    ["GET", /^watchlists\/shared(?:\/[1-9]\d*)?$/, []],
    ["GET", /^watchlists\/[1-9]\d*\/(?:shares|public-link)$/, []],
    ["POST", /^watchlists\/[1-9]\d*\/(?:shares|public-link)$/, []],
    ["DELETE", /^watchlists\/[1-9]\d*\/(?:shares\/[1-9]\d*|public-link)$/, []],
    ["GET", /^titles\/[1-9]\d*\/seasons$/, []],
    ["GET", /^ratings\/title\/[1-9]\d*\/my$/, []],
    ["POST", /^ratings$/, ["title_id"], "ratings/"],
    ["DELETE", /^ratings\/[1-9]\d*$/, []],
    ["POST", /^watch-history$/, []],
    ["POST", /^watch-history\/season$/, []],
    ["GET", /^watch-history\/list$/, ["page", "limit", "status", "type"]],
    [
      "GET",
      /^watch-history\/position\/[1-9]\d*$/,
      ["season_number", "episode_number"],
    ],
    ["DELETE", /^watch-history\/[1-9]\d*$/, []],
    ["GET", /^stats\/me(?:\/wrapped\/20\d{2})?$/, []],
    [
      "GET",
      /^streaming2?\/titles\/[1-9]\d*\/streams$/,
      ["episode_id", "limit", "type"],
    ],
    ["GET", /^main$/, ["type", "limit", "cw_page", "wl_page"], "main/"],
    ["GET", /^main\/personal$/, ["type", "limit", "cw_page", "wl_page"]],
    ["GET", /^main\/lists\/[a-z0-9_-]+$/, ["page", "limit"]],
    [
      "GET",
      /^titles\/filter$/,
      [
        "q",
        "type",
        "genre_ids",
        "page",
        "limit",
        "sort_by",
        "sort_order",
        "year_from",
        "year_to",
        "rating_from",
        "rating_to",
        "video_height_min",
        "hdr",
        "audio_language",
        "genre_match",
        "runtime_from",
        "runtime_to",
        "original_language",
        "has_streams",
        "countries",
        "subtitle_language",
      ],
    ],
    ["GET", /^search\/filters$/, ["q", "type", "page", "limit"]],
    ["GET", /^autocomplete$/, ["q", "limit"]],
    ["GET", /^trending-searches$/, ["limit"]],
    ["GET", /^popular-titles-search$/, ["limit", "type"]],
    ["GET", /^titles\/filter\/facets$/, []],
    ["GET", /^titles\/genres$/, []],
    // Uložené filtry katalogu profilu (skládač filtrů, stejné na všech zařízeních).
    ["GET", /^saved-filters$/, []],
    ["POST", /^saved-filters$/, []],
    ["PUT", /^saved-filters\/[1-9]\d*$/, []],
    ["DELETE", /^saved-filters\/[1-9]\d*$/, []],
    ["GET", /^titles\/[1-9]\d*$/, []],
    // Doplňková fakta detailu (věk, tvůrci, kde sledovat), core-API #705.
    ["GET", /^titles\/[1-9]\d*\/facts$/, ["region"]],
    ["GET", /^search$/, ["q", "type", "limit", "offset"]],
    ["POST", /^track-search$/, []],
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
  let tvDiagnostics = { windowStart: 0, count: 0 };
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/app/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const target = url.pathname.slice("/api/app/".length);
    if (!["GET", "HEAD"].includes(req.method)) sameOrigin(req);
    // Response close means the consumer left only when the response did not
    // finish normally. IncomingMessage.close also fires on ordinary GETs.
    const upstreamController = (target === "home" && req.method === "GET") || (target === "telemetry/playback-attempts" && req.method === "POST") ? new AbortController() : null;
    const abortUpstream = () => { if (!res.writableEnded) upstreamController?.abort(); };
    if (upstreamController) { res.once?.("close", abortUpstream); req.once?.("aborted", abortUpstream); if (req.aborted) abortUpstream(); }
    const upstreamDeadline = upstreamController ? setTimeout(() => upstreamController.abort(), target === "home" ? 8000 : 3000) : null;
    let workTiming = null;
    const call = (session, path, method = "GET", body = null, extra = {}) => {
      const controlled = /^(?:streaming2?\/titles\/[^/]+\/streams(?:\?|$)|watch-history\/position\/|titles\/|video\/analyze$)/.test(path);
      return upstreamCall(session, path, method, body,
        {...extra, ...(controlled && workTiming ? {"X-Movly-Playback-Attempt":workTiming.id} : {})},
        {...(upstreamController ? {signal:upstreamController.signal}:{}), ...(controlled && workTiming ? {workTiming}: {})});
    };
    let s = sessionFrom(req);
    const language = ["cs", "sk", "en"].includes(
      req.headers["x-movly-language"],
    )
      ? req.headers["x-movly-language"]
      : "cs";
    try {
      if (
        req.method === "POST" &&
        [
          "password-reset/request",
          "password-reset/verify",
          "password-reset/confirm",
        ].includes(target)
      ) {
        const input = objectBody(await readBody(req, 8192));
        const email = typeof input.email === "string" ? input.email.trim() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
          throw new HttpError(400, "Zadej platný e-mail.");
        const body = { email };
        if (target === "password-reset/confirm") {
          const password = input.new_password;
          if (
            typeof password !== "string" ||
            password.length < 6 ||
            password.length > 1024
          )
            throw new HttpError(400, "Heslo musí mít 6 až 1024 znaků.");
          body.new_password =
            `sha256:${crypto.createHash("sha256").update(password).digest("base64")}`;
        }
        if (
          ["password-reset/verify", "password-reset/confirm"].includes(target)
        ) {
          if (
            typeof input.code !== "string" ||
            !/^[a-zA-Z0-9-]{4,128}$/.test(input.code.trim())
          )
            throw new HttpError(400, "Zadej kód z e-mailu.");
          body.code = input.code.trim();
        }
        const result = await call(null, `auth/${target}`, "POST", body);
        json(res, 200, result);
        return true;
      }
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
        if (
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
            login.device_id || "",
          )
        )
          s.managedDeviceId = login.device_id.toLowerCase();
        writeSession(res, s);
        json(res, 200, { account, profile: null, environment });
        return true;
      }
      // Technická diagnostika TV lite (klávesy, schopnosti přehrávače, chyby) do logu
      // serveru; omezená velikostí i počtem, bez obsahu formulářů a bez IP.
      if (target === "tv-diagnostics" && req.method === "POST") {
        const now = Date.now();
        if (now - tvDiagnostics.windowStart > 60_000) tvDiagnostics = { windowStart: now, count: 0 };
        if (++tvDiagnostics.count > 120) throw new HttpError(429, "Příliš mnoho diagnostických záznamů.");
        const body = objectBody(await readBody(req, 16384));
        const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
        for (const event of events) {
          if (!event || typeof event !== "object" || Array.isArray(event)) continue;
          const safe = tvDiagnosticPolicy.sanitize(event.t, event.d, event.s);
          if (!safe) continue;
          console.log(`[Movly TV] ${s ? "auth" : "anon"} ${safe.t} ${JSON.stringify({ at: safe.s, d: safe.d })}`);
        }
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (!s)
        throw new HttpError(401, "Přihlas se svým účtem Movly.", {
          code: "app_session_required",
        });
      if (target === "logout" && req.method === "POST") {
        await call(s, "auth/logout", "POST");
        writeSession(res, null, s);
        json(res, 200, { ok: true });
        return true;
      }
      // Even API-key-readable catalog endpoints require a currently valid account.
      const accountUser = await call(s, "auth/me");
      const account = accountView(accountUser);
      const expectedAccount = req.headers["x-movly-expected-account"],
        expectedProfile = req.headers["x-movly-expected-profile"];
      if (
        (expectedAccount !== undefined || expectedProfile !== undefined) &&
        (!integer(expectedAccount) ||
          Number(expectedAccount) !== accountUser.id ||
          (!integer(expectedProfile) || Number(expectedProfile) !== s.profile?.id))
      )
        throw new HttpError(409, "Aktivní profil se změnil.", {
          code: "offline_owner_changed",
        });
      if (/^(?:streaming2?\/titles\/[^/]+\/streams(?:\?|$)|sources\/[^/]+\/(?:webshare|hellspy|native)(?:\?|$)|watch-history\/position\/|playback$)/.test(target))
        workTiming = createWorkTiming(req.headers["x-movly-playback-attempt"], res);
      const timed = (name, work) => workTiming ? workTiming.measure(name, work) : work();
      if (target === "telemetry/playback-attempts" && req.method === "POST") {
        const body = objectBody(await readBody(req, 2048));
        if (!validPlaybackAttempt(body)) throw new HttpError(400, "Neplatná diagnostická událost.");
        await call(s, "telemetry/playback-attempts", "POST", body);
        res.statusCode = 204; res.end(); return true;
      }
      if (target === "capabilities/negotiate" && req.method === "POST") {
        const input = objectBody(await readBody(req, 8192));
        if (Object.keys(input).length !== 2 || input.schema_version !== 1 ||
            !Array.isArray(input.client_capabilities) || input.client_capabilities.length > 16)
          throw new HttpError(400, "Neplatná žádost o vyjednání schopností.");
        const ids = new Set();
        for (const capability of input.client_capabilities) {
          if (!capability || typeof capability !== "object" || Array.isArray(capability) ||
              Object.keys(capability).length !== 2 || typeof capability.id !== "string" ||
              !/^[a-z][a-z0-9_]{0,63}$/.test(capability.id) || ids.has(capability.id) ||
              !Array.isArray(capability.versions) || capability.versions.length < 1 || capability.versions.length > 8 ||
              capability.versions.some(version => !Number.isSafeInteger(version) || version < 1 || version > 1000) ||
              new Set(capability.versions).size !== capability.versions.length)
            throw new HttpError(400, "Neplatná žádost o vyjednání schopností.");
          ids.add(capability.id);
        }
        json(res, 200, await call(s, target, "POST", input));
        return true;
      }
      if (target === "telemetry/client" && req.method === "POST") {
        const body = objectBody(await readBody(req, 2048));
        const keys = ["event", "outcome", "provider", "duration_ms"];
        if (Object.keys(body).some(key => !keys.includes(key))
          || !["stream_resolve", "media_opened", "playing", "first_frame"].includes(body.event)
          || !["failure", "timeout", "success"].includes(body.outcome)
          || !["", "webshare", "hellspy", "fastshare", "sosac", "stremio"].includes(body.provider)
          || (body.outcome === "success" && !["first_frame", "playing"].includes(body.event))
          || (body.event === "first_frame" && body.outcome !== "success")
          || !Number.isSafeInteger(body.duration_ms) || body.duration_ms < 0 || body.duration_ms > 3_600_000)
          throw new HttpError(400, "Neplatná diagnostická událost.");
        await call(s, "telemetry/client", "POST", { event: body.event, outcome: body.outcome,
          provider: body.provider, duration_ms: body.duration_ms });
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (target === "session" && req.method === "GET") {
        if (s.profile) {
          const profiles = await call(s, "profiles");
          const current = profiles.find((p) => p.id === s.profile.id);
          s.profile = current
            ? {
                id: current.id,
                name: current.name,
                avatar_url: current.avatar_url || null,
              }
            : null;
        }
        json(res, 200, { account, profile: s.profile || null, environment });
        return true;
      }
      if (/^(?:admin\/)?feedback\//.test(target)) {
        if (!["premium", "vip", "moderator", "admin"].includes(account.role) && !feedbackPremiumActive(account.premiumUntil))
          throw new HttpError(403, "Pomozte zlepšovat Movly je dostupné s Premium.", { code: "feedback_premium_required" });
        const isAdmin = target.startsWith("admin/");
        if (isAdmin && account.role !== "admin") throw new HttpError(403, "K této akci nemáš oprávnění.");
        const feedbackTarget = target.replace(/^admin\//, "");
        const allowed = [
          ["GET", /^feedback\/items$/, ["kind", "mine", "q", "status", "sort", "limit", "offset"]],
          ["GET", /^feedback\/items\/[1-9]\d*$/, []],
          ["GET", /^feedback\/attachments\/[a-f0-9-]{36}$/, []],
          ...(isAdmin ? [
            ["PATCH", /^feedback\/items\/[1-9]\d*$/, []],
            ["DELETE", /^feedback\/items\/[1-9]\d*$/, []],
            ["POST", /^feedback\/items\/[1-9]\d*\/(?:messages|merge)$/, []],
          ] : [
            ["POST", /^feedback\/items$/, []],
            ["PUT", /^feedback\/items\/[1-9]\d*\/vote$/, []],
            ["DELETE", /^feedback\/items\/[1-9]\d*\/vote$/, []],
            ["POST", /^feedback\/items\/[1-9]\d*\/(?:messages|attachments)$/, []],
            ["POST", /^feedback\/handoffs(?:\/consume)?$/, []],
          ]),
        ].find(([method, pattern]) => method === req.method && pattern.test(feedbackTarget));
        if (!allowed) throw new HttpError(404, "Položka nebyla nalezena.");
        const query = cleanQuery(url, allowed[2], language);
        const body = ["POST", "PATCH"].includes(req.method) ? objectBody(await readBody(req, feedbackTarget.endsWith("/attachments") ? 1500000 : 24576)) : null;
        const result = await call(s, target + query, req.method, body);
        json(res, req.method === "POST" && (feedbackTarget === "feedback/items" || feedbackTarget === "feedback/handoffs") ? 201 : 200, result ?? {});
        return true;
      }
      if (target === "admin/telemetry/client" && req.method === "GET") {
        res.setHeader("Cache-Control", "private, no-store");
        if (account.role !== "admin") throw new HttpError(403, "K této akci nemáš oprávnění.");
        const query = cleanQuery(url, ["client_app", "day"], language);
        json(res, 200, await call(s, target + query)); return true;
      }
      if (target === "admin/telemetry/playback-attempts" && req.method === "GET") {
        if (account.role !== "admin") throw new HttpError(403, "K této akci nemáš oprávnění.");
        const query = cleanQuery(url, ["client_app", "platform", "hours"], language);
        json(res, 200, await call(s, target + query)); return true;
      }
      if (target.startsWith("admin/"))
        return await handleAdmin(req, res, url, s, account, target);
      if (target === "profiles/avatars" && req.method === "GET") {
        json(res, 200, await call(s, target));
        return true;
      }
      if (
        (target === "profiles" && req.method === "POST") ||
        (/^profiles\/[1-9]\d*$/.test(target) &&
          ["PUT", "DELETE"].includes(req.method))
      ) {
        let body = null;
        if (req.method !== "DELETE") {
          const raw = objectBody(await readBody(req, 4096));
          if (
            typeof raw.name !== "string" ||
            !raw.name.trim() ||
            raw.name.length > 50
          )
            throw new HttpError(400, "Název profilu musí mít 1 až 50 znaků.");
          body = { name: raw.name.trim() };
          if (raw.avatar_url !== undefined) {
            const avatars = await call(s, "profiles/avatars");
            if (!avatars.some((a) => a.url === raw.avatar_url))
              throw new HttpError(400, "Vyber avatar z nabídky.");
            body.avatar_url = raw.avatar_url;
          }
          for (const key of ["is_kids", "allow_unrated"])
            if (typeof raw[key] === "boolean") body[key] = raw[key];
          if (raw.max_certification !== undefined) {
            if (![7, 12, 15, 18].includes(raw.max_certification))
              throw new HttpError(400, "Neplatná věková hranice.");
            body.max_certification = raw.max_certification;
          }
          if (raw.pin !== undefined) {
            if (
              typeof raw.pin !== "string" ||
              (raw.pin !== "" && !/^\d{4,8}$/.test(raw.pin))
            )
              throw new HttpError(400, "PIN musí mít 4 až 8 číslic.");
            body.pin = raw.pin;
          }
        }
        json(res, 200, await call(s, target, req.method, body));
        return true;
      }
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
          (selected.grant_token != null && (typeof selected.grant_token !== "string" || !selected.grant_token))
        ) {
          throw new HttpError(
            502,
            "API nevrátilo oprávnění vybraného profilu.",
          );
        }
        const profiles = await call(next, "profiles");
        const selectedProfile = profiles.find(
          (p) => p.id === selected.profile_id,
        );
        next.profile = {
          id: selected.profile_id,
          name: selected.name,
          avatar_url: selectedProfile?.avatar_url || null,
        };
        next.grant = selected.grant_token || null;
        next.grantExpiresAt = selected.grant_token ? selected.grant_expires_at : null;
        writeSession(res, next, s);
        json(res, 200, { profile: next.profile, environment });
        return true;
      }
      if (/^notifications\//.test(target)) {
        if(!s.profile)throw new HttpError(409,"Nejdřív vyber profil.",{code:"app_profile_required"});
        const rule=routes.find(([method,pattern])=>method===req.method&&pattern.test(target));
        if(!rule)throw new HttpError(404,"Položka nebyla nalezena.");
        const body=req.method==="PUT"?objectBody(await readBody(req,4096)):null;
        const result=await call(s,target+cleanQuery(url,rule[2],language),req.method,body);
        json(res,200,result??{});return true;
      }
      if (target === "party/v2/capabilities" && req.method === "GET") {
        cleanQuery(url, []);
        const response = await api("v1/party/v2/capabilities", "GET", null, s.token, s.device,
          headersFor({ ...s, profile: null }));
        if (response.status !== 200)
          throw new HttpError(502, "Server vrátil neplatnou odpověď protokolu party.", {
            code: "party_capabilities_unexpected_status",
          });
        json(res, 200, response.payload);
        return true;
      }
      if (!s.profile)
        throw new HttpError(409, "Nejdřív vyber profil.", {
          code: "app_profile_required",
        });
      if (
        /^watchlists\/[1-9]\d*\/leave$/.test(target) &&
        req.method === "DELETE"
      ) {
        const me = await call(s, "auth/me");
        if (!integer(me.id)) throw new HttpError(502, "Účet nemá platné ID.");
        json(
          res,
          200,
          await call(s, target.replace(/leave$/, `shares/${me.id}`), "DELETE"),
        );
        return true;
      }
      if (target === "playback/preferences" || target === "playback/segments") {
        if (target === "playback/segments") {
          if (req.method !== "GET") throw new HttpError(405, "Nepodporovaná metoda.");
          const query = cleanQuery(url, ["title_id", "season", "episode", "duration_ms"], language);
          json(res, 200, await call(s, target + query));
        } else if (req.method === "GET") json(res, 200, await call(s, target));
        else if (req.method === "PUT") {
          const body = objectBody(await readBody(req, 4096));
          if (Object.keys(body).length !== 1 || !["off", "manual", "auto"].includes(body.intro_skip_mode)) throw new HttpError(400, "Neplatné nastavení intra.");
          json(res, 200, await call(s, target, "PUT", body));
        } else throw new HttpError(405, "Nepodporovaná metoda.");
        return true;
      }
      if (
        target.startsWith("sources/") ||
        target.startsWith("providers/") ||
        target.startsWith("streams/") ||
        target === "download" ||
        target === "playback"
      )
        await call(s, "watchlists?lang=cs");
      if (target === "sync/device" && req.method === "GET") {
        if (!s.managedDeviceId) {
          const bootstrap = await call(s, "auth/bootstrap", "GET", null, {
            "X-Movly-Auth-Bootstrap-Mode": "explicit-upgrade-v1",
          });
          const deviceId = bootstrap?.session?.device_id;
          if (
            bootstrap?.user?.id !== accountUser.id ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
              deviceId || "",
            )
          )
            throw new HttpError(
              409,
              "Přihlášení nemá spravované zařízení pro synchronizaci. Přihlas se znovu.",
            );
          s.managedDeviceId = deviceId.toLowerCase();
          writeSession(res, s);
        }
        json(res, 200, { device_id: s.managedDeviceId });
        return true;
      }
      if (target === "offline-grant" && req.method === "POST") {
        const profiles = await call(s, "profiles");
        const profile = profiles.find((p) => p.id === s.profile.id);
        json(res, 200, offline.issue(accountUser, profile, s));
        return true;
      }
      if (target === "providers/webshare") {
        if (req.method === "GET") {
          json(res, 200, {
            connected: Boolean(s.webshare),
            username: s.webshare?.username || null,
            vip: s.webshare?.vip || false,
          });
          return true;
        }
        if (req.method === "POST") {
          const body = objectBody(await readBody(req, 4096));
          if (
            typeof body.username !== "string" ||
            !body.username.trim() ||
            body.username.length > 254 ||
            typeof body.password !== "string" ||
            !body.password ||
            body.password.length > 1024
          )
            throw new HttpError(400, "Vyplň jméno a heslo Webshare.");
          s.webshare = await providerClient.login(
            body.username.trim(),
            body.password,
          );
          writeSession(res, s);
          json(res, 200, {
            connected: true,
            username: s.webshare.username,
            vip: s.webshare.vip,
          });
          return true;
        }
        if (req.method === "DELETE") {
          delete s.webshare;
          writeSession(res, s);
          json(res, 200, { connected: false });
          return true;
        }
      }
      const nativeSettings = /^providers\/(fastshare|sosac|stremio)$/.exec(
        target,
      );
      if (nativeSettings) {
        const provider = nativeSettings[1];
        if (req.method === "GET") {
          json(
            res,
            200,
            provider === "stremio"
              ? { addons: (s.addons || []).map((a) => ({ name: a.name })) }
              : {
                  connected: Boolean(s[provider]),
                  username: s[provider]?.username || null,
                },
          );
          return true;
        }
        if (req.method === "DELETE") {
          delete s[provider === "stremio" ? "addons" : provider];
          writeSession(res, s);
          json(res, 200, { connected: false });
          return true;
        }
        if (req.method === "POST") {
          const body = objectBody(await readBody(req, 4096));
          if (provider === "stremio") {
            if (
              typeof body.url !== "string" ||
              body.url.length > 500 ||
              (s.addons || []).length >= 3
            )
              throw new HttpError(
                400,
                "Zadej adresu doplňku (nejvýše tři doplňky).",
              );
            const addon = await nativeResolver({
              action: "addon",
              url: body.url,
            });
            s.addons = [
              ...(s.addons || []).filter((a) => a.url !== addon.url),
              { url: addon.url, name: addon.name.slice(0, 80) },
            ];
          } else {
            if (
              typeof body.username !== "string" ||
              !body.username.trim() ||
              body.username.length > 120 ||
              typeof body.password !== "string" ||
              !body.password ||
              body.password.length > 256
            )
              throw new HttpError(
                400,
                "Vyplň přihlašovací údaje poskytovatele.",
              );
            await nativeResolver({
              action: "login",
              provider,
              username: body.username.trim(),
              password: body.password,
            });
            s[provider] = {
              username: body.username.trim(),
              password: body.password,
            };
          }
          // Provider secrets are encrypted in the HttpOnly session cookie.
          writeSession(res, s);
          json(res, 200, { connected: true });
          return true;
        }
      }
      const searchRoute =
        /^sources\/([1-9]\d*)\/(webshare|hellspy|native)$/.exec(target);
      if (searchRoute && req.method === "GET") {
        cleanQuery(url, ["episode_id"], language);
        const titleID = Number(searchRoute[1]),
          provider = searchRoute[2];
        if (provider === "webshare" && !s.webshare?.token) {
          json(res, 200, {
            streams: [],
            state: "not_connected",
            message:
              "Připoj Webshare a zpřístupníš i živé hledání mimo databáze.",
          });
          return true;
        }
        const title = await call(
          s,
          `titles/${titleID}?lang=${language}&expand=seasons`,
        );
        let episode = null;
        if (url.searchParams.has("episode_id")) {
          const id = Number(url.searchParams.get("episode_id"));
          for (const season of title.seasons || [])
            for (const e of season.episodes || [])
              if (e.id === id)
                episode = { ...e, season_number: season.season_number };
          if (!episode)
            throw new HttpError(404, "Epizoda nepatří k tomuto titulu.");
        }
        if (title.type === "tv" && !episode)
          throw new HttpError(400, "Nejdřív vyber konkrétní epizodu.");
        const cacheKey = crypto
          .createHash("sha256")
          .update(
            JSON.stringify([
              s.token,
              s.device,
              s.profile.id,
              s.grant,
              s.webshare?.token,
              s.fastshare,
              s.sosac,
              s.addons,
              titleID,
              episode?.id,
              provider,
            ]),
          )
          .digest("hex");
        for (const [k, v] of sourceSearches)
          if (v.expires < Date.now()) sourceSearches.delete(k);
        let entry = sourceSearches.get(cacheKey);
        if (!entry) {
          if (sourceSearches.size >= 100)
            throw new HttpError(
              429,
              "Hledá příliš mnoho uživatelů. Zkus to za chvíli.",
            );
          entry = {
            expires: Date.now() + 60000,
            promise:
              provider === "native"
                ? nativeResolver({
                    action: "search",
                    // Resolver čte jen tato pole; celý detail (řady, epizody) by
                    // u velkých titulů přesáhl jeho 64KB limit vstupu.
                    title: {
                      title: title.title,
                      original_title: title.original_title,
                      type: title.type,
                      year: title.year,
                      imdb_id: title.imdb_id,
                      tmdb_id: title.tmdb_id,
                    },
                    season: episode?.season_number,
                    episode: episode?.episode_number,
                    fastshare: s.fastshare,
                    sosac: s.sosac,
                    addons: s.addons,
                  })
                : liveSources.search(
                    provider,
                    title,
                    episode,
                    s.webshare?.token,
                    providerClient.searchFiles,
                  ),
          };
          sourceSearches.set(cacheKey, entry);
        }
        let result;
        try {
          result = await timed("bff_source_discovery", () => entry.promise);
        } catch (e) {
          sourceSearches.delete(cacheKey);
          throw e;
        }
        json(res, 200, {
          ...result,
          state: "ready",
          streams: result.streams.map(
            ({ direct_url, headers, origin, ...stream }) => {
              let resolverID;
              if (provider === "native") {
                for (const [key, entry] of nativeSelections)
                  if (entry.expires < Date.now()) nativeSelections.delete(key);
                if (nativeSelections.size >= 10000)
                  throw new HttpError(503, "Vyhledávání zdrojů je vytížené.");
                resolverID = crypto.randomBytes(24).toString("hex");
                nativeSelections.set(resolverID, {
                  direct_url,
                  headers,
                  origin,
                  ident: stream.source_stream_id,
                  expires: Date.now() + 12 * 60 * 60 * 1000,
                });
              }
              return {
                ...stream,
                ...(resolverID
                  ? {
                      id: resolverID,
                      source_stream_id: null,
                      can_upload: Boolean(stream.source_stream_id),
                    }
                  : {}),
                ticket: sourceTickets.issue(s, {
                  provider:
                    provider === "native" ? stream.provider_name : provider,
                  resolver_id: resolverID,
                  ident: resolverID ? null : stream.source_stream_id,
                  file_name: stream.file_name,
                  title_id: titleID,
                  episode_id: episode?.id || null,
                }),
                ...(stream.source_stream_id && !/[?]/.test(stream.source_stream_id) && !/stremio|cinema/i.test(stream.provider_name || provider) ? {
                  resume_ticket: resumeTickets.issue({ accountId: accountUser.id, profile: s.profile }, {
                    provider: provider === "native" ? stream.provider_name : provider,
                    ident: stream.source_stream_id, origin,
                    file_name: stream.file_name, title_id: titleID, episode_id: episode?.id || null,
                  }),
                } : {}),
                available: stream.available !== false,
              };
            },
          ),
        });
        return true;
      }
      if (
        ["playback", "download", "streams/report", "streams/upload"].includes(
          target,
        ) &&
        req.method === "POST"
      ) {
        const body = objectBody(await readBody(req, 4096));
        // Ověření zvukových stop by vyžadovalo číst video na serveru (#153).
        if (target === "streams/upload")
          throw Object.assign(appRequired("stream_upload"), {
            message: "Přidání zdroje do databáze je dostupné v aplikaci Movly.",
          });
        if (!integer(body.title_id))
          throw new HttpError(400, "Vyber platný titul.");
        if (body.episode_id !== undefined && !integer(body.episode_id))
          throw new HttpError(400, "Neplatná epizoda.");
        const title = await call(s, `titles/${body.title_id}?lang=${language}`);
        let provider, ident, fileName, sourceMetadata;
        if (body.source === "live" || body.source === "resume") {
          let selected;
          try {
            selected = body.source === "resume"
              ? resumeTickets.read({ accountId: accountUser.id, profile: s.profile }, body.ticket)
              : sourceTickets.read(s, body.ticket);
          } catch (e) {
            throw new HttpError(403, e.message);
          }
          if (
            selected.title_id !== body.title_id ||
            selected.episode_id !== (body.episode_id || null)
          )
            throw new HttpError(
              403,
              "Zdroj patří k jinému titulu nebo epizodě.",
            );
          sourceMetadata = selected.resolver_id
            ? nativeSelections.get(selected.resolver_id)
            : selected;
          if (
            !sourceMetadata ||
            (selected.resolver_id && sourceMetadata.expires < Date.now())
          )
            throw new HttpError(410, "Zdroj vypršel. Vyhledej jej znovu.");
          provider = selected.provider;
          ident = sourceMetadata.ident;
          fileName = selected.file_name;
        } else {
          if (
            !integer(body.stream_id) ||
            !["human", "ai"].includes(body.source)
          )
            throw new HttpError(400, "Vyber platný zdroj titulu.");
          const data = await call(
            s,
            `streaming${body.source === "ai" ? "2" : ""}/titles/${body.title_id}/streams?limit=100${body.source === "ai" ? `&type=${title.type}` : ""}${body.episode_id ? `&episode_id=${body.episode_id}` : ""}`,
          );
          const stream = data.streams?.find((x) => x.id === body.stream_id);
          if (
            !stream ||
            (stream.available === false && target !== "streams/report")
          )
            throw new HttpError(422, "Zdroj není dostupný.");
          sourceMetadata = stream;
          provider = (
            stream.provider_name ||
            stream.provider_identifier ||
            ""
          ).toLowerCase();
          ident = stream.source_stream_id;
          fileName = stream.file_name;
        }
        if (target === "streams/report") {
          if (!["human", "ai"].includes(body.source))
            throw new HttpError(400, "Nahlásit lze zdroj uložený v databázi.");
          if (
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            body.reason.length > 500
          )
            throw new HttpError(
              400,
              "Vyplň důvod hlášení (nejvýše 500 znaků).",
            );
          json(
            res,
            200,
            await call(s, `${reportSources[body.source]}/`, "POST", {
              stream_id: Number(body.stream_id),
              reason: body.reason.trim(),
            }),
          );
          return true;
        }
        let link, resolvedHeaders;
        if (provider === "webshare") {
          if (!s.webshare?.token)
            throw new HttpError(
              409,
              "Nejdřív připoj účet Webshare v nastavení.",
            );
          try { link = await timed("bff_source_resolve", () => providerClient.resolve(s.webshare.token, ident)); }
          catch (error) { error.diagnosticStage = "source_resolve"; throw error; }
        } else if (
          provider === "hellspy" &&
          /^[1-9]\d*\/[a-zA-Z0-9_-]{1,128}$/.test(ident || "")
        ) {
          try { link = await timed("bff_source_resolve", () => providerClient.resolveHellspy(ident)); }
          catch (error) { error.diagnosticStage = "source_resolve"; throw error; }
        } else {
          if (!nativeProviders.supported.test(provider))
            throw new HttpError(422, "Neznámý poskytovatel zdroje.");
          const resolved = await timed("bff_source_resolve", () => nativeResolver({
            action: "resolve",
            source: {
              provider,
              ident,
              origin: sourceMetadata?.origin,
              direct_url: sourceMetadata?.direct_url,
              headers: sourceMetadata?.headers,
            },
            fastshare: s.fastshare,
            sosac: s.sosac,
            addons: s.addons,
          })).catch(error => { error.diagnosticStage = "source_resolve"; throw error; });
          link = resolved.url;
          resolvedHeaders = resolved.headers;
        }
        let direct;
        try {
          direct = directSource(link, resolvedHeaders, provider);
        } catch (error) {
          error.diagnosticStage = "source_resolve";
          throw error;
        }
        if (target === "download") {
          const filename = (fileName || `${title.title || "movly-video"}.mkv`)
            .replace(/[\x00-\x1f\x7f/\\]/g, "_")
            .slice(0, 240);
          json(res, 200, { ...direct, filename });
          return true;
        }
        json(res, 200, direct);
        return true;
      }
      if (
        /^party(?:\/v2)?\/[a-f0-9]{32}\/events$/.test(target) &&
        req.method === "GET"
      ) {
        await call(s, "watchlists?lang=cs");
        if (!partyStream)
          throw new HttpError(503, "Spojení party není dostupné.");
        await partyStream(
          target,
          s.token,
          s.device,
          { "X-Profile-ID": String(s.profile.id), ...(s.grant ? { "X-Profile-Grant": s.grant } : {}) },
          res,
        );
        return true;
      }
      const rule = routes.find(
        ([method, pattern]) => method === req.method && pattern.test(target),
      );
      if (!rule)
        throw new HttpError(
          404,
          "Tato funkce není ve webové aplikaci dostupná.",
        );
      let query = target === "titles/batch" ? "" : /^sync\/v2\/profile-data\/(?:snapshot|changes)$/.test(target)
        ? cleanPersonalDataQuery(url, rule[2])
        : cleanQuery(url, rule[2], language);
      if (target === "profiles/effective-content-policy") {
        try {
          json(res, 200, await call(s, target + query));
        } catch (error) {
          // An API without this route (#1091) matches GET /profiles/:id and answers
          // 400 "Invalid profile ID". Report that exact answer as an unsupported
          // endpoint, so the client verifies the legacy profile policy as for 404.
          if (error?.status === 400 && error.payload?.error === "Invalid profile ID")
            throw new HttpError(404, "Server zatím nepodporuje souhrnnou politiku profilu.", {
              code: "effective_policy_unsupported",
            });
          throw error;
        }
        return true;
      }
      if (target === "autocomplete" && (!url.searchParams.get("q")?.trim() || url.searchParams.get("q").length > 100))
        throw new HttpError(400, "Zadej hledaný výraz o délce 1 až 100 znaků.");
      if (target === "home") {
        if (!Number.isSafeInteger(account.id) || account.id < 1) throw new HttpError(502, "API vrátilo neplatný účet.");
        const currentScope = async () => {
          const current = (await call(s, "profiles")).find(p => p.id === s.profile.id);
          if (!current) throw new HttpError(403, "Profil již není dostupný.");
          return { account_id: account.id, profile_id: current.id,
            is_kids: current.is_kids === true, max_certification: current.max_certification ?? 18,
            allow_unrated: current.allow_unrated === true };
        };
        const before = await currentScope();
        let result;
        try { result = await call(s, target + query); }
        catch (error) {
          const scope = await currentScope();
          const unavailable = new HttpError(error.status || 502, "Domů se nepodařilo načíst.", { code: error.payload?.code || "home_unavailable" });
          unavailable.homeViewerScope = scope;
          throw unavailable;
        }
        const scope = await currentScope();
        if (JSON.stringify(before) !== JSON.stringify(scope)) {
          const changed = new HttpError(409, "Pravidla profilu se změnila. Zkusit znovu.", { code: "home_policy_changed" });
          changed.homeViewerScope = scope;
          throw changed;
        }
        json(res, 200, { ...result, viewer_scope: scope });
        return true;
      }
      if (/^tmdb\/[1-9]\d*$/.test(target) && !["movie", "tv"].includes(url.searchParams.get("type")))
        throw new HttpError(400, "Neplatný typ titulu.");
      if (/^titles\/[1-9]\d*$/.test(target))
        query +=
          "&expand=credits,seasons,collection,videos,ratings,streams,watch_history";
      if (target.startsWith("themed-lists/"))
        query += "&include_inactive=true&expand=watch_history,streams,ratings";
      if (
        target === "main" ||
        target.startsWith("main/lists/") ||
        /^titles\/\d+\/similar$/.test(target) ||
        /^people\/\d+\/filmography$/.test(target)
      )
        query += "&expand=watch_history,streams,ratings";
      let body = null;
      if (["POST", "PUT"].includes(req.method)) {
        body = objectBody(await readBody(req, 8192));
        if (target === "auth/premium/purchase") {
          if (!account.premiumPurchaseEnabled || account.isFromLight)
            throw new HttpError(
              403,
              "Nákup Premium není pro tento účet dostupný.",
            );
          if (!integer(body.plan_id))
            throw new HttpError(400, "Vyber platný plán Premium.");
          body = { plan_id: Number(body.plan_id) };
        } else if (target === "recommendations/action") {
          if (typeof body.request_id !== "string" || !body.request_id || body.request_id.length > 200 ||
              !integer(body.title_id) || !["view", "click"].includes(body.action) ||
              !Number.isSafeInteger(body.position) || body.position < 1 || body.position > 10000 ||
              typeof body.section !== "string" || !body.section || body.section.length > 100 ||
              typeof body.list_slug !== "string" || !body.list_slug || body.list_slug.length > 100 ||
              (body.seed_title_id != null && !integer(body.seed_title_id)))
            throw new HttpError(400, "Neplatná událost doporučení.");
          body = { request_id: body.request_id, title_id: Number(body.title_id), action: body.action,
            position: body.position, section: body.section, list_slug: body.list_slug,
            ...(body.seed_title_id ? { seed_title_id: Number(body.seed_title_id) } : {}), device_type: "web", platform: "web" };
        } else if (target === "track-search") {
          if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500 ||
              !integer(body.title_id) || body.interaction_type !== "click" ||
              !Number.isSafeInteger(body.position_in_results) || body.position_in_results < 1 || body.position_in_results > 1000) {
            throw new HttpError(400, "Neplatná událost hledání.");
          }
          body = { query: body.query.trim(), title_id: Number(body.title_id), interaction_type: "click",
            position_in_results: body.position_in_results, language };
        } else if (target === "titles/batch") {
          if (!Array.isArray(body.items) || body.items.length > 50 || !["cs", "sk", "en"].includes(language))
            throw new HttpError(400, "Neplatná dávka katalogových titulů.");
          body = { items: body.items, language };
        } else if (target === "user/hidden-titles") {
          if (!integer(body.title_id) || body.source !== "continue_watching")
            throw new HttpError(400, "Neplatné skrytí titulu.");
          body = {
            title_id: Number(body.title_id),
            source: "continue_watching",
          };
        } else if (target === "sync/v2/mutations") {
          const raw = body;
          const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
          if (
            !uuid.test(raw.device_id || "") ||
            !uuid.test(raw.mutation_id || "") ||
            raw.entity_type !== "watch_history" ||
            !/^title:[1-9]\d*:season:(?:null|\d+):episode:(?:null|\d+)$/.test(
              raw.entity_key || "",
            ) ||
            !Number.isSafeInteger(raw.base_version) ||
            raw.base_version < 0 ||
            raw.operation !== "upsert"
          )
            throw new HttpError(400, "Neplatná offline synchronizace.");
          const value = objectBody(raw.value),
            keys = [
              "title_id",
              "season_number",
              "episode_number",
              "progress_seconds",
              "duration_seconds",
              "watch_status",
              "rating",
              "notes",
              "is_favorite",
              "device_type",
              "platform",
              "provider_id",
              "ident",
            ];
          if (
            keys.some((key) => !Object.hasOwn(value, key)) ||
            Object.keys(value).some((key) => !keys.includes(key))
          )
            throw new HttpError(400, "Neúplná offline historie.");
          body = {
            device_id: raw.device_id,
            mutation_id: raw.mutation_id,
            entity_type: raw.entity_type,
            entity_key: raw.entity_key,
            base_version: raw.base_version,
            operation: raw.operation,
            value,
          };
        } else if (/^sync\/v2\/conflicts\/[1-9]\d*\/resolve$/.test(target)) {
          const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
          if (
            !uuid.test(body.device_id || "") ||
            !uuid.test(body.mutation_id || "") ||
            !["local", "server"].includes(body.resolution) ||
            !Number.isSafeInteger(body.expected_server_version) ||
            body.expected_server_version < 0
          )
            throw new HttpError(400, "Neplatná volba historie.");
          body = {
            device_id: body.device_id,
            mutation_id: body.mutation_id,
            resolution: body.resolution,
            expected_server_version: body.expected_server_version,
          };
        } else if (
          /^integrations\/(?:trakt|simkl)\/authorization\/poll$/.test(target)
        ) {
          if (
            typeof body.id !== "string" ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.id)
          )
            throw new HttpError(400, "Neplatný kód propojení.");
          body = { id: body.id };
        } else if (target.startsWith("integrations/")) {
          body = {};
        } else if (target === "party" || target === "party/v2") {
          if (
            !integer(body.title_id) ||
            (body.episode_id != null && !integer(body.episode_id))
          )
            throw new HttpError(400, "Neplatný titul party.");
          body = {
            title_id: body.title_id,
            ...(body.episode_id != null ? { episode_id: body.episode_id } : {}),
          };
        } else if (target === "party/join" || target === "party/v2/join") {
          if (typeof body.code !== "string" || !/^[A-Z0-9]{6}$/.test(body.code))
            throw new HttpError(400, "Neplatný kód party.");
          body = { code: body.code };
        } else if (/^party(?:\/v2)?\/[a-f0-9]{32}\/preparation$/.test(target)) {
          if (
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
              body.device_id || "",
            ) ||
            !["register", "start", "ready", "leave"].includes(body.action) ||
            typeof body.is_host !== "boolean" ||
            typeof body.ready !== "boolean" ||
            (target.startsWith("party/v2/") && body.expected_round != null && (!Number.isSafeInteger(body.expected_round) || body.expected_round < 0))
          )
            throw new HttpError(400, "Neplatná příprava party.");
          body = {
            device_id: body.device_id,
            action: body.action,
            is_host: body.is_host,
            ready: body.ready,
            ...(target.startsWith("party/v2/") && body.expected_round !== undefined ? { expected_round: body.expected_round } : {}),
          };
        } else if (/^party(?:\/v2)?\/[a-f0-9]{32}\/state$/.test(target)) {
          if (
            !["playing", "paused"].includes(body.status) ||
            !Number.isFinite(body.position_sec) ||
            body.position_sec < 0
          )
            throw new HttpError(400, "Neplatná pozice party.");
          body = { status: body.status, position_sec: body.position_sec };
        } else if (/^party(?:\/v2)?\/[a-f0-9]{32}\/leave$/.test(target)) {
          body = {};
        } else if (target === "friends/privacy") {
          const raw = body;
          body = {};
          for (const k of [
            "activity_opt_in",
            "show_completed",
            "show_ratings",
          ]) {
            if (typeof raw[k] !== "boolean")
              throw new HttpError(400, "Neplatné nastavení soukromí.");
            body[k] = raw[k];
          }
        } else if (target === "friends/requests") {
          if (
            typeof body.username !== "string" ||
            !body.username.trim() ||
            body.username.length > 255
          )
            throw new HttpError(400, "Zadej uživatelské jméno.");
          body = { username: body.username.trim() };
        } else if (/^friends\/.+\/(?:accept|block)$/.test(target)) {
          body = null;
        } else if (target.endsWith("/public-link")) {
          body = null;
        } else if (target.endsWith("/shares")) {
          if (
            typeof body.username !== "string" ||
            !body.username.trim() ||
            body.username.length > 100
          )
            throw new HttpError(400, "Zadej uživatelské jméno.");
          body = { username: body.username.trim() };
        } else if (target === "ratings") {
          if (
            typeof body.rating !== "number" ||
            !Number.isFinite(body.rating) ||
            body.rating < 0 ||
            body.rating > 10
          )
            throw new HttpError(400, "Hodnocení musí být od 0 do 10.");
          body = { rating: body.rating, is_public: body.is_public === true };
        } else if (target === "watch-history/season") {
          if (
            !integer(body.title_id) ||
            !Number.isSafeInteger(body.season_number) ||
            body.season_number < 1 ||
            body.season_number > 1000 ||
            !["completed", "plan_to_watch"].includes(body.watch_status)
          )
            throw new HttpError(400, "Neplatná řada.");
          body = {
            title_id: Number(body.title_id),
            season_number: body.season_number,
            watch_status: body.watch_status,
          };
        } else if (target === "watch-history") {
          if (
            !integer(body.title_id) ||
            !["movie", "tv"].includes(body.type) ||
            !["watching", "completed", "plan_to_watch", "dropped"].includes(
              body.watch_status,
            )
          )
            throw new HttpError(400, "Neplatný stav sledování.");
          const raw = body;
          body = {
            title_id: Number(raw.title_id),
            type: raw.type,
            watch_status: raw.watch_status,
            device_type: "web",
            platform: "web",
          };
          for (const k of [
            "progress_seconds",
            "duration_seconds",
            "season_number",
            "episode_number",
          ])
            if (raw[k] !== undefined) {
              if (
                !Number.isSafeInteger(raw[k]) ||
                raw[k] < 0 ||
                raw[k] > 10000000
              )
                throw new HttpError(400, "Neplatná pozice přehrávání.");
              body[k] = raw[k];
            }
        } else if (/^saved-filters(?:\/[1-9]\d*)?$/.test(target)) {
          if (Object.keys(body).some((key) => !["name", "filter"].includes(key)) ||
              typeof body.name !== "string" || !body.name.trim() || [...body.name.trim()].length > 60)
            throw new HttpError(400, "Název filtru musí mít 1 až 60 znaků.");
          const filter = objectBody(body.filter);
          // Keep the canonical document intact. The core API owns semantic
          // normalization and range validation; this gateway checks its shape.
          const strings = new Set(["type", "genre_match", "audio_language", "original_language", "sort_by", "sort_order"]);
          const integers = new Set(["year_from", "year_to", "runtime_from", "runtime_to", "video_height_min"]);
          const numbers = new Set(["rating_from", "rating_to"]);
          const booleans = new Set(["hdr", "has_streams"]);
          const lists = new Set(["audio_languages", "subtitle_languages", "original_languages", "countries"]);
          for (const [key, value] of Object.entries(filter)) {
            const nullable = value === null;
            const valid = strings.has(key) ? nullable || typeof value === "string"
              : integers.has(key) ? nullable || Number.isSafeInteger(value)
              : numbers.has(key) ? nullable || (typeof value === "number" && Number.isFinite(value))
              : booleans.has(key) ? nullable || typeof value === "boolean"
              : lists.has(key) ? nullable || (Array.isArray(value) && value.every((item) => typeof item === "string"))
              : key === "genre_ids" ? nullable || (Array.isArray(value) && value.every(Number.isSafeInteger))
              : false;
            if (!valid) throw new HttpError(400, "Neplatné nastavení filtru.");
          }
          body = { name: body.name.trim(), filter };
        } else if (target.endsWith("/items")) {
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
      const result = await call(
        s,
        `${rule[3] || target}${query}`,
        req.method,
        body,
        target === "search"
          ? { "X-Movly-Search-Purpose": Number(url.searchParams.get("offset") || 0) === 0 ? "user-query" : "pagination" }
          : target === "titles/filter/facets" ? { "X-Movly-Facets-Policy": "scoped-v1" }
          : /^streaming2?\//.test(target) ? { "X-Cache-Refresh": "true" } : {},
      );
      if (
        target.endsWith("/public-link") &&
        req.method === "POST" &&
        result?.active &&
        /^[a-zA-Z0-9_-]+$/.test(result.token || "")
      ) {
        result.url = new URL(
          `v1/shared/${result.token}`,
          (process.env.MOVLY_API_BASE || "https://api.movly.top").replace(
            /\/?$/,
            "/",
          ),
        ).href;
      }
      json(res, 200, result);
    } catch (error) {
      if (upstreamController?.signal.aborted) {
        if (!res.destroyed && !req.aborted) json(res, 504, { message: target === "home" ? "Domů se nepodařilo načíst včas." : "Sběr diagnostiky není dostupný.", code: target === "home" ? "home_unavailable" : "telemetry_unavailable" });
        return true;
      }
      // Invalid PIN and optional telemetry must not mutate the login session.
      // Diagnostics still retain their real status/code instead of empty content.
      if (error.status === 401 && target !== "profile" && target !== "login" && target !== "telemetry/client" && target !== "telemetry/playback-attempts" && !(req.method === "POST" && target === "capabilities/negotiate"))
        writeSession(res, null, s);
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (
        status === 409 &&
        target.startsWith("sync/v2/") &&
        error.payload?.status === "conflict" &&
        error.payload?.conflict?.id > 0 &&
        typeof error.payload.mutation_id === "string"
      ) {
        json(res, 409, {
          ...error.payload,
          message: "Historie se změnila na jiném zařízení.",
        });
        return true;
      }
      const personalDataReset = error.payload;
      if (
        status === 410 &&
        /^sync\/v2\/profile-data\/(?:snapshot|changes)$/.test(target) &&
        personalDataReset?.code === "personal_delta_reset_required" &&
        ["expired", "retention", "policy_changed", "catalog_changed", "environment_changed"].includes(personalDataReset.reason) &&
        personalDataReset.reset_required === true &&
        personalDataReset.preserve_pending_mutations === true &&
        personalDataReset.snapshot_path === "/sync/v2/profile-data/snapshot"
      ) {
        json(res, 410, {
          message: "Osobní data je potřeba znovu synchronizovat.",
          code: "personal_delta_reset_required",
          reason: personalDataReset.reason,
          reset_required: true,
          preserve_pending_mutations: true,
          snapshot_path: "/sync/v2/profile-data/snapshot",
        });
        return true;
      }
      if (status >= 500) {
        console.error(
          `[Movly web] app ${req.method} ${target} -> ${status}: ${error.message}`,
          error.stack || "",
        );
      }
      const retry = error.headers?.get("retry-after");
      if (retry && /^\d+$/.test(retry)) res.setHeader("Retry-After", retry);
      const personalDataRoute = /^sync\/v2\/profile-data\/(?:snapshot|changes)$/.test(target);
      json(res, status, {
        message: personalDataRoute && status === 410
          ? "Osobní data se nepodařilo synchronizovat."
          : error.message || "Požadavek se nepodařilo dokončit.",
        code: personalDataRoute && status === 410
          ? null
          : error.code || error.payload?.code || null,
        ...(target === "home" && error.homeViewerScope ? { viewer_scope: error.homeViewerScope } : {}),
        ...(["source_resolve", "video_analysis", "playback"].includes(error.diagnosticStage) ? { diagnostic_stage: error.diagnosticStage } : {}),
      });
    } finally {
      clearTimeout(upstreamDeadline);
      if (upstreamController) { res.removeListener?.("close", abortUpstream); req.removeListener?.("aborted", abortUpstream); }
    }
    return true;
  };
}
module.exports = { createAppHandler };
