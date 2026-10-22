import { translateUI } from "./i18n.js";
import { partyJoinForm } from "./party.js";
import { api, array } from "./api.js";
import { el, button, icon, toast, showDialog } from "./ui.js";
import { initialAvatar } from "./personal.js";
function when(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return null;
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  const format = new Intl.RelativeTimeFormat(
    document.documentElement.lang || "cs",
    { numeric: "auto" },
  );
  if (minutes < 60) return format.format(-Math.max(0, minutes), "minute");
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
  if (minutes < 43200) return format.format(-Math.round(minutes / 1440), "day");
  return date.toLocaleDateString(document.documentElement.lang || "cs");
}
function personRow(name, sub, ...controls) {
  return el(
    "li",
    { class: "lib-person" },
    initialAvatar(name),
    el(
      "span",
      { class: "lib-row-text" },
      el("strong", {}, name),
      sub ? el("span", { class: "lib-row-sub" }, sub) : null,
    ),
    ...controls,
  );
}
// Aktivita je doplňková: chyba nesmí shodit správu přátel.
async function activityFeed(signal) {
  let events;
  try {
    events = array(await api("friends/activity?limit=20", { signal }));
  } catch (e) {
    if (signal.aborted) throw e;
    return el("p", { class: "lib-muted" }, translateUI("Aktivitu přátel se nepodařilo načíst."));
  }
  if (!events.length)
    return el(
      "p",
      { class: "lib-muted" },
      translateUI("Přátelé zatím nic nesdíleli. Aktivitu ukazují jen ti, kdo ji mají povolenou."),
    );
  return el(
    "ul",
    { class: "lib-activity" },
    events.map((event) =>
      el(
        "li",
        {},
        initialAvatar(event.username),
        el(
          "span",
          {},
          el("strong", {}, event.username),
          " ",
          event.event_type === "rating" && Number.isFinite(event.rating)
            ? translateUI("ohodnotil(a) {0} ★ {1}", event.title, event.rating.toLocaleString(document.documentElement.lang || "cs"))
            : translateUI("zhlédl(a) {0}", event.title),
          when(event.occurred_at)
            ? el("span", { class: "lib-muted" }, ` · ${when(event.occurred_at)}`)
            : null,
        ),
      ),
    ),
  );
}
export async function friends(_params, signal, actions) {
  const [people, requests, privacy] = await Promise.all([
    api("friends", { signal }),
    api("friends/requests", { signal }),
    api("friends/privacy", { signal }),
  ]);
  const feed = activityFeed(signal);
  const status = el("p", { role: "alert", class: "form-status" });
  const username = el("input", {
    required: true,
    maxlength: 255,
    placeholder: translateUI("Uživatelské jméno"),
    "aria-label": translateUI("Přidat přítele"),
  });
  const submit = el(
    "button",
    { type: "submit", class: "button accent" },
    translateUI("Odeslat žádost"),
  );
  const form = el(
    "form",
    {
      class: "lib-inline-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          await api("friends/requests", {
            method: "POST",
            body: { username: username.value },
          });
          toast(translateUI("Žádost odeslána."));
          actions.refresh();
        } catch (e) {
          status.textContent = e.message;
          submit.disabled = false;
        }
      },
    },
    username,
    submit,
  );
  const mutate = async (path, method) => {
    try {
      await api(path, { method, body: method === "POST" ? {} : undefined });
      actions.refresh();
    } catch (e) {
      status.textContent = e.message;
    }
  };
  const confirmation = (person, block = false) =>
    showDialog(
      el(
        "div",
        { class: "dialog-body lib-dialog" },
        el(
          "h2",
          { id: "dialog-title" },
          `${block ? translateUI("Zablokovat") : translateUI("Odebrat")} ${person.username}?`,
        ),
        el(
          "div",
          { class: "actions" },
          button(translateUI("Ponechat"), () =>
            document.querySelector("#dialog").close(),
          ),
          button(
            translateUI("Potvrdit"),
            async () => {
              document.querySelector("#dialog").close();
              await mutate(
                `friends/${person.user_id}${block ? "/block" : ""}`,
                block ? "POST" : "DELETE",
              );
            },
            "danger",
          ),
        ),
      ),
    );
  const choices = {};
  const privateForm = el("form", {
    class: "lib-privacy",
    onSubmit: async (e) => {
      e.preventDefault();
      const b = e.currentTarget.querySelector("button");
      b.disabled = true;
      try {
        await api("friends/privacy", {
          method: "PUT",
          body: Object.fromEntries(
            Object.entries(choices).map(([k, v]) => [k, v.checked]),
          ),
        });
        toast(translateUI("Soukromí uloženo."));
      } catch (e) {
        status.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    },
  });
  for (const [key, label] of [
    ["activity_opt_in", translateUI("Sdílet aktivitu s přáteli")],
    ["show_completed", translateUI("Ukazovat zhlédnuté tituly")],
    ["show_ratings", translateUI("Ukazovat hodnocení")],
  ]) {
    choices[key] = el("input", {
      type: "checkbox",
      role: "switch",
      checked: privacy[key],
    });
    privateForm.append(
      el("label", { class: "lib-switch" }, el("span", {}, label), choices[key]),
    );
  }
  privateForm.append(
    el(
      "button",
      { type: "submit", class: "button secondary" },
      translateUI("Uložit soukromí"),
    ),
  );
  const incoming = array(requests);
  const friendsList = array(people);
  return el(
    "div",
    { class: "page library-page friends-page" },
    el(
      "div",
      { class: "lib-columns" },
      el(
        "div",
        { class: "lib-column-side" },
        el(
          "section",
          { class: "lib-card", "aria-labelledby": "lib-friends-title" },
          el("h1", { id: "lib-friends-title" }, translateUI("Přátelé")),
          el(
            "p",
            { class: "lib-muted" },
            translateUI(
              "Tvoji přátelé a stejné nastavení soukromí jako v aplikacích.",
            ),
          ),
          form,
          status,
          el(
            "h2",
            { class: "lib-eyebrow" },
            `${translateUI("Žádosti")} · ${incoming.length}`,
          ),
          incoming.length
            ? el(
                "ul",
                { class: "lib-people" },
                incoming.map((p) =>
                  personRow(
                    p.username,
                    p.direction === "incoming"
                      ? translateUI("Chce se s tebou spojit")
                      : translateUI("Čeká na přijetí"),
                    p.direction === "incoming"
                      ? el(
                          "button",
                          {
                            type: "button",
                            class: "lib-icon-button accept",
                            "aria-label": translateUI("Přijmout {0}", p.username),
                            title: translateUI("Přijmout"),
                            onClick: () =>
                              mutate(`friends/requests/${p.id}/accept`, "POST"),
                          },
                          icon("check"),
                        )
                      : null,
                    el(
                      "button",
                      {
                        type: "button",
                        class: "lib-icon-button",
                        "aria-label": translateUI("Zrušit / odmítnout {0}", p.username),
                        title: translateUI("Zrušit / odmítnout"),
                        onClick: () => confirmation(p),
                      },
                      icon("close"),
                    ),
                  ),
                ),
              )
            : el("p", { class: "lib-muted" }, translateUI("Žádné čekající žádosti.")),
          el(
            "h2",
            { class: "lib-eyebrow" },
            `${translateUI("Moji přátelé")} · ${friendsList.length}`,
          ),
          friendsList.length
            ? el(
                "ul",
                { class: "lib-people" },
                friendsList.map((p) =>
                  personRow(
                    p.username,
                    null,
                    el(
                      "div",
                      { class: "lib-actions" },
                      button(translateUI("Odebrat"), () => confirmation(p), "secondary small"),
                      button(
                        translateUI("Blokovat"),
                        () => confirmation(p, true),
                        "small danger",
                      ),
                    ),
                  ),
                ),
              )
            : el(
                "p",
                { class: "lib-muted" },
                translateUI("Zatím tu nikdo není. Pošli žádost podle uživatelského jména."),
              ),
        ),
        el(
          "section",
          { class: "lib-card", "aria-labelledby": "lib-privacy-title" },
          el("h2", { id: "lib-privacy-title" }, translateUI("Soukromí aktivity")),
          privateForm,
        ),
      ),
      el(
        "div",
        { class: "lib-column-main" },
        partyJoinForm(),
        el(
          "section",
          { class: "lib-card", "aria-labelledby": "lib-activity-title" },
          el("h2", { id: "lib-activity-title" }, translateUI("Aktivita přátel")),
          await feed,
        ),
      ),
    ),
  );
}
