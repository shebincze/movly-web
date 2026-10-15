// Original-media milliseconds; never scale timestamps to fit another release.
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
    const next = segments.find(s => s.kind === "intro" && Number.isSafeInteger(s.start_ms) && Number.isSafeInteger(s.end_ms) &&
      s.start_ms >= 0 && s.end_ms - s.start_ms >= 2000 && s.end_ms < duration - 2000 && position >= s.start_ms && position < s.end_ms - 2000);
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
export function chapterIntros(chapters = []) {
  return chapters.filter(c => /(?:^|\W)(intro|opening|úvod|znelka|znělka)(?:$|\W)/i.test(c.name || "")).map(c => ({
    id:`chapter:${c.start}`, kind:"intro", start_ms:Math.round(c.start*1000), end_ms:Math.round(c.end*1000), source:"chapter", auto_eligible:true,
  }));
}
export function readIntroCache(storage, key, now = Date.now()) {
  try {
    const entry = JSON.parse(storage.getItem("movly.intro.segments.v1") || "{}")[key];
    if (!entry || now-entry.saved >= 7*86400000 || !Array.isArray(entry.value?.segments)) return null;
    if (entry.value.expires_at*1000 > now) return entry.value;
    return {...entry.value, stale:true, segments:entry.value.segments.map(s => ({...s, auto_eligible:false}))};
  } catch { return null; }
}
export function writeIntroCache(storage, key, value, now = Date.now()) {
  if (value.stale) return;
  try {
    let entries; try { entries=JSON.parse(storage.getItem("movly.intro.segments.v1") || "{}"); } catch { entries={}; }
    entries[key]={value,saved:now};
    const ordered=Object.entries(entries).sort((a,b)=>b[1].saved-a[1].saved).slice(0,200);
    storage.setItem("movly.intro.segments.v1", JSON.stringify(Object.fromEntries(ordered)));
  } catch { /* Quota/private mode must not affect playback. */ }
}
