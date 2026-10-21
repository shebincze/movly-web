const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(saved = new Map()) {
  const events = new Map();
  const window = { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    document: { createEvent: () => ({ initEvent(name) { this.type = name; } }) },
    dispatchEvent(event) { for (const fn of events.get(event.type) || []) fn(event); },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); } };
  vm.runInNewContext(fs.readFileSync('app/title-identifiers.js', 'utf8'), { window });
  return { model: window.MovlyTitleIdentifiers, window, saved };
}
test('IDs distinguish database identity from TMDB-only routes and reject absent/invalid values', () => {
  const { model } = fixture();
  for (const [input, db, tmdb] of [
    [{id: 123, tmdb_id: 456}, 123, 456], [{id: '123', tmdb_id: '456'}, 123, 456],
    [{id: 'tmdb:movie:456'}, null, 456], [{id: 'tmdb:tv:42'}, null, 42],
    [{id: 'tmdb:series:42', tmdb_id: 99}, null, 99], [{id: 0, tmdb_id: -1}, null, null],
    [{id: -12, tmdb_id: 0}, null, null], [{id: 'tmdb:movie:0'}, null, null],
    [{id: '12x', tmdb_id: 1.5}, null, null], [{id: 9007199254740992}, null, null], [{}, null, null]
  ]) { const actual = model.ids(input); assert.equal(actual.db, db); assert.equal(actual.tmdb, tmdb); }
});
test('default off, persisted on/off, and a live detail updates and unsubscribes', () => {
  const { model, saved } = fixture(); const node = {};
  assert.equal(model.enabled(), false);
  const stop = model.watch(node, {id: 12, tmdb_id: 34});
  assert.equal(node.hidden, true);
  assert.equal(model.setEnabled(true), true); assert.equal(node.hidden, false);
  assert.equal(node.textContent, 'DB ID: 12 · TMDB ID: 34');
  assert.equal(fixture(saved).model.enabled(), true);
  model.setEnabled(false); assert.equal(node.hidden, true); assert.equal(fixture(saved).model.enabled(), false);
  stop(); model.setEnabled(true); assert.equal(node.hidden, true);
});
test('unavailable database identity is rendered as dash, and denied storage fails closed', () => {
  const { model, window } = fixture(); const node = {}; model.paint(node, {id: 'tmdb:movie:44'});
  assert.equal(node.textContent, 'DB ID: — · TMDB ID: 44');
  window.localStorage.getItem = () => { throw new Error('denied'); };
  window.localStorage.setItem = () => { throw new Error('denied'); };
  assert.equal(model.enabled(), false); assert.equal(model.setEnabled(true), false);
});
