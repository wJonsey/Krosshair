// The modes that change the rules: Snipers Only, Close Quarters, One in the Chamber and Gun Game,
// plus killstreaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { CHAMBER, GUN_LADDER, KILLSTREAKS, MODIFIERS, WEAPONS, dailyModifier, streakAt } from '../shared/constants.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
function fakeSocket() { const sent = []; return { readyState: 1, sent, send: (raw) => { const message = JSON.parse(raw); if (message.type !== 's') sent.push(message); } }; }
async function room(modifier) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-mods-')), 'profiles.json'));
  const made = new Room({ name: `mod-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(made.interval);
  made.rules.modifier = modifier;
  const a = made.join(fakeSocket(), { token: ProfileStore.newToken(), session: 'a', name: 'A' }, look);
  const b = made.join(fakeSocket(), { token: ProfileStore.newToken(), session: 'b', name: 'B' }, look);
  b.team = 'B';
  return { room: made, a, b };
}

test('every mode has a name and a description, and the arcade can roll each one', () => {
  for (const [id, mod] of Object.entries(MODIFIERS)) assert.ok(mod.name && mod.desc, `${id} is missing its words`);
  const rolled = new Set();
  for (let day = 1; day <= 400; day += 1) rolled.add(dailyModifier(`2026-01-${String(day).padStart(3, '0')}`));
  for (const id of ['snipers', 'closequarters', 'chamber', 'gungame']) assert.ok(MODIFIERS[id]);
  assert.ok(rolled.size >= 4, `the arcade only rolled ${rolled.size} modes`);
});

test('Snipers Only and Close Quarters only sell their own guns', async () => {
  for (const [modifier, allowed, blocked] of [['snipers', 'vesper', 'wasp'], ['closequarters', 'wasp', 'vesper']]) {
    const { room: made, a } = await room(modifier);
    made.phase = 'buy'; a.alive = true; a.credits = 9000;
    made.buy(a, blocked);
    assert.notEqual(a.weapons.primary, blocked, `${modifier} sold a ${WEAPONS[blocked].name}`);
    made.buy(a, allowed);
    assert.equal(a.weapons.primary, allowed, `${modifier} would not sell a ${WEAPONS[allowed].name}`);
    made.close();
  }
});

test('One in the Chamber: one round, a kill loads another, and any hit is lethal', async () => {
  const { room: made, a, b } = await room('chamber');
  made.startRound?.();
  made.fixedLoadout(a);
  assert.equal(a.weapons.primary, null);
  assert.equal(a.weapons.sidearm, CHAMBER.sidearm);
  assert.equal(a.ammo.sidearm.mag, CHAMBER.mag);
  assert.equal(a.ammo.sidearm.reserve, 0);
  // Nothing is for sale.
  made.phase = 'buy'; a.alive = true; a.credits = 9000;
  made.buy(a, 'm44');
  assert.equal(a.weapons.primary, null, 'a gun was sold in One in the Chamber');
  // A body shot kills, and the kill hands back a round.
  made.phase = 'live'; a.alive = true; b.alive = true; b.hp = 100; a.ammo.sidearm.mag = 0;
  made.applyDamage(b, a, 10, 'torso', WEAPONS[CHAMBER.sidearm], {});
  assert.equal(b.alive, false, 'a hit did not kill');
  assert.equal(a.ammo.sidearm.mag, 1, 'the kill did not load a round');
  made.close();
});

test('Gun Game: every kill moves you up the ladder, and finishing it takes the round', async () => {
  const { room: made, a, b } = await room('gungame');
  made.fixedLoadout(a);
  const first = WEAPONS[GUN_LADDER[0]];
  assert.equal(a.weapons[first.slot], first.id);
  made.phase = 'live'; a.alive = true;
  for (let step = 1; step < GUN_LADDER.length; step += 1) {
    // Each kill ends the round in a 1v1, so the test puts the round back on its feet.
    made.phase = 'live'; a.alive = true;
    b.alive = true; b.hp = 100;
    made.applyDamage(b, a, 999, 'torso', WEAPONS[a.weapons.primary || a.weapons.sidearm], {});
    assert.equal(a.gunLevel, step, `stuck on rung ${a.gunLevel}`);
    const gun = WEAPONS[GUN_LADDER[step]];
    assert.equal(a.weapons[gun.slot], gun.id, `rung ${step} did not hand over the ${gun.name}`);
  }
  // The last kill finishes the ladder and the round goes to that side.
  const scoreBefore = made.scores[a.team];
  b.alive = true; b.hp = 100;
  made.phase = 'live';
  made.applyDamage(b, a, 999, 'torso', WEAPONS[a.weapons.primary || a.weapons.sidearm], {});
  assert.ok(made.scores[a.team] > scoreBefore, 'finishing the ladder did not win the round');
  made.close();
});

test('killstreaks: they count up, pay out, and a death wipes them', async () => {
  const { room: made, a, b } = await room('standard');
  made.phase = 'live';
  a.alive = true;
  const socket = a.socket;
  const kill = () => { made.phase = 'live'; a.alive = true; b.alive = true; b.hp = 100; made.applyDamage(b, a, 999, 'torso', WEAPONS.m44, {}); };
  for (let i = 1; i <= 3; i += 1) kill();
  assert.equal(a.streak, 3);
  assert.equal(a.match.bestStreak, 3);
  const spotter = socket.sent.filter((m) => m.type === 'streak');
  assert.equal(spotter.length, 1, 'the 3 kill streak did not pay out');
  assert.equal(spotter[0].streak, streakAt(3).id);
  // Resupply tops the magazines and patches armour.
  a.armor = 0; a.ammo.primary = { mag: 0, reserve: 0 };
  for (let i = 4; i <= 5; i += 1) kill();
  assert.equal(a.streak, 5);
  assert.ok(a.armor >= 50, 'armour was not patched');
  assert.ok(a.ammo.primary.mag > 0, 'the magazines were not filled');
  // Dying puts you back to nothing.
  made.phase = 'live';
  made.kill(a, b, WEAPONS.m44, 'torso', {});
  assert.equal(a.streak, 0);
  assert.equal(a.match.bestStreak, 5, 'the best streak of the match is kept');
  assert.equal(KILLSTREAKS.filter((s) => s.at <= 10).length, KILLSTREAKS.length);
  made.close();
});
