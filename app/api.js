import { requireFeedback, setFeedbackAccount } from "./feedback-access.js";
import { uiLanguage } from "./i18n.js";
import { translateUI } from "./i18n.js";
export class RequestError extends Error {
  constructor(status, body) {
    super(
      body?.message
        ? translateUI(body.message)
        : translateUI("Požadavek selhal ({0}).", status),
    );
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}
let contextRevision = 0;
let contextOwner = null;
export function invalidateApiContext(owner = null) { contextRevision++; contextOwner = owner; }
export function apiContextKey() { return `${contextRevision}:${JSON.stringify(contextOwner)}:${uiLanguage()}`; }
export function apiContextOwner() {
  const accountId = contextOwner?.accountId,
    profileId = contextOwner?.profile?.id;
  return Number.isSafeInteger(accountId) && Number.isSafeInteger(profileId)
    ? { accountId, profileId }
    : null;
}
function assertCurrentContext(revision, signal) {
  if (revision !== contextRevision || signal?.aborted) throw new DOMException("Context changed", "AbortError");
}
export async function api(
  path,
  { method = "GET", body, signal, expectedOwner, playbackAttempt, optionalProbe = false } = {},
) {
  const isOptionalCapabilityProbe = optionalProbe === true && method === "POST" && path === "capabilities/negotiate";
  if (/^(?:admin\/)?feedback(?:\/|$)/.test(path)) requireFeedback();
  const revision = contextRevision;
  const owner = expectedOwner || (contextOwner?.accountId && contextOwner?.profile?.id
    ? {accountId: contextOwner.accountId, profileId: contextOwner.profile.id} : null);
  const correlatedPath = /^(?:streaming2?\/titles\/[^/]+\/streams(?:\?|$)|sources\/[^/]+\/(?:webshare|hellspy|native)(?:\?|$)|watch-history\/position\/|playback$)/.test(path);
  const correlation = correlatedPath && typeof playbackAttempt?.correlation === "function" ? playbackAttempt.correlation() : null;
  const attemptHeader = typeof correlation === "string" && /^[0-9a-f]{32}$/.test(correlation) ? correlation : null;
  const assertAttempt = () => {
    assertCurrentContext(revision, signal);
    if (attemptHeader && playbackAttempt.correlation() !== attemptHeader)
      throw new DOMException("Playback attempt changed", "AbortError");
  };
  assertAttempt();
  let response;
  try {
    response = await fetch(`/api/app/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        ...(attemptHeader ? {"X-Movly-Playback-Attempt": attemptHeader} : {}),
        "X-Movly-App": "1",
        "X-Movly-Language": uiLanguage(),
        ...(owner
          ? {
              "X-Movly-Expected-Account": String(owner.accountId),
              "X-Movly-Expected-Profile": String(owner.profileId),
            }
          : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    assertAttempt();
    // Síťová chyba: srozumitelná hláška, ale stále TypeError kvůli offline režimu.
    if (error?.name === "AbortError" || signal?.aborted) throw error;
    throw new TypeError(
      translateUI("Nepodařilo se spojit se serverem Movly. Zkontroluj připojení a zkus to znovu."),
    );
  }
  assertAttempt();
  let data;
  try {
    data = await response.json();
  } catch {
    assertAttempt();
    throw new RequestError(502, {
      message: translateUI("Server vrátil nečitelnou odpověď."),
    });
  }
  assertAttempt();
  if (!response.ok) {
    if (!isOptionalCapabilityProbe && (response.status === 401 || data?.code === "feedback_premium_required")) setFeedbackAccount(null);
    if (!isOptionalCapabilityProbe && (
      response.status === 401 ||
      [
        "profile_grant_required",
        "profile_access_denied",
        "profile_grant_expired",
        "invalid_profile_grant",
        "session_revoked",
        "account_inactive",
      ].includes(data?.code)
    ))
      window.dispatchEvent(new CustomEvent("movly-offline-revoked"));
    throw new RequestError(response.status, data);
  }
  return data;
}
export function array(value, label = "seznam") {
  if (!Array.isArray(value))
    throw new Error(translateUI("API nevrátilo platný {0}.", label));
  return value;
}
export function title(value) {
  const t =
    value?.title && typeof value.title === "object" ? value.title : value;
  if (
    !t ||
    !Number.isSafeInteger(t.id) ||
    t.id < 1 ||
    typeof t.title !== "string"
  )
    throw new Error(translateUI("API vrátilo neplatný titul."));
  return {
    ...t,
    progress: value?.watch_progress || t.watch_progress,
    streams: value?.streams || t.streams,
    ratings: value?.ratings || t.ratings,
    rating: value?.rating ?? t.rating,
    year: t.year || t.release_date?.slice(0, 4) || null,
  };
}
export function imageURL(value, size = "w500") {
  if (typeof value !== "string" || !value) return null;
  if (/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value))
    return `https://image.tmdb.org/t/p/${size}${value}`;
  try {
    const u = new URL(value);
    return u.origin === "https://image.tmdb.org" ||
      (u.origin === "https://res.cloudinary.com" &&
        u.pathname.startsWith("/dsnzqq6kh/"))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function listTitle(item) {
  if (!Number.isSafeInteger(item.title_id) || item.title_id < 1)
    throw new Error(translateUI("Položce seznamu chybí ID titulu."));
  return title({
    ...item,
    id: item.title_id,
    title: item.localized_name || item.original_title,
    type: item.content_type,
  });
}
