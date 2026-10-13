import { translateUI } from "./i18n.js";
import { appendTrackingSettings, serviceCard, servicePill } from "./tracking-settings.js";
import { api } from "./api.js";
import { el, button, showDialog, formField, loading } from "./ui.js";

const providers = ["webshare", "fastshare", "sosac", "stremio"];
const badges = { webshare: "WS", fastshare: "FS", sosac: "SO", stremio: "ST" };

export async function openProviderSettings() {
  const grid = el("div", { class: "service-grid" }, loading());
  const content = el(
    "div",
    { class: "dialog-body connections-dialog" },
    el("h2", { id: "dialog-title" }, translateUI("Úložiště a doplňky")),
    el(
      "p",
      { class: "connections-intro" },
      translateUI(
        "Připojení platí pro tuto webovou relaci. ČT, STVR, Bombuj, Přehraj.to a ČR Wiki se vyhledávají automaticky.",
      ),
    ),
    grid,
  );
  const dialog = showDialog(content);
  const states = await Promise.allSettled(providers.map((name) => api(`providers/${name}`)));
  if (!dialog.open) return;
  grid.replaceChildren();
  for (const [i, name] of providers.entries()) {
    const state = states[i].status === "fulfilled" ? states[i].value : null;
    const label = {
      webshare: "Webshare",
      fastshare: "FastShare",
      sosac: translateUI("Sosáč"),
      stremio: translateUI("Stremio"),
    }[name];
    const linked = !!(state?.connected || state?.addons?.length);
    const status = el("p", { role: "status", class: "service-message" }, state ? "" : states[i].reason.message);
    const card = serviceCard({
      key: name,
      badge: badges[name],
      name: label,
      subtitle: linked
        ? name === "stremio"
          ? state.addons.map((a) => a.name).join(", ")
          : `${state.username}${state.vip ? " · VIP" : ""}`
        : null,
      pill: !state ? servicePill("failed") : servicePill(linked ? "connected" : "disconnected"),
    });
    card.append(status);
    const submit = el(
      "button",
      { type: "submit", class: "button primary" },
      name === "stremio" ? translateUI("Přidat doplněk") : translateUI("Připojit {0}", label),
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
    if (linked)
      card.append(
        el(
          "div",
          { class: "service-actions" },
          button(
            name === "stremio" ? translateUI("Odpojit doplňky") : translateUI("Odpojit {0}", label),
            async () => {
              try {
                await api(`providers/${name}`, { method: "DELETE" });
                await openProviderSettings();
              } catch (e) {
                status.textContent = e.message;
              }
            },
            "secondary small",
          ),
        ),
      );
    if (!state?.connected)
      card.append(
        el(
          "form",
          {
            class: "dialog-form service-form",
            onSubmit: async (event) => {
              event.preventDefault();
              submit.disabled = true;
              status.textContent = translateUI("Ověřuji připojení…");
              try {
                await api(`providers/${name}`, {
                  method: "POST",
                  body: name === "stremio" ? { url: user.value } : { username: user.value, password: password.value },
                });
                password.value = "";
                await openProviderSettings();
              } catch (error) {
                status.textContent = error.message;
                submit.disabled = false;
              }
            },
          },
          formField(name === "stremio" ? translateUI("Adresa manifestu doplňku") : translateUI("Uživatelské jméno"), user),
          name !== "stremio" ? formField(translateUI("Heslo"), password) : null,
          submit,
        ),
      );
    grid.append(card);
  }
  await appendTrackingSettings(content, dialog);
}
