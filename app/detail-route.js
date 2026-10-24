// Detail titulu je modální vrstva nad stránkou. Adresa ji nese v parametru
// `title` hashe (#movies?genre=1&title=42): Zpět v prohlížeči detail zavře,
// odkaz jde sdílet a karta jde otevřít v nové kartě prohlížeče (audit
// web-native-2026-10-24, WEB-N01). Stránka pod detailem se kvůli tomu
// nepřekresluje — klíč stránky je hash bez parametru detailu.
export const DETAIL_PARAM = "title";

function split(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const index = raw.indexOf("?");
  const route = (index < 0 ? raw : raw.slice(0, index)) || "home";
  return [route, new URLSearchParams(index < 0 ? "" : raw.slice(index + 1))];
}

function join(route, params) {
  const query = params.toString();
  return `#${route}${query ? `?${query}` : ""}`;
}

// ID titulu z adresy, nebo null. Přijímá jen kladná celá čísla.
export function detailTitleId(hash) {
  const value = split(hash)[1].get(DETAIL_PARAM) || "";
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function withDetail(hash, id) {
  const [route, params] = split(hash);
  params.set(DETAIL_PARAM, String(id));
  return join(route, params);
}

export function withoutDetail(hash) {
  const [route, params] = split(hash);
  params.delete(DETAIL_PARAM);
  return join(route, params);
}

// Stránka pod detailem; změna jen parametru detailu stránku nepřekresluje.
export const pageKey = withoutDetail;

// Odkaz karty: aktuální stránka s otevřeným detailem daného titulu.
export function detailHref(id, hash = typeof location === "undefined" ? "" : location.hash) {
  return withDetail(hash, id);
}

// Hloubka detailů, které tato relace přidala do historie (Zavřít je vrátí najednou).
export function detailDepth(state) {
  const depth = Number(state?.movlyDetailDepth);
  return Number.isSafeInteger(depth) && depth > 0 ? depth : 0;
}

export function nextDetailState(state) {
  return { ...(state && typeof state === "object" ? state : {}), movlyDetailDepth: detailDepth(state) + 1 };
}
