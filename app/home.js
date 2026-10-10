import { api, title, imageURL } from "./api.js";
import { translateUI } from "./i18n.js";
import { el, button, loading, empty, rail, errorBox } from "./ui.js";
import { homeSections, retainHome, homeQuery, homeCaption, recommendationAction, HomeImpressions } from "./home-state.js";

const impressions = new HomeImpressions();
export function resetHomeImpressions() { impressions.clear(); }

export function homeItems(row) {
  return (row.items || []).map(item => ({ ...title(item), tracking: item.tracking,
    homeCaption: homeCaption(row, item), homeHighlight: (row.highlights || []).find(h => h.title_id === item.title.id) }));
}
export function homeTracking(signal, actions) {
  const metadata = new WeakMap();
  let owner;
  const send = (item, action) => {
    const body = recommendationAction(item, action);
    if (!body || !Number.isSafeInteger(owner?.accountId) || !Number.isSafeInteger(owner?.profileId) || signal.aborted) return;
    return api("recommendations/action", { method: "POST", body, signal, expectedOwner: owner });
  };
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < .5 || document.visibilityState !== "visible") continue;
      const item = metadata.get(entry.target), body = recommendationAction(item, "view");
      if (!body) continue;
      if (!impressions.claim(owner, item)) continue;
      const capturedOwner = owner;
      send(item, "view")?.catch(() => impressions.release(capturedOwner, item));
    }
  }, { threshold: .5 });
  signal.addEventListener("abort", () => observer?.disconnect(), { once: true });
  return {
    setOwner: value => { owner = value ? { accountId: value.account_id, profileId: value.profile_id } : null; },
    clear: () => observer?.disconnect(),
    observe: (node, item) => { if (node && recommendationAction(item, "view")) { metadata.set(node, item); observer?.observe(node); } },
    detail: item => { send(item, "click")?.catch(() => {}); actions.detail(item); },
    save: item => actions.save(item),
  };
}
export function decorateHomeCards(node, items, tracking) {
  node.querySelectorAll(".poster-card").forEach((card, i) => {
    if (items[i]?.homeCaption) card.querySelector(".poster-button").append(el("span", { class: "poster-meta" }, items[i].homeCaption));
    tracking.observe(card, items[i]);
  });
}
export function serverHome(signal, actions, carousel) {
  const content = el("div", { class: "native-home" }, loading());
  const tracker = homeTracking(signal, actions);
  let rows = [], viewer = null, revision = 0, busy = false, pending = false, timer;
  const rowURL = (row, page = 1) => `#collection?${new URLSearchParams({ source: "home", slug: row.slug, page: String(page) })}`;
  function renderRow(row) {
    const node = el("section", { class: "home-section", "data-home-slug": row.slug });
    if (row.kind === "collections") {
      node.classList.add("rail-section");
      node.append(el("h2", {}, row.name), el("div", { class: "collection-banners" }, (row.collections || []).map(c => el("a", {
        class: "collection-banner", href: `#collection?${new URLSearchParams({ source: "home_collection", slug: c.slug })}`,
      }, imageURL(c.banner_url) ? el("img", { src: imageURL(c.banner_url), alt: "", loading: "lazy" }) : null,
      el("strong", {}, c.name), el("span", {}, translateUI("{0} titulů", c.total_items))))));
    } else {
      const items = homeItems(row);
      if (items.length) {
        if (row.kind === "hero") node.append(carousel(items.slice(0, 10).map(t => ({ ...t, homeHeading: row.name })), { ...tracker, onHero: tracker.observe }));
        else {
          const shown = row.kind === "top10" ? items.slice(0, 10) : items;
          const cards = rail(row.name, shown, tracker.detail, row.kind === "top10" ? null : rowURL(row));
          decorateHomeCards(cards, shown, tracker);
          if (row.kind === "top10") {
            cards.classList.add("top-ten");
            cards.querySelectorAll(".poster-card").forEach((card, i) => card.prepend(el("span", { class: "rank-number", "aria-hidden": "true" }, String(i + 1))));
          }
          node.append(cards);
        }
      } else if (["error", "degraded"].includes(row.state)) node.append(el("h2", {}, row.name));
      else if (row.kind === "upcoming") node.append(el("h2", {}, row.name), el("p", {}, translateUI("Pro tento region zatím nejsou potvrzené premiéry.")));
    }
    if (row.subtitle) node.prepend(el("p", { class: "meta" }, row.subtitle));
    if (row.has_more && row.kind !== "top10") node.append(el("a", { href: rowURL(row, 2), class: "text-link" }, translateUI("Další")));
    if (["error", "degraded"].includes(row.state) || row.warning) node.append(errorBox(new Error(row.warning || translateUI("Řada se neobnovila.")), () => refresh(row.slug)));
    return node;
  }
  function paint(error) {
    tracker.clear();
    const nodes = rows.map(renderRow);
    content.replaceChildren(...nodes);
    if (error) content.prepend(errorBox(error, () => refresh()));
    else if (!rows.length) content.append(empty(translateUI("Domů zatím nemá žádné aktivní řady."), ""));
  }
  async function refresh(section) {
    if (signal.aborted) return;
    if (busy) { pending = true; return; }
    busy = true; let fullReload = false; const current = ++revision;
    const previousRows = rows, previousViewer = viewer;
    try {
      const response = await api(homeQuery({ section }), { signal });
      if (signal.aborted || current !== revision) return;
      if (!response.viewer_scope) throw new Error(translateUI("Neplatná odpověď Domů."));
      const scope = JSON.stringify(response.viewer_scope);
      const same = viewer === scope;
      if (!same) rows = [];
      const fresh = homeSections(response);
      if (section && !same) { rows = []; tracker.clear(); content.replaceChildren(loading()); fullReload = true; return; }
      if (section) {
        if (fresh.length !== 1 || fresh[0].slug !== section) throw new Error(translateUI("Neplatná řada Domů."));
        rows = rows.map(row => row.slug === section ? retainHome(fresh, rows)[0] : row);
      } else rows = retainHome(fresh, same ? rows : []);
      viewer = scope; tracker.setOwner(response.viewer_scope); paint();
    } catch (error) {
      if (signal.aborted || current !== revision) return;
      const errorScope = error.body?.viewer_scope;
      const policyChanged = error.code === "home_policy_changed" || (errorScope && JSON.stringify(errorScope) !== previousViewer);
      rows = ![401, 403].includes(error.status) && !policyChanged && viewer === previousViewer ? previousRows : [];
      paint(error);
    } finally { busy = false; if ((pending || fullReload) && !signal.aborted) { pending = false; refresh(); } }
  }
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => refresh(), 250); };
  document.addEventListener("movly:personal-changed", changed);
  window.addEventListener("movly:personal-changed", changed);
  window.addEventListener("online", changed);
  const visible = () => { if (document.visibilityState === "visible") changed(); };
  document.addEventListener("visibilitychange", visible);
  signal.addEventListener("abort", () => {
    clearTimeout(timer); document.removeEventListener("movly:personal-changed", changed);
    window.removeEventListener("movly:personal-changed", changed); window.removeEventListener("online", changed);
    document.removeEventListener("visibilitychange", visible);
  }, { once: true });
  refresh();
  return content;
}
