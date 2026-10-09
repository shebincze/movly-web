"use strict";
function streamUploadPayload({ title, episode, provider, providerID, ident, fileName, analysis }) {
  const tracks = analysis?.streams || [];
  const video = tracks.find(t => t.codec_type === "video");
  if (!video || !(video.height >= 240)) throw Object.assign(new Error("Zdroj nemá video v minimálním rozlišení 240p."), { status: 422 });
  const audios = tracks.filter(t => t.codec_type === "audio");
  const audio = audios[0] || {};
  let hdr = video.color_transfer === "smpte2084" ? "HDR10" : video.color_transfer === "arib-std-b67" ? "HLG" : video.color_primaries === "bt2020" ? "HDR" : null;
  if (video.side_data_list?.some(d => d.dv_profile || /dovi|dolby vision/i.test(d.side_data_type || ""))) hdr = "Dolby Vision";
  if (/bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream/i.test(provider) && !ident.startsWith("bombuj|")) ident = `bombuj|${provider.toLowerCase() === "bombuj" ? "voe" : provider.toLowerCase()}|${ident}`;
  const languages = [...new Set(audios.map(t => t.tags?.language).filter(l => l && l !== "und"))];
  const [num, den = 1] = (video.r_frame_rate || "").split("/").map(Number);
  const finite = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  return { title_id: title.id, provider_id: providerID, source_stream_id: ident, provider_identifier: ident,
    season_number: episode?.season_number ?? null, episode_number: episode?.episode_number ?? null,
    file_name: fileName, available: true, file_size: finite(analysis.file_size || analysis.format?.size) || 0,
    video_width: video.width, video_height: video.height, video_codec: video.codec_name,
    video_bitrate: finite(video.bit_rate), fps: den > 0 && num / den > 0 && num / den < 1000 ? Math.floor(num / den) : null,
    video_hdr: Boolean(hdr), hdr_type: hdr, audio_codec: audio.codec_name, audio_format: audio.codec_name,
    audio_channels: audio.channels, audio_channel_layout: audio.channel_layout, audio_bitrate: finite(audio.bit_rate),
    audio_language: languages[0] || null, audio_languages: languages,
    audio_streams: audios.map((t, i) => ({ track_index: i, audio_codec: t.codec_name, audio_channels: t.channels,
      audio_channel_layout: t.channel_layout, audio_bitrate: finite(t.bit_rate), audio_language: t.tags?.language,
      title: t.tags?.title, default_track: t.disposition?.default === 1, forced_track: t.disposition?.forced === 1 })),
    tags: ["user-added", "ffprobe-analyzed"] };
}
module.exports = { streamUploadPayload };
