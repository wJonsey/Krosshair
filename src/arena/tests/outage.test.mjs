// Pulling a map or a gun mid match: it takes effect at once, it survives a restart, it explains itself,
// and it can never leave the game with nothing to play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { OutageBook } from '../server/outage.js';
import { Room } from '../server/room.js';
import { MAX_WEAPON_LEVEL, XP_CURVE } from '../shared/gunlevels.js';
import { MAP_IDS } from '../shared/map.js';
import { WEAPONS } from '../shared/constants.js';
import { DEFAULT_REASON, FEATURES, FEATURE_IDS, cleanReason, featureOut, outageReason } from '../shared/outage.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const fakeSocket = () => { const sent = []; return { readyState: 1, sent, send: (raw) => { const m = JSON.parse(raw); if (m.type !== 's') sent.push(m); } }; };
const book = async () => new OutageBook(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-out-')), 'outages.json'));
async function makeRoom() {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-outr-')), 'profiles.json'));
  const room = new Room({ name: `out-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  return room;
}

test('a pull is written down, so a deploy restart does not put it back', async () => {
  const one = await book();
  one.set('weapon', 'talon', true, 'One shot through walls', 'Gking09');
  one.set('map', MAP_IDS[0], true, '', 'Gking09');
  // A second book over the same file is what a restart looks like.
  const two = new OutageBook(one.file);
  assert.ok(two.isOut('weapon', 'talon'), 'the gun came back after a restart');
  assert.ok(two.isOut('map', MAP_IDS[0]), 'the map came back after a restart');
  assert.equal(two.get('weapon', 'talon').reason, 'One shot through walls');
  assert.equal(two.get('weapon', 'talon').by, 'Gking09');
});

test('a blank reason gets the default, and a written one is kept and cleaned', async () => {
  const out = await book();
  out.set('weapon', 'talon', true, '   ', 'dev');
  assert.equal(outageReason(out.get('weapon', 'talon')), DEFAULT_REASON.weapon);
  out.set('map', MAP_IDS[0], true, null, 'dev');
  assert.equal(outageReason(out.get('map', MAP_IDS[0])), DEFAULT_REASON.map);
  // Control characters and runaway length are not a developer's problem to remember.
  assert.equal(cleanReason('  bad\nline  '), 'bad line');
  assert.equal(cleanReason('x'.repeat(400)).length, 140);
  out.set('weapon', 'wasp', true, 'Shoots through the floor', 'dev');
  assert.equal(outageReason(out.get('weapon', 'wasp')), 'Shoots through the floor');
});

test('nothing unknown can be pulled, and the last arena can never be', async () => {
  const out = await book();
  assert.equal(out.set('weapon', 'not-a-gun', true, '', 'dev'), null);
  assert.equal(out.set('nonsense', 'yard', true, '', 'dev'), null);
  // Pull every arena but one, then try the last.
  for (const id of MAP_IDS.slice(0, -1)) assert.ok(out.set('map', id, true, '', 'dev')?.on, `could not pull ${id}`);
  const last = MAP_IDS[MAP_IDS.length - 1];
  assert.ok(out.set('map', last, true, '', 'dev')?.error, 'the last arena was pulled, leaving nothing to play');
  assert.ok(!out.isOut('map', last));
  // Putting one back makes room again.
  out.set('map', MAP_IDS[0], false, '', 'dev');
  assert.ok(out.set('map', last, true, '', 'dev')?.on, 'still could not pull it with another free');
});

test('a pulled gun leaves the armoury and cannot be bought', async () => {
  const out = await book();
  const room = await makeRoom();
  Room.useOutages(out);
  try {
    assert.ok(Room.liveWeapons().includes('talon'));
    out.set('weapon', 'talon', true, 'Broken', 'dev');
    assert.ok(!Room.liveWeapons().includes('talon'), 'the armoury still lists a pulled gun');
    const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
    room.phase = 'buy'; player.alive = true; player.credits = 9000;
    room.buy(player, 'talon');
    assert.notEqual(player.weapons.primary, 'talon', 'a pulled gun was sold');
    const told = player.socket.sent.find((m) => m.type === 'notice' || m.type === 'feed');
    assert.ok(told && /disabled/i.test(JSON.stringify(told)), 'nobody said why');
  } finally { Room.useOutages(null); room.close(); }
});

test('pulling a gun mid round takes it out of every hand and refunds it', async () => {
  const out = await book();
  const room = await makeRoom();
  Room.useOutages(out);
  try {
    const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
    room.phase = 'buy'; player.alive = true; player.credits = 9000;
    room.buy(player, 'talon');
    assert.equal(player.weapons.primary, 'talon');
    const after = player.credits;
    room.phase = 'live';
    out.set('weapon', 'talon', true, 'Shoots through walls', 'dev');
    room.applyOutages();
    assert.equal(player.weapons.primary, null, 'the gun stayed in their hands');
    assert.ok(player.credits > after, 'the credits were not given back');
    assert.notEqual(player.active, 'primary', 'still holding the slot that was emptied');
    const said = player.socket.sent.filter((m) => m.type === 'notice').map((m) => m.text).join(' ');
    assert.match(said, /Shoots through walls/, 'the reason never reached the pilot');
  } finally { Room.useOutages(null); room.close(); }
});

test('pulling the map everyone is on ends the round and says why', async () => {
  const out = await book();
  const room = await makeRoom();
  Room.useOutages(out);
  try {
    const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
    room.phase = 'live';
    out.set('map', room.map.id, true, 'You fall through the floor', 'dev');
    room.applyOutages();
    assert.equal(room.phase, 'lobby', 'the round carried on over a broken map');
    const said = player.socket.sent.map((m) => m.text || '').join(' ');
    assert.match(said, /You fall through the floor/, 'nobody was told why the match ended');
  } finally { Room.useOutages(null); room.close(); }
});

test('putting something back restores it everywhere', async () => {
  const out = await book();
  Room.useOutages(out);
  try {
    out.set('weapon', 'wasp', true, '', 'dev');
    assert.ok(!Room.liveWeapons().includes('wasp'));
    out.set('weapon', 'wasp', false, '', 'dev');
    assert.ok(Room.liveWeapons().includes('wasp'), 'the gun never came back');
    assert.equal(out.get('weapon', 'wasp'), null);
    // Putting back something that was never pulled is not an error, it just does nothing.
    assert.equal(out.set('weapon', 'wasp', false, '', 'dev'), null);
  } finally { Room.useOutages(null); }
});

test('with nothing pulled, the game is exactly as it was', async () => {
  const out = await book();
  Room.useOutages(out);
  try {
    assert.equal(Room.liveWeapons().length, Object.keys(WEAPONS).length);
    assert.deepEqual(out.view(), { map: {}, weapon: {}, feature: {} });
    assert.deepEqual(out.playableMaps(MAP_IDS), MAP_IDS);
  } finally { Room.useOutages(null); }
});


test('a whole feature can be pulled, and only the ones that exist', async () => {
  const out = await book();
  assert.ok(FEATURE_IDS.length >= 5, `only ${FEATURE_IDS.length} features can be pulled`);
  for (const feature of FEATURES) assert.ok(feature.name && feature.blurb, `${feature.id} has no words`);
  assert.equal(out.set('feature', 'not-a-feature', true, '', 'dev'), null, 'an invented feature was pulled');
  assert.ok(out.set('feature', 'gunsmith', true, 'Attachments are broken', 'dev')?.on);
  assert.ok(out.featureOut('gunsmith'));
  assert.ok(featureOut(out.view(), 'gunsmith'), 'the client view does not carry features');
  assert.equal(outageReason(out.get('feature', 'gunsmith')), 'Attachments are broken');
  // Blank gets the feature default, not the weapon one.
  out.set('feature', 'crates', true, '', 'dev');
  assert.equal(outageReason(out.get('feature', 'crates')), DEFAULT_REASON.feature);
  out.set('feature', 'gunsmith', false, '', 'dev');
  assert.ok(!out.featureOut('gunsmith'), 'the feature never came back');
});

test('with the Gunsmith pulled, everyone is on stock guns', async () => {
  const out = await book();
  const room = await makeRoom();
  Room.useOutages(out);
  try {
    const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
    room.profiles.awardGunXp(player.token, 'talon', XP_CURVE[MAX_WEAPON_LEVEL - 1]); // the drum has to be unlocked first
    player.builds = { talon: { optic: null, muzzle: null, barrel: null, mag: 'drum', stock: null, grip: null } };
    player.weapons.primary = 'talon';
    player.active = 'primary';
    const built = room.currentWeapon(player);
    assert.ok(built.mag > WEAPONS.talon.mag, 'the build was not being used in the first place');
    out.set('feature', 'gunsmith', true, '', 'dev');
    room.applyOutages();
    assert.equal(room.currentWeapon(player).mag, WEAPONS.talon.mag, 'a build survived the Gunsmith being pulled');
    // And it comes back when the switch goes back.
    out.set('feature', 'gunsmith', false, '', 'dev');
    room.applyOutages();
    assert.ok(room.currentWeapon(player).mag > WEAPONS.talon.mag, 'builds did not come back');
  } finally { Room.useOutages(null); room.close(); }
});
