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
      { class: "dialog-body" },
      el(
        "h2",
        { id: "dialog-title" },
        profile ? "Upravit profil" : "Nový profil",
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
        ? "Prázdné pole ponechá stávající PIN"
        : "Volitelné, 4 až 8 číslic",
    });
    const kids = el("input", { type: "checkbox", checked: profile?.is_kids });
    const unrated = el("input", {
      type: "checkbox",
      checked: profile?.allow_unrated ?? true,
    });
    const age = el(
      "select",
      {},
      ...[7, 12, 15, 18].map((n) =>
        el(
          "option",
          { value: n, selected: n === (profile?.max_certification || 18) },
          `${n}+`,
        ),
      ),
    );
    const status = el("p", { role: "alert", class: "form-status" });
    const grid = el("div", {
      class: "avatar-grid",
      role: "group",
      "aria-label": "Avatar profilu",
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
      "Uložit profil",
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
            toast("Profil uložen.");
            done();
          } catch (err) {
            status.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      formField("Jméno", name),
      el("h3", {}, "Avatar"),
      grid,
      formField("PIN", pin),
      el("label", {}, kids, " Dětský profil"),
      formField("Věková hranice", age),
      el("label", {}, unrated, " Povolit tituly bez věkového hodnocení"),
      status,
      submit,
    );
    if (profile && !profile.is_default)
      form.append(
        button(
          "Smazat profil",
          () => {
            const confirm = button(
              "Ano, smazat profil",
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
              el("p", {}, "Odstranit profil včetně jeho seznamů a historie?"),
              confirm,
            );
          },
          "danger",
        ),
      );
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el(
          "h2",
          { id: "dialog-title" },
          profile ? "Upravit profil" : "Nový profil",
        ),
        form,
      ),
    );
  } catch (e) {
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, "Profily"),
        errorBox(e, () => editProfile(profile, done)),
      ),
    );
  }
}
