// TheIntroDB v4: klientský lookup segmentů přímo z prohlížeče a sloučení se segmenty
// z /v1/playback/segments. Závazný kontrakt: shebincze/Movly contracts/playback-segments
// (README.md, cases.json, reference.py; movly-web#166, Movly#1117).
// Podmínky TheIntroDB (§4.1, §4.3, §6.1) dovolují jen volání ze zařízení uživatele a jen
// dočasnou klientskou cache. Proto: žádný BFF ani server.js, žádné vlastní hlavičky,
// cookies ani credentials a výsledky jen v paměti stránky (Map), nikdy ve storage.
export const THEINTRODB = Object.freeze({
  baseUrl: "https://api.theintrodb.org/v4/media",
  minDurationMs: 5000,
  maxDurationMs: 21600000,
  maxBodyBytes: 262144,
  maxSpansPerKind: 20,
  maxSegments: 20,
  releaseToleranceMs: 90000,
  lowConfidence: 0.5,
  agreementMs: 2000,
  errorCooldownMs: 30000,
  rateLimitDefaultMs: 60000,
  cooldownMaxMs: 86400000,
  requestTimeoutMs: 5000,
  sessionCacheMaxAgeMs: 3600000,
  sessionCacheMaxEntries: 50,
});
const C = THEINTRODB;
const isInt = (v) => Number.isSafeInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const tmdbOk = (v) => isInt(v) && v >= 1 && v <= 10000000;
const imdbOk = (v) => typeof v === "string" && /^tt[0-9]{7,8}$/.test(v);
const byteLength = (text) => new TextEncoder().encode(text).length;

// ---- Identita a požadavek (README §1) ----

// Identita z dat přehrávače: tmdb_id titulu (u dílu seriálu), TMDB season/episode dílu.
// tvdbId web spolehlivě nezná (Movly ho nemá ověřené), proto null: slouží jen ke kontrole.
export function theIntroDbIdentity({ movie, episode, tmdbId, imdbId, durationMs }) {
  return {
    kind: movie ? "movie" : "episode",
    tmdbId: tmdbOk(tmdbId) ? tmdbId : null,
    imdbId: typeof imdbId === "string" && imdbId ? imdbId : null,
    tvdbId: null,
    season: movie ? null : episode?.season_number ?? null,
    episode: movie ? null : episode?.episode_number ?? null,
    durationMs,
  };
}
function identityOk(i) {
  const d = i?.durationMs;
  if (!isInt(d) || d < C.minDurationMs || d > C.maxDurationMs) return false;
  if (i.kind === "episode")
    return tmdbOk(i.tmdbId) && isInt(i.season) && i.season >= 1 && i.season <= 1000 && isInt(i.episode) && i.episode >= 1 && i.episode <= 10000;
  if (i.kind === "movie") {
    if (i.season != null || i.episode != null) return false;
    return tmdbOk(i.tmdbId) || imdbOk(i.imdbId);
  }
  return false;
}
const address = (i) => (tmdbOk(i.tmdbId) ? ["tmdb_id", String(i.tmdbId)] : ["imdb_id", i.imdbId]);
// Pevné pořadí parametrů; tvdb_id se nikdy neposílá jako adresa.
export function theIntroDbRequest(i) {
  if (!identityOk(i)) return null;
  const [name, value] = address(i);
  const q = [[name, value]];
  if (i.kind === "episode") q.push(["season", String(i.season)], ["episode", String(i.episode)]);
  q.push(["duration_ms", String(Math.floor(i.durationMs / 1000) * 1000)], ["details", "true"]);
  return `${C.baseUrl}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
export function theIntroDbCacheKey(i) {
  if (!identityOk(i)) return null;
  const [name, value] = address(i);
  return `tidb:v4:${name === "tmdb_id" ? "tmdb" : "imdb"}:${value}:${i.season || 0}:${i.episode || 0}:${Math.floor(i.durationMs / 1000)}`;
}

// ---- Segmenty ----

export function validSegment(kind, start, end, duration) {
  if (start < 0 || end <= start || end - start < 2000) return false;
  if (kind === "intro") return end < duration - 2000;
  if (kind === "recap") return end < duration - 2000 && end - start <= 1200000;
  if (kind === "credits") return end <= duration && start < duration - 2000 && end - start <= 1800000;
  if (kind === "post_credits") return end <= duration;
  return false;
}
// 0 znamená „segment neexistuje“; titulky se start 0 / end null se nikdy neroztáhnou přes soubor.
function normalizeSpan(kind, s, e, duration) {
  let start, end;
  if (kind === "intro" || kind === "recap") {
    start = s === null ? 0 : s;
    if (e === null || e === 0) return null;
    end = e;
  } else {
    if (s === null || s === 0 || e === 0) return null;
    start = s;
    end = e === null ? duration : e;
  }
  if (start < 0) return null;
  start = Math.floor(start); end = Math.floor(end);
  if (end > duration) {
    if (kind !== "credits" || end - duration > C.releaseToleranceMs) return null;
    end = duration;
  }
  return validSegment(kind, start, end, duration) ? [start, end] : null;
}

// ---- Odpověď → výsledek (README §2) ----

const none = (reason) => ({ result: "none", reason });
const error = (reason, ms, scope = "global") => ({ result: "error", reason, cooldown: { scope, ms } });
function header(headers, name) {
  for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === name) return String(v);
  return null;
}
function cooldown429(headers, body, nowMs) {
  let ms = null;
  const retryAfter = header(headers, "retry-after")?.trim();
  if (retryAfter != null) {
    if (/^[0-9]+$/.test(retryAfter)) {
      if (Number(retryAfter) > 0) ms = Number(retryAfter) * 1000;
    } else if (/[A-Za-z]/.test(retryAfter)) {
      // HTTP-date; čistě číselné nebo jiné tvary Date.parse neinterpretuje (bez „1.5“ = leden).
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at) && at > nowMs) ms = at - nowMs;
    }
  }
  if (ms === null) {
    const resets = [];
    for (const name of ["x-ratelimit-reset", "x-usagelimit-reset", "x-usagelimit-specificmedia-reset"]) {
      const v = header(headers, name)?.trim();
      if (v != null && /^[0-9]+$/.test(v) && Number(v) > 0) resets.push(Number(v) * 1000);
    }
    ms = resets.length ? Math.max(...resets) : C.rateLimitDefaultMs;
  }
  ms = Math.min(ms, C.cooldownMaxMs);
  const scope = isObject(body) && body.code === "specific_media_usage_limit_exceeded" ? "media" : "global";
  return error("rate_limited", ms, scope);
}
// response: {status: číslo | null (síťová chyba, timeout, CORS), headers: {…}, bodyText, tooLarge?}
export function parseTheIntroDb(i, response, nowMs) {
  const status = response?.status ?? null;
  if (status === null) return error("network", C.errorCooldownMs);
  const text = typeof response.bodyText === "string" ? response.bodyText : "";
  const tooLarge = response.tooLarge === true || byteLength(text) > C.maxBodyBytes;
  let body = null, parsed = false;
  if (!tooLarge) try { body = JSON.parse(text); parsed = true; } catch { /* malformed */ }
  if (status === 404) return none("not_found");
  if (status === 400 || status === 422) return none("bad_request");
  if (status === 429) return cooldown429(response.headers, body, nowMs);
  if (status !== 200) return error("status", C.errorCooldownMs);
  if (tooLarge) return error("too_large", C.errorCooldownMs);
  if (!parsed) return error("malformed", C.errorCooldownMs);
  if (!isObject(body)) return none("invalid_schema");
  if (body.type !== (i.kind === "episode" ? "tv" : "movie")) return none("identity_mismatch");
  if (!isInt(body.tvdb_id) || body.tvdb_id < 1) return none("invalid_schema");
  if (isInt(i.tvdbId) && i.tvdbId >= 1 && i.tvdbId !== body.tvdb_id) return none("identity_mismatch");
  if (body.episodes != null) return none("episode_list");
  if (body.versions != null) return none("versions");
  if (i.kind === "episode") {
    if (!isInt(body.season) || !isInt(body.episode) || body.season !== i.season || body.episode !== i.episode) return none("identity_mismatch");
  } else if (body.season != null || body.episode != null) return none("identity_mismatch");
  const duration = i.durationMs, spans = {};
  for (const field of ["intro", "recap", "credits", "preview"]) {
    const v = body[field];
    if (v == null) continue;
    if (!Array.isArray(v) || v.length > C.maxSpansPerKind) return none("invalid_schema");
    const items = [];
    for (const item of v) {
      if (!isObject(item)) return none("invalid_schema");
      const s = item.start_ms ?? null, e = item.end_ms ?? null;
      if ((s !== null && !isNum(s)) || (e !== null && !isNum(e))) return none("invalid_schema");
      items.push([s, e, isNum(item.confidence) ? item.confidence : null]);
    }
    spans[field] = items;
  }
  const group = body.group_duration_ms;
  if (isNum(group) && group > 0 && Math.abs(group - duration) > C.releaseToleranceMs) delete spans.credits;
  const out = [];
  for (const kind of ["intro", "recap", "credits"]) // preview se validuje, ale nenabízí
    for (const [s, e, conf] of spans[kind] || []) {
      const span = normalizeSpan(kind, s, e, duration);
      if (span) out.push({ kind, start_ms: span[0], end_ms: span[1], trusted: conf === null || conf >= C.lowConfidence });
    }
  return out.length ? { result: "segments", segments: out } : none("no_segments");
}

// ---- Sloučení se serverem (README §3) ----

// theintrodb: výsledek parse, nebo null (lookup se nedělal); server: odpověď /v1/playback/segments, nebo null.
export function mergePlaybackSegments(durationMs, theintrodb, server, nowS) {
  const stale = theintrodb?.result === "error" || !isObject(server) || server.stale === true
    || !isInt(server.expires_at) || server.expires_at <= nowS;
  const primaryAll = theintrodb?.result === "segments" && Array.isArray(theintrodb.segments) ? theintrodb.segments : [];
  const fallbackAll = isObject(server) && Array.isArray(server.segments)
    ? server.segments.filter((s) => isObject(s) && s.source !== "theintrodb" && isInt(s.start_ms) && isInt(s.end_ms)) : [];
  const out = [];
  for (const kind of ["intro", "recap", "credits", "post_credits"]) {
    const primary = kind === "post_credits" ? [] : primaryAll.filter((s) => s.kind === kind && validSegment(kind, s.start_ms, s.end_ms, durationMs));
    const fallback = fallbackAll.filter((s) => s.kind === kind && validSegment(kind, s.start_ms, s.end_ms, durationMs));
    if (primary.length) {
      for (const p of primary) {
        const auto = !stale && (kind === "intro" || kind === "recap") && p.trusted === true && fallback.some((f) =>
          Math.abs(p.start_ms - f.start_ms) <= C.agreementMs && Math.abs(p.end_ms - f.end_ms) <= C.agreementMs);
        out.push(wire(kind, p.start_ms, p.end_ms, "theintrodb", auto));
      }
    } else for (const f of fallback) out.push(wire(kind, f.start_ms, f.end_ms, f.source || "introdb", false));
  }
  return out.sort((a, b) => a.start_ms - b.start_ms).slice(0, C.maxSegments); // sort je stabilní
}
const wire = (kind, start, end, source, auto) => ({ id: `${kind}:${start}:${end}`, kind, start_ms: start, end_ms: end, source, auto_eligible: auto });

// ---- HTTP a paměťová cache (README §1, §4, §5) ----

async function readCapped(response, abort) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return byteLength(text) > C.maxBodyBytes ? { text: "", tooLarge: true } : { text, tooLarge: false };
  }
  const decoder = new TextDecoder();
  let text = "", total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > C.maxBodyBytes) {
      reader.cancel().catch(() => {}); abort.abort();
      return { text: "", tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), tooLarge: false };
}
// Anonymní GET přímo z prohlížeče: žádné vlastní hlavičky (žádný CORS preflight), bez cookies,
// bez Referer. cache: "no-store" drží odpověď mimo HTTP cache prohlížeče (na disk nic).
export const THEINTRODB_FETCH_INIT = Object.freeze({ method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
export async function fetchTheIntroDb(url, { fetch: fetchImpl = (...args) => globalThis.fetch(...args), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const abort = new AbortController();
  const timer = setTimer(() => abort.abort(), C.requestTimeoutMs);
  try {
    const response = await fetchImpl(url, { ...THEINTRODB_FETCH_INIT, signal: abort.signal });
    const headers = {};
    response.headers?.forEach?.((value, name) => { headers[name] = value; });
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > C.maxBodyBytes) {
      abort.abort();
      return { status: response.status, headers, bodyText: "", tooLarge: true };
    }
    const { text, tooLarge } = await readCapped(response, abort);
    return { status: response.status, headers, bodyText: text, tooLarge };
  } catch {
    // Síťová chyba, timeout i zablokovaná CORS odpověď (TypeError) → status null = error network.
    return { status: null };
  } finally { clearTimer(timer); }
}
// Výsledky segments/none max 1 h a 50 záznamů (nejstarší ven), error se necachuje.
// Cooldown global/media také jen v paměti. Single-flight na klíč.
// Web: api.theintrodb.org dnes CORS pro jiné originy nepovoluje; po první síťové chybě se
// lookup do konce života stránky nezkouší (README §5), takže nespamuje a funguje hned,
// jakmile TheIntroDB origin povolí (další načtení stránky).
export function createTheIntroDbClient({ fetch: fetchImpl, now = () => Date.now(), setTimer, clearTimer } = {}) {
  const cache = new Map(), inflight = new Map(), media = new Map();
  let globalUntil = 0;
  const cached = (key, t) => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (t - entry.at >= C.sessionCacheMaxAgeMs) { cache.delete(key); return null; }
    return entry.value;
  };
  const bounded = (map, key, value) => {
    map.delete(key); map.set(key, value);
    while (map.size > C.sessionCacheMaxEntries) map.delete(map.keys().next().value);
  };
  const cooling = (key, t) => {
    if (t < globalUntil) return { scope: "global", ms: globalUntil - t };
    const until = media.get(key);
    if (until === undefined) return null;
    if (t < until) return { scope: "media", ms: until - t };
    media.delete(key); return null;
  };
  const record = (key, result, t) => {
    if (result.result !== "error") return bounded(cache, key, { value: result, at: t });
    if (result.reason === "network") globalUntil = Infinity;
    else if (result.cooldown.scope === "media") bounded(media, key, t + result.cooldown.ms);
    else globalUntil = Math.max(globalUntil, t + result.cooldown.ms);
  };
  // null = lookup se nedělá (identita to nedovolí); jinak výsledek parse nebo error cooldown.
  async function lookup(identity) {
    const url = theIntroDbRequest(identity), key = theIntroDbCacheKey(identity);
    if (!url || !key) return null;
    const t = now(), hit = cached(key, t);
    if (hit) return hit;
    const cooldown = cooling(key, t);
    if (cooldown) return { result: "error", reason: "cooldown", cooldown };
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const response = await fetchTheIntroDb(url, { fetch: fetchImpl, setTimer, clearTimer });
      const at = now(), result = parseTheIntroDb(identity, response, at);
      record(key, result, at);
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }
  return { lookup, get size() { return cache.size; }, get blocked() { return globalUntil > now(); } };
}
// Jedna instance na stránku: data jsou veřejná a nezávislá na profilu (README §4).
export const theIntroDb = createTheIntroDbClient();
