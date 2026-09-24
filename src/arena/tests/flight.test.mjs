// Nobody flies: holding jump only hops, and the server checks how high a pilot climbs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { BODY } from '../shared/constants.js';
import { hasFooting } from '../shared/physics.js';
import { performance } from 'node:perf_hooks';

// Movement is checked against time, so the clock moves a frame between messages the way a real one does.
let clock = performance.now();
performance.now = () => clock;

test('the coyote grace is spent once, so a held jump cannot renew itself', () => {
  const grace = BODY.coyoteTime;
  // Walk off an edge at t = 0 and the jump is still owed a moment later.
  assert.equal(hasFooting(false, false, 0, grace * 0.5), true);
  assert.equal(hasFooting(false, false, 0, grace + 0.01), false);
  // Once that jump is taken it is gone, however soon the key is read again.
  assert.equal(hasFooting(false, true, 0, grace * 0.5), false);
  assert.equal(hasFooting(false, true, grace * 0.5, grace * 0.5), false);
  // Ground always counts, and stepping up a kerb (airborne, rising) still jumps.
  assert.equal(hasFooting(true, true, -1, 9), true);
  assert.equal(hasFooting(false, false, -1, 9), false, 'never left the ground, so there is nothing owed');
});

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
function fakeSocket() { return { readyState: 1, send: () => {} }; }
async function setup() {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-fly-')), 'profiles.json'));
  const room = new Room({ name: `fly-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 'f1', name: 'Pilot' }, look);
  room.phase = 'live';
  room.spawn(player);
  return { room, player };
}
// One state message, a frame apart, saying the pilot is at this height.
const move = (room, player, y) => { clock += 1000 / 30; room.onState(player, { e: player.epoch, x: player.x, y, z: player.z, yaw: 0, pitch: 0, f: 0 }); return player.y; };

test('the server takes a jump and refuses a climb', async () => {
  const { room, player } = await setup();
  const floor = player.y;
  assert.equal(move(room, player, floor + 1), floor + 1, 'a jump was rejected');
  for (let i = 2; i < 30; i += 1) move(room, player, floor + i);
  assert.ok(player.y < floor + room.hopHeight(), `climbed ${(player.y - floor).toFixed(1)} m off the floor`);
  room.close();
});

test('height has to be fallen for: drop first, then you may climb back', async () => {
  const { room, player } = await setup();
  const floor = player.y;
  room.spawn(player, 0, { x: player.x, y: floor + 8, z: player.z });
  for (let i = 1; i <= 20; i += 1) move(room, player, Math.max(floor, floor + 8 - i * 0.5));
  assert.equal(player.y, floor, 'the fall was rejected');
  assert.equal(move(room, player, floor + 1), floor + 1, 'a jump from where you landed was rejected');
  for (let i = 2; i < 20; i += 1) move(room, player, floor + i);
  assert.ok(player.y < floor + room.hopHeight(), 'climbed back up to where the fall started');
  room.close();
});

test('the fly tool still lets a developer climb', async () => {
  const { room, player } = await setup();
  player.dev = true;
  room.handle(player, { type: 'dev', tool: 'fly', on: true });
  const floor = player.y;
  for (let i = 1; i < 30; i += 1) move(room, player, floor + i);
  assert.ok(player.y > floor + 10, `the dev only reached ${player.y - floor} m`);
  room.close();
});
