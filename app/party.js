import { translateUI } from "./i18n.js";
import { waitingForParty, effectivePartyPosition } from "./party-clock.js";
import { api, apiContextKey, imageURL } from "./api.js";
import { el, button, showDialog, toast } from "./ui.js";
let state = null,
  host = false,
  ready = null,
  offset = 0,
  bestRTT = Infinity;
let events = null;
let generation = 0,
  timer = null,
  opening = false,
  presented = null;
let playback = null, playbackSequence = 0, protocol = null;
const key = "movly.party.device";
let deviceId = sessionStorage.getItem(key);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  sessionStorage.setItem(key, deviceId);
}
function contextKey() { return JSON.stringify([location.origin, apiContextKey()]); }
function protocolError() { return new Error(translateUI("Server vrátil neplatný protokol přípravných kol party.")); }
function discardParty() {
  generation++;
  events?.close(); events = null;
  clearInterval(timer); timer = null;
  state = null; ready = null; protocol = null;
  if (playback) playback.stopped = true;
  playback = null;
}
function activeContext() {
  if (protocol && protocol.context !== contextKey()) { discardParty(); return false; }
  return true;
}
function assertContext(mode) {
  if (!mode || mode.context !== contextKey()) {
    if (protocol === mode) discardParty();
    throw new DOMException("Party context changed", "AbortError");
  }
}
async function negotiateParty() {
  const context = contextKey();
  try {
    const capabilities = await api("party/v2/capabilities");
    if (context !== contextKey()) throw new DOMException("Party context changed", "AbortError");
    if (!capabilities || capabilities.preparation_rounds !== true) throw protocolError();
    return Object.freeze({ context, prefix: "party/v2", modern: true });
  } catch (error) {
    if (context !== contextKey()) throw new DOMException("Party context changed", "AbortError");
    if (error.status !== 404) throw error;
    return Object.freeze({ context, prefix: "party", modern: false });
  }
}
async function partyAPI(mode, suffix, options) {
  assertContext(mode);
  const result = await api(mode.prefix + (suffix ? `/${suffix}` : ""), options);
  assertContext(mode);
  return result;
}
function validateState(value, mode = protocol) {
  if (mode?.modern && value?.preparation != null && (!Number.isSafeInteger(value.preparation.round) || value.preparation.round < 0)) throw protocolError();
}
export const partyState = () => activeContext() ? state : null;
export const partyIsHost = () => activeContext() && state !== null && host;
export const partyWaiting = () => waitingForParty(partyState(), Date.now(), offset);
export const partyPosition = () =>
  effectivePartyPosition(partyState(), Date.now(), offset);
function episodeID(value) { return value ?? null; }
function roundOf(value) { return protocol?.modern ? value?.preparation?.round : 0; }
function mediaKey(value) {
  return JSON.stringify([value?.party_id, value?.title_id, episodeID(value?.episode_id)]);
}
export function partyPlaybackMatches(attempt) {
  return Boolean(activeContext() && attempt && attempt === playback && !attempt.stopped
    && attempt.generation === generation && mediaKey(attempt) === mediaKey(state));
}
// Each sample belongs to one actual player attempt. A new round needs a new
// sample from that player; changing the round never relabels a cached boolean.
export function beginPartyPlayback(titleID, episode = null) {
  if (playback) playback.stopped = true;
  playback = { generation, party_id: state?.party_id, title_id: titleID,
    episode_id: episodeID(episode), sequence: ++playbackSequence, stopped: false };
  ready = null;
  reportPartyReady(false, playback);
  return playback;
}
export function reportPartyReady(value, attempt) {
  if (!partyPlaybackMatches(attempt) || typeof value !== "boolean") return false;
  const round = roundOf(state);
  if (!Number.isSafeInteger(round) || round < 0) return false;
  ready = { attempt, round, value };
  return true;
}
export function endPartyPlayback(attempt) {
  if (!attempt || attempt !== playback) return;
  reportPartyReady(false, attempt);
  attempt.stopped = true;
}
function currentReadiness(sample) {
  return Boolean(activeContext() && sample && sample.attempt === playback && sample.attempt.generation === generation
    && mediaKey(sample.attempt) === mediaKey(state) && sample.round === roundOf(state)
    && (!sample.attempt.stopped || sample.value === false));
}
function readinessKey(sample) {
  return JSON.stringify([sample.round, sample.attempt.sequence, sample.value]);
}
function apply(fresh, expected) {
  if (
    !activeContext() ||
    expected !== generation ||
    (state && fresh.party_id !== state.party_id) ||
    (state && fresh.version < state.version)
  )
    return false;
  validateState(fresh);
  if (mediaKey(fresh) !== mediaKey(state) || roundOf(fresh) !== roundOf(state)) ready = null;
  state = fresh;
  return true;
}
async function preparation(action, sample = null) {
  if (action === "ready" && !currentReadiness(sample)) return false;
  const expected = generation,
    mode = protocol,
    id = state.party_id,
    sent = Date.now();
  let fresh;
  try {
    fresh = await partyAPI(mode, `${id}/preparation`, {
      method: "POST",
      body: { device_id: deviceId, action, is_host: host, ready: sample?.value ?? false,
        ...(action === "ready" && mode.modern ? { expected_round: sample.round } : {}) },
    });
  } catch (error) {
    if (action !== "ready" || error.status !== 409 || error.code !== "party_preparation_round_mismatch") throw error;
    if (expected === generation && state?.party_id === id) {
      if (ready === sample && playback === sample.attempt) ready = null;
      const reconciled = await partyAPI(mode, id);
      // apply invalidates samples only when their media/round changes. A new
      // player decision made while this GET was pending must survive.
      if (expected === generation && state?.party_id === id) {
        apply(reconciled, expected);
      }
    }
    return false;
  }
  const received = Date.now(),
    rtt = received - sent;
  if (expected !== generation || state?.party_id !== id) return false;
  const serverTime = Date.parse(fresh.server_time);
  if (!Number.isFinite(serverTime))
    throw new Error(translateUI("Server vrátil neplatný čas party."));
  if (rtt <= bestRTT + 20) {
    bestRTT = Math.min(bestRTT, rtt);
    offset = serverTime - (sent + received) / 2;
  }
  return apply(fresh, expected);
}
async function openSources() {
  if (
    !activeContext() ||
    !state?.preparation?.started_at ||
    presented === mediaKey(state) ||
    opening
  )
    return;
  opening = true;
  const expected = generation,
    id = state.party_id,
    media = mediaKey(state),
    titleID = state.title_id,
    episode = state.episode_id;
  try {
    const title = await api(`titles/${titleID}`);
    let selectedEpisode;
    if (episode) {
      const seasons =
        title.seasons || (await api(`titles/${title.id}/seasons`));
      for (const season of seasons) {
        const match = season.episodes?.find((e) => e.id === episode);
        if (match) selectedEpisode = { ...match, season_number: season.season_number };
      }
      if (!selectedEpisode)
        throw new Error(
          translateUI("Epizoda společného sledování není dostupná."),
        );
    }
    if (!activeContext() || expected !== generation || state?.party_id !== id || mediaKey(state) !== media) return;
    const { sources } = await import("./player.js");
    if (!activeContext() || expected !== generation || mediaKey(state) !== media) return;
    presented = media;
    await sources(title, selectedEpisode);
  } finally {
    opening = false;
  }
}
async function activate(fresh, isHost, mode = null) {
  if (!mode) mode = await negotiateParty();
  await leaveParty();
  assertContext(mode);
  validateState(fresh, mode);
  generation++;
  protocol = mode;
  state = fresh;
  host = isHost;
  ready = null;
  presented = null;
  bestRTT = Infinity;
  await preparation("register");
  const eventGeneration = generation;
  assertContext(mode);
  events = new EventSource(`/api/app/${mode.prefix}/${state.party_id}/events`);
  events.addEventListener("party", (event) => {
    try {
      if (apply(JSON.parse(event.data), eventGeneration))
        openSources().catch((e) => toast(e.message));
    } catch (e) {
      toast(e.message);
    }
  });
  let lastReady = null,
    lastHeartbeat = 0,
    busy = false;
  const expected = generation;
  timer = setInterval(async () => {
    if (busy || !activeContext() || expected !== generation || !state) return;
    busy = true;
    try {
      const sample = ready,
        valid = currentReadiness(sample);
      if (valid && (lastReady !== readinessKey(sample) || Date.now() - lastHeartbeat >= 5000)) {
        const accepted = await preparation("ready", sample);
        if (accepted && currentReadiness(sample)) lastReady = readinessKey(sample);
        lastHeartbeat = Date.now();
      } else if (!valid && Date.now() - lastHeartbeat >= 5000) {
        await preparation("register");
        lastHeartbeat = Date.now();
      }
      if (expected === generation && state && events?.readyState !== EventSource.OPEN) {
        const fresh = await partyAPI(mode, state.party_id);
        apply(fresh, expected);
      }
      await openSources();
    } catch (error) {
      if (expected === generation) {
        toast(error.message);
        if ([404, 410].includes(error.status)) await leaveParty();
      }
    } finally {
      busy = false;
    }
  }, 500);
}
export async function leaveParty() {
  const previous = state,
    wasHost = host,
    mode = protocol;
  discardParty();
  if (previous && mode?.context === contextKey())
    await partyAPI(
      mode, `${previous.party_id}/${wasHost ? "leave" : "preparation"}`,
      {
        method: "POST",
        body: wasHost
          ? {}
          : {
              device_id: deviceId,
              action: "leave",
              is_host: false,
              ready: false,
            },
      },
    );
}
async function enterParty(action, body) {
  const mode = await negotiateParty();
  await leaveParty();
  const fresh = await partyAPI(mode, action, { method: "POST", body });
  await activate(fresh, action !== "join", mode);
}
export async function hostParty(title, episode) {
  try {
    await enterParty("", {
      title_id: title.id,
      ...(episode ? { episode_id: episode.id } : {}),
    });
    const partyId = state.party_id;
    const members = el("ul", { class: "pk-party-members" });
    const count = el("h3", {}, translateUI("Účastníci"));
    // Živý seznam účastníků z party stavu (members + připravenost zařízení).
    const renderMembers = () => {
      const list = state?.members || [];
      count.textContent = `${translateUI("Účastníci")} · ${list.length}`;
      const devices = state?.preparation?.devices || [];
      const started = Boolean(state?.preparation?.started_at);
      members.replaceChildren(
        ...list.map((member) => {
          const own = devices.filter((d) => d.user_id === member.user_id);
          const ready = own.some((d) => d.ready);
          const label = [
            member.is_host ? translateUI("Zakladatel") : null,
            started ? (ready ? translateUI("Připraven") : own.length ? translateUI("Načítá video…") : translateUI("Čeká na připojení")) : null,
          ].filter(Boolean).join(" · ");
          return el(
            "li",
            { class: `pk-party-member${member.is_host ? " is-host" : ""}${started && ready ? " is-ready" : ""}` },
            el("span", { class: "pk-party-avatar", "aria-hidden": "true" }, String(member.username || "?").slice(0, 1).toUpperCase()),
            el("span", { class: "pk-party-member-text" }, el("strong", {}, member.username || translateUI("Účastník")), label ? el("span", {}, label) : null),
          );
        }),
      );
    };
    renderMembers();
    const refresh = setInterval(() => {
      if (!members.isConnected || state?.party_id !== partyId) return clearInterval(refresh);
      renderMembers();
    }, 1000);
    const art = imageURL(title.backdrop_path || title.poster_path, "w300");
    showDialog(
      el(
        "div",
        { class: "dialog-body pk-party" },
        el(
          "div",
          { class: "pk-party-hero" },
          art ? el("img", { class: "pk-party-art", src: art, alt: "", referrerpolicy: "no-referrer" }) : null,
          el(
            "div",
            { class: "pk-party-heading" },
            el("span", { class: "pk-eyebrow" }, translateUI("Watch Party · zakladatel")),
            el("h2", { id: "dialog-title" }, translateUI("Sledovat společně")),
            el(
              "p",
              { class: "pk-party-title" },
              [title.title, episode?.season_number ? `S${episode.season_number} E${episode.episode_number}` : null].filter(Boolean).join(" · "),
            ),
            el("p", {}, translateUI("Po výběru zdroje počkáme na všechny přehrávače.")),
          ),
          el(
            "div",
            { class: "pk-party-code" },
            el("span", {}, translateUI("Kód pro připojení")),
            el("strong", {}, state.code),
            button(translateUI("Kopírovat kód"), async () => {
              try {
                await navigator.clipboard.writeText(state?.code || "");
                toast(translateUI("Kód zkopírován."));
              } catch {
                toast(translateUI("Kód party: {0}", state?.code || ""));
              }
            }, "small"),
          ),
        ),
        el("div", { class: "pk-party-body" }, count, members),
        el(
          "div",
          { class: "pk-party-actions" },
          button(translateUI("Zrušit party"), async () => {
            await leaveParty();
            document.querySelector("#dialog").close();
          }),
          button(
            translateUI("Spustit pro všechny"),
            async () => {
              try {
                await preparation("start");
                await openSources();
              } catch (e) {
                toast(e.message);
              }
            },
            "primary",
          ),
        ),
      ),
    );
  } catch (e) {
    toast(e.message);
  }
}
export function partyJoinForm() {
  const code = el("input", {
    placeholder: translateUI("Kód party"),
    maxlength: 6,
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    class: "pk-party-input",
    "aria-label": translateUI("Kód party"),
  });
  const status = el("p", { class: "pk-party-status", role: "status" });
  return el(
    "section",
    { class: "pk-party-join", "aria-labelledby": "pk-party-join-title" },
    el("h2", { id: "pk-party-join-title" }, translateUI("Připojit k party")),
    el("p", { class: "pk-party-hint" }, translateUI("Zadej kód od zakladatele. Přehrávání řídí zakladatel, ty čekáš na spuštění.")),
    el(
      "div",
      { class: "pk-party-join-row" },
      code,
      button(translateUI("Připojit k party"), async () => {
        try {
          await enterParty("join", { code: code.value.trim().toUpperCase() });
          status.textContent = translateUI("Připojeno. Čekám na hostitele.");
          toast(translateUI("Připojeno. Čekám na hostitele."));
        } catch (e) {
          toast(e.message);
        }
      }, "accent"),
    ),
    status,
    button(translateUI("Opustit party"), async () => {
      try {
        await leaveParty();
        status.textContent = "";
        toast(translateUI("Party opuštěna."));
      } catch (e) {
        toast(e.message);
      }
    }, "secondary small"),
  );
}
export async function partyTransport(playing, position) {
  if (!activeContext() || !state || partyWaiting()) return;
  const expected = generation, mode = protocol;
  apply(
    await partyAPI(mode, `${state.party_id}/state`, {
      method: "PUT",
      body: {
        status: playing ? "playing" : "paused",
        position_sec: Math.max(0, position),
      },
    }),
    expected,
  );
}
