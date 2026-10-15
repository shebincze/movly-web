import { playbackOwner } from "./playback-memory.js";

const providers = new Set(["webshare", "hellspy", "fastshare", "sosac", "stremio"]);
// This is the existing anonymous quality-counter contract, not a raw crash report.
export function playbackFailureEvent(diagnostic) {
  const event = diagnostic?.stage === "source_resolve" ? "stream_resolve"
    : diagnostic?.stage === "video_analysis" || ["playback_prepare_failed", "playback_prepare_timeout", "browser_hls_unsupported"].includes(diagnostic?.error_code)
      ? "media_opened" : "playing";
  return { event, outcome: diagnostic?.error_code === "playback_prepare_timeout" ? "timeout" : "failure",
    duration_ms: 0, provider: providers.has(diagnostic?.provider) ? diagnostic.provider : "" };
}

// At most one best-effort report per playback attempt; never alter playback/auth UI.
export function createPlaybackFailureReporter(owner, fetcher = globalThis.fetch) {
  let sent = false;
  return async diagnostic => {
    const active = playbackOwner();
    if (sent || !owner || !active || active.generation !== owner.generation
      || active.accountId !== owner.accountId || active.profileId !== owner.profileId) return false;
    sent = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetcher("/api/app/telemetry/client", { method: "POST", credentials: "same-origin", cache: "no-store",
        signal: controller.signal, headers: { "Content-Type": "application/json", "X-Movly-App": "1",
          "X-Movly-Expected-Account": String(owner.accountId), "X-Movly-Expected-Profile": String(owner.profileId) },
        body: JSON.stringify(playbackFailureEvent(diagnostic)) });
      return response.ok;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  };
}
