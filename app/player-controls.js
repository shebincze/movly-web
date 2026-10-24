// Vlastní ovládání webového přehrávače: lišta (přehrát/pauza, ±10 s, hlasitost,
// obraz v obraze, celá obrazovka) a klávesové zkratky. Pozice a posun řeší
// player.js (relace přehrávání začíná na offsetu), tady je jen ovládání.
export const SKIP_SECONDS = 10;
// Odpočet další epizody se ukáže v posledních sekundách dílu.
export const NEXT_COUNTDOWN_SECONDS = 10;
// Po tolika automaticky spuštěných dílech bez zásahu diváka se přehrávač zeptá.
export const CONTINUE_PROMPT_AFTER = 3;
const VOLUME_KEY = "movly.playerVolume";

// Posun na absolutní pozici titulu: uvnitř načteného rozsahu aktuální relace
// stačí currentTime, jinak je potřeba nová relace od cíle.
export function seekPlan(target, { offset = 0, duration = 0, seekable = null } = {}) {
  const position = Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : Infinity, Number(target) || 0));
  const local = position - offset;
  if (local >= 0 && seekable)
    for (let i = 0; i < seekable.length; i++)
      if (local >= seekable.start(i) && local <= seekable.end(i) - 0.5) return { position, local };
  return { position, restart: true };
}

const TEXT_INPUTS = new Set(["text", "search", "number", "email", "password", "url", "tel"]);
// Klávesa → akce přehrávače. Ovládací prvky formuláře a skupiny přepínačů si
// své klávesy nechávají (šipky v posuvníku, mezerník na tlačítku).
export function playerKeyAction(event) {
  if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target || {};
  const tag = String(target.tagName || "").toLowerCase();
  const type = String(target.type || "").toLowerCase();
  if (target.isContentEditable || tag === "textarea" || tag === "select" || (tag === "input" && TEXT_INPUTS.has(type))) return null;
  const inGroup = typeof target.closest === "function" && target.closest('[role="radiogroup"], .pk-settings');
  const control = tag === "button" || tag === "summary" || tag === "a" || (tag === "input" && type !== "range") || inGroup;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  switch (key) {
    case " ":
      return control ? null : "toggle";
    case "k":
      return "toggle";
    case "ArrowLeft":
      return control || tag === "input" ? null : "back";
    case "ArrowRight":
      return control || tag === "input" ? null : "forward";
    case "j":
      return "back";
    case "l":
      return "forward";
    case "ArrowUp":
      return control || tag === "input" ? null : "volume-up";
    case "ArrowDown":
      return control || tag === "input" ? null : "volume-down";
    case "m":
      return "mute";
    case "f":
      return "fullscreen";
    case "p":
      return "pip";
    default:
      return null;
  }
}

// Sekundy odpočtu další epizody, nebo null, když se odpočet neukazuje.
export function nextCountdown(remaining, { enabled = true, available = false, cancelled = false } = {}) {
  if (!enabled || !available || cancelled || !Number.isFinite(remaining) || remaining < 0) return null;
  return remaining <= NEXT_COUNTDOWN_SECONDS ? Math.max(1, Math.ceil(remaining)) : null;
}

// Media Session API (WEB-N11): titul v systémovém „Právě hraje“ (macOS, Windows,
// Android, iOS) a funkční mediální klávesy / ovladače sluchátek. Vrací úklid.
const MEDIA_ACTIONS = ["play", "pause", "seekbackward", "seekforward", "stop"];
export function bindMediaSession({ session, Metadata, media, handlers }) {
  if (!session || typeof session.setActionHandler !== "function") return () => {};
  if (media?.title && typeof Metadata === "function") {
    try {
      session.metadata = new Metadata({
        title: media.title,
        artist: media.subtitle || "",
        album: "Movly",
        artwork: media.artwork ? [{ src: media.artwork, sizes: "342x513", type: "image/jpeg" }] : [],
      });
    } catch {}
  }
  for (const action of MEDIA_ACTIONS) {
    try {
      session.setActionHandler(action, handlers[action] || null);
    } catch {
      /* Prohlížeč akci nepodporuje. */
    }
  }
  return () => {
    for (const action of MEDIA_ACTIONS) {
      try {
        session.setActionHandler(action, null);
      } catch {}
    }
    try {
      session.metadata = null;
      session.playbackState = "none";
    } catch {}
  };
}

export function readVolume(storage) {
  try {
    const saved = JSON.parse(storage.getItem(VOLUME_KEY) || "{}");
    const volume = Number(saved.volume);
    return { volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1, muted: saved.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

function writeVolume(storage, video) {
  try {
    storage.setItem(VOLUME_KEY, JSON.stringify({ volume: Math.round(video.volume * 100) / 100, muted: video.muted }));
  } catch {}
}

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function pipSupported(video) {
  return Boolean(
    (document.pictureInPictureEnabled && !video.disablePictureInPicture) ||
      (typeof video.webkitSupportsPresentationMode === "function" && video.webkitSupportsPresentationMode("picture-in-picture")),
  );
}

// Lišta ovládání. `screen` je prvek, který jde na celou obrazovku (video
// i ovládání), `keyRoot` je oblast přehrávače (interakce myší). Zkratky se
// čtou z celého dokumentu, dokud `active()` platí: fokus po otevření dialogu
// stojí na zavíracím tlačítku mimo přehrávač. `seekTo` dostává absolutní
// pozici titulu, `disabled` vrací true během čekání Watch Party.
export function mountPlayerControls({ el, glyph, translate, video, screen, keyRoot, storage, positionNow, seekTo, togglePlayback = null, active = () => true, disabled = () => false, onInteraction = () => {}, pageFullscreen: startInPage = false, media = null, mediaSession = globalThis.navigator?.mediaSession, MediaMetadata: Metadata = globalThis.MediaMetadata }) {
  const saved = readVolume(storage);
  video.volume = saved.volume;
  video.muted = saved.muted;
  const control = (label, icon, onClick, extra = {}) => {
    const node = el("button", { type: "button", class: "pk-control pk-icon-control", "aria-label": label, title: label, onClick, ...extra }, icon());
    return node;
  };
  const icons = {
    play: () => glyph(["M7 4.5v15l13-7.5z"], { fill: "currentColor", stroke: "none" }),
    pause: () => glyph(["M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"], { fill: "currentColor", stroke: "none" }),
    back: () => glyph(["M11 5 4 12l7 7", "M20 12H4"]),
    forward: () => glyph(["m13 5 7 7-7 7", "M4 12h16"]),
    volume: () => glyph(["M4 9h4l5-4v14l-5-4H4z", "M16 9a4 4 0 0 1 0 6", "M18.5 6.5a8 8 0 0 1 0 11"]),
    muted: () => glyph(["M4 9h4l5-4v14l-5-4H4z", "m17 9 5 6", "m22 9-5 6"]),
    pip: () => glyph(["M3 5h18v14H3z", "M12 12h7v5h-7z"]),
    fullscreen: () => glyph(["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"]),
    exitFullscreen: () => glyph(["M9 4v5H4", "M15 4v5h5", "M9 20v-5H4", "M15 20v-5h5"]),
  };
  const setIcon = (button, icon, label) => {
    button.replaceChildren(icon());
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  const toggle = () => {
    if (disabled()) return;
    // Watch Party: přepínač je záměr pro místnost, video řídí její hodiny (#147).
    if (togglePlayback) return togglePlayback();
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  };
  const skip = (seconds) => {
    if (disabled()) return;
    seekTo(positionNow() + seconds);
  };
  const changeVolume = (delta) => {
    video.muted = false;
    video.volume = Math.min(1, Math.max(0, Math.round((video.volume + delta) * 100) / 100));
  };
  const toggleMute = () => {
    if (video.muted && video.volume === 0) video.volume = 0.5;
    video.muted = !video.muted;
  };
  // iPhone Safari neumí celou obrazovku pro prvek, jen nativní přehrávač
  // <video>. Ten ale zná jen aktuální HLS relaci (začíná na offsetu a teprve
  // roste), takže by ukazoval a posouval jen její úsek. Místo něj přehrávač
  // i s vlastní lištou roztáhneme přes celé okno; posun pak jde po celém titulu.
  let pageFullscreen = false, disposed = false;
  const setPageFullscreen = (on) => {
    pageFullscreen = on;
    screen.classList.toggle("pk-page-fullscreen", on);
    document.documentElement.classList.toggle("pk-page-fullscreen-open", on);
    update();
  };
  const toggleFullscreen = () => {
    if (pageFullscreen) return setPageFullscreen(false);
    if (fullscreenElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
      return;
    }
    const request = screen.requestFullscreen || screen.webkitRequestFullscreen;
    if (!request) return setPageFullscreen(true);
    request.call(screen)?.catch?.(() => !disposed && setPageFullscreen(true));
  };
  const togglePip = () => {
    if (!pipSupported(video)) return;
    if (document.pictureInPictureElement === video) {
      document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (video.requestPictureInPicture) video.requestPictureInPicture().catch(() => {});
    else if (video.webkitSetPresentationMode)
      video.webkitSetPresentationMode(video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
  };
  const playButton = control(translate("Přehrát"), icons.play, toggle, { class: "pk-control pk-icon-control pk-play-toggle" });
  const back = control(translate("Zpět o {0} s", SKIP_SECONDS), icons.back, () => skip(-SKIP_SECONDS));
  const forward = control(translate("Vpřed o {0} s", SKIP_SECONDS), icons.forward, () => skip(SKIP_SECONDS));
  const mute = control(translate("Ztlumit"), icons.volume, toggleMute);
  const volume = el("input", {
    type: "range",
    class: "pk-volume",
    min: 0,
    max: 1,
    step: 0.05,
    value: video.muted ? 0 : video.volume,
    "aria-label": translate("Hlasitost"),
  });
  volume.addEventListener("input", () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
  });
  const pip = control(translate("Obraz v obraze"), icons.pip, togglePip);
  pip.hidden = !pipSupported(video);
  const fullscreen = control(translate("Celá obrazovka"), icons.fullscreen, toggleFullscreen);
  const element = el(
    "div",
    { class: "pk-transport", role: "group", "aria-label": translate("Ovládání přehrávání") },
    playButton,
    back,
    forward,
    el("div", { class: "pk-volume-group" }, mute, volume),
    el("span", { class: "pk-spacer" }),
    pip,
    fullscreen,
  );
  const update = () => {
    const off = disabled();
    if (mediaSession) try { mediaSession.playbackState = !video.paused && !video.ended ? "playing" : "paused"; } catch {}
    for (const button of [playButton, back, forward]) button.disabled = off;
    const playing = !video.paused && !video.ended;
    if (playButton.dataset.playing !== String(playing)) {
      playButton.dataset.playing = String(playing);
      setIcon(playButton, playing ? icons.pause : icons.play, translate(playing ? "Pozastavit" : "Přehrát"));
    }
    const silent = video.muted || video.volume === 0;
    if (mute.dataset.muted !== String(silent)) {
      mute.dataset.muted = String(silent);
      setIcon(mute, silent ? icons.muted : icons.volume, translate(silent ? "Zapnout zvuk" : "Ztlumit"));
    }
    volume.value = String(video.muted ? 0 : video.volume);
    const full = pageFullscreen || fullscreenElement() === screen;
    if (fullscreen.dataset.full !== String(full)) {
      fullscreen.dataset.full = String(full);
      setIcon(fullscreen, full ? icons.exitFullscreen : icons.fullscreen, translate(full ? "Ukončit celou obrazovku" : "Celá obrazovka"));
    }
  };
  const onVolume = () => {
    writeVolume(storage, video);
    update();
  };
  const onKey = (event) => {
    if (!active()) return;
    const action = playerKeyAction(event);
    if (!action) return;
    event.preventDefault();
    onInteraction();
    ({
      toggle,
      back: () => skip(-SKIP_SECONDS),
      forward: () => skip(SKIP_SECONDS),
      "volume-up": () => changeVolume(0.1),
      "volume-down": () => changeVolume(-0.1),
      mute: toggleMute,
      fullscreen: toggleFullscreen,
      pip: togglePip,
    })[action]();
  };
  // Dvojklik je celá obrazovka; jednoduchý klik přepne přehrávání až po
  // krátké prodlevě, aby dvojklik nepozastavil a znovu nespustil video
  // (ve Watch Party by to byly dvě změny stavu místnosti).
  let clickTimer = null;
  const onVideoClick = (event) => {
    onInteraction();
    clearTimeout(clickTimer);
    if (event.detail > 1) return;
    clickTimer = setTimeout(toggle, 250);
  };
  const onVideoDoubleClick = () => {
    clearTimeout(clickTimer);
    toggleFullscreen();
  };
  const onPointer = () => onInteraction();
  const listeners = [
    [video, "play", update],
    [video, "pause", update],
    [video, "ended", update],
    [video, "volumechange", onVolume],
    [video, "click", onVideoClick],
    [video, "dblclick", onVideoDoubleClick],
    [document, "fullscreenchange", update],
    [document, "webkitfullscreenchange", update],
    [document, "keydown", onKey],
    [keyRoot, "pointerdown", onPointer],
  ];
  for (const [target, name, handler] of listeners) target.addEventListener(name, handler);
  const releaseMediaSession = bindMediaSession({
    session: mediaSession,
    Metadata,
    media,
    handlers: {
      play: () => { if (video.paused || video.ended) toggle(); },
      pause: () => { if (!video.paused && !video.ended) toggle(); },
      seekbackward: (details) => skip(-(Number(details?.seekOffset) || SKIP_SECONDS)),
      seekforward: (details) => skip(Number(details?.seekOffset) || SKIP_SECONDS),
      stop: () => { if (!video.paused) toggle(); },
    },
  });
  if (startInPage && !fullscreenElement()) setPageFullscreen(true);
  else update();
  return {
    element,
    update,
    pageFullscreen: () => pageFullscreen,
    cleanup() {
      disposed = true;
      clearTimeout(clickTimer);
      for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
      releaseMediaSession();
      if (pageFullscreen) setPageFullscreen(false);
      if (fullscreenElement() === screen) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    },
  };
}
