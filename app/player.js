import { streamPickerSections } from "./stream-recommendations.js";
import { createDialog as createFeedbackDialog } from "./feedback.js";
import { playbackDiagnostics } from "./playback-diagnostics.js";
import { translateUI } from "./i18n.js";
import { openProviderSettings } from "./provider-settings.js";
import { reportStream, uploadStream } from "./stream-feedback.js";
import {
  partyState,
  partyWaiting,
  partyPosition,
  reportPartyReady,
  partyTransport,
} from "./party.js";
import { api, array } from "./api.js";
import { setProgress } from "./user-state.js";
import {
  el,
  button,
  showDialog,
  loading,
  errorBox,
  formField,
  toast,
} from "./ui.js";
import { playbackOwner, recalledPlayback, rememberPlayback, samePlaybackSource } from "./playback-memory.js";
import Hls from "./vendor/hls.mjs";
import { nextReleasedEpisode, episodeReleaseState } from "./episode-policy.js";
import { saveOffline } from "./offline.js";
let mediaPreferences = {
  video_mode: "compatible",
  audio_mode: "stereo",
  max_width: 1280,
  playback_rate: 1,
  audio_delay: 0,
  subtitle_delay: 0,
};
try {
  mediaPreferences = {
    ...mediaPreferences,
    ...JSON.parse(localStorage.getItem("movly.mediaPreferences") || "{}"),
  };
} catch {}
async function browserMediaCapabilities() {
  const probe = document.createElement("video");
  const result = {
    hevc: Boolean(probe.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')),
    dolbyVision: Boolean(probe.canPlayType('video/mp4; codecs="dvh1.05.06"')),
    ac3: Boolean(probe.canPlayType('audio/mp4; codecs="ac-3"')),
    eac3: Boolean(probe.canPlayType('audio/mp4; codecs="ec-3"')),
    aacMultichannel: false,
  };
  try {
    result.aacMultichannel = (
      await navigator.mediaCapabilities.decodingInfo({
        type: "media-source",
        audio: {
          contentType: 'audio/mp4; codecs="mp4a.40.2"',
          channels: "6",
          bitrate: 512000,
          samplerate: 48000,
        },
      })
    ).supported;
  } catch {}
  return result;
}
let current = null;
const time = (n) =>
  `${Math.floor(n / 3600) ? `${Math.floor(n / 3600)}:` : ""}${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(Math.floor(n) % 60).padStart(2, "0")}`;
export async function providerSettings() {
  await stop();
  await openProviderSettings();
}
const supportedProvider = {
  test(value) {
    return /^(?:webshare|hellspy|fastshare|sosac|streamuj|sktorrent|sledujteto|crwiki|ceskawiki|prehrajto|stremio|bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream|ct|ceskatelevize|stvr)$/.test(
      String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f ._-]/g, "")
        .toLowerCase(),
    );
  },
};
let sourceRevision = 0;
export async function sources(
  t,
  episode,
  { autoPlay = false, autoDownload = false, skipResume = false } = {},
) {
  if (episode && episodeReleaseState(episode.air_date) === "upcoming")
    throw new Error(translateUI("Epizoda ještě neměla premiéru."));
  await stop();
  const revision = ++sourceRevision;
  const sourceOwner = playbackOwner();
  let savedLookup = null;
  if (!skipResume && !autoDownload && !partyState()?.title_id) {
    const saved = recalledPlayback(t.id, episode);
    if (saved) {
      try {
        const position = await api(`watch-history/position/${t.id}${episode ? `?season_number=${episode.season_number}&episode_number=${episode.episode_number}` : ""}`);
        if (revision !== sourceRevision || sourceOwner?.generation !== playbackOwner()?.generation) return;
        if (position.watch_status !== "completed" && position.progress_seconds > 5) {
          if (saved.selection.source === "lookup") savedLookup = { ...saved, offset: position.progress_seconds };
          else if (await play(t, episode, saved.selection, position.progress_seconds)) return;
        }
      } catch (e) { if (e.status !== 404) toast(e.message); }
    }
  }
  const content = el(
    "div",
    { class: "dialog-body sources-content" },
    el("h2", { id: "dialog-title" }, translateUI("Přehrát · {0}", t.title)),
    episode
      ? el(
          "p",
          {},
          `S${episode.season_number} E${episode.episode_number} · ${episode.name || ""}`,
        )
      : null,
  );
  const summary = el(
    "p",
    { role: "status" },
    translateUI("Hledám ve zdrojích…"),
  );
  const search = el("input", {
    type: "search",
    placeholder: translateUI("Název souboru, jazyk, kodek…"),
    "aria-label": translateUI("Filtrovat zdroje"),
  });
  const provider = el(
    "select",
    { "aria-label": translateUI("Poskytovatel") },
    el("option", { value: "" }, translateUI("Všichni poskytovatelé")),
  );
  const quality = el(
    "select",
    { "aria-label": translateUI("Kvalita") },
    ...[
      ["", translateUI("Všechny kvality")],
      ["2160", translateUI("4K")],
      ["1080", translateUI("Full HD")],
      ["720", translateUI("HD")],
    ].map(([value, name]) => el("option", { value }, name)),
  );
  const sort = el(
    "select",
    { "aria-label": translateUI("Řazení zdrojů") },
    el("option", { value: "quality" }, translateUI("Nejvyšší kvalita")),
    el("option", { value: "small" }, translateUI("Nejmenší soubor")),
    el("option", { value: "large" }, translateUI("Největší soubor")),
  );
  const statuses = el("div", { class: "source-statuses" }),
    list = el("div", { class: "source-list" });
  content.append(
    el(
      "div",
      { class: "actions" },
      button(translateUI("Úložiště a doplňky"), providerSettings, "small"),
      button(translateUI("Obnovit zdroje"), () => sources(t, episode, { skipResume: true }), "small"),
    ),
    el("div", { class: "source-filters" }, search, provider, quality, sort),
    summary,
    statuses,
    list,
  );
  const dialog = showDialog(content),
    results = new Map();
  const providerConnections = await Promise.allSettled(
    ["webshare", "fastshare", "sosac", "stremio"].map((name) =>
      api(`providers/${name}`),
    ),
  );
  if (revision !== sourceRevision || !dialog.open) return;
  const connections = Object.fromEntries(
    ["webshare", "fastshare", "sosac", "stremio"].map((name, index) => [
      name,
      providerConnections[index].status === "fulfilled" &&
        (name === "stremio"
          ? providerConnections[index].value.addons?.length > 0
          : providerConnections[index].value.connected === true),
    ]),
  );
  function providerReady(stream) {
    const name = String(
      stream.provider_name || stream.provider_identifier || "",
    )
      .normalize("NFD")
      .replace(/[\u0300-\u036f ._-]/g, "")
      .toLowerCase();
    return ["webshare", "fastshare", "sosac", "stremio"].includes(name)
      ? connections[name]
      : true;
  }
  let pending = 5;
  const origins = [
    translateUI("Databáze"),
    translateUI("Databáze AI"),
    translateUI("Webshare · živé hledání"),
    translateUI("Hellspy · živé hledání"),
    translateUI("Další poskytovatelé a doplňky"),
  ];
  const rows = origins.map((name) => {
    const n = el(
      "p",
      { class: "source-status", role: "status" },
      translateUI("{0}: hledám…", name),
    );
    statuses.append(n);
    return n;
  });
  function render() {
    const seen = new Set(),
      all = [];
    for (let i = 0; i < origins.length; i++)
      for (const s of results.get(i) || []) {
        const key = s.source_stream_id
          ? `${(s.provider_name || "").toLowerCase()}:${s.source_stream_id}`
          : `${i}:${s.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...s, origin: i });
      }
    const names = [...new Set(all.map((s) => s.provider_name).filter(Boolean))];
    for (const name of names)
      if (![...provider.options].some((o) => o.value === name))
        provider.append(el("option", { value: name }, name));
    const filtered = all
      .filter(
        (s) =>
          (!provider.value || s.provider_name === provider.value) &&
          (!quality.value || s.video_height === Number(quality.value)) &&
          (!search.value ||
            JSON.stringify([
              s.file_name,
              s.provider_name,
              s.video_codec,
              s.hdr_type,
              s.audio_languages,
            ])
              .toLowerCase()
              .includes(search.value.toLowerCase())),
      )
      .sort((a, b) =>
        sort.value === "small"
          ? (a.file_size || Infinity) - (b.file_size || Infinity)
          : sort.value === "large"
            ? (b.file_size || 0) - (a.file_size || 0)
            : (b.video_height || 0) - (a.video_height || 0),
      );
    summary.textContent = translateUI(
      "{0} z {1} zdrojů{2}",
      filtered.length,
      all.length,
      pending ? translateUI(" · hledání pokračuje ({0})", pending) : "",
    );
    list.replaceChildren(
      ...streamPickerSections(filtered, autoPlay || autoDownload ? null : {
        title: t.title, originalTitle: t.original_title,
        year: t.year || Number(String(t.release_date || "").slice(0, 4)) || null,
        season: episode?.season_number, episode: episode?.episode_number,
        runtimeMinutes: episode?.runtime || t.runtime,
        downlinkMbps: navigator.connection?.downlink,
        displayMaxRank: (() => {
          const width = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
          return width >= 7680 ? 5 : width >= 3840 ? 4 : width >= 2560 ? 3 : width >= 1920 ? 2 : width >= 1280 ? 1 : 0;
        })(),
        wideColor: window.matchMedia("(dynamic-range: high)").matches,
      }, s => supportedProvider.test(s.provider_name || s.provider_identifier || "") && providerReady(s))
        .flatMap(section => [el("h3", { class: "source-section-title" }, `${translateUI(section.name)} · ${section.streams.length}`), ...section.streams.map((stream) => {
        const supported =
          supportedProvider.test(
            stream.provider_name || stream.provider_identifier || "",
          ) &&
          stream.available !== false &&
          providerReady(stream);
        const metadata = [
          stream.provider_name,
          stream.video_height ? `${stream.video_height}p` : null,
          stream.video_codec,
          stream.hdr_type,
          ...(stream.audio_languages ||
            (stream.audio_language ? [stream.audio_language] : [])),
          stream.file_size
            ? `${(stream.file_size / 1024 ** 3).toFixed(2)} GB`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const selection = {
          title_id: t.id,
          ...(stream.origin >= 2
            ? { source: "live", ticket: stream.ticket }
            : { source: stream.origin ? "ai" : "human", stream_id: stream.id }),
          ...(episode ? { episode_id: episode.id } : {}),
        };
        Object.defineProperty(selection, "playback_owner", { value: sourceOwner });
        Object.defineProperty(selection, "diagnostic_provider", { value: stream.provider_name || stream.provider_identifier });
        if (stream.origin >= 2) Object.defineProperty(selection, "resume_selection", { value: stream.resume_ticket
          ? { title_id: t.id, source: "resume", ticket: stream.resume_ticket, ...(episode ? { episode_id: episode.id } : {}) }
          : { title_id: t.id, source: "lookup", provider: stream.provider_name || stream.provider_identifier,
              name: stream.file_name, quality: stream.video_height || null, size: stream.file_size || null } });
        const choice = button(
          translateUI("Přehrát"),
          () => play(t, episode, selection),
          "small",
        );
        choice.disabled = !supported;
        return el(
          "div",
          { class: "source-row" },
          el(
            "div",
            {},
            el(
              "strong",
              {},
              stream.file_name ||
                metadata ||
                translateUI("Zdroj {0}", stream.id),
            ),
            el(
              "p",
              { class: "meta" },
              stream.file_name ? metadata : origins[stream.origin],
            ),
            !supported
              ? el(
                  "small",
                  {},
                  stream.available === false
                    ? translateUI("Zdroj není dostupný")
                    : !providerReady(stream)
                      ? translateUI(
                          "Nejdřív připoj účet poskytovatele v Úložištích a doplňcích.",
                        )
                      : translateUI(
                          "Přehrávání tohoto poskytovatele zatím není na webu dostupné.",
                        ),
                )
              : null,
          ),
          choice,
          stream.origin < 2
            ? button(
                translateUI("Nahlásit"),
                () => reportStream(selection),
                "small",
              )
            : supported && (stream.can_upload || stream.source_stream_id)
              ? button(
                  translateUI("Přidat do databáze"),
                  () => uploadStream(selection, () => sources(t, episode)),
                  "small",
                )
              : null,
          supported
            ? button(
                translateUI("Stáhnout soubor"),
                async () => {
                  try {
                    const download = await api("download", {
                      method: "POST",
                      body: selection,
                    });
                    const link = el("a", {
                      href: download.url,
                      download: download.filename,
                    });
                    document.body.append(link);
                    link.click();
                    link.remove();
                  } catch (e) {
                    toast(e.message);
                  }
                },
                "small",
              )
            : null,
          supported
            ? button(
                translateUI("Uložit offline"),
                async () => {
                  try {
                    await saveOffline(t, episode, selection);
                  } catch (e) {
                    toast(e.message);
                  }
                },
                "small",
              )
            : null,
        );
      })]),
    );
    if (!filtered.length && !pending)
      list.append(
        el(
          "p",
          {},
          all.length
            ? translateUI("Žádné zdroje neodpovídají filtrům.")
            : translateUI(
                "Žádné výsledky. Zkontroluj stav poskytovatelů výše.",
              ),
        ),
      );
  }
  for (const control of [search, provider, quality, sort])
    control.addEventListener("input", render);
  const suffix = `?limit=100${episode ? `&episode_id=${episode.id}` : ""}`;
  const ep = episode ? `?episode_id=${episode.id}` : "";
  await Promise.allSettled(
    [
      `streaming/titles/${t.id}/streams${suffix}`,
      `streaming2/titles/${t.id}/streams${suffix}&type=${t.type}`,
      `sources/${t.id}/webshare${ep}`,
      `sources/${t.id}/hellspy${ep}`,
      `sources/${t.id}/native${ep}`,
    ].map(async (path, i) => {
      try {
        const data = await api(path);
        if (revision !== sourceRevision || !dialog.open) return;
        const streams = array(data.streams);
        results.set(i, streams);
        rows[i].textContent =
          `${origins[i]}: ${data.state === "not_connected" ? translateUI(data.message) : translateUI("{0} výsledků", streams.length)}${data.partial ? translateUI(" · neúplné hledání") : ""}`;
        if (data.warnings?.length)
          rows[i].append(el("small", {}, data.warnings.join(" ")));
      } catch (e) {
        if (revision !== sourceRevision || !dialog.open) return;
        rows[i].textContent = `${origins[i]}: ${e.message}`;
        rows[i].classList.add("source-error");
      } finally {
        pending--;
        if (revision === sourceRevision && dialog.open) render();
      }
    }),
  );
  if (savedLookup && revision === sourceRevision && dialog.open) {
    const reference = savedLookup.selection;
    const matching = [...results].flatMap(([origin, streams]) => streams.map(stream => ({ ...stream, origin })))
      .filter(stream => (stream.provider_name || stream.provider_identifier) === reference.provider && stream.file_name === reference.name
        && (stream.video_height || null) === reference.quality && (stream.file_size || null) === reference.size && stream.available !== false);
    if (matching.length === 1) {
      const stream = matching[0];
      const selection = { title_id: t.id, source: "live", ticket: stream.ticket, ...(episode ? { episode_id: episode.id } : {}), resume_selection: reference };
      if (await play(t, episode, selection, savedLookup.offset)) return;
    }
  }
  if (
    (autoPlay || autoDownload) &&
    revision === sourceRevision &&
    dialog.open
  ) {
    const options = [...results]
      .flatMap(([origin, streams]) =>
        streams.map((stream) => ({ ...stream, origin })),
      )
      .filter(
        (stream) =>
          supportedProvider.test(
            stream.provider_name || stream.provider_identifier || "",
          ) &&
          stream.available !== false &&
          providerReady(stream),
      )
      .sort((a, b) => (b.video_height || 0) - (a.video_height || 0));
    if (options.length) {
      const stream = options[0];
      const selection = {
        title_id: t.id,
        ...(stream.origin >= 2
          ? { source: "live", ticket: stream.ticket }
          : { source: stream.origin ? "ai" : "human", stream_id: stream.id }),
        episode_id: episode.id,
      };
      Object.defineProperty(selection, "playback_owner", { value: sourceOwner });
      Object.defineProperty(selection, "diagnostic_provider", { value: stream.provider_name || stream.provider_identifier });
      if (stream.origin >= 2) Object.defineProperty(selection, "resume_selection", { value: stream.resume_ticket
        ? { title_id: t.id, source: "resume", ticket: stream.resume_ticket, episode_id: episode.id }
        : { title_id: t.id, source: "lookup", provider: stream.provider_name || stream.provider_identifier,
            name: stream.file_name, quality: stream.video_height || null, size: stream.file_size || null } });
      if (autoDownload) {
        await saveOffline(t, episode, selection);
        dialog.close();
      } else await play(t, episode, selection);
    } else toast(translateUI("Další epizoda nemá dostupný podporovaný zdroj."));
  }
}
async function play(
  t,
  episode,
  selection,
  offset = null,
  audio = null,
  subtitle = null,
) {
  const scope = selection.playback_owner || playbackOwner();
  await stop();
  if (scope?.generation !== playbackOwner()?.generation) return false;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, t.title),
      loading(),
    ),
  );
  const saved = recalledPlayback(t.id, episode, scope);
  const restoreTracks = audio === null && subtitle === null && samePlaybackSource(selection, saved?.selection);
  audio = audio ?? (restoreTracks ? saved.audio.index : 0);
  subtitle = subtitle ?? (restoreTracks ? saved.subtitle.index : -1);
  const handle = { cancelled: false };
  current = handle;
  try {
    const inParty = partyState()?.title_id === t.id;
    if (inParty) offset = 0;
    if (offset === null) {
      try {
        const position = await api(
          `watch-history/position/${t.id}${episode ? `?season_number=${episode.season_number}&episode_number=${episode.episode_number}` : ""}`,
        );
        offset =
          position.watch_status === "completed"
            ? 0
            : Math.max(0, position.progress_seconds || 0);
      } catch (e) {
        if (e.status !== 404) throw e;
        offset = 0;
      }
    }
    const session = await api("playback", {
      method: "POST", expectedOwner: scope,
      body: {
        ...selection,
        offset,
        audio,
        subtitle,
        ...(restoreTracks ? { audio_selector: saved.audio.key, subtitle_selector: saved.subtitle.key } : {}),
        ...mediaPreferences,
        ...(inParty ? { playback_rate: 1 } : {}),
        capabilities: await browserMediaCapabilities(),
      },
    });
    handle.session = session;
    audio = session.selected_audio ?? audio;
    subtitle = session.selected_subtitle ?? subtitle;
    const trackKey = t => JSON.stringify([t?.language || null, t?.name || null, t?.codec || null]);
    const saveSelection = () => rememberPlayback(t.id, episode, selection,
      { index: audio, key: trackKey(session.audio.find(t => t.index === audio)) },
      { index: subtitle, key: subtitle < 0 ? "off" : trackKey(session.subtitles.find(t => t.index === subtitle)) }, scope);
    let failureDiagnostics = null;
    const reportFailure = button(translateUI("Nahlásit chybu"), () => createFeedbackDialog("bug", "mine", "web", failureDiagnostics), "small");
    reportFailure.hidden = true;
    function captureFailure(stage, error, code) {
      if (handle.cancelled) return;
      failureDiagnostics = playbackDiagnostics(stage, selection.diagnostic_provider, error, code);
      reportFailure.hidden = false;
    }
    if (handle.cancelled || !dialog.open) {
      await api(`playback/${session.id}`, { method: "DELETE" });
      return;
    }
    const video = el("video", {
      controls: true,
      playsinline: true,
      preload: "auto",
      class: "video-player",
    });
    handle.video = video;
    video.playbackRate = inParty ? 1 : mediaPreferences.playback_rate;
    if (inParty) {
      let applying = false,
        seeking = false,
        remoteSeek = null,
        remotePaused = null;
      const publish = () => {
        if (!applying && !seeking && !handle.cancelled && !partyWaiting())
          partyTransport(!video.paused, offset + video.currentTime).catch((e) =>
            toast(e.message),
          );
      };
      video.addEventListener("play", () => {
        if (partyWaiting()) {
          remotePaused = true;
          video.pause();
          return;
        }
        if (remotePaused === false) {
          remotePaused = null;
          return;
        }
        publish();
      });
      video.addEventListener("pause", () => {
        if (remotePaused === true) {
          remotePaused = null;
          return;
        }
        publish();
      });
      video.addEventListener("seeking", () => {
        seeking = true;
      });
      video.addEventListener("seeked", () => {
        seeking = false;
        if (
          remoteSeek !== null &&
          Math.abs(video.currentTime - remoteSeek) < 0.5
        ) {
          remoteSeek = null;
          return;
        }
        remoteSeek = null;
        publish();
      });
      handle.partyTimer = setInterval(() => {
        if (handle.cancelled || partyState()?.title_id !== t.id) return;
        const ready = video.readyState >= 3 && !video.error;
        reportPartyReady(ready);
        const waiting = partyWaiting();
        video.controls = !waiting;
        if (!ready) return;
        const target = waiting ? 0 : partyPosition();
        applying = true;
        if (Math.abs(video.currentTime + offset - target) > 0.5) {
          remoteSeek = Math.max(0, target - offset);
          video.currentTime = remoteSeek;
        }
        const shouldPlay = !waiting && partyState().status === "playing";
        if (shouldPlay && video.paused) {
          remotePaused = false;
          video.play().catch(() => {
            remotePaused = null;
            status.textContent = translateUI(
              "Prohlížeč vyžaduje klepnutí na přehrát.",
            );
          });
        }
        if (!shouldPlay && !video.paused) {
          remotePaused = true;
          video.pause();
        }
        // DOM media events are queued after play/pause/currentTime changes.
        setTimeout(() => {
          applying = false;
        }, 0);
        if (waiting)
          status.textContent = translateUI(
            "Čekáme na přehrávače ({0}/{1})",
            partyState().preparation.devices.filter((d) => d.ready).length,
            partyState().preparation.devices.length,
          );
        position.disabled = waiting;
      }, 100);
    }
    const status = el(
      "p",
      { role: "status", class: "player-status" },
      translateUI("Připravuji video…"),
    );
    const position = el("input", {
      type: "range",
      min: 0,
      max: Math.floor(session.duration),
      value: Math.floor(offset),
      step: 1,
      "aria-label": translateUI("Pozice ve filmu"),
    });
    const clock = el("span", {}, `${time(offset)} / ${time(session.duration)}`);
    const tracks = el(
      "select",
      { "aria-label": translateUI("Zvuková stopa") },
      ...session.audio.map((a) =>
        el(
          "option",
          { value: a.index, selected: a.index === audio },
          a.name ||
            [a.language, a.codec].filter(Boolean).join(" · ") ||
            translateUI("Zvuk {0}", a.index + 1),
        ),
      ),
    );
    const subtitles = el(
      "select",
      { "aria-label": translateUI("Titulky") },
      el(
        "option",
        { value: -1, selected: subtitle < 0 },
        translateUI("Titulky vypnuté"),
      ),
      ...session.subtitles.map((s) =>
        el(
          "option",
          {
            value: s.index,
            selected: s.index === subtitle,
            disabled: !s.supported,
          },
          [
            s.name || s.language || translateUI("Stopa {0}", s.index + 1),
            !s.supported
              ? translateUI("formát titulků není podporovaný")
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    );
    const positionNow = () =>
      Math.min(session.duration, offset + (video.currentTime || 0));
    const history = async () => {
      if (!video.currentTime) return;
      // Film: pozice / dokoukáno rovnou do překryvu karet. Stav seriálu je
      // per epizoda, ten řeší detail sám.
      if (!episode && session.duration > 0)
        setProgress(
          t.id,
          (positionNow() / session.duration) * 100,
          video.ended,
        );
      await api("watch-history", {
        method: "POST", expectedOwner: scope,
        body: {
          title_id: t.id,
          type: t.type,
          watch_status:
            video.ended || positionNow() >= session.duration * 0.85
              ? "completed"
              : "watching",
          progress_seconds: Math.floor(positionNow()),
          duration_seconds: Math.floor(session.duration),
          ...(episode
            ? {
                season_number: episode.season_number,
                episode_number: episode.episode_number,
              }
            : {}),
        },
      });
    };
    handle.history = history;
    position.addEventListener("change", () =>
      inParty
        ? partyTransport(
            partyState().status === "playing",
            Number(position.value),
          ).catch((e) => toast(e.message))
        : play(t, episode, selection, Number(position.value), audio, subtitle),
    );
    tracks.addEventListener("change", () =>
      play(
        t,
        episode,
        selection,
        positionNow(),
        Number(tracks.value),
        subtitle,
      ),
    );
    subtitles.addEventListener("change", () =>
      play(
        t,
        episode,
        selection,
        positionNow(),
        audio,
        Number(subtitles.value),
      ),
    );
    video.addEventListener("timeupdate", () => {
      position.value = Math.floor(positionNow());
      clock.textContent = `${time(positionNow())} / ${time(session.duration)}`;
    });
    video.addEventListener("playing", () => {
      saveSelection();
      status.textContent = "";
    });
    video.addEventListener("waiting", () => {
      status.textContent = translateUI("Načítám video…");
    });
    video.addEventListener("error", () => {
      captureFailure("playback", { mediaCode: video.error?.code });
      status.textContent = translateUI(
        "Prohlížeč nemůže video přehrát. Zkus jiný zdroj.",
      );
    });
    const quality = el(
      "select",
      { "aria-label": translateUI("Kvalita videa") },
      el("option", { value: "native" }, translateUI("Původní kvalita")),
      el("option", { value: "1920" }, translateUI("Kompatibilní Full HD")),
      el("option", { value: "1280" }, translateUI("Úsporná kvalita HD")),
    );
    quality.value =
      mediaPreferences.video_mode === "native"
        ? "native"
        : String(mediaPreferences.max_width);
    const sound = el(
      "select",
      { "aria-label": translateUI("Zvukový výstup") },
      el("option", { value: "native" }, translateUI("Zvuk podle zdroje")),
      el("option", { value: "surround" }, translateUI("Vícekanálový zvuk")),
      el("option", { value: "stereo" }, translateUI("Kompatibilní stereo")),
    );
    sound.value = mediaPreferences.audio_mode;
    async function updateMediaPreferences() {
      mediaPreferences = {
        ...mediaPreferences,
        video_mode: quality.value === "native" ? "native" : "compatible",
        max_width: quality.value === "native" ? 3840 : Number(quality.value),
        audio_mode: sound.value,
      };
      localStorage.setItem(
        "movly.mediaPreferences",
        JSON.stringify(mediaPreferences),
      );
      await play(
        t,
        episode,
        selection,
        session.offset + video.currentTime,
        audio,
        subtitle,
      );
    }
    quality.addEventListener("change", () =>
      updateMediaPreferences().catch((e) => toast(e.message)),
    );
    sound.addEventListener("change", () =>
      updateMediaPreferences().catch((e) => toast(e.message)),
    );
    const speed = el(
      "select",
      { "aria-label": translateUI("Rychlost přehrávání"), disabled: inParty },
      ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
        el("option", { value: rate }, rate + "×"),
      ),
    );
    speed.value = String(inParty ? 1 : mediaPreferences.playback_rate);
    speed.addEventListener("change", async () => {
      mediaPreferences.playback_rate = Number(speed.value);
      localStorage.setItem(
        "movly.mediaPreferences",
        JSON.stringify(mediaPreferences),
      );
      await play(t, episode, selection, positionNow(), audio, subtitle);
    });
    const audioDelay = el("input", {
      type: "number",
      min: -10000,
      max: 10000,
      step: 100,
      value: mediaPreferences.audio_delay,
      "aria-label": translateUI("Posun zvuku (ms)"),
    });
    const subtitleDelay = el("input", {
      type: "number",
      min: -10000,
      max: 10000,
      step: 100,
      value: mediaPreferences.subtitle_delay,
      "aria-label": translateUI("Posun titulků (ms)"),
      disabled: session.quality?.subtitles === "burned",
    });
    audioDelay.addEventListener("change", async () => {
      if (!audioDelay.checkValidity()) return;
      mediaPreferences.audio_delay = Number(audioDelay.value);
      localStorage.setItem(
        "movly.mediaPreferences",
        JSON.stringify(mediaPreferences),
      );
      await play(t, episode, selection, positionNow(), audio, subtitle);
    });
    const originalCue = new WeakMap();
    handle.subtitleTimer = setInterval(() => {
      const delay = mediaPreferences.subtitle_delay / 1000;
      for (const track of video.textTracks)
        for (const cue of track.cues || []) {
          if (!originalCue.has(cue))
            originalCue.set(cue, { start: cue.startTime, end: cue.endTime });
          const original = originalCue.get(cue);
          cue.startTime = Math.max(0, original.start + delay);
          cue.endTime = Math.max(cue.startTime, original.end + delay);
        }
    }, 250);
    subtitleDelay.addEventListener("change", () => {
      if (!subtitleDelay.checkValidity()) return;
      mediaPreferences.subtitle_delay = Number(subtitleDelay.value);
      localStorage.setItem(
        "movly.mediaPreferences",
        JSON.stringify(mediaPreferences),
      );
    });
    const chapters = el(
      "select",
      {
        "aria-label": translateUI("Kapitoly"),
        disabled: !session.chapters?.length,
      },
      el(
        "option",
        { value: "" },
        session.chapters?.length
          ? translateUI("Vybrat kapitolu")
          : translateUI("Zdroj neobsahuje kapitoly"),
      ),
      ...(session.chapters || []).map((chapter, index) =>
        el(
          "option",
          { value: chapter.start },
          chapter.name || translateUI("Kapitola ") + (index + 1),
        ),
      ),
    );
    chapters.addEventListener("change", () => {
      if (chapters.value === "") return;
      const target = Number(chapters.value);
      if (inParty)
        partyTransport(partyState().status === "playing", target).catch((e) =>
          toast(e.message),
        );
      else void play(t, episode, selection, target, audio, subtitle);
    });
    const skipIntro = button(
      translateUI("Přeskočit úvod"),
      () => {
        const chapter = session.chapters?.find(
          (c) =>
            positionNow() >= c.start &&
            positionNow() < c.end &&
            /(?:^|\W)(intro|opening|úvod|znelka|znělka)(?:$|\W)/i.test(c.name),
        );
        if (!chapter) return;
        if (inParty)
          partyTransport(partyState().status === "playing", chapter.end).catch(
            (e) => toast(e.message),
          );
        else void play(t, episode, selection, chapter.end, audio, subtitle);
      },
      "small",
    );
    video.addEventListener("timeupdate", () => {
      skipIntro.hidden = !session.chapters?.some(
        (c) =>
          positionNow() >= c.start &&
          positionNow() < c.end &&
          /(?:^|\W)(intro|opening|úvod|znelka|znělka)(?:$|\W)/i.test(c.name),
      );
    });
    skipIntro.hidden = true;
    video.addEventListener("ended", async () => {
      try {
        await history();
      } catch (e) {
        toast(translateUI("Historie se neuložila: {0}", e.message));
      }
      status.textContent = translateUI("Přehrávání dokončeno.");
      if (
        !episode ||
        handle.cancelled ||
        partyState() ||
        localStorage.getItem("movly.autoplayNext") === "false"
      )
        return;
      try {
        const data = await api(`titles/${t.id}`);
        const seasons = data.seasons || (await api(`titles/${t.id}/seasons`));
        const next = nextReleasedEpisode(array(seasons), episode.id);
        if (next && current === handle && !handle.cancelled)
          await sources(t, next, { autoPlay: true });
      } catch (e) {
        toast(translateUI("Další díl se nepodařilo připravit: {0}", e.message));
      }
    });
    showDialog(
      el(
        "div",
        { class: "dialog-body player-body" },
        el("h2", { id: "dialog-title" }, t.title),
        video,
        status,
        reportFailure,
        el("div", { class: "player-seek" }, position, clock),
        el(
          "div",
          { class: "actions" },
          tracks,
          subtitles,
          speed,
          chapters,
          skipIntro,
          formField(translateUI("Posun zvuku (ms)"), audioDelay),
          formField(translateUI("Posun titulků (ms)"), subtitleDelay),
          quality,
          sound,
          button(translateUI("Jiný zdroj"), () => sources(t, episode, { skipResume: true }), "small"),
          ...(episode
            ? [
                el(
                  "label",
                  {},
                  el("input", {
                    type: "checkbox",
                    checked:
                      localStorage.getItem("movly.autoplayNext") !== "false",
                    onChange: (event) =>
                      localStorage.setItem(
                        "movly.autoplayNext",
                        String(event.target.checked),
                      ),
                  }),
                  translateUI(" Automaticky další díl"),
                ),
              ]
            : []),
        ),
        el(
          "p",
          { class: "login-note" },
          [
            session.quality?.originalVideo
              ? translateUI("Původní obraz")
              : translateUI(
                  "Kompatibilní video · šířka nejvýše {0} px",
                  session.quality?.maxWidth || 1280,
                ),
            session.quality?.hdr ? translateUI("HDR zachován") : null,
            session.quality?.dolbyVision
              ? translateUI("Dolby Vision zachován")
              : null,
            translateUI(
              "{0} · {1} kanály",
              session.quality?.audio === "original"
                ? translateUI("Původní zvuk")
                : "AAC",
              session.quality?.audioChannels || 2,
            ),
            session.quality?.subtitles === "burned"
              ? translateUI("Obrazové titulky v obrazu")
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    );
    let attempts = 0;
    async function prepare() {
      if (handle.cancelled) return;
      try {
        const state = await api(`playback/${session.id}/status`);
        if (state.error) {
          captureFailure("playback", {}, "playback_prepare_failed");
          throw new Error(state.error);
        }
        if (!state.ready) {
          if (++attempts > 40) {
            captureFailure("playback", {}, "playback_prepare_timeout");
            throw new Error(
              translateUI(
                "Příprava videa trvá příliš dlouho. Vyber jiný zdroj.",
              ),
            );
          }
          handle.prepare = setTimeout(prepare, 1000);
          return;
        }
        if (handle.cancelled) return;
        if (
          video.canPlayType("application/vnd.apple.mpegurl") &&
          mediaPreferences.video_mode === "native"
        ) {
          video.src = session.playlist;
          if (!inParty)
            video.play().catch(() => {
              status.textContent = translateUI("Stiskni přehrát.");
            });
        } else if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: false,
            liveSyncDurationCount: 3,
            startPosition: 0,
            maxBufferLength: 24,
          });
          handle.hls = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              captureFailure("playback", { status: data.response?.code }, data.type === Hls.ErrorTypes.NETWORK_ERROR ? "hls_network_failed" : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "hls_media_failed" : "hls_other_failed");
              status.textContent = translateUI(
                "Přehrávání se přerušilo. Vyber zdroj znovu.",
              );
            }
          });
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
            if (subtitle >= 0) {
              hls.subtitleTrack = 0;
              hls.subtitleDisplay = true;
            }
          });
          video.textTracks.addEventListener("addtrack", (event) => {
            if (subtitle >= 0 && event.track.kind === "subtitles")
              event.track.mode = "showing";
          });
          hls.loadSource(session.playlist);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (subtitle >= 0) {
              hls.subtitleTrack = 0;
              hls.subtitleDisplay = true;
            }
            if (!inParty)
              video.play().catch(() => {
                status.textContent = translateUI("Stiskni přehrát.");
              });
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = session.playlist;
          if (!inParty)
            video.play().catch(() => {
              status.textContent = translateUI("Stiskni přehrát.");
            });
        } else {
          captureFailure("playback", {}, "browser_hls_unsupported");
          throw new Error(
            translateUI("Tento prohlížeč nepodporuje HLS video."),
          );
        }
        handle.timer = setInterval(
          () =>
            history().catch((e) => {
              status.textContent = translateUI(
                "Historie se neuložila: {0}",
                e.message,
              );
            }),
          20000,
        );
      } catch (e) {
        if (!failureDiagnostics) captureFailure("playback", e, "playback_prepare_failed");
        status.textContent = e.message;
      }
    }
    prepare();
    return true;
  } catch (e) {
    if (!handle.cancelled && dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, t.title),
          errorBox(e, () =>
            play(t, episode, selection, offset, audio, subtitle),
          ),
          button(translateUI("Připojit Webshare"), providerSettings),
          button(translateUI("Nahlásit chybu"), () => createFeedbackDialog("bug", "mine", "web", playbackDiagnostics(e.body?.diagnostic_stage || "source_resolve", selection.diagnostic_provider, e)), "small"),
        ),
      );
  }
}
export async function stop() {
  const handle = current;
  if (!handle) return;
  current = null;
  handle.cancelled = true;
  clearTimeout(handle.prepare);
  clearInterval(handle.timer);
  clearInterval(handle.subtitleTimer);
  clearInterval(handle.partyTimer);
  reportPartyReady(false);
  handle.video?.pause();
  handle.hls?.destroy();
  if (handle.history)
    await handle
      .history()
      .catch((e) =>
        toast(translateUI("Historie se neuložila: {0}", e.message)),
      );
  if (handle.session)
    await api(`playback/${handle.session.id}`, { method: "DELETE" }).catch(
      () => {},
    );
}
