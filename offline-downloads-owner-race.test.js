'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { offlineSigner } = require('./offline-grant');
const policyFixtures = require('./test-support/effective-policy-v1.fixtures.json');

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

test('a stale offline-grant 403 cannot revoke a newer active receipt through the real download caller', async () => {
  const previous = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent,
    indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  const window = new EventTarget();
  globalThis.window = window;
  globalThis.document = {};
  globalThis.CustomEvent = class extends Event {};
  const stores = installIndexedDB();
  const { api, invalidateApiContext } = await import('./app/api.js');
  const { put, get, storeFreshOfflineGrant, verifiedGrant } = await import('./app/offline-store.js');
  await import('./app/offline.js'); // Installs the real movly-offline-revoked listener that clears active.
  const { queueOffline } = await import('./app/offline-downloads.js');
  const now = Date.now(), signer = offlineSigner('offline-download-owner-race-test');
  const user = { id: 1, username: 'test', role: 'user', is_active: true, is_verified: true,
    premium_until: new Date(now + 86400000).toISOString() };
  const profile = { id: 2, name: 'Adult', is_kids: false, has_pin: false, max_certification: 18, allow_unrated: true };
  const oldReceipt = signer.issue(user, profile, { token: 'old', device: 'browser' }, now);
  const newReceipt = signer.issue(user, profile, { token: 'new', device: 'browser' }, now + 1);
  await put('settings', oldReceipt, 'active');
  invalidateApiContext({ accountId: 1, profile: { id: 2 } });
  const policy = policyFixtures.cases.find(item => item.name === 'ordinary_default').effective;
  globalThis.fetch = async url => {
    if (url.endsWith('/profiles/effective-content-policy')) return { ok: true, status: 200, json: async () => policy };
    if (url.endsWith('/offline-grant')) {
      await put('settings', newReceipt, 'active'); // Owner changes while the old request is in flight.
      return { ok: false, status: 403, json: async () => ({ code: 'upstream_forbidden' }) };
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await assert.rejects(queueOffline({ id: 8, type: 'movie', title: 'Fixture' }, null, {}), { status: 403 });
    const active = await get('settings', 'active');
    assert.equal(active.payload, newReceipt.payload, 'stale 403 leaves the newer signed receipt active');
    assert.ok(await verifiedGrant(active), 'new receipt remains valid');
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.document = previous.document;
    globalThis.CustomEvent = previous.CustomEvent;
    globalThis.window = previous.window;
    if (previous.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous.indexedDB;
  }
});
