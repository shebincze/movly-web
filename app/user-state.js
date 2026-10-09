import { translateUI } from "./i18n.js";
import { imageURL } from "./api.js";
// Lokální překryv osobního stavu (zhlédnuto / rozkoukáno) nad katalogem.
//
// Karty nesou stav zapečený z odpovědi API. Po vlastní akci (Zhlédnuto v dialogu,
// dokoukaný film v přehrávači) by se bez překryvu musela stránka znovu načíst.
// Store se plní hned při mutaci; `poster()` ho čte při vykreslení a už vykreslené
// karty se dopatchují přes `data-title-id`. Reload zůstává jen pro složení řad.
const entries = new Map();
const REMOTE_CHANGE_GRACE_MS = 60_000;
let lastLocalChangeAt = 0;
// Artwork, které detail zjistil později než seznam (karta bez plakátu).
const artwork = new Map();

export function noteArtwork(id, posterPath, backdropPath) {
  const key = Number(id);
  const current = artwork.get(key) || {};
  const next = {
    poster_path: posterPath || current.poster_path || null,
    backdrop_path: backdropPath || current.backdrop_path || null,
  };
  if (!next.poster_path && !next.backdrop_path) return;
  artwork.set(key, next);
  patchArtwork(key, next.poster_path);
}
function patchArtwork(id, posterPath) {
  const url = imageURL(posterPath);
  if (!url) return;
  for (const card of document.querySelectorAll(`[data-title-id="${id}"]`)) {
    const frame = card.querySelector(".poster-frame");
    const missing = frame?.querySelector(".missing-art");
    if (!frame || !missing) continue;
    missing.replaceWith(
      Object.assign(document.createElement("img"), {
        src: url,
        alt: "",
        loading: "lazy",
        decoding: "async",
      }),
    );
  }
}

// Řady, jejichž složení závisí na osobním stavu profilu (stejná množina jako server).
export function isPersonalSlug(slug) {
  const s = String(slug || "")
    .trim()
    .toLowerCase();
  return (
    s.startsWith("continue-watching") ||
    s.startsWith("watchlist") ||
    s === "default-watchlist" ||
    s.startsWith("recommendations-") ||
    s === "friends-activity"
  );
}
export function isContinueWatchingSlug(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .startsWith("continue-watching");
}
export function hasRecentLocalChange(now = Date.now()) {
  return now - lastLocalChangeAt < REMOTE_CHANGE_GRACE_MS;
}
// Změna zhlédnuto / pozice: složení osobních řad si obnoví catalog.js.
function announce() {
  document.dispatchEvent(new CustomEvent("movly:personal-changed"));
}

export function userState(id) {
  return entries.get(Number(id)) || null;
}
export function isWatched(t) {
  const p = t?.progress;
  return !!(p && (p.is_completed || p.watch_status === "completed"));
}
export function progressPercent(t) {
  const p = t?.progress;
  const raw = p?.progress_percentage ?? p?.progress_percent;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
// Označit / odznačit zhlédnuto. Odznačení maže i pozici (server maže historii).
export function setWatched(id, watched) {
  lastLocalChangeAt = Date.now();
  entries.set(Number(id), { watched, progress: null, at: lastLocalChangeAt });
  patchCards();
  announce();
}
// Pozice přehrávání filmu v procentech; `completed` = dokoukáno.
export function setProgress(id, percent, completed) {
  const clamped =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : null;
  lastLocalChangeAt = Date.now();
  entries.set(Number(id), {
    watched: !!completed,
    progress: !completed && clamped > 1 ? clamped : null,
    at: lastLocalChangeAt,
  });
  patchCards();
  announce();
}
// Jiný účet / profil — překryv patří někomu jinému.
export function resetUserState() {
  entries.clear();
  lastLocalChangeAt = 0;
}
// Změna z jiného zařízení: server je autorita, čerstvé vlastní akce zůstanou.
export function pruneForRemoteChange(now = Date.now()) {
  for (const [id, s] of entries)
    if (now - s.at >= REMOTE_CHANGE_GRACE_MS) entries.delete(id);
}
// Titul s aplikovaným překryvem — pro `poster()`.
export function applyUserState(t) {
  if (!t) return t;
  const s = entries.get(Number(t.id)),
    art = artwork.get(Number(t.id));
  if (!s && !art) return t;
  const out = { ...t };
  if (s)
    out.progress = s.watched
      ? { watch_status: "completed", is_completed: true }
      : s.progress != null
        ? { watch_status: "watching", progress_percentage: s.progress }
        : null;
  if (art) {
    if (!out.poster_path && art.poster_path) out.poster_path = art.poster_path;
    if (!out.backdrop_path && art.backdrop_path)
      out.backdrop_path = art.backdrop_path;
  }
  return out;
}
// Vykreslení stavu do rámečku karty; volá se při stavbě i při patchi.
export function renderCardState(frame, watched, percent) {
  frame.querySelector(".watched-badge")?.remove();
  frame.querySelector("progress")?.remove();
  if (watched) {
    const badge = document.createElement("span");
    badge.className = "watched-badge";
    badge.setAttribute("aria-label", translateUI("Zhlédnuto"));
    badge.textContent = "✓";
    frame.append(badge);
    return;
  }
  if (typeof percent === "number" && percent > 0) {
    const bar = document.createElement("progress");
    bar.max = 100;
    bar.value = Math.min(100, Math.max(0, percent));
    bar.setAttribute("aria-label", translateUI("Rozkoukáno"));
    frame.append(bar);
  }
}
function patchCards() {
  for (const card of document.querySelectorAll("[data-title-id]")) {
    const s = entries.get(Number(card.dataset.titleId));
    const frame = card.querySelector(".poster-frame");
    if (!s || !frame) continue;
    // Dokoukaný titul z „Pokračovat ve sledování" zmizí hned; server řadu
    // potvrdí při dalším načtení.
    const rail = card.closest("[data-rail-slug]");
    if (s.watched && rail && isContinueWatchingSlug(rail.dataset.railSlug)) {
      card.remove();
      if (!rail.querySelector(".poster-card")) rail.remove();
      continue;
    }
    renderCardState(frame, s.watched, s.progress);
  }
}
