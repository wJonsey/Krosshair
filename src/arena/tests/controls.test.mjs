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

test('both controller layouts name every button', () => {
  for (const table of ['XBOX', 'PLAYSTATION']) {
    const names = block(`const ${table}`);
    for (let i = 0; i <= 16; i += 1) assert.match(names, new RegExp(`Pad${i}: '`), `${table} has no name for Pad${i}`);
  }
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
