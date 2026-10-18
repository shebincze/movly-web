// Original-media milliseconds; never scale timestamps to fit another release.
// #1110: intro + recap share the skip machine; unknown kinds are ignored, credits go through creditsOffer.
export const INTRO_CACHE_KEY = "movly.intro.segments.v2";
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
export function readIntroCache(storage, key, now = Date.now()) {
  try {
    const entry = JSON.parse(storage.getItem(INTRO_CACHE_KEY) || "{}")[key];
    if (!entry || now-entry.saved >= 7*86400000 || !Array.isArray(entry.value?.segments)) return null;
    if (entry.value.expires_at*1000 > now) return entry.value;
    return {...entry.value, stale:true, segments:entry.value.segments.map(s => ({...s, auto_eligible:false}))};
  } catch { return null; }
}
export function writeIntroCache(storage, key, value, now = Date.now()) {
  if (value.stale) return;
  try {
    let entries; try { entries=JSON.parse(storage.getItem(INTRO_CACHE_KEY) || "{}"); } catch { entries={}; }
    entries[key]={value,saved:now};
    const ordered=Object.entries(entries).sort((a,b)=>b[1].saved-a[1].saved).slice(0,200);
    storage.setItem(INTRO_CACHE_KEY, JSON.stringify(Object.fromEntries(ordered)));
    storage.removeItem?.("movly.intro.segments.v1"); // v1 holds intro-only answers that would hide recap/credits for up to 7 days.
  } catch { /* Quota/private mode must not affect playback. */ }
}
