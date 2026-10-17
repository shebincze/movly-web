// Pure ranking for the manual picker; never resolves a source or starts playback.
// Pořadí, doporučení a facety jdou přes kontrakt Stream scoring (stream-scoring.js);
// verdikt relevance posílá provider-resolver (shebincze/Movly#1100).
import { TABLES, applyFacets, channelsFromName, dynamicRange, languageCode, score, sortBy } from "./stream-scoring.js";

const normalize = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const known = (v) => v !== null && v !== undefined;
export function sourceKey(s) {
  return s.source_stream_id ? `${String(s.provider_name || "").toLowerCase()}:${s.source_stream_id}` : `${s.origin}:${s.id}`;
}

// „Podobné" = demoted verdikt sdílené relevance. Bez verdiktu (provider mimo pipeline,
// databáze, Node adaptéry) položka zůstává mezi ostatními.
export const isDemoted = (s) => s?.relevance?.bucket === "demoted";
export const SIMILAR_SECTION = "Podobné";
const REASON_LABELS = {
  bonusContent: "bonus / trailer",
  seasonEpisodeMismatch: "jiná epizoda",
  seasonPack: "celá sezóna",
  movieInEpisodeSearch: "film místo epizody",
  yearMismatch: "jiný rok",
  showOlderThanSeries: "starší než seriál",
  tooSmall: "příliš malý",
  tooShort: "příliš krátký",
  sequelMismatch: "jiný díl série",
  titleNumberOutsideTitle: "číslo mimo název",
  extraTitleWords: "slova navíc",
};
export const demotionLabel = (s) => REASON_LABELS[s?.relevance?.reason] || "název nesedí";

// 0–5 rank z výšky videa nebo štítku kvality; neznámá kvalita → null (nikdy 0).
export function qualityRank(s) {
  if (known(s.scoring?.quality_rank)) return s.scoring.quality_rank;
  const h = Number(s.video_height) || 0;
  if (h) return h >= 4320 ? 5 : h >= 2160 ? 4 : h >= 1440 ? 3 : h >= 1080 ? 2 : h >= 720 ? 1 : 0;
  const q = String(s.quality || "").toLowerCase();
  return /4320|8k/.test(q) ? 5 : /2160|4k|uhd/.test(q) ? 4 : /1440|2k|qhd/.test(q) ? 3 : /1080|fhd|full ?hd/.test(q) ? 2
    : /720|\bhd\b/.test(q) ? 1 : /480|576|360|\bsd\b/.test(q) ? 0 : null;
}

const THREE_D = new Set(["3d", "hsbs", "hou", "sbs"]);
const LANGUAGE_SEPARATORS = /[,/+;|]/;

// Kandidát kontraktu: z `scoring` resolveru, jinak ze stávajících polí (databáze,
// Webshare/Hellspy). Délka od providera, jinak runtime titulu (shodně s Windows).
export function scoringCandidate(s, runtimeMinutes) {
  const runtime = runtimeMinutes > 0 ? runtimeMinutes * 60 : null;
  const sc = s.scoring;
  if (sc) return {
    qualityRank: known(sc.quality_rank) ? sc.quality_rank : null, hdr: sc.hdr ?? null,
    sizeBytes: sc.size_bytes > 0 ? sc.size_bytes : null, durationSeconds: sc.duration_seconds > 0 ? sc.duration_seconds : runtime,
    bitrateKbps: sc.bitrate_kbps > 0 ? sc.bitrate_kbps : null, videoCodec: sc.video_codec ?? null,
    audioTracks: (sc.audio_tracks || []).map((t) => ({ language: t.language ?? null, codec: t.codec ?? null, channels: known(t.channels) ? t.channels : null })),
    subtitleTracks: (sc.subtitle_tracks || []).map((t) => ({ language: t.language ?? null, forced: Boolean(t.forced) })),
    is3D: Boolean(sc.is_3d), isDatabase: Boolean(sc.is_database),
  };
  const name = s.file_name || "";
  const channels = channelsFromName(name);
  const languages = (Array.isArray(s.audio_languages) ? s.audio_languages : s.audio_language ? [s.audio_language] : [])
    .flatMap((l) => String(l || "").split(LANGUAGE_SEPARATORS)).map((l) => l.trim()).filter(Boolean);
  const audioTracks = languages.map((language) => ({ language, codec: s.audio_codec ?? null, channels }));
  if (!audioTracks.length && s.audio_codec) audioTracks.push({ language: null, codec: s.audio_codec, channels });
  const subtitles = Array.isArray(s.subtitle_languages) ? s.subtitle_languages : [];
  return {
    qualityRank: qualityRank(s), hdr: s.hdr_type || null, sizeBytes: s.file_size > 0 ? s.file_size : null,
    durationSeconds: s.duration_seconds > 0 ? s.duration_seconds : runtime, bitrateKbps: s.bitrate_kbps > 0 ? s.bitrate_kbps : null,
    videoCodec: s.video_codec || null, audioTracks,
    subtitleTracks: subtitles.filter(Boolean).map((language) => ({ language, forced: false })),
    is3D: name.toLowerCase().split(/[^a-z0-9]+/).some((token) => THREE_D.has(token)), isDatabase: s.origin < 2,
  };
}

// Settings kontraktu z toho, co web zná: naměřený downlink, strop displeje, HDR panel,
// jazyk rozhraní jako primární jazyk a runtime titulu. Web nemá kodekové seznamy ani filtry.
export function scoringSettings(ctx = {}) {
  return {
    linkSpeedMbps: Number.isFinite(ctx.downlinkMbps) && ctx.downlinkMbps > 0 ? ctx.downlinkMbps : null,
    qualityCap: known(ctx.qualityCap) ? ctx.qualityCap : null,
    displayMaxRank: known(ctx.displayMaxRank) ? ctx.displayMaxRank : null,
    primaryLanguage: languageCode(ctx.primaryLanguage), secondaryLanguage: languageCode(ctx.secondaryLanguage), forcedLanguage: null,
    audioCodecWhitelist: [], audioCodecBlacklist: [], videoCodecWhitelist: [], videoCodecBlacklist: [],
    preferHDR: Boolean(ctx.wideColor), excludeHDR: false, filters: {},
    runtimeMinutes: ctx.runtimeMinutes > 0 ? ctx.runtimeMinutes : null,
  };
}

// Starší striktní shoda názvu jen pro položky bez verdiktu relevance.
function identityMatches(s, ctx) {
  const name = normalize(s.file_name);
  const names = [ctx.title, ctx.originalTitle].map(normalize).filter(Boolean);
  if (!names.length || !names.some(t => name === t || name.startsWith(`${t} `))) return false;
  if (ctx.season > 0 && ctx.episode > 0) {
    const episode = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?!\d)|(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?!\d)/i.exec(s.file_name || "");
    return Boolean(episode && Number(episode[1] || episode[3]) === ctx.season && Number(episode[2] || episode[4]) === ctx.episode);
  }
  const years = String(s.file_name || "").match(/\b(?:19|20)\d{2}\b/g) || [];
  return !ctx.year || !years.length || years.includes(String(ctx.year));
}

// Smí jít do „Doporučené"/auto-výběru? Accepted ano, demoted nikdy, bez verdiktu
// starší kontrola názvu. Primární jazyk je tvrdá podmínka (jako StreamAutoSelector).
export function eligible(s, ctx) {
  if (isDemoted(s)) return false;
  const settings = scoringSettings(ctx);
  if (settings.primaryLanguage) {
    const codes = scoringCandidate(s, ctx.runtimeMinutes).audioTracks.map((t) => languageCode(t.language));
    if (!codes.includes(settings.primaryLanguage)) return false;
  }
  if (s.origin < 2) return true;
  if (s.relevance?.bucket === "accepted") return true;
  return identityMatches(s, ctx);
}

export function sortStreams(streams, mode, ctx = {}) {
  const candidate = (s) => scoringCandidate(s, ctx.runtimeMinutes);
  return sortBy(scoringSettings(ctx), typeof mode === "string" ? { mode } : mode, streams, candidate);
}

export function facetStreams(streams, filter, ctx = {}) {
  return applyFacets(filter, streams, (s) => scoringCandidate(s, ctx.runtimeMinutes));
}

// Hodnoty facet z aktuálních výsledků (kódy jazyků, ranky, dynamický rozsah).
export function facetOptions(streams, ctx = {}) {
  const candidates = streams.map((s) => scoringCandidate(s, ctx.runtimeMinutes));
  const sorted = (values) => [...new Set(values.filter(known))].sort();
  return {
    audio: sorted(candidates.flatMap((c) => c.audioTracks.map((t) => languageCode(t.language)))),
    subtitles: sorted(candidates.flatMap((c) => c.subtitleTracks.map((t) => languageCode(t.language)))),
    resolutions: [...new Set(candidates.map((c) => c.qualityRank).filter(known))].sort((a, b) => a - b),
    dynamicRanges: ["SDR", "HLG", "HDR10", "HDR10+", "DV"].filter((range) => candidates.some((c) => dynamicRange(c.hdr) === range)),
  };
}

// „Doporučené": způsobilé živé zdroje seřazené `recommended`, bez DB, s total ≥ 0, bez duplicit.
export function recommendedStreams(streams, ctx, playable = () => true) {
  const settings = scoringSettings(ctx);
  const ranked = sortStreams(streams.filter(s => s.origin >= 2 && s.available !== false && playable(s) && eligible(s, ctx)), "recommended", ctx);
  const seen = new Set();
  return ranked.filter(s => {
    if (score(settings, scoringCandidate(s, ctx.runtimeMinutes)).total < 0) return false;
    const key = sourceKey(s);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, TABLES.recommendedLimit);
}

// Pořadí sekcí jako Windows StreamPicker: databáze, Doporučené, provideři, Podobné.
export function streamPickerSections(streams, ctx, playable = () => true) {
  const recommended = ctx ? recommendedStreams(streams, ctx, playable) : [];
  const ids = new Set(recommended.map(sourceKey));
  const groups = new Map(), similar = [];
  for (const stream of streams) {
    if (ids.has(sourceKey(stream))) continue;
    if (isDemoted(stream)) { similar.push(stream); continue; }
    const key = stream.origin < 2 ? `db:${stream.origin}` : `provider:${stream.provider_name || stream.provider_identifier || stream.origin}`;
    if (!groups.has(key)) groups.set(key, { key, origin: stream.origin, name: stream.origin === 0 ? "Databáze" : stream.origin === 1 ? "Databáze AI" : stream.provider_name || stream.provider_identifier || "Další poskytovatelé a doplňky", streams: [] });
    groups.get(key).streams.push(stream);
  }
  const database = [...groups.values()].filter(g => g.origin < 2).sort((a, b) => a.origin - b.origin);
  const providers = [...groups.values()].filter(g => g.origin >= 2);
  return [...database, ...(recommended.length ? [{ key: "recommended", name: "Doporučené", streams: recommended }] : []), ...providers,
    ...(similar.length ? [{ key: "similar", name: SIMILAR_SECTION, streams: similar }] : [])];
}
