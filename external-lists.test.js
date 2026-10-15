'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('./app/external-lists.js');

function item(kind, tmdb_id, name = `Remote ${tmdb_id}`) { return { kind, tmdb_id, name, id: `list-${tmdb_id}` }; }
function found(index, identity, id = index + 1, name = `Title ${identity.tmdb_id}`) {
  const type = identity.kind || identity.type;
  return { index, type, tmdb_id: identity.tmdb_id, status: 'found',
    title: { id, title: name, original_title: name, type, tmdb_id: identity.tmdb_id } };
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
  }, new AbortController().signal, 'trakt', 'en', async () => true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'titles/batch');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {items:[{type:'movie',tmdb_id:7},{type:'tv',tmdb_id:7},{type:'movie',tmdb_id:7}],language:'en'});
  assert.deepEqual(cards.map(card => card.id), [10, 11, 12]);
});

test('unsupported batch negotiation resolves legacy TMDB details in original order', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('tv', 12), item('movie', 13), item('tv', 12)];
  const calls = [];
  const request = async path => {
    calls.push(path);
    const id = Number(path.match(/^tmdb\/(\d+)/)?.[1]);
    const source = items.find(value => value.tmdb_id === id);
    return { id: id + 100, title: `Title ${id}`, original_title: `Original ${id}`, type: source.kind, tmdb_id: id };
  };
  const cards = await resolveExternalPage(items, request, new AbortController().signal, 'trakt', 'en', async () => false);
  assert.deepEqual(cards.map(value => value.tmdb_id), [12, 13, 12]);
  assert.deepEqual(cards.map(value => value.type), ['tv', 'movie', 'tv']);
  assert.deepEqual(calls, ['tmdb/12?type=tv', 'tmdb/13?type=movie', 'tmdb/12?type=tv']);
});

test('legacy requests share a global four-request limit across resolver calls', async () => {
  const { resolveExternalPage } = await modulePromise;
  const request = async path => {
    if (!path.startsWith('tmdb/')) throw new Error('unexpected batch request');
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const id = Number(path.match(/^tmdb\/(\d+)/)?.[1]);
    return { id: id + 100, title: `Title ${id}`, original_title: `Original ${id}`, type: 'movie', tmdb_id: id };
  };
  let active = 0, peak = 0;
  const run = (start) => resolveExternalPage(Array.from({length:12}, (_, index) => item('movie', start + index)), request,
    new AbortController().signal, 'simkl', 'cs', async () => false);
  const pages = await Promise.all([run(1), run(21), run(41)]);
  assert.equal(peak, 4);
  assert.ok(pages.flat().every(card => !card.unresolved));
});

test('only batch 404 or 501 triggers legacy fallback', async () => {
  const { resolveExternalPage } = await modulePromise;
  const source = [item('movie', 18)];
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const cards = await resolveExternalPage(source, async path => {
      calls++;
      if (path === 'titles/batch') throw Object.assign(new Error('denied'), { status });
      throw new Error('fallback must not run');
    }, new AbortController().signal, 'trakt', 'cs', async () => true);
    assert.equal(calls, 1);
    assert.equal(cards[0].unresolved, true);
  }
});

test('a later batch 404 invalidates negotiated support and retries the probe next time', async () => {
  const { resolveExternalPage } = await modulePromise;
  const { resetCapabilityCacheForTests } = await import('./app/capabilities.js');
  resetCapabilityCacheForTests();
  const source = [item('movie', 19)];
  let probes = 0;
  const request = async path => {
    if (path === 'capabilities/negotiate') {
      probes++;
      return { schema_version: 1, revision: `cap1.${'c'.repeat(64)}`, cache_ttl_seconds: 300,
        server_capabilities: [{ id: 'catalog_batch', versions: [1], enabled: true }], negotiated: [{ id: 'catalog_batch', version: 1 }] };
    }
    if (path === 'titles/batch') throw Object.assign(new Error('batch route absent'), { status: 404 });
    return { id: 119, title: 'Title 19', original_title: 'Original 19', type: 'movie', tmdb_id: 19 };
  };
  for (let index = 0; index < 2; index++) {
    const cards = await resolveExternalPage(source, request, new AbortController().signal, 'trakt', 'cs');
    assert.equal(cards[0].unresolved, undefined);
  }
  assert.equal(probes, 2);
  resetCapabilityCacheForTests();
});

test('invalid or missing IDs stay in place and are omitted from the batch request', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 9), item('tv', 2147483647), item('movie', 2147483648),
    item('movie', Number.MAX_SAFE_INTEGER), item('movie', 0), {kind:'tv',name:'No ID'}, item('person', 10)];
  let body;
  const cards = await resolveExternalPage(items, async (path, options) => {
    body = options.body;
    return {results:[found(0, items[0], 91), found(1, items[1], 92)]};
  }, new AbortController().signal, 'simkl', 'cs', async () => true);
  assert.deepEqual(body.items, [{type:'movie',tmdb_id:9},{type:'tv',tmdb_id:2147483647}]);
  assert.deepEqual(cards.map(card => card.unresolved === true), [false, false, true, true, true, true, true]);
  assert.match(cards[5].title, /No ID/);
});

test('an empty page is valid and makes no request', async () => {
  const { resolveExternalPage } = await modulePromise;
  let calls = 0;
  assert.deepEqual(await resolveExternalPage([], async () => { calls++; }, new AbortController().signal, 'trakt', 'cs', async () => true), []);
  assert.equal(calls, 0);
});

test('unavailable entries become placeholders while found entries remain usable', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 3), item('tv', 4)];
  const cards = await resolveExternalPage(items, async () => ({results:[
    found(0, items[0], 30), {index:1,type:'tv',tmdb_id:4,status:'unavailable'},
  ]}), new AbortController().signal, 'trakt', 'cs', async () => true);
  assert.equal(cards[0].id, 30);
  assert.equal(cards[1].unresolved, true);
});

test('failed and malformed batch responses fail closed to ordered placeholders', async () => {
  const { resolveExternalPage } = await modulePromise;
  const items = [item('movie', 8), item('tv', 8)];
  const signal = new AbortController().signal;
  const failed = await resolveExternalPage(items, async () => { throw new Error('503'); }, signal, 'simkl', 'en', async () => true);
  const malformed = await resolveExternalPage(items, async () => ({results:[found(1, items[0])]}), signal, 'simkl', 'en', async () => true);
  const invalidTitle = await resolveExternalPage(items, async () => ({results:[
    {index:0,type:'movie',tmdb_id:8,status:'found',title:{tmdb_id:8,type:'movie',title:'Missing internal ID'}},
    found(1, items[1]),
  ]}), signal, 'simkl', 'en', async () => true);
  assert.deepEqual(failed.map(card => card.unresolved), [true, true]);
  assert.deepEqual(malformed.map(card => card.unresolved), [true, true]);
  assert.deepEqual(invalidTitle.map(card => card.unresolved), [true, true]);
  assert.match(failed[0].id, /movie:8/);
  assert.match(failed[1].id, /tv:8/);
});

test('nested title identity must match the echoed batch identity', async () => {
  const { resolveExternalPage } = await modulePromise;
  const source = [item('movie', 8)];
  const wrongType = found(0, source[0]); wrongType.title.type = 'tv';
  const wrongTmdb = found(0, source[0]); wrongTmdb.title.tmdb_id = 9;
  const missingCoreIdentity = found(0, source[0]); delete missingCoreIdentity.title.original_title;
  for (const entry of [wrongType, wrongTmdb, missingCoreIdentity]) {
    const cards = await resolveExternalPage(source, async () => ({results:[entry]}), new AbortController().signal, 'simkl', 'en', async () => true);
    assert.deepEqual(cards.map(card => card.unresolved), [true]);
  }
});

test('a 20-item page and its next page each make exactly one batch request', async () => {
  const { resolveExternalPage } = await modulePromise;
  const all = Array.from({length:21}, (_, i) => item(i % 2 ? 'tv' : 'movie', i + 1));
  let calls = 0;
  const request = async (path, options) => {
    calls++;
    return {results: options.body.items.map((identity, index) => found(index, identity, calls * 100 + index))};
  };
  const first = await resolveExternalPage(all.slice(0, 20), request, new AbortController().signal, 'trakt', 'cs', async () => true);
  assert.equal(calls, 1);
  assert.equal(first.length, 20);
  assert.ok(first.every(card => !card.unresolved));
  assert.deepEqual(first.map(card => card.id), Array.from({length:20}, (_,i)=>100+i));
  assert.deepEqual(first.map(card => card.type), all.slice(0,20).map(value=>value.kind));
  const second = await resolveExternalPage(all.slice(20), request, new AbortController().signal, 'trakt', 'cs', async () => true);
  assert.equal(calls, 2);
  assert.equal(second.length, 1);
  assert.equal(second[0].unresolved, undefined);
  assert.equal(second[0].id, 200);
  assert.equal(second[0].type, all[20].kind);
});

test('abort and owner-context changes prevent stale batch results from rendering', async () => {
  const { resolveExternalPage } = await modulePromise;
  const controller = new AbortController();
  let release;
  const pending = resolveExternalPage([item('movie', 1)], () => new Promise(resolve => { release = resolve; }), controller.signal, 'trakt', 'cs', async () => true);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  release({results:[found(0, item('movie', 1))]});
  await assert.rejects(pending, {name:'AbortError'});

  const { invalidateApiContext } = await import('./app/api.js');
  let releaseOwner;
  const ownerPending = resolveExternalPage([item('movie', 2)], () => new Promise(resolve => { releaseOwner = resolve; }), new AbortController().signal, 'trakt', 'cs', async () => true);
  await new Promise(resolve => setImmediate(resolve));
  invalidateApiContext({accountId:99,profile:{id:1}});
  releaseOwner({results:[found(0, item('movie', 2))]});
  await assert.rejects(ownerPending, {name:'AbortError'});
});

test('one preview queue bounds 1,000 list requests and keeps working after an individual failure', async () => {
  const { runPreviewQueue } = await modulePromise;
  const jobs = Array.from({length:1000}, (_, index) => ({provider:index % 2 ? 'simkl' : 'trakt', index}));
  const controller = new AbortController();
  let active = 0, peak = 0, completed = 0, failed = 0;
  await runPreviewQueue(jobs, async job => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    if (job.index === 17) { failed++; throw new Error('one preview failed'); }
    completed++;
  }, controller.signal, () => true);
  assert.equal(peak, 4);
  assert.equal(completed, 999);
  assert.equal(failed, 1);
  assert.equal(jobs.length, 0);
});

test('aborted and stale-owner preview queues do not start queued requests', async () => {
  const { runPreviewQueue } = await modulePromise;
  const jobs = Array.from({length:1000}, (_, index) => index);
  const controller = new AbortController();
  let started = 0;
  const aborted = runPreviewQueue(jobs, () => new Promise(resolve => {
    started++;
    controller.signal.addEventListener('abort', resolve, {once:true});
  }), controller.signal, () => true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 4);
  controller.abort();
  await aborted;
  assert.equal(started, 4);
  assert.equal(jobs.length, 0);

  let current = true, ownerStarted = 0;
  const releases = [];
  const ownerJobs = Array.from({length:1000}, (_, index) => index);
  const ownerQueue = runPreviewQueue(ownerJobs, () => new Promise(resolve => {
    ownerStarted++;
    releases.push(resolve);
  }), new AbortController().signal, () => current);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ownerStarted, 4);
  current = false;
  releases.forEach(release => release());
  await ownerQueue;
  assert.equal(ownerStarted, 4);
  assert.equal(ownerJobs.length, 0);
});

test('a context change while the second provider loads rejects the whole overview', async () => {
  const { loadExternalOverview } = await modulePromise;
  const { apiContextKey, invalidateApiContext } = await import('./app/api.js');
  const context = apiContextKey();
  const signal = new AbortController().signal;
  let releaseSimkl, traktResolved = false;
  const pending = loadExternalOverview(path => {
    if (path === 'integrations/trakt/lists') {
      traktResolved = true;
      return Promise.resolve({provider:'trakt',status:'ready',lists:[{id:'old-account',items:[]}]});
    }
    return new Promise(resolve => { releaseSimkl = resolve; });
  }, signal, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(traktResolved, true);
  invalidateApiContext({accountId:100,profile:{id:1}});
  releaseSimkl({provider:'simkl',status:'ready',lists:[]});
  await assert.rejects(pending, {name:'AbortError'});
});
