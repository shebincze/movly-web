import { playbackAttemptSupported } from "./playback-attempt-support.js";
import { feedbackAllowed } from "./feedback-access.js";
import { mountIntroSkip } from "./intro-skip.js";
import { demotionLabel, eligible, facetOptions, facetStreams, isDemoted, sortStreams, streamPickerSections } from "./stream-recommendations.js";
import { createDialog as createFeedbackDialog } from "./feedback.js";
import { playbackDiagnostics } from "./playback-diagnostics.js";
import { createPlaybackTelemetryReporter } from "./playback-telemetry.js";
import { translateUI, uiLanguage } from "./i18n.js";
import { openProviderSettings } from "./provider-settings.js";
import { reportStream } from "./stream-feedback.js";
import {
  partyState,
  partyIsHost,
  partyWaiting,
  partyPosition,
  reportPartyReady,
  beginPartyPlayback,
  endPartyPlayback,
  partyPlaybackMatches,
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
import { appHandoff, appOnlyProvider, appTitleLink, audioMissing, unplayableInBrowser } from "./app-handoff.js";
import { mountPlayerControls, nextCountdown, CONTINUE_PROMPT_AFTER } from "./player-controls.js";
import { createPartyFollower } from "./party-sync.js";
let mediaPreferences = {
  playback_rate: 1,
  subtitle_delay: 0,
};
try {
  mediaPreferences = {
    ...mediaPreferences,
    ...JSON.parse(localStorage.getItem("movly.mediaPreferences") || "{}"),
  };
} catch {}
let current = null;
let playRevision = 0;
const OPEN_TIMEOUT_MS = 20000;
// Počet dílů spuštěných automaticky bez zásahu diváka (viz CONTINUE_PROMPT_AFTER).
let autoplayChain = 0;
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
  const sourceStartedAt = performance.now();
  const revision = ++sourceRevision, sourceOwner = playbackOwner();
  await stop("source_switch");
  if (revision !== sourceRevision || sourceOwner?.generation !== playbackOwner()?.generation) return;
  let handedOff = false, sourceDialog = null;
  const sourceClosed = () => { if (!handedOff) sourceTelemetry?.dispose(); };
  const sourceTelemetry = !autoDownload && playbackAttemptSupported() ? createPlaybackTelemetryReporter(sourceOwner, {startedAt: sourceStartedAt,
    isActive: () => handedOff ? current?.telemetry === sourceTelemetry : revision === sourceRevision}) : null;
  const startPlay = (title, episode, selection, offset, audio, subtitle) => {
    handedOff = true; sourceDialog?.removeEventListener("close", sourceClosed); sourceTelemetry?.setProvider(selection.diagnostic_provider);
    return play(title, episode, selection, offset, audio, subtitle, undefined, sourceTelemetry);
  };

  let savedLookup = null;
  if (!skipResume && !autoDownload && !partyState()?.title_id) {
    const saved = recalledPlayback(t.id, episode);
    if (saved) {
      const resumeStartedAt = performance.now();
      try {
        const position = await api(`watch-history/position/${t.id}${episode ? `?season_number=${episode.season_number}&episode_number=${episode.episode_number}` : ""}`);
        if (revision !== sourceRevision || sourceOwner?.generation !== playbackOwner()?.generation) return;
        sourceTelemetry?.stage("resume_lookup", performance.now()-resumeStartedAt);
        if (position.watch_status !== "completed" && position.progress_seconds > 5) {
          if (saved.selection.source === "lookup") savedLookup = { ...saved, offset: position.progress_seconds };
          else if (await startPlay(t, episode, saved.selection, position.progress_seconds)) return;
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
  let providerFilter = "";
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
  // Facety kontraktu Stream scoring: OR uvnitř dimenze, AND mezi dimenzemi;
  // když nic nenechají, ukáže se vše s poznámkou (relaxed).
  const facetSelection = { audio: new Set(), subtitles: new Set(), resolutions: new Set(), dynamicRanges: new Set() };
  const resolutionLabel = (rank) => ["SD", "HD", "Full HD", "1440p", "4K", "8K"][rank];
  const facetGroups = [
    ["audio", translateUI("Jazyk audia"), (code) => code.toUpperCase()],
    ["subtitles", translateUI("Jazyk titulků"), (code) => code.toUpperCase()],
    ["resolutions", translateUI("Rozlišení"), resolutionLabel],
    ["dynamicRanges", translateUI("Dynamický rozsah"), (range) => (range === "DV" ? "Dolby Vision" : range)],
  ].map(([key, label, display]) => {
    const group = el("div", { class: "pk-segmented pk-facet-options", role: "group", "aria-label": label });
    return { key, display, group, values: "", field: el("div", { class: "pk-inline-field pk-facet", hidden: true }, el("span", {}, label), group) };
  });
  function renderFacets(options) {
    for (const facet of facetGroups) {
      const values = options[facet.key];
      // Dynamický rozsah má smysl až při dvou hodnotách (stejně jako Windows).
      facet.field.hidden = values.length < (facet.key === "dynamicRanges" ? 2 : 1);
      if (facet.values !== JSON.stringify(values)) {
        facet.values = JSON.stringify(values);
        facet.group.replaceChildren(...values.map((value) => el("button", {
          type: "button", "data-value": String(value),
          onClick: () => {
            const selected = facetSelection[facet.key];
            if (selected.has(value)) selected.delete(value); else selected.add(value);
            render();
          },
        }, facet.display(value))));
      }
      for (const b of facet.group.children)
        b.setAttribute("aria-pressed", String([...facetSelection[facet.key]].some((v) => String(v) === b.dataset.value)));
    }
  }
  const sort = el(
    "select",
    { "aria-label": translateUI("Řazení zdrojů") },
    el("option", { value: "recommended" }, translateUI("Doporučené")),
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
      ...facetGroups.map((facet) => facet.field),
      search,
      el("label", { class: "pk-inline-field pk-sort" }, el("span", {}, translateUI("Řadit")), sort),
    ),
    list,
  );
  const dialog = showDialog(content),
    results = new Map();
  sourceDialog = dialog;
  dialog.addEventListener("close", sourceClosed, {once:true});
  const discoveryStartedAt = performance.now();
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
    const appOnly = appOnlyProvider(stream.provider_name || stream.provider_identifier);
    const supported =
      supportedProvider.test(
        stream.provider_name || stream.provider_identifier || "",
      ) &&
      stream.available !== false &&
      !appOnly &&
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
      isDemoted(stream) ? translateUI(demotionLabel(stream)) : null,
    ].filter(Boolean);
    const selection = selectionFor(stream);
    const choice = el(
      "button",
      {
        type: "button",
        class: "pk-play",
        "aria-label": translateUI("Přehrát"),
        title: translateUI("Přehrát"),
        onClick: () => startPlay(t, episode, selection),
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
        !supported && appOnly && stream.available !== false
          ? el(
              "small",
              { class: "pk-unavailable" },
              translateUI("Tento poskytovatel jde přehrát jen v aplikaci Movly. "),
              el("a", { href: appTitleLink(t) }, translateUI("Otevřít v aplikaci")),
            )
          : !supported
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
                  () => showDialog(el("div", { class: "dialog-body" },
                    el("h2", { id: "dialog-title" }, translateUI("Přidat do databáze")),
                    appHandoff(t, translateUI("Ověření zvukových stop vyžaduje přečíst video, proto je přidání zdroje dostupné v aplikaci Movly.")))),
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
                    // Přímý odkaz poskytovatele; soubor stahuje prohlížeč sám (#153).
                    const link = el("a", {
                      href: download.url,
                      download: download.filename,
                      target: "_blank",
                      rel: "noopener noreferrer",
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
                () => showDialog(el("div", { class: "dialog-body" },
                  el("h2", { id: "dialog-title" }, translateUI("Uložit offline")),
                  appHandoff(t, translateUI("Video se na webu neukládá přes server. Offline sledování je dostupné v aplikaci Movly.")))),
                "small",
              )
            : null,
        ),
      ),
      choice,
    );
  }
  // Stejné Settings pro Doporučené, řazení i auto-výběr (StreamAutoSelector.Context).
  const scoringContext = {
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
    primaryLanguage: uiLanguage(),
  };
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
    renderFacets(facetOptions(all, scoringContext));
    const basic = all
      .filter(
        (s) =>
          (!providerFilter || s.provider_name === providerFilter) &&
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
      );
    const faceted = facetStreams(basic, {
      languages: [...[...facetSelection.audio].map((code) => `audio_${code}`), ...[...facetSelection.subtitles].map((code) => `sub_${code}`)],
      resolutions: [...facetSelection.resolutions],
      dynamicRanges: [...facetSelection.dynamicRanges],
    }, scoringContext);
    // Režimy kontraktu: quality, size, recommended; „Nejmenší soubor" = custom sizeSmall.
    const filtered = sortStreams(faceted.items, sort.value === "small"
      ? { mode: "custom", normalization: "lexicographic", weights: { sizeSmall: 8 } }
      : sort.value === "large" ? "size" : sort.value === "quality" ? "quality" : "recommended", scoringContext);
    summary.textContent = translateUI(
      "{0} z {1} zdrojů{2}",
      filtered.length,
      all.length,
      pending ? translateUI(" · hledání pokračuje ({0})", pending) : "",
    );
    progress.classList.toggle("is-pending", pending > 0);
    progressBar.style.width = `${((origins.length - pending) / origins.length) * 100}%`;
    const sections = streamPickerSections(filtered, autoPlay || autoDownload ? null : scoringContext,
      s => supportedProvider.test(s.provider_name || s.provider_identifier || "") && !appOnlyProvider(s.provider_name || s.provider_identifier) && providerReady(s));
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
              button(translateUI("Přehrát doporučený"), () => startPlay(t, episode, selectionFor(best)), "primary pk-hero-play"),
            ),
          ]
        : []),
    );
    list.replaceChildren(
      ...(faceted.relaxed ? [el("p", { class: "pk-relaxed meta", role: "status" }, translateUI("Filtr nic nenašel – zobrazuji vše"))] : []),
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
  for (const control of [search, sort])
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
        const data = await api(path, {expectedOwner: sourceOwner, playbackAttempt: sourceTelemetry});
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
  sourceTelemetry?.stage("source_discovery", performance.now()-discoveryStartedAt);
  if (savedLookup && revision === sourceRevision && dialog.open) {
    const reference = savedLookup.selection;
    const matching = [...results].flatMap(([origin, streams]) => streams.map(stream => ({ ...stream, origin })))
      .filter(stream => (stream.provider_name || stream.provider_identifier) === reference.provider && stream.file_name === reference.name
        && (stream.video_height || null) === reference.quality && (stream.file_size || null) === reference.size && stream.available !== false);
    if (matching.length === 1) {
      const stream = matching[0];
      const selection = { title_id: t.id, source: "live", ticket: stream.ticket, ...(episode ? { episode_id: episode.id } : {}), resume_selection: reference };
      if (await startPlay(t, episode, selection, savedLookup.offset)) return;
    }
  }
  if (
    (autoPlay || autoDownload) &&
    revision === sourceRevision &&
    dialog.open
  ) {
    // „Podobné" se automaticky nikdy nepřehrají; pořadí = režim recommended.
    const options = sortStreams([...results]
      .flatMap(([origin, streams]) =>
        streams.map((stream) => ({ ...stream, origin })),
      )
      .filter(
        (stream) =>
          supportedProvider.test(
            stream.provider_name || stream.provider_identifier || "",
          ) &&
          stream.available !== false &&
          !appOnlyProvider(stream.provider_name || stream.provider_identifier) &&
          providerReady(stream) &&
          eligible(stream, scoringContext),
      ), "recommended", scoringContext);
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
        dialog.close();
        toast(translateUI("Offline sledování je dostupné v aplikaci Movly."));
      } else await startPlay(t, episode, selection);
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
  startupTelemetry = null,
) {
  const attemptStartedAt = performance.now();
  const scope = selection.playback_owner || playbackOwner();
  const revision = ++playRevision;
  // Nová relace (posun mimo načtený úsek, změna stopy) přestaví přehrávač;
  // náhradní celou obrazovku na iPhonu zachováme, nevyžaduje gesto.
  const keepPageFullscreen = Boolean(current?.controls?.pageFullscreen());
  await stop("source_switch");
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
  const handle = { cancelled: false };
  handle.telemetry = startupTelemetry || createPlaybackTelemetryReporter(scope, {
    startedAt: attemptStartedAt, diagnosticProvider: selection.diagnostic_provider,
    isActive: () => !handle.cancelled && current === handle && revision === playRevision,
  });
  handle.reportTelemetry = handle.telemetry.failure;
  handle.partyPlayback = beginPartyPlayback(t.id, episode?.id);
  current = handle;
  try {
    const inParty = partyPlaybackMatches(handle.partyPlayback);
    if (inParty) offset = 0;
    if (offset === null) {
      const resumeStartedAt = performance.now();
      try {
        const position = await api(
          `watch-history/position/${t.id}${episode ? `?season_number=${episode.season_number}&episode_number=${episode.episode_number}` : ""}`,
          {expectedOwner: scope, playbackAttempt: handle.telemetry},
        );
        offset =
          position.watch_status === "completed"
            ? 0
            : Math.max(0, position.progress_seconds || 0);
      } catch (e) {
        if (e.status !== 404) throw e;
        offset = 0;
      }
      handle.telemetry.stage("resume_lookup", performance.now()-resumeStartedAt);
    }
    // A cancelled/replaced player must not admit new provider/session work
    // after either asynchronous prerequisite finishes. Already-admitted POSTs
    // still reach the existing late-response session cleanup below.
    const admitted = () => !handle.cancelled && current === handle && dialog.open
      && scope?.generation === playbackOwner()?.generation;
    if (!admitted()) return false;
    const prepareStartedAt = performance.now();
    handle.createController = new AbortController();
    // Server jen resolvuje zdroj a vrátí přímý odkaz poskytovatele (#153);
    // video, jeho délku i stopy otevírá prohlížeč sám.
    const source = await api("playback", {
      method: "POST", expectedOwner: scope, playbackAttempt: handle.telemetry,
      signal: handle.createController.signal,
      body: selection,
    });
    handle.createController = null;
    handle.telemetry.stage("session_prepare", performance.now()-prepareStartedAt);
    const startAt = offset;
    const session = { audio: [], subtitles: [], chapters: [], get duration() {
      return Number.isFinite(handle.video?.duration) ? handle.video.duration : 0;
    } };
    const trackKey = t => JSON.stringify([t?.language || null, t?.name || null]);
    const saveSelection = () => rememberPlayback(t.id, episode, selection,
      { index: audio, key: trackKey(session.audio.find(t => t.index === audio)) },
      { index: subtitle, key: subtitle < 0 ? "off" : trackKey(session.subtitles.find(t => t.index === subtitle)) }, scope);
    let failureDiagnostics = null;
    const reportFailure = feedbackButton(translateUI("Nahlásit chybu"), () => createFeedbackDialog("bug", "mine", "web", failureDiagnostics), "small");
    reportFailure.hidden = true;
    function captureFailure(stage, error, code) {
      if (handle.cancelled) return;
      failureDiagnostics = playbackDiagnostics(stage, selection.diagnostic_provider, error, code);
      void handle.reportTelemetry(failureDiagnostics);
      reportFailure.hidden = !feedbackAllowed();
      reportFailure.dataset.feedbackEntry = "";
      reportFailure.parentElement?.classList.add("is-error");
    }
    if (handle.cancelled || current !== handle || !dialog.open) return false;
    const video = el("video", {
      playsinline: true,
      preload: "auto",
      class: "video-player",
    });
    handle.video = video;
    handle.telemetry.observe(video);
    const mediaStartedAt = performance.now();
    video.addEventListener("loadedmetadata", () => handle.telemetry.stage("media_opened", performance.now()-mediaStartedAt), {once:true});
    video.playbackRate = inParty ? 1 : mediaPreferences.playback_rate;
    if (inParty) {
      // Hodiny místnosti sleduje čistý automat (#146): připravený seek, jeden
      // retry, slew, ochrana bufferu v pauze. Do místnosti jde jen záměr
      // uživatele (#147): ovládání volá partyTransport přímo, play/pause
      // vyvolané smyčkou se neodesílají a seeky smyčky nikdy.
      const follower = createPartyFollower();
      const expected = { play: 0, pause: 0 };
      const intendedPosition = () => {
        try { return partyPosition(); } catch { return video.currentTime; }
      };
      const publishIntent = (playing) => {
        if (handle.cancelled || !partyPlaybackMatches(handle.partyPlayback) || partyWaiting()) return;
        partyTransport(playing, intendedPosition()).catch((e) => toast(e.message));
      };
      handle.partyToggle = () => publishIntent(partyState()?.status !== "playing");
      const pauseVideo = () => {
        if (video.paused) return;
        expected.pause = Date.now() + 1500;
        video.pause();
      };
      video.addEventListener("play", () => {
        if (expected.play > Date.now()) {
          expected.play = 0;
          return;
        }
        if (partyWaiting()) {
          pauseVideo();
          return;
        }
        // Spuštění mimo ovládání přehrávače (obraz v obraze, mediální klávesy).
        if (partyState()?.status !== "playing") publishIntent(true);
      });
      video.addEventListener("pause", () => {
        if (expected.pause > Date.now()) {
          expected.pause = 0;
          return;
        }
        if (video.ended) return;
        if (partyState()?.status === "playing") publishIntent(false);
      });
      handle.partyTimer = setInterval(() => {
        if (handle.cancelled) return;
        if (!partyPlaybackMatches(handle.partyPlayback)) { pauseVideo(); return; }
        const waiting = partyWaiting();
        let target;
        try { target = waiting ? 0 : partyPosition(); } catch { return; }
        const mediaReady = video.readyState >= 3 && !video.error;
        const here = video.currentTime;
        const ready = mediaReady && !video.seeking && (!waiting || Math.abs(here - target) <= 0.5);
        reportPartyReady(ready, handle.partyPlayback);
        handle.controls?.update();
        if (video.readyState < 1 || video.error) return;
        const buffered = [];
        for (let i = 0; i < video.buffered.length; i++)
          buffered.push([video.buffered.start(i), video.buffered.end(i)]);
        const step = follower.tick({
          now: performance.now(), position: here, seeking: video.seeking, ready: mediaReady,
          playing: !video.paused, target, roomPlaying: !waiting && partyState().status === "playing",
          waiting, buffered, duration: session.duration,
          produced: video.seekable.length ? video.seekable.end(video.seekable.length - 1) : null,
        });
        if (step.seekTo !== null) video.currentTime = Math.max(0, step.seekTo);
        if (step.play && video.paused) {
          expected.play = Date.now() + 1500;
          video.play().catch(() => {
            expected.play = 0;
            status.textContent = translateUI("Prohlížeč vyžaduje klepnutí na přehrát.");
          });
        }
        if (!step.play) pauseVideo();
        if (video.playbackRate !== step.rate) video.playbackRate = step.rate;
        if (step.diagnostic) console.debug("[party]", step.diagnostic);
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
    const handoff = el("div", { class: "pk-handoff-slot" });
    const position = el("input", {
      type: "range",
      min: 0,
      max: Math.floor(session.duration),
      value: Math.floor(startAt),
      step: 1,
      "aria-label": translateUI("Pozice ve filmu"),
    });
    const clock = el("span", { class: "pk-clock" }, time(startAt));
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
    // Stopy zpřístupňuje jen prohlížeč (audioTracks v Safari, textTracks);
    // seznam se doplní po načtení metadat.
    const tracks = el("div"), subtitles = el("div");
    const renderTracks = () => {
      tracks.replaceChildren(session.audio.length > 1 ? radioGroup(
        translateUI("Zvuková stopa"),
        session.audio.map((a) => ({
          value: a.index,
          label: a.name || a.language || translateUI("Zvuk {0}", a.index + 1),
        })),
        audio,
        (value) => changeTracks(value, subtitle),
      ) : []);
      subtitles.replaceChildren(session.subtitles.length ? radioGroup(
        translateUI("Titulky"),
        [
          { value: -1, label: translateUI("Titulky vypnuté") },
          ...session.subtitles.map((s) => ({
            value: s.index,
            label: s.name || s.language || translateUI("Stopa {0}", s.index + 1),
          })),
        ],
        subtitle,
        (value) => changeTracks(audio, value),
      ) : []);
    };
    const readTracks = () => {
      const list = video.audioTracks;
      session.audio = [];
      for (let i = 0; list && i < list.length; i++)
        session.audio.push({ index: i, language: list[i].language || null, name: list[i].label || null });
      session.subtitles = [];
      for (let i = 0; i < video.textTracks.length; i++)
        if (["subtitles", "captions"].includes(video.textTracks[i].kind))
          session.subtitles.push({ index: i, language: video.textTracks[i].language || null, name: video.textTracks[i].label || null });
      if (restoreTracks) {
        audio = session.audio.find((a) => trackKey(a) === saved.audio.key)?.index ?? audio;
        subtitle = saved.subtitle.key === "off" ? -1
          : session.subtitles.find((s) => trackKey(s) === saved.subtitle.key)?.index ?? -1;
      }
      if (!session.audio.some((a) => a.index === audio)) audio = 0;
      if (!session.subtitles.some((s) => s.index === subtitle)) subtitle = -1;
    };
    const applyTracks = () => {
      const list = video.audioTracks;
      for (let i = 0; list && i < list.length; i++) list[i].enabled = i === audio;
      for (let i = 0; i < video.textTracks.length; i++)
        if (["subtitles", "captions"].includes(video.textTracks[i].kind))
          video.textTracks[i].mode = i === subtitle ? "showing" : "disabled";
    };
    const positionNow = () => video.currentTime || 0;
    const history = async () => {
      const owner = playbackOwner();
      if (!scope || owner?.accountId !== scope.accountId
        || owner?.profileId !== scope.profileId || owner?.generation !== scope.generation) return;
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
    const clamp = (target) => Math.max(0, Math.min(session.duration || Infinity, Number(target) || 0));
    const seekTo = (target) => {
      if (inParty)
        return partyTransport(partyState().status === "playing", clamp(target)).catch((e) => toast(e.message));
      video.currentTime = clamp(target);
    };
    position.addEventListener("change", () => seekTo(Number(position.value)));
    const changeTracks = (nextAudio, nextSubtitle) => {
      audio = nextAudio;
      subtitle = nextSubtitle;
      applyTracks();
      renderTracks();
      saveSelection();
    };
    video.addEventListener("timeupdate", () => {
      position.value = Math.floor(positionNow());
      fill();
      clock.textContent = session.duration > 0 ? `${time(positionNow())} / ${time(session.duration)}` : time(positionNow());
    });
    video.addEventListener("durationchange", () => {
      position.max = Math.floor(session.duration);
      fill();
    });
    const offerApp = (message, retry = false) => {
      if (handle.cancelled || handoff.childElementCount) return;
      handoff.replaceChildren(appHandoff(t, message));
      // Odkaz může vypršet nebo ho poskytovatel omezí (např. datový limit
      // zdarma, HTTP 402). Nový odkaz vyžádá jen divák, žádná smyčka.
      if (retry)
        handoff.firstChild.lastChild.prepend(button(translateUI("Zkusit znovu"), () =>
          play(t, episode, selection, inParty ? null : positionNow(), audio, subtitle), "secondary small"));
    };
    let audioChecked = false;
    video.addEventListener("playing", () => {
      saveSelection();
      status.textContent = "";
      if (audioChecked) return;
      audioChecked = true;
      // Obraz běží, ale zvuk (AC-3, DTS…) prohlížeč mlčky zahodil.
      const from = video.currentTime;
      const check = () => {
        if (handle.cancelled) return;
        if (video.currentTime - from < 3) { setTimeout(check, 1000); return; }
        if (audioMissing(video)) {
          captureFailure("playback", {}, "browser_audio_unsupported");
          offerApp(translateUI("Prohlížeč neumí přehrát zvuk tohoto zdroje. Zkus jiný zdroj, nebo ho otevři v aplikaci."));
        }
      };
      setTimeout(check, 1000);
    });
    video.addEventListener("waiting", () => {
      status.textContent = translateUI("Načítám video…");
    });
    video.addEventListener("error", () => {
      captureFailure("playback", { mediaCode: video.error?.code });
      status.textContent = translateUI(
        "Prohlížeč nemůže video přehrát. Zkus jiný zdroj.",
      );
      offerApp(unplayableInBrowser({ mediaCode: video.error?.code })
        ? translateUI("Prohlížeč neumí formát tohoto zdroje přehrát.")
        : translateUI("Poskytovatel přestal video posílat (odkaz vypršel nebo je omezený)."), video.error?.code === 2);
    });
    const currentRate = inParty ? 1 : mediaPreferences.playback_rate;
    const speedButtons = [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(rate === currentRate),
          disabled: inParty,
          onClick: () => {
            mediaPreferences.playback_rate = rate;
            try {
              localStorage.setItem("movly.mediaPreferences", JSON.stringify(mediaPreferences));
            } catch {}
            video.playbackRate = rate;
            for (const node of speedButtons) node.setAttribute("aria-pressed", String(node.textContent === rate + "×"));
          },
        },
        rate + "×",
      ),
    );
    const speed = el(
      "div",
      { class: "pk-segmented pk-speed", role: "group", "aria-label": translateUI("Rychlost přehrávání") },
      ...speedButtons,
    );
    const subtitleDelay = el("input", {
      type: "number",
      min: -10000,
      max: 10000,
      step: 100,
      value: mediaPreferences.subtitle_delay,
      "aria-label": translateUI("Posun titulků (ms)"),
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
    const skipIntro = el("div", {class:"pk-intro-controls"});
    // Přeskočení intra potřebuje délku dílu, tu zná až prohlížeč.
    video.addEventListener("loadedmetadata", () => {
      if (handle.cancelled || handle.introCleanup) return;
      handle.introCleanup = mountIntroSkip({container:skipIntro,scope,title:t.id,episode,duration:session.duration,
        position:positionNow,playing:()=>!video.paused,canSeek:()=>video.readyState>=2&&!partyWaiting()&&(!inParty||partyIsHost()),
        chapters:session.chapters,current:()=>current===handle&&!handle.cancelled,
        machine:introMachine,seek:async (target)=>{ await seekTo(target); }});
    }, { once: true });
    // Další díl se dohledá jednou (odpočet, konec dílu i tlačítko ho sdílí).
    const nextLookup = () =>
      (handle.nextLookup ||= (async () => {
        const data = await api(`titles/${t.id}`);
        const seasons = data.seasons || (await api(`titles/${t.id}/seasons`));
        return nextReleasedEpisode(array(seasons), episode.id);
      })().catch((error) => {
        // Neúspěch se necachuje, další pokus (konec dílu, tlačítko) zkusí znovu.
        handle.nextLookup = null;
        throw error;
      }));
    const autoplayEnabled = () => localStorage.getItem("movly.autoplayNext") !== "false";
    const openNext = async (automatic) => {
      try {
        const next = await nextLookup();
        if (!next) return automatic ? undefined : toast(translateUI("Další díl zatím není dostupný."));
        if (current !== handle || handle.cancelled) return;
        autoplayChain = automatic ? autoplayChain + 1 : 0;
        await sources(t, next, { autoPlay: true });
      } catch (e) {
        toast(translateUI("Další díl se nepodařilo připravit: {0}", e.message));
      }
    };
    const nextPanel = el("div", { class: "pk-next", hidden: true, "aria-live": "polite" });
    const showNextPanel = (text, primaryLabel, onPrimary, secondaryLabel, onSecondary) => {
      nextPanel.replaceChildren(
        el("span", { class: "pk-next-text" }, text),
        el("div", { class: "pk-next-actions" },
          button(primaryLabel, onPrimary, "primary small"),
          button(secondaryLabel, onSecondary, "secondary small"),
        ),
      );
      nextPanel.hidden = false;
    };
    const hideNextPanel = () => {
      nextPanel.hidden = true;
      nextPanel.replaceChildren();
      handle.countdownShown = null;
    };
    const askToContinue = autoplayChain >= CONTINUE_PROMPT_AFTER;
    const updateCountdown = () => {
      if (!episode || inParty || handle.nextCancelled || askToContinue || !autoplayEnabled()) {
        if (handle.countdownShown != null) hideNextPanel();
        return;
      }
      const remaining = session.duration - positionNow();
      if (remaining <= 30 && !handle.nextLookup) nextLookup().then((next) => { handle.nextAvailable = !!next; }, () => {});
      const seconds = nextCountdown(remaining, { available: handle.nextAvailable === true });
      if (seconds == null) {
        if (handle.countdownShown != null) hideNextPanel();
        return;
      }
      if (handle.countdownShown === seconds) return;
      handle.countdownShown = seconds;
      showNextPanel(
        translateUI("Další díl za {0} s", seconds),
        translateUI("Přehrát teď"),
        () => void openNext(false),
        translateUI("Zrušit"),
        () => {
          handle.nextCancelled = true;
          hideNextPanel();
        },
      );
    };
    video.addEventListener("timeupdate", updateCountdown);
    video.addEventListener("ended", async () => {
      try {
        await history();
      } catch (e) {
        toast(translateUI("Historie se neuložila: {0}", e.message));
      }
      status.textContent = translateUI("Přehrávání dokončeno.");
      if (!episode || handle.cancelled || partyState() || !autoplayEnabled() || handle.nextCancelled) return;
      if (askToContinue) {
        // Po několika dílech bez zásahu diváka se automatické přehrávání zastaví.
        const next = await nextLookup().catch(() => null);
        if (!next || current !== handle || handle.cancelled) return;
        showNextPanel(
          translateUI("Pokračovat ve sledování?"),
          translateUI("Pokračovat"),
          () => void openNext(false),
          translateUI("Ukončit"),
          () => {
            autoplayChain = 0;
            hideNextPanel();
          },
        );
        return;
      }
      await openNext(true);
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
        el("summary", {}, translateUI("Synchronizace titulků")),
        el(
          "div",
          { class: "pk-advanced-grid" },
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
              onClick: () => openNext(false),
            },
            svgGlyph(["M5 5v14l10-7zM17 5h2.5v14H17z"], { fill: "currentColor", stroke: "none" }),
            el("span", {}, translateUI("Další epizoda")),
          )
        : null;
    skipIntro.classList.add("pk-skip-intro");
    const stage = el("div", { class: "pk-stage" }, video, nextPanel, settings);
    const seekBar = el(
      "div",
      { class: "player-seek pk-seek" },
      el("div", { class: "pk-seek-track" }, chapterMarks, position),
      clock,
    );
    const screen = el("div", { class: "pk-screen" }, stage, seekBar);
    const playerRoot = el("div", { class: "dialog-body player-body pk-player" });
    const controls = mountPlayerControls({
      el,
      glyph: svgGlyph,
      translate: translateUI,
      video,
      screen,
      keyRoot: playerRoot,
      storage: localStorage,
      positionNow,
      seekTo,
      togglePlayback: inParty ? () => handle.partyToggle?.() : null,
      active: () => current === handle && !handle.cancelled && playerRoot.isConnected && dialog.open,
      disabled: () => inParty && partyWaiting(),
      pageFullscreen: keepPageFullscreen,
      onInteraction: () => {
        autoplayChain = 0;
      },
    });
    screen.append(controls.element);
    handle.controls = controls;
    playerRoot.append(
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
        screen,
        el("div", { class: "pk-status" }, status, handoff, reportFailure),
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
          el("li", {}, translateUI("Přehrává se přímo od poskytovatele, bez úprav na serveru Movly")),
        ),
    );
    showDialog(playerRoot);
    const begin = () => {
      if (handle.cancelled) return;
      readTracks();
      applyTracks();
      renderTracks();
      if (startAt > 0 && !inParty) video.currentTime = startAt;
      if (!inParty)
        video.play().catch(() => {
          status.textContent = translateUI("Stiskni přehrát.");
        });
    };
    video.addEventListener("loadedmetadata", begin, { once: true });
    // Safari/WebKit MKV neotevře a ani nenahlásí chybu; bez metadat po 20 s
    // nabídneme jiný zdroj nebo aplikaci.
    handle.openWatchdog = setTimeout(() => {
      if (handle.cancelled || video.readyState >= 1 || video.error) return;
      captureFailure("playback", {}, "browser_open_timeout");
      offerApp(translateUI("Prohlížeč tento zdroj neotevřel (formát nebo poskytovatel). Zkus jiný zdroj, nebo ho otevři v aplikaci."), true);
    }, OPEN_TIMEOUT_MS);
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
    if (source.kind === "file" || nativeHls) {
      handle.telemetry.setEngine(source.kind === "file" ? "direct_file" : "native_hls");
      video.src = source.url;
    } else if (Hls.isSupported()) {
      handle.telemetry.setEngine("hls_mse");
      const hls = new Hls({ enableWorker: false, startPosition: inParty ? 0 : startAt, maxBufferLength: 24 });
      handle.hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        captureFailure("playback", { status: data.response?.code }, data.type === Hls.ErrorTypes.NETWORK_ERROR ? "hls_network_failed" : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "hls_media_failed" : "hls_other_failed");
        status.textContent = translateUI("Přehrávání se přerušilo.");
        // Bez CORS poskytovatele hls.js segmenty nestáhne; to umí jen aplikace.
        offerApp(translateUI("Poskytovatel nedovoluje přehrát tento stream v prohlížeči."), data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code > 0);
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
    } else {
      captureFailure("playback", {}, "browser_hls_unsupported");
      status.textContent = translateUI("Tento prohlížeč nepodporuje HLS video.");
      offerApp(translateUI("Tento prohlížeč nepodporuje HLS video."));
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
    return true;
  } catch (e) {
    handle.createController = null;
    if (!handle.cancelled && current === handle && dialog.open) {
      void handle.reportTelemetry(playbackDiagnostics(e.body?.diagnostic_stage || "source_resolve", selection.diagnostic_provider, e));
      showDialog(
        el(
          "div",
          { class: "dialog-body pk-player-error" },
          el("h2", { id: "dialog-title" }, t.title),
          e.body?.code === "app_required"
            ? appHandoff(t, e.message)
            : errorBox(e, () =>
                play(t, episode, selection, offset, audio, subtitle),
              ),
          el(
            "div",
            { class: "pk-error-actions" },
            button(translateUI("Vybrat jiný zdroj"), () => sources(t, episode, { skipResume: true })),
            button(translateUI("Připojit Webshare"), providerSettings),
            feedbackAllowed() ? feedbackButton(translateUI("Nahlásit chybu"), () => createFeedbackDialog("bug", "mine", "web", playbackDiagnostics(e.body?.diagnostic_stage || "source_resolve", selection.diagnostic_provider, e)), "small") : null,
          ),
        ),
      );
    }
  }
}
export async function stop(reason = "cancelled") {
  const handle = current;
  if (!handle) return;
  handle.telemetry?.dispose(reason);
  current = null;
  handle.cancelled = true;
  handle.createController?.abort();
  handle.createController = null;
  handle.introCleanup?.();
  handle.controls?.cleanup();
  clearInterval(handle.timer);
  clearTimeout(handle.openWatchdog);
  clearInterval(handle.subtitleTimer);
  clearInterval(handle.partyTimer);
  endPartyPlayback(handle.partyPlayback);
  handle.video?.pause();
  // HLS detach resets the media clock. Start saving its final snapshot now,
  // without delaying media teardown while the request is pending.
  const historySaved = handle.history?.().catch((e) =>
    toast(translateUI("Historie se neuložila: {0}", e.message)),
  );
  handle.hls?.destroy();
  // Přímý odkaz: odpojení zdroje zastaví stahování od poskytovatele.
  if (handle.video) {
    handle.video.removeAttribute("src");
    handle.video.load();
  }
  await historySaved;
}

function feedbackButton(...args) {
  const node = button(...args);
  node.dataset.feedbackEntry = "";
  return node;
}
