import "./title-identifiers.js";
import { feedbackAllowed } from "./feedback-access.js";
import { openIntroSettings } from "./intro-skip.js";
import { openNotifications } from "./notifications.js";
import { openHomePreferences } from "./home-preferences.js";
import { notificationLabel } from "./notification-labels.js";
import { translateUI } from "./i18n.js";
import { el, icon, showDialog } from "./ui.js";

// Položka menu: tlačítko (dialog) nebo odkaz (stránka); vždy s popisem a šipkou.
function entry(label, description, action) {
  const body = [
    el("span", { class: "settings-entry-text" }, el("span", { class: "settings-entry-label" }, label), el("span", { class: "settings-entry-note" }, description)),
    el("span", { class: "settings-entry-chevron" }, icon("chevron")),
  ];
  return typeof action === "string"
    ? el("a", { class: "settings-entry", href: action, onClick: () => document.querySelector("#dialog").close() }, ...body)
    : el("button", { type: "button", class: "settings-entry", onClick: action }, ...body);
}

function openAdvancedSettings() {
  const model = window.MovlyTitleIdentifiers, lang = document.documentElement.lang;
  const toggle = el("input", { type: "checkbox", id: "show-title-identifiers", checked: model.enabled() });
  toggle.addEventListener("change", () => {
    if (!model.setEnabled(toggle.checked)) { toggle.checked = model.enabled(); window.alert(model.text("error", lang)); }
  });
  showDialog(el("div", { class: "dialog-body settings-dialog" },
    el("h2", { id: "dialog-title" }, model.text("advanced", lang)),
    el("label", { class: "settings-entry", for: "show-title-identifiers" },
      el("span", { class: "settings-entry-text" }, el("span", { class: "settings-entry-label" }, model.text("title", lang)),
        el("span", { class: "settings-entry-note" }, model.text("note", lang))), toggle)));
}

export function openSettingsMenu({ openProviders }) {
  showDialog(el("div", { class: "dialog-body settings-dialog" },
    el("h2", { id: "dialog-title" }, translateUI("Nastavení")),
    el("nav", { class: "settings-menu", "aria-label": translateUI("Nastavení") },
      entry(window.MovlyHomePreferences.text("pages", document.documentElement.lang), translateUI("Pořadí a zobrazení řad pro tento profil"), openHomePreferences),
      entry(translateUI("Přeskakování intra"), translateUI("Nabídka nebo automatické přeskočení"), () => void openIntroSettings()),
      entry(notificationLabel("NotificationsEntry"), translateUI("Kam posílat upozornění a přehled novinek"), () => void openNotifications()),
      entry(translateUI("Úložiště a přehrávání"), translateUI("Webshare, FastShare, doplňky a Trakt / Simkl"), () => void openProviders()),
      entry(window.MovlyTitleIdentifiers.text("advanced", document.documentElement.lang), window.MovlyTitleIdentifiers.text("note", document.documentElement.lang), openAdvancedSettings),
      entry(translateUI("Premium a mince"), translateUI("Zůstatek mincí a prodloužení Premium"), "#premium"),
      feedbackAllowed() ? entry(translateUI("Vylepšit Movly"), translateUI("Nahlas chybu nebo navrhni funkci"), "#feedback") : null,
    ),
  ));
}
