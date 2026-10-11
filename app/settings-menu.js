import { openNotifications } from "./notifications.js";
import { notificationLabel } from "./notification-labels.js";
import { translateUI } from "./i18n.js";
import { el, button, showDialog } from "./ui.js";

export function openSettingsMenu({ openProviders }) {
  showDialog(el("div", { class: "dialog-body" },
    el("h2", { id: "dialog-title" }, translateUI("Nastavení")),
    el("nav", { class: "settings-menu", "aria-label": translateUI("Nastavení") },
      button(notificationLabel("NotificationsEntry"), () => void openNotifications()),
      button(translateUI("Úložiště a přehrávání"), () => void openProviders()),
    ),
  ));
}
