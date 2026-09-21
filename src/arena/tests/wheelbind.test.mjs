// The scroll wheel as a bindable input. A notch has no release of its own, so binding one means
// synthesising a press long enough for a frame to notice, which is what makes scroll jumping work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const input = readFileSync(new URL('../client/input.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('../server/profiles.js', import.meta.url), 'utf8');

const hold = Number(/WHEEL_HOLD = ([\d.]+)/.exec(input)[1]);

test('a notch is held long enough for a frame to see it, at any sane rate', () => {
  // The worst case is the highest frame rate, where frames are shortest and a press is easiest to miss.
  for (const fps of [30, 60, 144, 240, 360]) {
    assert.ok(hold > 1 / fps, `a ${hold}s press can be missed between frames at ${fps} fps`);
  }
  assert.ok(hold < 0.2, 'but it still has to feel like a tap, not a hold');
});

test('up and down are told apart', () => {
  const code = (deltaY) => (deltaY < 0 ? 'WheelUp' : 'WheelDown');
  assert.equal(code(-120), 'WheelUp');
  assert.equal(code(120), 'WheelDown');
  assert.match(input, /wheelCode = \(event\) =>/, 'the client derives the code the same way');
});

test('a bound wheel does its binding instead of changing weapon', () => {
  const handler = player.slice(player.indexOf("addEventListener('wheel'"));
  const bindCheck = handler.indexOf('actionsFor(code)');
  const weaponSwitch = handler.indexOf('switchTo');
  assert.ok(bindCheck > 0 && bindCheck < weaponSwitch, 'the binding has to be checked before the weapon swap');
});

test('the wheel can be captured while a bind slot is waiting', () => {
  assert.match(menu, /addEventListener\('wheel', captureBind/, 'the settings page listens for it');
  assert.match(menu, /passive: false/, 'and not passively, or it would scroll the page as well');
  assert.match(menu, /WheelUp/, 'and knows the code');
});

test('an unbound wheel still scrolls and still swaps weapon', () => {
  const capture = menu.slice(menu.indexOf('function captureBind'));
  const guard = capture.indexOf('if (!listening) return;');
  const prevent = capture.indexOf('preventDefault');
  assert.ok(guard >= 0 && guard < prevent, 'nothing is swallowed unless a slot is actually waiting');
});

test('the server stores a wheel bind like any other', () => {
  const rule = /\/\^\[A-Za-z0-9\]\{1,24\}\$\//.test(profiles);
  assert.ok(rule, 'the bind whitelist is the character rule it was');
  assert.ok(/^[A-Za-z0-9]{1,24}$/.test('WheelUp') && /^[A-Za-z0-9]{1,24}$/.test('WheelDown'), 'both codes survive it');
});

test('a wheel notch has a label, so it does not print as a raw code', () => {
  assert.match(input, /WheelUp: 'WHEEL UP'/);
  assert.match(input, /WheelDown: 'WHEEL DOWN'/);
});

// Picking loot up in royale asks whether the pick up key is held. A pad press only raised an event,
// which nothing in royale was listening for, so a controller could never pick a gun up: the armoury
// worked because it listens for that event, and the loot did not because it polls the keys.
test('a pad press of a key-side action holds the key, not just raises an event', () => {
  const handler = player.slice(player.indexOf("for (const action of ['interact', 'armoury']"), player.indexOf("if (tap('inspect')"));
  assert.match(handler, /this\.keys\.add\(code\)/, 'the pad has to put the key in the set, or held() never sees it');
  assert.match(handler, /bus\.emit\('key', code\)/, 'and still raise the event, for whatever listens for that instead');
  assert.match(handler, /setTimeout\(\(\) => this\.keys\.delete\(code\)/, 'and let go again, or it would be held forever');
});

test('royale reads the pick up the way the pad now writes it', () => {
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  assert.match(royale, /held\(player\.keys[^,]*, 'interact'\)/, 'royale polls the key set for interact');
  // Which is exactly why raising an event alone was never going to reach it.
  assert.ok(!/bus\.on\('key'/.test(royale), 'and does not listen for the key event');
});

test('the pad hold is long enough to be seen and short enough to be one press', async () => {
  const { PAD_TAP_HOLD } = await import('../client/input.js');
  for (const fps of [30, 60, 144, 240, 360]) assert.ok(PAD_TAP_HOLD > 1 / fps, `a ${PAD_TAP_HOLD}s hold can be missed at ${fps} fps`);
  assert.ok(PAD_TAP_HOLD < 0.25, 'but it must not linger into a second pickup');
});

test('interact still has a button on the pad after the sprint rebind', () => {
  assert.match(input, /interact: 'Pad\d+'/, 'the pad still has a pick up button');
  const pad = input.slice(input.indexOf('DEFAULT_PAD_BINDS'), input.indexOf('PAD_ACTIONS'));
  const used = [...pad.matchAll(/'(Pad\d+)'/g)].map((m) => m[1]);
  assert.equal(new Set(used).size, used.length, 'and no two actions share a button');
});
