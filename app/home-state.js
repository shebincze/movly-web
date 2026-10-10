// Server-owned composition. No client list names or inferred recommendation data.
export function homeQuery({ section, collection, page = 1 } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || (section && collection)) throw new Error("Neplatná stránka Domů.");
  const q = new URLSearchParams({ include_highlights: "true", page: String(page) });
  for (const [key, value] of Object.entries({ section, collection })) {
    if (value == null) continue;
    if (!/^[a-z0-9_-]{1,100}$/.test(value)) throw new Error("Neplatná řada Domů.");
    q.set(key, value);
  }
  return `home?${q}`;
}
export function homeSections(data) {
  if (data?.version !== 1 || !Array.isArray(data.sections) || data.sections.length > 64) throw new Error("Neplatná odpověď Domů.");
  const seen = new Set();
  for (const row of data.sections) {
    if (!/^[a-z0-9_-]{1,100}$/.test(row.slug || "") || seen.has(row.slug) ||
        typeof row.content_key !== "string" || !row.content_key || typeof row.name !== "string" ||
        !["hero", "rail", "continue", "top10", "collections", "upcoming"].includes(row.kind) ||
        !["ready", "empty", "error", "degraded", "loading"].includes(row.state)) throw new Error("Neplatná řada Domů.");
    for (const field of ["items", "collections", "highlights", "premieres"]) {
      if (row[field] != null && !Array.isArray(row[field])) throw new Error("Neplatné položky Domů.");
    }
    for (const item of row.items || []) {
      if (!Number.isSafeInteger(item?.title?.id) || item.title.id < 1 || typeof item.title.title !== "string") throw new Error("Neplatný titul Domů.");
    }
    for (const collection of row.collections || []) {
      if (!/^[a-z0-9_-]{1,100}$/.test(collection.slug || "") || typeof collection.name !== "string") throw new Error("Neplatná kolekce Domů.");
    }
    seen.add(row.slug);
  }
  return [...data.sections].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}
export function retainHome(fresh, previous) {
  return fresh.map(row => {
    const old = previous.find(r => r.slug === row.slug && r.content_key === row.content_key);
    return old && ["error", "degraded"].includes(row.state) ? {
      ...old, name: row.name, subtitle: row.subtitle, display_order: row.display_order,
      state: row.state, warning: row.warning || "Řada se neobnovila.",
    } : row;
  });
}
export function homeCaption(row, item) {
  const p = item.watch_progress;
  const pair = (s, e) => s > 0 && e > 0 ? `S${s} · E${e}` : null;
  const time = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (row.kind === "continue" && p) {
    if (p.progress_seconds > 0 && !["watched", "completed"].includes(p.watch_status))
      return [pair(p.season_number, p.episode_number), time(p.progress_seconds) + (p.duration_seconds > 0 ? ` / ${time(p.duration_seconds)}` : "")].filter(Boolean).join(" · ");
    const next = pair(p.next_season_number, p.next_episode_number);
    return next ? `Další díl · ${next}` : null;
  }
  if (row.kind === "upcoming") return (row.premieres || []).filter(p => p.title_id === item.title.id)
    .map(p => `${p.service_name} ${String(p.release_date).slice(0, 10).split("-").reverse().join(".")}`).join(" · ") || null;
  return null;
}
export function recommendationAction(item, action) {
  const m = item?.tracking;
  if (!m || typeof m.request_id !== "string" || !m.request_id || m.title_id !== item.id ||
      !Number.isSafeInteger(m.position) || m.position < 1 || !m.section || !m.list_slug) return null;
  return { request_id: m.request_id, title_id: m.title_id, action, position: m.position,
    section: m.section, list_slug: m.list_slug, ...(m.seed_title_id ? { seed_title_id: m.seed_title_id } : {}),
    platform: "web", device_type: "web" };
}

export class HomeImpressions {
  constructor(limit = 2000) { this.limit = limit; this.keys = new Set(); }
  key(owner, item) {
    const body = recommendationAction(item, "view");
    return body && Number.isSafeInteger(owner?.accountId) && Number.isSafeInteger(owner?.profileId)
      ? JSON.stringify([owner.accountId, owner.profileId, body.request_id, body.title_id, body.position, body.section, body.list_slug]) : null;
  }
  claim(owner, item) {
    const key = this.key(owner, item);
    if (!key || this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > this.limit) this.keys.delete(this.keys.values().next().value);
    return true;
  }
  release(owner, item) { this.keys.delete(this.key(owner, item)); }
  clear() { this.keys.clear(); }
}
