// Map selection for a room: a fixed arena, a random one, or a lobby vote.
// Kept apart from room.js so the match state machine only needs a few hooks.
import { performance } from 'node:perf_hooks';
import { VARIANT_NAMES } from '../shared/constants.js';
import { MAP_IDS, MAP_INFO, getMap } from '../shared/map.js';
import { World } from '../shared/physics.js';
import { NavGrid } from './nav.js';

const now = () => performance.now() / 1000;
const VOTE_SECONDS = 25; // every arena is on the ballot, so give people time to look
const navCache = new Map();
let variantCursor = Math.floor(Math.random() * 97);

// Navigation grids take a second or two to build, so they are shared by every room.
export function navFor(map) {
  if (!navCache.has(map.id)) navCache.set(map.id, new NavGrid(new World(map.boxes), map));
  return navCache.get(map.id);
}

// Build them one at a time shortly after boot, so no match ever waits on it.
let warming = false;
export function warmNavigation() {
  if (warming) return;
  warming = true;
  const queue = [...MAP_IDS];
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    navFor(getMap(id));
    setTimeout(next, 30).unref?.();
  };
  setTimeout(next, 400).unref?.();
}

export function validMapRule(value) { return value === 'vote' || value === 'random' || MAP_IDS.includes(value); }

export function initMapFlow(room) {
  room.rules.map = room.queue === 'custom' ? 'vote' : 'random';
  room.mapChoices = [];
  room.mapVotes = new Map();
  room.voteSettleAt = 0;
  if (room.mode === 'match') warmNavigation();
}

export function mapState(room) {
  const tally = {};
  for (const choice of room.mapVotes.values()) tally[choice] = (tally[choice] || 0) + 1;
  return { mapTitle: room.map.title, mapChoices: room.mapChoices, mapVotes: Object.fromEntries(room.mapVotes), mapTally: tally };
}

export function setRoomMap(room, id) {
  if (room.map.id === id) return;
  room.map = getMap(id);
  room.world = new World(room.map.boxes);
  room.nav = navFor(room.map);
  room.shields.clear();
  room.decoys.clear();
  room.barriersUp = false;
  room.lastKill = null;
}

function randomMap(room) {
  // Never the same arena twice in a row once a room has played a match.
  const pool = room.mapPlayed ? MAP_IDS.filter((id) => id !== room.map.id) : MAP_IDS;
  // Small lobbies lean toward the smaller arenas, full ones toward the big ones.
  const seats = room.team('A').length + room.team('B').length;
  const weight = (id) => {
    const size = MAP_INFO.find((info) => info.id === id)?.size || 'Medium';
    if (seats <= 4) return size.startsWith('Large') ? 0.4 : size.startsWith('Small') ? 1.6 : 1;
    if (seats >= 7) return size.startsWith('Small') && !size.includes('medium') ? 0.4 : 1.3;
    return 1;
  };
  let roll = Math.random() * pool.reduce((sum, id) => sum + weight(id), 0);
  for (const id of pool) { roll -= weight(id); if (roll <= 0) return id; }
  return pool[0];
}

// Called wherever a match used to start directly.
export function beginMatch(room) {
  if (room.mode !== 'match') return;
  const rule = room.rules.map;
  if (rule === 'vote' && room.connectedHumans().length) return startVote(room);
  setRoomMap(room, MAP_IDS.includes(rule) ? rule : randomMap(room));
  room.mapPlayed = true;
  room.startMatch();
}

function startVote(room) {
  room.phase = 'mapvote';
  room.phaseEnds = now() + VOTE_SECONDS;
  room.voteSettleAt = 0;
  room.mapVotes.clear();
  room.rematch.clear();
  room.autoStartAt = 0;
  room.mapChoices = [...MAP_IDS];
  room.broadcast({ type: 'phase', phase: 'mapvote', phaseEnds: room.phaseEnds });
  room.pushRoom();
}

export function castMapVote(room, player, id) {
  if (room.phase !== 'mapvote' || player.bot) return;
  if (id !== 'random' && !room.mapChoices.includes(id)) return;
  room.mapVotes.set(player.id, id);
  // Once everybody has voted there is no reason to run the clock down.
  const voters = room.connectedHumans();
  if (voters.length && voters.every((voter) => room.mapVotes.has(voter.id)) && !room.voteSettleAt) room.voteSettleAt = now() + 1.2;
  room.pushRoom();
}

export function tickMapVote(room, t) {
  if (t < room.phaseEnds && !(room.voteSettleAt && t >= room.voteSettleAt)) return;
  const tally = new Map();
  for (const [playerId, choice] of room.mapVotes) if (room.players.get(playerId)?.connected) tally.set(choice, (tally.get(choice) || 0) + 1);
  let winner = 'random';
  if (tally.size) {
    const best = Math.max(...tally.values());
    const tied = [...tally.keys()].filter((choice) => tally.get(choice) === best);
    winner = tied[Math.floor(Math.random() * tied.length)];
  }
  const pool = room.mapChoices.length ? room.mapChoices : MAP_IDS;
  const id = winner === 'random' ? pool[Math.floor(Math.random() * pool.length)] : winner;
  setRoomMap(room, id);
  room.mapPlayed = true;
  room.broadcast({ type: 'map-chosen', map: id, title: room.map.title, votes: tally.get(winner) || 0, random: winner === 'random' });
  room.startMatch();
  if (room.phase === 'mapvote') room.toLobby(); // a team emptied out while the vote ran
}

// Conditions rotate through whatever the arena supports.
export function pickVariant(room) {
  if (room.rules.variant !== 'auto' && VARIANT_NAMES[room.rules.variant]) return room.rules.variant;
  const list = room.map.env?.variants?.length ? room.map.env.variants : ['dusk', 'night', 'storm', 'noon'];
  variantCursor += 1;
  return list[variantCursor % list.length];
}

// During the buy phase pilots must stay behind their gate, whichever side they spawned on.
export function inSpawnZone(room, player, x, z) {
  const zones = room.map.spawnZones;
  if (!zones) return true;
  const side = room.swapped ? (player.team === 'A' ? 'B' : 'A') : player.team;
  const [x1, z1, x2, z2] = zones[side] || zones.A;
  return x >= x1 - 0.6 && x <= x2 + 0.6 && z >= z1 - 0.6 && z <= z2 + 0.6;
}
