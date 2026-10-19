import { serverHome, homeItems, homeTracking, decorateHomeCards, resetHomeImpressions } from "./home.js";
import { homeQuery, homeSections } from "./home-state.js";
import { translateUI } from "./i18n.js";
import {
  searchHistory,
  rememberSearch,
  removeSearch,
  clearSearchHistory,
} from "./search-history.js";
import { api, apiContextKey, apiContextOwner, array, title, imageURL } from "./api.js";
import { effectiveContentPolicy, assertEffectivePolicyUnchanged } from "./effective-policy.js";
import {
  applyUserState,
  isWatched,
  isPersonalSlug,
  isContinueWatchingSlug,
} from "./user-state.js";
import {
  el,
  button,
  loading,
  empty,
  warning,
  rail,
  hero,
  poster,
  formField,
  countLabel,
  errorBox,
  toast,
  icon,
} from "./ui.js";
function carousel(items, actions) {
  let index = 0;
  const slide = el("div", {}),
    dots = el("div", {
      class: "hero-dots",
      "aria-label": translateUI("Výběr doporučeného titulu"),
    });
  const play = async (t) => {
    if (t.type === "tv") return actions.detail(t);
    try {
      await (await import("./player.js")).sources(t);
    } catch (error) {
      toast(error.message);
    }
  };
  function show(next) {
    index = (next + items.length) % items.length;
    slide.replaceChildren(hero(items[index], actions.detail, actions.save, play));
    const label = items[index].homeHighlight?.label || items[index].homeHeading;
    if (label) slide.querySelector(".hero-content").prepend(el("span", { class: "hero-label" }, label));
    actions.onHero?.(slide.firstElementChild, items[index]);
    dots
      .querySelectorAll("button")
      .forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  }
  items
    .slice(0, 10)
    .forEach((t, i) => dots.append(button(t.title, () => show(i), "hero-dot")));
  show(0);
  const step = (label, delta, glyph) => {
    const node = button("", () => show(index + delta), "small", glyph);
    node.setAttribute("aria-label", label);
    return node;
  };
  const back = step(translateUI("Předchozí"), -1, "chevron");
  back.classList.add("hero-prev");
  return el(
    "section",
    { class: "home-carousel" },
    slide,
    items.length > 1
      ? el(
          "div",
          { class: "hero-controls" },
          dots,
          back,
          step(translateUI("Další"), 1, "chevron"),
        )
      : null,
  );
}
function feedRail(group, actions, source = "main") {
  let items = array(group.items).map(title);
  // „Pokračovat ve sledování" bez titulů právě dokoukaných v tomto profilu.
  if (isContinueWatchingSlug(group.slug))
    items = items.filter((t) => !isWatched(applyUserState(t)));
  if (!items.length) return null;
  const node = rail(
    group.name,
    items,
    actions.detail,
    `#collection?source=${source}&slug=${encodeURIComponent(group.slug)}`,
  );
  node.dataset.railSlug = group.slug || "";
  if (group.slug === "top-watched") {
    node.classList.add("top-ten");
    [...node.querySelectorAll(".poster-card")].forEach((card, i) =>
      card.prepend(
        el(
          "span",
          { class: "rank-number", "aria-hidden": "true" },
          String(i + 1),
        ),
      ),
    );
  }
  return node;
}
export async function home(signal, actions) {
  const policy = await effectiveContentPolicy({ signal, refresh: true });
  return serverHome(signal, actions, carousel, policy);
}
// Stale-while-revalidate pro Filmy/Seriály: návrat na stránku vykreslí hned
// poslední odpověď /main (do 5 min) a na pozadí ji tiše ověří. Osobní řady se
// po vlastní změně vymění přes /main/personal (viz refreshPersonalRails).
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map();
let catalogEpoch = 0, personalRefreshTimer = 0;
export function resetCatalogCache() {
  catalogEpoch++;
  clearTimeout(personalRefreshTimer);
  catalogCache.clear();
  resetHomeImpressions();
}
function refreshCatalogContext() {
  resetCatalogCache();
  const context = apiContextKey(), epoch = catalogEpoch;
  // Policy publication completes after dispatch; refresh only the still-visible
  // page belonging to this exact API generation, never a previous owner's DOM.
  queueMicrotask(() => {
    const page = document.querySelector(".catalog-page[data-catalog-type]");
    if (context !== apiContextKey() || epoch !== catalogEpoch || page?.movlyCatalogContext !== context) return;
    void revalidateCatalog(page.dataset.catalogType, page, page.movlyActions, undefined, true);
  });
}
document.addEventListener("movly:effective-policy-changed", refreshCatalogContext);
document.addEventListener("movly:personal-data-mirror-changed", (event) => {
  const detail = event.detail, owner = apiContextOwner();
  if (detail?.catalogContextChanged !== true || detail.apiContext !== apiContextKey() ||
      detail.accountId !== owner?.accountId || detail.profileId !== owner?.profileId) return;
  refreshCatalogContext();
});
function catalogKey(type) {
  return `${apiContextKey()}:main?type=${type}&limit=30`;
}
function orderedGroups(data) {
  const seen = new Set();
  return array(data.lists)
    .map((g, index) => ({ ...g, index }))
    .sort((a, b) => (a.display_order ?? a.index) - (b.display_order ?? b.index))
    .filter((g) => {
      if (seen.has(g.slug)) return false;
      seen.add(g.slug);
      return true;
    });
}
function railsFor(data, actions) {
  return orderedGroups(data)
    .filter((g) => array(g.items).length)
    .map((g) => feedRail(g, actions))
    .filter(Boolean);
}
function renderRails(page, data, actions) {
  const rails = page.querySelector(".catalog-rails");
  rails.replaceChildren(
    ...[warning(data), ...railsFor(data, actions)].filter(Boolean),
  );
}
async function revalidateCatalog(type, page, actions, signal, required = false) {
  const key = catalogKey(type), epoch = catalogEpoch;
  if (required) page.querySelector(".catalog-rails").replaceChildren(loading());
  try {
    const policy = await effectiveContentPolicy({ signal, refresh: true });
    const fresh = await api(`main?type=${type}&limit=30`, { signal });
    await assertEffectivePolicyUnchanged(policy, { signal });
    if (epoch !== catalogEpoch || key !== catalogKey(type) || signal?.aborted) return;
    const cached = catalogCache.get(key);
    catalogCache.set(key, { data: fresh, at: Date.now() });
    if (
      page.isConnected &&
      JSON.stringify(cached?.data?.lists) !== JSON.stringify(fresh.lists)
    )
      renderRails(page, fresh, actions);
  } catch (error) {
    if (required && page.isConnected && epoch === catalogEpoch && key === catalogKey(type) && !signal?.aborted)
      page.querySelector(".catalog-rails").replaceChildren(errorBox(error,
        () => revalidateCatalog(type, page, actions, signal, true)));
    // Běžná SWR ponechá stará data; povinná obnova nabízí chybu a retry.
  }
}
// Po vlastní změně zhlédnuto / pozice vymění jen osobní řady právě zobrazené
// stránky Filmů/Seriálů; kurátorované řady zůstávají, bez spinneru.
export async function refreshPersonalRails() {
  const page = document.querySelector(".catalog-page[data-catalog-type]");
  if (!page) return;
  const type = page.dataset.catalogType,
    key = catalogKey(type),
    cached = catalogCache.get(key);
  if (!cached) return;
  const epoch = catalogEpoch;
  const policy = await effectiveContentPolicy({ refresh: true });
  const personal = await api(`main/personal?type=${type}&limit=30`);
  await assertEffectivePolicyUnchanged(policy);
  if (epoch !== catalogEpoch || key !== catalogKey(type)) return;
  const current = catalogCache.get(key);
  if (!current) return;
  const curated = array(current.data.lists).filter(
    (g) => !isPersonalSlug(g.slug),
  );
  const lists = orderedGroups(personal);
  const merged = {
    ...current.data,
    lists: [
      ...lists.filter((g) => g.slug !== "friends-activity"),
      ...curated,
      ...lists.filter((g) => g.slug === "friends-activity"),
    ],
  };
  catalogCache.set(key, { data: merged, at: current.at });
  if (page.isConnected) renderRails(page, merged, page.movlyActions);
}
document.addEventListener("movly:personal-changed", () => {
  clearTimeout(personalRefreshTimer);
  personalRefreshTimer = setTimeout(() => {
    refreshPersonalRails().catch(() => {});
  }, 250);
});
export async function catalog(route, params, signal, actions) {
  if (params.get("view") === "grid")
    return catalogGrid(route, params, signal, actions);
  const policy = await effectiveContentPolicy({ signal, refresh: true });
  const type = route === "series" ? "tv" : "movie",
    key = catalogKey(type),
    cached = catalogCache.get(key),
    fresh = cached && Date.now() - cached.at < CATALOG_TTL_MS;
  let data;
  if (cached) data = cached.data;
  else {
    const epoch = catalogEpoch;
    data = await api(`main?type=${type}&limit=30`, { signal });
    await assertEffectivePolicyUnchanged(policy, { signal });
    if (epoch !== catalogEpoch || key !== catalogKey(type) || signal?.aborted) throw new DOMException("Context changed", "AbortError");
    catalogCache.set(key, { data, at: Date.now() });
  }
  const page = el(
    "div",
    { class: "catalog-page", "data-catalog-type": type },
    el(
      "div",
      { class: "page-heading catalog-heading" },
      el(
        "h1",
        {},
        route === "series" ? translateUI("Seriály") : translateUI("Filmy"),
      ),
      el(
        "a",
        { class: "button secondary", href: `#${route}?view=grid` },
        translateUI("Procházet podle filtrů"),
      ),
    ),
    el("div", { class: "catalog-rails" }),
  );
  page.movlyActions = actions;
  page.movlyCatalogContext = apiContextKey();
  renderRails(page, data, actions);
  if (cached && !fresh) revalidateCatalog(type, page, actions, signal);
  return page;
}
// Skládač filtrů — stejná sada kritérií jako Apple, Android a Windows:
// další žánry (kterýkoli / všechny), roky, hodnocení v %, délka, kvalita,
// jazyk zvuku, původní jazyk, řazení. Pojmenované sady jdou na server
// (/saved-filters) a sledují profil na všech zařízeních.
const QUALITY_OPTIONS = [
  ["", translateUI("Jakákoli kvalita")],
  ["720", translateUI("HD a lepší")],
  ["1080", translateUI("Full HD a lepší")],
  ["2160", translateUI("4K")],
];
const AUDIO_LANGUAGES = [
  ["cs", translateUI("Čeština")],
  ["sk", translateUI("Slovenština")],
  ["en", translateUI("Angličtina")],
  ["de", translateUI("Němčina")],
  ["pl", translateUI("Polština")],
  ["fr", translateUI("Francouzština")],
  ["es", translateUI("Španělština")],
  ["it", translateUI("Italština")],
  ["ja", translateUI("Japonština")],
  ["ko", translateUI("Korejština")],
];
const ORIGINAL_LANGUAGES = [
  ...AUDIO_LANGUAGES,
  ["hi", translateUI("Hindština")],
  ["zh", translateUI("Čínština")],
  ["ru", translateUI("Ruština")],
  ["sv", translateUI("Švédština")],
  ["da", translateUI("Dánština")],
];
const SORT_OPTIONS = [
  ["popularity", translateUI("Nejpopulárnější")],
  ["rating", translateUI("Nejlépe hodnocené")],
  ["year", translateUI("Nejnovější")],
  ["title", translateUI("Podle názvu")],
  ["runtime", translateUI("Nejdelší")],
];
// URL parametry mřížky (#movies?view=grid&…) ↔ dokument uloženého filtru.
const FILTER_PARAM_KEYS = [
  "genre",
  "gm",
  "yf",
  "yt",
  "rf",
  "rt",
  "df",
  "dt",
  "q",
  "hdr",
  "audio",
  "sub",
  "orig",
  "co",
  "streams",
  "sort",
];
function intParam(params, key, max) {
  const value = Number.parseInt(params.get(key) || "", 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : null;
}
// Jazyky titulků jsou v uloženém filtru seznam (nativní aplikace mohou uložit
// více jazyků); v URL mřížky je to "sub=cs,en".
function subtitleCodes(raw) {
  return [...new Set(String(raw || "").split(",").map((code) => code.trim().toLowerCase()).filter((code) => /^[a-z]{2,3}$/.test(code)))].sort();
}
function paramsToDefinition(params, type, { grid = true } = {}) {
  const genreIds = (params.get("genre") || "")
    .split(",")
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v) && v > 0);
  const sort = SORT_OPTIONS.some(([v]) => v === params.get("sort"))
    ? params.get("sort")
    : "popularity";
  const pct = (v) => (v == null ? null : v / 10);
  return {
    type,
    genre_ids: genreIds.length
      ? [...new Set(genreIds)].sort((a, b) => a - b)
      : null,
    genre_match: params.get("gm") ? "all" : "any",
    year_from: intParam(params, "yf", 2100),
    year_to: intParam(params, "yt", 2100),
    rating_from: pct(intParam(params, "rf", 100)),
    rating_to: pct(intParam(params, "rt", 100)),
    runtime_from: intParam(params, "df", 1440),
    runtime_to: intParam(params, "dt", 1440),
    video_height_min: intParam(params, grid ? "q" : "quality", 4320),
    hdr: !!params.get("hdr") || null,
    audio_language: params.get("audio") || null,
    subtitle_languages: subtitleCodes(params.get("sub")),
    original_language: params.get("orig") || null,
    countries: (params.get("co") || "").split(",").map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)),
    has_streams: params.get("streams") === "1",
    sort_by: sort,
    sort_order: sort === "title" ? "asc" : "desc",
  };
}
function definitionToParams(d, { grid = true } = {}) {
  const q = new URLSearchParams(grid ? { view: "grid" } : {});
  if (!grid && (d.type === "movie" || d.type === "tv")) q.set("t", d.type);
  if (d.genre_ids?.length) q.set("genre", d.genre_ids.join(","));
  if (d.genre_match === "all") q.set("gm", "1");
  if (d.year_from) q.set("yf", String(d.year_from));
  if (d.year_to) q.set("yt", String(d.year_to));
  if (d.rating_from != null)
    q.set("rf", String(Math.round(d.rating_from * 10)));
  if (d.rating_to != null) q.set("rt", String(Math.round(d.rating_to * 10)));
  if (d.runtime_from) q.set("df", String(d.runtime_from));
  if (d.runtime_to) q.set("dt", String(d.runtime_to));
  if (d.video_height_min) q.set(grid ? "q" : "quality", String(d.video_height_min));
  if (d.hdr) q.set("hdr", "1");
  if (d.audio_language) q.set("audio", d.audio_language);
  if (d.subtitle_languages?.length) q.set("sub", subtitleCodes(d.subtitle_languages.join(",")).join(","));
  if (d.original_language) q.set("orig", d.original_language);
  if (d.countries?.length) q.set("co", d.countries.join(","));
  if (d.has_streams) q.set("streams", "1");
  if (d.sort_by && d.sort_by !== "popularity") q.set("sort", d.sort_by);
  return q;
}
// Search q always means a title. Grid q remains the legacy quality parameter.
function searchParams(params, text) {
  const next = new URLSearchParams();
  if (text.trim()) next.set("q", text.trim());
  for (const key of [...FILTER_PARAM_KEYS.filter((key) => key !== "q"), "quality", "t"])
    if (params.get(key)) next.set(key, params.get(key));
  return next;
}
function definitionQuery(d) {
  const query = new URLSearchParams();
  if (d.genre_ids?.length) query.set("genre_ids", d.genre_ids.join(","));
  if (d.genre_match === "all" && (d.genre_ids?.length || 0) > 1)
    query.set("genre_match", "all");
  for (const key of [
    "year_from",
    "year_to",
    "rating_from",
    "rating_to",
    "runtime_from",
    "runtime_to",
    "video_height_min",
    "audio_language",
    "original_language",
  ])
    if (d[key] != null && d[key] !== "") query.set(key, String(d[key]));
  if (d.countries?.length) query.set("countries", d.countries.join(","));
  if (d.subtitle_languages?.length) query.set("subtitle_language", d.subtitle_languages.join(","));
  if (d.has_streams) query.set("has_streams", "true");
  if (d.hdr) query.set("hdr", "true");
  query.set("sort_by", d.sort_by || "popularity");
  query.set("sort_order", d.sort_order || "desc");
  return query;
}
function hasCriteria(d) {
  return Boolean(
    d.genre_ids?.length ||
      d.year_from ||
      d.year_to ||
      d.rating_from != null ||
      d.rating_to != null ||
      d.runtime_from ||
      d.runtime_to ||
      d.video_height_min ||
      d.hdr ||
      d.audio_language ||
      d.subtitle_languages?.length ||
      d.original_language ||
      d.countries?.length ||
      d.has_streams ||
      (d.sort_by && d.sort_by !== "popularity"),
  );
}
function definitionChips(d, genreNames) {
  const chips = [];
  if (d.genre_ids?.length)
    chips.push(
      d.genre_ids
        .map((id) => genreNames.get(id) || `#${id}`)
        .join(d.genre_match === "all" ? " + " : " / "),
    );
  const range = (from, to, unit) => {
    if (from != null && to != null)
      return from === to ? `${from}${unit}` : `${from}–${to}${unit}`;
    if (from != null) return `${from}${unit}+`;
    if (to != null) return translateUI("do {0}{1}", to, unit);
    return null;
  };
  const pct = (v) => (v == null ? null : Math.round(v * 10));
  for (const chip of [
    range(d.year_from, d.year_to, ""),
    range(pct(d.rating_from), pct(d.rating_to), " %"),
    range(d.runtime_from, d.runtime_to, " min"),
  ])
    if (chip) chips.push(chip);
  if (d.video_height_min)
    chips.push(
      d.video_height_min >= 2160
        ? translateUI("4K")
        : d.video_height_min >= 1080
          ? "Full HD+"
          : "HD+",
    );
  if (d.hdr) chips.push("HDR");
  if (d.audio_language)
    chips.push(translateUI("zvuk {0}", d.audio_language.toUpperCase()));
  if (d.subtitle_languages?.length)
    chips.push(translateUI("titulky {0}", d.subtitle_languages.map((code) => code.toUpperCase()).join(", ")));
  if (d.original_language)
    chips.push(`orig. ${d.original_language.toUpperCase()}`);
  if (d.countries?.length) chips.push(translateUI("Země: {0}", d.countries.join(", ")));
  if (d.has_streams) chips.push(translateUI("Jen s dostupným zdrojem"));
  const sortLabel = SORT_OPTIONS.find(([v]) => v === d.sort_by)?.[1];
  if (d.sort_by && d.sort_by !== "popularity" && sortLabel)
    chips.push(sortLabel.toLowerCase());
  return chips;
}
// Štítky toho, co server pochopil z textového hledání (/search/filters).
export function interpretationChips(p) {
  const chips = [];
  if (p.type)
    chips.push(p.type === "tv" ? translateUI("Seriály") : translateUI("Filmy"));
  chips.push(...(p.genre_names || []));
  if (p.year_from != null && p.year_to != null)
    chips.push(
      p.year_from === p.year_to
        ? String(p.year_from)
        : `${p.year_from}–${p.year_to}`,
    );
  else if (p.year_from != null) chips.push(`${p.year_from}+`);
  else if (p.year_to != null) chips.push(translateUI("do {0}", p.year_to));
  const pct = (v) => Math.round(v * 10);
  if (p.rating_from != null && p.rating_to != null)
    chips.push(`${pct(p.rating_from)}–${pct(p.rating_to)} %`);
  else if (p.rating_from != null) chips.push(`${pct(p.rating_from)} %+`);
  else if (p.rating_to != null)
    chips.push(translateUI("do {0} %", pct(p.rating_to)));
  if (p.video_height_min != null)
    chips.push(
      p.video_height_min >= 2160
        ? translateUI("4K")
        : p.video_height_min >= 1080
          ? translateUI("Full HD")
          : translateUI("HD"),
    );
  if (p.hdr) chips.push("HDR");
  if (p.audio_language) chips.push(p.audio_language.toUpperCase());
  if (p.subtitle_language)
    chips.push(translateUI("titulky {0}", p.subtitle_language.toUpperCase()));
  if (p.sort_by === "rating") chips.push(translateUI("nejlépe hodnocené"));
  else if (p.sort_by === "year") chips.push(translateUI("nejnovější"));
  return chips;
}
// Skládač filtrů (formulář + štítky + Moje filtry). Stejný pro mřížku
// Filmy/Seriály (typ daný stránkou) i pro Hledání (typ volitelný).
function filterBuilder({
  route,
  params,
  definition,
  genres,
  savedFilters,
  actions,
  allowType = false,
  queryText = () => params.get("q")?.trim() || "",
}) {
  const grid = !allowType;
  const genreNames = new Map(genres.map((g) => [g.id, g.name_cs || g.name]));
  const selectedGenres = new Set(definition.genre_ids || []);
  // Typ jako přepínač a žánry jako štítky; FormData je čte stejně jako dřív select.
  const typeSelect = allowType
    ? el(
        "fieldset",
        { class: "filter-group" },
        el("legend", {}, translateUI("Typ")),
        el(
          "div",
          { class: "segmented" },
          [
            ["", translateUI("Vše")],
            ["movie", translateUI("Filmy")],
            ["tv", translateUI("Seriály")],
          ].map(([v, label]) => {
            const input = el("input", { type: "radio", name: "t", value: v });
            input.checked = (definition.type || "") === v;
            return el("label", {}, input, el("span", {}, label));
          }),
        ),
      )
    : null;
  const genre = el(
    "div",
    { class: "genre-chips" },
    genres.map((g) => {
      const input = el("input", { type: "checkbox", name: "genre", value: g.id });
      input.checked = selectedGenres.has(g.id);
      return el("label", { class: "choice-chip" }, input, el("span", {}, g.name_cs || g.name));
    }),
  );
  const genreMatch = el("input", { type: "checkbox", name: "gm", value: "1" });
  genreMatch.checked = definition.genre_match === "all";
  const number = (name, value, placeholder, max) =>
    el("input", {
      type: "number",
      name,
      min: 1,
      max,
      placeholder,
      value: value == null ? "" : String(value),
    });
  const pct = (v) => (v == null ? null : Math.round(v * 10));
  const yearFrom = number("yf", definition.year_from, "od", 2100),
    yearTo = number("yt", definition.year_to, "do", 2100),
    ratingFrom = number("rf", pct(definition.rating_from), "od %", 100),
    ratingTo = number("rt", pct(definition.rating_to), "do %", 100),
    runtimeFrom = number("df", definition.runtime_from, "od min", 1440),
    runtimeTo = number("dt", definition.runtime_to, "do min", 1440);
  const select = (name, options, value) => {
    const node = el(
      "select",
      { name },
      options.map(([v, label]) => el("option", { value: v }, label)),
    );
    node.value = value ?? "";
    return node;
  };
  const quality = select(
    grid ? "q" : "quality",
    QUALITY_OPTIONS,
    definition.video_height_min
      ? definition.video_height_min >= 2160
        ? "2160"
        : definition.video_height_min >= 1080
          ? "1080"
          : "720"
      : "",
  );
  const hdr = el("input", { type: "checkbox", name: "hdr", value: "1" });
  hdr.checked = !!definition.hdr;
  const audio = select(
    "audio",
    [["", translateUI("Jakýkoli")], ...AUDIO_LANGUAGES],
    definition.audio_language,
  );
  // Uložený filtr z jiné aplikace může mít kombinaci jazyků, kterou seznam
  // nenabízí; zůstane jako vlastní volba, aby ji uložení neztratilo.
  const subtitleValue = (definition.subtitle_languages || []).join(",");
  const subtitles = select(
    "sub",
    [
      ["", translateUI("Jakékoli")],
      ...AUDIO_LANGUAGES,
      ...(subtitleValue && !AUDIO_LANGUAGES.some(([code]) => code === subtitleValue)
        ? [[subtitleValue, subtitleValue.toUpperCase()]]
        : []),
    ],
    subtitleValue,
  );
  const original = select(
    "orig",
    [["", translateUI("Jakýkoli")], ...ORIGINAL_LANGUAGES],
    definition.original_language,
  );
  const countries = el("input", {
    type: "text",
    name: "co",
    maxlength: 100,
    pattern: "[A-Za-z]{2}(,[A-Za-z]{2})*",
    placeholder: "CZ,US",
    value: (definition.countries || []).join(","),
    "aria-label": translateUI("Kódy zemí původu oddělené čárkou"),
  });
  const hasStreams = el("input", { type: "checkbox", name: "streams", value: "1" });
  hasStreams.checked = !!definition.has_streams;
  const sort = select("sort", SORT_OPTIONS, definition.sort_by);
  const range = (label, from, to) =>
    el(
      "label",
      { class: "field range" },
      el("span", {}, label),
      el("div", { class: "range-inputs" }, from, "–", to),
    );
  const filters = el(
    "form",
    {
      class: "filters filters-builder",
      onSubmit: (e) => {
        e.preventDefault();
        const q = new URLSearchParams(grid ? { view: "grid" } : {});
        if (!grid && queryText()) q.set("q", queryText());
        const genreIds = [...genre.querySelectorAll("input:checked")].map((o) => o.value);
        if (genreIds.length) q.set("genre", genreIds.join(","));
        for (const [k, v] of new FormData(filters))
          if (v && k !== "genre") q.set(k, v);
        location.hash = `${route}?${q}`;
      },
    },
    typeSelect,
    genres.length
      ? el("fieldset", { class: "filter-group" }, el("legend", {}, translateUI("Žánry (více najednou)")), genre)
      : null,
    el(
      "label",
      { class: "field checkbox" },
      genreMatch,
      translateUI(" Titul musí mít všechny vybrané žánry"),
    ),
    range(translateUI("Rok vydání"), yearFrom, yearTo),
    range(translateUI("Hodnocení (%)"), ratingFrom, ratingTo),
    range(translateUI("Délka (min)"), runtimeFrom, runtimeTo),
    formField(translateUI("Kvalita"), quality),
    el("label", { class: "field checkbox" }, hdr, translateUI(" Jen HDR")),
    formField(translateUI("Zvuk"), audio),
    formField(translateUI("Titulky"), subtitles),
    formField(translateUI("Původní jazyk"), original),
    formField(translateUI("Země původu (ISO kódy)"), countries),
    el("label", { class: "field checkbox" }, hasStreams, translateUI(" Jen s dostupným zdrojem")),
    formField(translateUI("Řazení"), sort),
    el(
      "button",
      { class: "button primary", type: "submit" },
      translateUI("Použít filtry"),
    ),
    hasCriteria(definition) || (allowType && definition.type)
      ? el(
          "a",
          {
            class: "button secondary",
            href: `#${route}${grid ? "?view=grid" : params.get("q")?.trim() ? `?${new URLSearchParams({q: params.get("q").trim()})}` : ""}`,
            onClick: grid ? undefined : (event) => {
              event.preventDefault();
              location.hash = `${route}?${new URLSearchParams(queryText() ? {q: queryText()} : {})}`;
            },
          },
          translateUI("Zrušit filtry"),
        )
      : null,
  );
  const activeChips = [
    ...(allowType && definition.type
      ? [
          definition.type === "tv"
            ? translateUI("Seriály")
            : translateUI("Filmy"),
        ]
      : []),
    ...definitionChips(definition, genreNames),
  ];
  const chipsRow = activeChips.length
    ? el(
        "div",
        { class: "filter-chips" },
        activeChips.map((chip) => el("span", { class: "chip active" }, chip)),
      )
    : null;
  // Moje filtry: uložené na serveru, sledují profil na všech zařízeních.
  let savedRow = null;
  if (savedFilters) {
    const applied = savedFilters.find(
      (saved) =>
        JSON.stringify(
          paramsToDefinition(
            definitionToParams(saved.filter, { grid }),
            definition.type,
            { grid },
          ),
        ) === JSON.stringify(definition),
    );
    const chips = savedFilters.map((saved) => {
      const apply = button(saved.name, () => {
        const type = saved.filter?.type;
        const target = grid
          ? type === "tv"
            ? "series"
            : type === "movie"
              ? "movies"
              : route
          : route;
        const next = definitionToParams(saved.filter || {}, { grid });
        if (!grid && queryText()) next.set("q", queryText());
        location.hash = `${target}?${next}`;
      });
      apply.className = "chip" + (applied?.id === saved.id ? " active" : "");
      apply.type = "button";
      const remove = button("×", async () => {
        if (!confirm(translateUI("Smazat filtr „{0}“?", saved.name))) return;
        try {
          await api(`saved-filters/${saved.id}`, { method: "DELETE" });
          toast(translateUI("Filtr smazán."));
          actions.refresh();
        } catch (e) {
          toast(e.message);
        }
      });
      remove.className = "chip-remove";
      remove.type = "button";
      remove.title = translateUI("Smazat filtr {0}", saved.name);
      remove.setAttribute(
        "aria-label",
        translateUI("Smazat filtr {0}", saved.name),
      );
      return el("span", { class: "saved-chip" }, apply, remove);
    });
    const save = button(translateUI("Uložit filtr"), async () => {
      const name = prompt(
        translateUI("Název filtru (např. Akční komedie 2020+):"),
        "",
      );
      if (!name || !name.trim()) return;
      try {
        await api("saved-filters", {
          method: "POST",
          body: { name: name.trim(), filter: definition },
        });
        toast(translateUI("Filtr uložen."));
        actions.refresh();
      } catch (e) {
        toast(e.message);
      }
    });
    save.className = "button secondary small";
    save.type = "button";
    save.disabled = !(
      hasCriteria(definition) ||
      (allowType && definition.type)
    );
    savedRow = el(
      "div",
      { class: "filter-chips saved-filters" },
      el("span", { class: "muted" }, translateUI("Moje filtry:")),
      chips.length
        ? chips
        : el("span", { class: "muted" }, translateUI("zatím žádné")),
      save,
    );
  }
  return { filters, chipsRow, savedRow };
}
async function catalogGrid(route, params, signal, actions) {
  const policy = await effectiveContentPolicy({ signal, refresh: true });
  const isSeries = route === "series",
    type = isSeries ? "tv" : "movie";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const definition = paramsToDefinition(params, type);
  const query = definitionQuery(definition);
  query.set("type", type);
  query.set("page", String(page));
  query.set("limit", "24");
  const [data, genresResult, savedResult] = await Promise.all([
    api(`titles/filter?${query}`, { signal }),
    api("titles/genres", { signal }),
    // Uložené filtry jen pro přihlášený profil; bez session prázdné.
    api("saved-filters", { signal }).catch(() => null),
  ]);
  await assertEffectivePolicyUnchanged(policy, { signal });
  const items = array(data.results, translateUI("výsledky")).map(title),
    genres = array(genresResult.genres, translateUI("žánry")),
    savedFilters = savedResult
      ? array(savedResult.items, translateUI("uložené filtry"))
      : null;
  const { filters, chipsRow, savedRow } = filterBuilder({
    route,
    params,
    definition,
    genres,
    savedFilters,
    actions,
  });
  const results = el(
    "section",
    { class: "search-results", "aria-label": translateUI("Výsledky") },
    savedRow,
    chipsRow,
    warning(data),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty(translateUI("Žádné tituly"), translateUI("Zkus změnit filtry.")),
  );
  const node = el(
    "div",
    { class: "page catalog-grid-page" },
    el(
      "a",
      { class: "text-link catalog-back", href: `#${route}` },
      translateUI("Zpět na řady katalogu"),
    ),
    el(
      "div",
      { class: "page-heading catalog-heading" },
      el("h1", {}, isSeries ? translateUI("Seriály") : translateUI("Filmy")),
      el("p", {}, translateUI("Vyber si příběh podle své nálady.")),
    ),
    el(
      "div",
      { class: "search-layout" },
      filterPanel(filters, hasCriteria(definition), hasCriteria(definition)),
      results,
    ),
  );
  if (!Number.isInteger(data.total_pages) || !Number.isInteger(data.total))
    throw new Error(translateUI("API nevrátilo stránkování katalogu."));
  const pager = pagination(route, params, page, data.total_pages);
  if (pager) results.append(pager);
  return node;
}
export function pagination(route, params, page, total) {
  if (total <= 1) return null;
  function go(next) {
    const q = new URLSearchParams(params);
    q.set("page", next);
    location.hash = `${route}?${q}`;
  }
  const prev = button(translateUI("Předchozí"), () => go(page - 1)),
    next = button(translateUI("Další"), () => go(page + 1));
  prev.disabled = page <= 1;
  next.disabled = page >= total;
  return el(
    "div",
    { class: "pagination" },
    prev,
    el("span", {}, `${page} / ${total}`),
    next,
  );
}
// Panel filtrů: na širokém displeji otevřený vedle výsledků, na mobilu sbalený.
function filterPanel(form, active, open) {
  const details = el(
    "details",
    { class: "filters-details filter-panel" },
    el("summary", {}, active ? translateUI("Filtry (aktivní)") : translateUI("Filtry")),
    form,
  );
  details.open = open || matchMedia("(min-width: 900px)").matches;
  return el("aside", { class: "filter-aside" }, details);
}
function searchTitleKey(value) {
  return typeof value === "string" ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";
}
function splitExactSearch(items, query) {
  const key = searchTitleKey(query), seen = new Set(), exact = [], related = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const target = key && [item.title, item.original_title].some((name) => searchTitleKey(name) === key) ? exact : related;
    target.push(item);
  }
  return { exact, related };
}
export async function search(params, signal, actions) {
  const q = params.get("q") || "",
    page = Math.max(1, Number(params.get("page")) || 1),
    searchContext = apiContextKey();
  const policy = await effectiveContentPolicy({ signal, refresh: true });
  const discoveryAllowed = !policy.is_kids && !policy.age_controls_active && !policy.exclude_adult;
  const input = el("input", {
    id: "search-q",
    type: "search",
    name: "q",
    placeholder: translateUI("Filmy, seriály…"),
    value: q,
    maxlength: 200,
    autocomplete: "off",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": "search-suggestions",
  });
  const suggestionList = el("div", {
    id: "search-suggestions",
    class: "search-suggestions",
    role: "listbox",
    "aria-label": translateUI("Návrhy hledání"),
    hidden: true,
  });
  let suggestionTimer = null,
    suggestionController = null,
    suggestionGeneration = 0,
    activeSuggestion = -1,
    detachSuggestionAbort = null;
  const closeSuggestions = () => {
    suggestionList.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
  };
  const cancelPendingSuggestions = () => {
    clearTimeout(suggestionTimer);
    suggestionTimer = null;
    suggestionController?.abort();
    suggestionController = null;
    detachSuggestionAbort?.();
    detachSuggestionAbort = null;
    suggestionGeneration++;
  };
  const cancelSuggestions = () => {
    cancelPendingSuggestions();
    closeSuggestions();
  };
  const chooseSuggestion = (value) => {
    input.value = value;
    clear.hidden = false;
    closeSuggestions();
    location.hash = `search?${searchParams(params, value)}`;
  };
  const clear = el(
    "button",
    {
      type: "button",
      class: "search-clear",
      "aria-label": translateUI("Vymazat"),
      onClick: () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        location.hash = `search?${searchParams(params, "")}`;
        input.focus();
      },
    },
    icon("close"),
  );
  clear.hidden = !q;
  input.addEventListener("input", () => {
    clear.hidden = !input.value;
    cancelPendingSuggestions();
    closeSuggestions();
    const value = input.value.trim();
    if (value.length < 2 || !discoveryAllowed) return;
    const generation = ++suggestionGeneration,
      context = apiContextKey(),
      controller = new AbortController();
    suggestionController = controller;
    const detachAbort = () => {
      signal?.removeEventListener("abort", cancel);
      if (detachSuggestionAbort === detachAbort) detachSuggestionAbort = null;
    };
    const cancel = () => {
      if (generation !== suggestionGeneration) return;
      cancelPendingSuggestions();
    };
    detachSuggestionAbort = detachAbort;
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    suggestionTimer = setTimeout(async () => {
      suggestionTimer = null;
      try {
        const data = await api(`autocomplete?${new URLSearchParams({ q: value, limit: "8" })}`, { signal: controller.signal });
        if (signal?.aborted || generation !== suggestionGeneration || context !== apiContextKey() || input.value.trim() !== value) return;
        const terms = Array.isArray(data.suggestions) ? [...new Set(data.suggestions.filter((term) => typeof term === "string" && term.trim()).map((term) => term.trim()))].slice(0, 8) : [];
        suggestionList.replaceChildren(...terms.map((term, index) => el("button", {
          type: "button",
          id: `search-suggestion-${index}`,
          class: "search-suggestion",
          role: "option",
          "aria-selected": "false",
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => chooseSuggestion(term),
        }, term)));
        suggestionList.hidden = !terms.length;
        input.setAttribute("aria-expanded", String(terms.length > 0));
      } catch (error) {
        if (error?.name !== "AbortError") closeSuggestions();
      } finally {
        detachAbort();
        if (suggestionController === controller) suggestionController = null;
      }
    }, 180);
  });
  input.addEventListener("keydown", (event) => {
    const options = [...suggestionList.querySelectorAll('[role="option"]')];
    if (event.key === "Escape") {
      if (!suggestionList.hidden || suggestionTimer || suggestionController) {
        event.preventDefault();
        cancelSuggestions();
      }
      return;
    }
    if (suggestionList.hidden || !options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activeSuggestion = event.key === "ArrowDown"
        ? (activeSuggestion + 1) % options.length
        : activeSuggestion < 0 ? options.length - 1 : (activeSuggestion - 1 + options.length) % options.length;
      options.forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === activeSuggestion));
        option.classList.toggle("active", index === activeSuggestion);
      });
      input.setAttribute("aria-activedescendant", options[activeSuggestion].id);
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      chooseSuggestion(options[activeSuggestion].textContent);
    }
  });
  const form = el(
    "form",
    {
      class: "search-form search-hero",
      role: "search",
      onSubmit: (e) => {
        e.preventDefault();
        location.hash = `search?${searchParams(params, input.value)}`;
      },
    },
    el("label", { class: "catalog-sr-only", for: "search-q" }, translateUI("Co chceš objevit?")),
    el(
      "div",
      { class: "search-box" },
      icon("search"),
      input,
      clear,
      el("button", { type: "submit", class: "button primary" }, translateUI("Hledat")),
    ),
    suggestionList,
  );
  const node = el(
    "div",
    { class: "page search-page" },
    el("h1", { class: "catalog-sr-only" }, translateUI("Hledání")),
    form,
  );
  if (q.trim()) rememberSearch(q);
  else {
    const history = el("section", {
      class: "search-history",
      "aria-label": translateUI("Nedávná hledání"),
    });
    const refresh = () => {
      const terms = searchHistory();
      history.hidden = !terms.length;
      history.replaceChildren(
        el(
          "div",
          { class: "search-history-head" },
          el("h2", {}, translateUI("Nedávná hledání")),
          button(
            translateUI("Vymazat historii hledání"),
            () => {
              clearSearchHistory();
              refresh();
            },
            "small",
          ),
        ),
        el(
          "ul",
          { class: "search-history-list" },
          terms.map((term) => {
            const remove = el(
              "button",
              {
                type: "button",
                class: "chip-remove",
                "aria-label": translateUI("Odstranit „{0}“ z historie", term),
                onClick: () => {
                  removeSearch(term);
                  refresh();
                },
              },
              icon("close"),
            );
            return el(
              "li",
              { class: "history-chip" },
              el(
                "button",
                {
                  type: "button",
                  class: "history-term",
                  onClick: () => {
                    location.hash = `search?${searchParams(params, term)}`;
                  },
                },
                term,
              ),
              remove,
            );
          }),
        ),
      );
    };
    refresh();
    node.append(history);
  }
  // Skládač filtrů i v hledání: typ, žánry, roky, hodnocení, délka, kvalita,
  // jazyk, řazení + Moje filtry. Lze je kombinovat s hledaným názvem.
  const typeParam = params.get("t");
  const definition = paramsToDefinition(
    params,
    typeParam === "movie" || typeParam === "tv" ? typeParam : null,
    { grid: false },
  );
  const filterActive = hasCriteria(definition) || !!definition.type;
  const [genresResult, savedResult] = await Promise.all([
    api("titles/genres", { signal }).catch(() => null),
    api("saved-filters", { signal }).catch(() => null),
  ]);
  const genres = genresResult
      ? array(genresResult.genres, translateUI("žánry"))
      : [],
    savedFilters = savedResult
      ? array(savedResult.items, translateUI("uložené filtry"))
      : null;
  const builder = filterBuilder({
    route: "search",
    params,
    definition,
    genres,
    savedFilters,
    actions,
    allowType: true,
    queryText: () => input.value.trim(),
  });
  const results = el(
    "section",
    { class: "search-results", "aria-label": translateUI("Výsledky") },
    ...[builder.savedRow, builder.chipsRow].filter(Boolean),
  );
  node.append(
    el(
      "div",
      { class: "search-layout" },
      filterPanel(builder.filters, filterActive, filterActive && !q.trim()),
      results,
    ),
  );
  if (!q.trim() || filterActive) {
    if (!filterActive) {
      results.append(
        empty(
          translateUI("Na co máš dnes náladu?"),
          translateUI(
            "Napiš název filmu nebo seriálu, nebo si poskládej filtry.",
          ),
        ),
      );
      if (discoveryAllowed) {
        const discovery = el("section", { class: "popular-searches", "aria-label": translateUI("Objevuj tituly") });
        node.append(discovery);
        const loadDiscovery = async () => {
          const current = () => !signal?.aborted && apiContextKey() === searchContext && !input.value.trim();
          discovery.replaceChildren(loading());
          try {
            const [trends, popular] = await Promise.all([
              api("trending-searches?limit=8", { signal }),
              api("popular-titles-search?limit=8", { signal }),
            ]);
            const terms = Array.isArray(trends.trending_searches)
              ? [...new Set(trends.trending_searches.map((item) => item?.query).filter((term) => typeof term === "string" && term.trim()))].slice(0, 8) : [];
            const seen = new Set();
            const candidates = (Array.isArray(popular.popular_titles) ? popular.popular_titles : []).filter((item) => {
              if (!Number.isSafeInteger(item?.title_id) || item.title_id < 1 || seen.has(item.title_id) || !(item.interaction_count > 0)) return false;
              seen.add(item.title_id); return true;
            }).slice(0, 8);
            // Policy-scoped details, at most two requests at once. Keep the
            // server's discovery rank when individual posters are unavailable.
            const hydrated = new Array(candidates.length);
            let cursor = 0;
            await Promise.all([0, 1].map(async () => {
              while (current() && cursor < candidates.length) {
                const index = cursor++, candidate = candidates[index];
                try {
                  const item = title(await api(`titles/${candidate.title_id}`, { signal }));
                  if (item.id === candidate.title_id) hydrated[index] = item;
                } catch (error) { if (error?.name === "AbortError") throw error; }
              }
            }));
            await assertEffectivePolicyUnchanged(policy, { signal });
            if (!current()) return;
            discovery.replaceChildren();
            if (terms.length) discovery.append(
              el("h2", { class: "results-heading" }, translateUI("Populární hledání")),
              el("ul", { class: "popular-search-list" }, terms.map((term) => el("li", {}, el("button", {
                type: "button", class: "history-term", onClick: () => chooseSuggestion(term),
              }, term)))),
            );
            const items = hydrated.filter(Boolean);
            if (candidates.length && !items.length) throw new Error("Popular title details are unavailable");
            if (items.length) discovery.append(
              el("h2", { class: "results-heading" }, translateUI("Nejčastěji vybírané tituly")),
              el("div", { class: "catalog-grid" }, items.map((item) => poster(item, actions.detail))),
            );
          } catch (error) {
            if (error?.name === "AbortError" || !current()) return;
            discovery.replaceChildren(el("p", {class: "muted"}, translateUI("Návrhy se nepodařilo načíst.")),
              button(translateUI("Zkusit znovu"), loadDiscovery));
          }
        };
        // Return the search input immediately while suggestions load.
        void loadDiscovery();
      }
      return node;
    }
    const query = definitionQuery(definition);
    if (q.trim()) query.set("q", q.trim());
    if (definition.type) query.set("type", definition.type);
    query.set("page", String(page));
    query.set("limit", "24");
    const data = await api(`titles/filter?${query}`, { signal });
    await assertEffectivePolicyUnchanged(policy, { signal });
    const items = array(data.results, translateUI("výsledky")).map(title);
    results.append(
      ...[
        el(
          "h2",
          { class: "results-heading" },
          definition.type === "tv"
            ? translateUI("Seriály podle filtrů")
            : definition.type === "movie"
              ? translateUI("Filmy podle filtrů")
              : translateUI("Podle filtrů"),
        ),
        warning(data),
        items.length
          ? el(
              "div",
              { class: "catalog-grid" },
              items.map((t) => poster(t, actions.detail)),
            )
          : empty(
              translateUI("Nic neodpovídá"),
              translateUI("Těmto filtrům nic neodpovídá. Zkus je uvolnit."),
            ),
      ].filter(Boolean),
    );
    if (Number.isInteger(data.total_pages)) {
      const pager = pagination("search", params, page, data.total_pages);
      if (pager) results.append(pager);
    }
    return node;
  }
  const session = await api("session", { signal }).catch(() => null);
  const expectedOwner = session?.account?.id && session?.profile?.id
    ? { accountId: session.account.id, profileId: session.profile.id } : null;
  const openSearchResult = (result, ranked, offset = 0) => {
    if (expectedOwner) {
      void api("track-search", { method: "POST", expectedOwner, body: {
        query: q.trim(), title_id: result.id, interaction_type: "click",
        position_in_results: offset + Math.max(1, ranked.findIndex((t) => t.id === result.id) + 1),
      } }).catch(() => console.warn("Search click could not be recorded"));
    }
    actions.detail(result);
  };
  // Název i filtry z textu najednou („akční komedie 2020-2023 7+"); filtry
  // jsou doplněk, jejich chyba hledání podle názvu nezastaví.
  const [data, filtered] = await Promise.all([
    api(
      `search?${new URLSearchParams({ q, type: "both", limit: "24", offset: String((page - 1) * 24) })}`,
      { signal },
    ),
    api(`search/filters?${new URLSearchParams({ q, limit: "30" })}`, {
      signal,
    }).catch(() => null),
  ]);
  await assertEffectivePolicyUnchanged(policy, { signal });
  const items = array(data.results, translateUI("výsledky hledání")).map(title);
  if (!Number.isInteger(data.total))
    throw new Error(translateUI("API nevrátilo počet výsledků."));
  const filteredItems =
    filtered?.parsed?.matched && Array.isArray(filtered.results)
      ? filtered.results.map(title)
      : [];
  const grouped = splitExactSearch(items, q);
  if (grouped.exact.length) results.append(el("section", {class: "exact-search-results"},
    el("h2", {class: "results-heading"}, translateUI("Přesná shoda názvu")),
    el("div", {class: "catalog-grid"}, grouped.exact.map((item) => poster(item, (selected) => openSearchResult(selected, items, (page - 1) * 24)))),
  ));
  if (filteredItems.length) {
    results.append(
      el(
        "section",
        { class: "filter-results" },
        el("h2", { class: "results-heading" }, translateUI("Podle filtrů")),
        el(
          "div",
          { class: "filter-chips" },
          interpretationChips(filtered.parsed).map((c) =>
            el("span", { class: "chip active" }, c),
          ),
          filtered.parsed.text
            ? el(
                "span",
                { class: "muted" },
                translateUI("ignorováno: {0}", filtered.parsed.text),
              )
            : null,
        ),
        el(
          "div",
          { class: "catalog-grid" },
          filteredItems.map((t) => poster(t, (selected) => openSearchResult(selected, filteredItems))),
        ),
      ),
    );
  }
  results.append(
    el(
      "h2",
      { class: "results-heading" },
      translateUI(
        "{0} pro „{1}“",
        countLabel(
          data.total,
          translateUI("výsledek"),
          translateUI("výsledky"),
          translateUI("výsledků"),
        ),
        q,
      ),
    ),
  );
  const w = warning(data);
  if (w) results.append(w);
  results.append(
    ...[
      grouped.related.length
        ? el(
            "div",
            { class: "catalog-grid" },
            grouped.related.map((t) => poster(t, (selected) => openSearchResult(selected, items, (page - 1) * 24))),
          )
        : filteredItems.length || grouped.exact.length
          ? null
          : empty(
              translateUI("Nic jsme nenašli"),
              translateUI(
                "Zkus jiný název, nebo filtr: akční komedie 2020-2023, horory 90. léta 7+, seriály sci-fi 4k cz.",
              ),
            ),
    ].filter(Boolean),
  );
  const pager = pagination("search", params, page, Math.ceil(data.total / 24));
  if (pager) results.append(pager);
  return node;
}
export async function collection(params, signal, actions) {
  const slug = params.get("slug");
  if (!/^[a-z0-9_-]+$/.test(slug || ""))
    throw new Error(translateUI("Neplatný katalog."));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const source = params.get("source");
  const fromHome = source === "home" || source === "home_collection";
  const policy = await effectiveContentPolicy({ signal, refresh: true });
  const data = await api(fromHome ? homeQuery({ [source === "home" ? "section" : "collection"]: slug, page }) :
    `${source === "themed" ? "themed-lists" : "main/lists"}/${slug}?page=${page}&limit=30`, { signal });
  await assertEffectivePolicyUnchanged(policy, { signal });
  const rows = fromHome ? homeSections(data) : null;
  if (fromHome && (rows.length !== 1 || rows[0].slug !== slug || rows[0].pagination?.page !== page)) throw new Error(translateUI("Neplatná řada Domů."));
  const list = fromHome ? rows[0] : data.list || data;
  if (fromHome && !["ready", "empty"].includes(list.state)) throw new Error(list.warning || translateUI("Řada se neobnovila."));
  if (fromHome && list.kind === "collections") {
    const node = serverHomeCollectionList(list, params);
    return node;
  }
  const items = fromHome ? homeItems(list) : array(list.items || data.items, translateUI("položky katalogu")).map(title);
  const tracker = fromHome ? homeTracking(signal, actions) : null;
  if (tracker) tracker.setOwner(data.viewer_scope);
  const node = el(
    "div",
    { class: "page collection-page" },
    el("a", { href: "#home", class: "text-link catalog-back" }, translateUI("Zpět na Home")),
    el("h1", {}, list.name || translateUI("Katalog")),
    warning(data),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, tracker ? tracker.detail : actions.detail)),
        )
      : empty(
          translateUI("Katalog je prázdný"),
          translateUI("Zatím tu nejsou žádné tituly."),
        ),
  );
  if (fromHome) {
    decorateHomeCards(node, items, tracker);
  }
  const pages = list.pagination?.total_pages ?? data.pagination?.total_pages ?? data.total_pages;
  if (Number.isInteger(pages)) {
    const p = pagination("collection", params, page, pages);
    if (p) node.append(p);
  } else if (list.has_more || page > 1) {
    const controls = el("div", { class: "pagination" });
    for (const [label, delta] of [
      [translateUI("Předchozí"), -1],
      [translateUI("Další"), 1],
    ]) {
      const b = button(label, () => {
        const p = new URLSearchParams(params);
        p.set("page", page + delta);
        location.hash = `collection?${p}`;
      });
      b.disabled = delta < 0 ? page <= 1 : !list.has_more;
      controls.append(b);
    }
    node.append(controls);
  }
  return node;
}

function serverHomeCollectionList(list, params) {
  const node = el("div", { class: "page collection-page" }, el("a", { href: "#home", class: "text-link catalog-back" }, translateUI("Zpět na Home")), el("h1", {}, list.name),
    el("div", { class: "collection-banners" }, (list.collections || []).map(c => el("a", {
      class: "collection-banner", href: `#collection?${new URLSearchParams({ source: "home_collection", slug: c.slug })}`,
    }, el("strong", {}, c.name), el("span", {}, translateUI("{0} titulů", c.total_items))))));
  const pager = pagination("collection", params, list.pagination.page, list.pagination.total_pages);
  if (pager) node.append(pager);
  return node;
}
