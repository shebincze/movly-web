import { api } from './api.js';
import { el, button, showDialog, toast } from './ui.js';
let state = null, host = false, ready = false, offset = 0, bestRTT = Infinity;
let events = null;
let generation = 0, timer = null, opening = false, presented = null;
const key = 'movly.party.device';
let deviceId = sessionStorage.getItem(key);
if (!deviceId) { deviceId = crypto.randomUUID(); sessionStorage.setItem(key, deviceId); }
export const partyState = () => state;
export const partyWaiting = () => Boolean(state?.preparation?.started_at && (!state.preparation.released_at || Date.now() + offset < Date.parse(state.preparation.released_at)));
export function partyPosition() {
  if (!state) return 0;
  return state.position_sec + (state.status === 'playing' ? Math.max(0, (Date.now() + offset - Date.parse(state.position_updated_at)) / 1000) * state.rate : 0);
}
export function reportPartyReady(value) { ready = value; }
function apply(fresh, expected) {
  if (expected !== generation || (state && fresh.party_id !== state.party_id) || (state && fresh.version < state.version)) return false;
  state = fresh;
  return true;
}
async function preparation(action, value = ready) {
  const expected = generation, id = state.party_id, sent = Date.now();
  const fresh = await api(`party/${id}/preparation`, { method: 'POST', body: { device_id: deviceId, action, is_host: host, ready: value } });
  const received = Date.now(), rtt = received - sent;
  if (expected !== generation || state?.party_id !== id) return;
  if (rtt <= bestRTT + 20) { bestRTT = Math.min(bestRTT, rtt); offset = Date.parse(fresh.server_time) - (sent + received) / 2; }
  apply(fresh, expected);
}
async function openSources() {
  if (!state?.preparation?.started_at || presented === state.party_id || opening) return;
  opening = true;
  const expected = generation, id = state.party_id;
  try {
    const title = await api(`titles/${state.title_id}`);
    let episode;
    if (state.episode_id) {
      const seasons = title.seasons || await api(`titles/${title.id}/seasons`);
      for (const season of seasons) {
        const match = season.episodes?.find(e => e.id === state.episode_id);
        if (match) episode = { ...match, season_number: season.season_number };
      }
      if (!episode) throw new Error('Epizoda společného sledování není dostupná.');
    }
    if (expected !== generation || state?.party_id !== id) return;
    presented = id;
    const { sources } = await import('./player.js');
    await sources(title, episode);
  } finally { opening = false; }
}
async function activate(fresh, isHost) {
  await leaveParty();
  generation++; state = fresh; host = isHost; ready = false; presented = null; bestRTT = Infinity;
  await preparation('register', false);
  const eventGeneration = generation;
  events = new EventSource(`/api/app/party/${state.party_id}/events`);
  events.addEventListener('party', event => {
    try { if (apply(JSON.parse(event.data), eventGeneration)) openSources().catch(e => toast(e.message)); }
    catch (e) { toast(e.message); }
  });
  let lastReady = null, lastHeartbeat = 0, busy = false;
  const expected = generation;
  timer = setInterval(async () => {
    if (busy || expected !== generation || !state) return;
    busy = true;
    try {
      if (lastReady !== ready || Date.now() - lastHeartbeat >= 5000) {
        const value = ready; await preparation('ready', value); lastReady = value; lastHeartbeat = Date.now();
      } else if (events?.readyState !== EventSource.OPEN) {
        const fresh = await api(`party/${state.party_id}`); apply(fresh, expected);
      }
      await openSources();
    } catch (error) {
      if (expected === generation) { toast(error.message); if ([404,410].includes(error.status)) await leaveParty(); }
    } finally { busy = false; }
  }, 500);
}
export async function leaveParty() {
  const previous = state, wasHost = host;
  generation++; events?.close(); events = null; clearInterval(timer); timer = null; state = null; ready = false;
  if (previous) await api(`party/${previous.party_id}/${wasHost ? 'leave' : 'preparation'}`, {
    method: 'POST', body: wasHost ? {} : { device_id: deviceId, action: 'leave', is_host: false, ready: false },
  });
}
export async function hostParty(title, episode) {
  try {
    await leaveParty();
    const fresh = await api('party', { method: 'POST', body: { title_id: title.id, ...(episode ? { episode_id: episode.id } : {}) } });
    await activate(fresh, true);
    showDialog(el('div', { class: 'dialog-body' }, el('h2', { id: 'dialog-title' }, 'Sledovat společně'),
      el('p', {}, `Kód party: ${state.code}`), el('p', {}, 'Po výběru zdroje počkáme na všechny přehrávače.'),
      button('Spustit pro všechny', async () => { try { await preparation('start', false); await openSources(); } catch (e) { toast(e.message); } }, 'primary'),
      button('Zrušit party', async () => { await leaveParty(); document.querySelector('#dialog').close(); })));
  } catch (e) { toast(e.message); }
}
export function partyJoinForm() {
  const code = el('input', { placeholder: 'Kód party', maxlength: 6, 'aria-label': 'Kód party' });
  return el('div', { class: 'actions' }, code, button('Připojit k party', async () => {
    try { await leaveParty(); await activate(await api('party/join', { method: 'POST', body: { code: code.value.trim().toUpperCase() } }), false); toast('Připojeno. Čekám na hostitele.'); }
    catch (e) { toast(e.message); }
  }), button('Opustit party', async () => { try { await leaveParty(); toast('Party opuštěna.'); } catch (e) { toast(e.message); } }));
}
export async function partyTransport(playing, position) {
  if (!state || partyWaiting()) return;
  const expected = generation;
  apply(await api(`party/${state.party_id}/state`, { method: 'PUT', body: { status: playing ? 'playing' : 'paused', position_sec: Math.max(0, position) } }), expected);
}
