// Stream scoring — doporučené skóre, řazení a facety podle sdíleného kontraktu
// shebincze/Movly contracts/stream-relevance (README „Stream scoring“, scoring.json).
// Čisté funkce bez DOM; stejné vstupy jako StreamScoring na Apple, Android a Windows.
// TABLES je doslovná kopie scoring.json → tables; stream-scoring.test.js ji porovnává
// s test-support/stream-scoring.fixtures.json a prochází všechny sekce fixtures.
export const TABLES = Object.freeze({
  tolerance: 1e-6,
  bitrateCenters: [2.5, 6.5, 12.5, 20, 32.5, 100],
  bitrateSigmas: [1.5, 3, 5, 8, 15, 50],
  adaptationRatios: [0.9, 0.85, 0.8, 0.75, 0.72, 0.7],
  safeRatio: 0.8,
  overloadRatio: 0.9,
  closenessTolerance: 0.3,
  closenessBonus: 3,
  tierPenalty: 2,
  overloadPenalty: 5,
  bitrateMinMbps: 0.1,
  bitrateMaxMbps: 200,
  durationMinSeconds: 60,
  durationMaxSeconds: 86400,
  filterPenalty: -200,
  forcedLanguageScore: 1100,
  primaryLanguageScore: 100,
  secondaryLanguageScore: 50,
  recommendedLimit: 3,
  weights: [0, 1, 2, 4, 8],
  criteria: ["quality", "bitrate", "size", "sizeSmall", "audioLanguage", "subtitleLanguage", "forcedSubtitles", "audioChannels",
    "audioCodecPreference", "videoCodecPreference", "hdr", "sdr", "recommendedScore", "bitrateFit", "adaptation", "database", "durationMatch"],
  dynamicRangeScores: { DV: 1, "HDR10+": 0.8, HDR10: 0.6, HLG: 0.5, SDR: 0 },
  languageCodes: {
    cz: "cs", cze: "cs", ces: "cs", czech: "cs", cesky: "cs", ceske: "cs",
    sk: "sk", slo: "sk", slk: "sk", svk: "sk", slovensky: "sk", slovak: "sk",
    en: "en", eng: "en", english: "en", anglicky: "en",
    ger: "de", deu: "de", german: "de", nemecky: "de",
    fre: "fr", fra: "fr", french: "fr", spa: "es", esp: "es", spanish: "es", ita: "it", italian: "it",
    rus: "ru", russian: "ru", polish: "pl", polski: "pl", hun: "hu", hungarian: "hu", ukr: "uk",
    jpn: "ja", jap: "ja", kor: "ko", chi: "zh", zho: "zh", dan: "da", swe: "sv", nor: "no", fin: "fi",
    dut: "nl", nld: "nl", por: "pt", tur: "tr", ara: "ar", heb: "he", hin: "hi", tha: "th", gre: "el", ell: "el",
    rum: "ro", ron: "ro", bul: "bg", srp: "sr", hrv: "hr", slv: "sl", lit: "lt", lav: "lv", est: "et",
  },
});

const known = (v) => v !== null && v !== undefined;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// ---------------------------------------------------------------- pomocné funkce

export function languageCode(token) {
  if (!known(token)) return null;
  let s = String(token).trim().toLowerCase();
  const pair = /^([a-z]{2,3})[-_][a-z]{2}$/.exec(s);
  if (pair) s = pair[1];
  if (own(TABLES.languageCodes, s)) return TABLES.languageCodes[s];
  return /^[a-z]{2}$/.test(s) ? s : null;
}

export const codecKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Index první položky seznamu, jejíž codecKey je neprázdný podřetězec codecKey(codec).
function listIndex(list, codec) {
  const key = codecKey(codec);
  const items = list || [];
  for (let i = 0; i < items.length; i++) {
    const item = codecKey(items[i]);
    if (item && key.includes(item)) return i;
  }
  return null;
}

export function dynamicRange(hdr) {
  if (!hdr) return "SDR";
  const k = codecKey(hdr);
  if (k.includes("dolbyvision") || k.includes("dovi") || k === "dv") return "DV";
  if (k.includes("hdr10plus") || String(hdr).toLowerCase().includes("hdr10+")) return "HDR10+";
  if (k.includes("hlg")) return "HLG";
  if (k.includes("hdr")) return "HDR10";
  return "SDR";
}

// Bez lookbehind (starší Safari ho nezná): číslice před shodou vylučuje skupina 1.
export function channelsFromName(name) {
  const match = /(^|[^0-9])([1-9])\.([0-9])(?![0-9])/.exec(String(name ?? ""));
  if (match) return Number(match[2]) + Number(match[3]);
  return String(name ?? "").toLowerCase().includes("atmos") ? 8 : null;
}

export function effectiveBitrateMbps(c) {
  const kb = c.bitrateKbps, size = c.sizeBytes, duration = c.durationSeconds;
  let b;
  if (known(kb) && kb > 0) b = kb / 1000;
  else if (known(size) && size > 0 && known(duration) && duration >= TABLES.durationMinSeconds && duration <= TABLES.durationMaxSeconds)
    b = size * 8 / duration / 1000000;
  else return null;
  return b >= TABLES.bitrateMinMbps && b <= TABLES.bitrateMaxMbps ? b : null;
}

export function isHEVC(videoCodec) {
  const k = codecKey(videoCodec);
  return k.includes("hevc") || k.includes("h265") || k.includes("x265");
}

const hasAtmos = (c) => (c.audioTracks || []).some((t) => codecKey(t.codec).includes("atmos"));

// `>x` a `<x` ostře, `a:b` včetně mezí; neplatný zápis → null (filtr se ignoruje).
export function parseRange(spec) {
  if (!known(spec)) return null;
  const s = String(spec).trim();
  let m = /^>\s*(\d+)$/.exec(s);
  if (m) return { min: Number(m[1]), max: null, minExclusive: true, maxExclusive: false };
  m = /^<\s*(\d+)$/.exec(s);
  if (m) return { min: null, max: Number(m[1]), minExclusive: false, maxExclusive: true };
  m = /^(\d+)\s*:\s*(\d+)$/.exec(s);
  if (m) return { min: Number(m[1]), max: Number(m[2]), minExclusive: false, maxExclusive: false };
  return null;
}

function outOfRange(v, r) {
  if (known(r.min) && (r.minExclusive ? v <= r.min : v < r.min)) return true;
  if (known(r.max) && (r.maxExclusive ? v >= r.max : v > r.max)) return true;
  return false;
}

const codes = (tracks) => new Set((tracks || []).map((t) => languageCode(t.language)).filter(Boolean));
export const audioCodes = (c) => codes(c.audioTracks);
export const subtitleCodes = (c) => codes(c.subtitleTracks);
const linkSpeed = (st) => (known(st.linkSpeedMbps) && st.linkSpeedMbps > 0 ? st.linkSpeedMbps : null);

// ---------------------------------------------------------------- skóre

export function score(st, c) {
  const rank = known(c.qualityRank) ? c.qualityRank : null;
  const b = effectiveBitrateMbps(c), link = linkSpeed(st);
  const centers = TABLES.bitrateCenters, sigmas = TABLES.bitrateSigmas;
  const cap = known(st.qualityCap) ? st.qualityCap : null, dmax = known(st.displayMaxRank) ? st.displayMaxRank : null;
  // 1. quality
  const quality = rank === null ? 0 : dmax !== null && rank > dmax ? 0 : cap === null ? rank + 1 : rank <= cap ? rank + 2 : 0;
  // 2. bitrate
  let bitrate = 0;
  if (b !== null) {
    const safe = link !== null ? link * TABLES.safeRatio : null;
    if (safe !== null && b > safe) bitrate = Math.max(0, 10 - 20 * (b - safe) / safe);
    else if (rank !== null) {
      const center = centers[rank], sigma = sigmas[rank];
      let g = 10 * Math.exp(-((b - center) ** 2) / (2 * sigma * sigma));
      if (center - sigma <= b && b <= center + sigma) g += 1;
      bitrate = Math.min(10, g);
    }
  }
  // 3. adaptation
  let adaptation = 0;
  if (link !== null) {
    let recommended = null;
    for (let t = 0; t < centers.length; t++) if (centers[t] <= link * TABLES.adaptationRatios[t]) recommended = t;
    if (recommended !== null) {
      if (rank !== null && rank > recommended) adaptation -= TABLES.tierPenalty * (rank - recommended);
      if (b !== null) {
        const target = centers[recommended];
        const d = Math.abs(b - target) / (TABLES.closenessTolerance * target);
        if (d <= 1) adaptation += TABLES.closenessBonus * (1 - d);
        if (b > TABLES.overloadRatio * link) adaptation -= TABLES.overloadPenalty;
      }
    }
  }
  // 4. language
  const A = audioCodes(c);
  const language = known(st.forcedLanguage) && A.has(st.forcedLanguage) ? TABLES.forcedLanguageScore
    : known(st.primaryLanguage) && A.has(st.primaryLanguage) ? TABLES.primaryLanguageScore
      : known(st.secondaryLanguage) && A.has(st.secondaryLanguage) ? TABLES.secondaryLanguageScore : 0;
  // 5. audio
  const tracks = c.audioTracks || [];
  const audio = tracks.length ? Math.max(...tracks.map((t) => {
    let s = 0;
    if (listIndex(st.audioCodecWhitelist, t.codec) !== null) s += 1;
    if (listIndex(st.audioCodecBlacklist, t.codec) !== null) s -= 10;
    if (known(t.channels) && t.channels > 3) s += t.channels - 3;
    return s;
  })) : 0;
  // 6. video
  let video = 0;
  const wl = listIndex(st.videoCodecWhitelist, c.videoCodec);
  if (wl !== null) video += Math.max(1, 5 - wl);
  if (listIndex(st.videoCodecBlacklist, c.videoCodec) !== null) video -= 10;
  if (dynamicRange(c.hdr) !== "SDR") {
    if (st.excludeHDR) video -= 10;
    if (st.preferHDR) video += 1;
  }
  // 7. filters (nikdy neodstraňují, jen −200 za každý porušený)
  const f = st.filters || {};
  let violations = 0;
  let r = parseRange(f.bitrateRangeKbps);
  if (r && b !== null && outOfRange(b * 1000, r)) violations++;
  r = parseRange(f.sizeRangeBytes);
  if (r && known(c.sizeBytes) && c.sizeBytes > 0 && outOfRange(c.sizeBytes, r)) violations++;
  if (f.excludeHEVC && isHEVC(c.videoCodec)) violations++;
  if (f.exclude3D && c.is3D) violations++;
  if (f.atmosOnly && !hasAtmos(c)) violations++;
  const filters = TABLES.filterPenalty * violations;
  return { quality, bitrate, adaptation, language, audio, video, filters,
    total: quality + bitrate + adaptation + language + audio + video + filters };
}

// ---------------------------------------------------------------- řazení

// Sestupně, null za známou hodnotou.
function compareDesc(a, b) {
  const ka = known(a), kb = known(b);
  if (!ka || !kb) return ka === kb ? 0 : ka ? -1 : 1;
  return a === b ? 0 : a > b ? -1 : 1;
}

function stableOrder(n, compare) {
  return Array.from({ length: n }, (_, i) => i).sort((i, j) => compare(i, j) || i - j);
}

export function effectiveWeight(w) {
  const allowed = [...TABLES.weights].sort((a, b) => a - b);
  let best = allowed[0];
  for (const a of allowed) if (a <= w) best = a;
  return best;
}

function preferenceValue(whitelist, blacklist, codec) {
  const i = listIndex(whitelist, codec);
  if (i !== null) return Math.max(1, 5 - i);
  return listIndex(blacklist, codec) !== null ? 0 : null;
}

function criterionValue(key, st, c, breakdown) {
  const size = known(c.sizeBytes) && c.sizeBytes > 0 ? c.sizeBytes : null;
  switch (key) {
    case "quality": return known(c.qualityRank) ? c.qualityRank : null;
    case "bitrate": return effectiveBitrateMbps(c);
    case "size": return size;
    case "sizeSmall": return size === null ? null : -size;
    case "audioLanguage": {
      const A = audioCodes(c);
      return known(st.primaryLanguage) && A.has(st.primaryLanguage) ? 1 : known(st.secondaryLanguage) && A.has(st.secondaryLanguage) ? 0.5 : 0;
    }
    case "subtitleLanguage": {
      const S = subtitleCodes(c);
      return known(st.primaryLanguage) && S.has(st.primaryLanguage) ? 1 : known(st.secondaryLanguage) && S.has(st.secondaryLanguage) ? 0.5 : 0;
    }
    case "forcedSubtitles": {
      const code = known(st.forcedLanguage) ? st.forcedLanguage : known(st.primaryLanguage) ? st.primaryLanguage : null;
      if (code === null) return 0;
      return (c.subtitleTracks || []).some((t) => t.forced && languageCode(t.language) === code) ? 1 : 0;
    }
    case "audioChannels": {
      const channels = (c.audioTracks || []).map((t) => t.channels).filter(known);
      return channels.length ? Math.max(...channels) : null;
    }
    case "audioCodecPreference": {
      const values = (c.audioTracks || []).map((t) => preferenceValue(st.audioCodecWhitelist, st.audioCodecBlacklist, t.codec)).filter(known);
      return values.length ? Math.max(...values) : null;
    }
    case "videoCodecPreference": return preferenceValue(st.videoCodecWhitelist, st.videoCodecBlacklist, c.videoCodec);
    case "hdr": return TABLES.dynamicRangeScores[dynamicRange(c.hdr)];
    case "sdr": return dynamicRange(c.hdr) === "SDR" ? 1 : 0;
    case "recommendedScore": return breakdown.total;
    case "bitrateFit": return breakdown.bitrate;
    case "adaptation": return breakdown.adaptation;
    case "database": return c.isDatabase ? 1 : 0;
    case "durationMatch": {
      const runtime = st.runtimeMinutes, duration = c.durationSeconds;
      if (known(runtime) && runtime > 0 && known(duration) && duration > 0)
        return 1 - Math.min(1, Math.abs(duration - runtime * 60) / (runtime * 60));
      return null;
    }
    default: throw new Error(`Neznámé kritérium řazení: ${key}`);
  }
}

const FIXED = { quality: 5, audioChannels: 8, audioCodecPreference: 5, videoCodecPreference: 5, bitrateFit: 10 };
const RELATIVE = new Set(["bitrate", "size", "sizeSmall", "recommendedScore", "adaptation"]);

function normalized(key, values) {
  if (RELATIVE.has(key)) {
    const present = values.filter(known);
    if (!present.length) return values;
    const lo = Math.min(...present), hi = Math.max(...present);
    return values.map((v) => (!known(v) ? null : hi === lo ? 1 : (v - lo) / (hi - lo)));
  }
  const div = FIXED[key];
  if (key === "audioChannels") return values.map((v) => (known(v) ? Math.min(1, v / div) : null));
  if (div) return values.map((v) => (known(v) ? v / div : null));
  return values;
}

// Vrací indexy kandidátů v novém pořadí; spec = {mode, normalization?, weights?}.
export function sortOrder(st, spec, candidates) {
  const n = candidates.length;
  const mode = spec.mode;
  if (mode === "quality")
    return stableOrder(n, (i, j) => compareDesc(candidates[i].qualityRank, candidates[j].qualityRank)
      || compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes));
  if (mode === "size") return stableOrder(n, (i, j) => compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes));
  const breakdowns = candidates.map((c) => score(st, c));
  if (mode === "recommended")
    return stableOrder(n, (i, j) => compareDesc(breakdowns[i].total, breakdowns[j].total)
      || compareDesc(candidates[i].qualityRank, candidates[j].qualityRank)
      || compareDesc(candidates[i].sizeBytes, candidates[j].sizeBytes));
  if (mode !== "custom") throw new Error(`Neznámý režim řazení: ${mode}`);
  const weights = {};
  for (const [key, w] of Object.entries(spec.weights || {})) weights[key] = effectiveWeight(w);
  const active = TABLES.criteria.filter((key) => (weights[key] || 0) > 0);
  const norm = {};
  for (const key of active) norm[key] = normalized(key, candidates.map((c, i) => criterionValue(key, st, c, breakdowns[i])));
  if ((spec.normalization || "lexicographic") === "weighted") {
    const totals = Array.from({ length: n }, (_, i) => active.reduce((sum, key) => sum + weights[key] * (norm[key][i] || 0), 0));
    return stableOrder(n, (i, j) => compareDesc(totals[i], totals[j]));
  }
  const order = [...active].sort((a, b) => weights[b] - weights[a] || TABLES.criteria.indexOf(a) - TABLES.criteria.indexOf(b));
  return stableOrder(n, (i, j) => {
    for (const key of order) {
      const c = compareDesc(norm[key][i], norm[key][j]);
      if (c) return c;
    }
    return 0;
  });
}

export function sortBy(st, spec, items, candidateOf) {
  return sortOrder(st, spec, items.map(candidateOf)).map((i) => items[i]);
}

// ---------------------------------------------------------------- facety

// OR uvnitř dimenze, AND mezi dimenzemi; prázdný výsledek neprázdného filtru → vše a relaxed.
export function applyFacets(filter, items, candidateOf = (x) => x) {
  const languages = filter.languages || [], resolutions = filter.resolutions || [], ranges = filter.dynamicRanges || [];
  const kept = items.filter((item) => {
    const c = candidateOf(item);
    if (languages.length) {
      const A = audioCodes(c), S = subtitleCodes(c);
      if (!languages.some((t) => (t.startsWith("audio_") && A.has(t.slice(6))) || (t.startsWith("sub_") && S.has(t.slice(4))))) return false;
    }
    if (resolutions.length && !(known(c.qualityRank) && resolutions.includes(c.qualityRank))) return false;
    if (ranges.length && !ranges.includes(dynamicRange(c.hdr))) return false;
    return true;
  });
  if ((languages.length || resolutions.length || ranges.length) && !kept.length) return { items, relaxed: true };
  return { items: kept, relaxed: false };
}
