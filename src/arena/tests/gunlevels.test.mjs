// Weapon levels: every gun starts at 0 with only its stock build, earns XP from the server's own kill
// and assist events, unlocks parts as it levels, and goes back to 0 when the server restarts. Nothing a
// client sends can level a gun or put a locked part on one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { WEAPONS } from '../shared/constants.js';
import { ATTACHMENTS, SLOTS, fitsWeapon, resolveWeapon } from '../shared/attachments.js';
import { MAX_WEAPON_LEVEL, UNLOCK_LEVELS, WEAPON_UNLOCKS, WEAPON_XP, XP_CURVE, levelledGun, unlockLevel, unlockTree, usableBuild, weaponLevel, weaponProgress } from '../shared/gunlevels.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const inbox = () => ({ readyState: 1, sent: [], send(raw) { const message = JSON.parse(raw); if (message.type !== 's') this.sent.push(message); } });
const store = async (dir) => { const profiles = new ProfileStore(path.join(dir || await mkdtemp(path.join(tmpdir(), 'krosshair-gunlv-')), 'profiles.json')); await profiles.load(); return profiles; };
const dotLevel = unlockLevel('m44', 'dot');
const xpFor = (level) => (level ? XP_CURVE[level - 1] : 0);

async function match(profiles) {
  const room = new Room({ name: `gunlv-${Math.random().toString(36).slice(2, 7)}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const a = room.join(inbox(), { token: ProfileStore.newToken(), session: 'a', name: 'Alpha' }, look);
  const b = room.join(inbox(), { token: ProfileStore.newToken(), session: 'b', name: 'Bravo' }, look);
  a.team = 'A'; b.team = 'B';
  room.phase = 'live';
  room.spawn(a, 0); room.spawn(b, 0);
  return { room, a, b };
}
// A real kill, through the same damage path a shot takes.
// A kill ends the round when it is the last on a side, so each one here is in a live round of its own.
const killWith = (room, killer, victim, weaponId, zone = 'torso') => { room.phase = 'live'; if (!victim.alive) room.spawn(victim, 0); room.applyDamage(victim, killer, 999, zone, WEAPONS[weaponId]); };
const hit = (room, victim, attacker, amount, weaponId) => { room.phase = 'live'; room.applyDamage(victim, attacker, amount, 'torso', WEAPONS[weaponId]); };

test('the curve and the unlock table are sound, and every part has a level', () => {
  assert.equal(XP_CURVE.length, MAX_WEAPON_LEVEL);
  for (let i = 1; i < XP_CURVE.length; i += 1) assert.ok(XP_CURVE[i] > XP_CURVE[i - 1], 'the XP curve does not climb');
  assert.deepEqual(XP_CURVE.slice(0, 4), [100, 250, 450, 700]);
  for (const id of Object.keys(ATTACHMENTS)) {
    const level = UNLOCK_LEVELS[id];
    assert.ok(Number.isInteger(level) && level >= 1 && level <= MAX_WEAPON_LEVEL, `${id} has no valid unlock level`);
  }
  for (const [weapon, parts] of Object.entries(WEAPON_UNLOCKS)) for (const [part, level] of Object.entries(parts)) {
    assert.ok(WEAPONS[weapon] && ATTACHMENTS[part], `${weapon}:${part} names something that does not exist`);
    assert.ok(Number.isInteger(level) && level >= 1 && level <= MAX_WEAPON_LEVEL, `${weapon}:${part} has an invalid level`);
  }
  // Every gun that takes parts has something to unlock, and only parts that fit it.
  for (const weapon of Object.values(WEAPONS).filter((w) => levelledGun(w.id))) {
    const tree = unlockTree(weapon.id);
    assert.ok(tree.length, `${weapon.id} unlocks nothing`);
    for (const { part } of tree) assert.ok(fitsWeapon(part, weapon), `${weapon.id} unlocks ${part.id}, which does not fit it`);
  }
});

test('a bad level in the table locks a part rather than handing it out', () => {
  WEAPON_UNLOCKS.m44 = { dot: 'soon' };
  try { assert.equal(unlockLevel('m44', 'dot'), Infinity); assert.deepEqual(usableBuild('m44', { optic: 'dot' }, MAX_WEAPON_LEVEL).optic, null); } finally { delete WEAPON_UNLOCKS.m44; }
  assert.equal(unlockLevel('m44', 'not-a-part'), Infinity);
  assert.equal(unlockLevel('knife', 'dot'), Infinity);
  assert.equal(unlockLevel('p9', 'longscope'), Infinity, 'a part that does not fit the gun unlocks on it');
  assert.equal(unlockLevel('constructor', 'dot'), Infinity);
});

test('1. a new pilot has every gun at level 0 and only the stock build', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  for (const id of Object.keys(WEAPONS)) assert.equal(profiles.gunLevel(token, id), 0);
  assert.deepEqual(profiles.view(token).gunXp, {});
  // A stock gun always works: nothing is needed to use a gun exactly as it comes.
  const stock = resolveWeapon('m44', usableBuild('m44', {}, 0));
  assert.equal(stock, WEAPONS.m44);
  const { refused } = profiles.saveBuilds(token, { m44: { optic: 'dot' } });
  assert.deepEqual(refused, [{ weapon: 'm44', part: 'dot' }]);
  assert.equal(profiles.get(token).builds?.m44, undefined, 'a locked part was saved');
});

test('2. using a gun levels that gun and no other', async () => {
  const profiles = await store();
  const { room, a, b } = await match(profiles);
  killWith(room, a, b, 'm44');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill);
  killWith(room, a, b, 'm44', 'head');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill * 2 + WEAPON_XP.headshot);
  while (profiles.gunLevel(a.token, 'm44') < dotLevel) killWith(room, a, b, 'm44');
  for (const id of Object.keys(WEAPONS)) if (id !== 'm44') assert.equal(profiles.gunLevel(a.token, id), 0, `${id} levelled too`);
  // The level-up was announced, by the server, with what it opened.
  const ups = a.socket.sent.filter((m) => m.type === 'gun-xp' && m.level > m.from);
  assert.ok(ups.length >= 1, 'no level-up was sent');
  assert.ok(ups.some((m) => m.unlocked.includes('dot')), 'the red dot unlock was never announced');
  room.close();
});

test('3. an unlocked part can be fitted, and shows up everywhere the build does', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  profiles.awardGunXp(token, 'm44', xpFor(dotLevel));
  assert.deepEqual(profiles.saveBuilds(token, { m44: { optic: 'dot' } }).refused, []);
  assert.equal(profiles.view(token).builds.m44.optic, 'dot');
  const room = new Room({ name: 'gunlv-fit', queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join(inbox(), { token, session: 's', name: 'Fitter' }, look);
  room.phase = 'live'; room.spawn(player, 0);
  assert.equal(room.currentWeapon(player).sight, 'dot', 'the gun in hand is not the one built');
  room.close();
});

test('4. a locked part cannot be fitted by a forged build, however it arrives', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  profiles.awardGunXp(token, 'm44', xpFor(dotLevel)); // the dot, and nothing past it
  const locked = Object.values(ATTACHMENTS).find((part) => fitsWeapon(part, WEAPONS.m44) && unlockLevel('m44', part.id) > dotLevel && part.slot !== 'optic');
  const forged = { optic: 'dot', [locked.slot]: locked.id };
  const { refused } = profiles.saveBuilds(token, { m44: forged, talon: { optic: 'dot' }, knife: { optic: 'dot' }, constructor: {} });
  assert.deepEqual(refused.map((r) => `${r.weapon}:${r.part}`).sort(), [`m44:${locked.id}`, 'talon:dot']);
  assert.deepEqual(profiles.get(token).builds.m44[locked.slot], null, 'a locked part was saved');
  assert.equal(profiles.get(token).builds.m44.optic, 'dot', 'the unlocked part was lost with the locked one');
  // Straight into the room, as a stale or tampered build would: the gun in hand and the armoury both refuse it.
  const room = new Room({ name: 'gunlv-forge', queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join(inbox(), { token, session: 's', name: 'Forger' }, look);
  player.builds = { m44: forged, talon: { optic: 'dot', mag: 'drum' } };
  room.phase = 'live'; room.spawn(player, 0);
  assert.equal(room.currentWeapon(player).build?.[locked.slot] ?? null, null, 'the forged part is on the gun in hand');
  room.phase = 'buy'; player.credits = 9000;
  room.handle(player, { type: 'buy', item: 'talon' });
  assert.equal(9000 - player.credits, WEAPONS.talon.cost, 'the armoury charged for, and so fitted, locked parts');
  assert.equal(room.currentWeapon(player).mag, WEAPONS.talon.mag, 'a locked drum came with the talon');
  room.close();
});

test('5. each gun keeps its own level through weapon swaps', async () => {
  const profiles = await store();
  const { room, a } = await match(profiles);
  profiles.awardGunXp(a.token, 'm44', xpFor(5));
  profiles.awardGunXp(a.token, 'p9', xpFor(2));
  for (const slot of ['sidearm', 'primary', 'sidearm', 'primary']) { a.equipUntil = 0; room.switchWeapon(a, slot); }
  assert.equal(profiles.gunLevel(a.token, 'm44'), 5);
  assert.equal(profiles.gunLevel(a.token, 'p9'), 2);
  assert.equal(profiles.gunLevel(a.token, 'talon'), 0);
  room.close();
});

test('6 and 7. a restart puts every gun back to 0 and leaves everything else alone', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-restart-'));
  const before = await store(dir);
  const token = ProfileStore.newToken();
  before.credit(token, 777, 'test', 'seed');
  before.get(token).xp = 12345;
  before.get(token).finishes.push('ember');
  before.get(token).weapons.m44 = { kills: 42, headshots: 7 };
  before.awardGunXp(token, 'm44', xpFor(MAX_WEAPON_LEVEL));
  before.saveBuilds(token, { m44: { optic: 'dot', mag: 'extmag' } });
  before.scheduleSave(); before.flush();
  // Nothing about weapon levels is on disk to come back.
  const file = await readFile(path.join(dir, 'profiles.json'), 'utf8');
  assert.ok(!/gunXp/.test(file), 'weapon XP was written to disk');
  const after = await store(dir);
  for (const id of Object.keys(WEAPONS)) assert.equal(after.gunLevel(token, id), 0, `${id} kept its level through a restart`);
  assert.deepEqual(after.view(token).builds, {}, 'saved parts are still usable after a restart');
  const again = new Room({ name: 'gunlv-restart', queue: 'custom', profiles: after, onEmpty: () => {} });
  clearInterval(again.interval);
  const player = again.join(inbox(), { token, session: 's', name: 'Back' }, look);
  again.phase = 'live'; again.spawn(player, 0);
  assert.equal(again.currentWeapon(player), WEAPONS.m44, 'the gun came back with its parts on');
  again.close();
  // Everything else is exactly as it was.
  const profile = after.get(token);
  assert.equal(after.coins(token), before.coins(token));
  assert.equal(profile.xp, 12345);
  assert.ok(profile.finishes.includes('ember'));
  assert.deepEqual(profile.weapons.m44, { kills: 42, headshots: 7 }, 'the mastery record was touched');
  assert.equal(profile.builds.m44.optic, 'dot', 'the saved build itself was deleted: it should wait for the levels to come back');
  // Earn the level again and the saved build is there waiting.
  after.awardGunXp(token, 'm44', xpFor(MAX_WEAPON_LEVEL));
  assert.equal(after.view(token).builds.m44.mag, 'extmag');
});

test('8. two pilots on the same gun level on their own', async () => {
  const profiles = await store();
  const { room, a, b } = await match(profiles);
  for (let i = 0; i < 3; i += 1) killWith(room, a, b, 'm44');
  killWith(room, b, a, 'm44');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill * 3);
  assert.equal(profiles.gunXpOf(b.token, 'm44'), WEAPON_XP.kill);
  room.close();
});

test('XP comes only from real kills and assists, and nothing else pays', async () => {
  const profiles = await store();
  const { room, a, b } = await match(profiles);
  const mate = room.join(inbox(), { token: ProfileStore.newToken(), session: 'm', name: 'Mate' }, look);
  mate.team = 'A'; room.spawn(mate, 0);
  // Nothing a client can send is an XP event.
  for (const message of [{ type: 'gun-xp', weapon: 'm44', xp: 99999 }, { type: 'gun-xp', level: 20 }, { type: 'xp', amount: 1e9 }]) room.handle(a, message);
  assert.equal(profiles.gunXpOf(a.token, 'm44'), 0, 'a message levelled a gun');
  // An assist pays the gun the damage was done with, once.
  room.spawn(b, 0);
  hit(room, b, mate, 60, 'p9');
  hit(room, b, a, 999, 'm44');
  assert.equal(profiles.gunXpOf(mate.token, 'p9'), WEAPON_XP.assist, 'the assist did not pay the gun that did the damage');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill);
  // A dead pilot cannot be killed again for more.
  hit(room, b, a, 999, 'm44');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill, 'one death paid twice');
  // A team mate pays nothing, a bot pays less, and the practice range pays nothing at all.
  room.rules.friendlyFire = true;
  hit(room, mate, a, 999, 'm44');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill, 'a team kill paid');
  const bot = room.addBot('B');
  room.spawn(bot, 0);
  hit(room, bot, a, 999, 'm44');
  assert.equal(profiles.gunXpOf(a.token, 'm44'), WEAPON_XP.kill + WEAPON_XP.botKill);
  room.close();
  const range = new Room({ name: 'gunlv-range', queue: 'range', profiles, onEmpty: () => {} });
  clearInterval(range.interval);
  const shooter = range.join(inbox(), { token: ProfileStore.newToken(), session: 'r', name: 'Range' }, look);
  const dummy = [...range.players.values()].find((p) => p.dummy);
  range.applyDamage(dummy, shooter, 999, 'head', WEAPONS.m44);
  assert.equal(profiles.gunXpOf(shooter.token, 'm44'), 0, 'the range paid weapon XP');
  range.close();
});

test('the top level is a ceiling, and XP past a level carries into the next', () => {
  assert.equal(weaponLevel(XP_CURVE[MAX_WEAPON_LEVEL - 1] * 10), MAX_WEAPON_LEVEL);
  assert.deepEqual(weaponProgress(1e12), { level: MAX_WEAPON_LEVEL, xp: XP_CURVE[MAX_WEAPON_LEVEL - 1], into: 0, needed: 0, max: true });
  const spill = weaponProgress(XP_CURVE[0] + 30);
  assert.equal(spill.level, 1);
  assert.equal(spill.into, 30);
  for (const bad of [NaN, -5, Infinity, '9000', null]) assert.equal(weaponLevel(bad), 0, `${bad} made a level`);
});

// The Gunsmith draws from what the server says, and asks the same rule before offering a part.
test('the Gunsmith shows the gun\'s own level and locks what it has not earned', async () => {
  const { readFileSync } = await import('node:fs');
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  assert.match(shop, /weaponProgress\(game\.profile\.gunXp\?\.\[weaponId\] \|\| 0\)/, 'the header does not read the gun\'s level');
  assert.match(shop, /partUnlocked\(weaponId, part\.id, level\)/, 'a part card does not ask whether it is unlocked');
  assert.match(shop, /net\.on\('gun-xp'/, 'the page never hears about XP');
  const main = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  assert.match(main, /net\.on\('gun-xp'/, 'no level-up notice in a match');
  for (const slot of SLOTS) void slot;
});
