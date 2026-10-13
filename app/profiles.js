import { translateUI } from "./i18n.js";
import { api, array } from "./api.js";
import {
  el,
  button,
  avatar,
  formField,
  showDialog,
  loading,
  errorBox,
  toast,
} from "./ui.js";
export async function editProfile(profile, done) {
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body narrow" },
      el(
        "h2",
        { id: "dialog-title" },
        profile ? translateUI("Upravit profil") : translateUI("Nový profil"),
      ),
      loading(),
    ),
  );
  try {
    const avatars = array(await api("profiles/avatars"));
    if (!dialog.open) return;
    let selected = profile?.avatar_url;
    const name = el("input", {
      value: profile?.name || "",
      required: true,
      maxlength: 50,
      autocomplete: "off",
    });
    const pin = el("input", {
      type: "password",
      inputmode: "numeric",
      pattern: "[0-9]{4,8}",
      maxlength: 8,
      autocomplete: "new-password",
      placeholder: profile?.has_pin
        ? translateUI("Prázdné pole ponechá stávající PIN")
        : translateUI("Volitelné, 4 až 8 číslic"),
    });
    const kids = el("input", { type: "checkbox", role: "switch", checked: profile?.is_kids });
    const unrated = el("input", {
      type: "checkbox",
      role: "switch",
      checked: profile?.allow_unrated ?? true,
    });
    const age = { value: [7, 12, 15, 18].includes(profile?.max_certification) ? profile.max_certification : 18 };
    const ages = el(
      "div",
      { class: "pill-group" },
      ...[7, 12, 15, 18].map((n) =>
        el(
          "button",
          {
            type: "button",
            class: "chip",
            "aria-pressed": String(n === age.value),
            onClick: (e) => {
              age.value = n;
              ages.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
            },
          },
          `${n}+`,
        ),
      ),
    );
    const switchRow = (input, title, hint) =>
      el("label", { class: "switch-row" }, el("span", {}, el("strong", {}, title), hint ? el("small", {}, hint) : null), input);
    const status = el("p", { role: "alert", class: "form-status" });
    const grid = el("div", {
      class: "avatar-grid",
      role: "group",
      "aria-label": translateUI("Avatar profilu"),
    });
    for (const a of avatars) {
      const choice = el(
        "button",
        {
          type: "button",
          class: "avatar-choice",
          "aria-label": a.name,
          "aria-pressed": String(a.url === selected),
          onClick: () => {
            selected = a.url;
            grid
              .querySelectorAll("button")
              .forEach((b) => b.setAttribute("aria-pressed", "false"));
            choice.setAttribute("aria-pressed", "true");
          },
        },
        avatar({ name: a.name, avatar_url: a.url }),
      );
      grid.append(choice);
    }
    const submit = el(
      "button",
      { type: "submit", class: "button primary" },
      translateUI("Uložit"),
    );
    const form = el(
      "form",
      {
        class: "dialog-form",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api(profile ? `profiles/${profile.id}` : "profiles", {
              method: profile ? "PUT" : "POST",
              body: {
                name: name.value,
                ...(selected ? { avatar_url: selected } : {}),
                is_kids: kids.checked,
                max_certification: Number(age.value),
                allow_unrated: unrated.checked,
                ...(pin.value ? { pin: pin.value } : {}),
              },
            });
            dialog.close();
            toast(translateUI("Profil uložen."));
            done();
          } catch (err) {
            status.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      formField(translateUI("Jméno profilu"), name),
      el("fieldset", { class: "plain-fieldset" }, el("legend", {}, translateUI("Avatar")), grid),
      el("fieldset", { class: "plain-fieldset" }, el("legend", {}, translateUI("Věkové omezení")), ages),
      switchRow(kids, translateUI("Dětský profil")),
      switchRow(unrated, translateUI("Tituly bez hodnocení"), translateUI("Povolit tituly bez věkového hodnocení")),
      formField(translateUI("PIN profilu"), pin),
      status,
      el("div", { class: "dialog-actions" }, button(translateUI("Zrušit"), () => dialog.close()), submit),
    );
    if (profile && !profile.is_default)
      form.append(
        button(
          translateUI("Smazat profil"),
          () => {
            const confirm = button(
              translateUI("Ano, smazat profil"),
              async () => {
                confirm.disabled = true;
                try {
                  await api(`profiles/${profile.id}`, { method: "DELETE" });
                  dialog.close();
                  done();
                } catch (e) {
                  status.textContent = e.message;
                  confirm.disabled = false;
                }
              },
              "danger",
            );
            form.append(
              el(
                "p",
                {},
                translateUI("Odstranit profil včetně jeho seznamů a historie?"),
              ),
              confirm,
            );
          },
          "danger",
        ),
      );
    showDialog(
      el(
        "div",
        { class: "dialog-body narrow" },
        el(
          "h2",
          { id: "dialog-title" },
          profile ? translateUI("Upravit profil") : translateUI("Nový profil"),
        ),
        form,
      ),
    );
  } catch (e) {
    showDialog(
      el(
        "div",
        { class: "dialog-body narrow" },
        el("h2", { id: "dialog-title" }, translateUI("Profily")),
        errorBox(e, () => editProfile(profile, done)),
      ),
    );
  }
}
