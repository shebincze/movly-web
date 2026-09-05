#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const { createAppHandler } = require('./app-server');
const ROOT_DIR = __dirname;
const PORT_RAW = process.env.MOVLY_WEB_PORT ?? process.env.PORT ?? '8080';
const API_BASE_RAW = process.env.MOVLY_API_BASE ?? 'https://api-go.shebin.eu';
const API_TIMEOUT_MS_RAW = process.env.MOVLY_API_TIMEOUT_MS ?? '15000';
const DOWNLOAD_TOKEN_TTL_SECONDS_RAW = process.env.DOWNLOAD_TOKEN_TTL_SECONDS ?? '300';
const DOWNLOAD_ROOT_RAW = process.env.DOWNLOAD_ROOT ?? path.join(ROOT_DIR, 'downloads');
const NODE_ENV_RAW = process.env.NODE_ENV;
const TRUSTED_PROXY_IPS_RAW = process.env.MOVLY_TRUSTED_PROXY_IPS ?? '';
const WINDOWS_UPDATE_PUBLIC_KEY_BASE64_RAW = process.env.MOVLY_WINDOWS_UPDATE_PUBLIC_KEY_BASE64
  ?? 'UXLKA+aihjFniVXysbc99gmWNummKaD7koXxfwbZ9RI=';
const PORT = parseStrictUnsignedInteger(PORT_RAW);
const API_BASE = API_BASE_RAW.replace(/\/+$/, '');
const API_KEY = process.env.MOVLY_API_KEY;
const API_TIMEOUT_MS = parseStrictUnsignedInteger(API_TIMEOUT_MS_RAW);
const DOWNLOAD_ROOT = path.resolve(DOWNLOAD_ROOT_RAW);
const DOWNLOAD_TOKEN_SECRET = process.env.DOWNLOAD_TOKEN_SECRET;
const DOWNLOAD_TOKEN_TTL_SECONDS = parseStrictUnsignedInteger(DOWNLOAD_TOKEN_TTL_SECONDS_RAW);
const setupErrors = [];
let TRUSTED_PROXY_IPS = new Set();
try {
  TRUSTED_PROXY_IPS = parseTrustedProxyIPs(TRUSTED_PROXY_IPS_RAW);
} catch (error) {
  setupErrors.push(`MOVLY_TRUSTED_PROXY_IPS není platný: ${error.message}`);
}
if (!API_KEY || API_KEY !== API_KEY.trim()) {
  setupErrors.push('MOVLY_API_KEY musí být nastavený bez okrajových mezer.');
}
if (!DOWNLOAD_TOKEN_SECRET || DOWNLOAD_TOKEN_SECRET !== DOWNLOAD_TOKEN_SECRET.trim()
    || Buffer.byteLength(DOWNLOAD_TOKEN_SECRET, 'utf8') < 24) {
  setupErrors.push('DOWNLOAD_TOKEN_SECRET musí být bez okrajových mezer a mít alespoň 24 UTF-8 bajtů.');
}
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
  setupErrors.push('MOVLY_WEB_PORT/PORT musí být celé číslo 1–65535 bez dalších znaků.');
}
if (!Number.isSafeInteger(API_TIMEOUT_MS) || API_TIMEOUT_MS < 100 || API_TIMEOUT_MS > 300000) {
  setupErrors.push('MOVLY_API_TIMEOUT_MS musí být celé číslo 100–300000 bez dalších znaků.');
}
if (!Number.isSafeInteger(DOWNLOAD_TOKEN_TTL_SECONDS)
    || DOWNLOAD_TOKEN_TTL_SECONDS < 30 || DOWNLOAD_TOKEN_TTL_SECONDS > 86400) {
  setupErrors.push('DOWNLOAD_TOKEN_TTL_SECONDS musí být celé číslo 30–86400 bez dalších znaků.');
}
if (!DOWNLOAD_ROOT_RAW || DOWNLOAD_ROOT_RAW !== DOWNLOAD_ROOT_RAW.trim()) {
  setupErrors.push('DOWNLOAD_ROOT musí být neprázdná cesta bez okrajových mezer.');
}
if (!['development', 'test', 'production'].includes(NODE_ENV_RAW)) {
  setupErrors.push('NODE_ENV musí být explicitně nastavené na development, test nebo production.');
}
if (NODE_ENV_RAW === 'production' && TRUSTED_PROXY_IPS.size === 0) {
  setupErrors.push('Produkce za reverzní proxy vyžaduje neprázdné MOVLY_TRUSTED_PROXY_IPS.');
}
const apiBaseError = validateApiBase(API_BASE_RAW);
if (apiBaseError) {
  setupErrors.push(apiBaseError);
}
let WINDOWS_UPDATE_PUBLIC_KEY = null;
try {
  WINDOWS_UPDATE_PUBLIC_KEY = createEd25519PublicKey(WINDOWS_UPDATE_PUBLIC_KEY_BASE64_RAW);
} catch (error) {
  setupErrors.push(`MOVLY_WINDOWS_UPDATE_PUBLIC_KEY_BASE64 není platný raw Ed25519 klíč: ${error.message}`);
}
if (setupErrors.length > 0) {
  console.error('[Movly web] Konfigurace není kompletní:');
  setupErrors.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

// Privátní Windows update manifest. Leží vedle instalaček v DOWNLOAD_ROOT a je
// PODEPSANÝ OFFLINE (Ed25519) na build stroji — server ho jen servíruje za auth
// bránou a doplní živé velikosti souborů. Privátní klíč na serveru NIKDY není,
// takže ani kompromitovaný web nepodstrčí klientovi falešnou aktualizaci.
// Stejná vlastnost jako Sparkle EdDSA na macOS.
const WINDOWS_UPDATE_MANIFEST = 'windows-manifest.json';
const WINDOWS_RELEASES_DIR_NAME = '.movly-download-releases';
const WINDOWS_MANIFEST_FORMAT_LEGACY_V1 = 'legacy-v1';
const WINDOWS_MANIFEST_FORMAT_SECURE_V2 = 'secure-v2';
const WINDOWS_LEGACY_MANIFEST_KEYS = Object.freeze([
  'version',
  'buildCode',
  'channel',
  'releasedAt',
  'notes',
  'arches',
]);
const WINDOWS_SECURE_MANIFEST_KEYS = Object.freeze([
  ...WINDOWS_LEGACY_MANIFEST_KEYS,
  'security',
  'authenticodeCertificateSha256',
]);

const DOWNLOADS = [
  {
    id: 'windows-x64',
    platform: 'Windows',
    title: 'Windows x64',
    subtitle: 'Většina běžných PC a notebooků s Intel/AMD',
    fileName: 'MovlySetup-x64.exe',
    type: 'EXE installer',
  },
  {
    id: 'windows-arm64',
    platform: 'Windows',
    title: 'Windows ARM64',
    subtitle: 'Surface/Parallels a ARM zařízení',
    fileName: 'MovlySetup-arm64.exe',
    type: 'EXE installer',
  },
  {
    id: 'windows-x86',
    platform: 'Windows',
    title: 'Windows x86',
    subtitle: 'Starší 32bit Windows',
    fileName: 'MovlySetup-x86.exe',
    type: 'EXE installer',
  },
  {
    id: 'macos-universal',
    platform: 'macOS',
    title: 'macOS Universal',
    subtitle: 'Apple Silicon i Intel Mac',
    fileName: 'Movly-macOS-universal-devsigned.zip',
    type: 'ZIP aplikace',
  },
];

// Auto-update is intentionally available to every authenticated account, while
// manual downloads remain Premium/VIP+. Keep this boundary as a closed list:
// accepting an arbitrary DOWNLOADS id here would expose the macOS installer.
const WINDOWS_UPDATE_TARGETS = new Map([
  ['arm64', { downloadId: 'windows-arm64', fileName: 'MovlySetup-arm64.exe' }],
  ['x64', { downloadId: 'windows-x64', fileName: 'MovlySetup-x64.exe' }],
  ['x86', { downloadId: 'windows-x86', fileName: 'MovlySetup-x86.exe' }],
]);
const WINDOWS_UPDATE_DOWNLOAD_IDS = new Set(
  [...WINDOWS_UPDATE_TARGETS.values()].map((target) => target.downloadId),
);
const WINDOWS_INTEGRITY_CACHE_MAX_ENTRIES = 32;
const WINDOWS_LINK_RATE_WINDOW_MS = 60 * 1000;
const WINDOWS_LINK_USER_LIMIT = 12;
const WINDOWS_LINK_IP_LIMIT = 120;
const WINDOWS_LINK_RATE_MAX_BUCKETS = 4096;
const CLIENT_IP_HEADER = 'x-movly-client-ip';
const windowsIntegrityCache = new Map();
const windowsLinkRateBuckets = new Map();
let windowsIntegrityHashComputations = 0;

class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

class ReleaseIntegrityError extends HttpError {}

class ApiError extends Error {
  constructor(status, payload, headers = null) {
    const message = payload?.message || payload?.error || payload?.detail?.message || `Movly API vrátilo chybu ${status}.`;
    super(message);
    this.status = status;
    this.payload = payload;
    this.code = payload?.detail?.code || payload?.code;
    this.headers = headers;
  }
}

function parseStrictUnsignedInteger(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function canonicalIPAddress(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 64) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped && net.isIP(mapped[1]) === 4) return mapped[1];
  const version = net.isIP(value);
  if (version === 4) return value;
  if (version === 6) {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.slice(1, -1);
  }
  return null;
}

function parseTrustedProxyIPs(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim()) {
    throw new Error('očekáván comma-separated seznam bez okrajových mezer');
  }
  if (!raw) return new Set();
  const trusted = new Set();
  for (const entry of raw.split(',')) {
    const canonical = canonicalIPAddress(entry);
    if (!canonical || canonical !== entry) {
      throw new Error(`adresa ${JSON.stringify(entry)} není kanonická IPv4/IPv6 adresa bez mezer`);
    }
    if (trusted.has(canonical)) throw new Error(`adresa ${entry} je uvedena vícekrát`);
    trusted.add(canonical);
  }
  return trusted;
}

function validateApiBase(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    return 'MOVLY_API_BASE musí být neprázdná URL bez okrajových mezer.';
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'MOVLY_API_BASE není platná absolutní URL.';
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return 'MOVLY_API_BASE nesmí obsahovat credentials, query ani fragment.';
  }
  if (parsed.protocol !== 'https:') {
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (parsed.protocol !== 'http:' || !localHosts.has(parsed.hostname)) {
      return 'MOVLY_API_BASE musí používat HTTPS; HTTP je povoleno jen pro loopback vývoj.';
    }
  }
  return null;
}

function createEd25519PublicKey(rawBase64) {
  if (typeof rawBase64 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(rawBase64)) {
    throw new Error('očekáváno přesně 32 bajtů v kanonickém base64');
  }
  const raw = Buffer.from(rawBase64, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== rawBase64) {
    throw new Error('base64 není kanonický 32bytový klíč');
  }
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: 'der', type: 'spki' });
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function json(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function notFound(res) {
  json(res, 404, { message: 'Nenalezeno.' });
}

function readRequestBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const rejectAndDrain = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        rejectAndDrain(new HttpError(413, 'Požadavek je příliš velký.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Požadavek nemá platný JSON.'));
      }
    });
    req.on('aborted', () => rejectAndDrain(new HttpError(400, 'Přenos požadavku byl přerušen.')));
    req.on('error', (error) => rejectAndDrain(new HttpError(400, `Přenos požadavku selhal: ${error.message}`)));
  });
}

function readCanonicalDeviceUserCode(req) {
  const contentType = req.headers['content-type'];
  if (contentType !== 'application/json' && contentType !== 'application/json; charset=utf-8') {
    req.resume();
    throw new HttpError(415, 'Aktivace zařízení vyžaduje Content-Type application/json.');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const rejectAndDrain = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > 256) {
        rejectAndDrain(new HttpError(413, 'Aktivační požadavek je příliš velký.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      const match = /^\{"user_code":"([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})"\}$/.exec(raw);
      if (!match) {
        reject(new HttpError(
          400,
          'Aktivační požadavek musí být přesně {"user_code":"XXXXX-XXXXX"} s platným kódem.',
        ));
        return;
      }
      resolve(match[1]);
    });
    req.on('aborted', () => rejectAndDrain(new HttpError(400, 'Přenos aktivačního požadavku byl přerušen.')));
    req.on('error', (error) => rejectAndDrain(new HttpError(400, `Přenos aktivačního požadavku selhal: ${error.message}`)));
  });
}

function readCanonicalJSONObject(req, expectedKeys, limitBytes, label) {
  const contentType = req.headers['content-type'];
  if (contentType !== 'application/json' && contentType !== 'application/json; charset=utf-8') {
    req.resume();
    throw new HttpError(415, `${label} vyžaduje Content-Type application/json.`);
  }
  if (!Array.isArray(expectedKeys) || expectedKeys.length === 0
      || !Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    req.resume();
    throw new HttpError(500, 'Server nemá platný kontrakt JSON požadavku.');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const rejectAndDrain = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        rejectAndDrain(new HttpError(413, `${label} je příliš velký.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        reject(new HttpError(400, `${label} nemá platný JSON.`));
        return;
      }
      if (!hasExactObjectKeys(payload, expectedKeys) || JSON.stringify(payload) !== raw) {
        reject(new HttpError(
          400,
          `${label} musí být kanonický JSON přesně s poli ${expectedKeys.join(', ')}.`,
        ));
        return;
      }
      resolve(payload);
    });
    req.on('aborted', () => rejectAndDrain(new HttpError(400, `${label} byl během přenosu přerušen.`)));
    req.on('error', (error) => rejectAndDrain(new HttpError(400, `${label} během přenosu selhal: ${error.message}`)));
  });
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function extractStrictBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([!-~]{16,512})$/.exec(header);
  return match ? match[1] : null;
}

function prehashPassword(password) {
  const digest = crypto.createHash('sha256').update(password, 'utf8').digest('base64');
  return `sha256:${digest}`;
}

function apiHeaders(token, sessionId = `web-${crypto.randomUUID()}`) {
  const headers = {
    Accept: 'application/json',
    'Api-Key': API_KEY,
    'X-Session-ID': sessionId,
    'X-Device-Type': 'mobile',
    'X-Platform': 'android',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function movlyApiResponse(pathname, method, body, token, sessionId, timeoutMs = API_TIMEOUT_MS, extraHeaders = {}) {
  const url = `${API_BASE}/${pathname.replace(/^\/+/, '')}`;
  const headers = { ...apiHeaders(token, sessionId), ...extraHeaders };
  const controller = new AbortController();
  const options = { method, headers, signal: controller.signal };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  let text;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    response = await fetch(url, options);
    text = await response.text();
  } catch (error) {
    if (timedOut) {
      throw new HttpError(504, `Movly API neodpovědělo do ${timeoutMs} ms.`);
    }
    throw new HttpError(502, `Nepodařilo se spojit s Movly API: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new HttpError(502, `Movly API vrátilo nečitelnou odpověď (${response.status}).`);
    }
  }

  if (!response.ok) throw new ApiError(response.status, payload, response.headers);
  return {
    status: response.status,
    headers: response.headers,
    payload,
    bodyWasEmpty: text.length === 0,
  };
}

async function movlyApi(pathname, method, body, token, sessionId, timeoutMs = API_TIMEOUT_MS) {
  const response = await movlyApiResponse(pathname, method, body, token, sessionId, timeoutMs);
  return response.payload;
}

async function attemptLogin(username, password, sessionId) {
  return movlyApi(
    'v1/auth/login',
    'POST',
    {
      username,
      password,
      device_id: sessionId,
      device_type: 'android_mobile',
      push_id: null,
    },
    null,
    sessionId,
  );
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(502, 'Movly API nevrátilo údaje účtu.');
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) {
    throw new HttpError(502, 'Movly API vrátilo účet bez platného id.');
  }
  if (typeof raw.username !== 'string' || !raw.username.trim()) {
    throw new HttpError(502, 'Movly API vrátilo účet bez platného username.');
  }
  if (raw.email !== null && typeof raw.email !== 'string') {
    throw new HttpError(502, 'Movly API vrátilo účet s neplatným email.');
  }
  if (raw.display_name !== null && typeof raw.display_name !== 'string') {
    throw new HttpError(502, 'Movly API vrátilo účet s neplatným display_name.');
  }
  if (!Number.isSafeInteger(raw.coins) || raw.coins < 0) {
    throw new HttpError(502, 'Movly API vrátilo účet s neplatným počtem coinů.');
  }
  if (typeof raw.is_active !== 'boolean' || typeof raw.is_verified !== 'boolean') {
    throw new HttpError(502, 'Movly API vrátilo účet bez stavových příznaků.');
  }
  if (!Object.hasOwn(raw, 'premium_until')
      || (raw.premium_until !== null && typeof raw.premium_until !== 'string')) {
    throw new HttpError(502, 'Movly API vrátilo účet s neplatným premium_until.');
  }
  const role = normalizeRole(raw.role);
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
    displayName: raw.display_name,
    premiumUntil: raw.premium_until,
    coins: raw.coins,
    role,
    isActive: raw.is_active,
    isVerified: raw.is_verified,
  };
}

function normalizeRole(role) {
  if (typeof role !== 'string') throw new HttpError(502, 'Movly API vrátilo účet bez platné role.');
  if (role !== role.trim() || role !== role.toLowerCase()) {
    throw new HttpError(502, `Movly API vrátilo nekanonickou roli ${JSON.stringify(role)}.`);
  }
  const normalized = role;
  if (!['user', 'vip', 'moderator', 'admin'].includes(normalized)) {
    throw new HttpError(502, `Movly API vrátilo neznámou roli ${JSON.stringify(role)}.`);
  }
  return normalized;
}

function roleRank(role) {
  switch (normalizeRole(role)) {
    case 'admin':
      return 4;
    case 'moderator':
      return 3;
    case 'vip':
      return 2;
    case 'user':
      return 1;
    default:
      throw new HttpError(502, 'Movly API vrátilo nepodporovanou roli.');
  }
}

function roleDisplayName(role) {
  switch (normalizeRole(role)) {
    case 'admin':
      return 'Admin';
    case 'moderator':
      return 'Moderátor';
    case 'vip':
      return 'VIP';
    case 'user':
      return 'Uživatel';
    default:
      throw new HttpError(502, 'Movly API vrátilo nepodporovanou roli.');
  }
}

function isPremiumActive(premiumUntil, now = new Date(), logger = console) {
  if (premiumUntil === null || premiumUntil === undefined) return false;
  if (typeof premiumUntil !== 'string') {
    logger.error('[Movly web] API vrátilo neplatný typ premium_until; Premium přístup byl zamítnut.');
    return false;
  }
  const raw = premiumUntil.trim();
  if (!raw) {
    logger.error('[Movly web] API vrátilo prázdné premium_until; Premium přístup byl zamítnut.');
    return false;
  }
  if (raw !== premiumUntil) {
    logger.error('[Movly web] API vrátilo premium_until s nepovolenými okrajovými mezerami; Premium přístup byl zamítnut.');
    return false;
  }

  // API vrací RFC 3339/ISO 8601 timestamp. Date.parse samotný nestačí: některá
  // neplatná data (např. 31. února) by JavaScript normalizoval do dalšího měsíce.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(raw);
  if (match) {
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, offsetSign, offsetHourRaw, offsetMinuteRaw] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    const offsetHour = offsetHourRaw === undefined ? 0 : Number(offsetHourRaw);
    const offsetMinute = offsetMinuteRaw === undefined ? 0 : Number(offsetMinuteRaw);
    const hasUnknownLocalOffset = offsetSign === '-' && offsetHour === 0 && offsetMinute === 0;
    const calendarProbe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const calendarValid =
      month >= 1 && month <= 12 &&
      day >= 1 &&
      calendarProbe.getUTCFullYear() === year &&
      calendarProbe.getUTCMonth() === month - 1 &&
      calendarProbe.getUTCDate() === day &&
      hour <= 23 && minute <= 59 && second <= 59 &&
      offsetHour <= 23 && offsetMinute <= 59 &&
      !hasUnknownLocalOffset;
    const expirationMs = calendarValid ? Date.parse(raw) : Number.NaN;
    if (Number.isFinite(expirationMs) && Number.isFinite(now?.getTime?.())) {
      return expirationMs > now.getTime();
    }
  }

  logger.error('[Movly web] API vrátilo neplatné premium_until; Premium přístup byl zamítnut.');
  return false;
}

function sessionPayload(account, token) {
  const premiumActive = isPremiumActive(account.premiumUntil);
  const elevatedRole = roleRank(account.role) >= 2;
  const hasDownloadAccess = account.isActive && account.isVerified && (premiumActive || elevatedRole);
  return {
    ...(token ? { token } : {}),
    account: {
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      coins: account.coins,
    },
    hasDownloadAccess,
    accessLabel: hasDownloadAccess ? 'Přístup povolen' : 'Nedostupné',
  };
}

async function validateSession(req) {
  const token = extractBearerToken(req);
  if (!token) throw new HttpError(401, 'Přihlas se Movly účtem.');
  const payload = await movlyApi('v1/auth/me', 'GET', null, token);
  const account = normalizeAccount(payload);
  const session = sessionPayload(account);
  return { token, account, session };
}

async function validateAccess(req) {
  const validated = await validateSession(req);
  const { session } = validated;
  if (!session.hasDownloadAccess) {
    throw new HttpError(403, 'Pro tento účet teď nejsou instalačky dostupné.');
  }
  return validated;
}

function statPath(filePath, label, statSync = fs.statSync, logger = console) {
  try {
    return statSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    logger.error(`[Movly web] Nelze načíst metadata pro ${label}:`, error);
    throw new HttpError(500, `Nelze ověřit dostupnost pro ${label}.`);
  }
}

function downloadInfo(item) {
  const filePath = path.join(DOWNLOAD_ROOT, item.fileName);
  const stat = statPath(filePath, `instalátor ${item.fileName}`);
  if (!stat) {
    return {
      ...item,
      fileName: item.fileName,
      sizeBytes: null,
      sizeLabel: null,
      available: false,
      missingMessage: `Soubor ${item.fileName} není v ${DOWNLOAD_ROOT}.`,
    };
  }
  if (!stat.isFile()) throw new HttpError(500, `Cesta pro ${item.fileName} není platný soubor.`);
  return {
    ...item,
    fileName: item.fileName,
    sizeBytes: stat.size,
    sizeLabel: formatBytes(stat.size),
    available: true,
  };
}

function formatBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new HttpError(500, 'Velikost souboru není platné nezáporné celé číslo.');
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function signDownloadToken(downloadId, releaseBinding = null) {
  if (releaseBinding !== null
      && (!/^[A-Za-z0-9._-]+$/.test(releaseBinding.releaseId)
        || !/^[a-f0-9]{64}$/.test(releaseBinding.sha256))) {
    throw new HttpError(500, 'Windows download binding není platný.');
  }
  const payload = base64url(
    JSON.stringify({
      id: downloadId,
      exp: Date.now() + DOWNLOAD_TOKEN_TTL_SECONDS * 1000,
      nonce: crypto.randomUUID(),
      ...(releaseBinding === null ? {} : releaseBinding),
    }),
  );
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

function verifyDownloadToken(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new HttpError(403, 'Download odkaz není platný.');
  const [payload, sig] = parts;
  const expected = hmac(payload);
  if (!safeEqual(sig, expected)) throw new HttpError(403, 'Download odkaz není platný.');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(403, 'Download odkaz není platný.');
  }
  if (!Number.isSafeInteger(parsed.exp) || parsed.exp <= 0
      || typeof parsed.id !== 'string' || typeof parsed.nonce !== 'string' || !parsed.nonce) {
    throw new HttpError(403, 'Download odkaz nemá platný obsah.');
  }
  if (Date.now() >= parsed.exp) throw new HttpError(403, 'Download odkaz vypršel.');
  const item = DOWNLOADS.find((candidate) => candidate.id === parsed.id);
  if (!item) throw new HttpError(404, 'Instalátor neexistuje.');
  const hasReleaseId = Object.hasOwn(parsed, 'releaseId');
  const hasSha256 = Object.hasOwn(parsed, 'sha256');
  if (hasReleaseId !== hasSha256) throw new HttpError(403, 'Download odkaz má neúplnou release vazbu.');
  if (hasReleaseId
      && (typeof parsed.releaseId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(parsed.releaseId)
        || typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.sha256))) {
    throw new HttpError(403, 'Download odkaz má neplatnou release vazbu.');
  }
  return {
    item,
    releaseId: hasReleaseId ? parsed.releaseId : null,
    sha256: hasSha256 ? parsed.sha256 : null,
  };
}

function hmac(value) {
  return crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(value).digest('base64url');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function enforceWindowsLinkRateLimit(
  req,
  userId,
  nowMs = Date.now(),
  trustedProxyIPs = TRUSTED_PROXY_IPS,
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new HttpError(500, 'Windows download rate limit nedostal platné user id.');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new HttpError(500, 'Windows download rate limit nedostal platný čas.');
  }
  const clientIP = resolveClientRateLimitIP(req, trustedProxyIPs);

  pruneWindowsLinkRateBuckets(nowMs);
  const candidates = [
    { key: `user:${userId}`, limit: WINDOWS_LINK_USER_LIMIT },
    { key: `ip:${clientIP}`, limit: WINDOWS_LINK_IP_LIMIT },
  ];
  for (const candidate of candidates) {
    const bucket = windowsLinkRateBuckets.get(candidate.key);
    if (bucket && bucket.expiresAt > nowMs && bucket.count >= candidate.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.expiresAt - nowMs) / 1000));
      throw new HttpError(429, 'Příliš mnoho požadavků na Windows download odkaz.', {
        code: 'windows_download_link_rate_limited',
        retryAfterSeconds,
      });
    }
  }

  const missingBuckets = candidates.filter((candidate) => !windowsLinkRateBuckets.has(candidate.key));
  if (windowsLinkRateBuckets.size + missingBuckets.length > WINDOWS_LINK_RATE_MAX_BUCKETS) {
    throw new HttpError(503, 'Windows download rate limiter dosáhl bezpečnostního limitu kapacity.', {
      code: 'windows_download_link_rate_capacity',
    });
  }

  for (const candidate of candidates) {
    const existing = windowsLinkRateBuckets.get(candidate.key);
    if (existing && existing.expiresAt > nowMs) {
      existing.count += 1;
      continue;
    }
    windowsLinkRateBuckets.set(candidate.key, {
      count: 1,
      expiresAt: nowMs + WINDOWS_LINK_RATE_WINDOW_MS,
    });
  }
}

function resolveClientRateLimitIP(req, trustedProxyIPs = TRUSTED_PROXY_IPS) {
  if (!(trustedProxyIPs instanceof Set)) {
    throw new HttpError(500, 'Trusted proxy konfigurace nemá očekávaný typ.');
  }
  const socketIP = canonicalIPAddress(req?.socket?.remoteAddress);
  if (!socketIP) {
    throw new HttpError(500, 'Windows download rate limit nedostal platnou socket IP.', {
      code: 'windows_download_socket_ip_invalid',
    });
  }
  const forwarded = req?.headers?.[CLIENT_IP_HEADER];
  if (!trustedProxyIPs.has(socketIP)) {
    if (forwarded !== undefined) {
      throw new HttpError(400, 'Client IP header přišel z nedůvěryhodné proxy.', {
        code: 'windows_download_untrusted_client_ip_header',
      });
    }
    return socketIP;
  }
  if (typeof forwarded !== 'string') {
    throw new HttpError(500, 'Důvěryhodná proxy neposlala povinný kanonický client IP header.', {
      code: 'windows_download_trusted_proxy_header_missing',
    });
  }
  const clientIP = canonicalIPAddress(forwarded);
  if (!clientIP) {
    throw new HttpError(400, 'Důvěryhodná proxy poslala neplatný client IP header.', {
      code: 'windows_download_trusted_proxy_header_invalid',
    });
  }
  return clientIP;
}

function pruneWindowsLinkRateBuckets(nowMs) {
  for (const [key, bucket] of windowsLinkRateBuckets) {
    if (bucket.expiresAt <= nowMs) windowsLinkRateBuckets.delete(key);
  }
}

async function handleLogin(req, res) {
  const body = await readRequestBody(req);
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw new HttpError(400, 'Uživatelské jméno i heslo musí být text.');
  }
  const username = body.username.trim();
  const password = body.password;
  if (!username || !password) throw new HttpError(400, 'Vyplň uživatelské jméno/e-mail a heslo.');

  const sessionId = `web-${crypto.randomUUID()}`;
  let payload;
  try {
    payload = await attemptLogin(username, prehashPassword(password), sessionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === 'password_upgrade_required') {
      payload = await attemptLogin(username, password, sessionId);
    } else {
      throw error;
    }
  }

  const token = payload?.token;
  if (typeof token !== 'string' || !token || token !== token.trim()) {
    throw new HttpError(502, 'Movly API nevrátilo platný přihlašovací token.');
  }
  if (!payload.user || typeof payload.user !== 'object') {
    throw new HttpError(502, 'Movly API nevrátilo uživatele v přihlašovací odpovědi.');
  }
  const account = normalizeAccount(payload.user);
  json(res, 200, sessionPayload(account, token));
}

async function handleMe(req, res) {
  const token = extractBearerToken(req);
  if (!token) throw new HttpError(401, 'Přihlas se Movly účtem.');
  const payload = await movlyApi('v1/auth/me', 'GET', null, token);
  json(res, 200, sessionPayload(normalizeAccount(payload)));
}

async function handleLogout(req, res) {
  const token = extractBearerToken(req);
  if (!token) {
    json(res, 200, { ok: true, message: 'Lokální session je prázdná.' });
    return;
  }
  await movlyApi('v1/auth/logout', 'POST', null, token);
  json(res, 200, { ok: true });
}

function isStrictRFC3339Timestamp(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, fractionRaw, offsetSign, offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const offsetHour = offsetHourRaw === undefined ? 0 : Number(offsetHourRaw);
  const offsetMinute = offsetMinuteRaw === undefined ? 0 : Number(offsetMinuteRaw);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
      || offsetHour > 23 || offsetMinute > 59
      || (offsetSign === '-' && offsetHour === 0 && offsetMinute === 0)) {
    return false;
  }
  const calendarProbe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (calendarProbe.getUTCFullYear() !== year || calendarProbe.getUTCMonth() !== month - 1
      || calendarProbe.getUTCDate() !== day) {
    return false;
  }
  const parseable = fractionRaw && fractionRaw.length > 3
    ? value.replace(`.${fractionRaw}`, `.${fractionRaw.slice(0, 3)}`)
    : value;
  return Number.isFinite(Date.parse(parseable));
}

function validateDeviceText(value, name, maximum) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 || value.length > maximum
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(502, `Movly API vrátilo neplatné pole ${name} v náhledu zařízení.`);
  }
  return value;
}

function normalizeDeviceAuthorizationPreview(payload) {
  const required = ['status', 'display_name', 'platform', 'device_type', 'expires_at'];
  const optional = ['app_version', 'os_version', 'model'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(502, 'Movly API nevrátilo platný náhled zařízení.');
  }
  const keys = Object.keys(payload);
  if (!required.every((key) => Object.hasOwn(payload, key))
      || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new HttpError(502, 'Movly API vrátilo neznámý nebo neúplný kontrakt náhledu zařízení.');
  }
  if (payload.status !== 'pending' || !isStrictRFC3339Timestamp(payload.expires_at)) {
    throw new HttpError(502, 'Movly API vrátilo neplatný stav nebo expiraci náhledu zařízení.');
  }
  const normalized = {
    status: payload.status,
    display_name: validateDeviceText(payload.display_name, 'display_name', 100),
    platform: validateDeviceText(payload.platform, 'platform', 24),
    device_type: validateDeviceText(payload.device_type, 'device_type', 24),
    expires_at: payload.expires_at,
  };
  for (const key of optional) {
    if (Object.hasOwn(payload, key)) normalized[key] = validateDeviceText(payload[key], key, key === 'app_version' ? 32 : key === 'os_version' ? 64 : 100);
  }
  return normalized;
}

function normalizeDeviceAuthorizationDecision(payload, expectedStatus) {
  if (!hasExactObjectKeys(payload, ['status']) || payload.status !== expectedStatus) {
    throw new HttpError(502, `Movly API nepotvrdilo očekávaný stav ${expectedStatus}.`);
  }
  return { status: payload.status };
}

function throwDeviceAuthorizationAPIError(error) {
  if (!(error instanceof ApiError)) throw error;
  const messages = new Map([
    [401, 'Přihlášení vypršelo. Přihlas se znovu.'],
    [403, 'Tento aktivační kód nelze potvrdit tímto účtem.'],
    [410, 'Aktivační kód vypršel. Na televizi vytvoř nový.'],
    [429, 'Příliš mnoho pokusů. Počkej a zkus to znovu.'],
    [503, 'Aktivace zařízení je dočasně nedostupná.'],
  ]);
  const message = messages.get(error.status);
  if (!message) {
    throw new HttpError(502, `Movly API vrátilo neočekávaný stav aktivace (${error.status}).`);
  }
  throw new HttpError(error.status, message);
}

async function handleDeviceAuthorizationPreview(req, res) {
  const token = extractStrictBearerToken(req);
  if (!token) {
    req.resume();
    throw new HttpError(401, 'Přihlas se Movly účtem.');
  }
  const userCode = await readCanonicalDeviceUserCode(req);
  let payload;
  try {
    payload = await movlyApi('v1/auth/device/preview', 'POST', { user_code: userCode }, token);
  } catch (error) {
    throwDeviceAuthorizationAPIError(error);
  }
  json(res, 200, normalizeDeviceAuthorizationPreview(payload));
}

async function handleDeviceAuthorizationDecision(req, res, approve) {
  const token = extractStrictBearerToken(req);
  if (!token) {
    req.resume();
    throw new HttpError(401, 'Přihlas se Movly účtem.');
  }
  const userCode = await readCanonicalDeviceUserCode(req);
  const expectedStatus = approve ? 'approved' : 'denied';
  let payload;
  try {
    payload = await movlyApi(`v1/auth/device/${approve ? 'approve' : 'deny'}`, 'POST', { user_code: userCode }, token);
  } catch (error) {
    throwDeviceAuthorizationAPIError(error);
  }
  json(res, 200, normalizeDeviceAuthorizationDecision(payload, expectedStatus));
}

const MANAGED_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireCanonicalManagedUUID(value, label) {
  if (typeof value !== 'string' || !MANAGED_UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${label} musí být kanonické UUID malými písmeny.`);
  }
  return value;
}

function validateManagedText(value, label, maximum) {
  if (typeof value !== 'string' || value !== value.trim() || Array.from(value).length < 1
      || Array.from(value).length > maximum || /\p{Cc}/u.test(value)) {
    throw new HttpError(502, `Movly API vrátilo neplatné pole ${label}.`);
  }
  return value;
}

function validateManagedTimestamp(value, label) {
  if (!isStrictRFC3339Timestamp(value)) {
    throw new HttpError(502, `Movly API vrátilo neplatný čas ${label}.`);
  }
  return value;
}

function normalizeManagedDevice(payload) {
  const required = [
    'id', 'display_name', 'platform', 'device_type', 'created_at', 'last_seen_at', 'is_current',
  ];
  const optional = ['app_version', 'os_version', 'model', 'revoked_at'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !required.every((key) => Object.hasOwn(payload, key))
      || Object.keys(payload).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new HttpError(502, 'Movly API vrátilo neznámý nebo neúplný kontrakt zařízení.');
  }
  if (typeof payload.is_current !== 'boolean') {
    throw new HttpError(502, 'Movly API vrátilo neplatný příznak is_current zařízení.');
  }
  const normalized = {
    id: requireCanonicalManagedUUID(payload.id, 'ID zařízení'),
    display_name: validateManagedText(payload.display_name, 'display_name', 100),
    platform: validateManagedText(payload.platform, 'platform', 24),
    device_type: validateManagedText(payload.device_type, 'device_type', 24),
    created_at: validateManagedTimestamp(payload.created_at, 'created_at'),
    last_seen_at: validateManagedTimestamp(payload.last_seen_at, 'last_seen_at'),
    is_current: payload.is_current,
  };
  for (const [key, maximum] of [['app_version', 32], ['os_version', 64], ['model', 100]]) {
    if (Object.hasOwn(payload, key)) normalized[key] = validateManagedText(payload[key], key, maximum);
  }
  if (Object.hasOwn(payload, 'revoked_at')) {
    normalized.revoked_at = validateManagedTimestamp(payload.revoked_at, 'revoked_at');
  }
  return normalized;
}

function normalizeManagedSession(payload) {
  const required = [
    'id', 'created_at', 'last_seen_at', 'idle_expires_at', 'absolute_expires_at',
    'is_active', 'is_current',
  ];
  const optional = ['device_id', 'device_name', 'device_type', 'revoked_at'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !required.every((key) => Object.hasOwn(payload, key))
      || Object.keys(payload).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new HttpError(502, 'Movly API vrátilo neznámý nebo neúplný kontrakt session.');
  }
  if (typeof payload.is_active !== 'boolean' || typeof payload.is_current !== 'boolean') {
    throw new HttpError(502, 'Movly API vrátilo neplatné stavové příznaky session.');
  }
  const normalized = {
    id: requireCanonicalManagedUUID(payload.id, 'ID session'),
    created_at: validateManagedTimestamp(payload.created_at, 'created_at'),
    last_seen_at: validateManagedTimestamp(payload.last_seen_at, 'last_seen_at'),
    idle_expires_at: validateManagedTimestamp(payload.idle_expires_at, 'idle_expires_at'),
    absolute_expires_at: validateManagedTimestamp(payload.absolute_expires_at, 'absolute_expires_at'),
    is_active: payload.is_active,
    is_current: payload.is_current,
  };
  if (Object.hasOwn(payload, 'device_id')) {
    normalized.device_id = requireCanonicalManagedUUID(payload.device_id, 'ID zařízení session');
  }
  if (Object.hasOwn(payload, 'device_name')) {
    normalized.device_name = validateManagedText(payload.device_name, 'device_name', 100);
  }
  if (Object.hasOwn(payload, 'device_type')) {
    normalized.device_type = validateManagedText(payload.device_type, 'device_type', 24);
  }
  if (Object.hasOwn(payload, 'revoked_at')) {
    normalized.revoked_at = validateManagedTimestamp(payload.revoked_at, 'revoked_at');
  }
  return normalized;
}

function normalizeManagedPage(payload, collectionKey, itemNormalizer) {
  const expectedKeys = [collectionKey, 'total', 'limit', 'offset', 'has_more'];
  if (!hasExactObjectKeys(payload, expectedKeys) || !Array.isArray(payload[collectionKey])
      || !Number.isSafeInteger(payload.total) || payload.total < 0
      || !Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 200
      || !Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > 10000
      || typeof payload.has_more !== 'boolean' || payload[collectionKey].length > payload.limit) {
    throw new HttpError(502, `Movly API vrátilo neplatný stránkovaný kontrakt ${collectionKey}.`);
  }
  const items = payload[collectionKey].map(itemNormalizer);
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length || payload.has_more !== (payload.offset + items.length < payload.total)) {
    throw new HttpError(502, `Movly API vrátilo nekonzistentní stránku ${collectionKey}.`);
  }
  return {
    [collectionKey]: items,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    has_more: payload.has_more,
  };
}

function managedPagination(url) {
  const entries = [...url.searchParams.entries()];
  if (entries.some(([key]) => key !== 'limit' && key !== 'offset')) {
    throw new HttpError(400, 'Stránkování obsahuje neznámý parametr.');
  }
  for (const name of ['limit', 'offset']) {
    if (entries.filter(([key]) => key === name).length > 1) {
      throw new HttpError(400, `Parametr ${name} smí být uveden právě jednou.`);
    }
  }
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');
  const limit = rawLimit === null ? 50 : parseStrictUnsignedInteger(rawLimit);
  const offset = rawOffset === null ? 0 : parseStrictUnsignedInteger(rawOffset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new HttpError(400, 'limit musí být kanonické celé číslo 1–200.');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    throw new HttpError(400, 'offset musí být kanonické celé číslo 0–10000.');
  }
  return { limit, offset };
}

function assertManagedJSONResponse(response, expectedStatus, label) {
  if (response.status !== expectedStatus || response.bodyWasEmpty) {
    throw new HttpError(502, `Movly API vrátilo neočekávaný stav nebo prázdné tělo pro ${label}.`);
  }
  const contentType = response.headers.get('content-type');
  if (typeof contentType !== 'string'
      || !['application/json', 'application/json; charset=utf-8'].includes(contentType.toLowerCase())) {
    throw new HttpError(502, `Movly API vrátilo neplatný Content-Type pro ${label}.`);
  }
}

function assertManagedEmptyResponse(response, expectedStatus, label) {
  if (response.status !== expectedStatus || !response.bodyWasEmpty) {
    throw new HttpError(502, `Movly API nepotvrdilo ${label} prázdnou odpovědí ${expectedStatus}.`);
  }
}

function throwDeviceManagementAPIError(error) {
  if (!(error instanceof ApiError)) throw error;
  const messages = new Map([
    [400, 'Požadavek na správu zařízení není platný.'],
    [401, 'Přihlášení vypršelo. Přihlas se znovu.'],
    [403, 'Tento účet nemůže spravovat požadované zařízení nebo session.'],
    [404, 'Zařízení nebo session už neexistuje. Obnov seznam.'],
    [409, 'Aktuální zařízení nelze odstranit. Odhlas se místo toho.'],
    [503, 'Správa zařízení je dočasně nedostupná.'],
  ]);
  if (error.status === 429) {
    const retryAfter = error.headers?.get('retry-after');
    const retryAfterSeconds = parseStrictUnsignedInteger(retryAfter);
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 86400) {
      throw new HttpError(502, 'Movly API neposlalo platný Retry-After pro omezení správy zařízení.');
    }
    throw new HttpError(429, 'Příliš mnoho změn zařízení. Počkej a zkus to znovu.', { retryAfterSeconds });
  }
  const message = messages.get(error.status);
  if (!message) {
    throw new HttpError(502, `Movly API vrátilo neočekávaný stav správy zařízení (${error.status}).`);
  }
  throw new HttpError(error.status, message);
}

function requireBodylessRequest(req, label) {
  const contentLength = req.headers['content-length'];
  if ((contentLength !== undefined && contentLength !== '0')
      || req.headers['transfer-encoding'] !== undefined
      || req.headers['content-type'] !== undefined) {
    req.resume();
    throw new HttpError(400, `${label} nesmí obsahovat tělo ani Content-Type.`);
  }
}

async function handleManagedList(req, res, url, collectionKey, itemNormalizer) {
  requireBodylessRequest(req, `Načtení ${collectionKey}`);
  const token = extractStrictBearerToken(req);
  if (!token) throw new HttpError(401, 'Přihlas se Movly účtem.');
  const pagination = managedPagination(url);
  let response;
  try {
    response = await movlyApiResponse(
      `v1/auth/${collectionKey}?limit=${pagination.limit}&offset=${pagination.offset}`,
      'GET',
      null,
      token,
    );
  } catch (error) {
    throwDeviceManagementAPIError(error);
  }
  assertManagedJSONResponse(response, 200, collectionKey);
  json(res, 200, normalizeManagedPage(response.payload, collectionKey, itemNormalizer));
}

async function handleManagedDeviceRename(req, res, deviceID) {
  const token = extractStrictBearerToken(req);
  if (!token) {
    req.resume();
    throw new HttpError(401, 'Přihlas se Movly účtem.');
  }
  const canonicalID = requireCanonicalManagedUUID(deviceID, 'ID zařízení');
  const request = await readCanonicalJSONObject(req, ['display_name'], 1024, 'Přejmenování zařízení');
  let displayName;
  try {
    displayName = validateManagedText(request.display_name, 'display_name', 100);
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(400, 'Název zařízení musí mít 1–100 znaků bez okrajových mezer a řídicích znaků.');
    throw error;
  }
  let response;
  try {
    response = await movlyApiResponse(
      `v1/auth/devices/${canonicalID}`,
      'PATCH',
      { display_name: displayName },
      token,
    );
  } catch (error) {
    throwDeviceManagementAPIError(error);
  }
  assertManagedJSONResponse(response, 200, 'přejmenování zařízení');
  const normalized = normalizeManagedDevice(response.payload);
  if (normalized.id !== canonicalID) {
    throw new HttpError(502, 'Movly API přejmenovalo jiné zařízení, než bylo požadováno.');
  }
  json(res, 200, normalized);
}

// `?purge=true` jen pro zařízení: zneplatnit + skrýt ze seznamu („Odstranit").
// Cizí parametry nebo jiné hodnoty se odmítají — žádný tichý fallback.
function managedPurgeFlag(url, collectionKey) {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return false;
  if (collectionKey !== 'devices' || entries.length > 1 || entries[0][0] !== 'purge') {
    throw new HttpError(400, 'Odpojení obsahuje neznámý parametr.');
  }
  if (entries[0][1] === 'true') return true;
  if (entries[0][1] === 'false') return false;
  throw new HttpError(400, 'Parametr purge musí být přesně true nebo false.');
}

async function handleManagedRevoke(req, res, collectionKey, rawID, url) {
  requireBodylessRequest(req, `Odpojení ${collectionKey}`);
  const token = extractStrictBearerToken(req);
  if (!token) throw new HttpError(401, 'Přihlas se Movly účtem.');
  const canonicalID = requireCanonicalManagedUUID(rawID, collectionKey === 'devices' ? 'ID zařízení' : 'ID session');
  const purge = managedPurgeFlag(url, collectionKey);
  let response;
  try {
    response = await movlyApiResponse(
      `v1/auth/${collectionKey}/${canonicalID}${purge ? '?purge=true' : ''}`,
      'DELETE',
      null,
      token,
    );
  } catch (error) {
    throwDeviceManagementAPIError(error);
  }
  assertManagedEmptyResponse(response, 204, `odpojení ${collectionKey}`);
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

async function handleDownloads(req, res) {
  await validateAccess(req);
  json(res, 200, { downloads: DOWNLOADS.map(downloadInfo) });
}

async function handleDownloadLink(req, res, id) {
  const { account } = await validateAccess(req);
  if (WINDOWS_UPDATE_DOWNLOAD_IDS.has(id)) {
    enforceWindowsLinkRateLimit(req, account.id);
    await sendManualWindowsDownloadLink(res, id);
    return;
  }
  sendUnboundDownloadLink(res, id);
}

async function handleWindowsUpdateLink(req, res, id) {
  // Security and compatibility updates must reach every authenticated client,
  // independently of Premium entitlement. This dedicated route does not weaken
  // the Premium-gated website download endpoint above.
  const { account } = await validateSession(req);
  if (!WINDOWS_UPDATE_DOWNLOAD_IDS.has(id)) {
    throw new HttpError(404, 'Instalátor není povolený pro Windows auto-update.');
  }
  enforceWindowsLinkRateLimit(req, account.id);
  await sendWindowsUpdateDownloadLink(res, id);
}

function sendUnboundDownloadLink(res, id) {
  if (WINDOWS_UPDATE_DOWNLOAD_IDS.has(id)) {
    throw new HttpError(500, 'Windows instalačka vyžaduje release-bound download odkaz.');
  }
  const item = DOWNLOADS.find((candidate) => candidate.id === id);
  if (!item) throw new HttpError(404, 'Instalátor neexistuje.');
  const info = downloadInfo(item);
  if (!info.available) throw new HttpError(404, info.missingMessage);
  json(res, 200, {
    url: `/secure-download/${signDownloadToken(item.id)}`,
    expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS,
  });
}

async function sendManualWindowsDownloadLink(res, id) {
  const release = resolveCurrentWindowsRelease();
  const manifest = readWindowsReleaseManifest(release.path);
  await issueWindowsDownloadLink(res, id, release, manifest, true);
}

async function sendWindowsUpdateDownloadLink(res, id) {
  const release = resolveCurrentWindowsRelease();
  const manifest = readWindowsUpdateManifest(release.path);
  await issueWindowsDownloadLink(res, id, release, manifest, false);
}

async function issueWindowsDownloadLink(res, id, release, manifest, isManualDownload) {
  const item = DOWNLOADS.find((candidate) => candidate.id === id);
  if (!item || !WINDOWS_UPDATE_DOWNLOAD_IDS.has(id)) {
    throw new HttpError(404, 'Instalátor není povolený pro Windows release.');
  }
  if (!release || typeof release.id !== 'string' || typeof release.path !== 'string') {
    throw new HttpError(500, 'Windows download nedostal explicitní release.');
  }
  if (!manifest || !manifest.signed || !(manifest.downloadIds instanceof Set)) {
    throw new HttpError(500, 'Windows download nedostal ověřený manifest.');
  }
  if (typeof isManualDownload !== 'boolean') {
    throw new HttpError(500, 'Windows download nemá explicitně určený režim.');
  }
  if (!isManualDownload && manifest.format !== WINDOWS_MANIFEST_FORMAT_SECURE_V2) {
    throw new HttpError(500, 'Windows auto-update vyžaduje secure-v2 manifest.');
  }
  if (!manifest.downloadIds.has(id)) {
    throw new HttpError(404, 'Instalátor není v aktuálním Windows update manifestu.');
  }
  const entry = Object.values(manifest.signed.arches).find((candidate) => candidate.downloadId === id);
  if (!entry) throw new HttpError(500, 'Podepsaný manifest nemá očekávaný Windows target.');
  const filePath = path.join(release.path, entry.fileName);
  const identity = await verifyWindowsReleaseFile(
    filePath,
    entry.sha256,
    `Windows release instalátor ${entry.fileName}`,
  );
  if (manifest.format === WINDOWS_MANIFEST_FORMAT_SECURE_V2
      && Object.hasOwn(entry, 'sizeBytes')
      && identity.size !== entry.sizeBytes) {
    throw new ReleaseIntegrityError(
      500,
      `Windows release instalátor ${entry.fileName} neodpovídá podepsané velikosti.`,
      { code: 'windows_release_size_mismatch' },
    );
  }
  json(res, 200, {
    url: `/secure-download/${signDownloadToken(item.id, {
      releaseId: release.id,
      sha256: entry.sha256,
    })}`,
    expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS,
    windowsReleaseMode: manifest.format === WINDOWS_MANIFEST_FORMAT_LEGACY_V1
      ? 'legacy-v1-manual-only'
      : 'secure-v2',
  });

  if (isManualDownload && manifest.format === WINDOWS_MANIFEST_FORMAT_LEGACY_V1) {
    console.warn(
      `[Movly web] Ruční Windows download ${id} používá explicitní legacy-v1 režim; auto-update zůstává zablokovaný.`,
    );
  }
}

async function handleWindowsUpdate(req, res) {
  const release = resolveCurrentWindowsRelease();
  // Starší klienti (včetně buildu 90) znají pouze legacy-v1 manifest a následně
  // žádají o instalačku přes Premium download endpoint. Feed proto smí vrátit oba
  // explicitně validované formáty. Nový release-bound download endpoint nadále
  // volá readWindowsUpdateManifest(), takže legacy release nelze vydávat za
  // secure-v2 ani jím obejít Authenticode požadavky nového updateru.
  const { envelope, signed } = readWindowsReleaseManifest(release.path);

  // `signed` je přesný řetězec, který klient ověří proti zapinovanému Ed25519 klíči.
  // Server ho NESMÍ měnit (jinak by se rozbil podpis) — jen ho přečte, aby doplnil
  // živé velikosti souborů do nepodepsané sekce `live` (ta slouží jen k zobrazení).
  const live = {};
  for (const [arch, info] of Object.entries(signed.arches)) {
    const filePath = path.join(release.path, info.fileName);
    const stat = statPath(filePath, `Windows update instalátor ${info.fileName}`);
    live[arch] = stat
      ? {
          available: stat.isFile(),
          sizeBytes: stat.size,
          sizeLabel: formatBytes(stat.size),
        }
      : { available: false, sizeBytes: null, sizeLabel: null };
    if (stat && !stat.isFile()) {
      throw new HttpError(500, `Cesta pro ${info.fileName} není platný soubor.`);
    }
    if (stat && Object.hasOwn(info, 'sizeBytes') && stat.size !== info.sizeBytes) {
      throw new ReleaseIntegrityError(
        500,
        `Instalátor ${info.fileName} neodpovídá podepsané velikosti.`,
        { code: 'windows_release_size_mismatch' },
      );
    }
  }

  const payload = { signed: envelope.signed, signature: envelope.signature, live };
  if (req.method === 'HEAD') {
    const data = Buffer.from(JSON.stringify(payload));
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end();
    return;
  }
  json(res, 200, payload);
}

function resolveCurrentWindowsRelease() {
  let rootStat;
  try {
    rootStat = fs.lstatSync(DOWNLOAD_ROOT);
  } catch (error) {
    console.error(`[Movly web] Nelze načíst aktivní download symlink ${DOWNLOAD_ROOT}:`, error);
    throw new HttpError(500, 'Aktivní Windows release cesta není dostupná.');
  }
  if (!rootStat.isSymbolicLink()) {
    throw new HttpError(500, 'DOWNLOAD_ROOT musí být atomicky přepínaný release symlink.');
  }

  let releasesRoot;
  let releasePath;
  try {
    releasesRoot = fs.realpathSync(path.join(path.dirname(DOWNLOAD_ROOT), WINDOWS_RELEASES_DIR_NAME));
    releasePath = fs.realpathSync(DOWNLOAD_ROOT);
  } catch (error) {
    console.error('[Movly web] Nelze resolve aktivní Windows release:', error);
    throw new HttpError(500, 'Aktivní Windows release nelze bezpečně resolve.');
  }
  if (path.dirname(releasePath) !== releasesRoot) {
    throw new HttpError(500, 'DOWNLOAD_ROOT míří mimo povolený versioned release adresář.');
  }
  const releaseId = path.basename(releasePath);
  if (!/^[A-Za-z0-9._-]+$/.test(releaseId)) {
    throw new HttpError(500, 'Aktivní Windows release má neplatné id.');
  }
  let releaseStat;
  try {
    releaseStat = fs.lstatSync(releasePath);
  } catch (error) {
    console.error(`[Movly web] Nelze načíst Windows release ${releasePath}:`, error);
    throw new HttpError(500, 'Aktivní Windows release není dostupný.');
  }
  if (!releaseStat.isDirectory() || releaseStat.isSymbolicLink()) {
    throw new HttpError(500, 'Aktivní Windows release není regulární adresář.');
  }
  return { id: releaseId, path: releasePath, releasesRoot };
}

function resolveWindowsReleaseById(releaseId) {
  if (typeof releaseId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(releaseId)) {
    throw new HttpError(403, 'Download odkaz má neplatné release id.');
  }
  let releasesRoot;
  try {
    releasesRoot = fs.realpathSync(path.join(path.dirname(DOWNLOAD_ROOT), WINDOWS_RELEASES_DIR_NAME));
  } catch (error) {
    console.error('[Movly web] Nelze načíst versioned Windows releases:', error);
    throw new HttpError(500, 'Windows release úložiště není dostupné.');
  }
  const candidate = path.join(releasesRoot, releaseId);
  let stat;
  let real;
  try {
    stat = fs.lstatSync(candidate);
    real = fs.realpathSync(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(410, 'Windows release pro tento odkaz už není dostupný.');
    console.error(`[Movly web] Nelze načíst připnutý Windows release ${candidate}:`, error);
    throw new HttpError(500, 'Připnutý Windows release nelze načíst.');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== candidate || path.dirname(real) !== releasesRoot) {
    throw new HttpError(500, 'Připnutý Windows release nemá bezpečný adresář.');
  }
  return { id: releaseId, path: real, releasesRoot };
}

function sha256FileDescriptor(openedFile, label) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(openedFile.identity.realPath, {
      fd: openedFile.fd,
      autoClose: false,
      start: 0,
    });
    stream.on('error', (error) => {
      console.error(`[Movly web] SHA-256 čtení pro ${label} selhalo:`, error);
      reject(new HttpError(500, `Nelze ověřit SHA-256 pro ${label}.`));
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyWindowsReleaseFile(filePath, expectedSha256, label) {
  const openedFile = openWindowsReleaseFile(filePath, label);
  try {
    return await verifyOpenedWindowsReleaseFile(openedFile, expectedSha256, label);
  } finally {
    closeWindowsReleaseFile(openedFile, label);
  }
}

async function openVerifiedWindowsReleaseFile(filePath, expectedSha256, label) {
  const openedFile = openWindowsReleaseFile(filePath, label);
  try {
    await verifyOpenedWindowsReleaseFile(openedFile, expectedSha256, label);
    return openedFile;
  } catch (error) {
    closeWindowsReleaseFile(openedFile, label);
    throw error;
  }
}

async function verifyOpenedWindowsReleaseFile(openedFile, expectedSha256, label) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new HttpError(500, `Očekávaný SHA-256 pro ${label} není platný.`);
  }
  const { identity } = openedFile;
  const logicalKey = `${identity.realPath}\0${expectedSha256}`;
  const cacheKey = `${logicalKey}\0${identity.fingerprint}`;

  for (const [key, entry] of windowsIntegrityCache) {
    if (entry.logicalKey === logicalKey && key !== cacheKey) windowsIntegrityCache.delete(key);
  }

  const cached = windowsIntegrityCache.get(cacheKey);
  if (cached) {
    windowsIntegrityCache.delete(cacheKey);
    windowsIntegrityCache.set(cacheKey, cached);
    await cached.promise;
    return identity;
  }

  while (windowsIntegrityCache.size >= WINDOWS_INTEGRITY_CACHE_MAX_ENTRIES) {
    const oldestKey = windowsIntegrityCache.keys().next().value;
    if (oldestKey === undefined) {
      throw new HttpError(503, 'Windows integrity cache nelze bezpečně uvolnit.');
    }
    windowsIntegrityCache.delete(oldestKey);
  }

  const verification = hashAndVerifyWindowsReleaseFile(openedFile, expectedSha256, label);
  windowsIntegrityCache.set(cacheKey, { logicalKey, promise: verification });
  try {
    await verification;
    return identity;
  } catch (error) {
    if (!(error instanceof ReleaseIntegrityError)) windowsIntegrityCache.delete(cacheKey);
    throw error;
  }
}

function openWindowsReleaseFile(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new HttpError(500, `Cesta pro ${label} není explicitní absolutní cesta.`);
  }
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
    throw new HttpError(500, `Platforma neumí bezpečně otevřít ${label} s O_NOFOLLOW.`);
  }
  let fd = null;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const descriptorStat = fs.fstatSync(fd, { bigint: true });
    const pathStat = fs.lstatSync(filePath, { bigint: true });
    const realPath = fs.realpathSync(filePath);
    const identity = windowsReleaseIdentity(descriptorStat, realPath, label);
    const pathIdentity = windowsReleaseIdentity(pathStat, realPath, label);
    if (pathStat.isSymbolicLink() || realPath !== filePath
        || pathIdentity.fingerprint !== identity.fingerprint) {
      throw new HttpError(500, `${label} se při bezpečném otevření změnil nebo je symlink.`);
    }
    return { fd, identity };
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {
        console.error(`[Movly web] Nelze zavřít descriptor po chybě pro ${label}:`, closeError);
      }
    }
    if (error instanceof HttpError) throw error;
    console.error(`[Movly web] Nelze bezpečně otevřít ${label}:`, error);
    throw new HttpError(500, `Nelze bezpečně otevřít ${label}.`);
  }
}

function windowsReleaseIdentity(stat, realPath, label) {
  if (!stat.isFile()) {
    throw new HttpError(500, `${label} musí být regulární soubor.`);
  }
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new HttpError(500, `${label} má nepodporovanou velikost.`);
  }
  const fingerprint = [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
  ].map(String).join(':');
  return { realPath, fingerprint, size };
}

function closeWindowsReleaseFile(openedFile, label) {
  if (openedFile.fd === null) return;
  const fd = openedFile.fd;
  openedFile.fd = null;
  try {
    fs.closeSync(fd);
  } catch (error) {
    console.error(`[Movly web] Nelze zavřít descriptor pro ${label}:`, error);
    throw new HttpError(500, `Nelze bezpečně uzavřít ${label}.`);
  }
}

async function hashAndVerifyWindowsReleaseFile(openedFile, expectedSha256, label) {
  const { identity } = openedFile;
  windowsIntegrityHashComputations += 1;
  const actualSha256 = await sha256FileDescriptor(openedFile, label);
  let after;
  try {
    after = windowsReleaseIdentity(
      fs.fstatSync(openedFile.fd, { bigint: true }),
      identity.realPath,
      label,
    );
  } catch (error) {
    throw new ReleaseIntegrityError(500, `${label} se během ověřování změnil nebo zmizel.`, {
      code: 'windows_release_file_changed',
    });
  }
  if (after.fingerprint !== identity.fingerprint || after.realPath !== identity.realPath) {
    throw new ReleaseIntegrityError(500, `${label} se během ověřování změnil.`, {
      code: 'windows_release_file_changed',
    });
  }
  if (!safeEqual(actualSha256, expectedSha256)) {
    throw new ReleaseIntegrityError(500, `${label} neodpovídá podepsanému SHA-256.`, {
      code: 'windows_release_integrity_mismatch',
    });
  }
  return identity;
}

function resetWindowsSecurityStateForTests() {
  windowsIntegrityCache.clear();
  windowsLinkRateBuckets.clear();
  windowsIntegrityHashComputations = 0;
}

function windowsSecurityStateForTests() {
  return {
    integrityCacheEntries: windowsIntegrityCache.size,
    integrityHashComputations: windowsIntegrityHashComputations,
    rateBucketEntries: windowsLinkRateBuckets.size,
    rateLimits: {
      user: WINDOWS_LINK_USER_LIMIT,
      ip: WINDOWS_LINK_IP_LIMIT,
      windowMs: WINDOWS_LINK_RATE_WINDOW_MS,
    },
  };
}

function readWindowsReleaseManifest(releaseRoot) {
  if (typeof releaseRoot !== 'string' || !path.isAbsolute(releaseRoot)) {
    throw new HttpError(500, 'Windows release root nebyl explicitně určen.');
  }
  const manifestPath = path.join(releaseRoot, WINDOWS_UPDATE_MANIFEST);
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new HttpError(404, `Manifest ${WINDOWS_UPDATE_MANIFEST} není v aktivním Windows release.`);
    }
    console.error(`[Movly web] Nelze přečíst ${manifestPath}:`, error);
    throw new HttpError(500, `Manifest ${WINDOWS_UPDATE_MANIFEST} nelze přečíst.`);
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new HttpError(500, 'Update manifest má neplatný JSON.');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || typeof envelope.signed !== 'string' || typeof envelope.signature !== 'string') {
    throw new HttpError(500, 'Update manifest nemá podepsaná data.');
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) {
    throw new HttpError(500, 'Update manifest nemá platný Ed25519 podpis v base64 formátu.');
  }
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      null,
      Buffer.from(envelope.signed, 'utf8'),
      WINDOWS_UPDATE_PUBLIC_KEY,
      Buffer.from(envelope.signature, 'base64'),
    );
  } catch (error) {
    console.error('[Movly web] Ed25519 ověření Windows manifestu selhalo:', error);
    throw new HttpError(500, 'Ed25519 podpis Windows update manifestu nelze ověřit.');
  }
  if (!signatureValid) {
    throw new HttpError(500, 'Windows update manifest má neplatný Ed25519 podpis.');
  }

  let signed;
  try {
    signed = JSON.parse(envelope.signed);
  } catch {
    throw new HttpError(500, 'Podepsaná data manifestu nejsou platný JSON.');
  }

  if (!signed?.arches || typeof signed.arches !== 'object' || Array.isArray(signed.arches)) {
    throw new HttpError(500, 'Podepsaná data manifestu nemají objekt arches.');
  }
  if (typeof signed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(signed.version)
      || !Number.isSafeInteger(signed.buildCode) || signed.buildCode <= 0) {
    throw new HttpError(500, 'Windows update manifest nemá platnou verzi a build code.');
  }
  if (typeof signed.channel !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(signed.channel)) {
    throw new HttpError(500, 'Windows update manifest nemá platný kanál.');
  }
  if (!isActualISODate(signed.releasedAt)) {
    throw new HttpError(500, 'Windows update manifest nemá platné datum vydání.');
  }
  if (typeof signed.notes !== 'string') {
    throw new HttpError(500, 'Windows update manifest nemá textové release notes.');
  }

  let format;
  if (hasExactObjectKeys(signed, WINDOWS_SECURE_MANIFEST_KEYS)) {
    format = WINDOWS_MANIFEST_FORMAT_SECURE_V2;
    if (typeof signed.security !== 'boolean') {
      throw new HttpError(500, 'Windows secure-v2 manifest nemá explicitní příznak security.');
    }
    if (typeof signed.authenticodeCertificateSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(signed.authenticodeCertificateSha256)) {
      throw new HttpError(500, 'Windows secure-v2 manifest nemá platný Authenticode certificate SHA-256.');
    }
  } else if (hasExactObjectKeys(signed, WINDOWS_LEGACY_MANIFEST_KEYS)) {
    format = WINDOWS_MANIFEST_FORMAT_LEGACY_V1;
  } else {
    const hasSecurity = Object.hasOwn(signed, 'security');
    const hasCertificate = Object.hasOwn(signed, 'authenticodeCertificateSha256');
    if (hasSecurity !== hasCertificate) {
      throw new HttpError(500, 'Windows manifest má neúplná secure-v2 metadata.');
    }
    throw new HttpError(500, 'Windows manifest nemá podporovaný explicitní formát legacy-v1 ani secure-v2.');
  }

  const entries = Object.entries(signed.arches);
  if (entries.length !== WINDOWS_UPDATE_TARGETS.size) {
    throw new HttpError(500, 'Windows update manifest musí obsahovat přesně arm64, x64 a x86.');
  }

  const downloadIds = new Set();
  for (const [arch, info] of entries) {
    const expected = WINDOWS_UPDATE_TARGETS.get(arch);
    if (!expected) {
      throw new HttpError(500, `Windows update manifest obsahuje nepovolenou architekturu ${arch}.`);
    }
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      throw new HttpError(500, `Windows update manifest má neplatný záznam pro ${arch}.`);
    }
    if (info.downloadId !== expected.downloadId || info.fileName !== expected.fileName) {
      throw new HttpError(500, `Windows update manifest má neplatné mapování pro ${arch}.`);
    }
    if (typeof info.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(info.sha256)) {
      throw new HttpError(500, `Windows update manifest má neplatný SHA-256 pro ${arch}.`);
    }
    if (Object.hasOwn(info, 'sizeBytes')
        && (!Number.isSafeInteger(info.sizeBytes) || info.sizeBytes <= 0)) {
      throw new HttpError(
        500,
        `Windows update manifest nemá platnou podepsanou velikost pro ${arch}.`,
      );
    }
    downloadIds.add(info.downloadId);
  }

  for (const expected of WINDOWS_UPDATE_TARGETS.values()) {
    if (!downloadIds.has(expected.downloadId)) {
      throw new HttpError(500, `Windows update manifest postrádá ${expected.downloadId}.`);
    }
  }

  return { envelope, signed, downloadIds, format };
}

function readWindowsUpdateManifest(releaseRoot) {
  const manifest = readWindowsReleaseManifest(releaseRoot);
  if (manifest.format !== WINDOWS_MANIFEST_FORMAT_SECURE_V2) {
    throw new HttpError(
      500,
      'Aktivní Windows release používá legacy-v1 manifest; je povolen jen pro ruční Premium stažení, ne pro auto-update.',
    );
  }
  return manifest;
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isActualISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function handleSecureDownload(req, res, token) {
  const verified = verifyDownloadToken(token);
  const { item, releaseId, sha256 } = verified;
  const isWindows = WINDOWS_UPDATE_DOWNLOAD_IDS.has(item.id);
  if (isWindows !== (releaseId !== null)) {
    throw new HttpError(403, 'Download odkaz nemá požadovanou Windows release vazbu.');
  }
  const releaseRoot = releaseId === null ? DOWNLOAD_ROOT : resolveWindowsReleaseById(releaseId).path;
  const filePath = path.join(releaseRoot, item.fileName);
  let openedWindowsFile = null;
  let fileSize;
  try {
    if (sha256 !== null) {
      openedWindowsFile = await openVerifiedWindowsReleaseFile(
        filePath,
        sha256,
        `připnutý instalátor ${item.fileName}`,
      );
      fileSize = openedWindowsFile.identity.size;
    } else {
      const stat = statPath(filePath, `instalátor ${item.fileName}`);
      if (!stat) throw new HttpError(404, `Soubor ${item.fileName} není v připnutém release.`);
      if (!stat.isFile()) throw new HttpError(404, `Soubor ${item.fileName} není platný soubor.`);
      fileSize = stat.size;
    }

    const fileName = item.fileName.replace(/["\\]/g, '');
    const range = req.headers.range;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.method === 'HEAD') {
      if (openedWindowsFile) closeWindowsReleaseFile(openedWindowsFile, `instalátor ${item.fileName}`);
      res.writeHead(200, { 'Content-Length': fileSize });
      res.end();
      return;
    }

    if (range) {
      const { start, end } = parseByteRange(range, fileSize);
      res.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      });
      if (openedWindowsFile) {
        pipeOpenedWindowsFile(openedWindowsFile, res, { start, end }, `instalátor ${item.fileName}`);
      } else {
        pipeFile(filePath, res, { start, end }, `instalátor ${item.fileName}`);
      }
      return;
    }

    res.writeHead(200, { 'Content-Length': fileSize });
    if (openedWindowsFile) {
      pipeOpenedWindowsFile(openedWindowsFile, res, {}, `instalátor ${item.fileName}`);
    } else {
      pipeFile(filePath, res, {}, `instalátor ${item.fileName}`);
    }
  } finally {
    if (openedWindowsFile && openedWindowsFile.fd !== null) {
      closeWindowsReleaseFile(openedWindowsFile, `instalátor ${item.fileName}`);
    }
  }
}

function parseByteRange(header, fileSize) {
  const invalidRange = (message) => new HttpError(
    416,
    message,
    { contentRange: `bytes */${Number.isSafeInteger(fileSize) && fileSize >= 0 ? fileSize : 0}` },
  );
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw invalidRange('Rozsah nelze použít pro prázdný nebo příliš velký soubor.');
  }
  if (typeof header !== 'string') throw invalidRange('Neplatný rozsah stahování.');
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw invalidRange('Neplatný rozsah stahování.');

  const parsePart = (raw) => {
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidRange('Neplatný rozsah stahování.');
    return parsed;
  };
  const first = parsePart(match[1]);
  const last = parsePart(match[2]);

  let start;
  let end;
  if (first === null) {
    if (last === 0) throw invalidRange('Suffix rozsah musí být větší než nula.');
    start = Math.max(fileSize - last, 0);
    end = fileSize - 1;
  } else {
    start = first;
    end = last === null ? fileSize - 1 : last;
  }
  if (start >= fileSize || end >= fileSize || start > end) {
    throw invalidRange('Neplatný rozsah stahování.');
  }
  return { start, end };
}

function pipeFile(filePath, res, options, label) {
  const stream = fs.createReadStream(filePath, options);
  pipeReadableFileStream(stream, res, label);
}

function pipeOpenedWindowsFile(openedFile, res, options, label) {
  const stream = fs.createReadStream(openedFile.identity.realPath, {
    ...options,
    fd: openedFile.fd,
    autoClose: true,
    ...(Object.hasOwn(options, 'start') ? {} : { start: 0 }),
  });
  openedFile.fd = null;
  pipeReadableFileStream(stream, res, label);
}

function pipeReadableFileStream(stream, res, label) {
  if (res.destroyed || res.writableEnded) {
    stream.destroy();
    return;
  }
  let sourceEnded = false;
  const closeOnAbortedResponse = () => {
    if (!sourceEnded && !stream.destroyed) stream.destroy();
  };
  stream.once('end', () => {
    sourceEnded = true;
    res.off('close', closeOnAbortedResponse);
  });
  stream.once('close', () => res.off('close', closeOnAbortedResponse));
  res.once('close', closeOnAbortedResponse);
  stream.once('error', (error) => {
    console.error(`[Movly web] Čtení ${label} selhalo po odeslání hlaviček:`, error);
    res.destroy(error);
  });
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  let relativePath = pathname === '/app' || pathname === '/app/'
    ? '/app/index.html'
    : pathname === '/'
    ? '/index.html'
    : pathname === '/activate'
      ? '/activate.html'
      : pathname === '/devices'
        ? '/devices.html'
        : /^\/party\/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(pathname)
          ? '/party.html'
        : pathname;
  try {
    relativePath = decodeURIComponent(relativePath);
  } catch {
    throw new HttpError(400, 'Neplatná URL.');
  }

  if (
    relativePath.startsWith('/.git') ||
    relativePath.startsWith('/design/') ||
    relativePath.startsWith('/test-support/') ||
    relativePath.endsWith('-server.js') ||
    relativePath.endsWith('.test.js') ||
    relativePath.startsWith('/downloads') ||
    relativePath === '/server.js' ||
    relativePath === '/package.json' ||
    relativePath.toLowerCase().endsWith('.md') ||
    relativePath.toLowerCase().endsWith('.zip') ||
    relativePath === '/.env' ||
    relativePath === '/.env.example'
  ) {
    notFound(res);
    return;
  }

  const filePath = path.resolve(ROOT_DIR, `.${relativePath}`);
  if (!filePath.startsWith(`${ROOT_DIR}${path.sep}`)) throw new HttpError(403, 'Přístup odepřen.');
  const stat = statPath(filePath, `statický soubor ${relativePath}`);
  if (!stat) {
    notFound(res);
    return;
  }
  if (!stat.isFile()) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = relativePath === '/.well-known/apple-app-site-association'
    ? 'application/json; charset=utf-8'
    : (mimeTypes.get(ext) || 'application/octet-stream');
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' || relativePath.startsWith('/app/') ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  pipeFile(filePath, res, {}, `statický soubor ${relativePath}`);
}

const handleApp = createAppHandler({
  api: (target, method, body, token, sessionId, headers) =>
    movlyApiResponse(target, method, body, token, sessionId, API_TIMEOUT_MS, headers),
  json, readBody: readRequestBody, HttpError, secret: DOWNLOAD_TOKEN_SECRET,
  production: NODE_ENV_RAW === 'production',
});

async function route(req, res) {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/app')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://image.tmdb.org https://res.cloudinary.com/dsnzqq6kh/; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }
  if (await handleApp(req, res, url)) return;

  if (req.method === 'POST' && pathname === '/api/auth/login') return handleLogin(req, res);
  if (req.method === 'GET' && pathname === '/api/auth/me') return handleMe(req, res);
  if (req.method === 'POST' && pathname === '/api/auth/logout') return handleLogout(req, res);
  if (req.method === 'POST' && pathname === '/api/device-authorization/preview') {
    return handleDeviceAuthorizationPreview(req, res);
  }
  if (req.method === 'POST' && pathname === '/api/device-authorization/approve') {
    return handleDeviceAuthorizationDecision(req, res, true);
  }
  if (req.method === 'POST' && pathname === '/api/device-authorization/deny') {
    return handleDeviceAuthorizationDecision(req, res, false);
  }
  if (req.method === 'GET' && pathname === '/api/devices') {
    return handleManagedList(req, res, url, 'devices', normalizeManagedDevice);
  }
  if (req.method === 'GET' && pathname === '/api/sessions') {
    return handleManagedList(req, res, url, 'sessions', normalizeManagedSession);
  }
  if (req.method === 'GET' && pathname === '/api/downloads') return handleDownloads(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/updates/windows') {
    return handleWindowsUpdate(req, res);
  }

  const managedDeviceMatch = /^\/api\/devices\/([^/]+)$/.exec(pathname);
  if (managedDeviceMatch && req.method === 'PATCH') {
    return handleManagedDeviceRename(req, res, managedDeviceMatch[1]);
  }
  if (managedDeviceMatch && req.method === 'DELETE') {
    return handleManagedRevoke(req, res, 'devices', managedDeviceMatch[1], url);
  }

  const managedSessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
  if (managedSessionMatch && req.method === 'DELETE') {
    return handleManagedRevoke(req, res, 'sessions', managedSessionMatch[1], url);
  }

  const linkMatch = /^\/api\/downloads\/([^/]+)\/link$/.exec(pathname);
  if (req.method === 'POST' && linkMatch) return handleDownloadLink(req, res, linkMatch[1]);

  const updateLinkMatch = /^\/api\/updates\/windows\/downloads\/([^/]+)\/link$/.exec(pathname);
  if (req.method === 'POST' && updateLinkMatch) return handleWindowsUpdateLink(req, res, updateLinkMatch[1]);

  const uploadMatch = /^\/api\/upload\/([A-Za-z0-9._-]+)$/.exec(pathname);
  if (req.method === 'PUT' && uploadMatch) {
    req.resume();
    throw new HttpError(410, 'Přímý web upload byl z bezpečnostních důvodů zrušen; použij atomický offline publisher.');
  }

  const secureMatch = /^\/secure-download\/([^/]+)$/.exec(pathname);
  if ((req.method === 'GET' || req.method === 'HEAD') && secureMatch) return handleSecureDownload(req, res, secureMatch[1]);

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);

  throw new HttpError(405, 'Metoda není povolená.');
}

function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve(route(req, res)).catch((error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      if (error instanceof ApiError) {
        if (error.status === 429) {
          const retryAfter = error.headers?.get('retry-after');
          const retryAfterSeconds = parseStrictUnsignedInteger(retryAfter);
          if (!Number.isSafeInteger(retryAfterSeconds)
              || retryAfterSeconds < 1
              || retryAfterSeconds > 86400) {
            json(res, 502, {
              message: 'Movly API vrátilo 429 bez platného Retry-After.',
              code: error.code || null,
            });
            return;
          }
          res.setHeader('Retry-After', String(retryAfterSeconds));
          json(res, 429, { message: error.message, code: error.code || null });
          return;
        }
        if (error.status === 503) {
          const retryAfter = error.headers?.get('retry-after');
          if (retryAfter !== null) {
            const retryAfterSeconds = parseStrictUnsignedInteger(retryAfter);
            if (!Number.isSafeInteger(retryAfterSeconds)
                || retryAfterSeconds < 1
                || retryAfterSeconds > 86400) {
              json(res, 502, {
                message: 'Movly API vrátilo 503 s neplatným Retry-After.',
                code: error.code || null,
              });
              return;
            }
            res.setHeader('Retry-After', String(retryAfterSeconds));
          }
          json(res, 503, { message: error.message, code: error.code || null });
          return;
        }
        const status = error.status === 401 ? 401 : error.status === 403 ? 403 : 502;
        json(res, status, { message: error.message, code: error.code || null });
        return;
      }
      if (error instanceof HttpError) {
        if (error.status === 429 && Number.isSafeInteger(error.payload?.retryAfterSeconds)) {
          res.setHeader('Retry-After', String(error.payload.retryAfterSeconds));
        }
        if (error.status === 416 && typeof error.payload?.contentRange === 'string') {
          res.setHeader('Content-Range', error.payload.contentRange);
        }
        json(res, error.status, { message: error.message, ...(error.payload || {}) });
        return;
      }
      console.error('[Movly web] Neošetřená chyba:', error);
      json(res, 500, { message: 'Serverová chyba.' });
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[Movly web] běží na http://localhost:${PORT}`);
    console.log(`[Movly web] instalačky čte z ${DOWNLOAD_ROOT}`);
  });
}

module.exports = {
  HttpError,
  createServer,
  enforceWindowsLinkRateLimit,
  isPremiumActive,
  movlyApi,
  parseByteRange,
  pipeReadableFileStream,
  resetWindowsSecurityStateForTests,
  resolveClientRateLimitIP,
  statPath,
  windowsSecurityStateForTests,
};
