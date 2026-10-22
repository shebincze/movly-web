import { el } from "./ui.js";
import { translateUI } from "./i18n.js";

// Odkaz, který otevře titul v nainstalované aplikaci Movly
// (Apple a Android TV obsluhují movly://title/{id}).
export function appTitleLink(title) {
  const id = encodeURIComponent(String(title?.id ?? ""));
  return `movly://title/${id}?type=${title?.type === "tv" ? "tv" : "movie"}`;
}

// Odkazy těchto poskytovatelů platí jen pro IP serveru, který je resolvoval;
// stejný seznam vynucuje server (direct-media.js).
export function appOnlyProvider(name) {
  return /^(?:voe|streamtape|ct|ceskatelevize)$/.test(
    String(name || "").normalize("NFD").replace(/[\u0300-\u036f ._-]/g, "").toLowerCase(),
  );
}

// Video neprochází serverem (#153): co prohlížeč sám nepřehraje, nabídneme
// v aplikaci.
export function appHandoff(title, message = translateUI("Tento zdroj nejde přehrát přímo v prohlížeči.")) {
  return el(
    "div",
    { class: "pk-app-handoff", role: "status" },
    el("p", {}, message),
    el(
      "div",
      { class: "pk-app-handoff-actions" },
      el("a", { class: "button accent small", href: appTitleLink(title) }, translateUI("Otevřít v aplikaci")),
      el("a", { class: "button secondary small", href: "/" }, translateUI("Stáhnout aplikaci")),
    ),
  );
}

// Prohlížeč přehraje obraz, ale zvukovou stopu (AC-3, DTS…) mlčky zahodí.
export function audioMissing(video) {
  if (typeof video.mozHasAudio === "boolean") return !video.mozHasAudio;
  if (typeof video.webkitAudioDecodedByteCount === "number") {
    if (video.webkitAudioDecodedByteCount > 0) return false;
    // Android native HLS may publish zeros for both audio and video while
    // decoding normally. A zero audio counter is conclusive only when this
    // engine demonstrates that its decode counters are actually populated.
    const videoDecoded = video.webkitVideoDecodedByteCount > 0 || video.webkitDecodedFrameCount > 0
      || (typeof video.getVideoPlaybackQuality === "function" && video.getVideoPlaybackQuality().totalVideoFrames > 0);
    if (video.webkitAudioDecodedByteCount === 0 && videoDecoded) return true;
  }
  if (video.audioTracks && typeof video.audioTracks.length === "number") return video.audioTracks.length === 0;
  return false;
}

// Chyby <video>/hls.js, po kterých zdroj v prohlížeči nepřehrajeme.
export function unplayableInBrowser({ mediaCode = null, hlsFatal = null } = {}) {
  if (mediaCode === 3 || mediaCode === 4) return true;
  return hlsFatal === "networkError" || hlsFatal === "mediaError";
}
