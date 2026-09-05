import { api, array, listTitle, imageURL } from "./api.js";
import {
  el,
  button,
  icon,
  loading,
  empty,
  errorBox,
  poster,
  formField,
  showDialog,
  toast,
  countLabel,
} from "./ui.js";
let detailRevision = 0;
export function invalidateDetail() {
  detailRevision++;
}
export async function detail(t, actions) {
  const revision = ++detailRevision;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, t.title),
      loading(),
    ),
  );
  try {
    const data = await api(`titles/${t.id}`);
    if (revision !== detailRevision || !dialog.open) return;
    if (data.id !== t.id || typeof data.title !== "string")
      throw new Error("API vrátilo neplatný detail titulu.");
    const art = imageURL(data.backdrop_path, "w1280");
    const body = el(
      "div",
      { class: `detail-content${art ? "" : " no-art"}` },
      el("h2", { id: "dialog-title" }, data.title),
      el(
        "p",
        { class: "meta" },
        [
          data.year || data.release_date?.slice(0, 4),
          data.type === "tv" ? "Seriál" : "Film",
          ...(data.genres || []).map((g) => g.name_cs || g.name),
          data.runtime ? `${data.runtime} min` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      el(
        "p",
        { class: "synopsis" },
        data.overview || "Popis tohoto titulu zatím není dostupný.",
      ),
      el(
        "div",
        { class: "actions" },
        button("Do seznamu", () => actions.save(data), "primary", "plus"),
      ),
      el(
        "p",
        { class: "login-note" },
        "Přehrávání ve webu připravujeme. Titul si zatím můžeš uložit do seznamu.",
      ),
    );
    const cast = (data.credits || [])
      .filter((c) => c.credit_type === "cast" || c.character)
      .slice(0, 10);
    if (cast.length)
      body.append(
        el("h3", {}, "Obsazení"),
        el(
          "div",
          { class: "cast" },
          cast.map((c) =>
            el(
              "div",
              {},
              c.name || c.person_name || "",
              c.character ? el("small", {}, c.character) : null,
            ),
          ),
        ),
      );
    if (data.seasons?.length)
      body.append(
        el("h3", {}, "Řady a epizody"),
        ...data.seasons.map((s) =>
          el(
            "div",
            { class: "season-row" },
            el("strong", {}, s.name || `Řada ${s.season_number}`),
            el(
              "span",
              {},
              Number.isInteger(s.episode_count)
                ? countLabel(s.episode_count, "epizoda", "epizody", "epizod")
                : "",
            ),
          ),
        ),
      );
    const similar = (data.similar || [])
      .slice(0, 4)
      .filter((x) => Number.isSafeInteger(x.similar_title_id))
      .map((x) => ({
        ...x,
        id: x.similar_title_id,
        title: x.similar_title_cs || x.similar_title,
      }));
    if (similar.length)
      body.append(
        el("h3", {}, "Podobné příběhy"),
        el(
          "div",
          { class: "catalog-grid" },
          similar.map((x) => poster(x, actions.detail)),
        ),
      );
    showDialog(
      el(
        "div",
        {},
        art
          ? el("img", {
              class: "detail-art",
              src: art,
              alt: "",
              onError: (e) => {
                e.target.remove();
                body.classList.add("no-art");
              },
            })
          : null,
        body,
      ),
    );
  } catch (e) {
    if (revision === detailRevision && dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, t.title),
          errorBox(e, () => detail(t, actions)),
        ),
      );
  }
}
export async function save(t, refresh) {
  const revision = ++detailRevision;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, "Uložit do seznamu"),
      loading(),
    ),
  );
  try {
    const lists = array(await api("watchlists"));
    if (!dialog.open || revision !== detailRevision) return;
    const status = el("p", { class: "form-status", role: "alert" });
    const content = el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, "Uložit do seznamu"),
      el("p", {}, t.title),
      status,
    );
    const choices = el("div", { class: "choice-list" });
    for (const list of lists)
      choices.append(
        button(
          list.name,
          async (e) => {
            const controls = [...choices.querySelectorAll("button")];
            controls.forEach((b) => (b.disabled = true));
            try {
              await api(`watchlists/${list.id}/items`, {
                method: "POST",
                body: { title_id: t.id },
              });
              dialog.close();
              toast(`Uloženo do „${list.name}“.`);
              refresh();
            } catch (err) {
              status.textContent = err.message;
              controls.forEach((b) => (b.disabled = false));
            }
          },
          "secondary",
          "plus",
        ),
      );
    if (!lists.length)
      content.append(el("p", {}, "Ještě nemáš žádný seznam. Vytvoř si první."));
    content.append(
      choices,
      el(
        "div",
        { class: "actions" },
        button("Nový seznam", () => editList(null, () => save(t, refresh))),
      ),
    );
    showDialog(content);
  } catch (e) {
    if (dialog.open && revision === detailRevision)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, "Uložit do seznamu"),
          errorBox(e, () => save(t, refresh)),
        ),
      );
  }
}
export function editList(list, done) {
  invalidateDetail();
  const name = el("input", {
    name: "name",
    required: true,
    maxlength: 100,
    value: list?.name || "",
    placeholder: "Například Na víkend",
    autofocus: true,
  });
  const status = el("p", { class: "form-status", role: "alert" }),
    submit = el(
      "button",
      { type: "submit", class: "button primary" },
      list ? "Uložit změny" : "Vytvořit seznam",
    );
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          await api(list ? `watchlists/${list.id}` : "watchlists", {
            method: list ? "PUT" : "POST",
            body: { name: name.value },
          });
          document.querySelector("#dialog").close();
          toast(list ? "Seznam byl přejmenován." : "Seznam byl vytvořen.");
          done();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField("Název seznamu", name),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el(
        "h2",
        { id: "dialog-title" },
        list ? "Přejmenovat seznam" : "Nový seznam",
      ),
      el(
        "p",
        {},
        "Soukromý seznam dostupný ve tvém profilu na všech zařízeních.",
      ),
      form,
    ),
  );
}
function confirmDelete(list, done) {
  const status = el("p", { class: "form-status", role: "alert" });
  const accept = button(
    "Smazat seznam",
    async () => {
      accept.disabled = true;
      try {
        await api(`watchlists/${list.id}`, { method: "DELETE" });
        document.querySelector("#dialog").close();
        toast("Seznam byl smazán.");
        done();
      } catch (e) {
        status.textContent = e.message;
        accept.disabled = false;
      }
    },
    "danger",
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, `Smazat „${list.name}“?`),
      el(
        "p",
        {},
        "Seznam a jeho položky se odstraní i z ostatních zařízení. Samotné tituly zůstanou v katalogu.",
      ),
      status,
      el(
        "div",
        { class: "actions" },
        button("Ponechat", () => document.querySelector("#dialog").close()),
        accept,
      ),
    ),
  );
}
export async function library(params, signal, actions) {
  const lists = array(await api("watchlists", { signal }));
  const id = params.get("id");
  if (id) {
    const list = lists.find((l) => String(l.id) === id);
    if (!list) throw new Error("Seznam neexistuje nebo k němu nemáš přístup.");
    const items = array(await api(`watchlists/${list.id}`, { signal }));
    const grid = el("div", { class: "catalog-grid" });
    for (const item of items) {
      const t = listTitle(item);
      const remove = el(
        "button",
        {
          class: "remove-item",
          "aria-label": `Odebrat ${t.title}`,
          onClick: async () => {
            remove.disabled = true;
            try {
              await api(`watchlists/${list.id}/items/${item.id}`, {
                method: "DELETE",
              });
              toast("Titul odebrán ze seznamu.");
              actions.refresh();
            } catch (e) {
              toast(e.message);
              remove.disabled = false;
            }
          },
        },
        icon("trash"),
        "Odebrat",
      );
      grid.append(poster(t, actions.detail, remove));
    }
    return el(
      "div",
      { class: "page" },
      el("a", { href: "#lists", class: "text-link" }, "Všechny seznamy"),
      el(
        "div",
        { class: "page-heading" },
        el(
          "div",
          {},
          el("h1", {}, list.name),
          el(
            "p",
            {},
            countLabel(items.length, "položka", "položky", "položek"),
          ),
        ),
        button("Přejmenovat", () => editList(list, actions.refresh)),
      ),
      items.length
        ? grid
        : empty(
            "Tady začíná tvůj další večer",
            "Otevři detail filmu nebo seriálu a přidej ho do tohoto seznamu.",
          ),
    );
  }
  return el(
    "div",
    { class: "page" },
    el(
      "div",
      { class: "page-heading" },
      el(
        "div",
        {},
        el("h1", {}, "Moje seznamy"),
        el("p", {}, "Příběhy, ke kterým se chceš vrátit."),
      ),
      button(
        "Nový seznam",
        () => editList(null, actions.refresh),
        "primary",
        "plus",
      ),
    ),
    lists.length
      ? el(
          "div",
          { class: "list-rows" },
          lists.map((list) =>
            el(
              "article",
              { class: "list-row" },
              el(
                "a",
                { href: `#lists?id=${list.id}`, class: "list-title" },
                el("span", { class: "list-symbol" }, icon("plus")),
                el(
                  "div",
                  {},
                  el("h2", {}, list.name),
                  el(
                    "p",
                    {},
                    Number.isInteger(list.item_count)
                      ? countLabel(
                          list.item_count,
                          "položka",
                          "položky",
                          "položek",
                        )
                      : "",
                  ),
                ),
              ),
              el(
                "div",
                { class: "actions" },
                button(
                  "Přejmenovat",
                  () => editList(list, actions.refresh),
                  "small",
                ),
                !list.is_default
                  ? button(
                      "Smazat",
                      () => confirmDelete(list, actions.refresh),
                      "small danger",
                    )
                  : null,
              ),
            ),
          ),
        )
      : empty(
          "Tvůj první seznam čeká",
          "Ulož si filmy na víkend, oblíbené seriály nebo tipy od přátel.",
        ),
  );
}
