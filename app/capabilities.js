import { apiContextKey } from './api.js';

const CAPABILITY_PATH = 'capabilities/negotiate';
const PROBE_TIMEOUT_MS = 4000;
const MAX_CACHE_TTL_MS = 300000;
const FAILURE_CACHE_TTL_MS = 30000;
const MAX_CACHE_ENTRIES = 16;
const MAX_IN_FLIGHT = 16;
const cache = new Map();
const inFlight = new Map();
const systemClock = () => globalThis.performance?.now?.() ?? Date.now();
let clock = systemClock;

function now() { return clock(); }
function currentOrigin() {
  try { return globalThis.location?.origin || 'same-origin'; }
  catch { return 'same-origin'; }
}
function key(context, origin = currentOrigin(), capability = "catalog_batch") { return `${origin}\n${context}\n${capability}`; }
function pruneCache(at = now()) {
  for (const [cacheKey, entry] of cache) if (entry.expiresAt <= at) cache.delete(cacheKey);
}
function storeCache(cacheKey, entry) {
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}
function staleContextError() { return new DOMException('Context changed', 'AbortError'); }
function validNegotiation(value) {
  if (!value || value.schema_version !== 1 ||
      typeof value.revision !== 'string' || !/^cap1\.[a-f0-9]{64}$/.test(value.revision) ||
      !Number.isSafeInteger(value.cache_ttl_seconds) || value.cache_ttl_seconds < 0 ||
      !Array.isArray(value.server_capabilities) || value.server_capabilities.length > 16 ||
      !Array.isArray(value.negotiated) || value.negotiated.length > 16) return false;
  const ids = new Set();
  for (const capability of value.server_capabilities) {
    if (!capability || typeof capability.id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(capability.id) ||
        ids.has(capability.id) || !Array.isArray(capability.versions) || capability.versions.length < 1 ||
        capability.versions.length > 8 || capability.versions.some(version => !Number.isSafeInteger(version) || version < 1 || version > 1000) ||
        new Set(capability.versions).size !== capability.versions.length || typeof capability.enabled !== 'boolean') return false;
    ids.add(capability.id);
  }
  const negotiatedIds = new Set();
  for (const item of value.negotiated) {
    if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.id) ||
        negotiatedIds.has(item.id) || !Number.isSafeInteger(item.version) || item.version < 1 || item.version > 1000) return false;
    negotiatedIds.add(item.id);
  }
  return true;
}

async function probe(request, capability) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await request(CAPABILITY_PATH, {
      method: 'POST',
      signal: controller.signal,
      body: { schema_version: 1, client_capabilities: [{ id: capability, versions: [1] }] },
      optionalProbe: true,
    });
    if (!validNegotiation(response)) return { supported: false, ttl: FAILURE_CACHE_TTL_MS };
    const server = response.server_capabilities.find(item => item.id === capability);
    const negotiated = response.negotiated.find(item => item.id === capability);
    const supported = Boolean(server?.enabled && server.versions.includes(1) && negotiated?.version === 1);
    const ttl = supported ? Math.min(response.cache_ttl_seconds * 1000, MAX_CACHE_TTL_MS) : FAILURE_CACHE_TTL_MS;
    return { supported, ttl };
  } catch (error) {
    return { supported: false, ttl: FAILURE_CACHE_TTL_MS };
  } finally {
    clearTimeout(timer);
  }
}

export async function supportsCapability(capability, request, signal, context, origin = currentOrigin(), isContextCurrent = () => apiContextKey() === context) {
  if (!["catalog_batch", "playback_attempt"].includes(capability)) return false;
  if (!isContextCurrent()) throw staleContextError();
  const currentTime = now();
  pruneCache(currentTime);
  const cacheKey = key(context, origin, capability);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > currentTime) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached.supported;
  }
  if (!isContextCurrent()) throw staleContextError();
  let record = inFlight.get(cacheKey);
  if (!record) {
    if (inFlight.size >= MAX_IN_FLIGHT) return false;
    record = { invalidated: false, promise: null };
    record.promise = probe(request, capability).then(result => {
      if (record.invalidated || inFlight.get(cacheKey) !== record || !isContextCurrent()) throw staleContextError();
      storeCache(cacheKey, { supported: result.supported, expiresAt: now() + result.ttl });
      return result.supported;
    }).finally(() => {
      if (inFlight.get(cacheKey) === record) inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, record);
  }
  const pending = record.promise;
  if (!signal) return pending;
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  return Promise.race([pending, new Promise((_, reject) => {
    const abort = () => reject(new DOMException('Request aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(() => signal.removeEventListener('abort', abort), () => signal.removeEventListener('abort', abort));
  })]);
}

export function invalidateCapabilityCache(context, origin = currentOrigin()) {
 for (const capability of ["catalog_batch", "playback_attempt"]) {
  const cacheKey = key(context, origin, capability);
  cache.delete(cacheKey);
  const record = inFlight.get(cacheKey);
  if (record) {
    record.invalidated = true;
    inFlight.delete(cacheKey);
  }
 }
}

export function supportsCatalogBatch(...args) { return supportsCapability("catalog_batch", ...args); }
export function supportsPlaybackAttempt(...args) { return supportsCapability("playback_attempt", ...args); }
export function cachedPlaybackAttempt(context, origin = currentOrigin()) {
 const entry=cache.get(key(context,origin,"playback_attempt"));
 return Boolean(entry && entry.expiresAt>now() && entry.supported);
}

export function resetCapabilityCacheForTests() { cache.clear(); inFlight.clear(); clock = systemClock; }
export function setCapabilityClockForTests(value = systemClock) { clock = value; }
