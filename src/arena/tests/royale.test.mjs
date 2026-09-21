// Battle royale: a headless match on the island, driven tick by tick on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

let clock = performance.now();
performance.now = () => clock;
const { RoyaleRoom } = await import('../server/royale.js');
const { AIRDROP_LOOT, LOOT_TABLE, POWERS, ROYALE, ROYALE_LOADOUT } = await import('../shared/royale.js');
const { MAP_IDS } = await import('../shared/map.js');
const { WEAPONS } = await import('../shared/constants.js');

const profiles = { get: () => ({ xp: 0, rating: 1000, rankedMatches: 0 }), view: () => ({ level: 1, rating: 1000, rankedMatches: 0 }), recordMatch: () => ({}), coins: () => 0, sanitizeCosmetics: (type, list) => list };
const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
function fakeSocket() { const sent = []; return { readyState: 1, sent, send: (raw) => { const message = JSON.parse(raw); if (message.type !== 's') sent.push(message); } }; }
function makeRoom() {
  const room = new RoyaleRoom({ name: `royale-${Math.random()}`, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  return room;
}
const step = (room, seconds) => { for (let i = 0; i < seconds * 30 && room.phase === 'live'; i += 1) { clock += 1000 / 30; room.tick(); } };

test('the island never shows up in the map vote', () => {
  assert.ok(!MAP_IDS.includes('island'));
});

test('a royale starts free for all: everyone on their own team, pistol only, loot on the floor', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000001', session: 's1', name: 'Solo' }, look);
  assert.equal(room.phase, 'lobby');
  room.startMatch(); room.deploy();
  assert.equal(room.phase, 'live');
  assert.equal(room.players.size, ROYALE.fill);
  const teams = new Set([...room.players.values()].map((p) => p.team));
  assert.equal(teams.size, room.players.size);
  assert.equal(me.weapons.primary, null);
  assert.equal(me.weapons.sidearm, ROYALE_LOADOUT.sidearm);
  assert.ok(room.loot.size > 100, `only ${room.loot.size} items on the floor`);
  assert.ok(socket.sent.some((m) => m.type === 'loot' && m.loot.length === room.loot.size));
  assert.ok(socket.sent.some((m) => m.type === 'royale' && m.storm));
  room.close();
});

test('a pilot picks up what they choose: look, press, and the old gun is left behind', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000002', session: 's1', name: 'Looter' }, look);
  room.startMatch(); room.deploy();
  assert.equal(me.active, 'melee');
  assert.ok(me.y > 150, 'pilots start in the sky');
  me.y = 0;
  const gun = room.addLoot(me.x, me.y, me.z, { kind: 'weapon', id: 'recon' });
  step(room, 0.5);
  assert.equal(me.weapons.primary, null, 'walking over a gun does nothing');
  room.handle(me, { type: 'royale-take', id: gun.id });
  assert.equal(me.weapons.primary, 'recon');
  assert.equal(me.active, 'primary');
  assert.ok(!room.loot.has(gun.id));
  assert.ok(socket.sent.some((m) => m.type === 'loot-take' && m.id === gun.id));
  assert.ok(socket.sent.some((m) => m.type === 'pickup'));
  const better = room.addLoot(me.x, me.y, me.z, { kind: 'weapon', id: 'm44' });
  room.handle(me, { type: 'royale-take', id: better.id });
  assert.equal(me.weapons.primary, 'm44');
  assert.ok([...room.loot.values()].some((l) => l.item.id === 'recon' && l.dropper === me.id), 'the old gun is on the floor');
  const far = room.addLoot(me.x + 30, me.y, me.z, { kind: 'helmet' });
  room.handle(me, { type: 'royale-take', id: far.id });
  assert.ok(!me.helmet, 'out of reach');
  room.close();
});

test('the storm hurts pilots outside the circle and can kill them', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000003', session: 's1', name: 'Stormed' }, look);
  room.startMatch(); room.deploy();
  // Close the circle to nothing, far from the pilot.
  Object.assign(room.storm, { from: { x: 250, z: 250, r: 1 }, to: { x: 250, z: 250, r: 1 }, shrinkStart: 0, shrinkEnd: 0, damage: 40, nextAt: Infinity });
  me.x = -200; me.z = -200;
  const hp = me.hp;
  step(room, 1);
  assert.ok(me.hp < hp || !me.alive);
  step(room, 5);
  assert.equal(me.alive, false);
  assert.ok(socket.sent.some((m) => m.type === 'kill' && m.reason === 'storm'));
  room.close();
});

test('a full match of bots ends with one winner and a placement for everyone', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000004', session: 's1', name: 'Watcher' }, look);
  room.startMatch(); room.deploy();
  me.alive = false;   // sit out so the bots play it through
  step(room, 900);
  assert.notEqual(room.phase, 'live', 'the match never ended');
  const end = socket.sent.find((m) => m.type === 'match-end');
  assert.ok(end?.royale);
  assert.equal(end.table.length, room.players.size);
  assert.equal(end.table[0].placement, 1);
  room.close();
});

test('the drop: pilots land where they pointed, bots pick a place, then the match goes live', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000009', session: 's9', name: 'Dropper' }, look);
  room.startMatch();
  assert.equal(room.phase, 'drop');
  assert.ok(!me.alive);
  room.handle(me, { type: 'royale-drop', x: 100, z: -120 });
  clock += (ROYALE.dropTime + 1) * 1000;
  room.tick();
  assert.equal(room.phase, 'live');
  assert.ok(me.alive);
  assert.ok(Math.hypot(me.x - 100, me.z + 120) < 100, `dropped ${Math.round(Math.hypot(me.x - 100, me.z + 120))} m from the mark`);
  assert.ok(me.y > 150);
  room.close?.();
});

test('bots gear up and airdrops land', () => {
  const room = makeRoom();
  room.join(fakeSocket(), { token: 'tok-royale-000000010', session: 's10', name: 'Watcher' }, look);
  room.startMatch(); room.deploy();
  // The first seconds are spent under a parachute, and everyone lands with a blade only.
  step(room, 100);
  const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
  const armed = bots.filter((p) => p.weapons.primary || p.weapons.sidearm).length;
  assert.ok(armed >= bots.length * 0.5, `only ${armed} of ${bots.length} bots found a gun in 100 s`);
  room.callAirdrop(clock / 1000);
  const before = room.loot.size;
  assert.equal(room.airdrops.length, 1);
  step(room, ROYALE.airdropFall + 1);
  assert.equal(room.airdrops.length, 0);
  assert.ok(room.loot.size > before - 40);
  room.close?.();
});

test('every pickup on the island is a real thing, and Adrenaline is gone', () => {
  // A power with no entry showed as "?" on the floor and threw on pickup, so the pools are checked
  // against what actually exists rather than trusted.
  for (const entry of [...LOOT_TABLE, ...AIRDROP_LOOT]) {
    for (const id of entry.pool || []) {
      if (entry.kind === 'power') assert.ok(POWERS[id], `the loot table drops a power called ${id}, which does not exist`);
      if (entry.kind === 'weapon') assert.ok(WEAPONS[id], `the loot table drops a weapon called ${id}, which does not exist`);
    }
  }
  assert.ok(!POWERS.speed, 'the speed boost is back on the island');
  assert.ok(Object.keys(POWERS).length > 0, 'there are no powers left at all');
});
