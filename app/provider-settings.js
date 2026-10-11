import { translateUI } from "./i18n.js";
import { appendTrackingSettings } from "./tracking-settings.js";
import { api } from "./api.js";
import { el, button, showDialog, formField, loading } from "./ui.js";
export async function openProviderSettings() {
  const content = el(
    "div",
    { class: "dialog-body" },
    el("h2", { id: "dialog-title" }, translateUI("Úložiště a doplňky")),
    el(
      "p",
      {},
      translateUI(
        "Připojení platí pro tuto webovou relaci. ČT, STVR, Bombuj, Přehraj.to a ČR Wiki se vyhledávají automaticky.",
      ),
    ),
    loading(),
  );
  const dialog = showDialog(content);
  const states = await Promise.allSettled(
    ["webshare", "fastshare", "sosac", "stremio"].map((name) =>
      api(`providers/${name}`),
    ),
  );
  if (!dialog.open) return;
  content.lastChild.remove();
  for (const [i, name] of [
    "webshare",
    "fastshare",
    "sosac",
    "stremio",
  ].entries()) {
    const state = states[i].status === "fulfilled" ? states[i].value : null;
    const label = {
      webshare: "Webshare",
      fastshare: "FastShare",
      sosac: translateUI("Sosáč"),
      stremio: translateUI("Stremio"),
    }[name];
    const status = el(
      "p",
      { role: "status" },
      state ? "" : states[i].reason.message,
    );
    const section = el("section", {}, el("h3", {}, label), status);
    const submit = el(
      "button",
      { type: "submit", class: "button primary" },
      name === "stremio"
        ? translateUI("Přidat doplněk")
        : translateUI("Připojit {0}", label),
    );
    const user = el("input", {
      required: true,
      maxlength: name === "stremio" ? 500 : 120,
      autocomplete: name === "stremio" ? "off" : "username",
    });
    const password = el("input", {
      type: "password",
      required: true,
      maxlength: 256,
      autocomplete: "current-password",
    });
    if (state?.connected || state?.addons?.length) {
      section.append(
        el(
          "p",
          {},
          name === "stremio"
            ? state.addons.map((a) => a.name).join(", ")
            : `${state.username}${state.vip ? " · VIP" : ""}`,
        ),
        button(
          name === "stremio"
            ? translateUI("Odpojit doplňky")
            : translateUI("Odpojit {0}", label),
          async () => {
            try {
              await api(`providers/${name}`, { method: "DELETE" });
              await openProviderSettings();
            } catch (e) {
              status.textContent = e.message;
            }
          },
          "small",
        ),
      );
    }
    if (!state?.connected)
      section.append(
        el(
          "form",
          {
            class: "dialog-form",
            onSubmit: async (event) => {
              event.preventDefault();
              submit.disabled = true;
              status.textContent = translateUI("Ověřuji připojení…");
              try {
                await api(`providers/${name}`, {
                  method: "POST",
                  body:
                    name === "stremio"
                      ? { url: user.value }
                      : { username: user.value, password: password.value },
                });
                password.value = "";
                await openProviderSettings();
              } catch (error) {
                status.textContent = error.message;
                submit.disabled = false;
              }
            },
          },
          formField(
            name === "stremio"
              ? translateUI("Adresa manifestu doplňku")
              : translateUI("Uživatelské jméno"),
            user,
          ),
          name !== "stremio" ? formField(translateUI("Heslo"), password) : null,
          submit,
        ),
      );
    content.append(section);
  }
  await appendTrackingSettings(content, dialog);
}
