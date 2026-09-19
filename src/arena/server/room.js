// One Room = one lobby + match. The room owns all truth: health, ammo, credits,
// hit detection (with lag compensation), round flow, gadgets and bots.
import { performance } from 'node:perf_hooks';
import {
  ARMOR, ARMOR_ABSORB, BODY, BOT_DIFFICULTY, DEFAULT_LOADOUT, DEFAULT_RULES, ECONOMY, FLAG, GADGETS, GADGET_SLOTS,
  HELMET_FACTOR, MAX_PLAYERS, MAX_REWIND, MODIFIERS, PLACEMENT_MATCHES, QUICK_COMMANDS, REACTIONS, RECONNECT_GRACE, SNAPSHOT_RATE,
  VARIANT_NAMES, WEAPONS, clamp, dailyModifier, dateKey, levelFromXp,
} from '../shared/constants.js';
import { killCoins } from '../shared/economy.js';
import { DEV_ACTION_IDS, DEV_SERVER_TOOLS, DEV_SPEED } from '../shared/devtools.js';
import { getMap, zoneAt } from '../shared/map.js';
import { mapFingerprint } from '../shared/version.js';
import { beginMatch, castMapVote, inSpawnZone, initMapFlow, mapState, navFor, pickVariant, tickMapVote, validMapRule } from './mapflow.js';
import { World, makeBody } from '../shared/physics.js';
import { SpreadTracker, applySpread, damageFor, hashString, mulberry32, spreadAngle, traceShot } from '../shared/combat.js';
import { createBot, createDummy, updateBot, resetBot, botBuy, botOnHurt, botOnSound } from './bots.js';

export const now = () => performance.now() / 1000;
const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

export function freshMatchStats() {
  return { kills: 0, playerKills: 0, botKills: 0, deaths: 0, assists: 0, headshots: 0, headshotKills: 0, damage: 0, shots: 0, hits: 0, roundsWon: 0, roundsPlayed: 0, longest: 0, longshots: 0, wallbangs: 0, knifeKills: 0, sidearmKills: 0, gadgets: 0, clutches: 0, coinKills: 0, weaponKills: {} };
}

export class Room {
  constructor({ name, queue = 'custom', isPublic = false, profiles, onEmpty, wager = null }) {
    this.name = name;
    // Wager rooms are private-room rules with a stake: { size: players a side, stake: coins each }.
    this.wager = wager;
    this.pot = null;
    this.forfeitAt = { A: 0, B: 0 };
    this.queue = queue;
    this.mode = queue === 'range' ? 'range' : 'match';
    this.isPublic = isPublic;
    this.profiles = profiles;
    this.onEmpty = onEmpty;
    this.map = getMap(this.mode === 'range' ? 'range' : 'yard');
    this.world = new World(this.map.boxes);
    if (this.mode === 'match') {
      this.nav = navFor(this.map);
    }
    this.players = new Map();
    // How many seats a match has. Arenas are 4v4; the royale room raises it.
    this.capacity = MAX_PLAYERS;
    this.nextPlayer = 1;
    this.nextEntity = 1;
    this.rules = { ...DEFAULT_RULES };
    initMapFlow(this);
    if (queue === 'arcade') this.rules.modifier = dailyModifier(dateKey());
    if (queue === 'bots') this.rules.botDifficulty = 'veteran';
    this.phase = this.mode === 'range' ? 'range' : 'lobby';
    this.phaseEnds = 0;
    this.round = 0;
    this.scores = { A: 0, B: 0 };
    this.lossStreak = { A: 0, B: 0 };
    this.swapped = false;
    this.variant = 'dusk';
    this.decoys = new Map();
    this.shields = new Map();
    this.rematch = new Set();
    this.autoStartAt = 0;
    this.emptySince = 0;
    this.snapshotTimer = 0;
    this.lastKill = null;
    this.roundDamage = { A: 0, B: 0 };
    this.time = now();
    this.lastTick = this.time;
    this.closed = false;
    this.barriersUp = false;
    this.rematchAt = 0;
    this.clutch = { A: null, B: null };
    this.roundKills = new Map();
    this.roundStartSize = { A: 0, B: 0 };
    if (this.mode === 'range') {
      this.variant = 'noon';
      this.map.dummies.forEach((spec, index) => { const dummy = createDummy(this, spec, index); this.players.set(dummy.id, dummy); });
    }
    this.interval = setInterval(() => this.tick(), 1000 / 30);
  }

  close() { this.refundWager('room closed'); this.closed = true; clearInterval(this.interval); }

  // ---------------------------------------------------------------- messaging
  send(player, message) {
    if (player.socket && player.socket.readyState === 1) player.socket.send(JSON.stringify(message));
  }
  broadcast(message, filter = null) {
    const raw = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.socket && player.socket.readyState === 1 && (!filter || filter(player))) player.socket.send(raw);
    }
  }
  sendTeam(team, message) { this.broadcast(message, (player) => player.team === team); }
  notice(player, text, tone = 'info') { this.send(player, { type: 'notice', text, tone }); }

  humans() { return [...this.players.values()].filter((player) => !player.bot); }
  connectedHumans() { return this.humans().filter((player) => player.connected); }
  team(team) { return [...this.players.values()].filter((player) => player.team === team && !player.dummy); }
  aliveOn(team) { return this.team(team).filter((player) => player.alive); }
  enemiesOf(player) { return [...this.players.values()].filter((other) => other.team !== player.team && other.alive && !other.devTools?.ghost); }
  get live() { return this.phase === 'live' || this.phase === 'overtime' || this.phase === 'range'; }

  info() {
    return { name: this.name, queue: this.queue, wager: this.wager, phase: this.phase, players: this.connectedHumans().length, bots: [...this.players.values()].filter((p) => p.bot && !p.dummy).length, max: MAX_PLAYERS, scores: this.scores, variant: this.variant };
  }

  roomState() {
    return {
      type: 'room', name: this.name, queue: this.queue, mode: this.mode, isPublic: this.isPublic, phase: this.phase, phaseEnds: this.phaseEnds,
      round: this.round, scores: this.scores, rules: this.rules, variant: this.variant, swapped: this.swapped, map: this.map.id, ...mapState(this),
      autoStartAt: this.autoStartAt, rematch: [...this.rematch], wager: this.wager, pot: this.pot && !this.pot.settled ? this.pot.stake * this.pot.entries.length : 0,
      players: [...this.players.values()].filter((player) => !player.dummy).map((player) => ({
        id: player.id, name: player.name, team: player.team, bot: player.bot, difficulty: player.difficulty, connected: player.connected, ready: player.ready,
        host: player.host, alive: player.alive, kills: player.match.kills, playerKills: player.match.playerKills, botKills: player.match.botKills, deaths: player.match.deaths, assists: player.match.assists,
        score: this.scoreOf(player), credits: player.credits, ping: player.ping, color: player.color, accent: player.accent, tracer: player.tracer,
        title: player.title, headgear: player.headgear, face: player.face, pack: player.pack, pattern: player.pattern, charm: player.charm, skins: player.skins,
        level: player.level, rating: player.rating, rankedMatches: player.rankedMatches, primary: player.weapons.primary, armor: player.armor > 0,
      })),
    };
  }
  pushRoom() { this.broadcast(this.roomState()); }
  scoreOf(player) { return player.match.playerKills * 100 + player.match.botKills * 50 + player.match.assists * 40 + Math.round(player.match.damage / 5) + player.match.roundsWon * 20; }

  youState(player) {
    return {
      type: 'you', hp: Math.ceil(player.hp), armor: Math.ceil(player.armor), helmet: player.helmet, credits: player.credits, alive: player.alive,
      weapons: player.weapons, ammo: player.ammo, active: player.active, gadgets: player.gadgets, bought: Object.keys(player.bought),
    };
  }
  pushYou(player) { if (!player.bot) this.send(player, this.youState(player)); }

  // ---------------------------------------------------------------- roster
  newPlayer(base) {
    const player = {
      id: `p${this.nextPlayer++}`, name: 'Pilot', team: 'A', bot: false, dummy: false, socket: null, connected: true, ready: false, host: false,
      color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit', headgear: 'helmet', face: 'visor', pack: 'radio', pattern: 'solid', charm: 'none', skins: {}, level: 1, rating: 1000, rankedMatches: 0, difficulty: null, ping: 0,
      token: null, session: null, credits: this.rules.startCredits, match: freshMatchStats(),
      alive: false, hp: 100, armor: 0, helmet: false, weapons: { ...DEFAULT_LOADOUT }, ammo: {}, active: 'primary', gadgets: [], bought: {},
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: FLAG.ground, speed: 0, history: [], shotLog: [], epoch: 0, lastStateAt: 0, strikes: 0,
      nextFire: 0, equipUntil: 0, reloadEnd: 0, reloadSlot: null, scopedSince: 0, spread: { primary: new SpreadTracker(), sidearm: new SpreadTracker() },
      stimUntil: 0, stimUsed: false, ghostUntil: 0, drone: null, damageFrom: new Map(), diedThisRound: false, lastFireAt: 0,
      disconnectedAt: 0, pendingJoin: false, shotSeq: 0, dev: false, devTools: {}, ...base,
    };
    this.refillAmmo(player);
    return player;
  }

  pickTeam() {
    const a = this.team('A').length, b = this.team('B').length;
    return a <= b ? 'A' : 'B';
  }

  join(socket, hello, look) {
    // Reconnect to a held slot?
    for (const existing of this.players.values()) {
      if (!existing.bot && !existing.connected && existing.session && existing.session === hello.session) {
        existing.socket = socket; existing.connected = true; existing.disconnectedAt = 0;
        socket.player = existing; socket.room = this;
        this.welcome(existing, true);
        this.pushRoom();
        this.broadcast({ type: 'feed', text: `${existing.name} reconnected`, tone: 'info' });
        return existing;
      }
    }
    if (this.wager && this.humans().length >= this.wager.size * 2) return null;
    const seats = this.team('A').length + this.team('B').length;
    if (this.mode === 'range' ? this.connectedHumans().length >= 4 : seats >= this.capacity) {
      // A full lobby can still make room by dropping one of its matchmaking bots.
      const bot = this.queue !== 'custom' && this.mode === 'match' ? [...this.players.values()].find((p) => p.bot && !p.dummy) : null;
      if (!bot) return null;
      this.removePlayer(bot);
    }
    const profile = this.profiles.get(hello.token);
    const player = this.newPlayer({
      name: hello.name, token: hello.token, session: hello.session, socket, ...look,
      level: levelFromXp(profile.xp), rating: Math.round(profile.rating), rankedMatches: profile.rankedMatches,
      dev: Boolean(profile.dev),
    });
    const midMatch = this.mode === 'match' && this.phase !== 'lobby';
    const replaceable = midMatch && [...this.players.values()].some((p) => p.bot && !p.dummy) && this.queue !== 'custom';
    player.team = this.mode === 'range' ? 'A' : this.pickTeam();
    player.pendingJoin = replaceable;
    player.host = this.queue === 'custom' && !this.connectedHumans().length;
    this.players.set(player.id, player);
    socket.player = player; socket.room = this;
    this.welcome(player, false);
    if (this.mode === 'range') this.spawn(player);
    this.pushRoom();
    this.broadcast({ type: 'feed', text: `${player.name} joined`, tone: 'info' }, (other) => other !== player);
    this.emptySince = 0;
    if (this.phase === 'lobby' && this.queue !== 'custom') this.scheduleAutoStart();
    return player;
  }

  welcome(player, reconnected) {
    this.send(player, {
      type: 'welcome', id: player.id, room: this.name, reconnected, serverTime: now(), map: this.map.id, mapPrint: mapFingerprint(this.map),
      weapons: Object.keys(WEAPONS), broken: [...this.world.disabled], shields: [...this.shields.values()].map((s) => s.view), barriers: this.barriersUp,
    });
    this.send(player, this.roomState());
    this.pushYou(player);
    if (player.alive) this.send(player, { type: 'spawn', x: player.x, y: player.y, z: player.z, yaw: player.yaw, epoch: player.epoch, keep: true });
  }

  // deliberate = the pilot pressed Leave; a dropped socket keeps its seat for a while instead.
  leave(player, deliberate = false) {
    if (!this.players.has(player.id)) return;
    player.socket = null;
    const holdSlot = !deliberate && this.mode === 'match' && this.phase !== 'lobby';
    if (deliberate && player.alive && this.live && this.mode === 'match') this.kill(player, null, null, 'torso', { reason: 'disconnect' });
    if (holdSlot) {
      player.connected = false; player.disconnectedAt = now();
      if (player.alive && this.live) this.kill(player, null, null, 'torso', { reason: 'disconnect' });
      this.broadcast({ type: 'feed', text: `${player.name} lost connection`, tone: 'warn' });
    } else this.removePlayer(player);
    this.passHost();
    this.pushRoom();
    if (!this.connectedHumans().length) this.emptySince = now();
  }

  removePlayer(player) {
    if (player.drone) this.endDrone(player, false);
    this.players.delete(player.id);
    this.rematch.delete(player.id);
    this.broadcast({ type: 'gone', id: player.id });
    if (this.live && this.mode === 'match') this.checkRoundEnd();
  }

  passHost() {
    if (this.queue !== 'custom') return;
    const humans = this.connectedHumans();
    if (!humans.length || humans.some((p) => p.host)) return;
    this.humans().forEach((p) => { p.host = false; });
    humans[0].host = true;
  }

  scheduleAutoStart() {
    const humans = this.connectedHumans().length;
    if (!humans) { this.autoStartAt = 0; return; }
    const t = now();
    let wait = this.queue === 'bots' ? 4 : 14;
    if (this.queue === 'ranked') wait = humans >= 2 ? 8 : 0;
    else if (humans >= 2) wait = 7;
    if (!wait) { this.autoStartAt = 0; return; }
    this.autoStartAt = this.autoStartAt ? Math.min(this.autoStartAt, t + wait) : t + wait;
  }

  addBot(team, difficulty = this.rules.botDifficulty) {
    if (this.team('A').length + this.team('B').length >= this.capacity) return null;
    const bot = createBot(this, team || this.pickTeam(), BOT_DIFFICULTY[difficulty] ? difficulty : 'veteran');
    this.players.set(bot.id, bot);
    return bot;
  }

  fillBots() {
    const humans = this.connectedHumans().length;
    let perTeam = Math.ceil((this.team('A').length + this.team('B').length) / 2);
    if (this.queue === 'bots') perTeam = Math.max(perTeam, 3);
    else if (humans < 2) perTeam = Math.max(perTeam, 2);
    perTeam = Math.max(1, Math.min(4, perTeam));
    // Spread humans evenly first.
    const roster = this.team('A').concat(this.team('B')).filter((p) => !p.bot);
    roster.forEach((player, index) => { player.team = index % 2 ? 'B' : 'A'; });
    if (this.queue === 'bots') roster.forEach((player) => { player.team = 'A'; });
    for (const team of ['A', 'B']) while (this.team(team).length < perTeam) if (!this.addBot(team)) break;
  }

  // ---------------------------------------------------------------- match flow
  startMatch() {
    if (this.mode !== 'match') return;
    if (this.wager && !this.takeStakes()) { this.phase = 'lobby'; this.phaseEnds = 0; this.broadcast({ type: 'phase', phase: 'lobby', phaseEnds: 0 }); this.pushRoom(); return; }
    if (this.queue !== 'custom') this.fillBots();
    if (!this.team('A').length || !this.team('B').length) return;
    this.round = 0;
    this.scores = { A: 0, B: 0 };
    this.lossStreak = { A: 0, B: 0 };
    this.swapped = false;
    this.rematch.clear();
    this.autoStartAt = 0;
    this.lastKill = null;
    this.roundKill = null;
    this.variant = pickVariant(this);
    for (const player of this.players.values()) {
      player.match = freshMatchStats();
      player.credits = this.rules.startCredits;
      player.weapons = { ...DEFAULT_LOADOUT };
      player.armor = 0; player.helmet = false; player.gadgets = []; player.diedThisRound = false; player.pendingJoin = false; player.ready = false;
    }
    this.broadcast({ type: 'match-start', variant: this.variant, rules: this.rules, map: this.map.id, mapTitle: this.map.title, mapPrint: mapFingerprint(this.map) });
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.roundKill = null;
    // Sides switch once (roundsToWin - 1) rounds have been decided; drawn rounds do not count.
    const swapAt = this.rules.roundsToWin - 1;
    const shouldSwap = this.rules.swapSides && this.scores.A + this.scores.B >= swapAt;
    const justSwapped = shouldSwap && !this.swapped;
    this.swapped = shouldSwap;
    // Humans who joined mid-round take over a bot's seat.
    for (const player of this.humans()) {
      if (!player.pendingJoin) continue;
      player.pendingJoin = false;
      const humansOn = (team) => this.team(team).filter((p) => !p.bot).length;
      const preferred = humansOn('A') <= humansOn('B') ? 'A' : 'B';
      const bot = this.team(preferred).find((p) => p.bot) || [...this.players.values()].find((p) => p.bot && !p.dummy);
      if (bot) { player.team = bot.team; player.credits = bot.credits; this.removePlayer(bot); }
    }
    for (const player of [...this.players.values()]) {
      if (!player.bot && !player.connected && now() - player.disconnectedAt > RECONNECT_GRACE) this.removePlayer(player);
    }
    // Matchmade rooms top teams back up with bots when pilots walk out.
    if (this.queue !== 'custom') {
      const size = (team) => this.team(team).filter((p) => p.bot || p.connected).length;
      while (size('A') !== size('B') && this.team('A').length + this.team('B').length < MAX_PLAYERS) {
        const bot = this.addBot(size('A') < size('B') ? 'A' : 'B');
        if (!bot) break;
        bot.credits = Math.round([...this.players.values()].reduce((sum, p) => sum + p.credits, 0) / Math.max(1, this.players.size));
      }
    }
    this.world.resetDisabled();
    this.world.clearDynamic();
    this.shields.clear();
    this.decoys.clear();
    this.roundDamage = { A: 0, B: 0 };
    this.clutch = { A: null, B: null };
    this.roundKills = new Map();
    this.roundStartSize = { A: this.team('A').filter((p) => p.bot || p.connected).length, B: this.team('B').filter((p) => p.bot || p.connected).length };
    this.setBarriers(true);
    const counters = { A: 0, B: 0 };
    for (const player of this.players.values()) {
      if (player.drone) this.endDrone(player, false);
      if (player.diedThisRound || this.round === 1) {
        player.weapons = { ...DEFAULT_LOADOUT };
        player.armor = 0; player.helmet = false; player.gadgets = [];
      }
      if (this.rules.modifier === 'sidearms') player.weapons.primary = null;
      if (this.rules.modifier === 'instagib') { player.armor = 0; player.helmet = false; }
      player.diedThisRound = false;
      player.bought = {};
      player.match.roundsPlayed += 1;
      if (player.bot || player.connected) this.spawn(player, counters[player.team]++);
      else player.alive = false;
    }
    this.phase = 'buy';
    this.phaseEnds = now() + (this.round === 1 ? this.rules.firstBuyTime : this.rules.buyTime);
    const matchPoint = Math.max(this.scores.A, this.scores.B) === this.rules.roundsToWin - 1;
    this.broadcast({ type: 'round', round: this.round, scores: this.scores, swapped: justSwapped, matchPoint, decider: this.scores.A === this.scores.B && matchPoint });
    this.pushRoom();
    for (const player of this.players.values()) if (player.bot && !player.dummy) botBuy(this, player);
  }

  setBarriers(up) {
    this.barriersUp = up;
    this.map.barriers.forEach((barrier) => { if (up) this.world.addDynamic({ ...barrier }); else this.world.removeDynamic(barrier.id); });
  }

  spawnPoint(player, index = 0) {
    const side = this.swapped ? (player.team === 'A' ? 'B' : 'A') : player.team;
    const list = this.map.spawns[side].length ? this.map.spawns[side] : this.map.spawns.A;
    return list[index % list.length];
  }

  // at: an exact spot, for modes that choose their own (the royale drop).
  spawn(player, index = 0, at = null) {
    const point = at || (player.dummy ? player.home : this.spawnPoint(player, index));
    Object.assign(player, { x: point.x, y: point.y, z: point.z, yaw: point.yaw || 0, pitch: 0, alive: true, hp: 100, flags: FLAG.ground | (player.dummy && player.home.crouch ? FLAG.crouch : 0), speed: 0 });
    player.epoch += 1;
    player.history = [];
    player.active = player.weapons.primary ? 'primary' : player.weapons.sidearm ? 'sidearm' : 'melee';
    player.reloadEnd = 0; player.nextFire = 0; player.equipUntil = 0; player.stimUntil = 0; player.stimUsed = false; player.ghostUntil = 0; player.strikes = 0;
    player.damageFrom.clear();
    this.refillAmmo(player);
    if (player.bot) resetBot(player);
    this.send(player, { type: 'spawn', x: point.x, y: point.y, z: point.z, yaw: player.yaw, epoch: player.epoch });
    this.pushYou(player);
  }

  refillAmmo(player) {
    player.ammo = {};
    for (const slot of ['primary', 'sidearm']) {
      const weapon = WEAPONS[player.weapons[slot]];
      if (weapon) player.ammo[slot] = { mag: weapon.mag, reserve: weapon.reserve };
    }
  }

  goLive() {
    this.phase = 'live';
    this.phaseEnds = now() + this.rules.roundTime;
    this.setBarriers(false);
    this.broadcast({ type: 'phase', phase: 'live', phaseEnds: this.phaseEnds });
    this.checkRoundEnd();
  }

  startOvertime() {
    this.phase = 'overtime';
    this.phaseEnds = now() + this.rules.overtime;
    this.broadcast({ type: 'phase', phase: 'overtime', phaseEnds: this.phaseEnds });
    for (const player of this.players.values()) if (player.alive) this.mark(player, this.phaseEnds - now(), 'overtime');
  }

  checkRoundEnd() {
    if (this.mode !== 'match' || (this.phase !== 'live' && this.phase !== 'overtime')) return;
    const a = this.aliveOn('A').length, b = this.aliveOn('B').length;
    if (a && b) {
      for (const team of ['A', 'B']) {
        const mine = team === 'A' ? a : b, theirs = team === 'A' ? b : a;
        if (mine === 1 && theirs >= 2 && this.roundStartSize[team] >= 2 && !this.clutch[team]) {
          this.clutch[team] = this.aliveOn(team)[0].id;
          this.send(this.aliveOn(team)[0], { type: 'clutch', rivals: theirs });
        }
      }
      return;
    }
    if (!a && !b) return this.endRound(null, 'draw');
    this.endRound(a ? 'A' : 'B', 'elimination');
  }

  resolveTimeout() {
    const score = (team) => [this.aliveOn(team).length, this.aliveOn(team).reduce((sum, p) => sum + p.hp, 0), this.roundDamage[team]];
    const a = score('A'), b = score('B');
    for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return this.endRound(a[index] > b[index] ? 'A' : 'B', 'timeout');
    this.endRound(null, 'draw');
  }

  endRound(winner, reason) {
    this.phase = 'roundEnd';
    this.phaseEnds = now() + this.rules.roundEndTime;
    const tags = [];
    let hero = null;
    if (winner) {
      const loser = winner === 'A' ? 'B' : 'A';
      this.scores[winner] += 1;
      this.lossStreak[winner] = 0;
      const lossPay = ECONOMY.loss + ECONOMY.lossStreak * Math.min(this.lossStreak[loser], ECONOMY.lossStreakMax);
      this.lossStreak[loser] += 1;
      for (const player of this.team(winner)) { player.match.roundsWon += 1; this.pay(player, ECONOMY.win); }
      for (const player of this.team(loser)) this.pay(player, lossPay);
      const team = this.team(winner);
      if (this.roundStartSize[winner] >= 2 && team.every((p) => !p.diedThisRound)) tags.push('FLAWLESS');
      if (this.clutch[winner]) {
        const player = this.players.get(this.clutch[winner]);
        if (player && player.alive) { player.match.clutches += 1; tags.push('CLUTCH'); hero = player.id; }
      }
      for (const [id, count] of this.roundKills) {
        const player = this.players.get(id);
        if (player && player.team === winner && this.roundStartSize[loser] >= 2 && count >= this.roundStartSize[loser]) { tags.push('ACE'); hero = id; }
      }
    }
    for (const player of this.players.values()) if (player.drone) this.endDrone(player, false);
    const matchOver = winner && this.scores[winner] >= this.rules.roundsToWin;
    // Everyone watches the round's last kill; the match's final one is saved for the end screen.
    const replay = !matchOver && this.roundKill ? this.roundKill : undefined;
    this.broadcast({ type: 'round-end', winner, reason, scores: this.scores, tags, hero, matchOver, phaseEnds: this.phaseEnds, replay });
    this.pushRoom();
    for (const player of this.players.values()) this.pushYou(player);
  }

  pay(player, amount) { player.credits = clamp(player.credits + amount, 0, ECONOMY.max); }

  endMatch() {
    this.phase = 'matchEnd';
    this.phaseEnds = now() + this.rules.matchEndTime;
    const winner = this.scores.A === this.scores.B ? null : this.scores.A > this.scores.B ? 'A' : 'B';
    const everyone = [...this.players.values()].filter((p) => !p.dummy);
    const ranked = this.queue === 'ranked' && this.team('A').some((p) => !p.bot) && this.team('B').some((p) => !p.bot);
    const avg = (team) => { const list = this.team(team).filter((p) => !p.bot); return list.length ? list.reduce((s, p) => s + p.rating, 0) / list.length : 1000; };
    const expectedA = 1 / (1 + 10 ** ((avg('B') - avg('A')) / 400));
    const pool = winner ? this.team(winner) : everyone;
    const mvp = [...pool].sort((m, n) => this.scoreOf(n) - this.scoreOf(m))[0];
    const table = everyone.map((p) => ({
      id: p.id, name: p.name, team: p.team, bot: p.bot, score: this.scoreOf(p), kills: p.match.kills, playerKills: p.match.playerKills, botKills: p.match.botKills, deaths: p.match.deaths, assists: p.match.assists,
      damage: Math.round(p.match.damage), headshots: p.match.headshots, accuracy: p.match.shots ? Math.round((p.match.hits / p.match.shots) * 100) : 0,
      longest: Math.round(p.match.longest), mvp: mvp && p.id === mvp.id, color: p.color, title: p.title,
    })).sort((m, n) => n.score - m.score);
    this.broadcast({
      type: 'match-end', winner, scores: this.scores, table, mvp: mvp?.id || null, phaseEnds: this.phaseEnds, variant: this.variant,
      modifier: this.rules.modifier, queue: this.queue, replay: this.lastKill,
    });
    const wagers = this.settleWager(winner);
    const humansInMatch = everyone.filter((p) => !p.bot).length;
    const topKills = Math.max(1, ...everyone.map((p) => p.match.kills));
    for (const player of this.humans()) {
      const won = winner === player.team;
      const vsHumans = this.team(player.team === 'A' ? 'B' : 'A').some((p) => !p.bot);
      const expected = player.team === 'A' ? expectedA : 1 - expectedA;
      // Placement matches swing twice as far, so a new pilot finds their level quickly.
      const k = player.rankedMatches < PLACEMENT_MATCHES ? 60 : 30;
      const ratingDelta = ranked ? k * ((winner ? (won ? 1 : 0) : 0.5) - expected) : 0;
      const report = this.profiles.recordMatch(player.token, {
        ...player.match, won, draw: !winner, ranked, ratingDelta, mode: this.wager ? 'wager' : this.queue, variant: this.variant,
        vsHumans, topKills: humansInMatch >= 2 && player.match.kills === topKills,
        score: `${this.scores[player.team]}–${this.scores[player.team === 'A' ? 'B' : 'A']}`, mvp: mvp && mvp.id === player.id,
        rivals: everyone.filter((p) => !p.bot && p.id !== player.id).map((p) => p.name),
      });
      const view = this.profiles.view(player.token);
      player.level = view.level; player.rating = view.rating; player.rankedMatches = view.rankedMatches;
      if (wagers[player.token]) report.wager = wagers[player.token];
      this.send(player, { type: 'report', report, profile: view });
    }
    this.pushRoom();
  }

  // ---------------------------------------------------------------- wagers
  wagerReady() {
    const size = this.wager.size;
    return ['A', 'B'].every((team) => { const side = this.team(team); return side.length === size && side.every((p) => !p.bot && p.connected); });
  }
  // Everyone's stake is taken as the match starts. If anyone can't cover it, nobody pays and it's back to the lobby.
  takeStakes() {
    const { stake } = this.wager;
    if (!this.wagerReady()) { this.broadcast({ type: 'notice', text: `Wagers need a full ${this.wager.size}v${this.wager.size}.`, tone: 'warn' }); return false; }
    const held = [];
    for (const player of this.humans()) {
      if (!this.profiles.hold(player.token, stake, this.name)) {
        held.forEach((p) => this.profiles.settle(p.token, stake, 'Wager refunded (cancelled)'));
        this.broadcast({ type: 'notice', text: `${player.name} can't cover the stake.`, tone: 'warn' });
        return false;
      }
      held.push(player);
    }
    this.pot = { stake, settled: false, entries: held.map((p) => ({ token: p.token, name: p.name, team: p.team })) };
    this.broadcast({ type: 'notice', text: `Stakes in. Pot: ${stake * held.length} coins.`, tone: 'good' });
    return true;
  }
  // The winning team splits the pot; a draw hands every stake back.
  settleWager(winner) {
    const pot = this.pot;
    if (!pot || pot.settled) return {};
    pot.settled = true;
    const total = pot.stake * pot.entries.length;
    const winners = winner ? pot.entries.filter((entry) => entry.team === winner) : [];
    const results = {};
    if (!winners.length) {
      for (const entry of pot.entries) { this.profiles.settle(entry.token, pot.stake, 'Wager refunded (draw)'); results[entry.token] = { stake: pot.stake, payout: pot.stake }; }
      return results;
    }
    const share = Math.floor(total / winners.length);
    let spare = total - share * winners.length;
    for (const entry of pot.entries) {
      const payout = entry.team === winner ? share + (spare-- > 0 ? 1 : 0) : 0;
      this.profiles.settle(entry.token, payout, payout ? `Won the pot in ${this.name}` : `Lost the wager in ${this.name}`);
      results[entry.token] = { stake: pot.stake, payout };
    }
    this.broadcast({ type: 'feed', text: `${winners.map((w) => w.name).join(' & ')} ${winners.length === 1 ? 'takes' : 'take'} the pot: ${total} coins`, tone: 'good' });
    return results;
  }
  refundWager(reason) {
    const pot = this.pot;
    if (!pot || pot.settled) return;
    pot.settled = true;
    for (const entry of pot.entries) this.profiles.settle(entry.token, pot.stake, `Wager refunded (${reason})`);
  }
  // A side with nobody connected for the reconnect window forfeits the match (and the pot).
  checkForfeit(t) {
    if (!this.pot || this.pot.settled || !['buy', 'live', 'overtime', 'roundEnd'].includes(this.phase)) return;
    for (const team of ['A', 'B']) {
      if (this.team(team).some((p) => !p.bot && p.connected)) { this.forfeitAt[team] = 0; continue; }
      if (!this.forfeitAt[team]) { this.forfeitAt[team] = t + RECONNECT_GRACE; continue; }
      if (t < this.forfeitAt[team]) continue;
      const other = team === 'A' ? 'B' : 'A';
      this.forfeitAt = { A: 0, B: 0 };
      this.scores[other] = this.rules.roundsToWin;
      this.broadcast({ type: 'feed', text: 'The other side left. Match forfeited.', tone: 'warn' });
      this.endMatch();
      return;
    }
  }

  toLobby() {
    this.phase = 'lobby';
    this.phaseEnds = 0;
    this.round = 0;
    this.rematch.clear();
    this.setBarriers(false);
    for (const player of [...this.players.values()]) {
      if (!player.bot && !player.connected) { this.removePlayer(player); continue; }
      player.alive = false; player.ready = false;
      if (player.bot && this.queue !== 'custom') this.removePlayer(player);
    }
    this.passHost();
    this.broadcast({ type: 'phase', phase: 'lobby', phaseEnds: 0 });
    this.pushRoom();
    if (this.queue !== 'custom') { this.autoStartAt = 0; this.scheduleAutoStart(); }
  }

  // ---------------------------------------------------------------- tick
  tick() {
    const t = now();
    const dt = Math.min(0.1, t - this.lastTick);
    this.lastTick = t;
    this.time = t;
    if (this.emptySince && t - this.emptySince > (this.phase === 'lobby' || this.mode === 'range' ? 5 : RECONNECT_GRACE + 5)) { this.onEmpty(this); return; }

    if (this.wager) this.checkForfeit(t);
    if (this.phase === 'lobby' && this.autoStartAt && t >= this.autoStartAt) {
      if (this.queue === 'ranked' && this.connectedHumans().length < 2) this.autoStartAt = 0; else beginMatch(this);
    } else if (this.phase === 'mapvote') tickMapVote(this, t);
    else if (this.phase === 'buy' && t >= this.phaseEnds) this.goLive();
    else if (this.phase === 'live' && t >= this.phaseEnds) { if (this.rules.overtime > 0) this.startOvertime(); else this.resolveTimeout(); }
    else if (this.phase === 'overtime' && t >= this.phaseEnds) this.resolveTimeout();
    else if (this.phase === 'roundEnd' && t >= this.phaseEnds) {
      if (Math.max(this.scores.A, this.scores.B) >= this.rules.roundsToWin) this.endMatch(); else this.startRound();
    } else if (this.phase === 'matchEnd') {
      const voters = this.connectedHumans();
      if (voters.length && voters.every((p) => this.rematch.has(p.id)) && !this.rematchAt) this.rematchAt = t + 2.5;
      if (this.rematchAt && t >= this.rematchAt) { this.rematchAt = 0; beginMatch(this); } else if (t >= this.phaseEnds) { this.rematchAt = 0; this.toLobby(); }
    }

    for (const player of this.players.values()) {
      if (!player.alive) {
        if (player.dummy && player.respawnAt && t >= player.respawnAt) { player.respawnAt = 0; this.spawn(player); }
        if (this.mode === 'range' && !player.bot && player.respawnAt && t >= player.respawnAt) { player.respawnAt = 0; this.spawn(player); }
        continue;
      }
      if (player.bot) updateBot(this, player, dt, t);
      if (player.reloadEnd && t >= player.reloadEnd) this.finishReload(player);
      if (player.stimUntil > t && player.hp < 100) {
        player.hp = Math.min(100, player.hp + (GADGETS.stim.heal / GADGETS.stim.duration) * dt);
        if (Math.floor(player.hp) !== player.lastHpSent) { player.lastHpSent = Math.floor(player.hp); this.pushYou(player); }
      }
      if (player.ghostUntil && t >= player.ghostUntil) { player.ghostUntil = 0; }
      if (player.drone && t >= player.drone.until) this.endDrone(player, false);
    }
    this.updateDecoys(dt, t);
    this.updateDrones(t);

    this.snapshotTimer += dt;
    if (this.snapshotTimer >= 1 / SNAPSHOT_RATE) {
      this.snapshotTimer %= 1 / SNAPSHOT_RATE;
      this.snapshot(t);
    }
  }

  snapshot(t) {
    const rows = [];
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      let flags = player.flags & ~(FLAG.ghost | FLAG.reloading | FLAG.piloting);
      if (player.ghostUntil > t) flags |= FLAG.ghost;
      if (player.reloadEnd) flags |= FLAG.reloading;
      if (player.drone) flags |= FLAG.piloting;
      player.history.push({ t, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, flags, weapon: player.weapons[player.active] || 'knife' });
      if (player.history.length > 110) player.history.shift();
      if (player.devTools?.ghost) continue;
      rows.push([player.id, round2(player.x), round2(player.y), round2(player.z), round3(player.yaw), round3(player.pitch), flags, player.weapons[player.active] || 'knife', player.dummy ? 1 : 0]);
    }
    if (!this.connectedHumans().length) return;
    const message = { type: 's', t: round3(t), p: rows };
    const drones = [...this.players.values()].filter((p) => p.drone).map((p) => [p.id, round2(p.drone.x), round2(p.drone.y), round2(p.drone.z), round3(p.drone.yaw)]);
    if (drones.length) message.d = drones;
    if (this.decoys.size) message.c = [...this.decoys.values()].map((d) => [d.id, d.owner, round2(d.body.x), round2(d.body.y), round2(d.body.z), round3(d.yaw)]);
    this.broadcast(message);
  }

  // Where was this player at time t? (lag compensation)
  rewind(player, t) {
    const history = player.history;
    if (!history.length || t >= history[history.length - 1].t) return { id: player.id, kind: 'player', x: player.x, y: player.y, z: player.z, crouch: Boolean(player.flags & FLAG.crouch) };
    for (let index = history.length - 1; index > 0; index -= 1) {
      const a = history[index - 1], b = history[index];
      if (t >= a.t) {
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { id: player.id, kind: 'player', x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: Boolean((k < 0.5 ? a : b).flags & FLAG.crouch) };
      }
    }
    const first = history[0];
    return { id: player.id, kind: 'player', x: first.x, y: first.y, z: first.z, crouch: Boolean(first.flags & FLAG.crouch) };
  }

  // ---------------------------------------------------------------- input
  handle(player, message) {
    switch (message.type) {
      case 'state': return this.onState(player, message);
      case 'fire': return this.onFire(player, message);
      case 'melee': return this.onMelee(player, message);
      case 'reload': return this.startReload(player);
      case 'switch': return this.switchWeapon(player, message.slot);
      case 'buy': return this.buy(player, String(message.item));
      case 'sell': return this.sell(player, String(message.item));
      case 'gadget': return this.useGadget(player, message);
      case 'drone-end': if (player.drone) this.endDrone(player, false); return;
      case 'ping-loc': return this.onPing(player, message);
      case 'chat': return this.onChat(player, message);
      case 'quick': return this.onQuick(player, message);
      case 'react': return this.onReact(player, message);
      case 'ready':
        if (message.ready && this.wager && this.profiles.coins(player.token) < this.wager.stake) return this.notice(player, 'Not enough coins for the stake.', 'warn');
        player.ready = Boolean(message.ready); return this.pushRoom();
      case 'team': return this.onTeam(player, message.team);
      case 'rules': return this.onRules(player, message.rules);
      case 'addbot': if (player.host && this.phase === 'lobby' && !this.wager) { this.addBot(message.team === 'B' ? 'B' : 'A', message.difficulty); this.pushRoom(); } return;
      case 'removebot': {
        const bot = this.players.get(message.id);
        if (player.host && this.phase === 'lobby' && bot?.bot) { this.removePlayer(bot); this.pushRoom(); }
        return;
      }
      case 'start': if (player.host && this.phase === 'lobby') { if (this.wager && (!this.wagerReady() || this.humans().some((p) => !p.ready))) this.notice(player, `Needs a full ${this.wager.size}v${this.wager.size}, everyone ready.`, 'warn'); else if (!this.team('A').length || !this.team('B').length) this.notice(player, 'Each team needs a pilot or a bot.', 'warn'); else beginMatch(this); } return;
      case 'map-vote': return castMapVote(this, player, message.id);
      case 'rematch': if (this.phase === 'matchEnd') { this.rematch.add(player.id); this.pushRoom(); } return;
      case 'respawn': if (this.mode === 'range' && !player.alive) this.spawn(player); return;
      case 'dev': return this.onDevTool(player, message);
      default:
    }
  }

  // Dev tools. Checked against the account every single time, so nobody else and no bot can hold one.
  onDevTool(player, message) {
    if (!player.dev || player.bot) { player.devTools = {}; return; }
    const action = String(message.action || '');
    if (DEV_ACTION_IDS.includes(action)) {
      if (!player.alive) return;
      if (action === 'heal') { player.hp = 100; player.armor = 100; player.helmet = true; }
      if (action === 'refill') this.refillAmmo(player);
      if (action === 'teleport') {
        const spot = message.to;
        if (!Array.isArray(spot) || spot.length !== 3 || !spot.every(Number.isFinite)) return;
        const { bounds } = this.map;
        player.x = clamp(spot[0], bounds.minX, bounds.maxX);
        player.y = clamp(spot[1], bounds.minY, bounds.maxY + 6);
        player.z = clamp(spot[2], bounds.minZ, bounds.maxZ);
        this.send(player, { type: 'correct', x: player.x, y: player.y, z: player.z });
      }
      this.pushYou(player);
      return;
    }
    const tool = String(message.tool || '');
    if (!DEV_SERVER_TOOLS.includes(tool)) return;
    const on = message.on === true;
    if (on) player.devTools[tool] = true; else delete player.devTools[tool];
    if (tool === 'rich' && on) { player.credits = ECONOMY.max; this.pushYou(player); }
    if (tool === 'ghost') this.pushRoom();
    console.log(`dev tool: ${player.name} turned ${tool} ${on ? 'on' : 'off'} in ${this.name}`);
    this.send(player, { type: 'dev', tools: { ...player.devTools } });
  }

  onTeam(player, team) {
    if (this.phase !== 'lobby' || this.queue !== 'custom' || (team !== 'A' && team !== 'B') || this.team(team).length >= (this.wager ? this.wager.size : MAX_PLAYERS / 2)) return;
    player.team = team; player.ready = false;
    this.pushRoom();
  }

  onRules(player, rules) {
    if (!player.host || this.phase !== 'lobby' || !rules || typeof rules !== 'object') return;
    const next = { ...this.rules };
    if ([3, 5, 7].includes(rules.roundsToWin)) next.roundsToWin = rules.roundsToWin;
    if ([60, 100, 140].includes(rules.roundTime)) next.roundTime = rules.roundTime;
    if ([400, 800, 2000, 9000].includes(rules.startCredits)) next.startCredits = rules.startCredits;
    if (rules.variant === 'auto' || VARIANT_NAMES[rules.variant]) next.variant = rules.variant;
    if (validMapRule(rules.map)) next.map = rules.map;
    if (MODIFIERS[rules.modifier]) next.modifier = rules.modifier;
    if (BOT_DIFFICULTY[rules.botDifficulty]) next.botDifficulty = rules.botDifficulty;
    if (typeof rules.friendlyFire === 'boolean') next.friendlyFire = rules.friendlyFire;
    if (typeof rules.overtimeOn === 'boolean') next.overtime = rules.overtimeOn ? DEFAULT_RULES.overtime : 0;
    this.rules = next;
    // Changing the terms after people have readied up for a stake means they ready again.
    if (this.wager) for (const p of this.humans()) p.ready = false;
    for (const bot of this.players.values()) if (bot.bot && !bot.dummy) bot.difficulty = next.botDifficulty;
    this.pushRoom();
  }

  onState(player, m) {
    if (!player.alive || m.e !== player.epoch) return;
    const values = [m.x, m.y, m.z, m.yaw, m.pitch];
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return;
    const t = now();
    const { bounds } = this.map;
    const x = clamp(m.x, bounds.minX, bounds.maxX), z = clamp(m.z, bounds.minZ, bounds.maxZ), y = clamp(m.y, bounds.minY - 1, bounds.maxY + 6);
    const elapsed = Math.max(1 / 120, t - (player.lastStateAt || t - 0.05));
    const dist = Math.hypot(x - player.x, z - player.z);
    const speed = dist / elapsed;
    // Dev tools loosen the checks for that account only: flying goes through walls, speed moves faster.
    const fly = Boolean(player.devTools?.fly);
    const limit = fly ? 60 : player.devTools?.speed ? 13 * DEV_SPEED : 13;
    let reject = speed > limit && dist > 0.9;
    // During the buy phase pilots stay behind their gate.
    if (this.phase === 'buy' && this.mode === 'match' && !inSpawnZone(this, player, x, z)) reject = true;
    if (!reject && !fly && !this.world.bodyFree(x, y + 0.3, z, BODY.radius * 0.5, 0.9)) reject = true;
    player.lastStateAt = t;
    if (reject) {
      player.strikes += 1;
      if (player.strikes >= 3) { player.strikes = 0; this.send(player, { type: 'correct', x: player.x, y: player.y, z: player.z }); }
      return;
    }
    player.strikes = Math.max(0, player.strikes - 0.2);
    player.speed = player.speed * 0.5 + Math.min(speed, 9) * 0.5;
    player.x = x; player.y = y; player.z = z;
    player.yaw = m.yaw; player.pitch = clamp(m.pitch, -1.5, 1.5);
    const flags = (m.f | 0) & (FLAG.crouch | FLAG.scoped | FLAG.ground | FLAG.walking);
    if ((flags & FLAG.scoped) && !(player.flags & FLAG.scoped)) player.scopedSince = t;
    player.flags = flags;
    if (player.drone && Array.isArray(m.drone) && m.drone.length === 5 && m.drone.every(Number.isFinite)) {
      const d = player.drone;
      const step = Math.hypot(m.drone[0] - d.x, m.drone[1] - d.y, m.drone[2] - d.z);
      if (step < 3 && this.world.bodyFree(m.drone[0], m.drone[1] - 0.15, m.drone[2], 0.15, 0.3)) { d.x = m.drone[0]; d.y = m.drone[1]; d.z = m.drone[2]; }
      d.yaw = m.drone[3]; d.pitch = m.drone[4];
    }
  }

  eyeOf(player) { return [player.x, player.y + ((player.flags & FLAG.crouch) ? BODY.crouchEye : BODY.eye), player.z]; }

  currentWeapon(player) { return WEAPONS[player.weapons[player.active]] || null; }

  switchWeapon(player, slot) {
    if (!player.alive || !['primary', 'sidearm', 'melee'].includes(slot) || !player.weapons[slot] || slot === player.active) return;
    player.active = slot;
    player.reloadEnd = 0;
    player.equipUntil = now() + WEAPONS[player.weapons[slot]].equip - 0.08;
    this.pushYou(player);
  }

  startReload(player) {
    const weapon = this.currentWeapon(player);
    const ammo = player.ammo[player.active];
    if (!player.alive || !weapon || weapon.melee || !ammo || player.reloadEnd) return;
    if (ammo.mag >= weapon.mag || (ammo.reserve <= 0 && this.mode !== 'range')) return;
    player.reloadEnd = now() + weapon.reload - 0.12;
    player.reloadSlot = player.active;
  }

  finishReload(player) {
    const slot = player.reloadSlot;
    player.reloadEnd = 0;
    const weapon = WEAPONS[player.weapons[slot]];
    const ammo = player.ammo[slot];
    if (!weapon || !ammo || slot !== player.active) return;
    if (this.mode === 'range') ammo.reserve = weapon.reserve;
    const loaded = Math.min(weapon.mag - ammo.mag, ammo.reserve);
    ammo.mag += loaded; ammo.reserve -= loaded;
    this.pushYou(player);
  }

  onFire(player, m) {
    if (!Array.isArray(m.o) || !Array.isArray(m.d) || m.o.length !== 3 || m.d.length !== 3 || ![...m.o, ...m.d].every(Number.isFinite)) return;
    const length = Math.hypot(m.d[0], m.d[1], m.d[2]);
    if (length < 0.5) return;
    const dir = [m.d[0] / length, m.d[1] / length, m.d[2] / length];
    let origin = m.o;
    const eye = this.eyeOf(player);
    if (Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) > 2.2) origin = eye;
    const t = now();
    this.fire(player, origin, dir, clamp(Number(m.t) || t, t - MAX_REWIND, t), m.seq | 0);
  }

  // Shared by humans and bots. Returns true when a round actually left the barrel.
  fire(player, origin, dir, rewindTo, seq) {
    const t = now();
    const weapon = this.currentWeapon(player);
    if (!this.live || !player.alive || !weapon || weapon.melee || player.drone) return false;
    const ammo = player.ammo[player.active];
    if (t < player.nextFire - 0.035 || t < player.equipUntil || player.reloadEnd || !ammo || ammo.mag <= 0) { this.pushYou(player); return false; }
    if (!player.devTools?.ammo) ammo.mag -= 1;
    player.nextFire = Math.max(t, player.nextFire) + weapon.cooldown;
    if (t - player.nextFire > 0.2) player.nextFire = t + weapon.cooldown;
    player.lastFireAt = t;
    player.match.shots += 1;
    const scoped = Boolean(player.flags & FLAG.scoped) && t - player.scopedSince >= weapon.scopeTime * 0.5; // generous: the flag arrives a little late over the wire
    const bloom = player.spread[player.active]?.shot(weapon, t) || 0;
    const angle = player.bot ? 0 : spreadAngle(weapon, { scoped, speed: player.speed, airborne: !(player.flags & FLAG.ground), crouched: Boolean(player.flags & FLAG.crouch), bloom });
    const rng = mulberry32(hashString(player.id) + seq * 7919);
    const friendly = this.rules.friendlyFire;
    const targets = [];
    for (const other of this.players.values()) {
      if (other === player || !other.alive || (!friendly && other.team === player.team)) continue;
      targets.push(player.bot ? this.rewind(other, t) : this.rewind(other, rewindTo));
      if (other.drone) targets.push({ id: other.id, kind: 'drone', x: other.drone.x, y: other.drone.y, z: other.drone.z });
    }
    for (const decoy of this.decoys.values()) if (decoy.team !== player.team) targets.push({ id: decoy.id, kind: 'decoy', x: decoy.body.x, y: decoy.body.y, z: decoy.body.z, crouch: false });
    const ends = [];
    const impacts = [];
    const damageBy = new Map();
    let registered = false;
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      const shotDir = applySpread(dir, angle, rng);
      const trace = traceShot(this.world, origin, shotDir, weapon, targets);
      ends.push(trace.end.map(round2));
      trace.impacts.slice(0, 3).forEach((impact) => impacts.push([...impact.point.map(round2), ...impact.normal, impact.mat, impact.exit ? 1 : 0]));
      for (const id of trace.glass) this.breakGlass(id);
      for (const hit of trace.shields) this.damageShield(hit.id, weapon.damage);
      for (const hit of trace.hits) {
        registered = true;
        if (hit.kind === 'drone') { const owner = this.players.get(hit.id); if (owner?.drone) this.endDrone(owner, true, player); continue; }
        if (hit.kind === 'decoy') { this.popDecoy(hit.id, player); continue; }
        const entry = damageBy.get(hit.id) || { amount: 0, zone: 'limb', distance: hit.distance, wallbang: false };
        entry.amount += damageFor(weapon, hit.zone, hit.distance, hit.scale);
        if (hit.zone === 'head' || (hit.zone === 'torso' && entry.zone !== 'head')) entry.zone = hit.zone;
        entry.wallbang = entry.wallbang || hit.wallbang;
        damageBy.set(hit.id, entry);
      }
    }
    if (registered) player.match.hits += 1;
    this.logShot(player, { t, weapon: weapon.id, origin: origin.map(round2), ends, lag: t - rewindTo, hit: registered, mag: ammo.mag });
    this.broadcast({ type: 'shot', id: player.id, w: weapon.id, o: origin.map(round2), e: ends, i: impacts, seq }, (other) => other !== player || player.bot);
    if (!player.bot) this.send(player, { type: 'shot-ack', seq, e: ends, i: impacts });
    for (const [id, entry] of damageBy) {
      const victim = this.players.get(id);
      if (victim) this.applyDamage(victim, player, entry.amount, entry.zone, weapon, { distance: entry.distance, wallbang: entry.wallbang, origin, end: ends[0], lag: t - rewindTo });
    }
    if (weapon.loud > 0) for (const other of this.players.values()) if (other.bot && other.alive && other.team !== player.team) botOnSound(this, other, player, weapon.loud);
    this.pushYou(player);
    return true;
  }

  onMelee(player, m) {
    const t = now();
    const weapon = this.currentWeapon(player);
    if (!this.live || !player.alive || !weapon?.melee || t < player.nextFire - 0.03 || player.drone) return;
    player.nextFire = t + weapon.cooldown;
    this.meleeSwing(player, weapon, clamp(Number(m.t) || t, t - MAX_REWIND, t));
  }

  meleeSwing(player, weapon, rewindTo) {
    const eye = this.eyeOf(player);
    const forward = [-Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
    let best = null;
    for (const other of this.players.values()) {
      if (other === player || !other.alive || (!this.rules.friendlyFire && other.team === player.team)) continue;
      const pos = this.rewind(other, rewindTo);
      const dx = pos.x - player.x, dz = pos.z - player.z, dy = pos.y - player.y;
      const dist = Math.hypot(dx, dz);
      if (dist > weapon.range || Math.abs(dy) > 1.6) continue;
      const facing = dist < 0.4 ? 1 : (dx * forward[0] + dz * forward[2]) / dist;
      if (facing < 0.55 || !this.world.lineOfSight(eye[0], eye[1], eye[2], pos.x, pos.y + 1.2, pos.z)) continue;
      if (!best || dist < best.dist) best = { other, dist };
    }
    this.broadcast({ type: 'swing', id: player.id, hit: Boolean(best) }, (other) => other !== player);
    this.logShot(player, { t: now(), weapon: weapon.id, melee: true, lag: now() - rewindTo, hit: Boolean(best) });
    if (!best) return;
    const victim = best.other;
    const victimForward = [-Math.sin(victim.yaw), -Math.cos(victim.yaw)];
    const behind = victimForward[0] * forward[0] + victimForward[1] * forward[2] > 0.45;
    this.applyDamage(victim, player, behind ? weapon.backstab : weapon.damage, 'torso', weapon, { distance: best.dist, backstab: behind, origin: eye, end: [victim.x, victim.y + 1.2, victim.z], lag: now() - rewindTo });
  }

  applyDamage(victim, attacker, amount, zone, weapon, meta = {}) {
    if (!victim.alive || !this.live) return;
    if (victim.devTools?.god) { this.send(attacker, { type: 'hit', target: victim.id, zone, damage: 0, blocked: true }); return; }
    const modifier = this.rules.modifier;
    if (modifier === 'headhunter' && zone !== 'head' && !weapon.melee) { this.send(attacker, { type: 'hit', target: victim.id, zone, damage: 0, blocked: true }); return; }
    if (modifier === 'instagib' || this.phase === 'overtime') amount = 999;
    let helmetBroke = false;
    if (zone === 'head' && victim.helmet) { amount *= HELMET_FACTOR; victim.helmet = false; helmetBroke = true; }
    let absorbed = 0;
    if (zone !== 'head' && victim.armor > 0 && !meta.backstab) {
      absorbed = Math.min(victim.armor, amount * ARMOR_ABSORB * (1 - (weapon.armorPen || 0)));
      victim.armor -= absorbed;
      amount -= absorbed;
    }
    const dealt = Math.min(victim.hp, Math.max(1, Math.round(amount)));
    victim.hp -= dealt;
    const sameTeam = attacker.team === victim.team;
    if (!sameTeam && !victim.dummy) { attacker.match.damage += dealt; this.roundDamage[attacker.team] += dealt; }
    if (zone === 'head') attacker.match.headshots += 1;
    victim.damageFrom.set(attacker.id, (victim.damageFrom.get(attacker.id) || 0) + dealt);
    const killed = victim.hp <= 0;
    this.send(attacker, { type: 'hit', target: victim.id, zone, damage: dealt, killed, wallbang: Boolean(meta.wallbang), armor: absorbed > 0, helmetBroke, distance: round2(meta.distance || 0) });
    this.send(victim, { type: 'hurt', from: attacker.id, x: round2(attacker.x), z: round2(attacker.z), damage: dealt, zone, helmetBroke });
    if (victim.bot) botOnHurt(this, victim, attacker);
    if (killed) this.kill(victim, attacker, weapon, zone, meta); else this.pushYou(victim);
  }

  kill(victim, killer, weapon, zone, meta = {}) {
    const t = now();
    victim.alive = false; victim.hp = 0; victim.diedThisRound = true; victim.reloadEnd = 0;
    if (victim.drone) this.endDrone(victim, false);
    if (!victim.dummy) victim.match.deaths += 1;
    let assist = null;
    if (killer && killer !== victim) {
      const friendlyKill = killer.team === victim.team;
      if (!victim.dummy && !friendlyKill) {
        killer.match.kills += 1;
        if (victim.bot) killer.match.botKills += 1; else { killer.match.playerKills += 1; killer.match.coinKills += killCoins(killer.level, victim.level); }
        this.roundKills?.set(killer.id, (this.roundKills.get(killer.id) || 0) + 1);
        const record = killer.match.weaponKills[weapon.id] || (killer.match.weaponKills[weapon.id] = { kills: 0, headshots: 0 });
        record.kills += 1;
        if (zone === 'head') { record.headshots += 1; killer.match.headshotKills += 1; }
        killer.match.longest = Math.max(killer.match.longest, meta.distance || 0);
        if ((meta.distance || 0) >= 50) killer.match.longshots += 1;
        if (meta.wallbang) killer.match.wallbangs += 1;
        if (weapon.melee) killer.match.knifeKills += 1;
        if (weapon.slot === 'sidearm') killer.match.sidearmKills += 1;
        this.pay(killer, ECONOMY.kill + (zone === 'head' ? ECONOMY.headshot : 0));
        this.pushYou(killer);
      }
      let bestDamage = 35;
      for (const [id, damage] of victim.damageFrom) {
        const helper = this.players.get(id);
        if (id !== killer.id && helper && helper.team === killer.team && damage >= bestDamage) { bestDamage = damage; assist = helper; }
      }
      if (assist && !victim.dummy) { assist.match.assists += 1; this.pay(assist, ECONOMY.assist); this.pushYou(assist); }
    }
    const event = {
      type: 'kill', killer: killer?.id || null, victim: victim.id, weapon: weapon?.id || null, zone, distance: Math.round(meta.distance || 0),
      wallbang: Boolean(meta.wallbang), backstab: Boolean(meta.backstab), assist: assist?.id || null, reason: meta.reason || null,
      where: zoneAt(this.map, victim.x, victim.y, victim.z), x: round2(victim.x), y: round2(victim.y), z: round2(victim.z),
    };
    this.broadcast(event);
    if (killer && killer !== victim) {
      const record = { t, killer: killer.id, victim: victim.id, weapon: weapon.id, zone, distance: event.distance, origin: meta.origin || this.eyeOf(killer), end: meta.end || [victim.x, victim.y + 1.2, victim.z], lag: meta.lag || 0,
        wallbang: Boolean(meta.wallbang), backstab: Boolean(meta.backstab), killerHp: Math.max(0, Math.round(killer.hp)), killerArmor: Math.round(killer.armor || 0) };
      // Built right away: by match end the position history has already scrolled past this moment.
      const replay = this.buildReplay(record, 4);
      if (!victim.dummy) { this.lastKill = replay; this.roundKill = replay; }
      if (!victim.bot) this.send(victim, { type: 'killcam', replay });
    }
    this.pushYou(victim);
    if (victim.dummy || this.mode === 'range') { victim.respawnAt = t + (victim.dummy ? 2.2 : 2.5); return; }
    this.pushRoom();
    this.checkRoundEnd();
  }

  // Recent shots and swings, so a killcam can replay every round of the fight, not just the last one.
  logShot(player, shot) {
    player.shotLog.push(shot);
    while (player.shotLog.length && player.shotLog[0].t < shot.t - 8) player.shotLog.shift();
  }

  buildReplay(kill, seconds) {
    const t0 = kill.t - seconds;
    // The killer aimed at where everyone else was `lag` seconds earlier (interp delay + ping, which the
    // server rewound for). Delay the other tracks by that much so the replay shows what they actually saw.
    const lag = clamp(kill.lag || 0, 0, MAX_REWIND);
    const tracks = {};
    for (const player of this.players.values()) {
      const shift = player.id === kill.killer ? 0 : lag;
      const samples = player.history.filter((s) => s.t >= t0 - shift - 0.06 && s.t <= kill.t - shift + 0.05);
      if (samples.length) tracks[player.id] = samples.map((s) => [round3(s.t - t0 + shift), round2(s.x), round2(s.y), round2(s.z), round3(s.yaw), round3(s.pitch), s.flags, s.weapon]);
    }
    const killer = this.players.get(kill.killer);
    const shots = (killer?.shotLog || []).filter((shot) => shot.t >= t0 && shot.t <= kill.t + 0.01)
      .map((shot) => ({ t: round3(shot.t - t0), weapon: shot.weapon, melee: Boolean(shot.melee), origin: shot.origin, ends: shot.ends, hit: Boolean(shot.hit), mag: shot.mag }));
    return { ...kill, t: undefined, lag: undefined, duration: seconds, tracks, shots, origin: kill.origin.map(round2), end: kill.end.map(round2) };
  }

  // ---------------------------------------------------------------- world state
  breakGlass(id) {
    if (this.world.disabled.has(id)) return;
    this.world.setDisabled(id);
    const box = this.world.byId.get(id);
    this.broadcast({ type: 'glass', id });
    if (box) for (const bot of this.players.values()) if (bot.bot && bot.alive) botOnSound(this, bot, { x: (box.min[0] + box.max[0]) / 2, y: box.min[1], z: (box.min[2] + box.max[2]) / 2, team: null }, 45);
  }

  damageShield(id, amount) {
    const shield = this.shields.get(id);
    if (!shield) return;
    shield.hp -= amount;
    if (shield.hp <= 0) { this.shields.delete(id); this.world.removeDynamic(id); this.broadcast({ type: 'shield-end', id }); } else this.broadcast({ type: 'shield-hit', id, hp: Math.round(shield.hp) });
  }

  mark(target, duration, reason, teamOverride = null) {
    const team = teamOverride || (target.team === 'A' ? 'B' : 'A');
    this.sendTeam(team, { type: 'mark', id: target.id, until: round3(now() + duration), reason });
  }

  // ---------------------------------------------------------------- economy
  buy(player, item) {
    const free = this.mode === 'range';
    if (!free && this.phase !== 'buy') return this.notice(player, 'Armoury opens between rounds.', 'warn');
    if (!player.alive) return;
    const modifier = this.rules.modifier;
    const charge = (cost) => {
      if (free) return true;
      if (player.credits < cost) { this.notice(player, 'Not enough credits.', 'warn'); return false; }
      player.credits -= cost;
      return true;
    };
    if (WEAPONS[item] && !WEAPONS[item].melee) {
      const weapon = WEAPONS[item];
      if (weapon.slot === 'primary' && modifier === 'sidearms') return this.notice(player, 'Sidearms only.', 'warn');
      if (player.weapons[weapon.slot] === item) return;
      const previous = player.bought[`slot:${weapon.slot}`];
      const refund = previous ? previous.cost : 0;
      if (!free && player.credits + refund < weapon.cost) return this.notice(player, 'Not enough credits.', 'warn');
      if (!free) player.credits += refund - weapon.cost;
      delete player.bought[`slot:${weapon.slot}`];
      if (weapon.cost > 0) player.bought[`slot:${weapon.slot}`] = { cost: weapon.cost, item };
      player.weapons[weapon.slot] = item;
      player.ammo[weapon.slot] = { mag: weapon.mag, reserve: weapon.reserve };
      if (player.active === weapon.slot || weapon.slot === 'primary') { player.active = weapon.slot; player.reloadEnd = 0; }
    } else if (item === 'light' || item === 'heavy') {
      if (modifier === 'instagib') return this.notice(player, 'No armour in One Tap.', 'warn');
      const armor = ARMOR[item];
      if (player.armor >= armor.points) return;
      const previous = player.bought.armor;
      const refund = previous ? previous.cost : 0;
      if (!free && player.credits + refund < armor.cost) return this.notice(player, 'Not enough credits.', 'warn');
      if (!free) player.credits += refund - armor.cost;
      player.bought.armor = { cost: armor.cost, item, before: previous ? previous.before : player.armor };
      player.armor = armor.points;
    } else if (item === 'helmet') {
      if (player.helmet || modifier === 'instagib' || !charge(ARMOR.helmet.cost)) return;
      player.helmet = true; player.bought.helmet = { cost: ARMOR.helmet.cost, item };
    } else if (GADGETS[item]) {
      if (player.gadgets.includes(item)) return;
      if (player.gadgets.length >= GADGET_SLOTS) return this.notice(player, 'Gadget slots full. Click one to sell it.', 'warn');
      if (!charge(GADGETS[item].cost)) return;
      player.gadgets.push(item); player.bought[`gadget:${item}`] = { cost: GADGETS[item].cost, item };
    } else return this.notice(player, 'Not available.', 'warn');
    this.pushYou(player);
    this.pushRoom();
  }

  sell(player, item) {
    if (this.phase !== 'buy' && this.mode !== 'range') return;
    const free = this.mode === 'range';
    const refund = (key) => { const entry = player.bought[key]; if (!entry) return free; if (!free) player.credits += entry.cost; delete player.bought[key]; return true; };
    if (WEAPONS[item] && player.weapons[WEAPONS[item].slot] === item && WEAPONS[item].cost > 0) {
      const slot = WEAPONS[item].slot;
      if (!refund(`slot:${slot}`)) return this.notice(player, 'Only this round’s buys can be refunded.', 'warn');
      player.weapons[slot] = DEFAULT_LOADOUT[slot];
      const weapon = WEAPONS[player.weapons[slot]];
      player.ammo[slot] = { mag: weapon.mag, reserve: weapon.reserve };
    } else if ((item === 'light' || item === 'heavy') && player.bought.armor?.item === item) {
      player.armor = player.bought.armor.before || 0; refund('armor');
    } else if (item === 'helmet' && player.bought.helmet) { player.helmet = false; refund('helmet'); } else if (GADGETS[item] && player.gadgets.includes(item)) {
      if (!refund(`gadget:${item}`)) return this.notice(player, 'Only this round’s buys can be refunded.', 'warn');
      player.gadgets = player.gadgets.filter((id) => id !== item);
    } else return;
    this.pushYou(player);
  }

  // ---------------------------------------------------------------- gadgets
  useGadget(player, m) {
    const id = player.gadgets[m.slot | 0];
    const gadget = GADGETS[id];
    if (!gadget || !player.alive || !this.live || player.drone) return;
    const t = now();
    if (id === 'stim') { if (player.hp >= 100) return this.notice(player, 'Full health.', 'warn'); player.stimUntil = t + gadget.duration; }
    if (id === 'ghost') player.ghostUntil = t + gadget.duration;
    if (id === 'pulse') {
      const found = this.enemiesOf(player).filter((enemy) => Math.hypot(enemy.x - player.x, enemy.z - player.z) <= gadget.radius && !enemy.dummy);
      found.forEach((enemy) => { this.mark(enemy, gadget.duration, 'pulse'); this.notice(enemy, 'You’ve been pulsed', 'warn'); });
      this.broadcast({ type: 'pulse', id: player.id, x: round2(player.x), y: round2(player.y), z: round2(player.z), radius: gadget.radius, found: found.length });
      if (this.mode === 'range') [...this.players.values()].filter((p) => p.dummy && p.alive).forEach((dummy) => this.mark(dummy, gadget.duration, 'pulse', player.team));
    }
    if (id === 'decoy') {
      const decoy = { id: `c${this.nextEntity++}`, owner: player.id, team: player.team, body: makeBody(player.x, player.y, player.z), yaw: player.yaw, until: t + gadget.duration, stuck: 0 };
      decoy.body.onGround = true;
      this.decoys.set(decoy.id, decoy);
    }
    if (id === 'shield') {
      if (!(player.flags & FLAG.ground)) return this.notice(player, 'Land first.', 'warn');
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      const alongX = Math.abs(fz) >= Math.abs(fx);
      const cx = player.x + fx * 1.5, cz = player.z + fz * 1.5;
      const hw = gadget.width / 2, hd = gadget.depth / 2;
      const box = {
        id: `shield-${this.nextEntity++}`, mat: 'shield', shield: true,
        min: [cx - (alongX ? hw : hd), player.y, cz - (alongX ? hd : hw)], max: [cx + (alongX ? hw : hd), player.y + gadget.height, cz + (alongX ? hd : hw)],
      };
      const blocked = this.world.overlaps(box.min[0], box.min[1] + 0.5, box.min[2], box.max[0], box.max[1], box.max[2]);
      const occupied = [...this.players.values()].some((p) => p.alive && p.x + BODY.radius > box.min[0] && p.x - BODY.radius < box.max[0] && p.z + BODY.radius > box.min[2] && p.z - BODY.radius < box.max[2] && Math.abs(p.y - player.y) < 1.8);
      if (blocked || occupied) return this.notice(player, 'No room for the shield.', 'warn');
      const shield = { hp: gadget.hp, view: { id: box.id, min: box.min, max: box.max, team: player.team } };
      this.shields.set(box.id, shield);
      this.world.addDynamic(box);
      this.broadcast({ type: 'shield', ...shield.view });
    }
    if (id === 'drone') {
      const eye = this.eyeOf(player);
      player.drone = { x: eye[0] - Math.sin(player.yaw) * 0.8, y: eye[1] + 0.3, z: eye[2] - Math.cos(player.yaw) * 0.8, yaw: player.yaw, pitch: 0, until: t + gadget.duration, nextScan: 0 };
      if (!this.world.bodyFree(player.drone.x, player.drone.y - 0.15, player.drone.z, 0.15, 0.3)) { player.drone.x = eye[0]; player.drone.z = eye[2]; }
      this.send(player, { type: 'drone-start', ...player.drone });
    }
    player.match.gadgets += 1;
    if (this.mode !== 'range') player.gadgets.splice(m.slot | 0, 1);
    this.broadcast({ type: 'gadget-used', id: player.id, gadget: id, x: round2(player.x), y: round2(player.y), z: round2(player.z) });
    this.pushYou(player);
  }

  endDrone(player, destroyed, by = null) {
    if (!player.drone) return;
    const { x, y, z } = player.drone;
    player.drone = null;
    this.broadcast({ type: 'drone-end', id: player.id, destroyed, x: round2(x), y: round2(y), z: round2(z), by: by?.id || null });
  }

  updateDrones(t) {
    for (const player of this.players.values()) {
      const drone = player.drone;
      if (!drone || t < drone.nextScan) continue;
      drone.nextScan = t + 0.25;
      const forward = [-Math.sin(drone.yaw) * Math.cos(drone.pitch), Math.sin(drone.pitch), -Math.cos(drone.yaw) * Math.cos(drone.pitch)];
      for (const enemy of [...this.players.values()].filter((p) => p.alive && (p.team !== player.team || p.dummy))) {
        const dx = enemy.x - drone.x, dy = enemy.y + 1.1 - drone.y, dz = enemy.z - drone.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > GADGETS.drone.range || dist < 0.01) continue;
        if ((dx * forward[0] + dy * forward[1] + dz * forward[2]) / dist < 0.45) continue;
        if (this.world.lineOfSight(drone.x, drone.y, drone.z, enemy.x, enemy.y + 1.1, enemy.z)) this.mark(enemy, 1.2, 'drone', player.team);
      }
    }
  }

  updateDecoys(dt, t) {
    for (const decoy of this.decoys.values()) {
      if (t >= decoy.until) { this.decoys.delete(decoy.id); this.broadcast({ type: 'decoy-end', id: decoy.id, popped: false }); continue; }
      const body = decoy.body;
      const beforeX = body.x, beforeZ = body.z;
      body.vy -= BODY.gravity * dt;
      this.world.moveBody(body, -Math.sin(decoy.yaw) * BODY.runSpeed * dt, body.vy * dt, -Math.cos(decoy.yaw) * BODY.runSpeed * dt);
      if (Math.hypot(body.x - beforeX, body.z - beforeZ) < BODY.runSpeed * dt * 0.4) {
        decoy.stuck += dt;
        if (decoy.stuck > 0.25) { decoy.yaw += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * 0.6); decoy.stuck = 0; }
      } else decoy.stuck = 0;
    }
  }

  popDecoy(id, shooter) {
    const decoy = this.decoys.get(id);
    if (!decoy) return;
    this.decoys.delete(id);
    this.broadcast({ type: 'decoy-end', id, popped: true, x: round2(decoy.body.x), y: round2(decoy.body.y), z: round2(decoy.body.z) });
    this.mark(shooter, GADGETS.decoy.markTime, 'decoy', decoy.team);
    this.send(shooter, { type: 'hit', target: id, zone: 'torso', damage: 0, decoy: true });
    const owner = this.players.get(decoy.owner);
    if (owner) this.notice(owner, `Decoy hit. ${shooter.name} is marked`, 'good');
  }

  // ---------------------------------------------------------------- social
  onPing(player, m) {
    if (![m.x, m.y, m.z].every(Number.isFinite)) return;
    const t = now();
    if (t - (player.lastPing || 0) < 0.8) return;
    player.lastPing = t;
    this.sendTeam(player.team, { type: 'ping-loc', from: player.id, x: round2(m.x), y: round2(m.y), z: round2(m.z), where: zoneAt(this.map, m.x, m.y, m.z), danger: Boolean(m.danger) });
  }
  onChat(player, m) {
    const text = String(m.text || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 140);
    const t = now();
    if (!text || t - (player.lastChat || 0) < 0.5) return;
    player.lastChat = t;
    const payload = { type: 'chat', from: player.id, name: player.name, team: player.team, text, scope: m.team ? 'team' : 'all', dead: !player.alive && this.live };
    if (m.team) this.sendTeam(player.team, payload); else this.broadcast(payload);
  }
  onQuick(player, m) {
    const command = QUICK_COMMANDS.find((entry) => entry.id === m.id);
    const t = now();
    if (!command || t - (player.lastQuick || 0) < 1.2) return;
    player.lastQuick = t;
    this.sendTeam(player.team, { type: 'quick', from: player.id, name: player.name, id: command.id, where: zoneAt(this.map, player.x, player.y, player.z) });
  }
  onReact(player, m) {
    const t = now();
    if (!REACTIONS.includes(m.emoji) || t - (player.lastReact || 0) < 1) return;
    if (player.alive && this.live) return;
    player.lastReact = t;
    this.broadcast({ type: 'react', from: player.id, name: player.name, emoji: m.emoji });
  }
}
