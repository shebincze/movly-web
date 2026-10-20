'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  let timerId = 0, plays = 0, choices = 0;
  const timers = new Map();
  class Button extends EventTarget {
    constructor() { super(); this.style = {}; this.disabled = false; this.connected = true; }
    setAttribute() {}
    click() { this.dispatchEvent(new Event('click', {cancelable: true})); }
  }
  const button = new Button();
  const document = new EventTarget();
  document.documentElement = {contains: node => node.connected};
  const window = new EventTarget(); window.PointerEvent = true;
  const sandbox = {window, document,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('app/play-activation.js', 'utf8'), sandbox);
  sandbox.window.attachPlayChoice(button, () => choices++, 'Vybrat jiný zdroj');
  button.addEventListener('click', () => plays++);
  return {button, counts: () => [plays, choices],
    emit(type, values = {}) { const event = new Event(type, {cancelable: true}); Object.assign(event, values); button.dispatchEvent(event); },
    documentEvent(type, values = {}) { const event = new Event(type, {cancelable: true}); Object.assign(event, values); document.dispatchEvent(event); return event; },
    hold() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }};
}
const point = {button: 0, clientX: 20, clientY: 20};
test('pointer hold consumes release click; following tap still plays', () => {
  const f = fixture();
  f.emit('pointerdown', point); f.hold(); f.emit('pointerup'); f.button.click();
  assert.deepEqual(f.counts(), [0,1]);
  f.emit('pointerdown', point); f.emit('pointerup'); f.button.click();
  assert.deepEqual(f.counts(), [1,1]);
});
test('cancel, moving away, lost focus and detached button cannot open sources', () => {
  for (const reason of ['pointercancel', 'pointerleave', 'blur', 'move', 'detach']) {
    const f = fixture(); f.emit('pointerdown', point);
    if (reason === 'move') f.emit('pointermove', {clientX: 50, clientY: 20});
    else if (reason === 'detach') f.button.connected = false;
    else f.emit(reason);
    f.hold(); assert.deepEqual(f.counts(), [0,0], reason);
  }
});
test('remote short, held and repeated Enter activate exactly one action', () => {
  const f = fixture();
  f.emit('keydown', {key: 'Enter'}); f.emit('keyup', {key: 'Enter'});
  assert.deepEqual(f.counts(), [1,0]);
  f.emit('keydown', {key: 'Enter'}); f.emit('keydown', {key: 'Enter', repeat: true});
  f.hold(); f.emit('keyup', {key: 'Enter'});
  assert.deepEqual(f.counts(), [1,1]);
});
test('Shift Enter chooses manually without normal keyboard click', () => {
  const f = fixture(); f.emit('keydown', {key: 'Enter', shiftKey: true}); f.emit('keyup', {key: 'Enter'});
  assert.deepEqual(f.counts(), [0,1]);
});
test('disabled button and secondary pointer do not open sources', () => {
  const f = fixture(); f.button.disabled = true; f.emit('pointerdown', point); f.hold();
  f.emit('pointerdown', {...point, button: 2}); f.hold(); assert.deepEqual(f.counts(), [0,0]);
});

test('held OK cannot activate a newly focused source before key release', () => {
  const f = fixture();
  f.emit('keydown', {key: 'Enter'}); f.hold();
  f.emit('blur'); // Opening the picker transfers focus away from Play.
  assert.equal(f.documentEvent('keydown', {key: 'Enter', repeat: true}).defaultPrevented, true);
  assert.equal(f.documentEvent('keyup', {key: 'Enter'}).defaultPrevented, true);
  assert.deepEqual(f.counts(), [0,1]);
  assert.equal(f.documentEvent('keydown', {key: 'Enter'}).defaultPrevented, false);
  f.emit('keydown', {key: 'Enter'}); f.emit('keyup', {key: 'Enter'});
  assert.deepEqual(f.counts(), [1,1]);
});
