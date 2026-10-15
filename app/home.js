import { createHomeLoader } from "./home-loader.js";
import { api, title, imageURL } from "./api.js";
import { translateUI } from "./i18n.js";
import { el, button, loading, empty, rail, errorBox, icon } from "./ui.js";
import { retainHome, homeCaption, recommendationAction, HomeImpressions } from "./home-state.js";

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
    forget: node => { observer?.unobserve(node); node.querySelectorAll("*").forEach(child => observer?.unobserve(child)); },
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
// „Pokračovat ve sledování" jako karty na šířku s tlačítkem přehrání.
function continueCards(node, items) {
  node.classList.add("continue-rail");
  node.querySelectorAll(".poster-card").forEach((card, i) => {
    const frame = card.querySelector(".poster-frame"), wide = imageURL(items[i]?.backdrop_path, "w780");
    const img = frame?.querySelector("img");
    if (wide && img) img.src = wide;
    frame?.append(el("span", { class: "continue-play", "aria-hidden": "true" }, icon("play")));
  });
}
function genreSection(genres) {
  return el("section", { class: "rail-section home-genres", "aria-labelledby": "home-genres" },
    el("h2", { id: "home-genres" }, translateUI("Žánry")),
    el("div", { class: "genre-chips" }, genres.map(g => el("a", { class: "chip", href: `#movies?${new URLSearchParams({ view: "grid", genre: String(g.id) })}` }, g.name_cs || g.name))));
}
export function serverHome(signal, actions, carousel) {
  const content = el("div", { class: "native-home" }, loading());
  const tracker = homeTracking(signal, actions);
  let rows = [], viewer = null, timer, genres = [];
  api("titles/genres", { signal }).then(data => {
    genres = (Array.isArray(data?.genres) ? data.genres : []).filter(g => Number.isSafeInteger(g.id) && g.id > 0 && typeof (g.name_cs || g.name) === "string").slice(0, 16);
    if (rows.length && !signal.aborted) paint();
  }).catch(() => {});
  const rowURL = (row, page = 1) => `#collection?${new URLSearchParams({ source: "home", slug: row.slug, page: String(page) })}`;
  function renderRow(row) {
    const node = el("section", { class: "home-section", "data-home-slug": row.slug });
    if (row.state === "loading" && !(row.items?.length || row.collections?.length)) {
      node.append(el("h2", {}, row.name), loading());
      return node;
    }
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
          if (row.kind === "continue") continueCards(cards, shown);
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
    // Řady mají „Zobrazit vše" v nadpisu; samostatný odkaz potřebují jen kolekce.
    if (row.has_more && row.kind === "collections") node.append(el("a", { href: rowURL(row, 2), class: "text-link" }, translateUI("Další")));
    if (["error", "degraded"].includes(row.state) || row.warning) node.append(errorBox(new Error(row.warning || translateUI("Řada se neobnovila.")), () => refresh(row.slug)));
    return node;
  }
  function paint(error) {
    tracker.clear();
    const nodes = rows.map(renderRow);
    content.replaceChildren(...nodes);
    if (error) content.prepend(errorBox(error, () => refresh()));
    else if (!rows.length) content.append(empty(translateUI("Domů zatím nemá žádné aktivní řady."), ""));
    if (rows.length && genres.length) content.append(genreSection(genres));
  }
  const loader = createHomeLoader({ request: api, signal,
    onLayout: (response, fresh) => {
      const scope = JSON.stringify(response.viewer_scope), same = viewer === scope;
      rows = fresh.map(row => {
        const old = same && rows.find(old => old.slug === row.slug && old.content_key === row.content_key);
        return old ? { ...old, name: row.name, subtitle: row.subtitle, display_order: row.display_order } : row;
      });
      viewer = scope; tracker.setOwner(response.viewer_scope); paint();
    },
    onRow: (row, verified) => {
      const index = rows.findIndex(old => old.slug === row.slug);
      if (index < 0) return;
      rows[index] = retainHome([row], verified ? rows : [])[0];
      const old = content.querySelector(`[data-home-slug="${row.slug}"]`);
      if (old) { tracker.forget(old); old.replaceWith(renderRow(rows[index])); }
    },
    onError: error => { rows = []; viewer = null; tracker.clear(); paint(error); },
  });
  function refresh(section) { if (section) loader.retry(section); else void loader.refresh(); }
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
