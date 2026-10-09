import { translateUI } from "./i18n.js";
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
    const hidden = await titleIsHidden(t.id);
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
            toast(translateUI("Hodnocení uloženo."));
            await titleActivity(t);
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
        else if (state === "dropped") setWatched(t.id, false);
        toast(translateUI("Stav sledování uložen."));
      } catch (e) {
        status.textContent = e.message;
      }
    };
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, t.title),
        el("h3", {}, translateUI("Stav sledování")),
        el(
          "div",
          { class: "actions" },
          button(translateUI("Zhlédnuto"), () => change("completed")),
          button(translateUI("Právě sleduji"), () => change("watching")),
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
                await titleActivity(t);
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
    el("h1", {}, translateUI("Historie sledování")),
    el(
      "div",
      { class: "actions" },
      el(
        "a",
        {
          class: `button ${status === "watching" ? "primary" : "secondary"}`,
          href: "#history?status=watching",
        },
        translateUI("Rozkoukané"),
      ),
      el(
        "a",
        {
          class: `button ${status === "completed" ? "primary" : "secondary"}`,
          href: "#history?status=completed",
        },
        translateUI("Zhlédnuté"),
      ),
    ),
    items.length
      ? el(
          "div",
          { class: "catalog-grid" },
          items.map((t) => poster(t, actions.detail)),
        )
      : empty(
          translateUI("Zatím bez titulů"),
          translateUI(
            "Historie se synchronizuje se stejným profilem v aplikacích.",
          ),
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
            translateUI("Předchozí"),
          )
        : null,
      data.has_more
        ? el(
            "a",
            {
              class: "button secondary",
              href: `#history?status=${status}&page=${page + 1}`,
            },
            translateUI("Další"),
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
      "aria-label": translateUI("Období statistik"),
      onChange: (e) => {
        location.hash = e.target.value
          ? `stats?year=${e.target.value}`
          : "stats";
      },
    },
    el(
      "option",
      { value: "", selected: !chosen },
      translateUI("Celá historie"),
    ),
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
      el(
        "h1",
        {},
        chosen
          ? translateUI("Tvůj rok {0}", chosen)
          : translateUI("Moje statistiky"),
      ),
      select,
    ),
    el(
      "div",
      { class: "stat-grid" },
      [
        ["watch_hours", translateUI("Hodin sledování")],
        ["completed_titles", translateUI("Zhlédnutých titulů")],
        ["movies", translateUI("Filmů")],
        ["shows", translateUI("Seriálů")],
        ["episodes", translateUI("Epizod")],
        ["longest_streak_days", translateUI("Dní v řadě")],
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
          key === "top_genres"
            ? translateUI("Nejčastější žánry")
            : translateUI("Oblíbení herci"),
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
  const node = el(
    "div",
    { class: "page" },
    el("h1", {}, translateUI("Skryté tituly")),
  );
  for (const item of data) {
    const details =
      item.title && typeof item.title === "object"
        ? title(item.title)
        : title(await api("titles/" + item.title_id, { signal }));
    node.append(
      el(
        "div",
        { class: "source-row" },
        button(details.title, () => actions.detail(details)),
        button(translateUI("Obnovit v rozkoukaných"), async (event) => {
          const control = event.currentTarget;
          const row = control.closest(".source-row");
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
        }),
      ),
    );
  }
  if (!data.length)
    node.append(el("p", {}, translateUI("Žádné skryté tituly.")));
  node.append(
    el(
      "div",
      { class: "actions" },
      page > 1
        ? el(
            "a",
            { class: "button secondary", href: "#hidden?page=" + (page - 1) },
            translateUI("Předchozí"),
          )
        : null,
      data.length === 100
        ? el(
            "a",
            { class: "button secondary", href: "#hidden?page=" + (page + 1) },
            translateUI("Další"),
          )
        : null,
    ),
  );
  return node;
}
