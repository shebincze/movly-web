import { api, array } from "./api.js";
import {
  el,
  button,
  icon,
  loading,
  errorBox,
  formField,
  showDialog,
  toast,
} from "./ui.js";
import { home, catalog, search, collection } from "./catalog.js";
import { library, detail, save, invalidateDetail } from "./library.js";
import { admin } from "./admin.js";
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
  if (!dialog.open) invalidateDetail();
});
function chrome() {
  const ready = Boolean(session?.profile);
  document.querySelector("#navigation").hidden = !ready;
  document.querySelector("#header-actions").hidden = !session;
  document.querySelector("#search-link").hidden = !ready;
  document.querySelector("#profile-name").textContent =
    session?.profile?.name || "Vybrat profil";
  document.querySelector("#avatar").textContent = (
    session?.profile?.name ||
    session?.account?.displayName ||
    "M"
  )
    .slice(0, 1)
    .toUpperCase();
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
    placeholder: "Uživatelské jméno nebo e-mail",
  });
  const password = el("input", {
    type: "password",
    name: "password",
    autocomplete: "current-password",
    required: true,
    maxlength: 1024,
    placeholder: "Tvé heslo",
  });
  const status = el("p", { class: "form-status", role: "alert" }, message);
  const submit = el(
    "button",
    { type: "submit", class: "button primary" },
    "Přihlásit se",
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
    formField("Uživatelské jméno nebo e-mail", username),
    formField("Heslo", password),
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
          "Tvůj další příběh.",
          el("br"),
          el("span", {}, "Na jednom místě."),
        ),
        el(
          "p",
          {},
          "Objevuj filmy a seriály. Vracej se ke svým oblíbeným. Vytvářej seznamy na každý večer.",
        ),
      ),
      el(
        "div",
        { class: "login-panel" },
        el("h2", {}, "Vítej v Movly"),
        el("p", {}, "Přihlas se stejným účtem, který používáš v aplikaci."),
        form,
        el(
          "p",
          { class: "login-note" },
          "Potřebuješ pomoc s účtem? ",
          el("a", { href: "/" }, "Přejít na hlavní web"),
        ),
      ),
    ),
  );
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
        throw new Error("API vrátilo neplatný profil.");
      choices.append(
        el(
          "button",
          { class: "profile-choice", onClick: () => chooseProfile(p) },
          el("span", { class: "avatar" }, p.name.slice(0, 1).toUpperCase()),
          el("strong", {}, p.name),
          el(
            "small",
            {},
            p.has_pin ? "Chráněno PINem" : p.is_kids ? "Dětský profil" : "",
          ),
        ),
      );
    }
    content.replaceChildren(
      el(
        "section",
        { class: "profile-page" },
        el("h1", {}, "Kdo dnes objevuje?"),
        el("p", {}, "Vyber si svůj profil a pokračuj ve svých příbězích."),
        values.length
          ? choices
          : el(
              "p",
              {},
              "Účet zatím nemá profil. Vytvoř ho v mobilní nebo desktopové aplikaci.",
            ),
        session.profile ? button("Zpět do katalogu", () => render()) : null,
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
    "Pokračovat",
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
      ? formField("PIN profilu", pin)
      : el("p", {}, `Pokračovat jako ${profile.name}?`),
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
        profile.has_pin ? `Odemknout ${profile.name}` : profile.name,
      ),
      form,
    ),
  );
  if (!profile.has_pin) form.requestSubmit();
}
async function render() {
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
      ...(session?.account?.canModerate ? ["admin"] : []),
    ].includes(routeRaw)
      ? routeRaw
      : "home",
    params = new URLSearchParams(query);
  document.querySelectorAll("[data-page]").forEach((link) => {
    if (link.dataset.page === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `Movly — ${{ home: "Objevovat", movies: "Filmy", series: "Seriály", lists: "Moje seznamy", search: "Hledání", collection: "Katalog", admin: "Nahlášené streamy" }[route]}`;
  content.replaceChildren(loading());
  try {
    const result = await (route === "home"
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
      login("Přihlášení vypršelo. Přihlas se znovu.");
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
    await api("logout", { method: "POST" });
    document.querySelector("#account-menu").hidden = true;
    login();
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (session) render();
});
window.addEventListener("offline", () =>
  toast("Jsi offline. Zkontroluj připojení k internetu."),
);
try {
  session = await api("session");
  chrome();
  await render();
} catch (e) {
  if (e.status === 401) login();
  else
    content.replaceChildren(
      el(
        "div",
        { class: "page" },
        errorBox(e, () => location.reload()),
      ),
    );
}
