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
export async function api(
  path,
  { method = "GET", body, signal, expectedOwner } = {},
) {
  const response = await fetch(`/api/app/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      "X-Movly-App": "1",
      "X-Movly-Language": uiLanguage(),
      ...(expectedOwner
        ? {
            "X-Movly-Expected-Account": String(expectedOwner.accountId),
            "X-Movly-Expected-Profile": String(expectedOwner.profileId),
          }
        : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(502, {
      message: translateUI("Server vrátil nečitelnou odpověď."),
    });
  }
  if (!response.ok) {
    if (
      response.status === 401 ||
      [
        "profile_grant_required",
        "profile_access_denied",
        "profile_grant_expired",
        "invalid_profile_grant",
        "session_revoked",
        "account_inactive",
      ].includes(data?.code)
    )
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
