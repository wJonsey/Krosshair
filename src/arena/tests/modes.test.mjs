// Fixed team sizes (1v1, 2v2, 3v3) and the bot personalities that fill them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { BOT_TYPES, RANKED_IDS, RANKED_MODES, TEAM_MODES, TEAM_MODE_IDS, WEAPONS, isRanked, teamSizeOf } from '../shared/constants.js';
import { MAP_IDS, getMap } from '../shared/map.js';
import { World } from '../shared/physics.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const fakeSocket = () => ({ readyState: 1, send: () => {} });
async function makeRoom(queue) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-modes-')), 'profiles.json'));
  const room = new Room({ name: `${queue}-${Math.random()}`, queue, isPublic: true, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  return room;
}

test('1v1, 2v2 and 3v3 fill to their size and take no more', async () => {
  for (const id of TEAM_MODE_IDS) {
    const size = TEAM_MODES[id].size;
    assert.equal(teamSizeOf(id), size);
    const room = await makeRoom(id);
    assert.equal(room.capacity, size * 2);
    const seats = [];
    for (let i = 0; i < size * 2; i += 1) {
      const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: `s${i}`, name: `P${i}` }, look);
      assert.ok(player, `${id} turned away pilot ${i + 1}`);
      seats.push(player);
    }
    assert.equal(room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 'extra', name: 'Extra' }, look), null, `${id} took one too many`);
    // Bots fill whatever a lobby is short of, and never more than the size.
    const solo = await makeRoom(id);
    solo.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'Solo' }, look);
    solo.fillBots();
    assert.equal(solo.team('A').length, size, `${id} team A`);
    assert.equal(solo.team('B').length, size, `${id} team B`);
    assert.equal([...solo.players.values()].filter((p) => p.bot).length, size * 2 - 1);
    room.close(); solo.close();
  }
});

test('a normal casual room is still a full room', async () => {
  const room = await makeRoom('casual');
  assert.equal(room.teamSize, 0);
  assert.ok(room.capacity > 6);
  room.close();
});

test('every bot has a personality, they are mixed, and it bends how they play', async () => {
  const room = await makeRoom('casual');
  const seen = new Map();
  for (let i = 0; i < 60; i += 1) {
    const bot = room.addBot(i % 2 ? 'A' : 'B');
    if (!bot) break;
    assert.ok(BOT_TYPES[bot.botType], `bot had no type: ${bot.botType}`);
    seen.set(bot.botType, (seen.get(bot.botType) || 0) + 1);
    const wanted = BOT_TYPES[bot.botType].traits;
    for (const [key, value] of Object.entries(wanted)) assert.equal(bot.traits[key], value, `${bot.botType} lost its ${key}`);
    room.removePlayer(bot);
  }
  assert.ok(seen.size >= 3, `only ${seen.size} personalities in 60 bots`);
  room.close();
});

test('personalities buy the guns they should', async () => {
  const room = await makeRoom('casual');
  const counts = { sniper: 0, rusher: 0 };
  for (const type of ['sniper', 'rusher']) {
    for (let i = 0; i < 40; i += 1) {
      const bot = room.addBot('A');
      bot.botType = type;
      bot.traits = { ...bot.traits, ...BOT_TYPES[type].traits };
      bot.credits = 9000;
      room.phase = 'buy';
      bot.alive = true;
      room.buy(bot, 'm44');
      const before = bot.weapons.primary;
      void before;
      const { botBuy } = await import('../server/bots.js');
      botBuy(room, bot);
      const picked = WEAPONS[bot.weapons.primary];
      if (picked && BOT_TYPES[type].guns.some(([id]) => id === bot.weapons.primary)) counts[type] += 1;
      room.removePlayer(bot);
    }
  }
  // Not every roll buys (they keep money back), but most picks come from the type's own list.
  assert.ok(counts.sniper >= 20, `snipers picked their own guns ${counts.sniper} times in 40`);
  assert.ok(counts.rusher >= 20, `rushers picked their own guns ${counts.rusher} times in 40`);
  room.close();
});

test('ranked runs 1v1, 2v2, 3v3 and 5v5, each queueing on its own', async () => {
  assert.deepEqual(RANKED_IDS, ['ranked-1v1', 'ranked-2v2', 'ranked-3v3', 'ranked-5v5']);
  for (const id of RANKED_IDS) {
    assert.ok(isRanked(id), `${id} does not count as ranked`);
    const size = RANKED_MODES[id].size;
    assert.equal(teamSizeOf(id), size);
    const room = await makeRoom(id);
    assert.equal(room.capacity, size * 2);
    room.close();
  }
  // The old open queue still works, and nothing else is ranked.
  assert.ok(isRanked('ranked'));
  for (const id of ['casual', 'arcade', 'custom', '3v3', 'royale']) assert.ok(!isRanked(id), `${id} should not be ranked`);
});

test('a 5v5 seats everyone, and nobody spawns inside a team mate', async () => {
  const room = await makeRoom('5v5');
  const seats = [];
  for (let i = 0; i < 10; i += 1) seats.push(room.join(fakeSocket(), { token: ProfileStore.newToken(), session: `r${i}`, name: `P${i}` }, look));
  assert.ok(seats.every(Boolean), 'a 5v5 turned someone away');
  for (const map of MAP_IDS) {
    room.map = getMap(map);
    room.world = new World(room.map.boxes);
    for (const team of ['A', 'B']) {
      const spots = room.team(team).map((player, index) => room.spawnPoint(player, index));
      assert.equal(spots.length, 5);
      for (let i = 0; i < spots.length; i += 1) for (let j = i + 1; j < spots.length; j += 1) {
        const gap = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
        assert.ok(gap > 0.7, `${map} ${team}: two pilots spawn ${gap.toFixed(2)} m apart`);
      }
    }
  }
  room.close();
});
