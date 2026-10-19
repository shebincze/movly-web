import "./tv/home-preferences-state.js";
import { api, apiContextKey, apiContextOwner } from "./api.js";
import { effectiveContentPolicy } from "./effective-policy.js";
import { uiLanguage } from "./i18n.js";
import { el, button, showDialog } from "./ui.js";
const state = window.MovlyHomePreferences;

export function openHomePreferences() {
  const owner = apiContextOwner(), context = apiContextKey(), language = uiLanguage();
  const t = key => state.text(key, language), status = el("p", { role: "status", class: "home-preferences-status" });
  const rows = el("ol", { class: "home-preferences-rows" }), controls = el("div", { class: "home-preferences-actions" });
  const root = el("div", { class: "dialog-body home-preferences" }, el("h2", { id: "dialog-title" }, t("title")), el("p", {}, t("description")), status, rows, controls);
  const dialog = showDialog(root), lifetime = new AbortController();
  let request = null, generation = 0, document = null, draft = null, busy = false, ready = false, conflict = false, verifiedPolicy = null, policyProbe = false, dirty = false;
  const present = () => !lifetime.signal.aborted && context === apiContextKey() && owner && root.isConnected && dialog.open;
  const admit = control => present() && ready && !busy && !conflict && root.contains(control);
  const url = `home/preferences?${new URLSearchParams({ lang: language })}`;
  function action(label, fn, enabled = true) {
    const control = button(label, () => { if (admit(control)) fn(); });
    control.disabled = !enabled || !present() || !ready || busy || conflict;
    return control;
  }
  function paint(focusKey) {
    rows.replaceChildren(); controls.replaceChildren();
    if (draft && document) for (const [index, slug] of draft.order.entries()) {
      const row = document.sections.find(item => item.slug === slug), hidden = draft.hidden.includes(slug);
      const item = el("li", { "data-home-slug": slug }, el("span", { class: "home-preferences-name" }, row.name || slug), el("span", { class: "muted" }, t(hidden ? "hidden" : "visible")));
      for (const [key, enabled, fn] of [["up", index > 0, () => state.move(draft, slug, -1)], ["down", index < draft.order.length - 1, () => state.move(draft, slug, 1)], [hidden ? "show" : "hide", true, () => state.toggle(draft, slug)]]) {
        const control = action(t(key), () => { fn(); dirty = true; paint(`${slug}:${key}`); }, enabled);
        control.setAttribute("aria-label", `${t(key)} ${row.name || slug}`); control.dataset.homeAction = `${slug}:${key}`; item.append(control);
      }
      rows.append(item);
    }
    if (document && !document.sections.length) rows.append(el("li", {}, t("empty")));
    controls.append(action(t("save"), () => void save(false)), action(t("reset"), () => void save(true)));
    const reload = button(t("reload"), () => { if (present() && !busy && root.contains(reload)) void load(); });
    reload.disabled = !present() || busy; controls.append(reload);
    const focused = focusKey && [...root.querySelectorAll("[data-home-action]")].find(node => node.dataset.homeAction === focusKey && !node.disabled);
    focused?.focus();
  }
  function begin() { request?.abort(); request = new AbortController(); busy = true; return ++generation; }
  const current = mine => present() && mine === generation && !request.signal.aborted;
  async function load(preserve = false) {
    if (!present() || busy) return;
    const mine = begin(); ready = false; status.textContent = t("loading"); paint();
    try {
      policyProbe = true;
      const policy = await effectiveContentPolicy({ signal: request.signal, refresh: true });
      policyProbe = false;
      if (!current(mine) || policy.user_id !== owner.accountId || policy.profile_id !== owner.profileId) return;
      const result = await api(url, { signal: request.signal, expectedOwner: owner });
      if (!current(mine)) return;
      const fresh = state.document(result, owner.profileId);
      const next = state.reconcile(document, draft, fresh, preserve && dirty, policy.revision === verifiedPolicy?.revision);
      document = next.document; draft = next.draft; dirty = next.dirty; ready = next.ready; conflict = next.conflict;
      if (!dirty) verifiedPolicy = policy;
      status.textContent = conflict ? t(ready ? "conflict" : "context") : "";
    } catch (error) { if (current(mine)) status.textContent = t("loadError"); }
    finally { if (current(mine)) { policyProbe = false; busy = false; paint(); } }
  }
  async function save(reset) {
    if (!present() || !ready || busy || conflict || !document) return;
    const body = state.body(document, draft, reset), mine = begin(); status.textContent = t("saving"); paint();
    try {
      const policy = await effectiveContentPolicy({ signal: request.signal, refresh: true });
      if (!current(mine)) return;
      if (policy.revision !== verifiedPolicy?.revision) { ready = false; status.textContent = t("context"); return; }
      const result = await api(url, { method: "PUT", body, signal: request.signal, expectedOwner: owner });
      if (!current(mine)) return;
      document = state.receipt(result, owner.profileId, body.revision); draft = state.draft(document); dirty = false; status.textContent = t("saved");
      window.dispatchEvent(new CustomEvent("movly:home-preferences-changed", { detail: { apiContext: context, accountId: owner.accountId, profileId: owner.profileId, revision: document.revision } }));
    } catch (error) {
      if (!current(mine)) return;
      conflict = error.status === 409; status.textContent = t(conflict ? "conflict" : "error");
    } finally { if (current(mine)) { busy = false; paint(); } }
  }
  const invalidatePolicy = () => {
    if (!present() || (policyProbe && !ready)) return;
    generation++; request?.abort(); busy = false; ready = false; status.textContent = t("context"); paint();
  };
  window.document.addEventListener("movly:effective-policy-changed", invalidatePolicy, { signal: lifetime.signal });
  const foreground = () => { if (present() && !busy) void load(true); };
  window.addEventListener("focus", foreground, { signal: lifetime.signal });
  window.document.addEventListener("visibilitychange", () => { if (!window.document.hidden) foreground(); }, { signal: lifetime.signal });
  const dispose = () => { generation++; lifetime.abort(); request?.abort(); observer.disconnect(); };
  const observer = new MutationObserver(() => { if (!root.isConnected) dispose(); });
  observer.observe(dialog, { childList: true, subtree: true });
  dialog.addEventListener("close", dispose, { once: true });
  void load();
  return root;
}
