// Map rotation, voting and per-arena match start, driven against a real Room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, getMap } from '../shared/map.js';
import { Room } from '../server/room.js';
import { inSpawnZone } from '../server/mapflow.js';

const profiles = { get: () => ({ xp: 0, rating: 1000 }), view: () => ({ level: 1, rating: 1000 }), recordMatch: () => ({}) };
function fakeSocket() { const sent = []; return { readyState: 1, sent, send: (raw) => sent.push(JSON.parse(raw)) }; }
function makeRoom(queue = 'custom') {
  const room = new Room({ name: `t-${Math.random()}`, queue, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  return room;
}
const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };

test('custom rooms default to a vote, matchmade rooms to random', () => {
  const custom = makeRoom('custom'), casual = makeRoom('casual');
  assert.equal(custom.rules.map, 'vote');
  assert.equal(casual.rules.map, 'random');
  custom.close(); casual.close();
});

test('host can pin a map, and the match starts on it with pilots inside their spawn zone', () => {
  for (const id of MAP_IDS) {
    const room = makeRoom();
    const socket = fakeSocket();
    const host = room.join(socket, { token: 'tok-host-1234567890', session: 's1', name: 'Host' }, look);
    room.addBot('B');
    room.handle(host, { type: 'rules', rules: { map: id } });
    assert.equal(room.rules.map, id);
    room.handle(host, { type: 'start' });
    assert.equal(room.phase, 'buy');
    assert.equal(room.map.id, id);
    assert.ok(getMap(id).env.variants.includes(room.variant), `${room.variant} is not a ${id} condition`);
    const start = socket.sent.find((m) => m.type === 'match-start');
    assert.equal(start.map, id);
    for (const player of room.players.values()) assert.ok(inSpawnZone(room, player, player.x, player.z), `${player.name} spawned outside the zone on ${id}`);
    // Leaving the spawn zone during the buy phase is rejected.
    const before = { x: host.x, z: host.z };
    room.handle(host, { type: 'state', e: host.epoch, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: 4 });
    assert.deepEqual({ x: host.x, z: host.z }, before);
    room.close();
  }
});

test('a vote offers three arenas, counts ballots and starts the winner early once everyone has voted', () => {
  const room = makeRoom();
  const a = fakeSocket(), b = fakeSocket();
  const host = room.join(a, { token: 'tok-host-1234567890', session: 's1', name: 'Host' }, look);
  const guest = room.join(b, { token: 'tok-guest-123456789', session: 's2', name: 'Guest' }, look);
  room.handle(host, { type: 'start' });
  assert.equal(room.phase, 'mapvote');
  assert.equal(room.mapChoices.length, 3);
  assert.equal(new Set(room.mapChoices).size, 3);
  const pick = room.mapChoices[1];
  room.handle(host, { type: 'map-vote', id: pick });
  room.handle(guest, { type: 'map-vote', id: 'not-a-map' });
  assert.equal(room.mapVotes.size, 1, 'invalid ballots are ignored');
  room.handle(guest, { type: 'map-vote', id: pick });
  assert.equal(room.roomState().mapTally[pick], 2);
  room.time = 0; room.lastTick = 0;
  room.voteSettleAt = 1; // pretend the short settle delay has passed
  room.tick();
  assert.equal(room.map.id, pick);
  assert.equal(room.phase, 'buy');
  assert.ok(a.sent.some((m) => m.type === 'map-chosen' && m.map === pick));
  room.close();
});

test('random rotation never repeats the arena it just played', () => {
  const room = makeRoom('casual');
  const socket = fakeSocket();
  room.join(socket, { token: 'tok-host-1234567890', session: 's1', name: 'Solo' }, look);
  room.autoStartAt = 1; room.tick();
  assert.equal(room.phase, 'buy');
  for (let i = 0; i < 6; i += 1) {
    const previous = room.map.id;
    room.phase = 'matchEnd'; room.rematch.add([...room.players.values()].find((p) => !p.bot).id); room.rematchAt = 1; room.tick();
    assert.equal(room.phase, 'buy');
    assert.notEqual(room.map.id, previous);
  }
  room.close();
});
