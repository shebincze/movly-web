import { openSettingsMenu } from "./settings-menu.js";
import { startSystemNotifications } from "./notifications.js";
import { translateShell, uiLanguage, setUILanguage } from "./i18n.js";
import { translateUI } from "./i18n.js";
import { premium } from "./premium.js";
import { setPlaybackOwner } from "./playback-memory.js";
import { setSearchOwner } from "./search-history.js";
import { leaveParty } from "./party.js";
import { passwordResetForm } from "./auth.js";
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
// Aplikace se spustila; legacy.js pak nezobrazí hlášku o zastaralém prohlížeči.
window.__movlyStarted = true;
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
document.querySelector(".header").append(languagePicker);
const content = document.querySelector("#content"),
  dialog = document.querySelector("#dialog");
let session = null,
  controller = null,
  renderRevision = 0,
  profileShortcuts = null,
  inboxItems = null,
  inboxRequested = false;
const actions = {
  get owner() { return session?.account?.id && session?.profile?.id ? { accountId: Number(session.account.id), profileId: Number(session.profile.id) } : null; },
  detail: (t) => detail(t, actions),
  save: (t) =>
    save(t, () => {
      if (location.hash.startsWith("#lists")) render();
    }),
  refresh: () => render(),
};
startSystemNotifications(actions);
document.querySelector(".skip-link").addEventListener("click", (e) => {
  e.preventDefault();
  content.focus();
  content.scrollIntoView();
});
document.querySelector("#search-link").prepend(icon("search"));
document.querySelector("#account-button").append(icon("down"));
document.querySelector("#inbox-button").append(icon("bell"));
document.querySelector("#coin-pill").append(icon("coin"), el("span", { id: "coin-count" }));
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
  document.querySelector("#app-settings").textContent=translateUI("Nastavení");
  setSearchOwner(session?.account, session?.profile);
  setPlaybackOwner(session?.account, session?.profile);
  const ready = Boolean(session?.profile);
  document.querySelector("#navigation").hidden = !ready;
  document.querySelector("#header-actions").hidden = !session;
  document.querySelector("#search-link").hidden = !ready;
  document.querySelector("#inbox-button").parentElement.hidden = !ready;
  document.querySelector("#profile-name").textContent =
    session?.profile?.name || translateUI("Vybrat profil");
  const who = session?.profile || { name: session?.account?.displayName };
  for (const id of ["#avatar", "#menu-avatar"])
    document.querySelector(id).replaceChildren(...avatar(who).childNodes);
  document.querySelector("#account-button").setAttribute("aria-label", translateUI("Účet a profily, {0}", who.name || ""));
  const premiumUntil = session?.account?.premiumUntil ? new Date(session.account.premiumUntil) : null,
    premiumActive = premiumUntil && premiumUntil > new Date();
  document.querySelector("#account-name").textContent = [session?.account?.displayName, premiumActive ? "Premium" : null].filter(Boolean).join(" · ");
  document.querySelector("#premium-meta").textContent = premiumActive ? translateUI("do {0}", premiumUntil.toLocaleDateString(uiLanguage() === "en" ? "en-GB" : uiLanguage() === "sk" ? "sk-SK" : "cs-CZ", { day: "numeric", month: "numeric" })) : "";
  const coins = session?.account?.coins, pill = document.querySelector("#coin-pill");
  pill.hidden = !ready || !Number.isSafeInteger(coins);
  if (!pill.hidden) {
    document.querySelector("#coin-count").textContent = coins.toLocaleString("cs-CZ");
    pill.setAttribute("aria-label", translateUI("{0} coinů, Premium", coins));
  }
  (session ? document.querySelector("#account-language") : document.querySelector(".header")).append(languagePicker);
  if (!ready) { profileShortcuts = null; inboxItems = null; inboxRequested = false; }
  else if (!inboxRequested) { inboxRequested = true; loadInbox(); }
  document.querySelector("#admin-link").hidden = !(
    ready && session?.account?.canModerate
  );
}
function login(message = "") {
  session = null;
  document.body.dataset.route = "login";
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
    el(
      "div",
      { class: "login-row" },
      button(
        translateUI("Zapomenuté heslo?"),
        () => passwordResetForm(login),
        "link",
      ),
    ),
    status,
    submit,
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
          translateUI("Jeden účet pro web, mobil, počítač i televizi"),
        ),
      ),
      el(
        "div",
        { class: "login-cards" },
        el(
          "div",
          { class: "login-panel" },
          el("h2", {}, translateUI("Přihlášení")),
          el(
            "p",
            {},
            translateUI("Vítej zpět. Tvoje profily a rozkoukané tituly na tebe čekají."),
          ),
          form,
        ),
        el(
          "a",
          { class: "login-panel login-tv", href: "/activate" },
          el("h2", {}, icon("tv"), translateUI("Přihlásit televizi")),
          el(
            "p",
            {},
            translateUI("Zadej kód zobrazený na televizi a potvrď přihlášení tímto účtem."),
          ),
          el("span", { class: "button accent" }, translateUI("Zadat kód z televize")),
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
  document.body.dataset.route = "profiles";
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
            (() => {
              const face = avatar(p);
              if (p.has_pin)
                face.append(
                  el("span", { class: "profile-lock", role: "img", "aria-label": translateUI("Chráněno PINem") }, icon("lock")),
                );
              return face;
            })(),
            el("strong", {}, p.name),
            p.is_kids
              ? el("small", { class: "kids" }, translateUI("Dětský profil"))
              : null,
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
        el("h1", {}, translateUI("Kdo se dívá?")),
        values.length
          ? null
          : el(
              "p",
              {},
              translateUI(
                "Účet zatím nemá profil. Vytvoř ho v mobilní nebo desktopové aplikaci.",
              ),
            ),
        (choices.append(
          el(
            "div",
            { class: "profile-tile" },
            el(
              "button",
              { class: "profile-choice profile-add", onClick: () => editProfile(null, reloadProfiles) },
              el("span", { class: "avatar" }, icon("plus")),
              el("strong", {}, translateUI("Přidat profil")),
            ),
          ),
        ),
        choices),
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
          profileShortcuts = null;
          inboxItems = null;
          inboxRequested = false;
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
    button(translateUI("Zpět na profily"), () => dialog.close(), "link"),
  );
  if (profile.has_pin) form.classList.add("pin-form");
  showDialog(
    el(
      "div",
      { class: "dialog-body pin-dialog" },
      el(
        "div",
        { class: "pin-head" },
        avatar(profile),
        el(
          "h2",
          { id: "dialog-title" },
          profile.has_pin
            ? translateUI("Zadej PIN profilu {0}", profile.name)
            : profile.name,
        ),
        profile.has_pin
          ? el("p", {}, translateUI("Profil je chráněný PINem."))
          : null,
      ),
      form,
    ),
  );
  if (!profile.has_pin) form.requestSubmit();
}
async function render() {
  if (location.hash === "#offline") {
    document.body.dataset.route = "offline";
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
  document.body.dataset.route = route;
  const navPage = route === "movies" && params.get("view") === "grid" ? "genres" : route;
  document.querySelectorAll("[data-page]").forEach((link) => {
    if (link.dataset.page === navPage) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `Movly — ${translateUI({ home: translateUI("Home"), movies: translateUI("Filmy"), series: translateUI("Seriály"), lists: translateUI("Moje seznamy"), search: translateUI("Hledání"), collection: translateUI("Katalog"), history: translateUI("Historie"), friends: translateUI("Přátelé"), stats: translateUI("Statistiky"), admin: translateUI("Nahlášené streamy") }[route] || { premium: "Premium", hidden: "Skryté tituly", feedback: "Vylepšujeme Movly" }[route])}`;
  content.replaceChildren(loading());
  try {
    const result = await (route === "feedback" ? feedback(params, signal, session.account) : route === "premium"
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
const panels = [
  ["#account-button", "#account-menu"],
  ["#inbox-button", "#inbox-menu"],
];
function closePanels(except) {
  for (const [trigger, panel] of panels)
    if (panel !== except) {
      document.querySelector(panel).hidden = true;
      document.querySelector(trigger).setAttribute("aria-expanded", "false");
    }
}
function togglePanel(trigger, panel) {
  const node = document.querySelector(panel), open = node.hidden;
  closePanels(panel);
  node.hidden = !open;
  document.querySelector(trigger).setAttribute("aria-expanded", String(open));
  return open;
}
// Rychlé přepnutí na jiný profil přímo z menu účtu; PIN řeší chooseProfile.
async function fillProfileShortcuts() {
  const box = document.querySelector("#account-profiles"),
    owner = session?.account?.id;
  if (!session?.profile || profileShortcuts === owner) return;
  profileShortcuts = owner;
  try {
    const others = array(await api("profiles"), "profily").filter(
      (p) => Number.isSafeInteger(p.id) && typeof p.name === "string" && p.id !== session?.profile?.id,
    );
    if (profileShortcuts !== owner) return;
    box.querySelectorAll(".account-profile").forEach((n) => n.remove());
    box.prepend(
      ...others.slice(0, 4).map((p) =>
        el(
          "button",
          {
            class: "account-profile",
            "aria-label": translateUI("Přepnout na profil {0}", p.name),
            title: p.name,
            onClick: () => {
              closePanels();
              chooseProfile(p);
            },
          },
          avatar(p),
        ),
      ),
    );
  } catch {
    profileShortcuts = null;
  }
}
function renderInbox() {
  const menu = document.querySelector("#inbox-menu"),
    unread = (inboxItems || []).filter((item) => !item.read).length,
    bell = document.querySelector("#inbox-button");
  bell.classList.toggle("has-unread", unread > 0);
  bell.setAttribute("aria-label", unread ? translateUI("Upozornění, {0} nová", unread) : translateUI("Upozornění"));
  menu.replaceChildren(
    el("strong", { class: "header-panel-title" }, translateUI("Upozornění")),
    inboxItems === null
      ? loading()
      : inboxItems.length
        ? el(
            "div",
            { class: "inbox-list" },
            inboxItems.map((item) =>
              el(
                "button",
                {
                  class: `inbox-item${item.read ? "" : " unread"}`,
                  onClick: async () => {
                    closePanels();
                    try {
                      if (!item.read) {
                        await api(`notifications/inbox/${item.id}/read`, { method: "PUT", body: {}, expectedOwner: actions.owner });
                        item.read = true;
                        renderInbox();
                      }
                      actions.detail(await api(`titles/${item.title_id}`, { expectedOwner: actions.owner }));
                    } catch (err) {
                      toast(err.message);
                    }
                  },
                },
                el("span", {}, item.message),
                item.season_number > 0 && item.episode_number > 0
                  ? el("small", {}, `S${item.season_number} E${item.episode_number}`)
                  : null,
              ),
            ),
          )
        : el("p", {}, translateUI("Zatím žádná upozornění.")),
    el(
      "button",
      {
        class: "header-panel-link",
        onClick: () => {
          closePanels();
          openSettingsMenu({ openProviders: providerSettings });
        },
      },
      translateUI("Nastavení upozornění"),
    ),
  );
}
async function loadInbox() {
  if (!session?.profile) return;
  const owner = actions.owner;
  try {
    const inbox = await api("notifications/inbox", { expectedOwner: owner });
    if (JSON.stringify(owner) !== JSON.stringify(actions.owner)) return;
    inboxItems = array(inbox.items, "upozornění").filter(
      (item) => Number.isSafeInteger(item.id) && Number.isSafeInteger(item.title_id) && typeof item.message === "string",
    );
  } catch {
    inboxItems = inboxItems || [];
  }
  renderInbox();
}
document.querySelector("#switch-profile").addEventListener("click", profiles);
document.querySelector("#app-settings").addEventListener("click", () => {
  closePanels();
  openSettingsMenu({ openProviders: providerSettings });
});
document.querySelector("#account-button").addEventListener("click", () => {
  if (togglePanel("#account-button", "#account-menu")) fillProfileShortcuts();
});
document.querySelector("#inbox-button").addEventListener("click", () => {
  if (togglePanel("#inbox-button", "#inbox-menu")) {
    renderInbox();
    loadInbox();
  }
});
document.querySelector("#account-menu").addEventListener("click", (e) => {
  if (e.target.closest("a")) closePanels();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".header-popover")) closePanels();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".header-panel:not([hidden])")) {
    const open = panels.find(([, panel]) => !document.querySelector(panel).hidden);
    closePanels();
    document.querySelector(open[0]).focus();
    return;
  }
  // „/“ otevře hledání, pokud uživatel zrovna nepíše do pole.
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || !session?.profile || dialog.open) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  e.preventDefault();
  if (location.hash.split("?")[0] !== "#search") location.hash = "#search";
  else document.querySelector("#content input[type='search'], #content input")?.focus();
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
// Po nákupu Premium obnoví mince a datum v hlavičce.
window.addEventListener("movly-premium-changed", async () => {
  try {
    const fresh = await api("session");
    if (session && fresh.account?.id === session.account?.id) {
      session.account = fresh.account;
      chrome();
    }
  } catch {}
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
