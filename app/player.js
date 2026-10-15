import { mountIntroSkip } from "./intro-skip.js";
import { streamPickerSections } from "./stream-recommendations.js";
import { createDialog as createFeedbackDialog } from "./feedback.js";
import { playbackDiagnostics } from "./playback-diagnostics.js";
import { createPlaybackFailureReporter } from "./playback-telemetry.js";
import { translateUI } from "./i18n.js";
import { openProviderSettings } from "./provider-settings.js";
import { reportStream, uploadStream } from "./stream-feedback.js";
import {
  partyState,
  partyIsHost,
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
let playRevision = 0;
// Poslední automatická obnova relace (viz recoverSession), proti smyčce obnov.
let lastRecovery = { key: "", at: 0 };
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
const svgGlyph = (paths, attrs = {}) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs }))
    svg.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};
const playGlyph = () => svgGlyph(["M7 4.5v15l13-7.5z"], { fill: "currentColor", stroke: "none" });
const providerKey = (name) =>
  String(name || "").normalize("NFD").replace(/[\u0300-\u036f ._-]/g, "").toLowerCase();
// Barevný štítek poskytovatele (zkratka); barvy podle návrhu v player.css.
function providerBadge(name) {
  const words = String(name || "?").replace(/[·].*$/, "").trim().split(/[\s.]+/).filter(Boolean);
  const short = { webshare: "WS", fastshare: "FS", hellspy: "HS", ulozto: "UL", prehrajto: "PT", sosac: "SO", stremio: "ST", sktorrent: "SK" }[providerKey(name)]
    || (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
  return el("span", { class: "pk-provider", "data-provider": providerKey(name), "aria-hidden": "true" }, short);
}
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
  const runtime = episode?.runtime || t.runtime;
  const content = el(
    "div",
    { class: "dialog-body sources-content pk-picker" },
    el(
      "header",
      { class: "pk-picker-head" },
      el("h2", { id: "dialog-title" }, translateUI("Vyber zdroj")),
      el(
        "p",
        { class: "pk-picker-sub" },
        [
          t.title,
          episode
            ? `S${episode.season_number} E${episode.episode_number}${episode.name ? ` „${episode.name}“` : ""}`
            : null,
          runtime > 0 ? translateUI("{0} min", runtime) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    ),
  );
  const summary = el("span", {}, translateUI("Hledám ve zdrojích…"));
  const progressBar = el("span", { class: "pk-progress-bar" });
  const progress = el(
    "div",
    { class: "pk-progress is-pending", role: "status" },
    el("span", { class: "pk-spinner", "aria-hidden": "true" }),
    summary,
    el("span", { class: "pk-progress-track", "aria-hidden": "true" }, progressBar),
  );
  const search = el("input", {
    type: "search",
    placeholder: translateUI("Název souboru, jazyk, kodek…"),
    "aria-label": translateUI("Filtrovat zdroje"),
  });
  // Filtr poskytovatele jako přepínací čipy; stav drží `providerFilter`.
  let providerFilter = "",
    qualityFilter = "";
  const providerChips = new Map();
  const allChip = el(
    "button",
    { type: "button", class: "pk-chip", "aria-pressed": "true", onClick: () => { providerFilter = ""; render(); } },
    translateUI("Vše"),
  );
  const provider = el(
    "div",
    { class: "pk-chips", role: "group", "aria-label": translateUI("Poskytovatel") },
    allChip,
  );
  const qualityButtons = [
    ["", translateUI("Vše")],
    ["2160", translateUI("4K")],
    ["1080", translateUI("Full HD")],
    ["720", translateUI("HD")],
  ].map(([value, name]) =>
    el(
      "button",
      { type: "button", "aria-pressed": String(value === qualityFilter), "data-value": value, onClick: () => { qualityFilter = value; render(); } },
      name,
    ),
  );
  const quality = el(
    "div",
    { class: "pk-segmented", role: "group", "aria-label": translateUI("Kvalita") },
    ...qualityButtons,
  );
  const audioFilter = el(
    "select",
    { "aria-label": translateUI("Zvuk") },
    el("option", { value: "" }, translateUI("Jakýkoli")),
  );
  const sort = el(
    "select",
    { "aria-label": translateUI("Řazení zdrojů") },
    el("option", { value: "quality" }, translateUI("Nejvyšší kvalita")),
    el("option", { value: "small" }, translateUI("Nejmenší soubor")),
    el("option", { value: "large" }, translateUI("Největší soubor")),
  );
  const statuses = el("div", { class: "source-statuses pk-statuses" }),
    hero = el("div", { class: "pk-hero-slot" }),
    list = el("div", { class: "source-list pk-source-list" });
  content.append(
    el(
      "div",
      { class: "pk-picker-tools" },
      button(translateUI("Úložiště a doplňky"), providerSettings, "small"),
      button(translateUI("Obnovit zdroje"), () => sources(t, episode, { skipResume: true }), "small"),
    ),
    hero,
    progress,
    provider,
    statuses,
    el(
      "div",
      { class: "source-filters pk-filters" },
      quality,
      el("label", { class: "pk-inline-field" }, el("span", {}, translateUI("Zvuk")), audioFilter),
      search,
      el("label", { class: "pk-inline-field pk-sort" }, el("span", {}, translateUI("Řadit")), sort),
    ),
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
      { class: "source-status is-pending", role: "status" },
      translateUI("{0}: hledám…", name),
    );
    statuses.append(n);
    return n;
  });
  const selectionFor = (stream) => {
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
    return selection;
  };
  const languagesOf = (s) =>
    (s.audio_languages || (s.audio_language ? [s.audio_language] : [])).map((l) => String(l).toUpperCase());
  const sizeLabel = (s) => (s.file_size ? `${(s.file_size / 1024 ** 3).toFixed(2)} GB` : null);
  const qualityLabel = (s) => (s.video_height >= 2160 ? "4K" : s.video_height ? `${s.video_height}p` : null);
  function sourceRow(stream, recommended) {
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
      ...languagesOf(stream),
      sizeLabel(stream),
    ]
      .filter(Boolean)
      .join(" · ");
    const tags = [
      qualityLabel(stream),
      stream.hdr_type,
      stream.video_codec,
      stream.audio_codec,
      ...languagesOf(stream),
      ...(Array.isArray(stream.subtitle_languages)
        ? stream.subtitle_languages.map((l) => translateUI("{0} titulky", String(l).toUpperCase()))
        : []),
    ].filter(Boolean);
    const selection = selectionFor(stream);
    const choice = el(
      "button",
      {
        type: "button",
        class: "pk-play",
        "aria-label": translateUI("Přehrát"),
        title: translateUI("Přehrát"),
        onClick: () => play(t, episode, selection),
      },
      playGlyph(),
    );
    choice.disabled = !supported;
    return el(
      "div",
      {
        class: `source-row pk-source-row${recommended ? " is-recommended" : ""}${supported ? "" : " is-unavailable"}`,
      },
      providerBadge(stream.provider_name || stream.provider_identifier || origins[stream.origin]),
      el(
        "div",
        { class: "pk-source-main" },
        el(
          "strong",
          { class: stream.file_name ? "pk-file" : null },
          stream.file_name ||
            metadata ||
            translateUI("Zdroj {0}", stream.id),
        ),
        tags.length
          ? el("div", { class: "pk-tags" }, ...tags.map((tag) => el("span", { class: "pk-tag" }, tag)))
          : null,
        el(
          "p",
          { class: "meta" },
          stream.file_name
            ? [stream.provider_name, sizeLabel(stream), stream.origin < 2 ? origins[stream.origin] : null].filter(Boolean).join(" · ")
            : origins[stream.origin],
        ),
        !supported
          ? el(
              "small",
              { class: "pk-unavailable" },
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
        el(
          "div",
          { class: "pk-row-actions" },
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
        ),
      ),
      choice,
    );
  }
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
    const counts = new Map();
    for (const s of all)
      if (s.provider_name) counts.set(s.provider_name, (counts.get(s.provider_name) || 0) + 1);
    for (const [name, count] of counts) {
      if (!providerChips.has(name)) {
        const label = el("span", { class: "pk-chip-count" });
        const chip = el(
          "button",
          { type: "button", class: "pk-chip", "aria-pressed": "false", onClick: () => { providerFilter = providerFilter === name ? "" : name; render(); } },
          providerBadge(name),
          el("span", {}, name),
          label,
        );
        providerChips.set(name, { chip, label });
        provider.append(chip);
      }
      providerChips.get(name).label.textContent = String(count);
    }
    allChip.textContent = `${translateUI("Vše")} · ${all.length}`;
    allChip.setAttribute("aria-pressed", String(!providerFilter));
    for (const [name, { chip }] of providerChips)
      chip.setAttribute("aria-pressed", String(providerFilter === name));
    for (const b of qualityButtons)
      b.setAttribute("aria-pressed", String(b.dataset.value === qualityFilter));
    for (const language of new Set(all.flatMap(languagesOf)))
      if (![...audioFilter.options].some((o) => o.value === language))
        audioFilter.append(el("option", { value: language }, language));
    const filtered = all
      .filter(
        (s) =>
          (!providerFilter || s.provider_name === providerFilter) &&
          (!qualityFilter || s.video_height === Number(qualityFilter)) &&
          (!audioFilter.value || languagesOf(s).includes(audioFilter.value)) &&
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
    progress.classList.toggle("is-pending", pending > 0);
    progressBar.style.width = `${((origins.length - pending) / origins.length) * 100}%`;
    const sections = streamPickerSections(filtered, autoPlay || autoDownload ? null : {
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
    }, s => supportedProvider.test(s.provider_name || s.provider_identifier || "") && providerReady(s));
    const best = sections.find((section) => section.key === "recommended")?.streams[0];
    hero.replaceChildren(
      ...(best
        ? [
            el(
              "div",
              { class: "pk-hero" },
              el(
                "div",
                { class: "pk-hero-text" },
                el("span", { class: "pk-eyebrow" }, translateUI("Doporučený zdroj")),
                el(
                  "strong",
                  {},
                  [best.provider_name, qualityLabel(best), best.hdr_type, ...languagesOf(best), sizeLabel(best)]
                    .filter(Boolean)
                    .join(" · "),
                ),
                best.file_name ? el("span", { class: "pk-hero-file" }, best.file_name) : null,
              ),
              button(translateUI("Přehrát doporučený"), () => play(t, episode, selectionFor(best)), "primary pk-hero-play"),
            ),
          ]
        : []),
    );
    list.replaceChildren(
      ...sections.flatMap((section) => [
        el("h3", { class: "source-section-title pk-section-title" }, `${translateUI(section.name)} · ${section.streams.length}`),
        ...section.streams.map((stream) => sourceRow(stream, section.key === "recommended")),
      ]),
    );
    if (!filtered.length && !pending)
      list.append(
        el(
          "p",
          { class: "pk-empty" },
          all.length
            ? translateUI("Žádné zdroje neodpovídají filtrům.")
            : translateUI(
                "Žádné výsledky. Zkontroluj stav poskytovatelů výše.",
              ),
        ),
      );
  }
  for (const control of [search, audioFilter, sort])
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
        rows[i].classList.remove("is-pending");
        rows[i].classList.add(data.state === "not_connected" ? "is-warning" : data.partial || data.warnings?.length ? "is-partial" : "is-done");
        if (data.warnings?.length)
          rows[i].append(el("small", {}, data.warnings.join(" ")));
      } catch (e) {
        if (revision !== sourceRevision || !dialog.open) return;
        rows[i].textContent = `${origins[i]}: ${e.message}`;
        rows[i].classList.remove("is-pending");
        rows[i].classList.add("source-error", "is-error");
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
  introMachine = undefined,
) {
  const scope = selection.playback_owner || playbackOwner();
  const revision = ++playRevision;
  await stop();
  if (revision !== playRevision) return false;
  if (scope?.generation !== playbackOwner()?.generation) return false;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body pk-player-state" },
      el("h2", { id: "dialog-title" }, t.title),
      el(
        "div",
        { class: "pk-state-card", role: "status" },
        el("span", { class: "pk-spinner pk-spinner-lg", "aria-hidden": "true" }),
        el("strong", {}, translateUI("Připravuji video…")),
        selection.diagnostic_provider
          ? el("span", {}, translateUI("Ověřuji zdroj {0}…", selection.diagnostic_provider))
          : null,
      ),
    ),
  );
  const saved = recalledPlayback(t.id, episode, scope);
  const restoreTracks = audio === null && subtitle === null && samePlaybackSource(selection, saved?.selection);
  audio = audio ?? (restoreTracks ? saved.audio.index : 0);
  subtitle = subtitle ?? (restoreTracks ? saved.subtitle.index : -1);
  const handle = { cancelled: false, reportTelemetry: createPlaybackFailureReporter(scope) };
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
      void handle.reportTelemetry(failureDiagnostics);
      reportFailure.hidden = false;
      reportFailure.parentElement?.classList.add("is-error");
    }
    if (handle.cancelled || current !== handle || !dialog.open) {
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
    const clock = el("span", { class: "pk-clock" }, `${time(offset)} / ${time(session.duration)}`);
    const fill = () =>
      position.style.setProperty("--pk-fill", `${session.duration > 0 ? (Number(position.value) / session.duration) * 100 : 0}%`);
    fill();
    position.addEventListener("input", fill);
    const chapterMarks = el(
      "div",
      { class: "pk-chapter-marks", "aria-hidden": "true" },
      ...(session.duration > 0 ? session.chapters || [] : [])
        .filter((chapter) => chapter.start > 0 && chapter.start < session.duration)
        .map((chapter) => {
          const mark = el("span");
          mark.style.left = `${(chapter.start / session.duration) * 100}%`;
          return mark;
        }),
    );
    // Výběr stopy jako skupina přepínačů (role=radio) s ovládáním šipkami.
    function radioGroup(label, options, selected, onPick) {
      const heading = el("span", { class: "pk-panel-label", id: `pk-${label.replace(/\W+/g, "-")}-${revision}` }, label);
      const radios = options.map((option) =>
        el(
          "button",
          {
            type: "button",
            role: "radio",
            class: "pk-radio",
            "aria-checked": String(option.value === selected),
            tabindex: option.value === selected ? "0" : "-1",
            disabled: option.disabled,
            onClick: () => option.value !== selected && onPick(option.value),
          },
          el("span", {}, option.label),
          option.value === selected ? el("span", { class: "pk-radio-mark", "aria-hidden": "true" }, "✓") : null,
        ),
      );
      if (!radios.some((radio) => radio.tabIndex === 0) && radios[0]) radios[0].tabIndex = 0;
      const group = el("div", { class: "pk-radiogroup", role: "radiogroup", "aria-labelledby": heading.id }, heading, ...radios);
      group.addEventListener("keydown", (event) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const enabled = radios.filter((radio) => !radio.disabled);
        const index = enabled.indexOf(document.activeElement);
        enabled[(index + step + enabled.length) % enabled.length]?.focus();
      });
      return group;
    }
    const tracks = radioGroup(
      translateUI("Zvuková stopa"),
      session.audio.map((a) => ({
        value: a.index,
        label:
          a.name ||
          [a.language, a.codec].filter(Boolean).join(" · ") ||
          translateUI("Zvuk {0}", a.index + 1),
      })),
      audio,
      (value) => changeTracks(value, subtitle),
    );
    const subtitles = radioGroup(
      translateUI("Titulky"),
      [
        { value: -1, label: translateUI("Titulky vypnuté") },
        ...session.subtitles.map((s) => ({
          value: s.index,
          disabled: !s.supported,
          label: [
            s.name || s.language || translateUI("Stopa {0}", s.index + 1),
            !s.supported
              ? translateUI("formát titulků není podporovaný")
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      ],
      subtitle,
      (value) => changeTracks(audio, value),
    );
    const positionNow = () =>
      Math.min(session.duration, offset + (video.currentTime || 0));
    // Relace přehrávání žije jen v paměti webového serveru; po jeho restartu
    // (např. nasazení) vrací playlist 404. Jednou ji otevřeme znovu na stejném místě.
    const recoverSession = () => {
      if (handle.cancelled || inParty) return false;
      const key = `${t.id}:${episode?.season_number ?? ""}:${episode?.episode_number ?? ""}`;
      if (lastRecovery.key === key && Date.now() - lastRecovery.at < 60_000) return false;
      lastRecovery = { key, at: Date.now() };
      // Během pauzy server relaci po čase ukončí (disk); obnovíme ji až při spuštění.
      if (video.paused && !video.ended && video.currentTime > 0) {
        const at = positionNow();
        video.addEventListener("play", () => { if (!handle.cancelled) play(t, episode, selection, at, audio, subtitle); }, { once: true });
        return true;
      }
      status.textContent = translateUI("Obnovuji přehrávání…");
      play(t, episode, selection, positionNow(), audio, subtitle);
      return true;
    };
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
    const changeTracks = (nextAudio, nextSubtitle) => {
      audio = nextAudio;
      subtitle = nextSubtitle;
      play(t, episode, selection, positionNow(), audio, subtitle);
    };
    video.addEventListener("timeupdate", () => {
      position.value = Math.floor(positionNow());
      fill();
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
      if (video.error?.code === 2 && video.src && recoverSession()) return;
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
    const currentRate = inParty ? 1 : mediaPreferences.playback_rate;
    const speed = el(
      "div",
      { class: "pk-segmented pk-speed", role: "group", "aria-label": translateUI("Rychlost přehrávání") },
      ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
        el(
          "button",
          {
            type: "button",
            "aria-pressed": String(rate === currentRate),
            disabled: inParty,
            onClick: async () => {
              if (rate === mediaPreferences.playback_rate) return;
              mediaPreferences.playback_rate = rate;
              localStorage.setItem(
                "movly.mediaPreferences",
                JSON.stringify(mediaPreferences),
              );
              await play(t, episode, selection, positionNow(), audio, subtitle);
            },
          },
          rate + "×",
        ),
      ),
    );
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
    const skipIntro = el("div", {class:"pk-intro-controls"});
    handle.introCleanup = mountIntroSkip({container:skipIntro,scope,title:t.id,episode,duration:session.duration,
      position:positionNow,playing:()=>!video.paused,canSeek:()=>video.readyState>=2&&!partyWaiting()&&(!inParty||partyIsHost()),
      chapters:session.chapters,current:()=>current===handle&&!handle.cancelled,
      machine:introMachine,seek:(target,machine)=>inParty
        ? partyTransport(partyState().status==="playing",target)
        : play(t,episode,selection,target,audio,subtitle,machine)});
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
    const panelId = `pk-settings-${revision}`;
    const settings = el(
      "aside",
      { class: "pk-settings", id: panelId, "aria-label": translateUI("Zvuk a titulky"), hidden: true },
      tracks,
      subtitles,
      el(
        "div",
        { class: "pk-panel-group" },
        el("span", { class: "pk-panel-label" }, translateUI("Rychlost přehrávání")),
        speed,
      ),
      el(
        "details",
        { class: "pk-advanced" },
        el("summary", {}, translateUI("Obraz, zvuk a synchronizace")),
        el(
          "div",
          { class: "pk-advanced-grid" },
          formField(translateUI("Kapitoly"), chapters),
          formField(translateUI("Kvalita videa"), quality),
          formField(translateUI("Zvukový výstup"), sound),
          formField(translateUI("Posun zvuku (ms)"), audioDelay),
          formField(translateUI("Posun titulků (ms)"), subtitleDelay),
        ),
      ),
    );
    const settingsToggle = el(
      "button",
      {
        type: "button",
        class: "pk-control pk-settings-toggle",
        "aria-expanded": "false",
        "aria-controls": panelId,
        onClick: () => {
          settings.hidden = !settings.hidden;
          settingsToggle.setAttribute("aria-expanded", String(!settings.hidden));
          if (!settings.hidden) settings.querySelector('[role="radio"][tabindex="0"]')?.focus();
        },
      },
      svgGlyph(["M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M7 13h4M13 13h4M7 16h7"]),
      el("span", {}, translateUI("Zvuk a titulky")),
    );
    settings.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      settings.hidden = true;
      settingsToggle.setAttribute("aria-expanded", "false");
      settingsToggle.focus();
    });
    const otherSource = () => sources(t, episode, { skipResume: true });
    const nextEpisode =
      episode && !inParty
        ? el(
            "button",
            {
              type: "button",
              class: "pk-control",
              onClick: async () => {
                try {
                  const data = await api(`titles/${t.id}`);
                  const seasons = data.seasons || (await api(`titles/${t.id}/seasons`));
                  const next = nextReleasedEpisode(array(seasons), episode.id);
                  if (!next) return toast(translateUI("Další díl zatím není dostupný."));
                  if (current === handle && !handle.cancelled) await sources(t, next, { autoPlay: true });
                } catch (e) {
                  toast(translateUI("Další díl se nepodařilo připravit: {0}", e.message));
                }
              },
            },
            svgGlyph(["M5 5v14l10-7zM17 5h2.5v14H17z"], { fill: "currentColor", stroke: "none" }),
            el("span", {}, translateUI("Další epizoda")),
          )
        : null;
    skipIntro.classList.add("pk-skip-intro");
    showDialog(
      el(
        "div",
        { class: "dialog-body player-body pk-player" },
        el(
          "header",
          { class: "pk-player-top" },
          el(
            "div",
            { class: "pk-player-title" },
            el("h2", { id: "dialog-title" }, t.title),
            episode
              ? el("span", {}, `S${episode.season_number} E${episode.episode_number}${episode.name ? ` · ${episode.name}` : ""}`)
              : null,
          ),
          selection.diagnostic_provider
            ? el(
                "button",
                {
                  type: "button",
                  class: "pk-source-pill",
                  "aria-label": translateUI("Aktuální zdroj {0}, změnit zdroj", selection.diagnostic_provider),
                  onClick: otherSource,
                },
                providerBadge(selection.diagnostic_provider),
                el("span", {}, selection.diagnostic_provider),
                svgGlyph(["m6 9 6 6 6-6"]),
              )
            : null,
        ),
        el("div", { class: "pk-stage" }, video, settings),
        el("div", { class: "pk-status" }, status, reportFailure),
        el(
          "div",
          { class: "player-seek pk-seek" },
          el("div", { class: "pk-seek-track" }, chapterMarks, position),
          clock,
        ),
        el(
          "div",
          { class: "pk-controls" },
          skipIntro,
          nextEpisode,
          episode
            ? el(
                "label",
                { class: "pk-autoplay" },
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
              )
            : null,
          el("span", { class: "pk-spacer" }),
          el(
            "button",
            { type: "button", class: "pk-control", onClick: otherSource },
            svgGlyph(["M4 7h13l-3-3M20 17H7l3 3"]),
            el("span", {}, translateUI("Jiný zdroj")),
          ),
          settingsToggle,
        ),
        el(
          "ul",
          { class: "pk-quality", "aria-label": translateUI("Parametry přehrávání") },
          ...[
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
            .map((item) => el("li", {}, item)),
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
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR && [404, 410].includes(data.response?.code) && recoverSession()) return;
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
    if (!handle.cancelled && current === handle && dialog.open) {
      void handle.reportTelemetry(playbackDiagnostics(e.body?.diagnostic_stage || "source_resolve", selection.diagnostic_provider, e));
      showDialog(
        el(
          "div",
          { class: "dialog-body pk-player-error" },
          el("h2", { id: "dialog-title" }, t.title),
          errorBox(e, () =>
            play(t, episode, selection, offset, audio, subtitle),
          ),
          el(
            "div",
            { class: "pk-error-actions" },
            button(translateUI("Vybrat jiný zdroj"), () => sources(t, episode, { skipResume: true })),
            button(translateUI("Připojit Webshare"), providerSettings),
            button(translateUI("Nahlásit chybu"), () => createFeedbackDialog("bug", "mine", "web", playbackDiagnostics(e.body?.diagnostic_stage || "source_resolve", selection.diagnostic_provider, e)), "small"),
          ),
        ),
      );
    }
  }
}
export async function stop() {
  const handle = current;
  if (!handle) return;
  current = null;
  handle.cancelled = true;
  handle.introCleanup?.();
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
