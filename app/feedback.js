import { requireFeedback } from "./feedback-access.js";
import { api } from "./api.js";
import { el, button, icon, loading, errorBox, showDialog, formField, toast } from "./ui.js";
import { translateUI as t } from "./i18n.js";

export const feedbackStatuses = {
  new: "Nové", reviewing: "Prověřujeme / Zvažujeme", planned: "Plánujeme",
  in_progress: "Pracujeme na tom", ready_for_release: "Hotovo, čeká na vydání",
  partially_released: "Částečně vydáno", released: "Vydáno", duplicate: "Duplicitní",
  declined: "Nebudeme realizovat", cannot_reproduce: "Nepodařilo se reprodukovat",
};
const platforms = { ios: "iOS", android: "Android", macos: "macOS", windows: "Windows", tvos: "Apple TV", android_tv: "Android TV", web: "Web", api: "API" };
let diagnosticDraft = null;
let diagnosticOwner = null;
window.addEventListener("movly-offline-revoked", () => { diagnosticDraft = null; diagnosticOwner = null; });
const diagnosticLabels = {app_version:"Verze aplikace", os_version:"Systém", device:"Zařízení", provider:"Provider", occurred_at:"Čas chyby", stage:"Fáze", error_code:"Technická chyba", http_status:"HTTP"};
function diagnosticPreview(d) {
  return el("details", { open: true, class: "fb-diagnostics" }, el("summary", {}, t("Přiložená diagnostika")),
    ...Object.entries(diagnosticLabels).filter(([key]) => d[key]).map(([key,label]) => el("p", {}, `${t(label)}: ${d[key]}`)),
    ...(d.log || []).map(event => el("p", {}, `${event.at} · ${event.stage} · ${event.code}${event.http_status ? ` · HTTP ${event.http_status}` : ""}`)),
    el("p", {}, t("Přiložíme pouze technické kódy. Bez hesel, tokenů a odkazů na video.")));
}
const terminal = new Set(["released", "duplicate", "declined", "cannot_reproduce"]);
const stamp = (s) => new Date(s).toLocaleString(document.documentElement.lang || "cs");
const state = (s) => el("span", { class: `fb-state fb-state-${s}` }, t(feedbackStatuses[s] || s));
const route = (view, id, q = "") => `#feedback?${new URLSearchParams({ view, ...(id ? { id } : {}), ...(q ? { q } : {}) })}`;
const path = (admin, suffix) => `${admin ? "admin/" : ""}feedback/${suffix}`;
const votesLabel = (n) => n === 1 ? t("1 hlas") : n >= 2 && n <= 4 ? t("{0} hlasy", n) : t("{0} hlasů", n);

// Official Feather icons, vendored with their MIT license; no runtime CDN.
const glyph = (name) => el("img", { class: "fb-icon", src: `/app/vendor/feedback-icons/${name}.svg`, alt: "", "aria-hidden": "true" });
const platformLine = (item, numbered = true) => el("span", { class: "fb-platforms" }, numbered ? `#${item.id} · ` : null,
  ...item.platforms.flatMap((p) => [glyph(["ios", "android"].includes(p) ? "smartphone" : ["tvos", "android_tv"].includes(p) ? "tv" : ["macos", "windows"].includes(p) ? "monitor" : "globe"), el("span", {}, platforms[p] || p)]));
function progressTimeline(data) {
  const current = ({ in_progress: 1, ready_for_release: 2, partially_released: 2, released: 3 })[data.item.status] || 0;
  const steps = [["new", "Přijato"], ["in_progress", "Pracujeme na tom"], ["ready_for_release", "Oprava ověřena"], ["released", "Vydání"]];
  return el("ol", { class: "fb-progress", "aria-label": t("Průběh řešení") }, ...steps.map(([status, label], index) => {
    const date = index === 0 ? data.item.created_at : data.events.findLast((event) => event.status === status)?.created_at;
    return el("li", { class: index <= current ? "complete" : "upcoming" }, el("span", { class: "fb-step" }, index <= current ? glyph("check") : null),
      el("strong", {}, t(label)), date && index <= current ? el("small", {}, new Date(date).toLocaleDateString(document.documentElement.lang || "cs")) : null);
  }));
}

async function attachmentPicker(item, admin, refresh) {
  const file = el("input", { type: "file", accept: "image/png,image/jpeg" });
  const message = el("p", { role: "alert" });
  const submit = el("button", { type: "submit", class: "button primary" }, t("Přiložit screenshot"));
  let requestId = crypto.randomUUID();
  file.addEventListener("change", () => { requestId = crypto.randomUUID(); });
  showDialog(el("div", { class: "dialog-body fb-dialog" }, el("h2", { id: "dialog-title" }, t("Screenshot")),
    el("p", {}, t("Nejvýše 3 obrázky PNG nebo JPEG, každý do 1 MB. Zkontroluj, že neobsahují osobní údaje.")),
    el("form", { class: "dialog-form", onSubmit: async (e) => {
      e.preventDefault(); const selected = file.files?.[0];
      if (!selected || !["image/png", "image/jpeg"].includes(selected.type) || selected.size > 1048576) { message.textContent = t("Vyber PNG nebo JPEG do 1 MB."); return; }
      submit.disabled = true;
      try {
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(selected); });
        await api(`feedback/items/${item.id}/attachments`, { method: "POST", body: { id: requestId, data } });
        document.querySelector("#dialog").close(); refresh();
      } catch (err) { message.textContent = err.message; submit.disabled = false; }
    } }, el("label", { class: "fb-file" }, file), submit, message)));
}

function chooseFeedbackDialog(initialPlatform, diagnostics = null) {
  showDialog(el("div", { class: "dialog-body fb-dialog" }, el("h2", { id: "dialog-title" }, t("Nápad nebo chyba")),
    el("p", {}, t("Co chceš týmu Movly poslat?")),
    el("div", { class: "fb-choice" },
      el("div", {}, button(t("Přidat nápad"), () => createDialog("idea", "ideas", initialPlatform), "primary", "plus"), el("p", {}, t("Navrhni, co by mohlo být v Movly lepší."))),
      el("div", {}, button(t("Nahlásit chybu"), () => createDialog("bug", "mine", initialPlatform, diagnostics), "secondary", "plus"), el("p", {}, t("Popiš, co nefunguje tak, jak má."))))));
}

// Formulář nového příspěvku; inline varianta má přepínač typu a podobné návrhy.
function feedbackForm({ kind, view, initialPlatform = "web", diagnostics = null, inline = false, signal = null, onSent = () => {} }) {
  let requestId = crypto.randomUUID(), attempted = null;
  const title = el("input", { required: true, minlength: 3, maxlength: 120, value: diagnostics ? `${diagnostics.provider || "Movly"}: ${diagnostics.stage || "chyba"}` : "" });
  const description = el("textarea", { required: true, minlength: 10, maxlength: 5000, rows: 5 });
  const generalPlatform = el("option", { value: "" }, t("Obecný návrh (bez platformy)"));
  const platform = el("select", {}, generalPlatform, ...Object.entries(platforms).map(([value, label]) => el("option", { value, selected: value === initialPlatform }, label)));
  const message = el("p", { role: "alert", class: "fb-form-error" });
  const submit = el("button", { type: "submit", class: "button primary" });
  const descriptionField = formField("", description);
  const note = el("p", { class: "fb-form-note" });
  const similar = el("div", { class: "fb-similar", hidden: true });
  const types = [["bug", "Nahlásit chybu"], ["idea", "Navrhnout funkci"]].map(([value, label]) => el("button", { type: "button", role: "radio", class: "fb-segment", "data-kind": value, onClick: () => setKind(value) }, t(label)));
  const typeGroup = inline ? el("div", { role: "radiogroup", class: "fb-segmented", "aria-label": t("Typ příspěvku"), onKeydown: (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault(); setKind(kind === "bug" ? "idea" : "bug"); types.find((b) => b.dataset.kind === kind).focus();
  } }, ...types) : null;
  function setKind(next) {
    kind = next;
    generalPlatform.hidden = generalPlatform.disabled = kind !== "idea";
    platform.required = kind === "bug";
    if (kind === "bug" && !platform.value) platform.value = Object.hasOwn(platforms, initialPlatform) ? initialPlatform : "web";
    for (const b of types) { const on = b.dataset.kind === kind; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    descriptionField.querySelector("span").textContent = t(kind === "bug" ? "Co se stalo a co jsi očekával/a?" : "Co bys chtěl/a vylepšit a proč?");
    note.textContent = t(kind === "idea" ? "Návrh bude veřejný. Screenshoty a diagnostika zůstávají soukromé." : "Hlášení a odpovědi uvidíš jen ty a tým Movly. Screenshot můžeš přidat po odeslání.");
    submit.textContent = t(kind === "bug" ? "Odeslat hlášení" : "Odeslat návrh");
    if (kind !== "idea") similar.hidden = true; else findSimilar();
  }
  let similarTimer, similarRequest;
  function findSimilar() {
    clearTimeout(similarTimer); similarRequest?.abort();
    const q = title.value.trim();
    if (!inline || kind !== "idea" || q.length < 3) { similar.hidden = true; return; }
    similarTimer = setTimeout(async () => {
      const request = similarRequest = new AbortController();
      signal?.addEventListener("abort", () => request.abort(), { once: true });
      try {
        const data = await api(`feedback/items?${new URLSearchParams({ kind: "idea", q, sort: "votes", limit: "3", offset: "0" })}`, { signal: request.signal });
        if (request.signal.aborted || kind !== "idea") return;
        similar.replaceChildren(el("strong", {}, t("Podobné návrhy")), ...data.items.map((item) => el("a", { href: route("ideas", item.id) }, `${item.title} · ${votesLabel(item.votes)}`)));
        similar.hidden = !data.items.length;
      } catch { /* Podobné návrhy jsou jen nápověda; chyba nic neblokuje. */ }
    }, 400);
  }
  if (inline) title.addEventListener("input", findSimilar);
  const form = el("form", { class: "dialog-form fb-form", onSubmit: async (e) => {
    e.preventDefault(); submit.disabled = true; message.textContent = "";
    try {
      const input = { kind, title: title.value, description: description.value, platforms: platform.value ? [platform.value] : [], diagnostics: diagnostics || { app_version: "web-v1", os_version: "", screen: "feedback" } };
      const encoded = JSON.stringify(input); if (attempted !== null && attempted !== encoded) requestId = crypto.randomUUID(); attempted = encoded;
      const result = await api("feedback/items", { method: "POST", body: { request_id: requestId, ...input } });
      diagnosticDraft = null;
      onSent(); toast(`${t("Hlášení přijato")} #${result.item.id}`); location.hash = route(kind === "bug" ? "mine" : view, result.item.id);
    } catch (err) { message.textContent = err.message; submit.disabled = false; }
  } }, typeGroup, formField(t("Název"), title), similar, descriptionField, formField(t("Platforma"), platform),
  diagnostics ? diagnosticPreview(diagnostics) : null, note, submit, message);
  setKind(kind);
  form.titleInput = title;
  return form;
}

export function createDialog(kind, view, initialPlatform = "web", diagnostics = null) {
  requireFeedback();
  const form = feedbackForm({ kind, view, initialPlatform, diagnostics, onSent: () => document.querySelector("#dialog").close() });
  const dialog = showDialog(el("div", { class: "dialog-body fb-dialog" }, el("h2", { id: "dialog-title" }, t(kind === "bug" ? "Nahlásit chybu" : "Přidat nápad")), form));
  const revoke = () => dialog.close();
  window.addEventListener("movly-offline-revoked", revoke, { once: true });
  window.addEventListener("movly-feedback-revoked", revoke, { once: true });
  dialog.addEventListener("close", () => { window.removeEventListener("movly-offline-revoked", revoke); window.removeEventListener("movly-feedback-revoked", revoke); }, { once: true });
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
    showDialog(el("div", { class: "dialog-body fb-dialog" }, el("h2", { id: "dialog-title" }, t("Smazat tento požadavek?")),
      el("strong", {}, `#${item.id} · ${item.title}`),
      el("p", {}, t("Trvale odstraní požadavek, jeho odpovědi, podpory a přílohy. Tuto akci nelze vrátit.")), confirm, failure));
  }, "danger small");
  if (item.status === "duplicate") return el("div", { class: "fb-admin" }, deleteAction, el("p", {}, item.duplicate_of ? `${t("Sloučeno s požadavkem")} #${item.duplicate_of}` : t("Duplicitní")));
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
  } }, el("h3", {}, t("Správa požadavku")), formField(t("Stav"), status), item.kind === "idea" ? el("label", { class: "fb-check" }, visible, t(" Zveřejnit návrh")) : null,
  ...releaseFields.map((f) => formField(platforms[f.platform], f.input)),
  el("p", { class: "fb-form-note" }, t("Verzi vyplň pouze u platformy, kde je řešení skutečně vydané. Ostatní ponech prázdné.")), formField(t("Vysvětlení"), message), el("p", { class: "fb-form-note" }, t("Zpráva je nepovinná. Pokud ji napíšeš, může mít nejvýše 3 000 znaků.")), submit, error);
  const merge = button(t("Sloučit duplicitu"), () => {
    const target = el("input", { type: "number", min: 1, required: true });
    const reason = el("textarea", { required: true, maxlength: 3000 });
    const err = el("p", { role: "alert" }); const save = el("button", { type: "submit", class: "button primary" }, t("Sloučit")); let mergeId = crypto.randomUUID(), mergeAttempt = null;
    showDialog(el("div", { class: "dialog-body fb-dialog" }, el("h2", { id: "dialog-title" }, t("Sloučit duplicitu")), el("form", { class: "dialog-form", onSubmit: async (e) => {
      e.preventDefault(); save.disabled = true;
      const body = { target_id: Number(target.value), message: reason.value }; const encoded = JSON.stringify(body); if (mergeAttempt !== null && mergeAttempt !== encoded) mergeId = crypto.randomUUID(); mergeAttempt = encoded;
      try { await api(`admin/feedback/items/${item.id}/merge`, { method: "POST", body: { request_id: mergeId, ...body } }); document.querySelector("#dialog").close(); refresh(); }
      catch (e) { err.textContent = e.message; save.disabled = false; }
    } }, formField(t("ID hlavního požadavku"), target), formField(t("Vysvětlení"), reason), save, err)));
  }, "secondary small");
  return el("details", { class: "fb-admin" }, el("summary", {}, t("Správa požadavku")), form, el("div", { class: "fb-admin-actions" }, merge, deleteAction));
}

async function detailContent(id, admin, signal, refresh) {
  const data = await api(path(admin, `items/${id}`), { signal }); const item = data.item;
  const error = el("p", { role: "alert" });
  const node = el("article", { class: "fb-detail" },
    el("div", { class: "fb-detail-meta" }, state(item.status), el("small", { class: "fb-updated" }, `${t("Aktualizováno")} ${stamp(item.updated_at)}`)),
    el("h2", {}, item.title), platformLine(item), el("p", { class: "fb-description" }, item.description));
  if (item.kind === "idea") {
    const vote = button(`${t(item.supported ? "Podpořeno" : "Podpořit")} · ${item.votes}`, async () => {
      vote.disabled = true;
      try { await api(`feedback/items/${id}/vote`, { method: item.supported ? "DELETE" : "PUT" }); refresh(); }
      catch (e) { error.textContent = e.message; vote.disabled = false; }
    }, item.supported ? "accent" : "secondary");
    vote.classList.add("fb-detail-vote");
    vote.setAttribute("aria-pressed", String(item.supported)); vote.disabled = !!item.duplicate_of || (!item.supported && terminal.has(item.status)) || !item.visible;
    node.append(vote);
  }
  if (item.duplicate_of) node.append(el("p", {}, t("Sloučeno s požadavkem"), ` #${item.duplicate_of}`, item.kind === "idea" ? el("a", { href: route("ideas", item.duplicate_of) }, t(" Otevřít")) : null));
  if (item.releases.length) node.append(el("h3", {}, t("Dostupnost")), el("ul", { class: "fb-releases" }, ...item.releases.map((r) => el("li", {}, `${platforms[r.platform]} · ${r.version} · ${stamp(r.released_at)}`))));
  if (!["duplicate", "declined", "cannot_reproduce"].includes(item.status)) node.append(el("section", { class: "fb-resolution" }, el("h3", {}, t("Průběh řešení")), progressTimeline(data)));
  const reply = data.events.findLast((event) => event.team && event.message);
  if (reply) node.append(el("section", { class: "fb-team-reply" }, el("h3", {}, t("Odpověď týmu Movly")), el("p", { class: "fb-description" }, reply.message)));
  const eventHistory = el("details", { class: "fb-history" }, el("summary", {}, t("Celá historie požadavku")), el("ol", { class: "fb-timeline" }, ...data.events.map((event) => el("li", {}, el("small", {}, `${stamp(event.created_at)} · ${t(event.team ? "Tým Movly" : "Autor")}`), el("div", {}, state(event.status)), event.message ? el("p", { class: "fb-description" }, event.message) : null))));
  if (item.diagnostics) node.append(diagnosticPreview(item.diagnostics));
  if (item.mine || admin) {
    const shots = el("div", { class: "fb-attachments" });
    for (const attachment of data.attachments) {
      shots.append(button(t("Zobrazit screenshot"), async () => {
        try { const result = await api(path(admin, `attachments/${attachment.id}`), { signal }); showDialog(el("div", { class: "dialog-body fb-dialog" }, el("img", { src: `data:${attachment.media_type};base64,${result.data}`, alt: t("Přiložený screenshot"), class: "fb-screenshot" }))); }
        catch (e) { error.textContent = e.message; }
      }, "secondary small"));
    }
    if (data.attachments.length) node.append(shots);
    const attach = item.mine && data.attachments.length < 3 && !terminal.has(item.status) ? button(t("Přiložit screenshot"), () => attachmentPicker(item, admin, refresh), "secondary small fb-attach", "plus") : null;
    if (item.status !== "duplicate" && ((item.kind === "bug" && item.mine) || admin)) {
      const message = el("textarea", { required: true, maxlength: 3000, rows: 3, placeholder: t("Doplnit informace…") });
      const send = el("button", { type: "submit", class: "button primary" }, t("Odeslat")); let requestId = crypto.randomUUID(), attempted = null;
      node.append(el("form", { class: "dialog-form fb-reply-form", onSubmit: async (e) => {
        e.preventDefault(); send.disabled = true; if (attempted !== null && attempted !== message.value) requestId = crypto.randomUUID(); attempted = message.value;
        try { await api(path(admin, `items/${id}/messages`), { method: "POST", body: { request_id: requestId, message: message.value } }); refresh(); }
        catch (e) { error.textContent = e.message; send.disabled = false; }
      } }, formField(t(admin ? "Odpověď uživateli" : "Doplnit informace"), message), el("div", { class: "fb-reply-footer" }, attach, send)));
    } else if (attach) node.append(attach);
  }
  node.append(eventHistory);
  if (admin) node.append(adminEditor(item, refresh)); node.append(error); node.feedbackItem = item; return node;
}

export async function feedback(params, signal, account = null) {
  requireFeedback();
  const currentOwner = account?.username || null;
  if (diagnosticOwner !== currentOwner) diagnosticDraft = null;
  diagnosticOwner = currentOwner;
  let view = ["ideas", "mine", "admin"].includes(params.get("view")) ? params.get("view") : "ideas";
  let id = params.get("id"), newIntent = ["bug", "choose"].includes(params.get("new")) ? params.get("new") : null; const q = params.get("q") || "";
  let reportPlatform = Object.hasOwn(platforms, params.get("platform")) ? params.get("platform") : "web";
  if (params.has("handoff")) {
    const handoff = await api("feedback/handoffs/consume", { method: "POST", body: { token: params.get("handoff") }, signal });
    if (handoff.diagnostics) diagnosticDraft = { diagnostics: handoff.diagnostics, platform: handoff.platform || reportPlatform, expiresAt: Date.now() + 10 * 60 * 1000 };
    reportPlatform = handoff.platform || reportPlatform;
    view = "mine"; id = handoff.item_id ? String(handoff.item_id) : null; newIntent = id ? null : (newIntent || "bug");
    params.delete("handoff"); params.set("view", view); if (id) params.set("id", id); else params.delete("id");
    if (newIntent) params.set("new", newIntent);
    history.replaceState(null, "", `#feedback?${params}`);
  }
  if (diagnosticDraft?.expiresAt < Date.now()) diagnosticDraft = null;
  if (diagnosticDraft && !id && !newIntent) { newIntent = "bug"; reportPlatform = diagnosticDraft.platform; }
  const admin = view === "admin";
  const selected = !!id && /^[1-9]\d*$/.test(id);
  const query = new URLSearchParams({ limit: "25", offset: params.get("offset") || "0", sort: params.get("sort") || (view === "ideas" ? "votes" : "updated"), q });
  if (view === "ideas") query.set("kind", "idea"); if (view === "mine") query.set("mine", "true");
  if (params.get("status")) query.set("status", params.get("status"));
  const data = await api(path(admin, `items?${query}`), { signal });
  const wrapper = el("section", { class: "page improve-page", "data-selected": selected ? "true" : "false", "data-view": view });

  const createForm = admin ? null : feedbackForm({ kind: view === "mine" ? "bug" : "idea", view, initialPlatform: reportPlatform, inline: true, signal });
  const createCard = createForm ? el("section", { class: "fb-create", "aria-labelledby": "fb-create-title" }, el("h2", { id: "fb-create-title" }, t("Nový příspěvek")), createForm) : null;
  wrapper.append(el("header", { class: "fb-heading" },
    el("div", {}, el("h1", {}, t("Vylepšit Movly")), el("p", {}, t("Nahlas chybu, navrhni funkci nebo podpoř nápady ostatních. Uvidíš, jak se s nimi pracuje."))),
    createCard ? button(t("Nový příspěvek"), () => { createCard.scrollIntoView({ block: "start" }); createForm.titleInput.focus({ preventScroll: true }); }, "secondary small fb-jump", "plus") : null));

  const tabs = el("nav", { class: "fb-tabs", "aria-label": t("Zpětná vazba") },
    ...[["ideas", "Nápady"], ["mine", "Moje hlášení"], ...(data.can_manage ? [["admin", "Správa"]] : [])].map(([value, label]) => el("a", { href: route(value), "aria-current": view === value ? "page" : "false" }, t(label))));
  const filterLink = (changes) => `#feedback?${new URLSearchParams({ view, ...(q ? { q } : {}), ...(params.get("status") ? { status: params.get("status") } : {}), sort: query.get("sort"), ...changes })}`;
  const sorts = el("div", { class: "fb-pills", role: "group", "aria-label": t("Řazení") },
    ...[["votes", "Nejvíce podpory"], ["new", "Nejnovější"], ["updated", "Poslední změna"]].map(([value, label]) => el("a", { class: "fb-pill", href: filterLink({ sort: value }), "aria-current": query.get("sort") === value ? "true" : "false" }, t(label))));
  const search = el("input", { type: "search", maxlength: 120, value: q, placeholder: t("Hledat požadavek…"), "aria-label": t("Hledat požadavek") });
  const statusFilter = el("select", { "aria-label": t("Stav") }, el("option", { value: "" }, t("Všechny stavy")), ...Object.entries(feedbackStatuses).map(([value, label]) => el("option", { value, selected: params.get("status") === value }, t(label))));
  const navigateFilters = () => { location.hash = `#feedback?${new URLSearchParams({ view, q: search.value, status: statusFilter.value, sort: query.get("sort") })}`; };
  statusFilter.addEventListener("change", navigateFilters);
  search.addEventListener("search", navigateFilters);
  const filters = el("form", { class: "fb-filters", role: "search", onSubmit: (e) => { e.preventDefault(); navigateFilters(); } },
    el("label", { class: "fb-search" }, glyph("search"), search), statusFilter, el("button", { class: "button secondary small", type: "submit" }, t("Hledat")));

  const rows = el("ul", { class: "fb-rows" });
  const listHost = el("div", { class: "fb-list-host" }, el("div", { class: "fb-toolbar" }, sorts), filters, rows);
  const detail = el("div", { class: "fb-detail-host" });
  const main = el("section", { class: "fb-main", "aria-labelledby": "fb-list-title" },
    el("div", { class: "fb-main-head" }, el("h2", { id: "fb-list-title" }, t(view === "ideas" ? "Návrhy komunity" : view === "mine" ? "Moje hlášení" : "Správa")), tabs),
    listHost, detail);
  const replaceRow = (item) => rows.querySelector(`[data-feedback-id="${item.id}"]`)?.replaceWith(makeRow(item));
  const refresh = async () => {
    if (signal.aborted) return; detail.replaceChildren(loading());
    try {
      const content = await detailContent(id, admin, signal, refresh);
      if (!signal.aborted) { detail.replaceChildren(el("a", { href: route(view, null, q), class: "fb-back" }, glyph("arrow-left"), t("Zpět na seznam")), content); replaceRow(content.feedbackItem); }
    } catch (e) { if (!signal.aborted) detail.replaceChildren(el("a", { href: route(view, null, q), class: "fb-back" }, glyph("arrow-left"), t("Zpět na seznam")), errorBox(e, refresh)); }
  };
  function makeRow(item) {
    const link = el("a", { href: route(view, item.id, q), class: "fb-row-content" },
      el("span", { class: "fb-row-title" }, el("strong", {}, item.title), state(item.status)),
      el("span", { class: "fb-row-description" }, item.description),
      el("span", { class: "fb-row-meta" }, el("span", {}, t(item.kind === "bug" ? "Chyba" : "Návrh")), platformLine(item)));
    const row = el("li", { class: "fb-row", "aria-current": String(item.id) === id ? "true" : "false", "data-feedback-id": String(item.id) });
    if (item.kind === "idea") {
      const vote = el("button", { type: "button", class: `fb-vote ${item.supported ? "supported" : ""}`, "aria-pressed": String(item.supported), "aria-label": `${t(item.supported ? "Podpořeno" : "Podpořit")} · ${item.votes}`, onClick: async () => {
        vote.disabled = true;
        try {
          const result = await api(`feedback/items/${item.id}/vote`, { method: item.supported ? "DELETE" : "PUT", signal });
          if (!signal.aborted) { replaceRow(result.item); if (String(item.id) === id) await refresh(); }
        } catch (e) { if (!signal.aborted) { toast(e.message); vote.disabled = false; } }
      } }, icon("chevron"), el("strong", {}, String(item.votes)));
      vote.disabled = !!item.duplicate_of || !item.visible || (!item.supported && terminal.has(item.status)); row.append(vote);
    } else row.append(el("span", { class: "fb-kind-icon" }, glyph("alert-circle")));
    row.append(link);
    return row;
  }
  if (!data.items.length) listHost.insertBefore(el("div", { class: "fb-empty" }, glyph("message-square"), el("p", {}, t("Zatím tu nejsou žádné požadavky."))), rows);
  for (const item of data.items) rows.append(makeRow(item));
  const pager = el("div", { class: "fb-pager" });
  if (data.offset > 0) pager.append(el("a", { class: "button secondary small", href: `#feedback?${new URLSearchParams({ ...Object.fromEntries(params), offset: String(Math.max(0, data.offset - data.limit)) })}` }, t("Předchozí")));
  if (data.offset + data.limit < data.total) pager.append(el("a", { class: "button secondary small", href: `#feedback?${new URLSearchParams({ ...Object.fromEntries(params), offset: String(data.offset + data.limit) })}` }, t("Další")));
  if (pager.childNodes.length) listHost.append(pager);
  wrapper.append(el("div", { class: `fb-layout ${createCard ? "" : "single"}` }, createCard, main));
  if (selected) await refresh();
  if (newIntent && !signal.aborted) {
    // The router mounts the result after this async function returns. Open only
    // once it is mounted, so navigation/abort cannot leave a detached dialog.
    requestAnimationFrame(() => {
      if (signal.aborted || !wrapper.isConnected) return;
      if (newIntent === "choose") chooseFeedbackDialog(reportPlatform, diagnosticDraft?.diagnostics);
      else createDialog("bug", "mine", reportPlatform, diagnosticDraft?.diagnostics);
      params.delete("new"); params.delete("platform");
      history.replaceState(null, "", `#feedback?${params}`);
    });
  }
  return wrapper;
}
