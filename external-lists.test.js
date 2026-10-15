'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('./app/external-lists.js');

function item(kind, tmdb_id, name = `Remote ${tmdb_id}`) { return { kind, tmdb_id, name, id: `list-${tmdb_id}` }; }
function found(index, identity, id = index + 1, name = `Title ${identity.tmdb_id}`) {
  return { index, type: identity.kind, tmdb_id: identity.tmdb_id, status: 'found',
    title: { id, title: name, type: identity.kind, tmdb_id: identity.tmdb_id } };
}

test('external title uses the selected catalog language with the server title as fallback', async () => {
  const { localizedExternalTitle } = await modulePromise;
  const raw = {id:42,title:'The Big Bang Theory',all_titles:{cs:'Teorie velkého třesku',en:'The Big Bang Theory'},type:'tv'};
  assert.equal(localizedExternalTitle(raw, {name:'Remote'}, 'cs').title, 'Teorie velkého třesku');
  assert.equal(localizedExternalTitle(raw, {name:'Remote'}, 'en').title, 'The Big Bang Theory');
  assert.equal(localizedExternalTitle({id:42,title:'Available title',all_titles:{en:' '}}, {name:'Remote'}, 'en').title, 'Available title');
});

test('one batch preserves mixed types, duplicate TMDB identities, and duplicate entries in order', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 7), item('tv', 7), item('movie', 7)];
  const calls = [];
  const cards = await resolveExternalPage(items, async (path, options) => {
    calls.push({path, ...options});
    return {results: [found(0, items[0], 10), found(1, items[1], 11), found(2, items[2], 12)]};
  }, new AbortController().signal, 'trakt', 'en');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'titles/batch');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {items:[{type:'movie',tmdb_id:7},{type:'tv',tmdb_id:7},{type:'movie',tmdb_id:7}],language:'en'});
  assert.deepEqual(cards.map(card => card.id), [10, 11, 12]);
});

test('invalid or missing IDs stay in place and are omitted from the batch request', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 9), item('movie', 0), {kind:'tv',name:'No ID'}, item('person', 10)];
  let body;
  const cards = await resolveExternalPage(items, async (path, options) => {
    body = options.body;
    return {results:[found(0, items[0], 91)]};
  }, new AbortController().signal, 'simkl', 'cs');
  assert.deepEqual(body.items, [{type:'movie',tmdb_id:9}]);
  assert.deepEqual(cards.map(card => card.unresolved === true), [false, true, true, true]);
  assert.match(cards[2].title, /No ID/);
});

test('an empty page is valid and makes no request', async () => {
  const { resolveExternalPage } = await modulePromise;
  let calls = 0;
  assert.deepEqual(await resolveExternalPage([], async () => { calls++; }, new AbortController().signal, 'trakt', 'cs'), []);
  assert.equal(calls, 0);
});

test('unavailable entries become placeholders while found entries remain usable', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 3), item('tv', 4)];
  const cards = await resolveExternalPage(items, async () => ({results:[
    found(0, items[0], 30), {index:1,type:'tv',tmdb_id:4,status:'unavailable'},
  ]}), new AbortController().signal, 'trakt', 'cs');
  assert.equal(cards[0].id, 30);
  assert.equal(cards[1].unresolved, true);
});

test('failed and malformed batch responses fail closed to ordered placeholders', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 8), item('tv', 8)];
  const signal = new AbortController().signal;
  const failed = await resolveExternalPage(items, async () => { throw new Error('503'); }, signal, 'simkl', 'en');
  const malformed = await resolveExternalPage(items, async () => ({results:[found(1, items[0])]}), signal, 'simkl', 'en');
  const invalidTitle = await resolveExternalPage(items, async () => ({results:[
    {index:0,type:'movie',tmdb_id:8,status:'found',title:{tmdb_id:8,type:'movie',title:'Missing internal ID'}},
    found(1, items[1]),
  ]}), signal, 'simkl', 'en');
  assert.deepEqual(failed.map(card => card.unresolved), [true, true]);
  assert.deepEqual(malformed.map(card => card.unresolved), [true, true]);
  assert.deepEqual(invalidTitle.map(card => card.unresolved), [true, true]);
  assert.match(failed[0].id, /movie:8/);
  assert.match(failed[1].id, /tv:8/);
});

test('a 20-item page and its next page each make exactly one batch request', async () => {
  const { resolveExternalPage } = await modulePromise;
  const all = Array.from({length:21}, (_, i) => item(i % 2 ? 'tv' : 'movie', i + 1));
  let calls = 0;
  const request = async (path, options) => {
    calls++;
    return {results: options.body.items.map((identity, index) => found(index, identity, calls * 100 + index))};
  };
  await resolveExternalPage(all.slice(0, 20), request, new AbortController().signal, 'trakt', 'cs');
  assert.equal(calls, 1);
  await resolveExternalPage(all.slice(20), request, new AbortController().signal, 'trakt', 'cs');
  assert.equal(calls, 2);
});

test('abort and owner-context changes prevent stale batch results from rendering', async () => {
  const { resolveExternalPage } = await modulePromise;
  const controller = new AbortController();
  let release;
  const pending = resolveExternalPage([item('movie', 1)], () => new Promise(resolve => { release = resolve; }), controller.signal, 'trakt', 'cs');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  release({results:[found(0, item('movie', 1))]});
  await assert.rejects(pending, {name:'AbortError'});

  const { invalidateApiContext } = await import('./app/api.js');
  let releaseOwner;
  const ownerPending = resolveExternalPage([item('movie', 2)], () => new Promise(resolve => { releaseOwner = resolve; }), new AbortController().signal, 'trakt', 'cs');
  await new Promise(resolve => setImmediate(resolve));
  invalidateApiContext({accountId:99,profile:{id:1}});
  releaseOwner({results:[found(0, item('movie', 2))]});
  await assert.rejects(ownerPending, {name:'AbortError'});
});
