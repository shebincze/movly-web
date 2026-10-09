import { translateUI } from "./i18n.js";
import { partyJoinForm } from "./party.js";
import { api, array } from "./api.js";
import { el, button, formField, toast, showDialog, errorBox } from "./ui.js";
export async function friends(_params, signal, actions) {
  const [people, requests, privacy] = await Promise.all([
    api("friends", { signal }),
    api("friends/requests", { signal }),
    api("friends/privacy", { signal }),
  ]);
  const status = el("p", { role: "alert", class: "form-status" });
  const username = el("input", {
    required: true,
    maxlength: 255,
    placeholder: translateUI("Uživatelské jméno"),
  });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Odeslat žádost"),
  );
  const form = el(
    "form",
    {
      class: "dialog-form",
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
    formField(translateUI("Přidat přítele"), username),
    submit,
    status,
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
        { class: "dialog-body" },
        el(
          "h2",
          { id: "dialog-title" },
          `${block ? translateUI("Zablokovat") : translateUI("Odebrat")} ${person.username}?`,
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
    );
  const choices = {};
  const privateForm = el("form", {
    class: "dialog-form",
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
    choices[key] = el("input", { type: "checkbox", checked: privacy[key] });
    privateForm.append(el("label", {}, choices[key], ` ${label}`));
  }
  privateForm.append(
    el(
      "button",
      { type: "submit", class: "button secondary" },
      translateUI("Uložit soukromí"),
    ),
  );
  return el(
    "div",
    { class: "page" },
    el("h1", {}, translateUI("Přátelé")),
    el(
      "p",
      {},
      translateUI(
        "Tvoji přátelé a stejné nastavení soukromí jako v aplikacích.",
      ),
    ),
    partyJoinForm(),
    form,
    el("h2", {}, translateUI("Žádosti")),
    ...array(requests).map((p) =>
      el(
        "div",
        { class: "share-row" },
        el("span", {}, p.username),
        p.direction === "incoming"
          ? button(
              translateUI("Přijmout"),
              () => mutate(`friends/requests/${p.id}/accept`, "POST"),
              "small",
            )
          : el("span", {}, translateUI("Čeká na přijetí")),
        button(
          translateUI("Zrušit / odmítnout"),
          () => confirmation(p),
          "small",
        ),
      ),
    ),
    el("h2", {}, translateUI("Moji přátelé")),
    ...array(people).map((p) =>
      el(
        "div",
        { class: "share-row" },
        el("span", {}, p.username),
        el(
          "div",
          { class: "actions" },
          button(translateUI("Odebrat"), () => confirmation(p), "small"),
          button(
            translateUI("Blokovat"),
            () => confirmation(p, true),
            "small danger",
          ),
        ),
      ),
    ),
    el("h2", {}, translateUI("Soukromí aktivity")),
    privateForm,
  );
}
