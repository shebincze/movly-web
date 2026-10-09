import { translateShell, uiLanguage, setUILanguage } from "./i18n.js";
import { translateUI } from "./i18n.js";
import { premium } from "./premium.js";
import { setSearchOwner } from "./search-history.js";
import { leaveParty } from "./party.js";
import { accountForm } from "./auth.js";
import {
  registerOffline,
  synchronizeOfflineContext,
  offlineLibrary,
  clearLibrary,
  revokeOfflineContext,
} from "./offline.js";
import { api, array } from "./api.js";
import {
  el,
  avatar,
  button,
  icon,
  loading,
  errorBox,
  formField,
  showDialog,
  toast,
} from "./ui.js";
import { resetUserState } from "./user-state.js";
import {
  home,
  catalog,
  search,
  collection,
  resetCatalogCache,
} from "./catalog.js";
import { library, detail, save, invalidateDetail } from "./library.js";
import { editProfile } from "./profiles.js";
import { providerSettings, stop as stopPlayback } from "./player.js";
import { friends } from "./friends.js";
import { history, stats } from "./personal.js";
import { admin } from "./admin.js";
import { feedback } from "./feedback.js";
translateShell(document.body);
const languagePicker = document.createElement("select");
languagePicker.className = "language-picker";
languagePicker.setAttribute("aria-label", translateUI("Jazyk rozhraní"));
for (const [value, label] of [
  ["cs", translateUI("Čeština")],
  ["sk", translateUI("Slovenčina")],
  ["en", "English"],
]) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  languagePicker.append(option);
}
languagePicker.value = uiLanguage();
languagePicker.addEventListener("change", () => {
  setUILanguage(languagePicker.value);
  location.reload();
});
document.querySelector("header").append(languagePicker);
const content = document.querySelector("#content"),
  dialog = document.querySelector("#dialog");
let session = null,
  controller = null,
  renderRevision = 0;
const actions = {
  detail: (t) => detail(t, actions),
  save: (t) =>
    save(t, () => {
      if (location.hash.startsWith("#lists")) render();
    }),
  refresh: () => render(),
};
document.querySelector(".skip-link").addEventListener("click", (e) => {
  e.preventDefault();
  content.focus();
  content.scrollIntoView();
});
document.querySelector("#search-link").append(icon("search"));
document.querySelector("#account-button").append(icon("down"));
dialog.querySelector(".dialog-close").append(icon("close"));
dialog
  .querySelector(".dialog-close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  // A close event may arrive after a follow-up dialog was already opened.
  if (!dialog.open) {
    invalidateDetail();
    stopPlayback();
  }
});
function chrome() {
  setSearchOwner(session?.account, session?.profile);
  const ready = Boolean(session?.profile);
  document.querySelector("#navigation").hidden = !ready;
  document.querySelector("#header-actions").hidden = !session;
  document.querySelector("#search-link").hidden = !ready;
  document.querySelector("#profile-name").textContent =
    session?.profile?.name || translateUI("Vybrat profil");
  document
    .querySelector("#avatar")
    .replaceChildren(
      ...avatar(session?.profile || { name: session?.account?.displayName })
        .childNodes,
    );
  document.querySelector("#account-name").textContent =
    session?.account?.displayName || "";
  document.querySelector("#admin-link").hidden = !(
    ready && session?.account?.canModerate
  );
}
function login(message = "") {
  session = null;
  chrome();
  controller?.abort();
  dialog.close();
  const username = el("input", {
    type: "text",
    name: "username",
    autocomplete: "username",
    required: true,
    maxlength: 254,
    placeholder: translateUI("Uživatelské jméno nebo e-mail"),
  });
  const password = el("input", {
    type: "password",
    name: "password",
    autocomplete: "current-password",
    required: true,
    maxlength: 1024,
    placeholder: translateUI("Tvé heslo"),
  });
  const status = el("p", { class: "form-status", role: "alert" }, message);
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Přihlásit se"),
  );
  const form = el(
    "form",
    {
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          session = await api("login", {
            method: "POST",
            body: { username: username.value, password: password.value },
          });
          password.value = "";
          chrome();
          await profiles();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField(translateUI("Uživatelské jméno nebo e-mail"), username),
    formField(translateUI("Heslo"), password),
    status,
    submit,
    el(
      "div",
      { class: "actions" },
      button(
        translateUI("Vytvořit účet"),
        () => accountForm("register", login),
        "small",
      ),
      button(
        translateUI("Zapomenuté heslo"),
        () => accountForm("reset", login),
        "small",
      ),
    ),
  );
  content.replaceChildren(
    el(
      "section",
      { class: "login" },
      el(
        "div",
        { class: "login-intro" },
        el(
          "h1",
          {},
          translateUI("Tvůj další příběh."),
          el("br"),
          el("span", {}, translateUI("Na jednom místě.")),
        ),
        el(
          "p",
          {},
          translateUI(
            "Objevuj filmy a seriály. Vracej se ke svým oblíbeným. Vytvářej seznamy na každý večer.",
          ),
        ),
      ),
      el(
        "div",
        { class: "login-panel" },
        el("h2", {}, translateUI("Vítej v Movly")),
        el(
          "p",
          {},
          translateUI("Přihlas se stejným účtem, který používáš v aplikaci."),
        ),
        form,
        el(
          "p",
          { class: "login-note" },
          translateUI("Potřebuješ pomoc s účtem? "),
          el("a", { href: "/" }, translateUI("Přejít na hlavní web")),
        ),
      ),
    ),
  );
}
async function reloadProfiles() {
  try {
    session = await api("session");
    chrome();
    await profiles();
  } catch (e) {
    if (e.status === 401) login(e.message);
    else toast(e.message);
  }
}
async function profiles() {
  controller?.abort();
  renderRevision++;
  invalidateDetail();
  dialog.close();
  document.querySelector("#account-menu").hidden = true;
  content.replaceChildren(loading());
  try {
    const values = array(await api("profiles"), "profily");
    const choices = el("div", { class: "profile-grid" });
    for (const p of values) {
      if (!Number.isSafeInteger(p.id) || typeof p.name !== "string")
        throw new Error(translateUI("API vrátilo neplatný profil."));
      choices.append(
        el(
          "div",
          { class: "profile-tile" },
          el(
            "button",
            { class: "profile-choice", onClick: () => chooseProfile(p) },
            avatar(p),
            el("strong", {}, p.name),
            el(
              "small",
              {},
              p.has_pin
                ? translateUI("Chráněno PINem")
                : p.is_kids
                  ? translateUI("Dětský profil")
                  : "",
            ),
          ),
          button(
            translateUI("Upravit"),
            () => editProfile(p, reloadProfiles),
            "small",
          ),
        ),
      );
    }
    content.replaceChildren(
      el(
        "section",
        { class: "profile-page" },
        el("h1", {}, translateUI("Kdo dnes objevuje?")),
        el(
          "p",
          {},
          translateUI("Vyber si svůj profil a pokračuj ve svých příbězích."),
        ),
        values.length
          ? choices
          : el(
              "p",
              {},
              translateUI(
                "Účet zatím nemá profil. Vytvoř ho v mobilní nebo desktopové aplikaci.",
              ),
            ),
        button(
          translateUI("Přidat profil"),
          () => editProfile(null, reloadProfiles),
          "primary",
          "plus",
        ),
        session.profile
          ? button(translateUI("Zpět do katalogu"), () => render())
          : null,
      ),
    );
  } catch (e) {
    if (e.status === 401) login(e.message);
    else
      content.replaceChildren(
        el("div", { class: "page" }, errorBox(e, profiles)),
      );
  }
}
function chooseProfile(profile) {
  const status = el("p", { class: "form-status", role: "alert" });
  const pin = el("input", {
    type: "password",
    inputmode: "numeric",
    pattern: "[0-9]{4,8}",
    minlength: 4,
    maxlength: 8,
    required: true,
    autocomplete: "off",
    autofocus: true,
  });
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    translateUI("Pokračovat"),
  );
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const result = await api("profile", {
            method: "POST",
            body: {
              id: profile.id,
              ...(profile.has_pin ? { pin: pin.value } : {}),
            },
          });
          session.profile = result.profile;
          await synchronizeOfflineContext();
          dialog.close();
          chrome();
          await render();
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
          pin.value = "";
        }
      },
    },
    profile.has_pin
      ? formField(translateUI("PIN profilu"), pin)
      : el("p", {}, translateUI("Pokračovat jako {0}?", profile.name)),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el(
        "h2",
        { id: "dialog-title" },
        profile.has_pin
          ? translateUI("Odemknout {0}", profile.name)
          : profile.name,
      ),
      form,
    ),
  );
  if (!profile.has_pin) form.requestSubmit();
}
async function render() {
  if (location.hash === "#offline") {
    document.title = "Movly — " + translateUI("Offline knihovna");
    document.querySelector("#account-menu").hidden = true;
    document
      .querySelector("#account-button")
      .setAttribute("aria-expanded", "false");
    controller?.abort();
    dialog.close();
    await offlineLibrary(content, () => {
      location.hash = "#home";
      if (!navigator.onLine)
        login(translateUI("Připoj se k internetu pro online aplikaci."));
      else location.reload();
    });
    return;
  }
  if (!session) return;
  if (!session.profile) {
    await profiles();
    return;
  }
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const revision = ++renderRevision;
  dialog.close();
  invalidateDetail();
  chrome();
  const [routeRaw, query = ""] = (location.hash.slice(1) || "home").split("?"),
    route = [
      "home",
      "movies",
      "series",
      "search",
      "lists",
      "collection",
      "history",
      "friends",
      "stats",
      "feedback",
      "premium",
      "hidden",
      ...(session?.account?.canModerate ? ["admin"] : []),
    ].includes(routeRaw)
      ? routeRaw
      : "home",
    params = new URLSearchParams(query);
  document.querySelectorAll("[data-page]").forEach((link) => {
    if (link.dataset.page === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `Movly — ${translateUI({ home: translateUI("Home"), movies: translateUI("Filmy"), series: translateUI("Seriály"), lists: translateUI("Moje seznamy"), search: translateUI("Hledání"), collection: translateUI("Katalog"), history: translateUI("Historie"), friends: translateUI("Přátelé"), stats: translateUI("Statistiky"), admin: translateUI("Nahlášené streamy") }[route] || { premium: "Premium", hidden: "Skryté tituly", feedback: "Vylepšujeme Movly" }[route])}`;
  content.replaceChildren(loading());
  try {
    const result = await (route === "feedback" ? feedback(params, signal) : route === "premium"
      ? premium(signal)
      : route === "hidden"
        ? (await import("./personal.js")).hiddenTitles(params, signal, actions)
        : route === "friends"
          ? friends(params, signal, actions)
          : route === "history"
            ? history(params, signal, actions)
            : route === "stats"
              ? stats(params, signal)
              : route === "home"
                ? home(signal, actions)
                : route === "movies" || route === "series"
                  ? catalog(route, params, signal, actions)
                  : route === "search"
                    ? search(params, signal, actions)
                    : route === "collection"
                      ? collection(params, signal, actions)
                      : route === "admin"
                        ? admin(params, signal, actions)
                        : library(params, signal, actions));
    if (signal.aborted || revision !== renderRevision) return;
    content.replaceChildren(result);
    window.scrollTo(0, 0);
  } catch (e) {
    if (signal.aborted || revision !== renderRevision) return;
    if (e.status === 401) {
      login(translateUI("Přihlášení vypršelo. Přihlas se znovu."));
      return;
    }
    if (
      e.code === "app_profile_required" ||
      /^profile_(?:access_)?grant_(?:required|expired|revoked|invalid)$/.test(
        e.code || "",
      )
    ) {
      session.profile = null;
      await profiles();
      return;
    }
    content.replaceChildren(el("div", { class: "page" }, errorBox(e, render)));
  }
}
document.querySelector("#profile-button").addEventListener("click", profiles);
document.querySelector("#switch-profile").addEventListener("click", profiles);
document
  .querySelector("#provider-settings")
  .addEventListener("click", providerSettings);
document.querySelector("#account-button").addEventListener("click", () => {
  const menu = document.querySelector("#account-menu");
  menu.hidden = !menu.hidden;
  document
    .querySelector("#account-button")
    .setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".header-actions")) {
    document.querySelector("#account-menu").hidden = true;
    document
      .querySelector("#account-button")
      .setAttribute("aria-expanded", "false");
  }
});
document.querySelector("#logout").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    await stopPlayback();
    await leaveParty();
    await api("logout", { method: "POST" });
    resetUserState();
    resetCatalogCache();
    document.querySelector("#account-menu").hidden = true;
    await clearLibrary({ keepHistory: true });
    login();
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (session || location.hash === "#offline") render();
});
window.addEventListener("offline", () =>
  toast(translateUI("Jsi offline. Zkontroluj připojení k internetu.")),
);
window.addEventListener("online", () => {
  if (session?.profile)
    synchronizeOfflineContext().catch((error) => toast(error.message));
});
try {
  registerOffline().catch(() => {});
  session = await api("session");
  if (session.profile) await synchronizeOfflineContext();
  chrome();
  await render();
} catch (e) {
  if (e instanceof TypeError || !navigator.onLine) {
    location.hash = "#offline";
    await offlineLibrary(content, () => location.reload());
  } else if (e.status === 401) {
    await revokeOfflineContext();
    login();
  } else
    content.replaceChildren(
      el(
        "div",
        { class: "page" },
        errorBox(e, () => location.reload()),
      ),
    );
}
