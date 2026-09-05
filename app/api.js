export class RequestError extends Error {
  constructor(status, body) {
    super(body?.message || `Požadavek selhal (${status}).`);
    this.status = status;
    this.code = body?.code;
  }
}
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`/api/app/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      "X-Movly-App": "1",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(502, {
      message: "Server vrátil nečitelnou odpověď.",
    });
  }
  if (!response.ok) throw new RequestError(response.status, data);
  return data;
}
export function array(value, label = "seznam") {
  if (!Array.isArray(value)) throw new Error(`API nevrátilo platný ${label}.`);
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
    throw new Error("API vrátilo neplatný titul.");
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
    throw new Error("Položce seznamu chybí ID titulu.");
  return title({
    ...item,
    id: item.title_id,
    title: item.localized_name || item.original_title,
    type: item.content_type,
  });
}
