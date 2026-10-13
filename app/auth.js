import { translateUI } from "./i18n.js";
import { api } from "./api.js";
import { el, button, formField, showDialog } from "./ui.js";

export function accountForm(mode, onComplete) {
  const register = mode === "register";
  const email = el("input", {
    type: "email",
    required: true,
    autocomplete: "email",
    maxlength: 254,
  });
  const username = el("input", {
    required: true,
    minlength: 3,
    maxlength: 50,
    autocomplete: "username",
  });
  const password = el("input", {
    type: "password",
    minlength: 6,
    maxlength: 1024,
    required: true,
    autocomplete: "new-password",
  });
  const confirmation = el("input", {
    type: "password",
    required: true,
    autocomplete: "new-password",
  });
  const code = el("input", {
    maxlength: 128,
    required: true,
    autocomplete: "one-time-code",
  });
  const status = el("p", { role: "alert", class: "form-status" });
  let stage = "request",
    busy = false;
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    register ? translateUI("Vytvořit účet") : translateUI("Poslat kód"),
  );
  const fields = el(
    "div",
    { class: "dialog-form" },
    ...(register
      ? [formField(translateUI("Uživatelské jméno"), username)]
      : []),
    formField(translateUI("E-mail"), email),
  );
  if (register) {
    // Orientační síla hesla jako v návrhu; server pravidla nemění.
    const bars = el("span", { class: "strength-bars", "aria-hidden": "true" }, el("span"), el("span"), el("span"), el("span"));
    const strengthLabel = el("small", {});
    const strength = el("div", { class: "password-strength", hidden: true }, bars, strengthLabel);
    password.addEventListener("input", () => {
      const v = password.value;
      const score = !v ? 0 : Math.min(4, (v.length >= 6) + (v.length >= 10) + (/[0-9]/.test(v) && /[a-zA-Z]/.test(v)) + (/[^a-zA-Z0-9]/.test(v) || /[A-Z]/.test(v) && /[a-z]/.test(v)));
      strength.hidden = !v;
      strength.dataset.score = String(score);
      strengthLabel.textContent = score <= 1 ? translateUI("Slabé heslo") : score <= 2 ? translateUI("Střední heslo") : translateUI("Silné heslo");
    });
    fields.append(
      formField(translateUI("Heslo"), password),
      strength,
      formField(translateUI("Heslo znovu"), confirmation),
    );
  }
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        submit.disabled = true;
        status.textContent = "";
        status.classList.remove("ok");
        try {
          if (register) {
            if (password.value !== confirmation.value)
              throw new Error(translateUI("Hesla se neshodují."));
            await api("register", {
              method: "POST",
              body: {
                username: username.value,
                email: email.value,
                password: password.value,
              },
            });
            dialog.close();
            onComplete(
              translateUI(
                "Účet byl vytvořen. Můžeš se přihlásit; případné ověření dokonči podle e-mailu.",
              ),
            );
          } else if (stage === "request") {
            await api("password-reset/request", {
              method: "POST",
              body: { email: email.value },
            });
            stage = "confirm";
            email.readOnly = true;
            fields.append(
              formField(translateUI("Kód z e-mailu"), code),
              formField(translateUI("Nové heslo"), password),
              formField(translateUI("Nové heslo znovu"), confirmation),
            );
            submit.textContent = translateUI("Změnit heslo");
            status.textContent = translateUI(
              "Pokud účet existuje, dorazí e-mail s kódem. Zadej ho společně s novým heslem.",
            );
            status.classList.add("ok");
            code.focus();
          } else {
            if (password.value !== confirmation.value)
              throw new Error(translateUI("Hesla se neshodují."));
            const check = await api("password-reset/verify", {
              method: "POST",
              body: { email: email.value, code: code.value },
            });
            if (check.valid !== true)
              throw new Error(
                translateUI("Kód není platný nebo vypršel. Požádej o nový."),
              );
            await api("password-reset/confirm", {
              method: "POST",
              body: {
                email: email.value,
                code: code.value,
                new_password: password.value,
              },
            });
            dialog.close();
            onComplete(
              translateUI("Heslo bylo změněno. Přihlas se novým heslem."),
            );
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          busy = false;
          submit.disabled = false;
        }
      },
    },
    fields,
    status,
    submit,
    ...(!register
      ? [
          button(
            translateUI("Poslat nový kód"),
            async () => {
              if (busy) return;
              busy = true;
              try {
                await api("password-reset/request", {
                  method: "POST",
                  body: { email: email.value },
                });
                status.textContent = translateUI(
                  "Žádost o nový kód byla přijata.",
                );
                status.classList.add("ok");
              } catch (error) {
                status.classList.remove("ok");
                status.textContent = error.message;
              } finally {
                busy = false;
              }
            },
            "small",
          ),
        ]
      : []),
  );
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body narrow" },
      el(
        "h2",
        { id: "dialog-title" },
        register ? translateUI("Vytvořit účet") : translateUI("Obnovit heslo"),
      ),
      register ? null : el("p", {}, translateUI("Pošleme ti kód pro nastavení nového hesla.")),
      form,
    ),
  );
  return dialog;
}
