// Pure ranking for the manual picker; never resolves a source or starts playback.
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rank = (s) => s.video_height >= 4320 ? 5 : s.video_height >= 2160 ? 4 : s.video_height >= 1440 ? 3 : s.video_height >= 1080 ? 2 : s.video_height >= 720 ? 1 : 0;
export function sourceKey(s) {
  return s.source_stream_id ? `${String(s.provider_name || "").toLowerCase()}:${s.source_stream_id}` : `${s.origin}:${s.id}`;
}
function bitrate(s, ctx) {
  if (s.file_size > 0 && ctx.runtimeMinutes > 0) return s.file_size * 8 / (ctx.runtimeMinutes * 60) / 1e6;
  const codec = String(s.video_codec || "").toLowerCase();
  const factor = codec.includes("av1") ? .65 : /265|hevc/.test(codec) ? 1 : /264|avc/.test(codec) ? 1.7 : 1.2;
  return [2, 5, 10, 16, 35, 80][rank(s)] * factor;
}
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
export function recommendedStreams(streams, ctx, playable = () => true) {
  const cap = Math.min(ctx.displayMaxRank ?? 4, ctx.preferredMaxRank ?? 5);
  const speed = Number.isFinite(ctx.downlinkMbps) && ctx.downlinkMbps > 0 ? ctx.downlinkMbps * .7 : null;
  const seen = new Set();
  return streams.filter(s => {
    if (s.origin < 2 || s.available === false || !playable(s) || rank(s) > cap || (speed !== null && bitrate(s, ctx) > speed) || !identityMatches(s, ctx)) return false;
    if (ctx.preferredLanguage && !(s.audio_languages || [s.audio_language]).some(l => String(l || "").toLowerCase() === ctx.preferredLanguage)) return false;
    const key = sourceKey(s);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => rank(b) - rank(a) || Number(Boolean(ctx.wideColor && b.hdr_type)) - Number(Boolean(ctx.wideColor && a.hdr_type)) || (b.file_size || 0) - (a.file_size || 0)).slice(0, 3);
}
export function streamPickerSections(streams, ctx, playable = () => true) {
  const recommended = ctx ? recommendedStreams(streams, ctx, playable) : [];
  const ids = new Set(recommended.map(sourceKey));
  const groups = new Map();
  for (const stream of streams) {
    if (ids.has(sourceKey(stream))) continue;
    const key = stream.origin < 2 ? `db:${stream.origin}` : `provider:${stream.provider_name || stream.provider_identifier || stream.origin}`;
    if (!groups.has(key)) groups.set(key, { key, origin: stream.origin, name: stream.origin === 0 ? "Databáze" : stream.origin === 1 ? "Databáze AI" : stream.provider_name || stream.provider_identifier || "Další poskytovatelé a doplňky", streams: [] });
    groups.get(key).streams.push(stream);
  }
  const database = [...groups.values()].filter(g => g.origin < 2).sort((a, b) => a.origin - b.origin);
  const providers = [...groups.values()].filter(g => g.origin >= 2);
  return [...database, ...(recommended.length ? [{ key: "recommended", name: "Doporučené", streams: recommended }] : []), ...providers];
}
