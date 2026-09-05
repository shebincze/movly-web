import { api, array } from "./api.js";
import {
  el,
  button,
  showDialog,
  loading,
  errorBox,
  formField,
  toast,
} from "./ui.js";
import Hls from "./vendor/hls.mjs";
let current = null;
const time = (n) =>
  `${Math.floor(n / 3600) ? `${Math.floor(n / 3600)}:` : ""}${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(Math.floor(n) % 60).padStart(2, "0")}`;
export async function providerSettings() {
  await stop();
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, "Úložiště · Webshare"),
      loading(),
    ),
  );
  try {
    const state = await api("providers/webshare");
    const status = el("p", { role: "alert", class: "form-status" });
    const user = el("input", {
      required: true,
      autocomplete: "username",
      maxlength: 254,
    });
    const password = el("input", {
      type: "password",
      required: true,
      autocomplete: "current-password",
      maxlength: 1024,
    });
    const submit = el(
      "button",
      { type: "submit", class: "button primary" },
      "Připojit Webshare",
    );
    const form = el(
      "form",
      {
        class: "dialog-form",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api("providers/webshare", {
              method: "POST",
              body: { username: user.value, password: password.value },
            });
            password.value = "";
            await providerSettings();
          } catch (e) {
            status.textContent = e.message;
            submit.disabled = false;
          }
        },
      },
      formField("Uživatelské jméno Webshare", user),
      formField("Heslo Webshare", password),
      status,
      submit,
    );
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, "Úložiště · Webshare"),
        el(
          "p",
          {},
          "Připoj svůj účet úložiště pro přehrávání jeho zdrojů. Přihlášení platí pro tuto webovou relaci.",
        ),
        state.connected
          ? el(
              "div",
              {},
              el(
                "p",
                {},
                `${state.username} · ${state.vip ? "VIP aktivní" : "Bez VIP"}`,
              ),
              button(
                "Odpojit Webshare",
                async () => {
                  try {
                    await api("providers/webshare", { method: "DELETE" });
                    await providerSettings();
                  } catch (e) {
                    status.textContent = e.message;
                  }
                },
                "danger",
              ),
              status,
            )
          : form,
      ),
    );
  } catch (e) {
    if (dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body" },
          el("h2", { id: "dialog-title" }, "Úložiště"),
          errorBox(e, providerSettings),
        ),
      );
  }
}
let sourceRevision = 0;
export async function sources(t, episode) {
  await stop();
  const revision = ++sourceRevision;
  const content = el(
    "div",
    { class: "dialog-body sources-content" },
    el("h2", { id: "dialog-title" }, `Přehrát · ${t.title}`),
    episode
      ? el(
          "p",
          {},
          `S${episode.season_number} E${episode.episode_number} · ${episode.name || ""}`,
        )
      : null,
  );
  const summary = el("p", { role: "status" }, "Hledám ve zdrojích…");
  const search = el("input", {
    type: "search",
    placeholder: "Název souboru, jazyk, kodek…",
    "aria-label": "Filtrovat zdroje",
  });
  const provider = el(
    "select",
    { "aria-label": "Poskytovatel" },
    el("option", { value: "" }, "Všichni poskytovatelé"),
  );
  const quality = el(
    "select",
    { "aria-label": "Kvalita" },
    ...[
      ["", "Všechny kvality"],
      ["2160", "4K"],
      ["1080", "Full HD"],
      ["720", "HD"],
    ].map(([value, name]) => el("option", { value }, name)),
  );
  const sort = el(
    "select",
    { "aria-label": "Řazení zdrojů" },
    el("option", { value: "quality" }, "Nejvyšší kvalita"),
    el("option", { value: "small" }, "Nejmenší soubor"),
    el("option", { value: "large" }, "Největší soubor"),
  );
  const statuses = el("div", { class: "source-statuses" }),
    list = el("div", { class: "source-list" });
  content.append(
    el(
      "div",
      { class: "actions" },
      button("Nastavení Webshare", providerSettings, "small"),
      button("Obnovit zdroje", () => sources(t, episode), "small"),
    ),
    el("div", { class: "source-filters" }, search, provider, quality, sort),
    summary,
    statuses,
    list,
  );
  const dialog = showDialog(content),
    results = new Map();
  let pending = 4;
  const origins = [
    "Databáze",
    "Databáze AI",
    "Webshare · živé hledání",
    "Hellspy · živé hledání",
  ];
  const rows = origins.map((name) => {
    const n = el(
      "p",
      { class: "source-status", role: "status" },
      `${name}: hledám…`,
    );
    statuses.append(n);
    return n;
  });
  function render() {
    const seen = new Set(),
      all = [];
    for (let i = 0; i < 4; i++)
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
    summary.textContent = `${filtered.length} z ${all.length} zdrojů${pending ? ` · hledání pokračuje (${pending})` : ""}`;
    list.replaceChildren(
      ...filtered.map((stream) => {
        const supported =
          /^(webshare|hellspy)$/i.test(
            stream.provider_name || stream.provider_identifier || "",
          ) && stream.available !== false;
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
        const choice = button(
          "Přehrát",
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
              stream.file_name || metadata || `Zdroj ${stream.id}`,
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
                    ? "Zdroj není dostupný"
                    : "Přehrávání tohoto poskytovatele zatím není na webu dostupné.",
                )
              : null,
          ),
          choice,
        );
      }),
    );
    if (!filtered.length && !pending)
      list.append(
        el(
          "p",
          {},
          all.length
            ? "Žádné zdroje neodpovídají filtrům."
            : "Žádné výsledky. Zkontroluj stav poskytovatelů výše.",
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
    ].map(async (path, i) => {
      try {
        const data = await api(path);
        if (revision !== sourceRevision || !dialog.open) return;
        const streams = array(data.streams);
        results.set(i, streams);
        rows[i].textContent =
          `${origins[i]}: ${data.state === "not_connected" ? data.message : `${streams.length} výsledků`}${data.partial ? " · neúplné hledání" : ""}`;
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
}
async function play(
  t,
  episode,
  selection,
  offset = null,
  audio = 0,
  subtitle = -1,
) {
  await stop();
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body" },
      el("h2", { id: "dialog-title" }, t.title),
      loading(),
    ),
  );
  const handle = { cancelled: false };
  current = handle;
  try {
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
      method: "POST",
      body: { ...selection, offset, audio, subtitle },
    });
    handle.session = session;
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
    const status = el(
      "p",
      { role: "status", class: "player-status" },
      "Připravuji video…",
    );
    const position = el("input", {
      type: "range",
      min: 0,
      max: Math.floor(session.duration),
      value: Math.floor(offset),
      step: 1,
      "aria-label": "Pozice ve filmu",
    });
    const clock = el("span", {}, `${time(offset)} / ${time(session.duration)}`);
    const tracks = el(
      "select",
      { "aria-label": "Zvuková stopa" },
      ...session.audio.map((a) =>
        el(
          "option",
          { value: a.index, selected: a.index === audio },
          a.name ||
            [a.language, a.codec].filter(Boolean).join(" · ") ||
            `Zvuk ${a.index + 1}`,
        ),
      ),
    );
    const subtitles = el(
      "select",
      { "aria-label": "Titulky" },
      el("option", { value: -1, selected: subtitle < 0 }, "Titulky vypnuté"),
      ...session.subtitles.map((s) =>
        el(
          "option",
          {
            value: s.index,
            selected: s.index === subtitle,
            disabled: !s.supported,
          },
          [
            s.name || s.language || `Stopa ${s.index + 1}`,
            !s.supported ? "obrazové titulky nejsou podporované" : null,
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
      await api("watch-history", {
        method: "POST",
        body: {
          title_id: t.id,
          type: t.type,
          watch_status: video.ended ? "completed" : "watching",
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
      play(t, episode, selection, Number(position.value), audio, subtitle),
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
      status.textContent = "";
    });
    video.addEventListener("waiting", () => {
      status.textContent = "Načítám video…";
    });
    video.addEventListener("error", () => {
      status.textContent = "Prohlížeč nemůže video přehrát. Zkus jiný zdroj.";
    });
    video.addEventListener("ended", () => {
      history().catch((e) => toast(`Historie se neuložila: ${e.message}`));
      status.textContent = "Přehrávání dokončeno.";
    });
    showDialog(
      el(
        "div",
        { class: "dialog-body player-body" },
        el("h2", { id: "dialog-title" }, t.title),
        video,
        status,
        el("div", { class: "player-seek" }, position, clock),
        el(
          "div",
          { class: "actions" },
          tracks,
          subtitles,
          button("Jiný zdroj", () => sources(t, episode), "small"),
        ),
        el(
          "p",
          { class: "login-note" },
          session.mode === "remux"
            ? "Původní obraz · zvuk AAC"
            : "Kompatibilní přehrávání · převod obrazu do H.264, nejvýše 720p",
        ),
      ),
    );
    let attempts = 0;
    async function prepare() {
      if (handle.cancelled) return;
      try {
        const state = await api(`playback/${session.id}/status`);
        if (state.error) throw new Error(state.error);
        if (!state.ready) {
          if (++attempts > 40)
            throw new Error(
              "Příprava videa trvá příliš dlouho. Vyber jiný zdroj.",
            );
          handle.prepare = setTimeout(prepare, 1000);
          return;
        }
        if (handle.cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: false,
            liveSyncDurationCount: 3,
            startPosition: 0,
            maxBufferLength: 24,
          });
          handle.hls = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal)
              status.textContent =
                "Přehrávání se přerušilo. Vyber zdroj znovu.";
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
            video.play().catch(() => {
              status.textContent = "Stiskni přehrát.";
            });
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = session.playlist;
          video.play().catch(() => {
            status.textContent = "Stiskni přehrát.";
          });
        } else throw new Error("Tento prohlížeč nepodporuje HLS video.");
        handle.timer = setInterval(
          () =>
            history().catch((e) => {
              status.textContent = `Historie se neuložila: ${e.message}`;
            }),
          20000,
        );
      } catch (e) {
        status.textContent = e.message;
      }
    }
    prepare();
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
          button("Připojit Webshare", providerSettings),
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
  handle.video?.pause();
  handle.hls?.destroy();
  if (handle.history)
    await handle
      .history()
      .catch((e) => toast(`Historie se neuložila: ${e.message}`));
  if (handle.session)
    await api(`playback/${handle.session.id}`, { method: "DELETE" }).catch(
      () => {},
    );
}
