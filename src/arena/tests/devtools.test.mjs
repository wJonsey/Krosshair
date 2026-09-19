// Dev tools: the developers' accounts only, checked on the server, and never a bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { WEAPONS, COSMETICS } from '../shared/constants.js';
import { DEV_SERVER_TOOLS, DEV_TOOLS } from '../shared/devtools.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
function fakeSocket() { const sent = []; return { readyState: 1, sent, send: (raw) => { const message = JSON.parse(raw); if (message.type !== 's') sent.push(message); } }; }
async function store() { return new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-dev-')), 'profiles.json')); }
async function setup() {
  const profiles = await store();
  const room = new Room({ name: `dev-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const devToken = ProfileStore.newToken(), pilotToken = ProfileStore.newToken();
  profiles.setDev(devToken, true);
  const devSocket = fakeSocket(), pilotSocket = fakeSocket();
  const dev = room.join(devSocket, { token: devToken, session: 'd1', name: 'Dev' }, look);
  const pilot = room.join(pilotSocket, { token: pilotToken, session: 'p1', name: 'Pilot' }, look);
  pilot.team = 'B';
  return { room, dev, pilot, devSocket, pilotSocket };
}

test('only a developer account can switch a dev tool on', async () => {
  const { room, dev, pilot } = await setup();
  assert.equal(dev.dev, true);
  assert.equal(pilot.dev, false);
  for (const tool of DEV_SERVER_TOOLS) {
    room.handle(pilot, { type: 'dev', tool, on: true });
    assert.equal(pilot.devTools[tool], undefined, `a pilot turned on ${tool}`);
    room.handle(dev, { type: 'dev', tool, on: true });
    assert.equal(dev.devTools[tool], true, `the dev could not turn on ${tool}`);
  }
  room.handle(dev, { type: 'dev', tool: 'fly', on: false });
  assert.equal(dev.devTools.fly, undefined);
  // Nothing outside the list, however it is spelled.
  room.handle(dev, { type: 'dev', tool: 'constructor', on: true });
  room.handle(dev, { type: 'dev', tool: '__proto__', on: true });
  assert.ok(!Object.hasOwn(dev.devTools, 'constructor') && !Object.hasOwn(dev.devTools, '__proto__'));
  room.close();
});

test('bots never hold a dev tool and never wear dev gear', async () => {
  const { room, dev } = await setup();
  const bot = room.addBot('B');
  assert.equal(bot.dev, false);
  room.handle(bot, { type: 'dev', tool: 'god', on: true });
  assert.deepEqual(bot.devTools, {});
  // Even if something inside the room set one, the next toggle wipes it.
  bot.devTools.god = true;
  room.handle(bot, { type: 'dev', tool: 'fly', on: true });
  assert.deepEqual(bot.devTools, {});
  const devIds = new Set(Object.entries(COSMETICS).flatMap(([kind, items]) => items.filter((item) => item.dev).map((item) => `${kind}:${item.id}`)));
  for (let i = 0; i < 40; i += 1) {
    const extra = room.addBot(i % 2 ? 'A' : 'B') || bot;
    for (const kind of ['headgear', 'face', 'pack', 'suit', 'visor']) {
      const worn = kind === 'suit' ? extra.color : kind === 'visor' ? extra.accent : extra[kind];
      assert.ok(!devIds.has(`${kind}:${worn}`), `a bot wore ${kind}:${worn}`);
    }
  }
  void dev;
  room.close();
});

test('god mode, invisibility and infinite ammo do what they say', async () => {
  const { room, dev, pilot, pilotSocket } = await setup();
  room.phase = 'live';
  dev.alive = true; pilot.alive = true;
  dev.hp = 100; pilot.hp = 100;
  // God mode
  room.handle(dev, { type: 'dev', tool: 'god', on: true });
  room.applyDamage(dev, pilot, 80, 'torso', WEAPONS.m44, {});
  assert.equal(dev.hp, 100);
  assert.ok(pilotSocket.sent.some((m) => m.type === 'hit' && m.blocked));
  room.handle(dev, { type: 'dev', tool: 'god', on: false });
  room.applyDamage(dev, pilot, 30, 'torso', WEAPONS.m44, {});
  assert.ok(dev.hp < 100);
  // Invisible: out of the snapshot, and out of every enemy search (which is what the bots use).
  assert.ok(room.enemiesOf(pilot).some((p) => p.id === dev.id));
  room.handle(dev, { type: 'dev', tool: 'ghost', on: true });
  assert.ok(!room.enemiesOf(pilot).some((p) => p.id === dev.id));
  pilotSocket.sent.length = 0;
  room.snapshot(1);
  const snap = pilotSocket.sent.find((m) => m.type === 's');
  assert.ok(!snap || !snap.p.some((row) => row[0] === dev.id), 'an invisible dev was in the snapshot');
  // Infinite ammo
  dev.ammo.primary = { mag: 5, reserve: 10 };
  dev.weapons.primary = 'm44'; dev.active = 'primary';
  room.handle(dev, { type: 'dev', tool: 'ammo', on: true });
  room.fire(dev, [dev.x, dev.y + 1.6, dev.z], [0, 0, 1], null, 1);
  assert.equal(dev.ammo.primary.mag, 5, 'a round left the magazine');
  room.close();
});

test('a pilot who stops being a dev loses the tools on the next join', async () => {
  const profiles = await store();
  const room = new Room({ name: `dev-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const token = ProfileStore.newToken();
  profiles.setDev(token, true);
  const first = room.join(fakeSocket(), { token, session: 's1', name: 'Dev' }, look);
  assert.equal(first.dev, true);
  room.removePlayer(first);
  profiles.setDev(token, false);
  const again = room.join(fakeSocket(), { token, session: 's2', name: 'Dev' }, look);
  assert.equal(again.dev, false);
  room.handle(again, { type: 'dev', tool: 'fly', on: true });
  assert.deepEqual(again.devTools, {});
  room.close();
});

test('every dev tool in the list has a name and a description', () => {
  for (const tool of DEV_TOOLS) { assert.ok(tool.id && tool.name && tool.desc); }
  assert.ok(DEV_SERVER_TOOLS.includes('fly') && DEV_SERVER_TOOLS.includes('god'));
  assert.ok(!DEV_SERVER_TOOLS.includes('esp'), 'ESP is drawn on the client, the server cannot hold it');
});
