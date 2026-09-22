// Developers watching someone else's match from the online card. The whole point of the seat is that
// it changes nothing: a tool that perturbs the match it is inspecting is worse than no tool, so these
// pin every count that decides how a match runs against a watcher being in the room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const fakeSocket = () => { const sent = []; return { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)), sent }; };
async function makeRoom(extra = {}) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-watch-')), 'profiles.json'));
  const room = new Room({ name: `watch-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {}, ...extra });
  clearInterval(room.interval);
  return { room, profiles };
}
const hello = (name) => ({ token: ProfileStore.newToken(), session: `s-${name}`, name });

test('a watcher is not a player in any count that runs a match', async () => {
  const { room } = await makeRoom();
  room.join(fakeSocket(), hello('A'), look);
  const humansBefore = room.humans().length;
  const seatsBefore = room.team('A').length + room.team('B').length;

  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  assert.ok(watcher, 'the watcher was seated');
  assert.equal(room.humans().length, humansBefore, 'a watcher counted as a human in the room');
  assert.equal(room.team('A').length + room.team('B').length, seatsBefore, 'a watcher took a seat on a team');
  assert.equal(room.team('watch').length, 0, 'and must not be found by asking for their own team either');
  assert.equal(watcher.alive, false, 'a watcher is never alive, so nothing can shoot them');
  room.close();
});

test('the match is never told a watcher is there', async () => {
  const { room } = await makeRoom();
  room.join(fakeSocket(), hello('A'), look);
  room.watch(fakeSocket(), hello('Dev'), look);
  const roster = room.roomState().players;
  assert.ok(!roster.some((entry) => entry.name === 'Dev'), 'the watcher was listed on the scoreboard');
  assert.equal(roster.length, 1, 'only the real player is in the roster');
  assert.equal(room.info().players, 1, 'and the room advertises one player, not two');
  room.close();
});

test('a watcher has no body in the world', async () => {
  const { room } = await makeRoom();
  const socket = fakeSocket();
  const player = room.join(socket, hello('A'), look);
  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  player.alive = true;
  socket.sent.length = 0;
  room.snapshot(1);
  // Positions go out as rows of [id, ...]; a watcher must not be one of them.
  const rows = socket.sent.filter((m) => m.type === 's').flatMap((m) => m.p).map((row) => row[0]);
  assert.ok(rows.includes(player.id), 'the living player should be in the snapshot, or this proves nothing');
  assert.ok(!rows.includes(watcher.id), 'a watcher had a body in the world, so it could be seen and shot');
  room.close();
});

test('nothing a watcher sends is acted on', async () => {
  const { room } = await makeRoom();
  room.join(fakeSocket(), hello('A'), look);
  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  watcher.credits = 9000;
  room.phase = 'buy';
  watcher.alive = true; // even if something else marked them alive, handle must refuse
  room.handle(watcher, { type: 'buy', item: 'talon' });
  assert.notEqual(watcher.weapons.primary, 'talon', 'a watcher bought a gun');
  room.handle(watcher, { type: 'team', team: 'B' });
  assert.equal(watcher.team, 'watch', 'a watcher joined a team');
  room.close();
});

test('a watcher is not paid, ranked or counted when the match ends', async () => {
  const { room } = await makeRoom();
  room.join(fakeSocket(), hello('A'), look);
  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  const before = { kills: watcher.match.kills, rating: watcher.rating };
  room.scores.A = 1; room.scores.B = 0;
  room.endMatch();
  assert.equal(watcher.match.kills, before.kills, 'a watcher picked up match stats');
  assert.equal(watcher.rating, before.rating, 'a watcher was rated for a match they did not play');
  room.close();
});

test('a watcher leaving is not an event in the match', async () => {
  const { room } = await makeRoom();
  const socket = fakeSocket();
  const player = room.join(socket, hello('A'), look);
  room.phase = 'live';
  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  socket.sent.length = 0;
  room.leave(watcher, false);
  assert.ok(!room.players.has(watcher.id), 'the watcher held a seat after leaving');
  assert.ok(!socket.sent.some((m) => m.type === 'feed'), `the match was told: ${JSON.stringify(socket.sent.filter((m) => m.type === 'feed'))}`);
  assert.ok(room.players.has(player.id), 'and the real player is untouched');
  room.close();
});

test('a watcher does not hold a seat a player wants', async () => {
  const { room } = await makeRoom({ queue: 'custom' });
  for (let i = 0; i < 3; i += 1) room.watch(fakeSocket(), hello(`Dev${i}`), look);
  const player = room.join(fakeSocket(), hello('A'), look);
  assert.ok(player, 'watchers filled the room so nobody could play');
  assert.equal(room.humans().length, 1);
  room.close();
});

test('you cannot watch a match you are playing in', async () => {
  const { room } = await makeRoom();
  const me = hello('A');
  room.join(fakeSocket(), me, look);
  assert.equal(room.watch(fakeSocket(), me, look), null, 'a player watched their own match and took a second seat');
  room.close();
});

// The card is developers only and so is the route behind it.
test('only a developer can ask to watch', () => {
  const server = readFileSync(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  const fn = server.slice(server.indexOf('function watchRoom'), server.indexOf('\n}', server.indexOf('function watchRoom')));
  assert.match(fn, /profiles\.get\(socket\.token\)\.dev/, 'the dev check is the first thing it does');
  assert.match(fn, /socket\.identified/, 'and it needs an identified socket');
  assert.match(fn, /room\.watch\(/, 'it seats them as a watcher, never through place()');
  assert.ok(!/place\(/.test(fn), 'place() would seat a developer as a player');
});

// startRound walks every player in the room, spawns them and counts them onto a team. A watcher has no
// team, so it would have been spawned at counters[undefined]++ and stood in the map as a live body.
test('a watcher is not dealt into a round', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), hello('A'), look);
  const watcher = room.watch(fakeSocket(), hello('Dev'), look);
  const rounds = watcher.match.roundsPlayed;
  room.startRound();
  assert.equal(watcher.alive, false, 'a watcher was spawned into the round');
  assert.equal(watcher.match.roundsPlayed, rounds, 'and credited with playing it');
  assert.ok(player.alive, 'the real player should have spawned, or this proves nothing');
  room.close();
});

// The catch-all. Rather than reasoning channel by channel about what might leak, run the match twice,
// once with a watcher and once without, and check that nothing the player is sent ever mentions them.
// A distinctive name and the real id are searched for across every message, so a leak through a field
// nobody thought about still fails this.
const MARK = 'ZzWatcherZz';

async function playedOut(withWatcher) {
  const { room } = await makeRoom();
  const socket = fakeSocket();
  const player = room.join(socket, hello('A'), look);
  const watcher = withWatcher ? room.watch(fakeSocket(), hello(MARK), look) : null;
  socket.sent.length = 0;
  // A scripted match: a round starts, positions go out, the scoreboard is pushed, someone dies.
  room.startRound();
  room.pushRoom();
  room.snapshot(1);
  if (watcher) room.leave(watcher, false);
  room.pushRoom();
  room.snapshot(2);
  const sent = socket.sent;
  room.close();
  return { sent, watcher, player };
}

test('nothing the match is sent ever mentions a watcher', async () => {
  const { sent, watcher } = await playedOut(true);
  const raw = JSON.stringify(sent);
  assert.ok(raw.length > 50, 'the player was sent something, or this proves nothing');
  assert.ok(!raw.includes(MARK), 'the watcher was named in something the match received');
  assert.ok(!raw.includes(`"${watcher.id}"`), `the watcher id ${watcher.id} reached the match`);
});

test('a match plays out the same whether or not it is being watched', async () => {
  const shape = (sent) => sent.map((message) => message.type).join(',');
  const alone = await playedOut(false);
  const watched = await playedOut(true);
  assert.equal(shape(watched.sent), shape(alone.sent), 'a watcher changed what the match was sent');
  // And the counts a player can actually read on screen are untouched.
  const roster = (run) => run.sent.filter((m) => m.type === 'room').map((m) => m.players.length).join(',');
  assert.equal(roster(watched), roster(alone), 'a watcher changed the size of the roster');
});

// A watcher is deliberately absent from the roster, so asking for their team gives undefined and
// matching players against it finds nobody. Without widening the list, watching a match shows an empty
// sky: the seat works perfectly and there is nothing to look at.
test('a watcher can follow both sides, a dead player still only their own', () => {
  const source = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('  spectateTargets() {'), source.indexOf('  cycleSpectate('));
  assert.match(fn, /const everyone = Boolean\(game\.watching\) \|\| game\.room\?\.royale/, 'watching widens the list');
  assert.match(fn, /everyone \|\| p\.team === team/, 'and a dead player in their own match still follows their own side');
  assert.match(fn, /p\.alive/, 'you can only follow someone who is alive');
});
