import { createPlaybackAttempt } from "./playback-attempt.js";
import { playbackAttemptSupported } from "./playback-attempt-support.js";
import { playbackOwner } from "./playback-memory.js";

const providers = new Set(["webshare", "hellspy", "fastshare", "sosac", "stremio"]);
const duration = value => Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, Math.round(value))) : 0;
const provider = value => {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return providers.has(key) ? key : "";
};
// Existing closed quality-counter contract; no raw crash/source metadata.
export function playbackFailureEvent(diagnostic, elapsed = 0) {
  const event = diagnostic?.stage === "source_resolve" ? "stream_resolve"
    : diagnostic?.stage === "video_analysis" || ["playback_prepare_failed", "playback_prepare_timeout", "browser_hls_unsupported"].includes(diagnostic?.error_code)
      ? "media_opened" : "playing";
  return { event, outcome: diagnostic?.error_code === "playback_prepare_timeout" ? "timeout" : "failure",
    duration_ms: duration(elapsed), provider: provider(diagnostic?.provider) };
}

// One observed-success counter and one failure counter per attempt, independently
// deduplicated: observing a frame must never hide a later playback failure.
export function createPlaybackTelemetryReporter(owner, {
  fetcher = globalThis.fetch, now = () => performance.now(), startedAt = now(),
  isActive = () => true, diagnosticProvider = "", attemptSupported = playbackAttemptSupported(),
} = {}) {
  let successSent = false, failureSent = false, disposed = false, detach = null;
  const requests = new Set();
  const eligible = () => {
    const active = playbackOwner();
    return !disposed && isActive() && owner && active && active.generation === owner.generation
      && active.accountId === owner.accountId && active.profileId === owner.profileId;
  };
  const elapsed = at => duration(at - startedAt);
  const ownerEligible = () => {const active = playbackOwner(); return owner && active && active.generation===owner.generation && active.accountId===owner.accountId && active.profileId===owner.profileId;};
  const attempt = createPlaybackAttempt({owner, supported: attemptSupported, eligible, ownerEligible, fetcher, now, startedAt, provider: diagnosticProvider});
  async function send(payload) {
    if (!eligible()) return false;
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetcher("/api/app/telemetry/client", { method: "POST", credentials: "same-origin", cache: "no-store",
        signal: controller.signal, headers: { "Content-Type": "application/json", "X-Movly-App": "1",
          "X-Movly-Expected-Account": String(owner.accountId), "X-Movly-Expected-Profile": String(owner.profileId) },
        body: JSON.stringify(payload) });
      return response.ok;
    } catch { return false; }
    finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function failure(diagnostic) {
    if (!eligible() || failureSent) return Promise.resolve(false);
    failureSent = true;
    if (attemptSupported) {
      const code = diagnostic?.error_code;
      const errorClass = diagnostic?.stage === "source_resolve" ? "source_resolve"
        : ["playback_prepare_timeout", "playback_prepare_failed"].includes(code) ? "media_prepare"
        : code === "browser_hls_unsupported" ? "unsupported"
        : code === "hls_network_failed" ? "media_network" : code === "hls_media_failed" ? "media_decode"
        : diagnostic?.stage === "video_analysis" ? "session_prepare" : "unknown";
      return Promise.resolve(attempt.failure(code === "playback_prepare_timeout" ? "timeout" : "failure", errorClass));
    }
    return send(playbackFailureEvent(diagnostic, elapsed(now())));
  }
  function success(event, at) {
    if (!eligible() || successSent) return;
    successSent = true;
    detach?.();
    if (attemptSupported) { attempt.finish(event, at); return; }
    void send({ event, outcome: "success", duration_ms: elapsed(at), provider: provider(diagnosticProvider) });
  }
  function observe(video) {
    detach?.();
    if (!eligible() || successSent) return;
    let frame = null, fallback = false;
    const playing = () => { if (!eligible()) { dispose(); return; } success("playing", now()); };
    const cleanup = () => {
      if (frame !== null) { try { video.cancelVideoFrameCallback?.(frame); } catch {} frame = null; }
      video.removeEventListener("playing", playing);
    };
    detach = cleanup;
    const usePlaying = () => { if (!fallback) { fallback = true; video.addEventListener("playing", playing); } };
    const arm = () => {
      try {
        frame = video.requestVideoFrameCallback((at, metadata) => {
          frame = null;
          if (!eligible()) { dispose(); return; }
          // The callback is tied to a submitted video frame. Require real frame
          // metadata, never substitute loadeddata/playing for this observation.
          if (!(Number.isFinite(at) && at >= startedAt && Number.isFinite(metadata?.presentedFrames) && metadata.presentedFrames > 0
            && Number.isFinite(metadata.width) && metadata.width > 0 && Number.isFinite(metadata.height) && metadata.height > 0)) { arm(); return; }
          // Callback `at` can be the rendering-step timestamp, earlier than
          // presentationTime. Compare against the monotonic clock at invocation.
          const observedAt = now();
          const observed = Number.isFinite(metadata.presentationTime) && metadata.presentationTime >= startedAt
            && metadata.presentationTime <= observedAt ? metadata.presentationTime : observedAt;
          success("first_frame", observed);
        });
      } catch { usePlaying(); }
    };
    if (typeof video.requestVideoFrameCallback === "function") arm();
    else usePlaying();
  }
  function dispose(reason = "cancelled") {
    attempt.dispose(reason);
    disposed = true;
    detach?.(); detach = null;
    for (const controller of requests) controller.abort();
    requests.clear();
  }
  return { failure, observe, dispose, stage: attempt.stage, setEngine: attempt.setEngine, setProvider: attempt.setProvider };
}

// Kept for existing callers that only need a best-effort failure counter.
export function createPlaybackFailureReporter(owner, fetcher = globalThis.fetch) {
  return createPlaybackTelemetryReporter(owner, { fetcher }).failure;
}
