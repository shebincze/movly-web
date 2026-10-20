import "./play-activation.js";
import { externalListCards, externalListDetail } from "./external-lists.js";
import { seriesNotificationButton } from "./notifications.js";
import { translateUI } from "./i18n.js";
import { hostParty } from "./party.js";
import { api, array, listTitle, imageURL, title } from "./api.js";
import {
  el,
  button,
  icon,
  loading,
  empty,
  errorBox,
  poster,
  rail,
  formField,
  showDialog,
  toast,
  countLabel,
} from "./ui.js";
import { sources } from "./player.js";
import {
  titleActivity,
  libraryHead,
  listCard,
  recentHistory,
  initialAvatar,
} from "./personal.js";
import { noteArtwork, applyUserState, isWatched, progressPercent } from "./user-state.js";
import { episodeState, toggleEpisodeWatched } from "./episode-state.js";
let detailRevision = 0;
export function invalidateDetail() {
  detailRevision++;
}
function glyph(d, filled) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: filled ? "currentColor" : "none", stroke: filled ? "none" : "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }))
    svg.setAttribute(k, v);
  for (const path of [].concat(d)) {
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", path);
    svg.append(p);
  }
  return svg;
}
const PLAY = "M7 4.5v15l13-7.5z";
// Celoobrazovkový detail ve sdíleném <dialog>: zavírací tlačítko, Esc i fokus zůstávají dialogu.
function sheet(...children) {
  return el("div", { class: "dialog-body detail-sheet" }, ...children);
}
// Odkazy v navigaci detailu jen posouvají obsah — hash by změnil route aplikace.
function sectionNav(sections) {
  if (sections.length < 2) return null;
  return el(
    "nav",
    { class: "detail-tabs", "aria-label": translateUI("Sekce detailu") },
    sections.map(([label, target]) =>
      el("button", { type: "button", onClick: () => target.scrollIntoView({ behavior: "smooth", block: "start" }) }, label),
    ),
  );
}
export async function detail(t, actions) {
  const revision = ++detailRevision;
  const dialog = showDialog(sheet(el("h2", { id: "dialog-title", class: "detail-loading-title" }, t.title), loading()));
  try {
    const data = await api(`titles/${t.id}`);
    if (revision !== detailRevision || !dialog.open) return;
    if (data.id !== t.id || typeof data.title !== "string")
      throw new Error(translateUI("API vrátilo neplatný detail titulu."));
    // Karta v seznamu mohla přijít bez plakátu; po zavření detailu ho dostane.
    noteArtwork(data.id, data.poster_path, data.backdrop_path);
    const art = imageURL(data.backdrop_path, "w1280");
    const posterArt = imageURL(data.poster_path);
    const isTV = data.type === "tv";
    const firstEpisode = (data.seasons || []).filter(s => s.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .flatMap(s => (s.episodes || []).filter(e => e.episode_number > 0 && !episodeState(e).upcoming)
        .sort((a, b) => a.episode_number - b.episode_number)
        .map(e => ({ ...e, season_number: s.season_number })))[0];
    const seasonCount = (data.seasons || []).filter((s) => s.season_number > 0).length;
    const facts = el(
      "div",
      { class: "detail-facts" },
      [
        data.year || data.release_date?.slice(0, 4),
        (data.genres || []).map((g) => g.name_cs || g.name).join(", "),
        data.runtime ? `${data.runtime} min` : null,
      ]
        .filter(Boolean)
        .map((v) => el("span", {}, v)),
    );
    const ratings = Array.isArray(data.ratings) ? data.ratings : t.ratings || [];
    const metadata = el("span", { class: "detail-ratings" });
    for (const r of ratings)
      if (Number.isFinite(r.rating))
        metadata.append(el("span", { class: "rating-badge" }, el("strong", {}, `${r.rating}%`), r.source));
    if (!ratings.length && Number.isFinite(data.vote_average_tmdb) && data.vote_average_tmdb > 0)
      metadata.append(el("span", { class: "rating-badge" }, `TMDB ${data.vote_average_tmdb.toFixed(1)}/10`));
    const streams = data.streams || t.streams;
    if (streams?.video_height)
      metadata.append(el("span", { class: "rating-badge flag" }, `${streams.video_height}p`));
    if (streams?.hdr_type) metadata.append(el("span", { class: "rating-badge flag" }, streams.hdr_type));
    if (streams?.audio_languages?.length)
      metadata.append(el("span", { class: "rating-badge" }, streams.audio_languages.join(" · ")));
    if (metadata.childNodes.length) facts.append(metadata);
    const wp = data.watch_progress;
    const pct = wp?.progress_percentage ?? wp?.progress_percent;
    const left = Number.isFinite(wp?.duration_seconds) && Number.isFinite(wp?.progress_seconds)
      ? Math.round((wp.duration_seconds - wp.progress_seconds) / 60) : 0;
    const progress = Number.isFinite(pct) && pct > 0 && pct < 100 && !wp.is_completed && wp.watch_status !== "completed"
      ? el(
          "div",
          { class: "detail-progress" },
          el("progress", { max: 100, value: Math.round(pct), "aria-label": translateUI("Rozkoukáno") }),
          el(
            "span",
            {},
            [
              isTV && wp.season_number && wp.episode_number ? `S${wp.season_number} E${wp.episode_number}` : null,
              translateUI("Rozkoukáno"),
              left > 0 ? translateUI("zbývá {0} min", left) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        )
      : null;
    const playTitle = (manual = false) => {
      const options = { skipResume: manual, autoPlay: false };
      if (!isTV) return sources(data, undefined, options);
      if (firstEpisode) return sources(data, firstEpisode, options);
      toast(translateUI("Žádná vydaná epizoda zatím není dostupná."));
    };
    const play = button(translateUI("Přehrát"), () => playTitle(), "primary");
    window.attachPlayChoice(play, () => playTitle(true), translateUI("Vybrat jiný zdroj"));
    play.prepend(glyph(PLAY, true));
    const trailer = (data.videos || [])
      .filter((v) => v.site?.toLowerCase() === "youtube" && /^[a-zA-Z0-9_-]{6,20}$/.test(v.key || ""))
      .sort(
        (a, b) =>
          (b.language === "cs") - (a.language === "cs") ||
          (b.type === translateUI("Trailer")) - (a.type === translateUI("Trailer")) ||
          Number(b.official) - Number(a.official),
      )[0];
    const actionRow = el(
      "div",
      { class: "actions detail-actions" },
      play,
      trailer
        ? el(
            "a",
            { class: "button secondary", href: `https://www.youtube.com/watch?v=${trailer.key}`, target: "_blank", rel: "noopener noreferrer" },
            glyph(["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "m10 9 5 3-5 3z"]),
            translateUI("Trailer"),
          )
        : null,
      button(translateUI("Do seznamu"), () => actions.save(data), "secondary", "plus"),
      seriesNotificationButton(data.id, () => void detail(data, actions), isTV ? "tv" : "movie"),
      button(translateUI("Hodnotit"), () => titleActivity(data, "rating"), "secondary"),
      !isTV || firstEpisode
        ? button(translateUI("Sledovat společně"), () => hostParty(data, firstEpisode), "secondary")
        : null,
      button(translateUI("Označit"), () => titleActivity(data, "watched"), "secondary", "check"),
    );
    const heroNode = el(
      "section",
      { class: `detail-hero${art ? "" : " no-art"}` },
      art
        ? el("img", {
            class: "detail-art",
            src: art,
            alt: "",
            onError: (e) => {
              e.target.remove();
              heroNode.classList.add("no-art");
            },
          })
        : null,
      el("div", { class: "detail-hero-shade" }),
      el(
        "div",
        { class: "detail-hero-inner" },
        posterArt
          ? el("img", { class: "detail-poster", src: posterArt, alt: "", onError: (e) => e.target.remove() })
          : null,
        el(
          "div",
          { class: "detail-hero-copy" },
          el(
            "span",
            { class: "detail-kicker" },
            [
              isTV ? translateUI("Seriál") : translateUI("Film"),
              isTV && seasonCount ? countLabel(seasonCount, translateUI("řada"), translateUI("řady"), translateUI("řad")) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
          el("h2", { id: "dialog-title" }, data.title),
          facts,
          data.tagline ? el("p", { class: "tagline" }, data.tagline) : null,
          el("p", { class: "synopsis" }, data.overview || translateUI("Popis tohoto titulu zatím není dostupný.")),
          progress,
          actionRow,
        ),
      ),
    );
    const main = el("div", { class: "detail-main" });
    const sections = [];
    const section = (label, ...children) => {
      const node = el("section", { class: "detail-section" }, el("h3", {}, label), ...children);
      sections.push([label, node]);
      return node;
    };
    const directors = (data.credits || []).filter((c) => c.job === "Director");
    const info = el("dl", { class: "detail-info" });
    const infoRow = (label, value) => value && info.append(el("dt", {}, label), el("dd", {}, value));
    infoRow(translateUI("Původní název"), data.original_title && data.original_title !== data.title ? data.original_title : null);
    infoRow(translateUI("Režie"), directors.map((c) => c.name).join(", "));
    infoRow(translateUI("Země"), data.country);
    infoRow(translateUI("Zvuk"), streams?.audio_languages?.length ? streams.audio_languages.map((l) => l.toUpperCase()).join(", ") : null);
    const aside = el(
      "aside",
      { class: "detail-aside" },
      el(
        "section",
        { class: "detail-panel" },
        el("h3", {}, translateUI("Informace")),
        info,
        el(
          "div",
          { class: "detail-panel-actions" },
          button(translateUI("Skrýt"), () => titleActivity(data, "hidden"), "secondary small"),
        ),
      ),
    );
    if (isTV) {
      const seasons = data.seasons?.some((s) => Array.isArray(s.episodes))
        ? { seasons: data.seasons }
        : await api(`titles/${data.id}/seasons`);
      if (revision !== detailRevision || !dialog.open) return;
      const list = array(seasons.seasons);
      if (list.length) main.append(seasonsSection(data, list, section));
    }
    const cast = (data.credits || []).filter((c) => c.credit_type === "cast" || c.character).slice(0, 30);
    if (cast.length)
      main.append(
        section(
          translateUI("Obsazení"),
          el(
            "div",
            { class: "cast" },
            cast.map((c) =>
              el(
                "button",
                { type: "button", class: "cast-person", onClick: () => person(c, actions, data) },
                imageURL(c.profile_path, "w185")
                  ? el("img", { src: imageURL(c.profile_path, "w185"), alt: "", loading: "lazy" })
                  : el("span", { class: "person-placeholder", "aria-hidden": "true" }, (c.name || c.person_name)?.slice(0, 1)),
                el("strong", {}, c.name || c.person_name),
                el("small", {}, c.character || c.job || ""),
              ),
            ),
          ),
        ),
      );
    if (data.collection?.length) {
      const node = rail(
        data.collection_info?.name || translateUI("Filmová kolekce"),
        data.collection.map((c) => title({ ...c, title: c.title || c.original_title })),
        actions.detail,
      );
      sections.push([translateUI("Kolekce"), node]);
      main.append(node);
    }
    let similarData = [];
    try {
      similarData = array(await api(`titles/${data.id}/similar?limit=18`));
    } catch (e) {
      main.append(errorBox(e, () => detail(t, actions)));
    }
    if (revision !== detailRevision || !dialog.open) return;
    const similar = similarData
      .slice(0, 18)
      .filter((x) => Number.isSafeInteger(x.similar_title_id))
      .map((x) => ({ ...x, id: x.similar_title_id, title: x.title, type: x.type, progress: x.watch_progress }));
    if (similar.length) {
      const node = rail(translateUI("Podobné příběhy"), similar, actions.detail);
      sections.push([translateUI("Podobné"), node]);
      main.append(node);
    }
    main.prepend(...[sectionNav(sections)].filter(Boolean));
    showDialog(sheet(heroNode, el("div", { class: "detail-layout" }, main, aside)));
    void titleFacts(data, revision, dialog, { metadata, facts, info, infoRow, aside });
  } catch (e) {
    if (revision === detailRevision && dialog.open)
      showDialog(sheet(el("h2", { id: "dialog-title", class: "detail-loading-title" }, t.title), errorBox(e, () => detail(t, actions))));
  }
}
// Doplňková fakta (věk, tvůrci, kde sledovat) z /titles/:id/facts. Jsou volitelná:
// chyba ani starší API bez endpointu detail nerozbije.
async function titleFacts(data, revision, dialog, { metadata, facts, infoRow, aside }) {
  let result;
  try {
    result = await api(`titles/${data.id}/facts?region=CZ`);
  } catch {
    return;
  }
  if (revision !== detailRevision || !dialog.open || result?.title_id !== data.id) return;
  const rating = result.age_rating;
  if (typeof rating?.rating === "string" && /^[\w .+-]{1,12}$/.test(rating.rating)) {
    const label = /^\d+$/.test(rating.rating) ? `${rating.rating}+` : rating.rating;
    const badge = el("span", { class: "rating-badge flag age-badge", title: translateUI("Věková hranice ({0})", rating.country || "") }, label);
    if (!metadata.isConnected) facts.append(metadata);
    metadata.prepend(badge);
    infoRow(translateUI("Věková hranice"), `${label}${rating.country ? ` (${rating.country})` : ""}`);
  }
  const creators = (Array.isArray(result.creators) ? result.creators : []).map((c) => c?.name).filter((n) => typeof n === "string" && n);
  infoRow(translateUI("Tvůrci"), creators.slice(0, 6).join(", "));
  const groups = { flatrate: translateUI("V předplatném"), free: translateUI("Zdarma"), ads: translateUI("Zdarma s reklamami"), rent: translateUI("Půjčení"), buy: translateUI("Koupě") };
  const providers = (Array.isArray(result.watch_providers) ? result.watch_providers : []).filter((p) => typeof p?.provider_name === "string" && groups[p.type]);
  if (!providers.length) return;
  const safeLink = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  };
  const panel = el("section", { class: "detail-panel watch-providers" }, el("h3", {}, translateUI("Kde sledovat legálně")));
  for (const [type, label] of Object.entries(groups)) {
    const list = providers.filter((p) => p.type === type);
    if (!list.length) continue;
    panel.append(
      el("h4", {}, label),
      el(
        "ul",
        { class: "provider-list" },
        list.map((p) => {
          const logo = imageURL(p.logo_path, "w92");
          const link = safeLink(p.link);
          const body = [logo ? el("img", { src: logo, alt: "", loading: "lazy" }) : el("span", { class: "provider-initial", "aria-hidden": "true" }, p.provider_name.slice(0, 1)), el("span", {}, p.provider_name)];
          return el("li", {}, link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, ...body) : el("span", { class: "provider-item" }, ...body));
        }),
      ),
    );
  }
  panel.append(el("p", { class: "provider-note" }, translateUI("Zdroj: TMDB / JustWatch, region CZ.")));
  aside.prepend(panel);
}
// Hromadné označení odvysílaných epizod řady (core-API /watch-history/season).
function seasonToggle(data, season, refresh) {
  const aired = array(season.episodes).filter((e) => e.episode_number > 0 && !episodeState(e).upcoming);
  if (!aired.length || season.season_number < 1) return null;
  const allWatched = aired.every((e) => episodeState(e).watched);
  const control = button(
    allWatched ? translateUI("Odznačit řadu") : translateUI("Označit řadu jako zhlédnutou"),
    async () => {
      control.disabled = true;
      try {
        await api("watch-history/season", {
          method: "POST",
          body: { title_id: data.id, season_number: season.season_number, watch_status: allWatched ? "plan_to_watch" : "completed" },
        });
        for (const e of aired)
          e.watch_history = allWatched ? null : { ...(e.watch_history || {}), watch_status: "completed" };
        for (const e of aired) e.watch_progress = null;
        document.dispatchEvent(new CustomEvent("movly:personal-changed"));
        toast(allWatched ? translateUI("Řada označena jako nezhlédnutá.") : translateUI("Řada označena jako zhlédnutá."));
        refresh();
      } catch (error) {
        toast(error.status === 404 ? translateUI("Označení celé řady zatím není na serveru dostupné.") : error.message);
        control.disabled = false;
      }
    },
    "secondary small",
    "check",
  );
  control.classList.add("season-toggle");
  return control;
}
// Řady jako přepínač (jedna viditelná řada), epizody jako řádky s náhledem.
function seasonsSection(data, seasons, section) {
  const list = el("ol", { class: "episode-list" });
  const wp = data.watch_progress;
  const current =
    seasons.find((s) => wp?.season_number && s.season_number === wp.season_number) ||
    seasons.find((s) => s.season_number > 0) ||
    seasons[0];
  const pills = seasons.map((season) => {
    const total = season.episodes?.length || season.episode_count || 0;
    const pill = el(
      "button",
      { type: "button", class: "season-pill", onClick: () => select(season, pill) },
      translateUI("{0} · {1} epizod", season.name || translateUI("Řada {0}", season.season_number), total),
    );
    return pill;
  });
  const tools = el("div", { class: "season-tools" });
  function select(season, pill) {
    for (const p of pills) p.setAttribute("aria-pressed", String(p === pill));
    list.replaceChildren(...array(season.episodes).map((episode) => episodeRow(data, season, episode)));
    tools.replaceChildren(...[seasonToggle(data, season, () => select(season, pill))].filter(Boolean));
  }
  select(current, pills[seasons.indexOf(current)]);
  return section(
    translateUI("Řady a epizody"),
    el("div", { class: "season-pills", role: "group", "aria-label": translateUI("Řady") }, pills),
    tools,
    list,
  );
}
function episodeRow(data, season, episode) {
  const state = episodeState(episode);
  const target = { ...episode, season_number: season.season_number };
  const play = button(translateUI("Přehrát"), () => sources(data, target), "small");
  window.attachPlayChoice(play, () => sources(data, target, { skipResume: true, autoPlay: false }), translateUI("Vybrat jiný zdroj"));
  const party = button(translateUI("Sledovat společně"), () => hostParty(data, target), "small");
  const watched = button(
    state.watched ? translateUI("✓ Viděno · odznačit") : translateUI("Viděno"),
    async () => {
      watched.disabled = true;
      try {
        const confirmed = await toggleEpisodeWatched(api, data, season.season_number, episode);
        episode.watch_history = confirmed;
        episode.watch_progress = null;
        const done = confirmed?.watch_status === "completed";
        watched.textContent = done ? translateUI("✓ Viděno · odznačit") : translateUI("Viděno");
        watched.setAttribute("aria-pressed", String(done));
        row.classList.toggle("watched", done);
        document.dispatchEvent(new CustomEvent("movly:personal-changed"));
        toast(done ? translateUI("Epizoda označena jako zhlédnutá.") : translateUI("Epizoda označena jako nezhlédnutá."));
      } catch (error) {
        toast(error.message);
      } finally {
        watched.disabled = episodeState(episode).upcoming;
      }
    },
    "small",
  );
  watched.setAttribute("aria-pressed", String(state.watched));
  for (const action of [play, party, watched]) action.disabled = state.upcoming;
  const name = `${episode.episode_number}. ${episode.name || translateUI("Epizoda")}`;
  const still = imageURL(episode.still_path);
  const thumb = el(
    "button",
    {
      type: "button",
      class: "episode-thumb",
      "aria-label": translateUI("Přehrát epizodu {0}", name),
      onClick: () => sources(data, target),
    },
    still ? el("img", { class: "episode-still", src: still, alt: "", loading: "lazy", onError: (e) => e.target.remove() }) : null,
    el("span", { class: "episode-number", "aria-hidden": "true" }, String(episode.episode_number)),
    state.upcoming ? null : el("span", { class: "episode-play", "aria-hidden": "true" }, glyph(PLAY, true)),
  );
  const ep = episode.watch_progress;
  const epPct = ep?.progress_percentage ?? ep?.progress_percent;
  if (!state.watched && Number.isFinite(epPct) && epPct > 0 && epPct < 100)
    thumb.append(el("progress", { class: "episode-progress", max: 100, value: Math.round(epPct), "aria-label": translateUI("Rozkoukáno {0} %", Math.round(epPct)) }));
  const epMeta = [
    Number.isFinite(episode.runtime) && episode.runtime > 0 ? `${episode.runtime} min` : null,
    !state.upcoming && episode.air_date ? new Date(episode.air_date).toLocaleDateString("cs-CZ") : null,
    !state.watched && Number.isFinite(epPct) && epPct > 0 && epPct < 100 ? translateUI("Rozkoukáno {0} %", Math.round(epPct)) : null,
  ].filter(Boolean);
  thumb.disabled = state.upcoming;
  const row = el(
    "li",
    { class: `episode-row${state.watched ? " watched" : ""}${state.upcoming ? " upcoming" : ""}` },
    thumb,
    el(
      "div",
      { class: "episode-copy" },
      el("strong", {}, name),
      epMeta.length ? el("span", { class: "episode-meta" }, epMeta.join(" · ")) : null,
      episode.overview ? el("p", {}, episode.overview) : null,
      state.upcoming
        ? el("p", { class: "meta" }, translateUI("Premiéra: {0}", episode.air_date.slice(0, 10)))
        : !episode.air_date
          ? el("p", { class: "meta" }, translateUI("Datum premiéry zatím neznáme"))
          : null,
    ),
    el("div", { class: "episode-actions" }, play, party, watched),
  );
  return row;
}
export async function save(t, refresh) {
  const revision = ++detailRevision;
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body lib-dialog" },
      el("h2", { id: "dialog-title" }, translateUI("Uložit do seznamu")),
      loading(),
    ),
  );
  try {
    const lists = array(await api("watchlists"));
    const memberships = await Promise.all(
      lists.map(async (list) => {
        const items = array(await api(`watchlists/${list.id}`));
        return items.find((item) => item.title_id === t.id)?.id || null;
      }),
    );
    if (!dialog.open || revision !== detailRevision) return;
    const status = el("p", { class: "form-status", role: "alert" });
    const content = el(
      "div",
      { class: "dialog-body lib-dialog" },
      el("h2", { id: "dialog-title" }, translateUI("Uložit do seznamu")),
      el("p", { class: "lib-muted" }, t.title),
      status,
    );
    const choices = el("div", { class: "choice-list lib-choices" });
    for (const [index, list] of lists.entries()) {
      let itemID = memberships[index];
      const choice = button(
        list.name,
        async () => {
          choice.disabled = true;
          status.textContent = "";
          try {
            if (itemID) {
              await api(`watchlists/${list.id}/items/${itemID}`, {
                method: "DELETE",
              });
              itemID = null;
            } else {
              await api(`watchlists/${list.id}/items`, {
                method: "POST",
                body: { title_id: t.id },
              });
              const items = array(await api(`watchlists/${list.id}`));
              itemID = items.find((i) => i.title_id === t.id)?.id;
              if (!itemID)
                throw new Error(
                  translateUI("API nepotvrdilo členství titulu v seznamu."),
                );
            }
            choice.setAttribute("aria-pressed", String(Boolean(itemID)));
            choice.replaceChildren(icon(itemID ? "check" : "plus"), list.name);
            toast(
              itemID
                ? translateUI("Uloženo do „{0}“.", list.name)
                : translateUI("Odebráno z „{0}“.", list.name),
            );
          } catch (e) {
            status.textContent = e.message;
          } finally {
            choice.disabled = false;
          }
        },
        "secondary",
        itemID ? "check" : "plus",
      );
      choice.setAttribute("aria-pressed", String(Boolean(itemID)));
      choices.append(choice);
    }
    if (!lists.length)
      content.append(
        el("p", {}, translateUI("Ještě nemáš žádný seznam. Vytvoř si první.")),
      );
    content.append(
      choices,
      el(
        "div",
        { class: "actions" },
        button(
          translateUI("Vytvořit seznam a přidat"),
          () =>
            editList(null, async (list) => {
              try {
                await api(`watchlists/${list.id}/items`, {
                  method: "POST",
                  body: { title_id: t.id },
                });
                await save(t, refresh);
              } catch (e) {
                toast(e.message);
              }
            }),
          "secondary",
          "plus",
        ),
      ),
    );
    showDialog(content);
  } catch (e) {
    if (dialog.open && revision === detailRevision)
      showDialog(
        el(
          "div",
          { class: "dialog-body lib-dialog" },
          el("h2", { id: "dialog-title" }, translateUI("Uložit do seznamu")),
          errorBox(e, () => save(t, refresh)),
        ),
      );
  }
}
export function editList(list, done) {
  invalidateDetail();
  const name = el("input", {
    name: "name",
    required: true,
    maxlength: 100,
    value: list?.name || "",
    placeholder: translateUI("Například Na víkend"),
    autofocus: true,
  });
  const status = el("p", { class: "form-status", role: "alert" }),
    submit = el(
      "button",
      { type: "submit", class: "button primary" },
      list ? translateUI("Uložit změny") : translateUI("Vytvořit seznam"),
    );
  const form = el(
    "form",
    {
      class: "dialog-form",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = "";
        try {
          const created = await api(
            list ? `watchlists/${list.id}` : "watchlists",
            {
              method: list ? "PUT" : "POST",
              body: { name: name.value },
            },
          );
          document.querySelector("#dialog").close();
          toast(
            list
              ? translateUI("Seznam byl přejmenován.")
              : translateUI("Seznam byl vytvořen."),
          );
          done(created);
        } catch (err) {
          status.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    formField(translateUI("Název seznamu"), name),
    status,
    submit,
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body lib-dialog" },
      el(
        "h2",
        { id: "dialog-title" },
        list ? translateUI("Přejmenovat seznam") : translateUI("Nový seznam"),
      ),
      el(
        "p",
        { class: "lib-muted" },
        translateUI(
          "Soukromý seznam dostupný ve tvém profilu na všech zařízeních.",
        ),
      ),
      form,
    ),
  );
}
function confirmDelete(list, done) {
  const status = el("p", { class: "form-status", role: "alert" });
  const accept = button(
    translateUI("Smazat seznam"),
    async () => {
      accept.disabled = true;
      try {
        await api(`watchlists/${list.id}`, { method: "DELETE" });
        document.querySelector("#dialog").close();
        toast(translateUI("Seznam byl smazán."));
        done();
      } catch (e) {
        status.textContent = e.message;
        accept.disabled = false;
      }
    },
    "danger",
  );
  showDialog(
    el(
      "div",
      { class: "dialog-body lib-dialog" },
      el("h2", { id: "dialog-title" }, translateUI("Smazat „{0}“?", list.name)),
      el(
        "p",
        { class: "lib-muted" },
        translateUI(
          "Seznam a jeho položky se odstraní i z ostatních zařízení. Samotné tituly zůstanou v katalogu.",
        ),
      ),
      status,
      el(
        "div",
        { class: "actions" },
        button(translateUI("Ponechat"), () =>
          document.querySelector("#dialog").close(),
        ),
        accept,
      ),
    ),
  );
}
const itemCount = (n) =>
  countLabel(
    n,
    translateUI("položka"),
    translateUI("položky"),
    translateUI("položek"),
  );
const ownerName = (list) => list.owner_display_name || list.owner_username;
// Akce pod plakátem: stav sledování a odebrání (jen u vlastních seznamů).
function itemActions(list, item, t, refresh) {
  const remove = list.shared
    ? null
    : el(
        "button",
        {
          type: "button",
          class: "lib-icon-button",
          "aria-label": translateUI("Odebrat {0}", t.title),
          title: translateUI("Odebrat ze seznamu"),
          onClick: async () => {
            remove.disabled = true;
            try {
              await api(`watchlists/${list.id}/items/${item.id}`, {
                method: "DELETE",
              });
              toast(translateUI("Titul odebrán ze seznamu."));
              refresh();
            } catch (e) {
              toast(e.message);
              remove.disabled = false;
            }
          },
        },
        icon("close"),
      );
  return el(
    "div",
    { class: "lib-card-actions" },
    el(
      "button",
      {
        type: "button",
        class: "lib-mini-button",
        onClick: () => titleActivity(t, "watched"),
      },
      translateUI("Stav sledování"),
    ),
    remove,
  );
}
function posterGrid(list, items, actions) {
  return el(
    "div",
    { class: "lib-poster-grid" },
    items.map((item) => {
      const t = listTitle(item);
      return poster(t, actions.detail, itemActions(list, item, t, actions.refresh));
    }),
  );
}
export async function library(params, signal, actions) {
  if (params.has("provider")) return externalListDetail(params, signal, actions);
  const [own, shared] = await Promise.all([
    api("watchlists/overview?preview_limit=12", { signal }),
    api("watchlists/shared", { signal }),
  ]);
  const lists = [
    ...array(own.watchlists),
    ...array(shared).map((l) => ({ ...l, id: l.watchlist_id, shared: true })),
  ];
  const id = params.get("id");
  if (id) {
    const list = lists.find((l) => String(l.id) === id);
    if (!list)
      throw new Error(
        translateUI("Seznam neexistuje nebo k němu nemáš přístup."),
      );
    const items = array(
      await api(
        list.shared ? `watchlists/shared/${list.id}` : `watchlists/${list.id}`,
        { signal },
      ),
    );
    // Po smazání nebo opuštění seznam už neexistuje — zpět na přehled.
    const back = () => {
      location.hash = "#lists";
    };
    return el(
      "div",
      { class: "page library-page" },
      el(
        "a",
        { href: "#lists", class: "text-link lib-back" },
        translateUI("Všechny seznamy"),
      ),
      el(
        "div",
        { class: "lib-head" },
        el(
          "div",
          { class: "lib-title-block" },
          el("h1", {}, list.name),
          el(
            "p",
            { class: "lib-muted" },
            [
              itemCount(items.length),
              list.shared ? translateUI("Sdílí {0}", ownerName(list)) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
        el("span", { class: "lib-spacer" }),
        el(
          "div",
          { class: "lib-actions" },
          list.shared
            ? button(translateUI("Opustit"), () => leaveList(list, back), "danger")
            : button(translateUI("Sdílet"), () => shareList(list), "secondary"),
          !list.shared && !list.is_default
            ? button(translateUI("Přejmenovat"), () =>
                editList(list, actions.refresh),
              )
            : null,
          !list.shared && !list.is_default
            ? button(translateUI("Smazat"), () => confirmDelete(list, back), "danger")
            : null,
        ),
      ),
      items.length
        ? posterGrid(list, items, actions)
        : empty(
            translateUI("Tady začíná tvůj další večer"),
            translateUI(
              "Otevři detail filmu nebo seriálu a přidej ho do tohoto seznamu.",
            ),
          ),
    );
  }
  const [entries, external, recent] = await Promise.all([
    Promise.all(
      lists.map(async (list) => {
        let items = [],
          failure;
        try {
          items = list.shared
            ? array(await api(`watchlists/shared/${list.id}`, { signal }))
            : array(list.preview);
        } catch (e) {
          if (signal.aborted) throw e;
          failure = e;
        }
        return { list, items, failure };
      }),
    ),
    externalListCards(signal, actions),
    recentHistory(signal, actions),
  ]);
  const featured =
    entries.find((e) => !e.list.shared && e.list.is_default) ||
    entries.find((e) => !e.list.shared) ||
    entries[0];
  const cards = entries.map(({ list, items, failure }) =>
    listCard({
      href: `#lists?id=${list.id}`,
      name: list.name,
      meta: failure
        ? translateUI("Náhled se nepodařilo načíst.")
        : itemCount(Number.isFinite(list.item_count) ? list.item_count : items.length),
      tag: list.shared
        ? translateUI("Sdílí {0}", ownerName(list))
        : list.is_default
          ? translateUI("Výchozí seznam")
          : translateUI("Můj seznam"),
      tone: list.shared ? "shared" : "",
      posters: items.slice(0, 3).map((item) => item.poster_path),
      featured: entries.length > 1 && featured?.list === list,
    }),
  );
  let main = null;
  if (featured) {
    const { list, items, failure } = featured;
    const total = Number.isFinite(list.item_count) ? list.item_count : items.length;
    main = el(
      "section",
      { class: "lib-featured", "aria-labelledby": "lib-featured-title" },
      el(
        "div",
        { class: "lib-section-head" },
        el(
          "h2",
          { id: "lib-featured-title" },
          `${list.name} · ${total.toLocaleString("cs-CZ")}`,
        ),
        el(
          "div",
          { class: "lib-actions" },
          !list.shared
            ? button(translateUI("Sdílet"), () => shareList(list), "secondary small")
            : null,
          el(
            "a",
            { class: "button secondary small", href: `#lists?id=${list.id}` },
            translateUI("Zobrazit vše"),
          ),
        ),
      ),
      failure
        ? errorBox(failure, actions.refresh)
        : items.length
          ? posterGrid(list, items.slice(0, 12), actions)
          : el(
              "p",
              { class: "lib-muted" },
              translateUI(
                "Zatím prázdný seznam. Přidej film nebo seriál z jeho detailu.",
              ),
            ),
    );
  }
  return el(
    "div",
    { class: "page library-page" },
    ...libraryHead(
      "lists",
      button(
        translateUI("Nový seznam"),
        () => editList(null, actions.refresh),
        "primary",
        "plus",
      ),
    ),
    cards.length || external.cards.length
      ? el("div", { class: "lib-list-grid" }, cards, external.cards)
      : null,
    lists.length
      ? null
      : empty(
          translateUI("Tvůj první seznam čeká"),
          translateUI(
            "Ulož si filmy na víkend, oblíbené seriály nebo tipy od přátel.",
          ),
        ),
    external.notices,
    main || recent
      ? el(
          "div",
          { class: "lib-split" },
          main,
          recent ? el("aside", { class: "lib-aside" }, recent) : null,
        )
      : null,
  );
}

async function shareList(list) {
  const dialog = showDialog(
    el(
      "div",
      { class: "dialog-body lib-dialog" },
      el("h2", { id: "dialog-title" }, translateUI("Sdílení · {0}", list.name)),
      loading(),
    ),
  );
  try {
    const shares = array(await api(`watchlists/${list.id}/shares`));
    const link = await api(`watchlists/${list.id}/public-link`);
    const status = el("p", { class: "form-status", role: "alert" });
    const username = el("input", {
      required: true,
      maxlength: 100,
      placeholder: translateUI("Uživatelské jméno"),
      "aria-label": translateUI("Uživatel Movly"),
    });
    const submit = el(
      "button",
      { type: "submit", class: "button accent" },
      translateUI("Sdílet s uživatelem"),
    );
    const form = el(
      "form",
      {
        class: "lib-inline-form",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api(`watchlists/${list.id}/shares`, {
              method: "POST",
              body: { username: username.value },
            });
            await shareList(list);
          } catch (e) {
            status.textContent = e.message;
            submit.disabled = false;
          }
        },
      },
      username,
      submit,
    );
    const publicControls = el(
      "div",
      { class: "lib-public-link" },
      el("h3", {}, translateUI("Veřejný odkaz")),
      el(
        "p",
        { class: "lib-muted" },
        link.active
          ? translateUI(
              "Odkaz je aktivní. Kdokoli s odkazem může seznam zobrazit.",
            )
          : translateUI(
              "Vytvořením odkazu zpřístupníš seznam každému, kdo odkaz získá.",
            ),
      ),
    );
    const linkActions = el("div", { class: "lib-actions" });
    publicControls.append(linkActions);
    linkActions.append(
      button(
        link.active
          ? translateUI("Vytvořit nový odkaz")
          : translateUI("Vytvořit veřejný odkaz"),
        async (e) => {
          e.currentTarget.disabled = true;
          try {
            const result = await api(`watchlists/${list.id}/public-link`, {
              method: "POST",
              body: {},
            });
            if (!result.url)
              throw new Error(translateUI("Server nevrátil veřejný odkaz."));
            const field = el("input", {
              readonly: true,
              value: result.url,
              "aria-label": translateUI("Veřejný odkaz"),
              onFocus: (e) => e.target.select(),
            });
            publicControls.append(
              el(
                "div",
                { class: "lib-link-row" },
                field,
                button(
                  translateUI("Kopírovat odkaz"),
                  async () => {
                    try {
                      await navigator.clipboard.writeText(result.url);
                      toast(translateUI("Odkaz zkopírován."));
                    } catch {
                      field.focus();
                    }
                  },
                  "secondary small",
                ),
              ),
            );
          } catch (err) {
            status.textContent = err.message;
            e.currentTarget.disabled = false;
          }
        },
        "secondary small",
      ),
    );
    if (link.active)
      linkActions.append(
        button(
          translateUI("Zrušit veřejný odkaz"),
          async () => {
            try {
              await api(`watchlists/${list.id}/public-link`, {
                method: "DELETE",
              });
              await shareList(list);
            } catch (e) {
              status.textContent = e.message;
            }
          },
          "danger small",
        ),
      );
    showDialog(
      el(
        "div",
        { class: "dialog-body lib-dialog lib-share" },
        el(
          "h2",
          { id: "dialog-title" },
          translateUI("Sdílení · {0}", list.name),
        ),
        el(
          "p",
          { class: "lib-muted" },
          translateUI(
            "Sdílený seznam se objeví v aplikacích vybraného uživatele.",
          ),
        ),
        form,
        status,
        shares.length
          ? el(
              "ul",
              { class: "lib-members" },
              shares.map((user) =>
                el(
                  "li",
                  { class: "lib-member" },
                  initialAvatar(user.display_name || user.username),
                  el("span", { class: "lib-member-name" }, user.display_name || user.username),
                  button(
                    translateUI("Odebrat přístup"),
                    async (e) => {
                      e.currentTarget.disabled = true;
                      try {
                        await api(`watchlists/${list.id}/shares/${user.user_id}`, {
                          method: "DELETE",
                        });
                        await shareList(list);
                      } catch (err) {
                        status.textContent = err.message;
                        e.currentTarget.disabled = false;
                      }
                    },
                    "small danger",
                  ),
                ),
              ),
            )
          : null,
        publicControls,
      ),
    );
  } catch (e) {
    if (dialog.open)
      showDialog(
        el(
          "div",
          { class: "dialog-body lib-dialog" },
          el("h2", { id: "dialog-title" }, translateUI("Sdílení seznamu")),
          errorBox(e, () => shareList(list)),
        ),
      );
  }
}

function leaveList(list, done) {
  const status = el("p", { role: "alert", class: "form-status" });
  showDialog(
    el(
      "div",
      { class: "dialog-body lib-dialog" },
      el(
        "h2",
        { id: "dialog-title" },
        translateUI("Opustit „{0}“?", list.name),
      ),
      el(
        "p",
        { class: "lib-muted" },
        translateUI(
          "Seznam zmizí z tvého účtu. Vlastníkovi zůstane zachovaný.",
        ),
      ),
      status,
      el(
        "div",
        { class: "actions" },
        button(translateUI("Ponechat"), () =>
          document.querySelector("#dialog").close(),
        ),
        button(
          translateUI("Opustit seznam"),
          async (e) => {
            e.currentTarget.disabled = true;
            try {
              await api(`watchlists/${list.id}/leave`, { method: "DELETE" });
              document.querySelector("#dialog").close();
              done();
            } catch (err) {
              status.textContent = err.message;
              e.currentTarget.disabled = false;
            }
          },
          "danger",
        ),
      ),
    ),
  );
}

async function person(credit, actions, from) {
  const back = from
    ? el(
        "button",
        { type: "button", class: "text-link detail-back", onClick: () => void detail(from, actions) },
        glyph("m15 18-6-6 6-6"),
        translateUI("Zpět na {0}", from.title),
      )
    : null;
  if (!Number.isSafeInteger(credit.person_id)) {
    showDialog(
      el(
        "div",
        { class: "dialog-body" },
        el("h2", { id: "dialog-title" }, credit.name),
        el("p", {}, translateUI("Profil osoby zatím není dostupný.")),
      ),
    );
    return;
  }
  const personSheet = (...children) => el("div", { class: "dialog-body detail-sheet person-sheet" }, back, ...children);
  const dialog = showDialog(personSheet(el("h2", { id: "dialog-title", class: "detail-loading-title" }, credit.name), loading()));
  try {
    const [data, filmography] = await Promise.all([
      api(`people/${credit.person_id}`),
      api(`people/${credit.person_id}/filmography`),
    ]);
    if (!dialog.open) return;
    const items = array(filmography).map((i) => {
      const t = applyUserState(title({ ...i, id: i.title_id, title: i.title || i.original_title }));
      return { ...t, role: i.character || i.job || "" };
    });
    const name = data.name || credit.name;
    const portrait = imageURL(data.profile_path);
    const facts = el("dl", { class: "detail-info" });
    const fact = (label, value) => value && facts.append(el("dt", {}, label), el("dd", {}, value));
    const day = (v) => {
      const d = /^\d{4}-\d{2}-\d{2}/.test(v || "") ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(document.documentElement.lang || "cs", { timeZone: "UTC" }) : null;
    };
    fact(translateUI("Narození"), day(data.birthday));
    fact(translateUI("Úmrtí"), day(data.deathday));
    fact(translateUI("Místo narození"), data.place_of_birth);
    fact(translateUI("Titulů"), items.length ? String(items.length) : null);
    const grid = el("div", { class: "catalog-grid person-known" });
    const knownHeading = el("h4", { class: "person-known-title" }, translateUI("Známý z"));
    const rows = el("ol", { class: "person-credits" });
    const render = (type) => {
      const shown = items.filter((i) => !type || i.type === type);
      // Při delší filmografii mřížka ukazuje nejlépe hodnocené, úplný seznam je pod ní.
      const long = shown.length > 6;
      knownHeading.hidden = rows.hidden = !long;
      grid.replaceChildren(
        ...(long ? [...shown].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)).slice(0, 6) : shown).map((i) => poster(i, actions.detail, i.role ? el("span", { class: "person-role" }, i.role) : null)),
      );
      rows.replaceChildren(
        ...[...shown]
          .sort((a, b) => String(b.release_date || b.year || "").localeCompare(String(a.release_date || a.year || "")))
          .map((i) =>
            el(
              "li",
              {},
              el("span", { class: "person-credit-year" }, i.year || "—"),
              el(
                "button",
                { type: "button", class: "person-credit-title", onClick: () => actions.detail(i) },
                el("strong", {}, i.title),
                i.role ? el("span", {}, i.role) : null,
              ),
              el("span", { class: "muted" }, i.type === "tv" ? translateUI("Seriál") : translateUI("Film")),
              el(
                "span",
                { class: "person-credit-state" },
                isWatched(i) ? translateUI("Zhlédnuto") : progressPercent(i) > 0 ? translateUI("Rozkoukáno") : "",
              ),
            ),
          ),
      );
    };
    const types = new Set(items.map((i) => i.type));
    const filter =
      types.has("movie") && types.has("tv")
        ? el(
            "div",
            { class: "segmented", role: "group", "aria-label": translateUI("Typ") },
            [
              ["", translateUI("Vše")],
              ["movie", translateUI("Filmy")],
              ["tv", translateUI("Seriály")],
            ].map(([type, label]) => {
              const b = el("button", {
                type: "button",
                "aria-pressed": String(!type),
                onClick: () => {
                  for (const other of b.parentNode.children) other.setAttribute("aria-pressed", String(other === b));
                  render(type);
                },
              }, label);
              return b;
            }),
          )
        : null;
    render("");
    showDialog(
      personSheet(
        el(
          "div",
          { class: "person-layout" },
          el(
            "aside",
            { class: "person-aside" },
            portrait
              ? el("img", { class: "person-portrait", src: portrait, alt: "", onError: (e) => e.target.remove() })
              : el("span", { class: "person-portrait person-placeholder", "aria-hidden": "true" }, name.slice(0, 1)),
            el(
              "div",
              {},
              el("h2", { id: "dialog-title" }, name),
              data.known_for_department ? el("p", { class: "muted" }, data.known_for_department) : null,
            ),
            facts.childNodes.length ? facts : null,
            el("p", { class: "person-bio" }, data.biography || translateUI("Biografie zatím není dostupná.")),
          ),
          el(
            "section",
            { class: "person-filmography", "aria-labelledby": "person-filmography-title" },
            el(
              "div",
              { class: "section-heading" },
              el("h3", { id: "person-filmography-title" }, translateUI("Filmografie")),
              filter,
            ),
            items.length ? [knownHeading, grid, rows] : el("p", { class: "muted" }, translateUI("Filmografie zatím není dostupná.")),
          ),
        ),
      ),
    );
  } catch (e) {
    if (dialog.open)
      showDialog(personSheet(el("h2", { id: "dialog-title", class: "detail-loading-title" }, credit.name), errorBox(e, () => person(credit, actions, from))));
  }
}
