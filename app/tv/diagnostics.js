/* Closed TV diagnostic schema, shared by ES5 browser queue and Node log sink.
   No free-form text, URLs, target attributes, IDs or printable key values. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MovlyTvDiagnostics = factory();
}(this, function () {
  "use strict";
  var NAV = [37, 38, 39, 40, 13, 461, 8, 27, 415, 19, 10252, 413, 412, 417];
  var ENGINES = ["native", "native-failed", "hls.js"];
  var STAGES = ["auth", "profiles", "home", "search", "detail", "sources", "playback", "history", "other"];
  function member(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }
  function number(value, max) { return typeof value === "number" && isFinite(value) && value >= 0 && value <= max; }
  function sanitize(type, data, at) {
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    var d = {}, keys = [], bools = [], enums = {}, i, key;
    if (type === "keydown" || type === "keypress" || type === "keyup") {
      if (!member(NAV, data.k)) return null;
      d.k = data.k;
    } else if (type === "boot") {
      keys = ["sw", "sh", "iw", "ih"];
      if (number(data.dpr, 16) && data.dpr > 0) d.dpr = data.dpr;
      var m = data.media, media = {};
      if (m && typeof m === "object" && !Array.isArray(m)) {
        var support = ["", "maybe", "probably", "none", "err"];
        for (i = 0; i < 4; i++) { key = ["hls", "xhls", "mp4", "ts"][i]; if (member(support, m[key])) media[key] = m[key]; }
        if (member(["std", "webkit", "none"], m.mse)) media.mse = m.mse;
        if (typeof m.mseAvc === "boolean") media.mseAvc = m.mseAvc;
        d.media = media;
      }
    } else if (type === "error") { keys = ["l", "c"]; enums = { stage: ["runtime"] }; }
    else if (type === "api") { keys = ["st"]; enums = { stage: STAGES }; }
    else if (type === "fail") { enums = { stage: ["playback"], engine: ENGINES }; }
    else if (type === "session") { keys = ["offset", "duration"]; bools = ["media"]; enums = { playlist: ["master", "index"] }; }
    else if (type === "engine") enums = { e: ENGINES };
    else if (type === "hls-error") { keys = ["code"]; bools = ["fatal"]; enums = { type: ["networkError", "mediaError", "muxError", "otherError", "keySystemError"] }; }
    else if (type === "beat") { keys = ["ct", "buf", "dur", "rs", "ns"]; bools = ["p"]; }
    else if (type === "playing") { keys = ["w", "h"]; enums = { engine: ENGINES }; }
    else if (type === "video") { keys = ["ct", "rs", "ns"]; enums = { ev: ["loadstart", "loadedmetadata", "canplay", "stalled", "waiting"] }; }
    else if (type === "video-error") { keys = ["code"]; bools = ["played"]; enums = { engine: ENGINES }; }
    else return null;
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      var max = key === "rs" ? 4 : key === "ns" ? 3 : key === "st" || key === "code" ? 599 : key === "l" || key === "c" ? 1000000 : key === "ct" || key === "buf" || key === "dur" || key === "offset" || key === "duration" ? 604800 : 16384;
      if (number(data[key], max)) d[key] = data[key];
    }
    for (i = 0; i < bools.length; i++) { key = bools[i]; if (typeof data[key] === "boolean") d[key] = data[key]; }
    for (key in enums) if (Object.prototype.hasOwnProperty.call(enums, key) && member(enums[key], data[key])) d[key] = data[key];
    return { t: type, s: number(at, 86400) ? Math.round(at * 10) / 10 : 0, d: d };
  }
  function editing(target) {
    while (target) {
      var tag = String(target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "FORM" || target.isContentEditable || (target.getAttribute && target.getAttribute("contenteditable") !== null && target.getAttribute("contenteditable") !== "false")) return true;
      target = target.parentNode;
    }
    return false;
  }
  function keyEvent(phase, event, activeElement) {
    if (!event || editing(event.target) || editing(activeElement)) return null;
    return sanitize(phase, { k: event.keyCode }, 0);
  }
  return { sanitize: sanitize, keyEvent: keyEvent };
}));
