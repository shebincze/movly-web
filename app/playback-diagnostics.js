// Closed diagnostic vocabulary. Never copy raw messages, URLs or HLS payloads.
const stages = new Set(["source_resolve", "video_analysis", "playback"]);
const providers = new Set(["webshare", "hellspy", "fastshare", "sosac", "stremio", "prehrajto"]);
export function playbackDiagnostics(stage, provider, error = {}, code = null) {
  stage = stages.has(stage) ? stage : "playback";
  provider = providers.has(String(provider).toLowerCase()) ? String(provider).toLowerCase() : "other";
  const at = new Date().toISOString();
  const status = Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  const codes = new Set(["source_resolve_failed", "video_analysis_failed", "playback_failed", "playback_prepare_failed", "playback_prepare_timeout", "hls_network_failed", "hls_media_failed", "hls_other_failed", "browser_hls_unsupported"]);
  const mediaCode = Number.isInteger(error.mediaCode) && error.mediaCode >= 1 && error.mediaCode <= 4 ? `browser_media_${error.mediaCode}` : null;
  code = mediaCode || (codes.has(code) ? code : `${stage}_failed`);
  return { app_version: "web-v1", os_version: "", screen: "player", device: "Web browser", provider, occurred_at: at, stage, error_code: code,
    ...(status ? { http_status: status } : {}), log: [{ at, stage, code, ...(status ? { http_status: status } : {}) }] };
}
