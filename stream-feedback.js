"use strict";
function streamUploadPayload({ title, episode, provider, providerID, ident, fileName, analysis, confirmedAudioLanguages = [] }) {
  const tracks = analysis?.streams || [];
  const video = tracks.find(t => t.codec_type === "video");
  if (!video || !(video.height >= 240)) throw Object.assign(new Error("Zdroj nemá video v minimálním rozlišení 240p."), { status: 422 });
  const audios = tracks.filter(t => t.codec_type === "audio");
  const primary = Math.max(0, audios.findIndex(t => t.disposition?.default === 1));
  const audio = audios[primary] || {};
  let hdr = video.color_transfer === "smpte2084" ? "HDR10" : video.color_transfer === "arib-std-b67" ? "HLG" : video.color_primaries === "bt2020" ? "HDR" : null;
  if (video.side_data_list?.some(d => d.dv_profile || /dovi|dolby vision/i.test(d.side_data_type || ""))) hdr = "Dolby Vision";
  if (/bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream/i.test(provider) && !ident.startsWith("bombuj|")) ident = `bombuj|${provider.toLowerCase() === "bombuj" ? "voe" : provider.toLowerCase()}|${ident}`;
  const normalized = audios.map(t => normalizeAudioLanguage(t.tags?.language) || normalizeAudioLanguage(t.audio_metadata?.language));
  const unknown = normalized.map((language, i) => language ? null : i).filter(i => i !== null);
  if (!audios.length) throw Object.assign(new Error("Zdroj neobsahuje zvukovou stopu."), { status: 422 });
  if (!Array.isArray(confirmedAudioLanguages) || unknown.length !== confirmedAudioLanguages.length || confirmedAudioLanguages.some(l => !normalizeAudioLanguage(l)))
    throw Object.assign(new Error("Potvrď jazyk každé neznámé zvukové stopy."), { status: 422, code: "audio_confirmation_required", unknownTracks: unknown.map(i => audios[i].index ?? i) });
  let next = 0;
  const resolved = normalized.map(l => l || normalizeAudioLanguage(confirmedAudioLanguages[next++]));
  const languages = [...new Set(resolved)];
  const [num, den = 1] = (video.r_frame_rate || "").split("/").map(Number);
  const finite = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  return { title_id: title.id, provider_id: providerID, source_stream_id: ident, provider_identifier: ident,
    season_number: episode?.season_number ?? null, episode_number: episode?.episode_number ?? null,
    file_name: fileName, available: true, file_size: finite(analysis.file_size || analysis.format?.size) || 0,
    video_width: video.width, video_height: video.height, video_codec: video.codec_name,
    video_bitrate: finite(video.bit_rate), fps: den > 0 && num / den > 0 && num / den < 1000 ? Math.floor(num / den) : null,
    video_hdr: Boolean(hdr), hdr_type: hdr, audio_codec: audio.codec_name, audio_format: audio.codec_name,
    audio_channels: audio.channels, audio_channel_layout: audio.channel_layout, audio_bitrate: finite(audio.bit_rate),
    audio_language: resolved[primary], audio_languages: languages,
    audio_streams: audios.map((t, i) => ({ track_index: i, audio_codec: t.codec_name, audio_channels: t.channels,
      audio_channel_layout: t.channel_layout, audio_bitrate: finite(t.bit_rate), audio_language: resolved[i],
      title: t.tags?.title, default_track: t.disposition?.default === 1, forced_track: t.disposition?.forced === 1 })),
    tags: ["user-added", "ffprobe-analyzed", ...(unknown.length ? ["user-audio-confirmed"] : [])] };
}
function normalizeAudioLanguage(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  const aliases = { cs: "cze", cz: "cze", ces: "cze", czech: "cze", sk: "slk", slo: "slk", slovak: "slk", en: "eng", english: "eng", de: "deu", ger: "deu", german: "deu", pl: "pol", polish: "pol" };
  if (["und", "unk", "unknown"].includes(code)) return null;
  return aliases[code] || (/^[a-z]{2,3}$/.test(code) ? code : null);
}
module.exports = { streamUploadPayload };
