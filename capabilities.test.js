'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('capability probes coalesce, cache by context, and cap server TTL at five minutes', async () => {
  const { supportsCatalogBatch, resetCapabilityCacheForTests, setCapabilityClockForTests } = await import('./app/capabilities.js');
  resetCapabilityCacheForTests();
  let monotonic = 100;
  setCapabilityClockForTests(() => monotonic);
  let calls = 0, release;
  const request = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = supportsCatalogBatch(request, undefined, 'account:1', undefined, () => true);
  const second = supportsCatalogBatch(request, undefined, 'account:1', undefined, () => true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release({ schema_version: 1, revision: `cap1.${'a'.repeat(64)}`, cache_ttl_seconds: 900,
    server_capabilities: [{ id: 'catalog_batch', versions: [1], enabled: true }],
    negotiated: [{ id: 'catalog_batch', version: 1 }] });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  monotonic += 299999;
  assert.equal(await supportsCatalogBatch(() => { calls++; }, undefined, 'account:1', undefined, () => true), true);
  assert.equal(calls, 1);
  monotonic++;
  await supportsCatalogBatch(() => { calls++; return { schema_version: 1, revision: `cap1.${'b'.repeat(64)}`, cache_ttl_seconds: 30,
    server_capabilities: [], negotiated: [] }; }, undefined, 'account:2', undefined, () => true);
  assert.equal(calls, 2);
  monotonic += 29999;
  assert.equal(await supportsCatalogBatch(() => { calls++; }, undefined, 'account:2', undefined, () => true), false);
  assert.equal(calls, 2);
  monotonic++;
  assert.equal(await supportsCatalogBatch(() => { calls++; return { schema_version: 1, revision: `cap1.${'e'.repeat(64)}`, cache_ttl_seconds: 30,
    server_capabilities: [], negotiated: [] }; }, undefined, 'account:2', undefined, () => true), false);
  assert.equal(calls, 3);
  resetCapabilityCacheForTests();
});

test('malformed or failed capability negotiation is cached as unsupported', async () => {
  const { supportsCatalogBatch, resetCapabilityCacheForTests } = await import('./app/capabilities.js');
  resetCapabilityCacheForTests();
  let calls = 0;
  const request = async () => { calls++; throw Object.assign(new Error('old server'), { status: 404 }); };
  assert.equal(await supportsCatalogBatch(request, undefined, 'old-server', undefined, () => true), false);
  assert.equal(await supportsCatalogBatch(request, undefined, 'old-server', undefined, () => true), false);
  assert.equal(calls, 1);
  resetCapabilityCacheForTests();
  const malformed = async () => ({ schema_version: 1, revision: 'bad', cache_ttl_seconds: 300,
    server_capabilities: [{ id: 'catalog_batch', versions: [1], enabled: true }], negotiated: [{ id: 'catalog_batch', version: 1 }] });
  assert.equal(await supportsCatalogBatch(malformed, undefined, 'malformed', undefined, () => true), false);
});

test('aborting one coalesced caller does not cancel another current owner probe', async () => {
  const { supportsCatalogBatch, resetCapabilityCacheForTests } = await import('./app/capabilities.js');
  resetCapabilityCacheForTests();
  let release;
  const request = () => new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const canceled = supportsCatalogBatch(request, controller.signal, 'same-context', undefined, () => true);
  const active = supportsCatalogBatch(request, undefined, 'same-context', undefined, () => true);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  release({ schema_version: 1, revision: `cap1.${'d'.repeat(64)}`, cache_ttl_seconds: 30,
    server_capabilities: [{ id: 'catalog_batch', versions: [1], enabled: true }], negotiated: [{ id: 'catalog_batch', version: 1 }] });
  assert.equal(await active, true);
  resetCapabilityCacheForTests();
});

test('origin and owner context partition cache, stale replies cannot publish, and LRU stays bounded', async () => {
  const { supportsCatalogBatch, resetCapabilityCacheForTests, setCapabilityClockForTests } = await import('./app/capabilities.js');
  const { apiContextKey, invalidateApiContext } = await import('./app/api.js');
  resetCapabilityCacheForTests();
  let monotonic = 0, calls = 0;
  setCapabilityClockForTests(() => monotonic);
  const response = () => ({ schema_version: 1, revision: `cap1.${'f'.repeat(64)}`, cache_ttl_seconds: 300,
    server_capabilities: [{ id: 'catalog_batch', versions: [1], enabled: true }], negotiated: [{ id: 'catalog_batch', version: 1 }] });
  const cachedRequest = async () => { calls++; return response(); };
  await supportsCatalogBatch(cachedRequest, undefined, 'user-A', 'https://a.test', () => true);
  await supportsCatalogBatch(cachedRequest, undefined, 'user-A', 'https://b.test', () => true);
  await supportsCatalogBatch(cachedRequest, undefined, 'user-B', 'https://a.test', () => true);
  assert.equal(calls, 3);

  const context = apiContextKey();
  let release;
  const stale = supportsCatalogBatch(() => new Promise(resolve => { release = resolve; }), undefined, context, 'https://stale.test');
  await new Promise(resolve => setImmediate(resolve));
  invalidateApiContext({ accountId: 922, profile: { id: 1 } });
  release(response());
  await assert.rejects(stale, { name: 'AbortError' });

  for (let index = 0; index < 17; index++)
    await supportsCatalogBatch(cachedRequest, undefined, `lru-${index}`, 'https://lru.test', () => true);
  const before = calls;
  await supportsCatalogBatch(cachedRequest, undefined, 'lru-0', 'https://lru.test', () => true);
  assert.equal(calls, before + 1);
  resetCapabilityCacheForTests();
});
