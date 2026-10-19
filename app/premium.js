import { el } from "./ui.js";
import { translateUI } from "./i18n.js";

// Keep old bookmarks useful, without fetching plans or offering a purchase.
export async function premium() {
  return el("div", { class: "page" },
    el("h1", {}, translateUI("Movly je zdarma")),
    el("p", {}, translateUI("Funkce Movly nevyžadují placený tarif. Účty a podmínky externích úložišť zůstávají samostatné.")));
}
