// Controller binds: the defaults make sense, and the server keeps only what a pad can really send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';

// input.js runs in the browser, so the tables are read from its source.
const source = readFileSync(new URL('../client/input.js', import.meta.url), 'utf8');
const block = (name) => source.slice(source.indexOf(`${name} = {`), source.indexOf('};', source.indexOf(`${name} = {`)));
const padBinds = Object.fromEntries([...block('DEFAULT_PAD_BINDS').matchAll(/(\w+): '(Pad\d+)'/g)].map((m) => [m[1], m[2]]));
const padActions = [...source.slice(source.indexOf('export const PAD_ACTIONS'), source.indexOf('export function padBindFor')).matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]);

test('every controller action has a button, and no button does two things', () => {
  assert.ok(padActions.length >= 14, `only ${padActions.length} pad actions`);
  for (const action of padActions) assert.ok(padBinds[action], `${action} has no default button`);
  const used = Object.values(padBinds);
  assert.equal(new Set(used).size, used.length, 'two actions share a button');
  for (const code of used) assert.match(code, /^Pad(?:[0-9]|1[0-5])$/);
  // The shooting basics sit on the triggers, where a pad player expects them.
  assert.equal(padBinds.fire, 'Pad7');
  assert.equal(padBinds.scope, 'Pad6');
  assert.equal(padBinds.jump, 'Pad0');
});

test('every controller layout names every button, and each has its own words', () => {
  const layouts = source.slice(source.indexOf('export const PAD_LAYOUTS'), source.indexOf('export const PAD_LAYOUT_IDS'));
  const rows = [...layouts.matchAll(/^  (\w+): \{ name: '([^']+)', names: \{([^}]*)\}/gm)];
  assert.ok(rows.length >= 5, `only ${rows.length} layouts`);
  const seen = new Set();
  for (const [, id, name, names] of rows) {
    assert.ok(name, `${id} has no name`);
    for (let i = 0; i <= 11; i += 1) assert.match(names, new RegExp(`Pad${i}: '`), `${id} has no name for Pad${i}`);
    assert.match(names, /\.\.\.DPAD/, `${id} is missing the d-pad`);
    seen.add(names.match(/Pad0: '([^']+)'/)[1]);
  }
  for (const id of ['xbox', 'playstation', 'nintendo', 'steam', 'generic']) assert.ok(layouts.includes(`  ${id}: {`), `no ${id} layout`);
  // Nintendo swaps its face buttons, so the bottom button is not called A.
  const nintendo = rows.find(([, id]) => id === 'nintendo')[3];
  assert.match(nintendo, /Pad0: 'B'/);
  assert.match(nintendo, /Pad1: 'A'/);
  assert.ok(seen.size >= 3, 'the layouts all call the bottom button the same thing');
});

test('the server keeps controller binds and the aim assist switch, and drops anything else', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-controls-')), 'profiles.json'));
  const token = ProfileStore.newToken();
  profiles.savePrefs(token, { settings: { aimAssist: false, padSensitivity: 1.4, padBinds: { fire: 'Pad5', scope: 'Pad9', jump: 'KeyW', crouch: null, 'bad action': 'Pad1', melee: 'Pad99' } } });
  const kept = profiles.get(token).settings;
  assert.equal(kept.aimAssist, false);
  assert.equal(kept.padSensitivity, 1.4);
  assert.equal(kept.padBinds.fire, 'Pad5');
  assert.equal(kept.padBinds.scope, 'Pad9');
  assert.equal(kept.padBinds.jump, null, 'a keyboard code is not a pad button');
  assert.equal(kept.padBinds.melee, null, 'Pad99 is not a real button');
  assert.equal(kept.padBinds.crouch, null);
  assert.ok(!('bad action' in kept.padBinds));
  // The switch is a real boolean, never a string.
  profiles.savePrefs(token, { settings: { aimAssist: 'yes please' } });
  assert.equal(profiles.get(token).settings.aimAssist, undefined);
});

// Tab is the scoreboard and is wanted for the royale inventory, so the island map moved off it onto a
// key of its own rather than the two sharing one: that is how walking and sprinting went wrong before.
test('the royale map has its own key, and it is not the scoreboard', () => {
  const binds = Object.fromEntries([...block('DEFAULT_BINDS').matchAll(/(\w+): \['([^']*)'(?:, '([^']*)')?/g)].map((m) => [m[1], [m[2], m[3] || null]]));
  assert.deepEqual(binds.map, ['KeyM', null], 'the map must be on M');
  assert.equal(binds.scoreboard[0], 'Tab', 'and the scoreboard stays on Tab');
  assert.ok(!Object.entries(binds).some(([id, keys]) => id !== 'map' && keys.includes('KeyM')), 'M is doing something else as well');
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  assert.match(royale, /const showMap = held\(player\.keys \|\| new Set\(\), 'map'\)/, 'the island still opens on the scoreboard key');
  assert.ok(!/'scoreboard'/.test(royale), 'nothing in royale should be reading the scoreboard key any more');
});

test('the map is listed so it can be rebound, and needs no controller button', () => {
  const actions = source.slice(source.indexOf('export const ACTIONS'), source.indexOf('export const DEFAULT_BINDS'));
  assert.match(actions, /\['map', 'Map \(royale\)', 'Team'\]/, 'an action nobody can see in Controls cannot be rebound');
  // The island map was never reachable on a controller: only interact and armoury press a key for the
  // pad, so this is not a thing to find a spare button for.
  assert.ok(!padActions.includes('map'), 'every pad button is already taken, so adding one would fail its own test');
});
