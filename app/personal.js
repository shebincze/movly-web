import { api, array, title } from "./api.js";
import { setWatched } from "./user-state.js";
import {
  el,
  button,
  showDialog,
  loading,
  errorBox,
  formField,
  toast,
  poster,
  empty,
} from "./ui.js";
export async function titleActivity(t) {
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, t.title),
      loading(),
    ),
  );
  try {
    const mine = await api(`ratings/title/${t.id}/my`);
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
      { type: "submit", class: "button primary" },
      "Uložit hodnocení",
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
            toast("Hodnocení uloženo.");
            await titleActivity(t);
          } catch (e) {
            status.textContent = e.message;
            submit.disabled = false;
          }
        },
      },
      formField("Moje hodnocení (0–10)", value),
      el("label", {}, publish, " Veřejné hodnocení"),
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
        else if (state === "dropped") setWatched(t.id, false);
        toast("Stav sledování uložen.");
      } catch (e) {
        status.textContent = e.message;
      }
    };
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, t.title),
        el("h3", {}, "Stav sledování"),
        el(
          "div",
          { class: "actions" },
          button("Zhlédnuto", () => change("completed")),
          button("Právě sleduji", () => change("watching")),
          button("Přestal/a jsem sledovat", () => change("dropped")),
        ),
        el("h3", {}, "Hodnocení"),
        form,
        mine.has_rated
          ? button(
              "Smazat hodnocení",
              async () => {
                try {
                  await api(`ratings/${mine.rating.id}`, { method: "DELETE" });
                  await titleActivity(t);
                } catch (e) {
                  status.textContent = e.message;
                }
              },
              "small danger",
            )
          : null,
        status,
      ),
    );
  } catch (e) {
    if (dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, t.title),
          errorBox(e, () => titleActivity(t)),
        ),
      );
  }
}
export async function history(params, signal, actions) {
  const page = Math.max(1, Number(params.get("page")) || 1),
    status = params.get("status") === "completed" ? "completed" : "watching";
  const data = await api(
    `watch-history/list?page=${page}&limit=24&status=${status}`,
    { signal },
  );
  const items = array(data.items).map(title);
  return el(
    "div",
    { class: "page" },
    el("h1", {}, "Historie sledování"),
    el(
      "div",
      { class: "actions" },
      el(
        "a",
        {
          class: `button ${status === "watching" ? "primary" : "secondary"}`,
          href: "#history?status=watching",
        },
        "Rozkoukané",
      ),
      el(
        "a",
        {
          class: `button ${status === "completed" ? "primary" : "secondary"}`,
          href: "#history?status=completed",
        },
        "Zhlédnuté",
      ),
    ),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty(
          "Zatím bez titulů",
          "Historie se synchronizuje se stejným profilem v aplikacích.",
        ),
    el(
      "div",
      { class: "actions" },
      page > 1
        ? el(
            "a",
            {
              class: "button secondary",
              href: `#history?status=${status}&page=${page - 1}`,
            },
            "Předchozí",
          )
        : null,
      data.has_more
        ? el(
            "a",
            {
              class: "button secondary",
              href: `#history?status=${status}&page=${page + 1}`,
            },
            "Další",
          )
        : null,
    ),
  );
}
export async function stats(params, signal) {
  const year = params.get("year"),
    current = new Date().getFullYear();
  const chosen =
    year && /^20\d{2}$/.test(year) && Number(year) <= current ? year : null;
  const data = await api(chosen ? `stats/me/wrapped/${chosen}` : "stats/me", {
    signal,
  });
  const select = el(
    "select",
    {
      "aria-label": "Období statistik",
      onChange: (e) => {
        location.hash = e.target.value
          ? `stats?year=${e.target.value}`
          : "stats";
      },
    },
    el("option", { value: "", selected: !chosen }, "Celá historie"),
    ...Array.from({ length: 6 }, (_, i) =>
      el(
        "option",
        { value: current - i, selected: String(current - i) === chosen },
        String(current - i),
      ),
    ),
  );
  return el(
    "div",
    { class: "page" },
    el(
      "div",
      { class: "page-heading" },
      el("h1", {}, chosen ? `Tvůj rok ${chosen}` : "Moje statistiky"),
      select,
    ),
    el(
      "div",
      { class: "stat-grid" },
      [
        ["watch_hours", "Hodin sledování"],
        ["completed_titles", "Zhlédnutých titulů"],
        ["movies", "Filmů"],
        ["shows", "Seriálů"],
        ["episodes", "Epizod"],
        ["longest_streak_days", "Dní v řadě"],
      ]
        .filter(([key]) => Number.isFinite(data[key]))
        .map(([key, label]) =>
          el(
            "div",
            { class: "stat-card" },
            el(
              "strong",
              {},
              new Intl.NumberFormat("cs", { maximumFractionDigits: 1 }).format(
                data[key],
              ),
            ),
            label,
          ),
        ),
    ),
    ...["top_genres", "top_actors"].map((key) =>
      el(
        "section",
        {},
        el(
          "h2",
          {},
          key === "top_genres" ? "Nejčastější žánry" : "Oblíbení herci",
        ),
        ...array(data[key]).map((row) =>
          el(
            "div",
            { class: "share-row" },
            row.name,
            el("strong", {}, String(row.count)),
          ),
        ),
      ),
    ),
  );
}
