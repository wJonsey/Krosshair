// One profile, one seat. Two tabs on the same account must not end up on opposite teams farming
// each other, and the fix must not cost anyone a genuine reconnect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const socket = () => ({ readyState: 1, send: () => {} });

async function duel(queue = '1v1') {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-seats-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const room = new Room({ name: `duel-${Math.random().toString(36).slice(2, 6)}`, queue, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  return { room, profiles };
}

test('a second tab on the same account is turned away', async () => {
  const { room } = await duel();
  const token = ProfileStore.newToken();
  const first = room.join(socket(), { token, session: 'tab-A', name: 'Smurf' }, look);
  const second = room.join(socket(), { token, session: 'tab-B', name: 'Smurf' }, look);
  assert.ok(first, 'the first tab gets a seat');
  assert.equal(second, null, 'the second tab does not');
  assert.equal(room.players.size, 1, 'one profile, one seat');
});

test('two different pilots still both get in', async () => {
  const { room } = await duel();
  const one = room.join(socket(), { token: ProfileStore.newToken(), session: 'a', name: 'Vex' }, look);
  const two = room.join(socket(), { token: ProfileStore.newToken(), session: 'b', name: 'Nova' }, look);
  assert.ok(one && two, 'two real people are not affected');
  assert.notEqual(one.team, two.team);
  assert.equal(room.players.size, 2);
});

test('guests on one machine are left alone: their tokens differ and they earn nothing', async () => {
  const { room } = await duel();
  // A guest token is minted per tab, so two guest tabs are genuinely two tokens.
  const one = room.join(socket(), { token: ProfileStore.newToken(), session: 'g1', name: 'Guest1' }, look);
  const two = room.join(socket(), { token: ProfileStore.newToken(), session: 'g2', name: 'Guest2' }, look);
  assert.ok(one && two, 'a shared computer is not punished');
});

test('the same tab reconnecting takes its seat back', async () => {
  const { room } = await duel();
  const token = ProfileStore.newToken();
  const player = room.join(socket(), { token, session: 'tab-A', name: 'Vex' }, look);
  player.connected = false; // the tab dropped
  const back = room.join(socket(), { token, session: 'tab-A', name: 'Vex' }, look);
  assert.equal(back, player, 'the held seat comes back');
  assert.ok(back.connected);
  assert.equal(room.players.size, 1, 'no second seat was made');
});

test('coming back in a new tab takes the held seat over, it does not open a second', async () => {
  const { room } = await duel();
  const token = ProfileStore.newToken();
  const player = room.join(socket(), { token, session: 'tab-A', name: 'Vex' }, look);
  player.connected = false;
  const back = room.join(socket(), { token, session: 'tab-B', name: 'Vex' }, look);
  assert.equal(back, player, 'the same profile reclaims its seat from a new tab');
  assert.equal(back.session, 'tab-B', 'the seat follows the tab that is actually open');
  assert.equal(room.players.size, 1);
});

test('a held seat is not handed to somebody else', async () => {
  const { room } = await duel();
  const mine = room.join(socket(), { token: ProfileStore.newToken(), session: 'tab-A', name: 'Vex' }, look);
  mine.connected = false;
  const stranger = room.join(socket(), { token: ProfileStore.newToken(), session: 'tab-Z', name: 'Nova' }, look);
  assert.notEqual(stranger, mine, 'a different profile gets its own seat');
  assert.equal(room.players.size, 2);
  assert.equal(mine.connected, false, 'the held seat is still held');
});

test('the seat is freed once the pilot really leaves', async () => {
  const { room } = await duel();
  const token = ProfileStore.newToken();
  const player = room.join(socket(), { token, session: 'tab-A', name: 'Vex' }, look);
  room.leave(player, true);
  const again = room.join(socket(), { token, session: 'tab-B', name: 'Vex' }, look);
  assert.ok(again, 'rejoining after leaving works');
  assert.equal(room.players.size, 1);
});
