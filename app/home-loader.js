import { homeQuery, homeSections } from "./home-state.js";

// The existing manifest/section contract lets useful rows publish independently.
// One cycle budget includes manifest, local queue residence and all row requests.
export function createHomeLoader({ request, signal, onLayout, onRow, onError, budget = 8000, concurrency = 4 }) {
  budget = Number.isFinite(budget) ? Math.max(1, Math.min(8000, budget)) : 8000;
  concurrency = Number.isSafeInteger(concurrency) ? Math.max(1, Math.min(4, concurrency)) : 4;
  let cycle = null, generation = 0;
  const current = c => cycle === c && !signal.aborted && !c.closed;
  function close(c) {
    if (!c) return;
    c.closed = true; clearTimeout(c.timer); c.controller.abort();
    for (const item of c.jobs) { clearTimeout(item.timer); item.controller?.abort(); }
  }
  function failed(row, warning) { return { ...row, state: "error", warning, items: [], collections: [], premieres: [], highlights: [] }; }
  function stopWith(c, error) {
    if (!current(c)) return;
    close(c); onError(error);
  }
  function pump(c) {
    while (current(c) && c.active < concurrency && c.queue.length) {
      const job = c.queue.shift();
      if (job.done || job.running) continue;
      job.running = true; c.active++;
      const controller = new AbortController(); job.controller = controller;
      const abort = () => controller.abort(); c.controller.signal.addEventListener("abort", abort, { once: true });
      request(homeQuery({ section: job.row.slug }), { signal: controller.signal, expectedOwner: c.owner }).then(response => {
        if (!current(c) || job.done) return;
        if (JSON.stringify(response.viewer_scope) !== c.scope) {
          stopWith(c, Object.assign(new Error("Pravidla profilu se změnila. Zkusit znovu."), { code: "home_policy_changed" })); return;
        }
        const rows = homeSections(response);
        if (rows.length !== 1 || rows[0].slug !== job.row.slug || rows[0].content_key !== job.row.content_key) {
          stopWith(c, new Error("Řady Domů se změnily. Zkusit znovu.")); return;
        }
        job.done = true; onRow(rows[0], true);
      }).catch(error => {
        if (!current(c) || job.done) return;
        const scope = error.body?.viewer_scope;
        if ([401, 403].includes(error.status) || error.name === "AbortError" || ["home_policy_changed", "offline_owner_changed"].includes(error.code) || scope && JSON.stringify(scope) !== c.scope) { stopWith(c, error); return; }
        job.done = true; onRow(failed(job.row, error.message || "Řada se neobnovila."), scope && JSON.stringify(scope) === c.scope);
      }).finally(() => {
        c.controller.signal.removeEventListener("abort", abort);
        clearTimeout(job.timer); c.active--; job.running = false;
        if (current(c)) { pump(c); if (c.jobs.every(j => j.done)) clearTimeout(c.timer); }
      });
    }
  }
  async function refresh() {
    close(cycle);
    const c = cycle = { generation: ++generation, controller: new AbortController(), jobs: [], queue: [], active: 0, closed: false };
    c.timer = setTimeout(() => {
      if (!current(c)) return;
      if (!c.jobs.length) { stopWith(c, new Error("Domů se nepodařilo načíst včas. Zkusit znovu.")); return; }
      for (const job of c.jobs) if (!job.done && !job.retry) { job.done = true; job.controller?.abort(); onRow(failed(job.row, "Řada se nenačetla včas. Zkusit znovu."), false); }
    }, budget);
    try {
      const response = await request(homeQuery({ layoutOnly: true }), { signal: c.controller.signal });
      if (!current(c)) return;
      if (!Number.isSafeInteger(response.viewer_scope?.account_id) || !Number.isSafeInteger(response.viewer_scope?.profile_id) || response.viewer_scope.account_id < 1 || response.viewer_scope.profile_id < 1) throw new Error("Neplatná odpověď Domů.");
      const rows = homeSections(response);
      c.scope = JSON.stringify(response.viewer_scope); c.owner = { accountId: response.viewer_scope.account_id, profileId: response.viewer_scope.profile_id };
      c.jobs = rows.map((row, index) => ({ row, index, done: false }));
      c.queue = [...c.jobs].sort((a, b) => (a.row.kind === "continue" ? 0 : a.index === 0 ? 1 : 2) - (b.row.kind === "continue" ? 0 : b.index === 0 ? 1 : 2) || a.index - b.index);
      onLayout(response, rows); pump(c);
      if (!rows.length) clearTimeout(c.timer);
    } catch (error) { if (current(c)) stopWith(c, error); }
  }
  function retry(slug) {
    const c = cycle;
    if (!c || signal.aborted || c.closed) { void refresh(); return; }
    const job = c.jobs.find(job => job.row.slug === slug);
    if (!job || job.running) return;
    job.done = false; job.retry = true;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      if (!current(c) || job.done) return;
      job.done = true; job.controller?.abort(); onRow(failed(job.row, "Řada se nenačetla včas. Zkusit znovu."), false);
    }, budget);
    c.queue.unshift(job); pump(c);
  }
  signal.addEventListener("abort", () => close(cycle), { once: true });
  return { refresh, retry };
}
