import { feedbackAllowed } from "./feedback-access.js";
import { openIntroSettings } from "./intro-skip.js";
import { openNotifications } from "./notifications.js";
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

export function openSettingsMenu({ openProviders }) {
  showDialog(el("div", { class: "dialog-body settings-dialog" },
    el("h2", { id: "dialog-title" }, translateUI("Nastavení")),
    el("nav", { class: "settings-menu", "aria-label": translateUI("Nastavení") },
      entry(translateUI("Přeskakování intra"), translateUI("Nabídka nebo automatické přeskočení"), () => void openIntroSettings()),
      entry(notificationLabel("NotificationsEntry"), translateUI("Kam posílat upozornění a přehled novinek"), () => void openNotifications()),
      entry(translateUI("Úložiště a přehrávání"), translateUI("Webshare, FastShare, doplňky a Trakt / Simkl"), () => void openProviders()),
      entry(translateUI("Premium a mince"), translateUI("Zůstatek mincí a prodloužení Premium"), "#premium"),
      feedbackAllowed() ? entry(translateUI("Vylepšit Movly"), translateUI("Nahlas chybu nebo navrhni funkci"), "#feedback") : null,
    ),
  ));
}
