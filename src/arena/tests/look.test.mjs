// What a pilot can wear: after a wiped server the browser still remembers the old look, and nothing
// the account doesn't own may stay on it. Developers keep their dev items whatever the store says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { tradeUp } from '../server/economy.js';
import { DEFAULT_LOOK, WEAPONS } from '../shared/constants.js';
import { cleanLook } from '../shared/look.js';

const guns = Object.keys(WEAPONS).filter((id) => !WEAPONS[id].melee);
const onEveryGun = (finish) => Object.fromEntries(guns.map((id) => [id, finish]));
// What a browser remembers from before the wipe: bought gear, a level-locked colour, a skin on every gun.
const stale = { color: '#5d6b3a', accent: '#6ce6d1', tracer: '#ffc857', title: 'Night Owl', headgear: 'crown', face: 'skull', pack: 'jetpack', pattern: 'tiger', charm: 'diamond', skins: onEveryGun('olive') };
// The same browser on a developer's account.
const devLook = { ...DEFAULT_LOOK, color: '#04150f', accent: '#7cffe8', tracer: 'devprism', title: 'Developer', headgear: 'devhalo', face: 'devmask', pack: 'devwings', pattern: 'devcircuit', charm: 'devcore', skins: onEveryGun('devsource') };
const fresh = { level: 1, owned: [], finishes: [], dev: false };

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-look-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  return profiles;
}

test('an empty account keeps none of the old look, and falls back to the defaults', () => {
  const clean = cleanLook(stale, fresh);
  assert.deepEqual(clean, { ...DEFAULT_LOOK, skins: {} });
});

test('what the account owns stays on, and only that', () => {
  const clean = cleanLook(stale, { ...fresh, owned: ['headgear:crown', 'charm:diamond'], finishes: ['olive'] });
  assert.equal(clean.headgear, 'crown');
  assert.equal(clean.charm, 'diamond');
  assert.equal(clean.color, DEFAULT_LOOK.color);
  assert.equal(clean.pack, DEFAULT_LOOK.pack);
  assert.deepEqual(clean.skins, onEveryGun('olive'));
  // Level unlocks count too: the title is free at level 2.
  assert.equal(cleanLook({ ...stale, title: 'Marksman' }, { ...fresh, level: 2 }).title, 'Marksman');
  assert.equal(cleanLook({ ...stale, title: 'Marksman' }, fresh).title, 'Recruit');
});

test('a developer keeps every dev item on an empty account, and other accounts never can', () => {
  const dev = cleanLook(devLook, { ...fresh, dev: true });
  assert.deepEqual(dev, devLook);
  assert.deepEqual(cleanLook(devLook, fresh), { ...DEFAULT_LOOK, skins: {} });
  // Dev status doesn't hand over what isn't dev: a shop skin that was never bought still comes off.
  assert.deepEqual(cleanLook({ ...devLook, skins: onEveryGun('olive') }, { ...fresh, dev: true }).skins, {});
});

test('junk in, defaults out', () => {
  for (const junk of [null, undefined, 'x', 7, [], { skins: 'olive' }, { skins: { nope: 'olive', [guns[0]]: 'nope' } }]) {
    assert.deepEqual(cleanLook(junk, fresh), { ...DEFAULT_LOOK, skins: {} });
  }
});

test('the profile the browser is sent already has the stale look taken off', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  // A look that was saved while the pilot owned things they no longer have.
  profiles.get(token).look = { ...stale };
  const view = profiles.view(token);
  assert.deepEqual(view.look, { ...DEFAULT_LOOK, skins: {} });
  assert.deepEqual(view.finishes, []);
  // Reading it never rewrites what is stored.
  assert.equal(profiles.get(token).look.headgear, 'crown');
});

test('a developer signing in on a wiped store is sent their dev look untouched', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  // The order the server signs someone in: dev class first, then the profile goes out.
  profiles.setDev(token, true);
  profiles.savePrefs(token, { look: devLook });
  assert.deepEqual(profiles.view(token).look, devLook);
  // A brand new profile that only has the class set, nothing saved yet, cleans to the same thing.
  const another = ProfileStore.newToken();
  profiles.setDev(another, true);
  assert.deepEqual(profiles.sanitizeCosmetics(another, devLook), devLook);
  // And the same look on a normal account is refused.
  const plain = ProfileStore.newToken();
  assert.deepEqual(profiles.sanitizeCosmetics(plain, devLook), { ...DEFAULT_LOOK, skins: {} });
});

test('the server and the browser agree on what a look is', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  const profile = profiles.wallet(token);
  profile.finishes = ['olive'];
  profile.owned = ['headgear:crown'];
  const view = profiles.view(token);
  assert.deepEqual(cleanLook(stale, view), profiles.sanitizeCosmetics(token, stale));
  assert.equal(cleanLook(stale, view).headgear, 'crown');
});

test('trading a worn skin away leaves nothing worn that the account lacks', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  const commons = ['olive', 'sand', 'slate', 'woodland', 'midnight'];
  const profile = profiles.wallet(token);
  profile.finishes = [...commons];
  profile.look = { ...DEFAULT_LOOK, skins: onEveryGun('olive') };
  const { traded } = tradeUp(profiles, token, commons);
  assert.ok(traded);
  const view = profiles.view(token);
  assert.deepEqual(view.look.skins, {});
  // The browser was still wearing it when the result came back; running its look through the rule takes it off.
  assert.deepEqual(cleanLook({ ...DEFAULT_LOOK, skins: onEveryGun('olive') }, view).skins, {});
});
