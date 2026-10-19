"use strict";
// Port of shebincze/Movly contracts/stream-relevance/reference.py.
// Canonical lexicon and cases are vendored verbatim; sources-relevance.test.js
// verifies every relevance primitive and all 71 evaluate cases.
const L = require("./contracts/stream-relevance/lexicons.json");
const T = L.thresholds;
const has = (key, token) => L[key].includes(token);
const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("'s", " ")
    .toLowerCase()
    .replaceAll(":", " ")
    .replaceAll("  ", " ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replaceAll("  ", " ");
const noSplit = [
  /^s\d{1,2}(e\d{1,3})+$/,
  /^\d{1,2}x\d{1,3}$/,
  /^e\d{1,3}$/,
  /^ep\d{1,3}$/,
  /^s\d{1,2}$/,
  /^\d{3,4}[pi]$/,
  /^\d+x\d+$/,
  /^\d+(bit|ch|k)$/,
];
const tokenize = (s) =>
  normalize(s.replace(/[_.\-\[\]()+,;~#\s]/g, " "))
    .split(" ")
    .filter(Boolean)
    .flatMap((t) =>
      has("atomicReleaseTokens", t) || noSplit.some((p) => p.test(t))
        ? [t]
        : t.match(/[a-z]+|\d+/g) || [t],
    );
function titleVariants(title, original, allTitles, extras = []) {
  const raws = [
    title,
    original,
    ...Object.entries(allTitles || {})
      .filter(([k]) => has("allowedAlternativeTitleLanguages", k.toLowerCase()))
      .map(([, v]) => v),
    ...extras,
  ].filter(Boolean);
  const full = new Set(),
    variants = new Set();
  const add = (s, set) => {
    const n = normalize(s).trim();
    if ((n.match(/[a-z]/g) || []).length > 1) set.add(n);
  };
  for (const raw of raws) {
    add(raw, full);
    add(raw, variants);
    const parts = raw.split(/\s*[:/|]\s*|\s+-\s+/);
    if (parts.length > 1) parts.forEach((p) => add(p, variants));
  }
  return { variants: [...variants].sort(), fullTitles: [...full].sort() };
}
const patterns = (variants) =>
  [...new Set(variants)]
    .sort()
    .map((v) => v.split(" ").filter((t) => t && !has("stopWords", t)))
    .filter((p) => p.length && !(p.length === 1 && p[0].length <= 3));
function fuzzy(a, b) {
  if (a === b) return true;
  if (
    a.length <= T.fuzzyMinTokenLengthExclusive ||
    Math.abs(a.length - b.length) > 1
  )
    return false;
  if (a.length === b.length)
    return [...a].filter((c, i) => c !== b[i]).length === 1;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i) === b.slice(i + 1);
}
const tokenGate = (p, toks) => {
  const count = p.filter((t) => toks.some((n) => fuzzy(t, n))).length;
  return (
    count === p.length ||
    (p.length > T.tokenGateLenientFromCountExclusive && count >= p.length - 1)
  );
};
const num = (s, n) =>
  typeof s === "string" && new RegExp("^\\d{1," + n + "}$").test(s)
    ? Number(s)
    : null;
function episodeAfter(toks, i) {
  const t = toks[i];
  if (!t) return null;
  for (const prefix of ["ep", "e"])
    if (t.startsWith(prefix) && num(t.slice(prefix.length), 3) !== null)
      return num(t.slice(prefix.length), 3);
  return has("episodeWords", t) ? num(toks[i + 1], 3) : null;
}
function extendRange(lo, hi, i, toks) {
  const t = toks[i + 1];
  if (!t) return [lo, hi];
  let n = null;
  if (t.startsWith("ep")) n = num(t.slice(2), 3);
  else if (t.startsWith("e")) n = num(t.slice(1), 3);
  if (n === null) {
    n = num(t, 3);
    if (n === null || num(toks[i + 2], 1) !== null) return [lo, hi];
  }
  return n > hi && n - lo < T.episodeRangeMaxGapExclusive ? [lo, n] : [lo, hi];
}
function episodeSlot(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i],
      m = /^s(\d{1,2})((?:e\d{1,3})+)$/.exec(t),
      x = /^(\d{1,2})x(\d{1,3})$/.exec(t);
    if (m || x) {
      const eps = m
        ? [...m[2].matchAll(/e(\d{1,3})/g)].map((v) => +v[1])
        : [+x[2]];
      const [lo, hi] = extendRange(eps[0], Math.max(...eps), i, toks);
      return { tag: 0, season: +(m || x)[1], episodeLow: lo, episodeHigh: hi };
    }
  }
  for (let i = 0; i < toks.length; i++) {
    const m = /^s(\d{1,2})$/.exec(toks[i]);
    let season = m ? +m[1] : null;
    if (
      season === null &&
      has("seasonWords", toks[i]) &&
      num(toks[i + 1], 2) !== null
    )
      season = +toks[++i];
    if (season !== null) {
      const ep = episodeAfter(toks, i + 1);
      if (ep !== null)
        return { tag: 0, season, episodeLow: ep, episodeHigh: ep };
    }
  }
  for (let i = 0; i < toks.length; i++) {
    const m = /^s(\d{1,2})$/.exec(toks[i]);
    if (m) {
      const m2 = /^s(\d{1,2})$/.exec(toks[i + 1] || "");
      return {
        tag: 1,
        seasonLow: +m[1],
        seasonHigh: m2 ? Math.max(+m[1], +m2[1]) : +m[1],
        genericPack: false,
      };
    }
    if (has("seasonWords", toks[i]) && num(toks[i + 1], 2) !== null)
      return {
        tag: 1,
        seasonLow: +toks[i + 1],
        seasonHigh: +toks[i + 1],
        genericPack: false,
      };
    if (has("genericPackWords", toks[i]))
      return { tag: 1, seasonLow: 0, seasonHigh: 0, genericPack: true };
  }
  for (let i = 0; i < toks.length; i++) {
    const ep = episodeAfter(toks, i);
    if (ep !== null) return { tag: 2, episode: ep };
  }
  return null;
}
function providerType(name) {
  const s = name.replace(/[_.-]/g, " ");
  if (/trailer|teaser/i.test(s)) return { type: "trailer" };
  for (const r of L.providerEpisodeRegexes) {
    const m = new RegExp(r.pattern).exec(s);
    if (m)
      return {
        type: "episode",
        season: r.season ? +m[r.season] : null,
        episode: +m[r.episode],
      };
  }
  return {
    type: has(
      "providerVideoExtensions",
      name.includes(".") ? name.split(".").at(-1).toLowerCase() : "",
    )
      ? "movie"
      : "other",
  };
}
const isYear = (t) =>
  /^\d{4}$/.test(t) && +t >= T.minYear && +t <= new Date().getFullYear() + 1;
function technical(t, vocab) {
  if (vocab.has(t)) return false;
  return (
    [
      "atomicReleaseTokens",
      "containerTokens",
      "shortLanguageAliases",
      "dubMarkers",
      "subtitleMarkers",
      "seasonPackVocabulary",
    ].some((k) => has(k, t)) ||
    Object.hasOwn(L.languageAliases, t) ||
    L.markerPrefixes.some((p) => t.startsWith(p)) ||
    [
      /^\d{3,4}[pi]$/,
      /^\d+x\d+$/,
      /^s\d{1,2}(e\d{1,3})*$/,
      /^e\d{1,3}$/,
      /^ep\d{1,3}$/,
    ].some((p) => p.test(t)) ||
    ["cd", "dvd"].includes(t) ||
    isYear(t)
  );
}
const fileYear = (toks, vocab, rend) => {
  let i = toks.findIndex((t, i) => isYear(t) && (i >= rend || !vocab.has(t)));
  if (i < 0) i = toks.findIndex((t) => isYear(t) && !vocab.has(t));
  return i < 0 ? null : +toks[i];
};
function placement(p, toks, vocab, rend) {
  const region = toks.slice(0, rend);
  let anchor = -1,
    missing = false,
    count = 0;
  for (const t of p) {
    const pos = region.flatMap((n, i) => (fuzzy(t, n) ? [i] : []));
    if (pos.length) {
      anchor = Math.max(anchor, ...pos);
      if (!/^\d+$/.test(t)) count++;
    } else if (/^\d+$/.test(t)) missing = true;
  }
  const n = p.filter((t) => !/^\d+$/.test(t)).length,
    need = p.length <= 3 ? n : Math.max(n - 1, 0);
  return [
    count < need || anchor < 0 ? "none" : missing ? "missingNumbers" : "usable",
    anchor,
  ];
}
function bonus(toks, vocab) {
  return (
    toks.some((t) => has("bonusWords", t) && !vocab.has(t)) ||
    L.bonusPhrases.some(
      (ph) =>
        toks.some((_, i) => ph.every((t, j) => toks[i + j] === t)) &&
        !ph.every((t) => vocab.has(t)),
    )
  );
}
function finalGate(p, toks, vocab, rend) {
  const [state, anchor] = placement(p, toks, vocab, rend);
  if (state === "none") return null;
  if (state === "missingNumbers")
    for (const t of p)
      if (/^\d+$/.test(t) && !toks.slice(0, rend).some((n) => fuzzy(t, n)))
        return toks.slice(rend).includes(t)
          ? "titleNumberOutsideTitle"
          : "sequelMismatch";
  const region = toks.slice(anchor + 1, rend);
  for (let i = 0; i < region.length; i++) {
    const t = region[i],
      prev = i ? region[i - 1] : toks[anchor];
    if (["cd", "dvd"].includes(prev)) continue;
    const cand =
      /^[2-9]$/.test(t) ||
      has("romanSequelMarkers", t) ||
      has("sequelNumberWords", t) ||
      (has("partMarkers", prev) && (/^\d+$/.test(t) || has("numberWords", t)));
    if (cand && !vocab.has(t)) return "sequelMismatch";
  }
  for (const t of region)
    if (
      /[a-z]/.test(t) &&
      !["stopWords", "genericReleaseWords", "partMarkers"].some((k) =>
        has(k, t),
      ) &&
      !vocab.has(t) &&
      ![...vocab].some((v) => v.length > 4 && fuzzy(v, t))
    )
      return "extraTitleWords";
  return null;
}
function evaluate(req, c) {
  const pats = patterns(req.variants),
    accepted = { bucket: "accepted", reason: null },
    demote = (reason) => ({ bucket: "demoted", reason });
  if (!pats.length) return accepted;
  const nt = tokenize(c.name);
  if (!pats.some((p) => tokenGate(p, nt))) return demote(null);
  const toks = tokenize(c.sourceFilename || c.name),
    vocab = new Set(req.variants.flatMap((v) => v.split(" ").filter(Boolean)));
  if (c.typeHint === "trailer" || bonus(toks, vocab))
    return demote("bonusContent");
  let rend = toks.findIndex((t) => technical(t, vocab));
  if (rend < 0) rend = toks.length;
  const slot = episodeSlot(toks),
    size = c.sizeBytes,
    dur = c.durationSeconds,
    fy = fileYear(toks, vocab, rend);
  if (req.kind === "movie") {
    if (slot && (slot.tag === 0 || (slot.tag === 1 && !slot.genericPack)))
      return demote("seasonEpisodeMismatch");
    if (req.year && fy && Math.abs(fy - req.year) > T.movieYearTolerance)
      return demote("yearMismatch");
    if (size > 0 && size < T.movieMinSizeBytes) return demote("tooSmall");
    if (
      dur > 0 &&
      req.runtimeMinutes > 0 &&
      dur < req.runtimeMinutes * 60 * T.movieMinDurationFractionOfRuntime
    )
      return demote("tooShort");
  } else {
    if (slot?.tag === 0) {
      if (
        slot.season !== req.season ||
        !(slot.episodeLow <= req.episode && req.episode <= slot.episodeHigh)
      )
        return demote("seasonEpisodeMismatch");
    } else if (slot?.tag === 1) return demote("seasonPack");
    else if (slot?.tag === 2) {
      if (req.season === 1 && slot.episode !== req.episode)
        return demote("seasonEpisodeMismatch");
    } else {
      const anchor = Math.max(
        ...pats.map((p) => placement(p, toks, vocab, rend)[1]),
      );
      if (toks.some((t, i) => isYear(t) && !vocab.has(t) && i > anchor))
        return demote("movieInEpisodeSearch");
    }
    if (
      req.seriesStartYear &&
      fy &&
      fy < req.seriesStartYear - T.seriesStartYearTolerance
    )
      return demote("showOlderThanSeries");
    if (size > 0 && size < T.episodeMinSizeBytes) return demote("tooSmall");
  }
  let first = null;
  for (const p of pats.filter((p) => tokenGate(p, nt))) {
    const r = finalGate(p, toks, vocab, rend);
    if (r === null) return accepted;
    first = first || r;
  }
  return demote(first);
}
function filterTrailers(variants, cands) {
  const active = L.trailerMarkers.filter(
    (m) => !variants.some((v) => normalize(v).includes(m)),
  );
  return cands.filter(
    (c) =>
      !active.some((m) => normalize(c.sourceFilename || c.name).includes(m)) &&
      !(active.length === 3 && c.typeHint === "trailer"),
  );
}
function earlyGate(kind, title, year, season, episode, name) {
  const terms = normalize(title)
      .split(" ")
      .filter((t) => t && !has("queryStopWords", t)),
    n = normalize(name);
  if (!terms.every((t) => n.includes(t))) return false;
  if (kind === "movie") {
    const toks = tokenize(name),
      fy = fileYear(toks, new Set(), toks.length);
    return !(year && fy && fy !== year);
  }
  const pt = providerType(name);
  return (
    pt.type === "episode" && pt.season === season && pt.episode === episode
  );
}
module.exports = {
  normalize,
  tokenize,
  titleVariants,
  patterns,
  fuzzy,
  tokenGate,
  episodeSlot,
  providerType,
  evaluate,
  filterTrailers,
  earlyGate,
};
