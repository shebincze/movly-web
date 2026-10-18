// Original-media milliseconds; never scale timestamps to fit another release.
// #1110: intro + recap share the skip machine; unknown kinds are ignored, credits go through creditsOffer.
// Odpovědi /v1/playback/segments drží jen paměťová cache stránky (max 1 h, klíč podle vlastníka/profilu).
// Starší API v nich ještě může vracet data TheIntroDB, která se nesmí ukládat do storage (Movly#1117).
export const LEGACY_INTRO_CACHE_KEYS = Object.freeze(["movly.intro.segments.v1", "movly.intro.segments.v2"]);
export const INTRO_CACHE_MAX_AGE_MS = 3600000, INTRO_CACHE_MAX_ENTRIES = 50;
const SKIPPABLE = new Set(["intro", "recap"]);
const span = (s, min = 2000) => Number.isSafeInteger(s?.start_ms) && Number.isSafeInteger(s?.end_ms) && s.start_ms >= 0 && s.end_ms - s.start_ms >= min;
export class IntroSkipMachine {
  offer = null; countdown = null; undoPosition = null;
  consumed = new Set(); suppressed = new Set(); pending = null;
  previous = null; since = null; undoUntil = 0;
  tick({position, duration, now, playing, canSeek, mode, segments}) {
    if (now > this.undoUntil) this.undoPosition = null;
    if (this.pending) {
      const p = this.pending;
      if (canSeek && position >= p.segment.end_ms - 1000 && Math.abs(position - p.segment.end_ms) < 10000) {
        this.consumed.add(p.segment.id); this.undoPosition = p.origin; this.undoUntil = now + 8000; this.pending = null;
      } else if (now - p.at > 8000) { this.suppressed.add(p.segment.id); this.pending = null; }
      this.previous = position; this.offer = null; this.countdown = null; return null;
    }
    const next = segments.find(s => SKIPPABLE.has(s.kind) && span(s) && s.end_ms < duration - 2000 && position >= s.start_ms && position < s.end_ms - 2000);
    if (this.previous !== null && position < this.previous - 1000 && next) { this.suppressed.add(next.id); this.consumed.delete(next.id); }
    this.previous = position;
    if (mode === "off" || !canSeek || !next || this.consumed.has(next.id)) { this.offer = null; this.countdown = null; this.since = null; return null; }
    if (this.offer?.id !== next.id) this.since = null;
    this.offer = next;
    if (mode !== "auto" || next.auto_eligible !== true || !playing || this.suppressed.has(next.id)) { this.countdown = null; this.since = null; return null; }
    this.since ??= now;
    const remaining = Math.max(0, 3000 - (now - this.since)); this.countdown = Math.ceil(remaining / 1000);
    return remaining === 0 ? this.request(position, now) : null;
  }
  request(position, now) { if (!this.offer || this.pending) return null; this.pending = {segment:this.offer, origin:position, at:now}; this.since = null; this.countdown = null; return this.offer.end_ms; }
  cancel() { if (this.offer) this.suppressed.add(this.offer.id); this.since = null; this.countdown = null; }
  undo() { const p = this.undoPosition; this.undoPosition = null; return p; }
}
// Titulky: bez stavu, nikdy automaticky, bez odpočtu a undo. post_credits se nenabízí, jen brání „Další díl“ přeskočit scénu po titulcích.
export function creditsOffer(position, duration, segments = [], mode, canAct, hasNextEpisode, upNextVisible) {
  if (mode === "off" || !canAct || upNextVisible) return null;
  const segment = segments.find(s => s.kind === "credits" && span(s) && s.end_ms <= duration && s.start_ms < duration - 2000 && position >= s.start_ms && position < s.end_ms - 2000);
  if (!segment) return null;
  const follows = duration - segment.end_ms > 15000 || segments.some(s => s.kind === "post_credits" && span(s) && s.start_ms >= segment.start_ms && s.end_ms <= duration);
  return hasNextEpisode && !follows ? {segment, action:"nextEpisode"} : {segment, action:"skip", target:follows ? segment.end_ms : Math.min(segment.end_ms, duration - 1000)};
}
// File chapters replace only API intros; recap/credits from the API stay.
export function mergeChapterIntros(chapters, remote = []) {
  const local = chapterIntros(chapters);
  return local.length ? [...local, ...remote.filter(s => s.kind !== "intro")].sort((a, b) => a.start_ms - b.start_ms) : remote;
}
export function chapterIntros(chapters = []) {
  return chapters.filter(c => /(?:^|\W)(intro|opening|úvod|znelka|znělka)(?:$|\W)/i.test(c.name || "")).map(c => ({
    id:`chapter:${c.start}`, kind:"intro", start_ms:Math.round(c.start*1000), end_ms:Math.round(c.end*1000), source:"chapter", auto_eligible:true,
  }));
}
// cache: Map (paměť stránky). Stávající logika expires_at/stale zůstává: prošlá odpověď je jen ruční.
export function readIntroCache(cache, key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry || now-entry.saved >= INTRO_CACHE_MAX_AGE_MS || !Array.isArray(entry.value?.segments)) { cache.delete(key); return null; }
  if (entry.value.expires_at*1000 > now) return entry.value;
  return {...entry.value, stale:true, segments:entry.value.segments.map(s => ({...s, auto_eligible:false}))};
}
export function writeIntroCache(cache, key, value, now = Date.now()) {
  if (value.stale) return;
  cache.delete(key); cache.set(key, {value, saved:now});
  while (cache.size > INTRO_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
}
export const introSegmentsCache = new Map();
// Při startu smaže dřívější perzistentní cache (v1 jen intro, v2 až 7 dní, obojí v localStorage).
export function clearLegacyIntroCache(storage) {
  for (const key of LEGACY_INTRO_CACHE_KEYS) try { storage?.removeItem(key); } catch { /* private mode */ }
}
