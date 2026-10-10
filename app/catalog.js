import { serverHome, homeItems, homeTracking, decorateHomeCards, resetHomeImpressions } from "./home.js";
import { homeQuery, homeSections } from "./home-state.js";
import { translateUI } from "./i18n.js";
import {
  searchHistory,
  rememberSearch,
  removeSearch,
  clearSearchHistory,
} from "./search-history.js";
import { api, array, title, imageURL } from "./api.js";
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
} from "./ui.js";
function carousel(items, actions) {
  let index = 0;
  const slide = el("div", {}),
    dots = el("div", {
      class: "hero-dots",
      "aria-label": translateUI("Výběr doporučeného titulu"),
    });
  function show(next) {
    index = (next + items.length) % items.length;
    slide.replaceChildren(hero(items[index], actions.detail, actions.save));
    if (items[index].homeHighlight?.label || items[index].homeHeading) slide.querySelector(".hero-content").prepend(el("p", { class: "meta" }, items[index].homeHighlight?.label || items[index].homeHeading));
    actions.onHero?.(slide.firstElementChild, items[index]);
    dots
      .querySelectorAll("button")
      .forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
  }
  items
    .slice(0, 10)
    .forEach((t, i) => dots.append(button(t.title, () => show(i), "hero-dot")));
  show(0);
  return el(
    "section",
    { class: "home-carousel" },
    slide,
    el(
      "div",
      { class: "hero-controls" },
      button(translateUI("Předchozí"), () => show(index - 1), "small"),
      dots,
      button(translateUI("Další"), () => show(index + 1), "small"),
    ),
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
  return serverHome(signal, actions, carousel);
}
// Stale-while-revalidate pro Filmy/Seriály: návrat na stránku vykreslí hned
// poslední odpověď /main (do 5 min) a na pozadí ji tiše ověří. Osobní řady se
// po vlastní změně vymění přes /main/personal (viz refreshPersonalRails).
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map();
export function resetCatalogCache() {
  catalogCache.clear();
  resetHomeImpressions();
}
function catalogKey(type) {
  return `main?type=${type}&limit=30`;
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
async function revalidateCatalog(type, page, actions, signal) {
  const key = catalogKey(type);
  try {
    const fresh = await api(key, { signal });
    const cached = catalogCache.get(key);
    catalogCache.set(key, { data: fresh, at: Date.now() });
    if (
      page.isConnected &&
      JSON.stringify(cached?.data?.lists) !== JSON.stringify(fresh.lists)
    )
      renderRails(page, fresh, actions);
  } catch {
    // stará data zůstávají; další navigace to zkusí znovu
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
  const personal = await api(`main/personal?type=${type}&limit=30`);
  const curated = array(cached.data.lists).filter(
    (g) => !isPersonalSlug(g.slug),
  );
  const lists = orderedGroups(personal);
  const merged = {
    ...cached.data,
    lists: [
      ...lists.filter((g) => g.slug !== "friends-activity"),
      ...curated,
      ...lists.filter((g) => g.slug === "friends-activity"),
    ],
  };
  catalogCache.set(key, { data: merged, at: cached.at });
  if (page.isConnected) renderRails(page, merged, page.movlyActions);
}
let personalRefreshTimer = 0;
document.addEventListener("movly:personal-changed", () => {
  clearTimeout(personalRefreshTimer);
  personalRefreshTimer = setTimeout(() => {
    refreshPersonalRails().catch(() => {});
  }, 250);
});
export async function catalog(route, params, signal, actions) {
  if (params.get("view") === "grid")
    return catalogGrid(route, params, signal, actions);
  const type = route === "series" ? "tv" : "movie",
    key = catalogKey(type),
    cached = catalogCache.get(key),
    fresh = cached && Date.now() - cached.at < CATALOG_TTL_MS;
  let data;
  if (cached) data = cached.data;
  else {
    data = await api(key, { signal });
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
  "orig",
  "sort",
];
function intParam(params, key, max) {
  const value = Number.parseInt(params.get(key) || "", 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : null;
}
function paramsToDefinition(params, type) {
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
    video_height_min: intParam(params, "q", 4320),
    hdr: !!params.get("hdr") || null,
    audio_language: params.get("audio") || null,
    original_language: params.get("orig") || null,
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
  if (d.video_height_min) q.set("q", String(d.video_height_min));
  if (d.hdr) q.set("hdr", "1");
  if (d.audio_language) q.set("audio", d.audio_language);
  if (d.original_language) q.set("orig", d.original_language);
  if (d.sort_by && d.sort_by !== "popularity") q.set("sort", d.sort_by);
  return q;
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
      d.original_language ||
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
  if (d.original_language)
    chips.push(`orig. ${d.original_language.toUpperCase()}`);
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
}) {
  const grid = !allowType;
  const genreNames = new Map(genres.map((g) => [g.id, g.name_cs || g.name]));
  const selectedGenres = new Set(definition.genre_ids || []);
  const typeSelect = allowType
    ? el(
        "select",
        { name: "t" },
        [
          ["", translateUI("Filmy i seriály")],
          ["movie", translateUI("Filmy")],
          ["tv", translateUI("Seriály")],
        ].map(([v, label]) => el("option", { value: v }, label)),
      )
    : null;
  if (typeSelect) typeSelect.value = definition.type || "";
  const genre = el(
    "select",
    { name: "genre", multiple: true, size: 6 },
    genres.map((g) => {
      const option = el("option", { value: g.id }, g.name_cs || g.name);
      option.selected = selectedGenres.has(g.id);
      return option;
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
    "q",
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
  const original = select(
    "orig",
    [["", translateUI("Jakýkoli")], ...ORIGINAL_LANGUAGES],
    definition.original_language,
  );
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
        const genreIds = [...genre.selectedOptions].map((o) => o.value);
        if (genreIds.length) q.set("genre", genreIds.join(","));
        for (const [k, v] of new FormData(filters))
          if (v && k !== "genre") q.set(k, v);
        location.hash = `${route}?${q}`;
      },
    },
    typeSelect ? formField(translateUI("Typ"), typeSelect) : null,
    formField(translateUI("Žánry (více najednou)"), genre),
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
    formField(translateUI("Původní jazyk"), original),
    formField(translateUI("Řazení"), sort),
    el(
      "button",
      { class: "button secondary", type: "submit" },
      translateUI("Použít filtry"),
    ),
    hasCriteria(definition) || (allowType && definition.type)
      ? el(
          "a",
          {
            class: "button secondary",
            href: `#${route}${grid ? "?view=grid" : ""}`,
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
        location.hash = `${target}?${definitionToParams(saved.filter || {}, { grid })}`;
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
  const node = el(
    "div",
    { class: "page" },
    el("h1", {}, isSeries ? translateUI("Seriály") : translateUI("Filmy")),
    el("p", {}, translateUI("Vyber si příběh podle své nálady.")),
    el(
      "a",
      { class: "text-link", href: `#${route}` },
      translateUI("Zpět na řady katalogu"),
    ),
    filters,
    chipsRow,
    savedRow,
    warning(data),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty(translateUI("Žádné tituly"), translateUI("Zkus změnit filtry.")),
  );
  if (!Number.isInteger(data.total_pages) || !Number.isInteger(data.total))
    throw new Error(translateUI("API nevrátilo stránkování katalogu."));
  const pager = pagination(route, params, page, data.total_pages);
  if (pager) node.append(pager);
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
export async function search(params, signal, actions) {
  const q = params.get("q") || "",
    page = Math.max(1, Number(params.get("page")) || 1);
  const input = el("input", {
    type: "search",
    name: "q",
    placeholder: translateUI("Filmy, seriály…"),
    value: q,
    maxlength: 200,
    required: true,
    autocomplete: "off",
  });
  const form = el(
    "form",
    {
      class: "search-form",
      role: "search",
      onSubmit: (e) => {
        e.preventDefault();
        location.hash = `search?q=${encodeURIComponent(input.value.trim())}`;
      },
    },
    formField(translateUI("Co chceš objevit?"), input),
    el(
      "button",
      { type: "submit", class: "button primary" },
      translateUI("Hledat"),
    ),
  );
  const node = el(
    "div",
    { class: "page" },
    el("h1", {}, translateUI("Hledání")),
    form,
  );
  if (q.trim()) rememberSearch(q);
  else {
    const history = el("section", {
      "aria-label": translateUI("Nedávná hledání"),
    });
    const refresh = () => {
      history.replaceChildren(
        el("h2", {}, translateUI("Nedávná hledání")),
        ...searchHistory().map((term) =>
          el(
            "div",
            { class: "actions" },
            button(term, () => {
              location.hash = "search?q=" + encodeURIComponent(term);
            }),
            button(
              translateUI("Odstranit"),
              () => {
                removeSearch(term);
                refresh();
              },
              "small",
            ),
          ),
        ),
        button(
          translateUI("Vymazat historii hledání"),
          () => {
            clearSearchHistory();
            refresh();
          },
          "small",
        ),
      );
    };
    refresh();
    node.append(history);
  }
  // Skládač filtrů i v hledání: typ, žánry, roky, hodnocení, délka, kvalita,
  // jazyk, řazení + Moje filtry. Platí, když je pole hledání prázdné.
  const typeParam = params.get("t");
  const definition = paramsToDefinition(
    params,
    typeParam === "movie" || typeParam === "tv" ? typeParam : null,
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
  });
  const details = el(
    "details",
    { class: "filters-details" },
    el(
      "summary",
      {},
      filterActive ? translateUI("Filtry (aktivní)") : translateUI("Filtry"),
    ),
    builder.filters,
  );
  details.open = filterActive && !q.trim();
  node.append(...[details, builder.chipsRow, builder.savedRow].filter(Boolean));
  if (!q.trim()) {
    if (!filterActive) {
      node.append(
        empty(
          translateUI("Na co máš dnes náladu?"),
          translateUI(
            "Napiš název filmu nebo seriálu, nebo si poskládej filtry.",
          ),
        ),
      );
      return node;
    }
    const query = definitionQuery(definition);
    if (definition.type) query.set("type", definition.type);
    query.set("page", String(page));
    query.set("limit", "24");
    const data = await api(`titles/filter?${query}`, { signal });
    const items = array(data.results, translateUI("výsledky")).map(title);
    node.append(
      ...[
        el(
          "h2",
          {},
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
      if (pager) node.append(pager);
    }
    return node;
  }
  if (filterActive)
    node.append(
      el(
        "p",
        { class: "muted" },
        translateUI(
          "Filtry se použijí, když je pole hledání prázdné; teď hledám podle názvu.",
        ),
      ),
    );
  const session = await api("session", { signal }).catch(() => null);
  const expectedOwner = session?.account?.id && session?.profile?.id
    ? { accountId: session.account.id, profileId: session.profile.id } : null;
  const openSearchResult = (result, ranked) => {
    if (expectedOwner) {
      void api("track-search", { method: "POST", expectedOwner, body: {
        query: q.trim(), title_id: result.id, interaction_type: "click",
        position_in_results: Math.max(1, ranked.findIndex((t) => t.id === result.id) + 1),
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
  const items = array(data.results, translateUI("výsledky hledání")).map(title);
  if (!Number.isInteger(data.total))
    throw new Error(translateUI("API nevrátilo počet výsledků."));
  const filteredItems =
    filtered?.parsed?.matched && Array.isArray(filtered.results)
      ? filtered.results.map(title)
      : [];
  if (filteredItems.length) {
    node.append(
      el(
        "section",
        { class: "filter-results" },
        el("h2", {}, translateUI("Podle filtrů")),
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
        el("h2", {}, translateUI("Podle názvu")),
      ),
    );
  }
  node.append(
    el(
      "p",
      {},
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
  if (w) node.append(w);
  node.append(
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, (selected) => openSearchResult(selected, items))),
        )
      : filteredItems.length
        ? null
        : empty(
            translateUI("Nic jsme nenašli"),
            translateUI(
              "Zkus jiný název, nebo filtr: akční komedie 2020-2023, horory 90. léta 7+, seriály sci-fi 4k cz.",
            ),
          ),
  );
  const pager = pagination("search", params, page, Math.ceil(data.total / 24));
  if (pager) node.append(pager);
  return node;
}
export async function collection(params, signal, actions) {
  const slug = params.get("slug");
  if (!/^[a-z0-9_-]+$/.test(slug || ""))
    throw new Error(translateUI("Neplatný katalog."));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const source = params.get("source");
  const fromHome = source === "home" || source === "home_collection";
  const data = await api(fromHome ? homeQuery({ [source === "home" ? "section" : "collection"]: slug, page }) :
    `${source === "themed" ? "themed-lists" : "main/lists"}/${slug}?page=${page}&limit=30`, { signal });
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
    { class: "page" },
    el("a", { href: "#home", class: "text-link" }, translateUI("Zpět na Home")),
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
  const node = el("div", { class: "page" }, el("a", { href: "#home", class: "text-link" }, translateUI("Zpět na Home")), el("h1", {}, list.name),
    el("div", { class: "collection-banners" }, (list.collections || []).map(c => el("a", {
      class: "collection-banner", href: `#collection?${new URLSearchParams({ source: "home_collection", slug: c.slug })}`,
    }, el("strong", {}, c.name), el("span", {}, translateUI("{0} titulů", c.total_items))))));
  const pager = pagination("collection", params, list.pagination.page, list.pagination.total_pages);
  if (pager) node.append(pager);
  return node;
}
