import { api, array, listTitle, imageURL, title } from "./api.js";
import {
  el,
  button,
  icon,
  loading,
  empty,
  errorBox,
  poster,
  rail,
  formField,
  showDialog,
  toast,
  countLabel,
} from "./ui.js";
import { sources } from "./player.js";
import { titleActivity } from "./personal.js";
import { noteArtwork } from "./user-state.js";
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
    // Karta v seznamu mohla přijít bez plakátu; po zavření detailu ho dostane.
    noteArtwork(data.id, data.poster_path, data.backdrop_path);
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
        data.type !== "tv"
          ? button("Přehrát", () => sources(data), "primary")
          : null,
        button("Do seznamu", () => actions.save(data), "secondary", "plus"),
        button("Sledování a hodnocení", () => titleActivity(data), "secondary"),
      ),
    );
    if (data.tagline)
      body
        .querySelector(".synopsis")
        .before(el("p", { class: "tagline" }, data.tagline));
    const ratings = Array.isArray(data.ratings)
      ? data.ratings
      : t.ratings || [];
    const metadata = el("div", { class: "detail-ratings" });
    for (const r of ratings)
      if (Number.isFinite(r.rating))
        metadata.append(
          el(
            "span",
            { class: "rating-badge" },
            el("strong", {}, `${r.rating}%`),
            r.source,
          ),
        );
    if (
      !ratings.length &&
      Number.isFinite(data.vote_average_tmdb) &&
      data.vote_average_tmdb > 0
    )
      metadata.append(
        el(
          "span",
          { class: "rating-badge" },
          `TMDB ${data.vote_average_tmdb.toFixed(1)}/10`,
        ),
      );
    const streams = data.streams || t.streams;
    if (streams?.video_height)
      metadata.append(
        el("span", { class: "rating-badge" }, `${streams.video_height}p`),
      );
    if (streams?.hdr_type)
      metadata.append(el("span", { class: "rating-badge" }, streams.hdr_type));
    if (streams?.audio_languages?.length)
      metadata.append(
        el(
          "span",
          { class: "rating-badge" },
          streams.audio_languages.join(" · "),
        ),
      );
    body.querySelector(".meta").after(metadata);
    const trailer = (data.videos || [])
      .filter(
        (v) =>
          v.site?.toLowerCase() === "youtube" &&
          /^[a-zA-Z0-9_-]{6,20}$/.test(v.key || ""),
      )
      .sort(
        (a, b) =>
          (b.language === "cs") - (a.language === "cs") ||
          (b.type === "Trailer") - (a.type === "Trailer") ||
          Number(b.official) - Number(a.official),
      )[0];
    if (trailer)
      body.querySelector(".actions").append(
        el(
          "a",
          {
            class: "button secondary",
            href: `https://www.youtube.com/watch?v=${trailer.key}`,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          "Trailer",
        ),
      );
    if (data.original_title && data.original_title !== data.title)
      body.append(
        el("p", { class: "meta" }, `Původní název: ${data.original_title}`),
      );
    const directors = (data.credits || []).filter((c) => c.job === "Director");
    if (directors.length)
      body.append(
        el(
          "p",
          { class: "meta" },
          `Režie: ${directors.map((c) => c.name).join(", ")}`,
        ),
      );
    if (data.collection?.length)
      body.append(
        rail(
          data.collection_info?.name || "Filmová kolekce",
          data.collection.map((c) =>
            title({ ...c, title: c.title || c.original_title }),
          ),
          actions.detail,
        ),
      );
    const cast = (data.credits || [])
      .filter((c) => c.credit_type === "cast" || c.character)
      .slice(0, 30);
    if (cast.length)
      body.append(
        el("h3", {}, "Obsazení"),
        el(
          "div",
          { class: "cast" },
          cast.map((c) =>
            el(
              "button",
              { class: "cast-person", onClick: () => person(c, actions) },
              imageURL(c.profile_path, "w185")
                ? el("img", {
                    src: imageURL(c.profile_path, "w185"),
                    alt: "",
                    loading: "lazy",
                  })
                : el(
                    "span",
                    { class: "person-placeholder" },
                    c.name?.slice(0, 1),
                  ),
              el("strong", {}, c.name || c.person_name),
              el("small", {}, c.character || c.job || ""),
            ),
          ),
        ),
      );
    if (data.type === "tv") {
      const seasons = data.seasons?.some((s) => Array.isArray(s.episodes))
        ? { seasons: data.seasons }
        : await api(`titles/${data.id}/seasons`);
      if (revision !== detailRevision || !dialog.open) return;
      body.append(el("h3", {}, "Řady a epizody"));
      for (const season of array(seasons.seasons)) {
        body.append(
          el(
            "details",
            { class: "season-details" },
            el(
              "summary",
              {},
              `${season.name || `Řada ${season.season_number}`} · ${season.episodes?.length || season.episode_count || 0} epizod`,
            ),
            ...array(season.episodes).map((episode) =>
              el(
                "div",
                { class: "episode-row" },
                imageURL(episode.still_path)
                  ? el("img", {
                      class: "episode-still",
                      src: imageURL(episode.still_path),
                      alt: "",
                      loading: "lazy",
                    })
                  : null,
                el(
                  "div",
                  {},
                  el(
                    "strong",
                    {},
                    `${episode.episode_number}. ${episode.name || "Epizoda"}`,
                  ),
                  episode.overview ? el("p", {}, episode.overview) : null,
                ),
                button(
                  "Přehrát",
                  () =>
                    sources(data, {
                      ...episode,
                      season_number: season.season_number,
                    }),
                  "small",
                ),
                button(
                  "Viděno",
                  async (e) => {
                    const b = e.currentTarget;
                    b.disabled = true;
                    try {
                      await api("watch-history", {
                        method: "POST",
                        body: {
                          title_id: data.id,
                          type: "tv",
                          watch_status: "completed",
                          season_number: season.season_number,
                          episode_number: episode.episode_number,
                        },
                      });
                      b.textContent = "✓ Viděno";
                      toast("Epizoda označena jako zhlédnutá.");
                    } catch (err) {
                      toast(err.message);
                      b.disabled = false;
                    }
                  },
                  "small",
                ),
              ),
            ),
          ),
        );
      }
    }
    let similarData = [];
    try {
      similarData = array(await api(`titles/${data.id}/similar?limit=18`));
    } catch (e) {
      body.append(errorBox(e, () => detail(t, actions)));
    }
    if (revision !== detailRevision || !dialog.open) return;
    const similar = similarData
      .slice(0, 18)
      .filter((x) => Number.isSafeInteger(x.similar_title_id))
      .map((x) => ({
        ...x,
        id: x.similar_title_id,
        title: x.title,
        type: x.type,
        progress: x.watch_progress,
      }));
    if (similar.length)
      body.append(rail("Podobné příběhy", similar, actions.detail));
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
    const memberships = await Promise.all(
      lists.map(async (list) => {
        const items = array(await api(`watchlists/${list.id}`));
        return items.find((item) => item.title_id === t.id)?.id || null;
      }),
    );
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
    for (const [index, list] of lists.entries()) {
      let itemID = memberships[index];
      const choice = button(
        list.name,
        async () => {
          choice.disabled = true;
          status.textContent = "";
          try {
            if (itemID) {
              await api(`watchlists/${list.id}/items/${itemID}`, {
                method: "DELETE",
              });
              itemID = null;
            } else {
              await api(`watchlists/${list.id}/items`, {
                method: "POST",
                body: { title_id: t.id },
              });
              const items = array(await api(`watchlists/${list.id}`));
              itemID = items.find((i) => i.title_id === t.id)?.id;
              if (!itemID)
                throw new Error("API nepotvrdilo členství titulu v seznamu.");
            }
            choice.setAttribute("aria-pressed", String(Boolean(itemID)));
            choice.replaceChildren(icon(itemID ? "check" : "plus"), list.name);
            toast(
              itemID
                ? `Uloženo do „${list.name}“.`
                : `Odebráno z „${list.name}“.`,
            );
          } catch (e) {
            status.textContent = e.message;
          } finally {
            choice.disabled = false;
          }
        },
        "secondary",
        itemID ? "check" : "plus",
      );
      choice.setAttribute("aria-pressed", String(Boolean(itemID)));
      choices.append(choice);
    }
    if (!lists.length)
      content.append(el("p", {}, "Ještě nemáš žádný seznam. Vytvoř si první."));
    content.append(
      choices,
      el(
        "div",
        { class: "actions" },
        button("Vytvořit seznam a přidat", () =>
          editList(null, async (list) => {
            try {
              await api(`watchlists/${list.id}/items`, {
                method: "POST",
                body: { title_id: t.id },
              });
              await save(t, refresh);
            } catch (e) {
              toast(e.message);
            }
          }),
        ),
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
          const created = await api(
            list ? `watchlists/${list.id}` : "watchlists",
            {
              method: list ? "PUT" : "POST",
              body: { name: name.value },
            },
          );
          document.querySelector("#dialog").close();
          toast(list ? "Seznam byl přejmenován." : "Seznam byl vytvořen.");
          done(created);
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
  const [own, shared] = await Promise.all([
    api("watchlists/overview?preview_limit=12", { signal }),
    api("watchlists/shared", { signal }),
  ]);
  const lists = [
    ...array(own.watchlists),
    ...array(shared).map((l) => ({ ...l, id: l.watchlist_id, shared: true })),
  ];
  const id = params.get("id");
  if (id) {
    const list = lists.find((l) => String(l.id) === id);
    if (!list) throw new Error("Seznam neexistuje nebo k němu nemáš přístup.");
    const items = array(
      await api(
        list.shared ? `watchlists/shared/${list.id}` : `watchlists/${list.id}`,
        { signal },
      ),
    );
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
      grid.append(poster(t, actions.detail, list.shared ? null : remove));
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
        !list.shared && !list.is_default
          ? button("Přejmenovat", () => editList(list, actions.refresh))
          : null,
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
          {},
          await Promise.all(
            lists.map(async (list) => {
              let items, failure;
              try {
                items = list.shared
                  ? array(await api(`watchlists/shared/${list.id}`, { signal }))
                  : array(list.preview);
              } catch (e) {
                if (signal.aborted) throw e;
                failure = e;
              }
              const section = rail(
                list.name,
                (items || []).slice(0, 12).map(listTitle),
                actions.detail,
                `#lists?id=${list.id}`,
              );
              section.classList.add("list-section");
              section
                .querySelector(".section-heading")
                .append(
                  el(
                    "div",
                    { class: "actions" },
                    !list.shared
                      ? button("Sdílet", () => shareList(list), "small")
                      : button(
                          "Opustit",
                          () => leaveList(list, actions.refresh),
                          "small danger",
                        ),
                    !list.shared && !list.is_default
                      ? button(
                          "Přejmenovat",
                          () => editList(list, actions.refresh),
                          "small",
                        )
                      : null,
                    !list.shared && !list.is_default
                      ? button(
                          "Smazat",
                          () => confirmDelete(list, actions.refresh),
                          "small danger",
                        )
                      : null,
                  ),
                );
              section
                .querySelector(".section-heading")
                .after(
                  el(
                    "p",
                    { class: "list-meta" },
                    [
                      list.shared
                        ? `Sdílí ${list.owner_display_name || list.owner_username}`
                        : null,
                      countLabel(
                        list.item_count,
                        "položka",
                        "položky",
                        "položek",
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ),
                );
              if (failure) section.append(errorBox(failure, actions.refresh));
              else if (!items.length)
                section.append(
                  el(
                    "p",
                    { class: "list-meta" },
                    "Zatím prázdný seznam. Přidej film nebo seriál z jeho detailu.",
                  ),
                );
              return section;
            }),
          ),
        )
      : empty(
          "Tvůj první seznam čeká",
          "Ulož si filmy na víkend, oblíbené seriály nebo tipy od přátel.",
        ),
  );
}

async function shareList(list) {
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, `Sdílení · ${list.name}`),
      loading(),
    ),
  );
  try {
    const shares = array(await api(`watchlists/${list.id}/shares`));
    const link = await api(`watchlists/${list.id}/public-link`);
    const status = el("p", { class: "form-status", role: "alert" });
    const username = el("input", {
      required: true,
      maxlength: 100,
      placeholder: "Uživatelské jméno",
    });
    const submit = el(
      "button",
      { type: "submit", class: "button primary" },
      "Sdílet s uživatelem",
    );
    const form = el(
      "form",
      {
        class: "dialog-form",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api(`watchlists/${list.id}/shares`, {
              method: "POST",
              body: { username: username.value },
            });
            await shareList(list);
          } catch (e) {
            status.textContent = e.message;
            submit.disabled = false;
          }
        },
      },
      formField("Uživatel Movly", username),
      status,
      submit,
    );
    const publicControls = el(
      "div",
      { class: "dialog-form" },
      el("h3", {}, "Veřejný odkaz"),
      el(
        "p",
        {},
        link.active
          ? "Odkaz je aktivní. Kdokoli s odkazem může seznam zobrazit."
          : "Vytvořením odkazu zpřístupníš seznam každému, kdo odkaz získá.",
      ),
    );
    publicControls.append(
      button(
        link.active ? "Vytvořit nový odkaz" : "Vytvořit veřejný odkaz",
        async (e) => {
          e.currentTarget.disabled = true;
          try {
            const result = await api(`watchlists/${list.id}/public-link`, {
              method: "POST",
              body: {},
            });
            if (!result.url) throw new Error("Server nevrátil veřejný odkaz.");
            publicControls.append(
              el("input", {
                readonly: true,
                value: result.url,
                "aria-label": "Veřejný odkaz",
                onFocus: (e) => e.target.select(),
              }),
            );
          } catch (err) {
            status.textContent = err.message;
            e.currentTarget.disabled = false;
          }
        },
        "secondary",
      ),
    );
    if (link.active)
      publicControls.append(
        button(
          "Zrušit veřejný odkaz",
          async () => {
            try {
              await api(`watchlists/${list.id}/public-link`, {
                method: "DELETE",
              });
              await shareList(list);
            } catch (e) {
              status.textContent = e.message;
            }
          },
          "danger",
        ),
      );
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, `Sdílení · ${list.name}`),
        el(
          "p",
          {},
          "Sdílený seznam se objeví v aplikacích vybraného uživatele.",
        ),
        ...shares.map((user) =>
          el(
            "div",
            { class: "share-row" },
            el("span", {}, user.display_name || user.username),
            button(
              "Odebrat přístup",
              async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await api(`watchlists/${list.id}/shares/${user.user_id}`, {
                    method: "DELETE",
                  });
                  await shareList(list);
                } catch (err) {
                  status.textContent = err.message;
                  e.currentTarget.disabled = false;
                }
              },
              "small danger",
            ),
          ),
        ),
        form,
        publicControls,
      ),
    );
  } catch (e) {
    if (dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, "Sdílení seznamu"),
          errorBox(e, () => shareList(list)),
        ),
      );
  }
}

function leaveList(list, done) {
  const status = el("p", { role: "alert" });
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, `Opustit „${list.name}“?`),
      el("p", {}, "Seznam zmizí z tvého účtu. Vlastníkovi zůstane zachovaný."),
      status,
      button(
        "Opustit seznam",
        async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api(`watchlists/${list.id}/leave`, { method: "DELETE" });
            document.querySelector("#dialog").close();
            done();
          } catch (err) {
            status.textContent = err.message;
            e.currentTarget.disabled = false;
          }
        },
        "danger",
      ),
    ),
  );
}

async function person(credit, actions) {
  if (!Number.isSafeInteger(credit.person_id)) {
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, credit.name),
        el("p", {}, "Profil osoby zatím není dostupný."),
      ),
    );
    return;
  }
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, credit.name),
      loading(),
    ),
  );
  try {
    const [data, filmography] = await Promise.all([
      api(`people/${credit.person_id}`),
      api(`people/${credit.person_id}/filmography`),
    ]);
    if (!dialog.open) return;
    const items = array(filmography);
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, data.name || credit.name),
        imageURL(data.profile_path)
          ? el("img", {
              class: "person-portrait",
              src: imageURL(data.profile_path),
              alt: "",
            })
          : null,
        el("p", {}, data.biography || "Biografie zatím není dostupná."),
        el("h3", {}, "Filmografie"),
        el(
          "div",
          { class: "catalog-grid" },
          items.map((i) =>
            poster(
              title({
                ...i,
                id: i.title_id,
                title: i.title || i.original_title,
              }),
              actions.detail,
            ),
          ),
        ),
      ),
    );
  } catch (e) {
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, credit.name),
        errorBox(e, () => person(credit, actions)),
      ),
    );
  }
}
