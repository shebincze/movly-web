'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('only the exact optional negotiation POST suppresses 401 session revocation side effects', async () => {
  const { api } = await import('./app/api.js');
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent };
  const events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  let next = { status: 401, body: { message: 'expired' } };
  globalThis.fetch = async () => ({ ok: false, status: next.status, json: async () => next.body });
  try {
    await assert.rejects(api('capabilities/negotiate', { method: 'POST', optionalProbe: true }), { status: 401 });
    assert.deepEqual(events, []);
    next = { status: 401, body: { code: 'profile_grant_expired' } };
    await assert.rejects(api('capabilities/negotiate', { method: 'POST', optionalProbe: true }), { status: 401 });
    next = { status: 403, body: { code: 'session_revoked' } };
    await assert.rejects(api('capabilities/negotiate', { method: 'POST', optionalProbe: true }), { status: 403 });
    assert.deepEqual(events, []);
    next = { status: 401, body: { message: 'actual request unauthorized' } };
    await assert.rejects(api('titles/batch', { method: 'POST' }), { status: 401 });
    assert.deepEqual(events, ['movly-feedback-revoked', 'movly-offline-revoked']);
    events.length = 0;
    next = { status: 403, body: { code: 'profile_grant_expired' } };
    await assert.rejects(api('titles/batch', { method: 'POST' }), { status: 403 });
    assert.deepEqual(events, ['movly-offline-revoked']);
    events.length = 0;
    next = { status: 401, body: { message: 'non-post' } };
    await assert.rejects(api('capabilities/negotiate', { method: 'GET', optionalProbe: true }), { status: 401 });
    assert.deepEqual(events, ['movly-feedback-revoked', 'movly-offline-revoked']);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.CustomEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = previous.CustomEvent;
  }
});
