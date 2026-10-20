'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { offlineSigner } = require('./offline-grant');

function installIndexedDB() {
  const stores = new Map(['files', 'chunks', 'settings', 'history', 'downloads'].map(name => [name, new Map()]));
  globalThis.indexedDB = { open() {
    const request = {};
    setTimeout(() => {
      request.result = {
        objectStoreNames: { contains: name => stores.has(name) }, close() {},
        transaction(names, mode) {
          const tx = {};
          tx.objectStore = name => ({
            getAll() { const r = {}; setTimeout(() => { r.result = [...stores.get(name).values()]; r.onsuccess?.(); }, 0); return r; },
            get(key) { const r = {}; setTimeout(() => { r.result = stores.get(name).get(key); r.onsuccess?.(); tx.oncomplete?.(); }, 0); return r; },
            put(value, key) { stores.get(name).set(key === undefined ? value.id : key, value); setTimeout(() => tx.oncomplete?.(), 0); return {}; },
            delete(key) { stores.get(name).delete(key); setTimeout(() => tx.oncomplete?.(), 0); return {}; },
          });
          return tx;
        },
      };
      request.onsuccess?.();
    }, 0);
    return request;
  } };
  return stores;
}

test('web offline saving is app-only: no grant request, the active receipt stays untouched', async () => {
  const previous = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent,
    indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  const window = new EventTarget();
  globalThis.window = window;
  globalThis.document = {};
  globalThis.CustomEvent = class extends Event {};
  const stores = installIndexedDB();
  const { invalidateApiContext } = await import('./app/api.js');
  const { put, get, verifiedGrant } = await import('./app/offline-store.js');
  const { hasOfflineDownloads } = await import('./app/offline.js'); // Installs the real movly-offline-revoked listener that clears active.
  const { queueOffline } = await import('./app/offline-downloads.js');
  const now = Date.now(), signer = offlineSigner('offline-download-owner-race-test');
  const user = { id: 1, username: 'test', role: 'user', is_active: true, is_verified: true,
    premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: 'Adult', is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const oldReceipt = signer.issue(user, profile, { token: 'old', device: 'browser' }, now);
  await put('settings', oldReceipt, 'active');
  invalidateApiContext({ accountId: 1, profile: { id: 2 } });
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); throw new Error(`Unexpected request ${url}`); };
  try {
    assert.equal(await hasOfflineDownloads(1, 2), false);
    stores.get('downloads').set('job', { id: 'job', receipt: oldReceipt, state: 'queued' });
    assert.equal(await hasOfflineDownloads(1, 2), true);
    assert.equal(await hasOfflineDownloads(1, 3), false);
    assert.equal(await hasOfflineDownloads(9, 2), false);
    stores.get('downloads').clear();
    stores.get('files').set('file', { id: 'file', receipt: oldReceipt, complete: true });
    assert.equal(await hasOfflineDownloads(1, 2), true);
    stores.get('files').clear();
    assert.equal(await hasOfflineDownloads(1, 2), false);
    // Offline kopie by vznikala na serveru; video ale přes server nesmí jít (#153).
    await assert.rejects(queueOffline({ id: 8, type: 'movie', title: 'Fixture' }, null, {}), /aplikaci Movly/);
    assert.deepEqual(requests, []);
    const active = await get('settings', 'active');
    assert.equal(active.payload, oldReceipt.payload);
    assert.ok(await verifiedGrant(active));
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.document = previous.document;
    globalThis.CustomEvent = previous.CustomEvent;
    globalThis.window = previous.window;
    if (previous.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous.indexedDB;
  }
});
