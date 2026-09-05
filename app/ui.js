import { imageURL } from "./api.js";
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
    { class: `button ${variant}`, onClick },
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
    "Načítám…",
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
    el("h2", {}, "Teď se to nepodařilo"),
    el("p", {}, error.message),
    retry ? button("Zkusit znovu", retry) : null,
  );
}
export function warning(data) {
  if (!data?.degraded && !data?.warnings?.length) return null;
  return el(
    "div",
    { class: "notice", role: "status" },
    "Některé zdroje jsou dočasně nedostupné. Výsledky mohou být neúplné.",
    data.degraded_sources?.length
      ? el("span", {}, ` Zdroje: ${data.degraded_sources.join(", ")}.`)
      : null,
  );
}
export function poster(t, onClick, extra) {
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
              el("span", { class: "missing-art" }, "Plakát není dostupný"),
            );
          },
        })
      : el("span", { class: "missing-art" }, "Bez plakátu"),
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
          ? "4K"
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
  const progress =
    t.progress?.progress_percentage ?? t.progress?.progress_percent;
  if (typeof progress === "number" && Number.isFinite(progress))
    frame.append(
      el("progress", {
        max: 100,
        value: Math.min(100, Math.max(0, progress)),
        "aria-label": "Rozkoukáno",
      }),
    );
  return el(
    "article",
    { class: "poster-card" },
    el(
      "button",
      { class: "poster-button", onClick: () => onClick(t) },
      frame,
      el("span", { class: "poster-title" }, t.title),
      el(
        "span",
        { class: "poster-meta" },
        [t.year, t.type === "tv" ? "Seriál" : null].filter(Boolean).join(" · "),
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
            "Zobrazit vše",
            icon("chevron"),
          )
        : null,
    ),
    track,
  );
}
export function hero(t, onTitle, onSave) {
  const url = imageURL(t.backdrop_path, "w1280");
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
      el(
        "p",
        { class: "meta" },
        [
          t.year,
          ...(t.genres || []).slice(0, 2).map((g) => g.name_cs || g.name),
          t.runtime
            ? `${Math.floor(t.runtime / 60) ? `${Math.floor(t.runtime / 60)} h ` : ""}${t.runtime % 60 ? `${t.runtime % 60} min` : ""}`.trim()
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
      t.overview ? el("p", { class: "synopsis" }, t.overview) : null,
      el(
        "div",
        { class: "actions" },
        button(
          t.type === "tv" ? "Detail seriálu" : "Detail filmu",
          () => onTitle(t),
          "primary",
          "chevron",
        ),
        button("Do seznamu", () => onSave(t), "secondary", "plus"),
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
