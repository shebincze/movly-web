import "./tv/home-preferences-state.js";
import { api, apiContextKey, apiContextOwner } from "./api.js";
import { effectiveContentPolicy } from "./effective-policy.js";
import { watchPagePreferences } from "./page-preferences-watch.js";
import { uiLanguage } from "./i18n.js";
import { el, button, showDialog } from "./ui.js";
const state = window.MovlyHomePreferences;

export function openHomePreferences(initialPage = "home") {
  let page = ["home", "movies", "series"].includes(initialPage) ? initialPage : "home";
  const owner = apiContextOwner(), context = apiContextKey(), language = uiLanguage();
  const t = key => state.text(key, language), status = el("p", { role: "status", class: "home-preferences-status" });
  const rows = el("ol", { class: "home-preferences-rows" }), controls = el("div", { class: "home-preferences-actions" });
  const heading = el("h2", { id: "dialog-title" }), selector = el("select", { "aria-label": t("pages") });
  for (const value of ["home", "movies", "series"]) selector.append(el("option", { value }, t(value)));
  selector.value = page;
  const root = el("div", { class: "dialog-body home-preferences" }, heading, selector, el("p", {}, t("description")), status, rows, controls);
  const dialog = showDialog(root), lifetime = new AbortController();
  let request = null, generation = 0, document = null, draft = null, busy = false, ready = false, conflict = false, verifiedPolicy = null, policyProbe = false, dirty = false, editing = false, drag = null, watcher = null, watchLifetime = null;
  const present = () => !lifetime.signal.aborted && context === apiContextKey() && owner && root.isConnected && dialog.open;
  const admit = control => present() && ready && !busy && !conflict && root.contains(control);
  const url = () => `pages/${page}/preferences?${new URLSearchParams({ lang: language })}`;
  function action(label, fn, enabled = true) {
    const control = button(label, () => { if (admit(control)) fn(); });
    control.disabled = !enabled || !present() || !ready || busy || conflict;
    return control;
  }
  function cancelDrag(restore = true) {
    if (!drag) return;
    const old = drag; drag = null;
    if (restore && draft) { draft.order = old.order; dirty = old.dirty; }
    try { old.handle.releasePointerCapture(old.id); } catch { /* capture already released */ }
  }
  function paint(focusKey) {
    cancelDrag(); heading.textContent = `${t("pages")} — ${t(page)}`;
    selector.value = page; selector.disabled = busy;
    rows.replaceChildren(); controls.replaceChildren();
    if (draft && document) for (const slug of draft.order) {
      const row = document.sections.find(item => item.slug === slug), hidden = draft.hidden.includes(slug);
      const item = el("li", { "data-home-slug": slug }, el("span", { class: "home-preferences-name" }, row.name || slug));
      const toggle = el("input", { type: "checkbox", role: "switch", "aria-label": `${t("visible")} ${row.name || slug}` });
      toggle.checked = !hidden; toggle.disabled = !ready || busy || conflict;
      toggle.addEventListener("change", () => {
        if (!admit(toggle)) return;
        state.toggle(draft, slug); dirty = true; editing = true; paint(`${slug}:toggle`);
      });
      toggle.dataset.homeAction = `${slug}:toggle`;
      item.append(el("label", { class: "home-preferences-toggle" }, toggle));
      if (editing) {
        const handle = action("≡", () => {}, true);
        handle.className = "button secondary home-preferences-handle";
        handle.setAttribute("aria-label", `${t("drag")} ${row.name || slug}; ${t("up")} / ${t("down")}`);
        handle.dataset.homeAction = `${slug}:drag`;
        handle.addEventListener("keydown", event => {
          if (!admit(handle) || !["ArrowUp", "ArrowDown", "Escape"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { cancelDrag(); paint(`${slug}:drag`); return; }
          state.move(draft, slug, event.key === "ArrowUp" ? -1 : 1); dirty = true;
          status.textContent = `${row.name || slug}: ${draft.order.indexOf(slug) + 1}`; paint(`${slug}:drag`);
        });
        handle.addEventListener("pointerdown", event => {
          if (!admit(handle) || event.button !== 0 || drag) return;
          event.preventDefault();
          drag = { id: event.pointerId, handle, slug, page, generation, order: draft.order.slice(), dirty };
          handle.setPointerCapture(event.pointerId); item.classList.add("dragging");
        });
        handle.addEventListener("pointermove", event => {
          if (!drag || drag.handle !== handle || drag.id !== event.pointerId) return;
          if (!admit(handle) || drag.page !== page || drag.generation !== generation) { cancelDrag(); paint(); return; }
          const others = [...rows.children].filter(node => node !== item);
          let index = 0;
          for (const node of others) { const box = node.getBoundingClientRect(); if (event.clientY > box.top + box.height / 2) index++; }
          state.relocate(draft, slug, index);
          rows.insertBefore(item, others[index] || null);
          handle.setPointerCapture(event.pointerId);
          const scroller = root.closest("dialog");
          if (scroller) { const box = scroller.getBoundingClientRect(); if (event.clientY < box.top + 60) scroller.scrollTop -= 18; else if (event.clientY > box.bottom - 60) scroller.scrollTop += 18; }
        });
        handle.addEventListener("pointerup", event => {
          if (!drag || drag.handle !== handle || drag.id !== event.pointerId) return;
          if (!admit(handle)) { cancelDrag(); paint(); return; }
          const changed = JSON.stringify(drag.order) !== JSON.stringify(draft.order);
          cancelDrag(false); dirty = dirty || changed;
          status.textContent = `${row.name || slug}: ${draft.order.indexOf(slug) + 1}`; paint(`${slug}:drag`);
        });
        const cancelled = () => { if (drag?.handle === handle) { cancelDrag(); paint(`${slug}:drag`); } };
        handle.addEventListener("pointercancel", cancelled); handle.addEventListener("lostpointercapture", cancelled);
        item.append(handle);
      }
      rows.append(item);
    }
    if (document && !document.sections.length) rows.append(el("li", {}, t("empty")));
    controls.append(action(t(editing ? "done" : "edit"), () => {
      if (!editing) { editing = true; paint(); }
      else if (!dirty) { editing = false; paint(); }
      else void save(false);
    }));
    controls.append(action(t("reset"), () => {
      const capturedPage = page, capturedGeneration = generation;
      if (confirm(t("resetConfirm")) && present() && capturedPage === page && capturedGeneration === generation) void save(true);
    }));
    const reload = button(t("reload"), () => { if (present() && !busy && root.contains(reload)) void load(); });
    reload.disabled = !present() || busy; controls.append(reload);
    const focused = focusKey && [...root.querySelectorAll("[data-home-action]")].find(node => node.dataset.homeAction === focusKey && !node.disabled);
    focused?.focus();
  }
  function begin() { watcher?.stop(); cancelDrag(); request?.abort(); request = new AbortController(); busy = true; return ++generation; }
  const current = mine => present() && mine === generation && !request.signal.aborted;
  async function load(preserve = false) {
    if (!present() || busy) return;
    const mine = begin(); ready = false; status.textContent = t("loading"); paint();
    try {
      policyProbe = true;
      const policy = await effectiveContentPolicy({ refresh: true });
      policyProbe = false;
      if (!current(mine) || policy.user_id !== owner.accountId || policy.profile_id !== owner.profileId) return;
      const result = await api(url(), { signal: request.signal, expectedOwner: owner });
      if (!current(mine)) return;
      const fresh = state.document(result, owner.profileId, page);
      const next = state.reconcile(document, draft, fresh, preserve && dirty, policy.revision === verifiedPolicy?.revision, preserve && conflict);
      document = next.document; draft = next.draft; dirty = next.dirty; ready = next.ready; conflict = next.conflict;
      if (!dirty) { verifiedPolicy = policy; editing = false; }
      status.textContent = conflict ? t(ready ? "conflict" : "context") : "";
    } catch (error) { if (current(mine)) status.textContent = t("loadError"); }
    finally { if (current(mine)) { policyProbe = false; busy = false; paint(); startWatch(); } }
  }
  async function save(reset) {
    if (!present() || !ready || busy || conflict || !document) return;
    const body = state.body(document, draft, reset), mine = begin(); status.textContent = t("saving"); paint();
    try {
      const policy = await effectiveContentPolicy({ refresh: true });
      if (!current(mine)) return;
      if (policy.revision !== verifiedPolicy?.revision) { ready = false; status.textContent = t("context"); return; }
      const result = await api(url(), { method: "PUT", body, signal: request.signal, expectedOwner: owner });
      if (!current(mine)) return;
      document = state.receipt(result, owner.profileId, body.revision, page); draft = state.draft(document); dirty = false; editing = false; watcher?.accept({ ...document, policy_revision: verifiedPolicy.revision }); status.textContent = t("saved");
      window.dispatchEvent(new CustomEvent("movly:page-preferences-changed", { detail: { page, apiContext: context, accountId: owner.accountId, profileId: owner.profileId, revision: document.revision } }));
    } catch (error) {
      if (!current(mine)) return;
      conflict = error.status === 409; status.textContent = t(conflict ? "conflict" : "error");
    } finally { if (current(mine)) { busy = false; paint(); startWatch(); } }
  }
  function startWatch() {
    if (!present() || busy || window.document.hidden) return;
    if (!watcher) {
      watchLifetime = new AbortController();
      lifetime.signal.addEventListener("abort", () => watchLifetime?.abort(), { once: true });
      watcher = watchPagePreferences({ page, signal: watchLifetime.signal, active: present, changed: () => void load(true) });
    } else watcher.start();
  }
  selector.addEventListener("change", () => {
    if (!present() || !root.contains(selector)) return;
    const next = selector.value; if (!["home", "movies", "series"].includes(next) || next === page) return;
    watchLifetime?.abort(); watcher = null; watchLifetime = null; cancelDrag(); generation++; request?.abort(); busy = false; page = next; document = null; draft = null; dirty = false; editing = false; ready = false; conflict = false; verifiedPolicy = null; void load();
  });
  const invalidatePolicy = () => {
    if (!present() || (policyProbe && !ready)) return;
    generation++; request?.abort(); busy = false; ready = false; status.textContent = t("context"); paint();
  };
  window.document.addEventListener("movly:effective-policy-changed", invalidatePolicy, { signal: lifetime.signal });
  const foreground = () => { if (present() && !busy) void load(true); };
  window.addEventListener("blur", () => watcher?.stop(), { signal: lifetime.signal });
  window.addEventListener("focus", foreground, { signal: lifetime.signal });
  window.document.addEventListener("visibilitychange", () => { if (!window.document.hidden) foreground(); }, { signal: lifetime.signal });
  const dispose = () => { cancelDrag(); generation++; lifetime.abort(); request?.abort(); observer.disconnect(); };
  const observer = new MutationObserver(() => { if (!root.isConnected) dispose(); });
  observer.observe(dialog, { childList: true, subtree: true });
  dialog.addEventListener("close", dispose, { once: true });
  void load();
  return root;
}
