import { api, title } from './api.js';
import { translateUI } from './i18n.js';
import { el, poster, button, toast, countLabel } from './ui.js';
import { listCard, libraryThumb } from './personal.js';

export function localizedExternalTitle(raw, item) {
  const mapped = title(raw);
  const name = mapped.all_titles?.cs?.trim() || mapped.title?.trim() || item.name;
  return { ...mapped, title: name };
}
export function createExternalCardResolver(request, signal) {
  let active = 0;
  const queue = [], cache = new Map();
  function drain() {
    while (active < 4 && queue.length) {
      const task = queue.shift();
      if (signal.aborted) { task.reject(new DOMException('Aborted', 'AbortError')); continue; }
      active++;
      Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { active--; drain(); });
    }
  }
  return (item) => {
    if (!Number.isSafeInteger(item.tmdb_id) || item.tmdb_id <= 0 || !['movie', 'tv'].includes(item.kind))
      return Promise.reject(new Error(translateUI('Titul nemá rozpoznané katalogové ID.')));
    const key = `${item.kind}:${item.tmdb_id}`;
    if (!cache.has(key)) cache.set(key, new Promise((resolve, reject) => {
      queue.push({ resolve, reject, work: async () => localizedExternalTitle(await request(`tmdb/${item.tmdb_id}?type=${item.kind}`), item) });
      drain();
    }));
    return cache.get(key);
  };
}
function listName(provider, list) {
  if (provider === 'trakt' && list.id === 'watchlist') return translateUI('Ke zhlédnutí');
  if (provider === 'simkl') {
    const names = { plan_to_watch: 'Ke zhlédnutí', watching: 'Rozkoukané', hold: 'Pozastavené', dropped: 'Odložené', completed: 'Zhlédnuté' };
    if (names[list.id]) return translateUI(names[list.id]);
  }
  return list.name;
}
function placeholder(item, provider) {
  return { id: `external:${provider}:${item.kind}:${item.tmdb_id}:${item.id}`, title: item.name,
    year: item.year, type: item.kind, unresolved: true };
}
function source(provider) { return provider === 'trakt' ? 'Trakt.tv' : 'Simkl'; }
function meta(provider, count) {
  return `${source(provider)} · ${countLabel(count, translateUI('položka'), translateUI('položky'), translateUI('položek'))} · ${translateUI('Pouze ke čtení')}`;
}
function statusMessage(result) {
  if (result.status === 'rate_limited') {
    const retry = result.retry_at && new Date(result.retry_at);
    return retry && Number.isFinite(retry.getTime())
      ? translateUI('Limit služby je vyčerpaný. Další načtení po {0} (místní čas).', retry.toLocaleString(document.documentElement.lang || 'cs'))
      : translateUI('Limit služby je vyčerpaný.');
  }
  return { busy: translateUI('Seznamy se právě načítají.'), unavailable: translateUI('Seznamy se nepodařilo načíst.'),
    reconnect_required: translateUI('Službu je potřeba znovu připojit.') }[result.status];
}
async function fetchLists(provider, request, signal) {
  try {
    const result = await request(`integrations/${provider}/lists`);
    if (!Array.isArray(result.lists)) throw new Error('Invalid list response');
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    return { provider, status: 'unavailable', lists: [] };
  }
}
function notices(result) {
  return [statusMessage(result) ? el('p', { class: 'error-copy' }, statusMessage(result)) : null,
    result.notice === 'premium_only' ? el('p', { class: 'list-meta' }, translateUI('Vlastní seznamy Simkl vyžadují PRO nebo VIP.')) : null].filter(Boolean);
}
function openCard(actions, card) {
  if (card.unresolved) toast(translateUI('Titul nemá rozpoznané katalogové ID.'));
  else actions.detail(card);
}
// Externí seznamy jako karty v mřížce knihovny; plakáty se doplní po vyřešení ID.
export async function externalListCards(signal, actions) {
  const owner = actions.owner;
  const request = (path) => api(path, { signal, expectedOwner: owner });
  const resolve = createExternalCardResolver(request, signal);
  const results = await Promise.all(['trakt', 'simkl'].map(provider => fetchLists(provider, request, signal)));
  const cards = [], messages = [];
  for (const result of results) {
    if (['disconnected', 'unconfigured'].includes(result.status)) continue;
    const notes = notices(result);
    if (notes.length) messages.push(el('div', { class: 'lib-notice' }, el('strong', {}, source(result.provider)), ...notes));
    for (const list of result.lists) {
      const card = listCard({ href: `#lists?provider=${result.provider}&external=${encodeURIComponent(list.id)}`,
        name: `${source(result.provider)} · ${listName(result.provider, list)}`,
        meta: countLabel(list.items.length, translateUI('položka'), translateUI('položky'), translateUI('položek')),
        tag: translateUI('Externí seznam'), tone: 'external' });
      cards.push(card);
      Promise.all(list.items.slice(0, 3).map(item => resolve(item).catch(() => null))).then(found => {
        const art = found.map(t => t?.poster_path).filter(Boolean);
        if (signal.aborted || !art.length) return;
        card.querySelector('.lib-stack').replaceChildren(...[0, 1, 2].map(i => libraryThumb(art[i], 'lib-stack-art')));
      });
    }
  }
  return { cards, notices: messages };
}
export async function externalListDetail(params, signal, actions) {
  const provider = params.get('provider');
  if (!['trakt', 'simkl'].includes(provider)) throw new Error(translateUI('Neplatná služba.'));
  const owner = actions.owner;
  const request = path => api(path, { signal, expectedOwner: owner });
  const result = await fetchLists(provider, request, signal);
  const list = result.lists.find(value => value.id === params.get('external'));
  const root = el('div', { class: 'page library-page' }, el('a', { href: '#lists', class: 'text-link lib-back' }, translateUI('Všechny seznamy')), ...notices(result));
  if (!list) { root.append(el('p', {}, translateUI('Seznam se nepodařilo načíst.'))); return root; }
  const grid = el('div', { class: 'lib-poster-grid' });
  const warning = el('p', { class: 'error-copy' });
  const resolve = createExternalCardResolver(request, signal);
  let offset = 0, busy = false;
  const more = button(translateUI('Načíst další'), loadPage);
  async function loadPage() {
    if (busy || signal.aborted || offset >= list.items.length) return;
    busy = true; more.disabled = true;
    const batch = list.items.slice(offset, offset + 20);
    const cards = await Promise.all(batch.map(async item => {
      try { return await resolve(item); }
      catch { return placeholder(item, provider); }
    }));
    if (signal.aborted) return;
    grid.append(...cards.map(card => poster(card, value => openCard(actions, value))));
    offset += batch.length; busy = false; more.disabled = false;
    more.hidden = offset >= list.items.length;
    if (cards.some(card => card.unresolved)) warning.textContent = translateUI('Některé tituly se nepodařilo načíst. Položky zůstávají v seznamu.');
  }
  root.append(el('div', { class: 'lib-head' }, el('div', { class: 'lib-title-block' }, el('h1', {}, listName(provider, list)),
    el('p', { class: 'lib-muted' }, meta(provider, list.items.length))), el('span', { class: 'lib-tag external' }, translateUI('Externí seznam'))),
    list.description ? el('p', { class: 'lib-intro' }, list.description) : null, warning, grid, el('div', { class: 'lib-pager' }, more));
  if (!list.items.length) more.hidden = true;
  await loadPage();
  return root;
}
