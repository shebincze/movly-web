import { translateUI } from "./i18n.js";
import { api, array, title, imageURL } from "./api.js";
import { setWatched, isWatched, progressPercent } from "./user-state.js";
import { personalDataForTitle } from "./personal-data-mirror.js";
import {
  el,
  button,
  showDialog,
  loading,
  errorBox,
  formField,
  toast,
  empty,
  countLabel,
} from "./ui.js";
export async function titleActivity(t, section = "all") {
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, t.title),
      loading(),
    ),
  );
  try {
    const mirrored = await personalDataForTitle(t.id);
    const [hidden, mine] = mirrored
      ? [mirrored.hidden, mirrored.mine]
      : await Promise.all([
          titleIsHidden(t.id),
          api(`ratings/title/${t.id}/my`),
        ]);
    if (!dialog.open) return;
    const status = el("p", { role: "alert", class: "form-status" });
    const value = el("input", {
      type: "number",
      min: 0,
      max: 10,
      step: 0.5,
      required: true,
      value: mine.rating?.rating ?? 8,
    });
    const publish = el("input", {
      type: "checkbox",
      checked: mine.rating?.is_public,
    });
    const submit = el(
      "button",
      { type: "submit", class: "button accent" },
      translateUI("Uložit hodnocení"),
    );
    const form = el(
      "form",
      {
        class: "dialog-form",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api(`ratings?title_id=${t.id}`, {
              method: "POST",
              body: { rating: Number(value.value), is_public: publish.checked },
            });
            window.dispatchEvent(new Event("movly:personal-changed"));
            toast(translateUI("Hodnocení uloženo."));
            await titleActivity(t, section);
          } catch (e) {
            status.textContent = e.message;
            submit.disabled = false;
          }
        },
      },
      formField(translateUI("Moje hodnocení (0–10)"), value),
      el("label", {}, publish, translateUI(" Veřejné hodnocení")),
      submit,
    );
    const change = async (state) => {
      try {
        await api("watch-history", {
          method: "POST",
          body: {
            title_id: t.id,
            type: t.type,
            watch_status: state,
            ...(state === "completed" && t.runtime
              ? {
                  duration_seconds: t.runtime * 60,
                  progress_seconds: t.runtime * 60,
                }
              : {}),
          },
        });
        // Karty pod dialogem i detail se překreslí hned, bez reloadu.
        if (state === "completed") setWatched(t.id, true);
        else if (state === "dropped" || state === "plan_to_watch") setWatched(t.id, false);
        toast(translateUI("Stav sledování uložen."));
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const activity = el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, t.title),
        el("h3", {}, translateUI("Stav sledování")),
        el(
          "div",
          { class: "actions" },
          button(translateUI("Zhlédnuto"), () => change("completed")),
          button(translateUI("Právě sleduji"), () => change("watching")),
          button(translateUI("Nezhlédnuto"), () => change("plan_to_watch")),
          button(translateUI("Přestal/a jsem sledovat"), () =>
            change("dropped"),
          ),
          button(
            hidden
              ? translateUI("Obnovit v rozkoukaných")
              : translateUI("Skrýt z rozkoukaných"),
            async () => {
              try {
                await api(
                  hidden
                    ? "user/hidden-titles/" + t.id + "?source=continue_watching"
                    : "user/hidden-titles",
                  hidden
                    ? { method: "DELETE" }
                    : {
                        method: "POST",
                        body: { title_id: t.id, source: "continue_watching" },
                      },
                );
                window.dispatchEvent(new Event("movly:personal-changed"));
                await titleActivity(t, section);
              } catch (error) {
                status.textContent = error.message;
              }
            },
          ),
        ),
        el("h3", {}, translateUI("Hodnocení")),
        form,
        mine.has_rated
          ? button(
              translateUI("Smazat hodnocení"),
              async () => {
                try {
                  await api(`ratings/${mine.rating.id}`, { method: "DELETE" });
                  window.dispatchEvent(new Event("movly:personal-changed"));
                  await titleActivity(t, section);
                } catch (e) {
                  status.textContent = e.message;
                }
              },
              "small danger",
            )
          : null,
        status,
      );
    // Each detail shortcut opens the corresponding existing controls.
    const groups = activity.querySelectorAll(":scope > h3");
    const watchActions = activity.querySelector(":scope > .actions");
    if (section === "rating") {
      groups[0].remove();
      watchActions.remove();
    } else if (section === "watched" || section === "hidden") {
      groups[1].remove();
      form.remove();
      activity.querySelector(":scope > .small")?.remove();
      for (const [index, action] of [...watchActions.children].entries()) {
        if (section === "hidden" ? index !== 4 : index === 4) action.remove();
      }
    }
    showDialog(activity);
  } catch (e) {
    if (dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, t.title),
          errorBox(e, () => titleActivity(t, section)),
        ),
      );
  }
}
// Společná hlavička „Moje seznamy“: nadpis, akce a záložky jednotlivých částí.
export function libraryHead(active, ...extra) {
  return [
    el(
      "div",
      { class: "lib-head" },
      el("h1", {}, translateUI("Moje seznamy")),
      el("span", { class: "lib-spacer" }),
      ...extra,
    ),
    el(
      "nav",
      { class: "lib-tabs", "aria-label": translateUI("Části knihovny") },
      [
        ["lists", translateUI("Seznamy")],
        ["history", translateUI("Historie sledování")],
        ["hidden", translateUI("Skryté tituly")],
        ["offline", translateUI("Offline knihovna")],
      ].map(([key, label]) =>
        el(
          "a",
          { href: `#${key}`, "aria-current": key === active ? "page" : null },
          label,
        ),
      ),
    ),
  ];
}
export function libraryThumb(path, className = "lib-thumb") {
  const url = imageURL(path, "w185");
  return el(
    "span",
    { class: className, "aria-hidden": "true" },
    url
      ? el("img", {
          src: url,
          alt: "",
          loading: "lazy",
          decoding: "async",
          onError: (e) => e.target.remove(),
        })
      : null,
  );
}
// Karta seznamu: tři překryté plakáty, název, počet a štítek.
export function listCard({ href, name, meta, tag, tone, posters = [], featured }) {
  return el(
    "a",
    { class: `lib-list-card${featured ? " featured" : ""}`, href },
    el(
      "span",
      { class: "lib-stack", "aria-hidden": "true" },
      [0, 1, 2].map((i) => libraryThumb(posters[i], "lib-stack-art")),
    ),
    el(
      "span",
      { class: "lib-list-text" },
      el("strong", {}, name),
      meta ? el("span", { class: "lib-muted" }, meta) : null,
    ),
    tag ? el("span", { class: `lib-tag${tone ? " " + tone : ""}` }, tag) : null,
  );
}
export function initialAvatar(name) {
  const text = String(name || "?");
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return el(
    "span",
    { class: "lib-avatar", "data-tone": String(hash % 4), "aria-hidden": "true" },
    [...text.trim()][0]?.toUpperCase() || "?",
  );
}
function dayLabel(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return null;
  const now = new Date(),
    start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((start(now) - start(date)) / 864e5);
  if (diff === 0) return translateUI("Dnes");
  if (diff === 1) return translateUI("Včera");
  return date.toLocaleDateString(document.documentElement.lang || "cs", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
function historyRow(t, onTitle) {
  const p = t.progress,
    done = isWatched(t),
    percent = progressPercent(t);
  const episode =
    p?.season_number && p?.episode_number
      ? `S${p.season_number} E${p.episode_number}`
      : null;
  return el(
    "li",
    { class: "lib-row" },
    el(
      "button",
      { type: "button", class: "lib-row-main", onClick: () => onTitle(t) },
      libraryThumb(t.poster_path),
      el(
        "span",
        { class: "lib-row-text" },
        el("strong", {}, t.title),
        el(
          "span",
          { class: "lib-row-sub" },
          [
            t.type === "tv" ? episode || translateUI("Seriál") : translateUI("Film"),
            done
              ? translateUI("Zhlédnuto")
              : percent > 0
                ? translateUI("{0} % zhlédnuto", Math.round(percent))
                : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        !done && percent > 0
          ? el("progress", {
              max: 100,
              value: Math.min(100, percent),
              "aria-label": translateUI("Rozkoukáno"),
            })
          : null,
      ),
    ),
  );
}
// Řádky historie seskupené podle dne posledního sledování.
function historyList(items, onTitle) {
  const root = el("div", { class: "lib-day-groups" });
  let day, list;
  for (const t of items) {
    const label = dayLabel(t.progress?.last_watched_at || t.progress?.watched_at);
    if (!list || label !== day) {
      day = label;
      list = el("ul", { class: "lib-rows" });
      if (label) root.append(el("h3", { class: "lib-day" }, label));
      root.append(list);
    }
    list.append(historyRow(t, onTitle));
  }
  return root;
}
export async function recentHistory(signal, actions) {
  let items;
  try {
    items = array(
      (await api("watch-history/list?page=1&limit=5", { signal })).items,
    ).map(title);
  } catch (e) {
    if (signal.aborted) throw e;
    return null;
  }
  return el(
    "section",
    { class: "lib-card lib-recent", "aria-labelledby": "lib-recent-title" },
    el("h2", { id: "lib-recent-title" }, translateUI("Historie")),
    items.length
      ? historyList(items, actions.detail)
      : el("p", { class: "lib-muted" }, translateUI("Zatím bez titulů")),
    el(
      "div",
      { class: "lib-links" },
      el("a", { class: "text-link", href: "#history" }, translateUI("Celá historie")),
      el("a", { class: "text-link", href: "#stats" }, translateUI("Statistiky sledování")),
    ),
  );
}
function pager(page, hasMore, href) {
  if (page <= 1 && !hasMore) return null;
  return el(
    "nav",
    { class: "lib-pager", "aria-label": translateUI("Stránkování") },
    page > 1
      ? el("a", { class: "button secondary", href: href(page - 1) }, translateUI("Předchozí"))
      : null,
    el("span", {}, translateUI("Strana {0}", page)),
    hasMore
      ? el("a", { class: "button secondary", href: href(page + 1) }, translateUI("Další"))
      : null,
  );
}
export async function history(params, signal, actions) {
  const page = Math.max(1, Number(params.get("page")) || 1),
    status = params.get("status") === "completed" ? "completed" : "watching";
  const data = await api(
    `watch-history/list?page=${page}&limit=24&status=${status}`,
    { signal },
  );
  const items = array(data.items).map(title);
  const segment = (key, label) =>
    el(
      "a",
      { href: `#history?status=${key}`, "aria-current": status === key ? "page" : null },
      label,
    );
  return el(
    "div",
    { class: "page library-page" },
    ...libraryHead(
      "history",
      el("a", { class: "button secondary", href: "#stats" }, translateUI("Statistiky sledování")),
    ),
    el(
      "div",
      { class: "lib-toolbar" },
      el(
        "nav",
        { class: "segmented lib-segmented", "aria-label": translateUI("Historie sledování") },
        segment("watching", translateUI("Rozkoukané")),
        segment("completed", translateUI("Zhlédnuté")),
      ),
      Number.isFinite(data.total_items)
        ? el(
            "span",
            { class: "lib-muted" },
            countLabel(data.total_items, translateUI("titul"), translateUI("tituly"), translateUI("titulů")),
          )
        : null,
    ),
    items.length
      ? el("section", { class: "lib-card lib-history" }, historyList(items, actions.detail))
      : empty(
          translateUI("Zatím bez titulů"),
          translateUI(
            "Historie se synchronizuje se stejným profilem v aplikacích.",
          ),
        ),
    pager(page, data.has_more, (n) => `#history?status=${status}&page=${n}`),
  );
}
function rankedBars(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  return rows.map((row) => {
    const fill = el("span");
    // CSP zakazuje style atribut; šířka přes CSSOM je povolená.
    fill.style.width = `${Math.max(2, Math.round(((Number(row.count) || 0) / max) * 100))}%`;
    return el(
      "div",
      { class: "lib-bar" },
      el(
        "div",
        { class: "lib-bar-label" },
        el("span", {}, row.name),
        el("span", { class: "lib-muted" }, String(row.count)),
      ),
      el("div", { class: "lib-bar-track", "aria-hidden": "true" }, fill),
    );
  });
}
export async function stats(params, signal) {
  const year = params.get("year"),
    current = new Date().getFullYear();
  const chosen =
    year && /^20\d{2}$/.test(year) && Number(year) <= current ? year : null;
  const data = await api(chosen ? `stats/me/wrapped/${chosen}` : "stats/me", {
    signal,
  });
  const number = (v) =>
    new Intl.NumberFormat("cs", { maximumFractionDigits: 1 }).format(v);
  const period = (value, label) =>
    el(
      "a",
      {
        href: value ? `#stats?year=${value}` : "#stats",
        "aria-current": String(value || "") === String(chosen || "") ? "page" : null,
      },
      label,
    );
  const kpis = [
    ["watch_hours", translateUI("Hodin sledování")],
    ["completed_titles", translateUI("Zhlédnutých titulů")],
    ["movies", translateUI("Filmů")],
    ["shows", translateUI("Seriálů")],
    ["episodes", translateUI("Epizod")],
    ["longest_streak_days", translateUI("Dní v řadě")],
  ].filter(([key]) => Number.isFinite(data[key]));
  const ranked = [
    ["top_genres", translateUI("Nejčastější žánry")],
    ["top_actors", translateUI("Oblíbení herci")],
  ];
  const summary = [
    Number.isFinite(data.watch_hours)
      ? countLabel(Math.round(data.watch_hours), translateUI("hodina"), translateUI("hodiny"), translateUI("hodin"))
      : null,
    Number.isFinite(data.movies)
      ? countLabel(data.movies, translateUI("film"), translateUI("filmy"), translateUI("filmů"))
      : null,
    Number.isFinite(data.episodes)
      ? countLabel(data.episodes, translateUI("epizoda"), translateUI("epizody"), translateUI("epizod"))
      : null,
  ].filter(Boolean);
  const wrappedYear = chosen || String(current - 1);
  return el(
    "div",
    { class: "page library-page stats-page" },
    el(
      "div",
      { class: "lib-head" },
      el("h1", {}, translateUI("Statistiky sledování")),
      el("span", { class: "lib-spacer" }),
      el(
        "nav",
        { class: "segmented lib-segmented", "aria-label": translateUI("Období statistik") },
        period("", translateUI("Celkem")),
        ...Array.from({ length: 6 }, (_, i) => period(current - i, String(current - i))),
      ),
    ),
    kpis.length
      ? el(
          "div",
          { class: "lib-kpis" },
          kpis.map(([key, label]) =>
            el(
              "div",
              { class: "lib-kpi" },
              el("span", { class: "lib-muted" }, label),
              el("strong", {}, number(data[key])),
            ),
          ),
        )
      : null,
    el(
      "div",
      { class: "lib-split" },
      ranked.map(([key, heading]) =>
        el(
          "section",
          { class: "lib-card", "aria-labelledby": `lib-${key}` },
          el("h2", { id: `lib-${key}` }, heading),
          array(data[key]).length
            ? rankedBars(array(data[key]))
            : el("p", { class: "lib-muted" }, translateUI("Zatím bez dat.")),
        ),
      ),
    ),
    el(
      "section",
      { class: "lib-wrapped", "aria-labelledby": "lib-wrapped-title" },
      el(
        "div",
        {},
        el("span", { class: "lib-eyebrow" }, "Movly Wrapped"),
        el("h2", { id: "lib-wrapped-title" }, translateUI("Tvůj rok {0}", wrappedYear)),
        chosen && summary.length
          ? el("p", {}, summary.join(" · "))
          : el("p", {}, translateUI("Celý rok sledování v jednom přehledu.")),
      ),
      chosen
        ? el("a", { class: "button secondary", href: "#stats" }, translateUI("Celá historie"))
        : el("a", { class: "button accent", href: `#stats?year=${wrappedYear}` }, translateUI("Zobrazit rok {0}", wrappedYear)),
    ),
  );
}

async function titleIsHidden(titleId) {
  for (let offset = 0; offset < 100000; offset += 100) {
    const page = array(
      await api(
        "user/hidden-titles?source=continue_watching&limit=100&offset=" +
          offset,
      ),
    );
    if (page.some((item) => item.title_id === titleId)) return true;
    if (page.length < 100) return false;
  }
  throw new Error(
    translateUI("Historie je příliš rozsáhlá. Zkus stažení znovu později."),
  );
}
export async function hiddenTitles(params, signal, actions) {
  const page = Math.max(1, Math.min(1000, Number(params.get("page")) || 1));
  const data = array(
    await api(
      "user/hidden-titles?source=continue_watching&limit=100&offset=" +
        (page - 1) * 100,
      { signal },
    ),
  );
  const rows = el("ul", { class: "lib-rows" });
  for (const item of data) {
    const details =
      item.title && typeof item.title === "object"
        ? title(item.title)
        : title(await api("titles/" + item.title_id, { signal }));
    rows.append(
      el(
        "li",
        { class: "lib-row" },
        el(
          "button",
          { type: "button", class: "lib-row-main", onClick: () => actions.detail(details) },
          libraryThumb(details.poster_path),
          el(
            "span",
            { class: "lib-row-text" },
            el("strong", {}, details.title),
            el(
              "span",
              { class: "lib-row-sub" },
              [details.year, details.type === "tv" ? translateUI("Seriál") : translateUI("Film")]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
        ),
        button(
          translateUI("Obnovit v rozkoukaných"),
          async (event) => {
            const control = event.currentTarget;
            const row = control.closest(".lib-row");
            control.disabled = true;
            try {
              await api(
                "user/hidden-titles/" +
                  item.title_id +
                  "?source=continue_watching",
                { method: "DELETE" },
              );
              row.remove();
              window.dispatchEvent(new Event("movly:personal-changed"));
            } catch (error) {
              toast(error.message);
              control.disabled = false;
            }
          },
          "secondary small",
        ),
      ),
    );
  }
  return el(
    "div",
    { class: "page library-page" },
    ...libraryHead("hidden"),
    el(
      "p",
      { class: "lib-intro" },
      translateUI("Tituly skryté z řady Pokračovat ve sledování. Obnovením se do ní vrátí."),
    ),
    data.length
      ? el("section", { class: "lib-card" }, rows)
      : empty(
          translateUI("Žádné skryté tituly."),
          translateUI("Skrýt titul můžeš v jeho detailu."),
        ),
    pager(page, data.length === 100, (n) => "#hidden?page=" + n),
  );
}
