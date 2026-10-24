import { translateUI, uiLanguage } from "./i18n.js";
import { formatRating, qualityLabel, genreName } from "./format.js";
import { imageURL } from "./api.js";
import { detailHref } from "./detail-route.js";
import {
  applyUserState,
  isWatched,
  progressPercent,
  renderCardState,
} from "./user-state.js";
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(
    ...children
      .flat()
      .filter((v) => v !== null && v !== undefined && v !== false),
  );
  return node;
}
const paths = {
  search: ["M21 21l-5-5", "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15"],
  chevron: ["m9 5 7 7-7 7"],
  close: ["m6 6 12 12", "M18 6 6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  down: ["m6 9 6 6 6-6"],
  check: ["m5 12 4 4L19 6"],
  trash: ["M3 6h18", "M9 6V3h6v3", "m6 6 1 15h10l1-15", "M10 10v7", "M14 10v7"],
  bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  coin: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v10", "M9 9.5h4.5a2 2 0 0 1 0 4H9"],
  play: ["M7 4.5v15l13-7.5z"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 11v5", "M12 8h.01"],
  tv: ["M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1", "M8 21h8"],
  lock: ["M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2", "M8 11V8a4 4 0 0 1 8 0v3"],
  star: ["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  sparkle: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "m5.6 5.6 2.8 2.8", "m15.6 15.6 2.8 2.8", "m5.6 18.4 2.8-2.8", "m15.6 8.4 2.8-2.8"],
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(k, v);
  if (name === "play") {
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
  }
  for (const d of paths[name] || paths.chevron) {
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
export function button(label, onClick, variant = "secondary", glyph) {
  return el(
    "button",
    { type: "button", class: `button ${variant}`, onClick },
    glyph && glyph !== "chevron" ? icon(glyph) : null,
    label,
    glyph === "chevron" ? icon(glyph) : null,
  );
}
export const loading = () =>
  el(
    "div",
    { class: "loading", role: "status" },
    el("span", { class: "spinner" }),
    translateUI("Načítám…"),
  );
// Jediný prázdný stav (DESIGN §10): ikona, nadpis, volitelný popis a akce.
// Prázdný popis se nevykresluje.
export function empty(heading, copy, { glyph = "info", action = null } = {}) {
  return el(
    "div",
    { class: "empty" },
    glyph ? el("span", { class: "empty-icon" }, icon(glyph)) : null,
    el("h2", {}, heading),
    copy ? el("p", {}, copy) : null,
    action ? el("div", { class: "empty-actions" }, action) : null,
  );
}
// Brána Premium je informační stav s cestou k Premium, ne chyba.
export function premiumGate(feature) {
  return empty(
    translateUI("{0} je součástí Premium", feature),
    translateUI("S Premium můžeš nahlašovat chyby, navrhovat funkce a hlasovat o nich."),
    {
      glyph: "lock",
      action: el("a", { class: "button accent", href: "#premium" }, translateUI("Premium a coiny")),
    },
  );
}
export function errorBox(error, retry) {
  return el(
    "div",
    { class: "error-state", role: "alert" },
    el("h2", {}, translateUI("Teď se to nepodařilo")),
    el("p", {}, error.message),
    retry ? button(translateUI("Zkusit znovu"), retry) : null,
  );
}
export function warning(data) {
  if (!data?.degraded && !data?.warnings?.length) return null;
  return el(
    "div",
    { class: "notice", role: "status" },
    translateUI(
      "Některé zdroje jsou dočasně nedostupné. Výsledky mohou být neúplné.",
    ),
    data.degraded_sources?.length
      ? el(
          "span",
          {},
          translateUI(" Zdroje: {0}.", data.degraded_sources.join(", ")),
        )
      : null,
  );
}
export function poster(raw, onClick, extra) {
  const t = applyUserState(raw);
  const url = imageURL(t.poster_path, "w342");
  const frame = el(
    "span",
    { class: "poster-frame" },
    url
      ? el("img", {
          src: url,
          alt: "",
          loading: "lazy",
          decoding: "async",
          onError: (e) => {
            e.target.remove();
            frame.append(
              el(
                "span",
                { class: "missing-art" },
                translateUI("Plakát není dostupný"),
              ),
            );
          },
        })
      : el("span", { class: "missing-art" }, translateUI("Bez plakátu")),
  );
  const badges = el("span", { class: "poster-badges" });
  const rating = formatRating(t.rating);
  if (rating) badges.append(el("span", { class: "badge-rating" }, rating));
  const quality = qualityLabel(t.streams?.video_height, t.streams?.video_width);
  if (quality) badges.append(el("span", {}, quality));
  if (
    t.streams?.audio_languages?.some((x) =>
      ["cs", "cz", "ces", "cze"].includes(x.toLowerCase()),
    )
  )
    badges.append(el("span", {}, "CZ"));
  if (badges.childNodes.length) frame.append(badges);
  renderCardState(frame, isWatched(t), progressPercent(t));
  // Karta titulu je odkaz na detail (WEB-N01): jde otevřít v nové kartě, zkopírovat
  // a prostřední tlačítko myši funguje. Běžné kliknutí otevře detail bez načtení stránky.
  const linkable = Number.isSafeInteger(t.id) && t.id > 0 && !t.unresolved;
  return el(
    "article",
    { class: "poster-card", "data-title-id": String(t.id) },
    el(
      linkable ? "a" : "button",
      {
        class: "poster-button",
        ...(linkable ? { href: detailHref(t.id) } : { type: "button" }),
        onClick: (event) => {
          if (linkable && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          event.preventDefault();
          onClick(t);
        },
      },
      frame,
      el("span", { class: "poster-title" }, t.title),
      el(
        "span",
        { class: "poster-meta" },
        [t.year, t.type === "tv" ? translateUI("Seriál") : null]
          .filter(Boolean)
          .join(" · "),
      ),
    ),
    extra,
  );
}
export function rail(name, items, onTitle, more) {
  const track = el(
    "div",
    { class: "poster-rail" },
    items.map((t) => poster(t, onTitle)),
  );
  return el(
    "section",
    { class: "rail-section" },
    el(
      "div",
      { class: "section-heading" },
      el("h2", {}, name),
      more
        ? el(
            "a",
            { href: more, class: "text-link" },
            translateUI("Zobrazit vše"),
            icon("chevron"),
          )
        : null,
    ),
    railPaging(track),
  );
}
// Myš bez vodorovného kolečka: tlačítka stránkování řady (WEB-N25). CSS je ukáže jen
// pro pointer: fine při najetí; klávesnice prochází karty, proto tabindex -1.
export function railPaging(track) {
  const page = (direction, label) => {
    const node = el(
      "button",
      {
        type: "button",
        class: `rail-page ${direction < 0 ? "prev" : "next"}`,
        tabindex: "-1",
        "aria-label": label,
      },
      icon("chevron"),
    );
    node.addEventListener("click", () => {
      const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.9, 1), behavior: reduce ? "auto" : "smooth" });
    });
    return node;
  };
  const prev = page(-1, translateUI("Posunout řadu zpět")),
    next = page(1, translateUI("Posunout řadu dál"));
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    prev.hidden = track.scrollLeft <= 1;
    next.hidden = max <= 1 || track.scrollLeft >= max - 1;
  };
  track.addEventListener("scroll", update, { passive: true });
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(track);
  prev.hidden = true;
  next.hidden = true;
  globalThis.requestAnimationFrame?.(update);
  return el("div", { class: "rail-viewport" }, prev, track, next);
}
export function runtimeLabel(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h ? `${h} h ` : ""}${m ? `${m} min` : ""}`.trim();
}
// Meta řádek ve stylu návrhu: hodnoty oddělené tečkou, štítky zvlášť.
export function metaLine(parts, tags = []) {
  const node = el("p", { class: "meta" });
  parts.filter(Boolean).forEach((part, i) => {
    if (i) node.append(el("span", { class: "meta-sep", "aria-hidden": "true" }, "•"));
    node.append(el("span", {}, part));
  });
  for (const tag of tags.filter(Boolean)) node.append(tag);
  return node;
}
// listAction(t) vrací tlačítko „Můj seznam“ / „V seznamu“ se stavem členství.
export function hero(t, onTitle, listAction, onPlay) {
  const url = imageURL(t.backdrop_path, "w1280");
  const quality = qualityLabel(t.streams?.video_height, t.streams?.video_width);
  const rating = formatRating(t.rating);
  return el(
    "section",
    { class: `hero${url ? "" : " no-art"}` },
    url
      ? el("img", {
          class: "hero-art",
          src: url,
          alt: "",
          fetchpriority: "high",
          onError: (e) => e.target.remove(),
        })
      : null,
    el("div", { class: "hero-shade" }),
    el(
      "div",
      { class: "hero-content" },
      el("h1", {}, t.title),
      metaLine(
        [
          t.year,
          runtimeLabel(t.runtime),
          (t.genres || []).slice(0, 2).map((g) => genreName(g, uiLanguage())).join(", "),
        ],
        [
          quality ? el("span", { class: "meta-tag" }, quality) : null,
          rating
            ? el("span", { class: "meta-score badge-rating", "aria-label": translateUI("Hodnocení {0}", rating) }, rating)
            : null,
        ],
      ),
      t.overview ? el("p", { class: "synopsis" }, t.overview) : null,
      el(
        "div",
        { class: "actions" },
        onPlay
          ? button(translateUI("Přehrát"), () => onPlay(t), "primary", "play")
          : null,
        listAction(t),
        button(
          onPlay
            ? translateUI("Informace")
            : t.type === "tv"
              ? translateUI("Detail seriálu")
              : translateUI("Detail filmu"),
          () => onTitle(t),
          onPlay ? "secondary" : "accent",
          "info",
        ),
      ),
    ),
  );
}
export function formField(label, input) {
  return el("label", { class: "field" }, el("span", {}, label), input);
}
let toastTimer;
export function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 5000);
}
export function showDialog(content, { closable = true } = {}) {
  const dialog = document.querySelector("#dialog");
  document.querySelector("#dialog-content").replaceChildren(content);
  dialog.querySelector(".dialog-close").hidden = !closable;
  // Dialog bez nadpisu #dialog-title (např. náhled screenshotu) dostane název
  // z obrázku, jinak by aria-labelledby ukazovalo na neexistující prvek.
  if (content.querySelector?.("#dialog-title") || content.id === "dialog-title") {
    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.removeAttribute("aria-label");
  } else {
    dialog.removeAttribute("aria-labelledby");
    const heading = content.querySelector?.("h1, h2"), image = content.querySelector?.("img[alt]");
    dialog.setAttribute("aria-label", heading?.textContent.trim() || image?.alt || "Movly");
  }
  dialog.oncancel = (e) => {
    if (!closable) e.preventDefault();
  };
  if (!dialog.open) dialog.showModal();
  return dialog;
}

export function countLabel(n, one, few, many) {
  return `${n.toLocaleString("cs-CZ")} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

export function avatar(profile) {
  const node = el(
    "span",
    { class: "avatar" },
    (profile?.name || "M").slice(0, 1).toUpperCase(),
  );
  try {
    const url = new URL(profile?.avatar_url);
    if (
      url.origin === "https://res.cloudinary.com" &&
      url.pathname.startsWith("/dsnzqq6kh/")
    ) {
      const img = el("img", {
        src: url.href,
        alt: "",
        referrerpolicy: "no-referrer",
        onError: () => img.remove(),
      });
      node.append(img);
    }
  } catch {}
  return node;
}
