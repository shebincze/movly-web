import { api, array, title } from "./api.js";
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
} from "./ui.js";
export async function home(signal, actions) {
  const results = await Promise.all([
    api("main?type=movie&limit=12", { signal }),
    api("main?type=tv&limit=12", { signal }),
  ]);
  const groups = results.flatMap((result) =>
    array(result.lists, "katalog").map((group) => ({
      ...group,
      items: array(group.items).map(title),
    })),
  );
  const featured =
    groups.flatMap((g) => g.items).find((t) => t.backdrop_path) ||
    groups.flatMap((g) => g.items)[0];
  const content = el(
    "div",
    {},
    featured
      ? hero(featured, actions.detail, actions.save)
      : empty(
          "Katalog je zatím prázdný",
          "Až se objeví první tituly, najdeš je tady.",
        ),
  );
  results.forEach((r) => {
    const w = warning(r);
    if (w) content.append(el("div", { class: "rail-section" }, w));
  });
  // Personal rows can occur in both media responses. Keep both when their
  // content types differ; exact duplicates are omitted, never mixed by ID.
  const seen = new Set();
  for (const group of groups) {
    const fingerprint = `${group.slug}:${group.items.map((t) => t.id).join(",")}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    if (group.items.length)
      content.append(
        rail(
          group.name,
          group.items,
          actions.detail,
          group.has_more && /^[a-z0-9_-]+$/.test(group.slug)
            ? `#collection?slug=${encodeURIComponent(group.slug)}`
            : null,
        ),
      );
  }
  return content;
}
export async function catalog(route, params, signal, actions) {
  const isSeries = route === "series",
    type = isSeries ? "tv" : "movie";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams({
    type,
    page: String(page),
    limit: "24",
    sort_by: params.get("sort") || "popularity",
    sort_order: params.get("sort") === "title" ? "asc" : "desc",
  });
  for (const [param, key] of [
    ["genre", "genre_ids"],
    ["year", "year_from"],
    ["rating", "rating_from"],
  ])
    if (params.get(param)) query.set(key, params.get(param));
  if (params.get("year")) query.set("year_to", params.get("year"));
  const [data, genresResult] = await Promise.all([
    api(`titles/filter?${query}`, { signal }),
    api("titles/genres", { signal }),
  ]);
  const items = array(data.results, "výsledky").map(title),
    genres = array(genresResult.genres, "žánry");
  const genre = el(
    "select",
    { name: "genre" },
    el("option", { value: "" }, "Všechny žánry"),
    genres.map((g) => el("option", { value: g.id }, g.name_cs || g.name)),
  );
  genre.value = params.get("genre") || "";
  const sort = el(
    "select",
    { name: "sort" },
    [
      ["popularity", "Podle popularity"],
      ["rating", "Nejlépe hodnocené"],
      ["year", "Nejnovější"],
      ["title", "Podle názvu"],
    ].map(([value, label]) => el("option", { value }, label)),
  );
  sort.value = params.get("sort") || "popularity";
  const year = el("input", {
    name: "year",
    type: "number",
    min: 1800,
    max: 2100,
    placeholder: "Všechny",
    value: params.get("year") || "",
  });
  const rating = el(
    "select",
    { name: "rating" },
    [
      ["", "Libovolné"],
      ["6", "6 a více"],
      ["7", "7 a více"],
      ["8", "8 a více"],
      ["9", "9 a více"],
    ].map(([value, label]) => el("option", { value }, label)),
  );
  rating.value = params.get("rating") || "";
  const filters = el(
    "form",
    {
      class: "filters",
      onSubmit: (e) => {
        e.preventDefault();
        const q = new URLSearchParams();
        for (const [k, v] of new FormData(filters)) if (v) q.set(k, v);
        location.hash = `${route}?${q}`;
      },
    },
    formField("Žánr", genre),
    formField("Rok vydání", year),
    formField("Hodnocení", rating),
    formField("Řazení", sort),
    el(
      "button",
      { class: "button secondary", type: "submit" },
      "Použít filtry",
    ),
  );
  const node = el(
    "div",
    { class: "page" },
    el("h1", {}, isSeries ? "Seriály" : "Filmy"),
    el("p", {}, "Vyber si příběh podle své nálady."),
    filters,
    warning(data),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty("Žádné tituly", "Zkus změnit filtry."),
  );
  if (!Number.isInteger(data.total_pages) || !Number.isInteger(data.total))
    throw new Error("API nevrátilo stránkování katalogu.");
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
  const prev = button("Předchozí", () => go(page - 1)),
    next = button("Další", () => go(page + 1));
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
    placeholder: "Filmy, seriály…",
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
    formField("Co chceš objevit?", input),
    el("button", { type: "submit", class: "button primary" }, "Hledat"),
  );
  const node = el("div", { class: "page" }, el("h1", {}, "Hledání"), form);
  if (!q.trim()) {
    node.append(
      empty(
        "Na co máš dnes náladu?",
        "Napiš název filmu nebo seriálu a prozkoumej katalog.",
      ),
    );
    return node;
  }
  const data = await api(
    `search?${new URLSearchParams({ q, type: "both", limit: "24", offset: String((page - 1) * 24) })}`,
    { signal },
  );
  const items = array(data.results, "výsledky hledání").map(title);
  if (!Number.isInteger(data.total))
    throw new Error("API nevrátilo počet výsledků.");
  node.append(
    el(
      "p",
      {},
      `${countLabel(data.total, "výsledek", "výsledky", "výsledků")} pro „${q}“`,
    ),
  );
  const w = warning(data);
  if (w) node.append(w);
  node.append(
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty("Nic jsme nenašli", "Zkus jiný název nebo kratší dotaz."),
  );
  const pager = pagination("search", params, page, Math.ceil(data.total / 24));
  if (pager) node.append(pager);
  return node;
}
export async function collection(params, signal, actions) {
  const slug = params.get("slug");
  if (!/^[a-z0-9_-]+$/.test(slug || "")) throw new Error("Neplatný katalog.");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const data = await api(`main/lists/${slug}?page=${page}&limit=24`, {
    signal,
  });
  const list = data.list || data;
  const items = array(list.items || data.items, "položky katalogu").map(title);
  const node = el(
    "div",
    { class: "page" },
    el("a", { href: "#home", class: "text-link" }, "Zpět na Objevovat"),
    el("h1", {}, list.name || "Katalog"),
    warning(data),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty("Katalog je prázdný", "Zatím tu nejsou žádné tituly."),
  );
  const pages = data.pagination?.total_pages ?? data.total_pages;
  if (Number.isInteger(pages)) {
    const p = pagination("collection", params, page, pages);
    if (p) node.append(p);
  } else if (list.has_more || page > 1) {
    const controls = el("div", { class: "pagination" });
    for (const [label, delta] of [
      ["Předchozí", -1],
      ["Další", 1],
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
