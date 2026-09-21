// Bot gunplay: the pellet pattern a shotgun is supposed to throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };

async function botRoom() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-bots-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const room = new Room({ name: `bots-${Math.random().toString(36).slice(2, 6)}`, queue: 'bots', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  room.phase = 'live';
  return { room, profiles };
}
// Watches the room broadcast so the pellet traces can be read back.
function watcher(room) {
  const seat = { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
  room.join(seat, { token: ProfileStore.newToken(), session: 'w', name: 'Watcher' }, look);
  return seat;
}
function armed(room, id) {
  const bot = room.addBot('B', 'veteran');
  room.spawn(bot);
  bot.nextFire = 0; bot.equipUntil = 0; bot.reloadEnd = 0;
  bot.weapons.primary = id;
  bot.active = 'primary';
  bot.ammo.primary = { mag: 5, reserve: 10 };
  bot.alive = true;
  return bot;
}

// A shotgun's spread is its pattern, not an accuracy penalty. Bots used to fire at angle 0, which put
// every pellet on the same spot: 9 x 14 damage at any range, so a bot Breaker one-shot across the map.
test('a bot shotgun throws a pattern, not a slug', async () => {
  const { room } = await botRoom();
  const seat = watcher(room);
  const bot = armed(room, 'breaker');

  seat.sent.length = 0;
  room.fire(bot, [bot.x, bot.y + 1.6, bot.z], [0, 1, 0], null, 1);
  const shot = seat.sent.find((message) => message.type === 'shot');
  assert.ok(shot, 'the shot went out');
  assert.equal(shot.e.length, 9, 'nine pellets were traced');

  const unique = new Set(shot.e.map((end) => end.join(',')));
  assert.ok(unique.size > 1, `every pellet landed on the same spot: ${[...unique][0]}`);
  assert.ok(unique.size >= 7, `the pattern is too tight, only ${unique.size} of 9 pellets differ`);
});

test('a bot rifle still fires straight, so only the pattern changed', async () => {
  const { room } = await botRoom();
  const seat = watcher(room);
  const bot = armed(room, 'm44');

  seat.sent.length = 0;
  room.fire(bot, [bot.x, bot.y + 1.6, bot.z], [0, 1, 0], null, 1);
  const shot = seat.sent.find((message) => message.type === 'shot');
  assert.equal(shot.e.length, 1, 'one bullet, one trace');
});
