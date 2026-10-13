import { translateUI } from "./i18n.js";
import { imageURL } from "./api.js";
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
export function empty(heading, copy) {
  return el(
    "div",
    { class: "empty" },
    el("h2", {}, heading),
    el("p", {}, copy),
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
  const url = imageURL(t.poster_path);
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
  if (Number.isFinite(t.rating))
    badges.append(el("span", {}, `${Math.round(t.rating)}%`));
  if (t.streams?.video_height)
    badges.append(
      el(
        "span",
        {},
        t.streams.video_width >= 3800 || t.streams.video_height >= 2100
          ? translateUI("4K")
          : `${t.streams.video_height}p`,
      ),
    );
  if (
    t.streams?.audio_languages?.some((x) =>
      ["cs", "cz", "ces", "cze"].includes(x.toLowerCase()),
    )
  )
    badges.append(el("span", {}, "CZ"));
  if (badges.childNodes.length) frame.append(badges);
  renderCardState(frame, isWatched(t), progressPercent(t));
  return el(
    "article",
    { class: "poster-card", "data-title-id": String(t.id) },
    el(
      "button",
      { class: "poster-button", onClick: () => onClick(t) },
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
    track,
  );
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
export function hero(t, onTitle, onSave, onPlay) {
  const url = imageURL(t.backdrop_path, "w1280");
  const quality = t.streams?.video_height
    ? t.streams.video_width >= 3800 || t.streams.video_height >= 2100
      ? translateUI("4K")
      : `${t.streams.video_height}p`
    : null;
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
          (t.genres || []).slice(0, 2).map((g) => g.name_cs || g.name).join(", "),
        ],
        [
          quality ? el("span", { class: "meta-tag" }, quality) : null,
          Number.isFinite(t.rating)
            ? el("span", { class: "meta-score", "aria-label": translateUI("Hodnocení {0} %", Math.round(t.rating)) }, `${Math.round(t.rating)} %`)
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
        button(translateUI("Do seznamu"), () => onSave(t), "secondary", "plus"),
        button(
          onPlay
            ? translateUI("Informace")
            : t.type === "tv"
              ? translateUI("Detail seriálu")
              : translateUI("Detail filmu"),
          () => onTitle(t),
          onPlay ? "secondary" : "primary",
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
