const { test } = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('empty, first queued item, completion and last deletion update the menu live', async () => {
  const { observeOfflineNavigation } = await import('./app/offline-navigation.js');
  const events = new EventTarget(), link = { hidden: false };
  let items = [];
  const observer = observeOfflineNavigation(link, async () => items.length > 0, events);
  await tick(); assert.equal(link.hidden, true);
  items = ['queued']; events.dispatchEvent(new Event('movly-downloads-changed'));
  await tick(); assert.equal(link.hidden, false);
  items = ['complete']; events.dispatchEvent(new Event('movly-downloads-changed'));
  await tick(); assert.equal(link.hidden, false);
  items = []; events.dispatchEvent(new Event('movly-downloads-changed'));
  await tick(); assert.equal(link.hidden, true);
  observer.dispose();
});

test('revocation and newer inventory beat late reads from the previous owner', async () => {
  const { observeOfflineNavigation } = await import('./app/offline-navigation.js');
  const events = new EventTarget(), link = { hidden: false }, pending = [];
  const observer = observeOfflineNavigation(link, () => new Promise(resolve => pending.push(resolve)), events);
  events.dispatchEvent(new Event('movly-offline-revoked'));
  pending.shift()(true); await tick(); assert.equal(link.hidden, true);
  events.dispatchEvent(new Event('movly-offline-context-changed'));
  const old = pending.shift();
  events.dispatchEvent(new Event('movly-downloads-changed'));
  pending.shift()(false); await tick(); old(true); await tick(); assert.equal(link.hidden, true);
  observer.dispose();
  events.dispatchEvent(new Event('movly-downloads-changed'));
  assert.equal(pending.length, 0);
});
