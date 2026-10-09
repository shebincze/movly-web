import { api } from "./api.js";
import { el, button, loading, errorBox, showDialog, formField, toast } from "./ui.js";
import { translateUI as t } from "./i18n.js";

export const feedbackStatuses = {
  new: "Nové", reviewing: "Prověřujeme / Zvažujeme", planned: "Plánujeme",
  in_progress: "Pracujeme na tom", ready_for_release: "Hotovo, čeká na vydání",
  partially_released: "Částečně vydáno", released: "Vydáno", duplicate: "Duplicitní",
  declined: "Nebudeme realizovat", cannot_reproduce: "Nepodařilo se reprodukovat",
};
const platforms = { ios: "iOS", android: "Android", macos: "macOS", windows: "Windows", tvos: "Apple TV", android_tv: "Android TV", web: "Web", api: "API" };
const terminal = new Set(["released", "duplicate", "declined", "cannot_reproduce"]);
const stamp = (s) => new Date(s).toLocaleString(document.documentElement.lang || "cs");
const state = (s) => el("span", { class: `feedback-state feedback-state-${s}` }, t(feedbackStatuses[s] || s));
const route = (view, id, q = "") => `#feedback?${new URLSearchParams({ view, ...(id ? { id } : {}), ...(q ? { q } : {}) })}`;
const path = (admin, suffix) => `${admin ? "admin/" : ""}feedback/${suffix}`;

// Official Feather icons, vendored with their MIT license; no runtime CDN.
const glyph = (name) => el("img", { class: "feedback-icon", src: `/app/vendor/feedback-icons/${name}.svg`, alt: "", "aria-hidden": "true" });
const platformLine = (item, numbered = true) => el("span", { class: "feedback-platforms" }, numbered ? `#${item.id} · ` : null,
  ...item.platforms.flatMap((p) => [glyph(["ios", "android"].includes(p) ? "smartphone" : ["tvos", "android_tv"].includes(p) ? "tv" : ["macos", "windows"].includes(p) ? "monitor" : "globe"), el("span", {}, platforms[p] || p)]));
function progressTimeline(data) {
  const current = ({ in_progress: 1, ready_for_release: 2, partially_released: 2, released: 3 })[data.item.status] || 0;
  const steps = [["new", "Přijato"], ["in_progress", "Pracujeme na tom"], ["ready_for_release", "Oprava ověřena"], ["released", "Vydání"]];
  return el("ol", { class: "feedback-progress", "aria-label": t("Průběh řešení") }, ...steps.map(([status, label], index) => {
    const date = index === 0 ? data.item.created_at : data.events.findLast((event) => event.status === status)?.created_at;
    return el("li", { class: index <= current ? "complete" : "upcoming" }, el("span", { class: "feedback-step" }, index <= current ? glyph("check") : null),
      el("strong", {}, t(label)), date && index <= current ? el("small", {}, new Date(date).toLocaleDateString(document.documentElement.lang || "cs")) : null);
  }));
}

async function attachmentPicker(item, admin, refresh) {
  const file = el("input", { type: "file", accept: "image/png,image/jpeg" });
  const message = el("p", { role: "alert" });
  const submit = el("button", { type: "submit", class: "button primary" }, t("Přiložit screenshot"));
  let requestId = crypto.randomUUID();
  file.addEventListener("change", () => { requestId = crypto.randomUUID(); });
  showDialog(el("div", { class: "dialog-body" }, el("h2", {}, t("Screenshot")),
    el("p", {}, t("Nejvýše 3 obrázky PNG nebo JPEG, každý do 1 MB. Zkontroluj, že neobsahují osobní údaje.")),
    el("form", { onSubmit: async (e) => {
      e.preventDefault(); const selected = file.files?.[0];
      if (!selected || !["image/png", "image/jpeg"].includes(selected.type) || selected.size > 1048576) { message.textContent = t("Vyber PNG nebo JPEG do 1 MB."); return; }
      submit.disabled = true;
      try {
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(selected); });
        await api(`feedback/items/${item.id}/attachments`, { method: "POST", body: { id: requestId, data } });
        document.querySelector("#dialog").close(); refresh();
      } catch (err) { message.textContent = err.message; submit.disabled = false; }
    } }, file, submit, message)));
}

function chooseFeedbackDialog(initialPlatform) {
  showDialog(el("div", { class: "dialog-body" }, el("h2", {}, t("Nápad nebo chyba")),
    el("p", {}, t("Co chceš týmu Movly poslat?")),
    el("div", { class: "dialog-form" },
      button(t("Přidat nápad"), () => createDialog("idea", "ideas", initialPlatform), "primary", "plus"),
      el("p", {}, t("Navrhni, co by mohlo být v Movly lepší.")),
      button(t("Nahlásit chybu"), () => createDialog("bug", "mine", initialPlatform), "secondary", "plus"),
      el("p", {}, t("Popiš, co nefunguje tak, jak má.")))));
}

function createDialog(kind, view, initialPlatform = "web") {
  let requestId = crypto.randomUUID(), attempted = null;
  const title = el("input", { required: true, minlength: 3, maxlength: 120 });
  const description = el("textarea", { required: true, minlength: 10, maxlength: 5000, rows: 6 });
  const platform = el("select", {}, ...Object.entries(platforms).map(([value, label]) => el("option", { value, selected: value === initialPlatform }, label)));
  const message = el("p", { role: "alert" });
  const submit = el("button", { type: "submit", class: "button primary" }, t("Odeslat"));
  const form = el("form", { class: "dialog-form", onSubmit: async (e) => {
    e.preventDefault(); submit.disabled = true;
    try {
      const input = { kind, title: title.value, description: description.value, platforms: [platform.value], diagnostics: { app_version: "web-v1", os_version: "", screen: "feedback" } };
      const encoded = JSON.stringify(input); if (attempted !== null && attempted !== encoded) requestId = crypto.randomUUID(); attempted = encoded;
      const result = await api("feedback/items", { method: "POST", body: { request_id: requestId, ...input } });
      document.querySelector("#dialog").close(); location.hash = route(kind === "bug" ? "mine" : view, result.item.id);
    } catch (err) { message.textContent = err.message; submit.disabled = false; }
  } }, formField(t("Název"), title), formField(t(kind === "bug" ? "Co se stalo a co jsi očekával/a?" : "Co bys chtěl/a vylepšit a proč?"), description), formField(t("Platforma"), platform),
  el("p", {}, t(kind === "idea" ? "Návrh bude veřejný. Screenshoty a diagnostika zůstávají soukromé." : "Hlášení a odpovědi uvidíš jen ty a tým Movly. Screenshot můžeš přidat po odeslání.")), submit, message);
  showDialog(el("div", { class: "dialog-body" }, el("h2", {}, t(kind === "bug" ? "Nahlásit chybu" : "Přidat nápad")), form));
}

function adminEditor(item, refresh) {
  const deleteAction = button(t("Smazat požadavek"), () => {
    const failure = el("p", { role: "alert" });
    const confirm = el("button", { type: "button", class: "button danger", onClick: async () => {
      confirm.disabled = true;
      try {
        await api(`admin/feedback/items/${item.id}`, { method: "DELETE" });
        document.querySelector("#dialog").close(); location.hash = "#feedback?view=admin";
      } catch (err) { failure.textContent = err.message; confirm.disabled = false; }
    } }, t("Smazat požadavek"));
    showDialog(el("div", { class: "dialog-body" }, el("h2", {}, t("Smazat tento požadavek?")),
      el("strong", {}, `#${item.id} · ${item.title}`),
      el("p", {}, t("Trvale odstraní požadavek, jeho odpovědi, podpory a přílohy. Tuto akci nelze vrátit.")), confirm, failure));
  }, "danger");
  if (item.status === "duplicate") return el("div", {}, deleteAction, el("p", {}, item.duplicate_of ? `${t("Sloučeno s požadavkem")} #${item.duplicate_of}` : t("Duplicitní")));
  const status = el("select", {}, ...Object.entries(feedbackStatuses).filter(([s]) => s !== "duplicate" && (item.kind === "bug" || s !== "cannot_reproduce")).map(([value, label]) => el("option", { value, selected: value === item.status }, t(label))));
  const visible = el("input", { type: "checkbox", checked: item.visible });
  const message = el("textarea", { maxlength: 3000, rows: 3, placeholder: t("Vysvětlení pro uživatele…") });
  const releaseFields = item.platforms.map((p) => ({ platform: p, input: el("input", { maxlength: 60, value: item.releases.find((r) => r.platform === p)?.version || "", placeholder: t("Verze, která je skutečně dostupná") }) }));
  const error = el("p", { role: "alert" });
  const submit = el("button", { class: "button primary", type: "submit" }, t("Uložit stav"));
  let requestId = crypto.randomUUID(), attempted = null;
  const form = el("form", { class: "dialog-form", onSubmit: async (e) => {
    e.preventDefault(); submit.disabled = true;
    const body = { status: status.value, visible: visible.checked, message: message.value, releases: releaseFields.filter((f) => f.input.value.trim()).map((f) => ({ platform: f.platform, version: f.input.value.trim(), released_at: "0001-01-01T00:00:00Z" })) };
    const encoded = JSON.stringify(body); if (attempted !== null && attempted !== encoded) requestId = crypto.randomUUID(); attempted = encoded;
    try { await api(`admin/feedback/items/${item.id}`, { method: "PATCH", body: { ...body, request_id: requestId } }); refresh(); }
    catch (err) { error.textContent = err.message; submit.disabled = false; }
  } }, el("h3", {}, t("Správa požadavku")), formField(t("Stav"), status), item.kind === "idea" ? el("label", {}, visible, t(" Zveřejnit návrh")) : null,
  ...releaseFields.map((f) => formField(platforms[f.platform], f.input)),
  el("p", {}, t("Verzi vyplň pouze u platformy, kde je řešení skutečně vydané. Ostatní ponech prázdné.")), formField(t("Vysvětlení"), message), el("p", {}, t("Zpráva je nepovinná. Pokud ji napíšeš, může mít nejvýše 3 000 znaků.")), submit, error);
  const merge = button(t("Sloučit duplicitu"), () => {
    const target = el("input", { type: "number", min: 1, required: true });
    const reason = el("textarea", { required: true, maxlength: 3000 });
    const err = el("p", { role: "alert" }); const save = el("button", { type: "submit", class: "button primary" }, t("Sloučit")); let mergeId = crypto.randomUUID(), mergeAttempt = null;
    showDialog(el("div", { class: "dialog-body" }, el("h2", {}, t("Sloučit duplicitu")), el("form", { class: "dialog-form", onSubmit: async (e) => {
      e.preventDefault(); save.disabled = true;
      const body = { target_id: Number(target.value), message: reason.value }; const encoded = JSON.stringify(body); if (mergeAttempt !== null && mergeAttempt !== encoded) mergeId = crypto.randomUUID(); mergeAttempt = encoded;
      try { await api(`admin/feedback/items/${item.id}/merge`, { method: "POST", body: { request_id: mergeId, ...body } }); document.querySelector("#dialog").close(); refresh(); }
      catch (e) { err.textContent = e.message; save.disabled = false; }
    } }, formField(t("ID hlavního požadavku"), target), formField(t("Vysvětlení"), reason), save, err)));
  }, "small");
  return el("details", {}, el("summary", {}, t("Správa požadavku")), form, merge, deleteAction);
}

async function detailContent(id, admin, signal, refresh) {
  const data = await api(path(admin, `items/${id}`), { signal }); const item = data.item;
  const error = el("p", { role: "alert" });
  const node = el("article", { class: "feedback-detail" }, el("small", { class: "feedback-updated" }, `${t("Aktualizováno")} ${stamp(item.updated_at)}`), el("h2", {}, item.title), platformLine(item), state(item.status), el("p", { class: "feedback-description" }, item.description));
  if (item.kind === "idea") {
    const vote = button(`${t(item.supported ? "Podpořeno" : "Podpořit")} · ${item.votes}`, async () => {
      vote.disabled = true;
      try { await api(`feedback/items/${id}/vote`, { method: item.supported ? "DELETE" : "PUT" }); refresh(); }
      catch (e) { error.textContent = e.message; vote.disabled = false; }
    }, item.supported ? "primary" : "secondary");
    vote.setAttribute("aria-pressed", String(item.supported)); vote.disabled = !!item.duplicate_of || (!item.supported && terminal.has(item.status)) || !item.visible;
    node.append(vote);
  }
  if (item.duplicate_of) node.append(el("p", {}, t("Sloučeno s požadavkem"), ` #${item.duplicate_of}`, item.kind === "idea" ? el("a", { href: route("ideas", item.duplicate_of) }, t(" Otevřít")) : null));
  if (item.releases.length) node.append(el("h3", {}, t("Dostupnost")), el("ul", {}, ...item.releases.map((r) => el("li", {}, `${platforms[r.platform]} · ${r.version} · ${stamp(r.released_at)}`))));
  if (!["duplicate", "declined", "cannot_reproduce"].includes(item.status)) node.append(el("div", { class: "feedback-resolution" }, el("h3", {}, t("Průběh řešení")), progressTimeline(data)));
  const reply = data.events.findLast((event) => event.team && event.message);
  if (reply) node.append(el("div", { class: "feedback-team-reply" }, el("h3", {}, t("Odpověď týmu Movly")), el("p", { class: "feedback-description" }, reply.message)));
  const eventHistory = el("details", { class: "feedback-history" }, el("summary", {}, t("Celá historie požadavku")), el("ol", { class: "feedback-timeline" }, ...data.events.map((event) => el("li", {}, el("small", {}, `${stamp(event.created_at)} · ${t(event.team ? "Tým Movly" : "Autor")}`), el("div", {}, state(event.status)), event.message ? el("p", { class: "feedback-description" }, event.message) : null))));
  if (item.diagnostics) node.append(el("details", {}, el("summary", {}, t("Přiložená diagnostika")), el("p", {}, Object.values(item.diagnostics).filter(Boolean).join(" · "))));
  if (item.mine || admin) {
    for (const attachment of data.attachments) {
      node.append(button(t("Zobrazit screenshot"), async () => {
        try { const result = await api(path(admin, `attachments/${attachment.id}`), { signal }); showDialog(el("div", { class: "dialog-body" }, el("img", { src: `data:${attachment.media_type};base64,${result.data}`, alt: t("Přiložený screenshot"), class: "feedback-screenshot" }))); }
        catch (e) { error.textContent = e.message; }
      }, "small"));
    }
    const attach = item.mine && data.attachments.length < 3 && !terminal.has(item.status) ? button(t("Přiložit screenshot"), () => attachmentPicker(item, admin, refresh), "small") : null;
    if (item.status !== "duplicate" && ((item.kind === "bug" && item.mine) || admin)) {
      const message = el("textarea", { required: true, maxlength: 3000, rows: 3, placeholder: t("Doplnit informace…") });
      const send = el("button", { type: "submit", class: "button primary" }, t("Odeslat")); let requestId = crypto.randomUUID(), attempted = null;
      node.append(el("form", { class: "dialog-form feedback-reply-form", onSubmit: async (e) => {
        e.preventDefault(); send.disabled = true; if (attempted !== null && attempted !== message.value) requestId = crypto.randomUUID(); attempted = message.value;
        try { await api(path(admin, `items/${id}/messages`), { method: "POST", body: { request_id: requestId, message: message.value } }); refresh(); }
        catch (e) { error.textContent = e.message; send.disabled = false; }
      } }, formField(t(admin ? "Odpověď uživateli" : "Doplnit informace"), message), el("div", { class: "feedback-reply-footer" }, attach, send)));
    } else if (attach) node.append(attach);
  }
  node.append(eventHistory);
  if (admin) node.append(adminEditor(item, refresh)); node.append(error); node.feedbackItem = item; return node;
}

export async function feedback(params, signal) {
  let view = ["ideas", "mine", "admin"].includes(params.get("view")) ? params.get("view") : "ideas";
  let id = params.get("id"), newIntent = ["bug", "choose"].includes(params.get("new")) ? params.get("new") : null; const q = params.get("q") || "";
  const reportPlatform = Object.hasOwn(platforms, params.get("platform")) ? params.get("platform") : "web";
  if (params.has("handoff")) {
    const handoff = await api("feedback/handoffs/consume", { method: "POST", body: { token: params.get("handoff") }, signal });
    view = "mine"; id = handoff.item_id ? String(handoff.item_id) : null; newIntent = id ? null : (newIntent || "bug");
    params.delete("handoff"); params.set("view", view); if (id) params.set("id", id); else params.delete("id");
    if (newIntent) params.set("new", newIntent);
    history.replaceState(null, "", `#feedback?${params}`);
  }
  const admin = view === "admin";
  const query = new URLSearchParams({ limit: "25", offset: params.get("offset") || "0", sort: params.get("sort") || (view === "ideas" ? "votes" : "updated"), q });
  if (view === "ideas") query.set("kind", "idea"); if (view === "mine") query.set("mine", "true");
  if (params.get("status")) query.set("status", params.get("status"));
  const data = await api(path(admin, `items?${query}`), { signal });
  const wrapper = el("section", { class: "page feedback-page", "data-selected": id ? "true" : "false" });
  const tabs = el("nav", { class: "feedback-tabs", "aria-label": t("Zpětná vazba") },
    ...[["ideas", "Nápady"], ["mine", "Moje hlášení"], ...(data.can_manage ? [["admin", "Správa"]] : [])].map(([value, label]) => el("a", { href: route(value), "aria-current": view === value ? "page" : "false" }, t(label))));
  const search = el("input", { type: "search", maxlength: 120, value: q, placeholder: t("Hledat požadavek…"), "aria-label": t("Hledat požadavek") });
  const statusFilter = el("select", { "aria-label": t("Stav") }, el("option", { value: "" }, t("Všechny stavy")), ...Object.entries(feedbackStatuses).map(([value, label]) => el("option", { value, selected: params.get("status") === value }, t(label))));
  const sort = el("select", { "aria-label": t("Řazení") }, ...[["votes", "Nejvíce podpory"], ["new", "Nejnovější"], ["updated", "Poslední změna"]].map(([value, label]) => el("option", { value, selected: query.get("sort") === value }, t(label))));
  const navigateFilters = () => { const next = new URLSearchParams({ view, q: search.value, status: statusFilter.value, sort: sort.value }); location.hash = `#feedback?${next}`; };
  wrapper.append(el("a", { href: "#home", class: "feedback-shell-back" }, glyph("arrow-left"), t("Zpět")));
  const heading = t("Vylepšujeme Movly").split("Movly");
  const actions = el("div", { class: "feedback-create-actions" }, button(t("Přidat nápad"), () => createDialog("idea", "ideas"), "primary", "plus"), button(t("Nahlásit chybu"), () => createDialog("bug", "mine"), "secondary", "plus"));
  wrapper.append(el("div", { class: "feedback-heading" }, el("div", {}, el("h1", {}, heading[0], el("span", {}, "Movly"), heading[1] || ""), el("p", {}, t("Tvoje nápady posouvají Movly dál."))), button(t("Nahlásit chybu"), () => createDialog("bug", "mine"), "primary", "plus")),
    el("div", { class: "feedback-toolbar" }, tabs, actions));
  const filters = el("form", { class: "feedback-filters", onSubmit: (e) => { e.preventDefault(); navigateFilters(); } },
    el("label", { class: "feedback-search" }, glyph("search"), search),
    el("details", { class: "feedback-filter-options" }, el("summary", {}, t("Filtry a řazení")), statusFilter, sort, el("button", { class: "button", type: "submit" }, t("Hledat"))));
  filters.append(el("div", { class: "feedback-mobile-actions" }, button(t("Přidat nápad"), () => createDialog("idea", "ideas"), "primary", "plus"), button(t("Nahlásit chybu"), () => createDialog("bug", "mine"), "secondary", "plus")));
  search.addEventListener("search", navigateFilters);
  const rows = el("div", { class: "feedback-rows" });
  const list = el("div", { class: "feedback-list" }, filters, rows); const detail = el("div", { class: "feedback-detail-host" });
  const replaceRow = (item) => rows.querySelector(`[data-feedback-id="${item.id}"]`)?.replaceWith(makeRow(item));
  const refresh = async () => {
    if (signal.aborted) return; detail.replaceChildren(loading());
    try {
      const content = await detailContent(id, admin, signal, refresh);
      if (!signal.aborted) { detail.replaceChildren(content); content.prepend(el("a", { href: route(view, null, q), class: "feedback-mobile-back" }, t("Zpět na seznam"))); replaceRow(content.feedbackItem); }
    } catch (e) { if (!signal.aborted) detail.replaceChildren(errorBox(e, refresh)); }
  };
  function makeRow(item) {
    const link = el("a", { href: route(view, item.id, q), class: "feedback-row-content" },
      el("strong", {}, item.title), el("span", { class: "feedback-row-description" }, item.description), state(item.status), platformLine(item));
    const row = el("article", { class: "feedback-row", "aria-current": String(item.id) === id ? "true" : "false", "data-feedback-id": String(item.id) }, link);
    if (item.kind === "idea") {
      const vote = el("button", { type: "button", class: `feedback-vote ${item.supported ? "supported" : ""}`, "aria-pressed": String(item.supported), "aria-label": `${t(item.supported ? "Podpořeno" : "Podpořit")} · ${item.votes}`, onClick: async () => {
        vote.disabled = true;
        try {
          const result = await api(`feedback/items/${item.id}/vote`, { method: item.supported ? "DELETE" : "PUT", signal });
          if (!signal.aborted) { replaceRow(result.item); if (String(item.id) === id) await refresh(); }
        } catch (e) { if (!signal.aborted) { toast(e.message); vote.disabled = false; } }
      } }, glyph(item.supported ? "check" : "thumbs-up"), el("span", {}, t(item.supported ? "Podpořeno" : "Podpořit")), el("strong", {}, String(item.votes)));
      vote.disabled = !!item.duplicate_of || !item.visible || (!item.supported && terminal.has(item.status)); row.append(vote);
    } else row.append(el("span", { class: "feedback-row-chevron" }, glyph("chevron-right")));
    return row;
  }
  if (!data.items.length) rows.append(el("div", { class: "feedback-empty" }, glyph("message-square"), el("p", {}, t("Zatím tu nejsou žádné požadavky."))));
  for (const item of data.items) rows.append(makeRow(item));
  if (data.offset > 0) list.append(el("a", { href: `#feedback?${new URLSearchParams({ ...Object.fromEntries(params), offset: String(Math.max(0, data.offset - data.limit)) })}` }, t("Předchozí")));
  if (data.offset + data.limit < data.total) list.append(el("a", { href: `#feedback?${new URLSearchParams({ ...Object.fromEntries(params), offset: String(data.offset + data.limit) })}` }, t("Další")));
  wrapper.append(el("div", { class: "feedback-layout" }, list, detail), el("p", { class: "feedback-hint" }, glyph("info"), t("Stav a odpovědi najdeš v detailu.")));
  if (id && /^[1-9]\d*$/.test(id)) await refresh(); else detail.append(el("p", {}, t("Vyber požadavek a zobraz jeho stav a odpovědi.")));
  if (newIntent && !signal.aborted) {
    // The router mounts the result after this async function returns. Open only
    // once it is mounted, so navigation/abort cannot leave a detached dialog.
    requestAnimationFrame(() => {
      if (signal.aborted || !wrapper.isConnected) return;
      if (newIntent === "choose") chooseFeedbackDialog(reportPlatform);
      else createDialog("bug", "mine", reportPlatform);
      params.delete("new"); params.delete("platform");
      history.replaceState(null, "", `#feedback?${params}`);
    });
  }
  return wrapper;
}
