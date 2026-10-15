import { api, apiContextKey, title } from './api.js';
import { translateUI, uiLanguage } from './i18n.js';
import { el, poster, button, toast, countLabel } from './ui.js';
import { listCard, libraryThumb } from './personal.js';

export function localizedExternalTitle(raw, item, language = uiLanguage()) {
  const mapped = title(raw);
  if (Number.isSafeInteger(item?.tmdb_id) && item.tmdb_id > 0 &&
      (mapped.tmdb_id !== item.tmdb_id || mapped.type !== item.kind || typeof mapped.original_title !== 'string'))
    throw new Error('Catalog batch title identity does not match request');
  const name = mapped.all_titles?.[language]?.trim() || mapped.title?.trim() || item.name;
  return { ...mapped, title: name };
}
function validIdentity(item) {
  return Number.isSafeInteger(item?.tmdb_id) && item.tmdb_id > 0 && item.tmdb_id <= 2147483647 && ['movie', 'tv'].includes(item.kind);
}
function assertCurrent(signal, context) {
  if (signal?.aborted || apiContextKey() !== context) throw new DOMException('Context changed', 'AbortError');
}
export async function resolveExternalPage(items, request, signal, provider, language = uiLanguage()) {
  const context = apiContextKey();
  const cards = new Array(items.length);
  const valid = [];
  items.forEach((item, pageIndex) => {
    if (validIdentity(item)) valid.push({ item, pageIndex });
    else cards[pageIndex] = placeholder(item, provider);
  });
  if (!valid.length) { assertCurrent(signal, context); return cards; }

  try {
    const response = await request('titles/batch', {
      method: 'POST',
      body: { items: valid.map(({ item }) => ({ type: item.kind, tmdb_id: item.tmdb_id })), language },
    });
    assertCurrent(signal, context);
    if (!Array.isArray(response?.results) || response.results.length !== valid.length)
      throw new Error('Invalid catalog batch response');
    const resolved = response.results.map((entry, index) => {
      const { item } = valid[index];
      if (!entry || entry.index !== index || entry.type !== item.kind || entry.tmdb_id !== item.tmdb_id)
        throw new Error('Catalog batch response does not match request');
      if (entry.status === 'unavailable') return placeholder(item, provider);
      if (entry.status === 'found') return localizedExternalTitle(entry.title, item, language);
      throw new Error('Invalid catalog batch status');
    });
    assertCurrent(signal, context);
    valid.forEach(({ pageIndex }, index) => { cards[pageIndex] = resolved[index]; });
    return cards;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || apiContextKey() !== context) throw error;
    return items.map(item => placeholder(item, provider));
  }
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
  const value = item || {};
  return { id: `external:${provider}:${value.kind}:${value.tmdb_id}:${value.id}`, title: value.name || translateUI('Nerozpoznaný titul'),
    year: value.year, type: value.kind, unresolved: true };
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
  const request = (path, options = {}) => api(path, { ...options, signal, expectedOwner: owner });
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
      resolveExternalPage(list.items.slice(0, 3), request, signal, result.provider, uiLanguage()).then(found => {
        const art = found.map(t => t?.poster_path).filter(Boolean);
        if (signal.aborted || !art.length) return;
        card.querySelector('.lib-stack').replaceChildren(...[0, 1, 2].map(i => libraryThumb(art[i], 'lib-stack-art')));
      }).catch(() => {});
    }
  }
  return { cards, notices: messages };
}
export async function externalListDetail(params, signal, actions) {
  const provider = params.get('provider');
  if (!['trakt', 'simkl'].includes(provider)) throw new Error(translateUI('Neplatná služba.'));
  const owner = actions.owner;
  const context = apiContextKey();
  const request = (path, options = {}) => api(path, { ...options, signal, expectedOwner: owner });
  const result = await fetchLists(provider, request, signal);
  assertCurrent(signal, context);
  const list = result.lists.find(value => value.id === params.get('external'));
  const root = el('div', { class: 'page library-page' }, el('a', { href: '#lists', class: 'text-link lib-back' }, translateUI('Všechny seznamy')), ...notices(result));
  if (!list) { root.append(el('p', {}, translateUI('Seznam se nepodařilo načíst.'))); return root; }
  const grid = el('div', { class: 'lib-poster-grid' });
  const warning = el('p', { class: 'error-copy' });
  let offset = 0, busy = false;
  const more = button(translateUI('Načíst další'), loadPage);
  async function loadPage() {
    if (busy || signal.aborted || apiContextKey() !== context || offset >= list.items.length) return;
    busy = true; more.disabled = true;
    const batch = list.items.slice(offset, offset + 20);
    const cards = await resolveExternalPage(batch, request, signal, provider, uiLanguage()).catch(error => {
      if (error?.name === 'AbortError' || signal.aborted) return null;
      return batch.map(item => placeholder(item, provider));
    });
    if (!cards) return;
    if (signal.aborted || apiContextKey() !== context) return;
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
