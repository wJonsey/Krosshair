// Battle royale: up to 50 pilots on Kestrel Island, everyone for themselves, last one standing wins.
// Built on Room: every pilot gets a team of their own, so all the "same team?" checks in combat,
// kill credit and bot targeting already treat it as a free-for-all. Loot lies on the floor and is
// picked up by looking at it and pressing the interact key (bots walk over it); the storm closes in over
// six stages. Everyone drops in from the sky with a blade and nothing else.
import { randomInt } from 'node:crypto';
import { ARMOR, FLAG, GADGETS, GADGET_SLOTS, WEAPONS } from '../shared/constants.js';
import { ROYALE_MAP } from '../shared/map.js';
import { mapFingerprint } from '../shared/version.js';
import { AIRDROP_LOOT, AIRDROP_STAGES, DROP, LOOT_CHANCE, POWERS, LOOT_TABLE, ROYALE, ROYALE_LOADOUT, STORM, royaleWeapon, weaponRarity, weaponTier } from '../shared/royale.js';
import { setRoomMap } from './mapflow.js';
import { Room, freshMatchStats, now } from './room.js';

const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;
const random = () => randomInt(0, 1e9) / 1e9;
const pick = (list) => list[randomInt(list.length)];

export class RoyaleRoom extends Room {
  constructor(options) {
    super({ ...options, queue: 'royale', isPublic: false });
    this.royale = true;
    this.capacity = ROYALE.max;
    setRoomMap(this, ROYALE_MAP);
    this.variant = 'noon';
    this.loot = new Map();
    this.nextLoot = 1;
    this.storm = null;
    this.placements = [];
    this.nextPickup = 0;
    this.nextStormTick = 0;
    this.drops = new Map();      // pilot id → the landing spot they chose
    this.airdrops = [];          // { id, x, z, landAt } still in the air
  }

  // Lobby: everyone waits in one list; teams only mean anything once the match starts.
  join(socket, hello, look) {
    if (this.phase !== 'lobby' && ![...this.players.values()].some((p) => !p.bot && !p.connected && p.session === hello.session)) return null;
    const player = super.join(socket, hello, look);
    if (player && this.phase === 'lobby') { player.team = 'A'; this.pushRoom(); }
    return player;
  }
  scheduleAutoStart() {
    const humans = this.connectedHumans().length;
    if (!humans) { this.autoStartAt = 0; return; }
    const wait = humans >= ROYALE.max ? 3 : ROYALE.lobbyWait;
    this.autoStartAt = this.autoStartAt ? Math.min(this.autoStartAt, now() + wait) : now() + wait;
  }
  fillBots() {
    const target = Math.min(ROYALE.max, Math.max(ROYALE.fill, this.players.size));
    // A spread of skill, so the field has easy pickings and a few real threats.
    while (this.players.size < target) if (!this.addBot('A', pick(['recruit', 'recruit', 'veteran', 'veteran', 'veteran', 'elite']))) break;
  }

  roomState() {
    const state = super.roomState();
    state.royale = { alive: this.alivePilots().length, total: [...this.players.values()].filter((p) => !p.dummy).length };
    return state;
  }
  alivePilots() { return [...this.players.values()].filter((p) => p.alive && !p.dummy); }

  // ---------------------------------------------------------------- match flow
  startMatch() {
    if (!this.connectedHumans().length) return;
    this.fillBots();
    this.round = 1;
    this.scores = { A: 0, B: 0 };
    this.rematch.clear();
    this.autoStartAt = 0;
    this.lastKill = null;
    this.roundKill = null;
    this.placements = [];
    this.variant = pick(this.map.env.variants);
    this.world.resetDisabled();
    this.world.clearDynamic();
    this.shields.clear();
    this.decoys.clear();
    this.roundKills = new Map();
    for (const player of this.players.values()) {
      player.team = player.id;
      player.match = freshMatchStats();
      player.weapons = { ...ROYALE_LOADOUT };
      player.armor = 0; player.helmet = false; player.gadgets = []; player.credits = 0; player.bought = {};
      player.diedThisRound = false; player.pendingJoin = false; player.ready = false; player.placement = 0;
    }
    this.scatterLoot();
    this.storm = null;
    this.airdrops = [];
    this.drops = new Map();
    // First the drop map: everyone picks where to land. Bots pick a named place.
    for (const player of this.players.values()) {
      player.alive = false;
      // Bots: most head for a named place, the rest land out in the countryside.
      if (player.bot) { const place = pick(this.map.places), wild = random() < 0.4; this.drops.set(player.id, wild ? { x: (random() - 0.5) * 520, z: (random() - 0.5) * 520 } : { x: place.x + (random() - 0.5) * 90, z: place.z + (random() - 0.5) * 90 }); }
    }
    this.phase = 'drop';
    this.phaseEnds = now() + ROYALE.dropTime;
    this.broadcast({ type: 'match-start', variant: this.variant, rules: this.rules, map: this.map.id, mapTitle: this.map.title, mapPrint: mapFingerprint(this.map) });
    this.broadcast({ type: 'phase', phase: 'drop', phaseEnds: this.phaseEnds });
    this.pushRoom();
  }
  // The sky is part of the map here: pilots come down from DROP.height.
  onState(player, m) {
    const { bounds } = this.map;
    const roof = bounds.maxY;
    bounds.maxY = bounds.ceiling || roof;
    try { super.onState(player, m); } finally { bounds.maxY = roof; }
  }
  // Look at it, press the key: a pilot picks up one thing, swapping a gun for the one in that slot.
  takeLoot(player, message) {
    const loot = this.loot.get(String(message.id));
    if (!player.alive || this.phase !== 'live' || !loot) return;
    if (Math.hypot(loot.x - player.x, loot.z - player.z) > ROYALE.reach + 1 || Math.abs(loot.y - player.y) > 3) return;
    const text = this.take(player, loot.item, true);
    if (!text) { this.send(player, { type: 'pickup', text: loot.item.kind === 'heal' ? 'Health is full.' : 'No use for that right now.', refused: true }); return; }
    this.loot.delete(loot.id);
    this.broadcast({ type: 'loot-take', id: loot.id, by: player.id });
    const power = loot.item.kind === 'power' ? { power: loot.item.id, seconds: POWERS[loot.item.id].seconds } : {};
    this.send(player, { type: 'pickup', text, ...power });
    this.pushYou(player);
  }
  chooseDrop(player, message) {
    if (this.phase !== 'drop') return;
    const x = Number(message.x), z = Number(message.z), limit = this.map.bounds.maxX - 24;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.drops.set(player.id, { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)) });
  }
  handle(player, message) {
    if (message.type === 'royale-drop') return this.chooseDrop(player, message);
    if (message.type === 'royale-take') return this.takeLoot(player, message);
    return super.handle(player, message);
  }
  // Everyone lands: on the spot they chose, or somewhere with loot if they chose nothing.
  deploy() {
    this.startStorm();
    this.phase = 'live';
    this.phaseEnds = now() + 3600;
    const taken = [];
    for (const player of this.players.values()) {
      if (!(player.bot || player.connected)) { player.alive = false; continue; }
      const point = this.landingPoint(this.drops.get(player.id), taken);
      taken.push(point);
      // Bots ride the parachute straight down to their spot; pilots start a little off theirs and steer.
      const angle = random() * Math.PI * 2, off = player.bot ? 0 : DROP.offset, limit = this.map.bounds.maxX - 12;
      const start = { x: Math.max(-limit, Math.min(limit, point.x + Math.cos(angle) * off)), y: DROP.height + random() * 12, z: Math.max(-limit, Math.min(limit, point.z + Math.sin(angle) * off)), yaw: Math.atan2(Math.cos(angle), Math.sin(angle)) };
      this.spawn(player, 0, start);
      player.flags &= ~FLAG.ground;
      if (player.bot) { player.dropping = true; player.landAt = point; }
      player.match.roundsPlayed = 1;
    }
    this.broadcast({ type: 'phase', phase: 'live', phaseEnds: this.phaseEnds });
    this.sendStorm();
    for (const player of this.humans()) this.sendLoot(player);
    this.pushRoom();
  }
  // The nearest free ground to where they pointed, a few metres clear of anyone already landing there.
  landingPoint(choice, taken) {
    if (!choice) return this.startPoints(1)[0];
    this.groundNodes ||= this.nav.nodes.filter((node) => node.y < 0.2 && Math.abs(node.x) < 280 && Math.abs(node.z) < 280);
    for (const reach of [6, 14, 30, 60]) {
      const near = this.groundNodes.filter((node) => Math.abs(node.x - choice.x) < reach && Math.abs(node.z - choice.z) < reach && taken.every((p) => Math.hypot(p.x - node.x, p.z - node.z) >= 5));
      if (near.length) { const node = pick(near); return { x: node.x, y: node.y, z: node.z, yaw: Math.atan2(node.x, node.z) }; }
    }
    return this.startPoints(1)[0];
  }

  // Random walkable ground points, at least ROYALE.spread apart where possible.
  startPoints(count) {
    const ground = this.nav.nodes.filter((node) => node.y < 0.2 && Math.abs(node.x) < 270 && Math.abs(node.z) < 270);
    const points = [];
    // Most pilots land near somewhere with loot, the rest out in the open.
    const nearLoot = ground.filter((node) => this.map.loot.some(([x, , z]) => Math.abs(x - node.x) < 30 && Math.abs(z - node.z) < 30));
    for (let attempt = 0; attempt < count * 60 && points.length < count; attempt += 1) {
      const node = pick(random() < 0.75 && nearLoot.length ? nearLoot : ground);
      const gap = attempt < count * 40 ? ROYALE.spread : ROYALE.spread / 3;
      if (points.every((p) => Math.hypot(p.x - node.x, p.z - node.z) >= gap)) points.push({ x: node.x, y: node.y, z: node.z, yaw: random() * Math.PI * 2 });
    }
    while (points.length < count) points.push({ ...pick(ground), yaw: 0 });
    return points;
  }

  // ---------------------------------------------------------------- loot
  rollLoot() {
    const total = LOOT_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    const entry = LOOT_TABLE.find((candidate) => (roll -= candidate.weight) < 0) || LOOT_TABLE[0];
    if (entry.pool) { const id = pick(entry.pool); return entry.kind === 'weapon' ? { kind: 'weapon', id, rarity: weaponRarity(id) } : { kind: entry.kind, id }; }
    if (entry.kind === 'heal') return { kind: 'heal', amount: entry.amount };
    return { kind: entry.kind };
  }
  addLoot(x, y, z, item, announce = true) {
    const loot = { id: `l${this.nextLoot++}`, x: round2(x), y: round2(y), z: round2(z), item };
    this.loot.set(loot.id, loot);
    if (announce) this.broadcast({ type: 'loot-add', loot: [loot] });
    return loot;
  }
  scatterLoot() {
    this.loot.clear();
    for (const [x, y, z] of this.map.loot) if (random() < LOOT_CHANCE) this.addLoot(x, y, z, this.rollLoot(), false);
    // A little extra in the open so nobody starts miles from anything.
    const ground = this.nav.nodes.filter((node) => node.y < 0.2);
    for (let i = 0; i < 80; i += 1) { const node = pick(ground); this.addLoot(node.x, node.y, node.z, this.rollLoot(), false); }
  }
  // Walk over something to take it. Guns only replace the one you hold if you crouch over them.
  collectLoot(t) {
    if (t < this.nextPickup) return;
    this.nextPickup = t + 0.15;
    for (const player of this.players.values()) {
      if (!player.alive || player.dummy) continue;
      for (const loot of this.loot.values()) {
        if (Math.abs(loot.x - player.x) > ROYALE.pickupRange || Math.abs(loot.z - player.z) > ROYALE.pickupRange || Math.abs(loot.y - player.y) > 1.6) continue;
        if (Math.hypot(loot.x - player.x, loot.z - player.z) > ROYALE.pickupRange) continue;
        if (loot.dropper === player.id && t < loot.dropUntil) continue;
        // Pilots choose what they pick up; only ammo is scooped up on the way past.
        if (!player.bot && loot.item.kind !== 'ammo') continue;
        const text = this.take(player, loot.item, Boolean(player.flags & FLAG.crouch) || (player.bot && this.botWants(player, loot.item)));
        if (!text) continue;
        this.loot.delete(loot.id);
        this.broadcast({ type: 'loot-take', id: loot.id, by: player.id });
        if (!player.bot) this.send(player, { type: 'pickup', text });
        this.pushYou(player);
      }
    }
  }
  // Returns what was picked up, or null if the pilot has no use for it right now.
  take(player, item, swap) {
    if (item.kind === 'weapon') {
      // The gun as its rarity carries it: a better kept gun holds more and reloads faster.
      const weapon = royaleWeapon(WEAPONS[item.id], item.rarity);
      if (!weapon) return null;
      const slot = weapon.slot;
      const held = player.weapons[slot];
      if (held === item.id) {
        const ammo = player.ammo[slot];
        if (!ammo || ammo.reserve >= weapon.reserve) return null;
        ammo.reserve = weapon.reserve;
        return `${weapon.short} ammo`;
      }
      if (held && !swap) return null;
      // The gun you put down ignores you for a moment, or crouching would swap them back and forth.
      if (held) Object.assign(this.addLoot(player.x, player.y, player.z, { kind: 'weapon', id: held, rarity: player.rarity?.[slot] }), { dropper: player.id, dropUntil: now() + 2.5 });
      player.weapons[slot] = item.id;
      (player.rarity = player.rarity || {})[slot] = item.rarity || weaponRarity(item.id);
      player.kit = null; player.kitFor = null;
      player.ammo[slot] = { mag: weapon.mag, reserve: weapon.reserve };
      if (player.active !== slot && (slot === 'primary' || player.active === 'melee')) this.switchWeapon(player, slot);
      else if (player.active === slot) { player.reloadEnd = 0; player.equipUntil = now() + weapon.equip - 0.08; }
      return weapon.name;
    }
    if (item.kind === 'armor') {
      const armor = ARMOR[item.id];
      if (player.armor >= armor.points) return null;
      player.armor = armor.points;
      return armor.name;
    }
    if (item.kind === 'helmet') { if (player.helmet) return null; player.helmet = true; return ARMOR.helmet.name; }
    if (item.kind === 'gadget') {
      if (player.gadgets.length >= GADGET_SLOTS || player.gadgets.includes(item.id)) return null;
      player.gadgets.push(item.id);
      return GADGETS[item.id].name;
    }
    if (item.kind === 'power') {
      const power = POWERS[item.id];
      if (!power || player.bot) return null;
      player.power = { id: item.id, until: now() + power.seconds };
      return power.name;
    }
    if (item.kind === 'heal') {
      if (player.hp >= 100) return null;
      player.hp = Math.min(100, player.hp + item.amount);
      return `Medkit +${item.amount}`;
    }
    if (item.kind === 'ammo') {
      let topped = false;
      for (const slot of ['primary', 'sidearm']) {
        const weapon = WEAPONS[player.weapons[slot]], ammo = player.ammo[slot];
        if (weapon && ammo && ammo.reserve < weapon.reserve) { ammo.reserve = weapon.reserve; topped = true; }
      }
      return topped ? 'Ammo' : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- storm
  startStorm() {
    const half = (this.map.bounds.maxX - this.map.bounds.minX) / 2;
    this.storm = { stage: -1, half, from: { x: 0, z: 0, r: half * 1.5 }, to: { x: 0, z: 0, r: half * 1.5 }, shrinkStart: 0, shrinkEnd: 0, damage: 0, nextAt: now() };
    this.nextStage(now());
  }
  nextStage(t) {
    const storm = this.storm;
    storm.stage += 1;
    const stage = STORM[storm.stage];
    if (!stage) { storm.nextAt = Infinity; return; }
    const current = this.circle(t);
    // The next safe circle sits somewhere inside the current one.
    const r = Math.max(stage.radius * storm.half, 6);
    const room = Math.max(0, current.r - r);
    const angle = random() * Math.PI * 2, dist = Math.sqrt(random()) * room * 0.8;
    const limit = storm.half - r - 10;
    const x = Math.max(-limit, Math.min(limit, current.x + Math.cos(angle) * dist));
    const z = Math.max(-limit, Math.min(limit, current.z + Math.sin(angle) * dist));
    storm.from = current;
    storm.to = { x: round2(x), z: round2(z), r: round2(r) };
    storm.shrinkStart = t + stage.wait;
    storm.shrinkEnd = storm.shrinkStart + stage.shrink;
    storm.damage = stage.damage;
    storm.nextAt = storm.shrinkEnd;
    this.sendStorm();
    if (AIRDROP_STAGES.includes(storm.stage)) this.callAirdrop(t);
  }
  // A crate of the good stuff, dropped inside the next circle. Everyone is told where.
  callAirdrop(t) {
    const { to } = this.storm;
    // Open ground only: a few tries, since a hill or a roof may be the nearest thing to the first pick.
    let node = null;
    for (let attempt = 0; attempt < 12 && !(node && node.y <= 0.2); attempt += 1) {
      const angle = random() * Math.PI * 2, dist = Math.sqrt(random()) * to.r * 0.7;
      node = this.nav.nearest(to.x + Math.cos(angle) * dist, 0, to.z + Math.sin(angle) * dist);
    }
    if (!node || node.y > 0.2) return;
    const drop = { id: `a${this.nextLoot++}`, x: node.x, z: node.z, landAt: round3(t + ROYALE.airdropFall) };
    this.airdrops.push(drop);
    this.broadcast({ type: 'airdrop', drop });
  }
  landAirdrops(t) {
    for (const drop of this.airdrops.filter((entry) => t >= entry.landAt)) {
      this.airdrops.splice(this.airdrops.indexOf(drop), 1);
      AIRDROP_LOOT.forEach((entry, i) => {
        const a = (i / AIRDROP_LOOT.length) * Math.PI * 2;
        const item = entry.pool ? { kind: entry.kind, id: pick(entry.pool) } : entry.kind === 'heal' ? { kind: 'heal', amount: entry.amount } : { kind: entry.kind };
        this.addLoot(drop.x + Math.cos(a) * 1.6, 0, drop.z + Math.sin(a) * 1.6, item);
      });
      this.broadcast({ type: 'airdrop-landed', id: drop.id });
    }
  }
  circle(t) {
    const { from, to, shrinkStart, shrinkEnd } = this.storm;
    const k = t <= shrinkStart ? 0 : t >= shrinkEnd ? 1 : (t - shrinkStart) / (shrinkEnd - shrinkStart);
    return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, r: from.r + (to.r - from.r) * k };
  }
  outside(player, t) { const c = this.circle(t); return Math.hypot(player.x - c.x, player.z - c.z) > c.r; }
  tickStorm(t) {
    if (t >= this.storm.nextAt) this.nextStage(t);
    if (t < this.nextStormTick) return;
    this.nextStormTick = t + 0.5;
    for (const player of this.players.values()) {
      if (!player.alive || player.dummy || !this.outside(player, t)) continue;
      player.hp -= this.storm.damage * 0.5;
      if (player.hp <= 0) { player.hp = 0; this.kill(player, null, null, 'torso', { reason: 'storm' }); } else this.pushYou(player);
    }
  }
  stormState() {
    const storm = this.storm;
    return storm && { stage: storm.stage, stages: STORM.length, from: storm.from, to: storm.to, shrinkStart: round3(storm.shrinkStart), shrinkEnd: round3(storm.shrinkEnd), damage: storm.damage };
  }
  sendStorm() { this.broadcast({ type: 'royale', alive: this.alivePilots().length, storm: this.stormState() }); }
  // The whole floor, once per pilot; after that only 'loot-add' and 'loot-take'.
  sendLoot(player) { this.send(player, { type: 'loot', loot: [...this.loot.values()] }); }
  welcome(player, reconnected) {
    super.welcome(player, reconnected);
    if (this.phase === 'live') { this.send(player, { type: 'royale', alive: this.alivePilots().length, storm: this.stormState() }); this.sendLoot(player); for (const drop of this.airdrops) this.send(player, { type: 'airdrop', drop }); }
  }

  // ---------------------------------------------------------------- deaths and the end
  kill(victim, killer, weapon, zone, meta = {}) {
    if (!victim.alive) return;
    const place = this.alivePilots().length;
    // What they carried lands where they fell.
    if (!victim.dummy) {
      const drops = [];
      if (victim.weapons.primary) drops.push({ kind: 'weapon', id: victim.weapons.primary });
      if (victim.weapons.sidearm) drops.push({ kind: 'weapon', id: victim.weapons.sidearm });
      if (victim.armor >= ARMOR.heavy.points) drops.push({ kind: 'armor', id: 'heavy' }); else if (victim.armor > 0) drops.push({ kind: 'armor', id: 'light' });
      drops.push({ kind: 'ammo' });
      drops.forEach((item, i) => { const a = (i / drops.length) * Math.PI * 2; this.addLoot(victim.x + Math.cos(a) * 0.9, victim.y, victim.z + Math.sin(a) * 0.9, item); });
    }
    victim.placement = place;
    this.placements.push(victim.id);
    super.kill(victim, killer, weapon, zone, meta);
    if (!victim.bot) this.send(victim, { type: 'royale-out', placement: place, total: this.placements.length + this.alivePilots().length, by: killer?.name || null, storm: meta.reason === 'storm' });
    this.broadcast({ type: 'royale', alive: this.alivePilots().length });
  }
  checkRoundEnd() {
    if (this.phase !== 'live') return;
    const alive = this.alivePilots();
    if (alive.length > 1) return;
    if (alive[0]) alive[0].placement = 1;
    this.endMatch(alive[0] || null);
  }
  resolveTimeout() { this.phaseEnds = now() + 3600; }

  endMatch(winner = null) {
    this.phase = 'matchEnd';
    this.phaseEnds = now() + this.rules.matchEndTime;
    if (this.storm) this.storm.nextAt = Infinity;
    const everyone = [...this.players.values()].filter((p) => !p.dummy);
    const humans = everyone.filter((p) => !p.bot).length;
    const topKills = Math.max(1, ...everyone.map((p) => p.match.kills));
    const table = everyone.map((p) => ({
      id: p.id, name: p.name, team: p.team, bot: p.bot, score: p.match.kills * 100 + Math.round(p.match.damage / 5), kills: p.match.kills, playerKills: p.match.playerKills, botKills: p.match.botKills,
      deaths: p.match.deaths, assists: 0, damage: Math.round(p.match.damage), headshots: p.match.headshots, accuracy: p.match.shots ? Math.round((p.match.hits / p.match.shots) * 100) : 0,
      longest: Math.round(p.match.longest), mvp: p === winner, color: p.color, title: p.title, placement: p.placement || 1,
    })).sort((m, n) => m.placement - n.placement || n.kills - m.kills);
    this.broadcast({ type: 'match-end', winner: winner?.team || null, scores: { A: 0, B: 0 }, table, mvp: winner?.id || null, phaseEnds: this.phaseEnds, variant: this.variant, modifier: this.rules.modifier, queue: 'royale', royale: true, replay: this.lastKill });
    for (const player of this.humans()) {
      const won = player === winner;
      const report = this.profiles.recordMatch(player.token, {
        ...player.match, won, draw: false, ranked: false, ratingDelta: 0, mode: 'royale', variant: this.variant,
        score: `#${player.placement || 1} of ${everyone.length}`, mvp: won, vsHumans: humans >= 2, topKills: humans >= 2 && player.match.kills === topKills,
        rivals: everyone.filter((p) => !p.bot && p !== player).map((p) => p.name).slice(0, 12),
      });
      report.placement = player.placement || 1;
      this.send(player, { type: 'report', report, profile: this.profiles.view(player.token) });
    }
    this.pushRoom();
  }
  toLobby() {
    this.loot.clear();
    this.storm = null;
    for (const player of this.players.values()) player.team = 'A';
    super.toLobby();
  }

  // ---------------------------------------------------------------- per tick
  tick() {
    super.tick();
    if (this.closed) return;
    if (this.phase === 'drop' && now() >= this.phaseEnds) this.deploy();
    if (this.phase !== 'live') return;
    const t = now();
    for (const bot of this.players.values()) {
      if (!bot.dropping || !bot.alive) continue;
      const dt = 1 / 30;
      bot.y -= (bot.y > DROP.chuteAt ? DROP.fall : DROP.chuteFall) * dt;
      bot.x += (bot.landAt.x - bot.x) * Math.min(1, dt * 0.8); bot.z += (bot.landAt.z - bot.z) * Math.min(1, dt * 0.8);
      if (bot.y <= bot.landAt.y) { Object.assign(bot, { x: bot.landAt.x, y: bot.landAt.y, z: bot.landAt.z, dropping: false }); bot.flags |= FLAG.ground; }
    }
    this.tickStorm(t);
    this.landAirdrops(t);
    this.collectLoot(t);
  }

  // Bots: into the safe circle when outside it, to a gun when they have none, then roam inside the circle.
  // A destination is kept until it's reached, goes stale or the storm moves past it: re-picking every
  // time a bot heard a shot left them wandering in circles.
  botGoal(bot, t) {
    if (!this.storm || this.phase !== 'live') return null;
    const target = this.storm.to;
    const inside = (x, z, share = 0.8) => Math.hypot(x - target.x, z - target.z) < target.r * share;
    const outside = !inside(bot.x, bot.z, 0.85);
    if (!outside && bot.ai.lastKnown && t - bot.ai.lastKnown.t < 14) return null;
    const kept = bot.ai.royaleGoal;
    // A kept roam is dropped every few seconds for a look around: something useful may be lying close by.
    const rescan = kept && !kept.loot && t >= (bot.ai.nextLootScan || 0);
    if (rescan) bot.ai.nextLootScan = t + 3;
    if (kept && !rescan && t < kept.until && inside(kept.x, kept.z, 0.9) && (kept.loot ? this.loot.has(kept.loot) : Math.hypot(kept.x - bot.x, kept.z - bot.z) > 4)) return kept;
    const keep = (goal) => (bot.ai.royaleGoal = { ...goal, until: t + 30 });
    // Loot worth a detour: a gun when they have none (from far away), otherwise anything useful close by.
    const reach = bot.weapons.primary ? 38 : 130;
    let best = null, bestDist = reach;
    const toZone = Math.hypot(bot.x - target.x, bot.z - target.z);
    for (const loot of this.loot.values()) {
      const dx = loot.x - bot.x, dz = loot.z - bot.z;
      if (Math.abs(dx) > bestDist || Math.abs(dz) > bestDist || !this.botWants(bot, loot.item)) continue;
      if (!inside(loot.x, loot.z, 0.95) && Math.hypot(loot.x - target.x, loot.z - target.z) > toZone) continue;
      const dist = Math.hypot(dx, dz) * (loot.item.kind === 'weapon' && !bot.weapons.primary ? 0.5 : 1);
      if (dist < bestDist) { best = loot; bestDist = dist; }
    }
    if (best) return keep({ x: best.x, y: best.y, z: best.z, loot: best.id });
    // An airdrop on its way down draws the bolder ones.
    const drop = this.airdrops.find((entry) => Math.hypot(entry.x - bot.x, entry.z - bot.z) < 140);
    bot.ai.bold ??= random() < 0.5;
    if (drop && bot.ai.bold) return keep({ x: drop.x, y: 0, z: drop.z });
    if (rescan && t < kept.until && inside(kept.x, kept.z, 0.9) && Math.hypot(kept.x - bot.x, kept.z - bot.z) > 4) return kept;
    // Somewhere inside the circle, preferring loot spots not too far away.
    const spots = this.map.loot.filter(([x, , z]) => inside(x, z) && Math.hypot(x - bot.x, z - bot.z) < 160);
    if (spots.length && random() < 0.7) { const [x, y, z] = pick(spots); return keep({ x, y, z }); }
    const angle = random() * Math.PI * 2, dist = Math.sqrt(random()) * target.r * 0.7;
    const node = this.nav.nearest(target.x + Math.cos(angle) * dist, 0, target.z + Math.sin(angle) * dist);
    return node ? keep({ x: node.x, y: node.y, z: node.z }) : null;
  }

  // Would this bot bother walking to it (and, for a gun, trade what it holds for it)?
  botWants(bot, item) {
    if (item.kind === 'weapon') {
      const weapon = WEAPONS[item.id];
      if (!weapon) return false;
      const held = bot.weapons[weapon.slot];
      if (held === item.id) return (bot.ammo[weapon.slot]?.reserve ?? 0) < weapon.reserve * 0.4;
      if (!held) return true;
      return weaponTier(item.id) > weaponTier(held);
    }
    if (item.kind === 'armor') return ARMOR[item.id].points > bot.armor;
    if (item.kind === 'helmet') return !bot.helmet;
    if (item.kind === 'heal') return bot.hp < 75;
    if (item.kind === 'gadget') return bot.gadgets.length < GADGET_SLOTS && !bot.gadgets.includes(item.id);
    if (item.kind === 'ammo') return ['primary', 'sidearm'].some((slot) => WEAPONS[bot.weapons[slot]] && (bot.ammo[slot]?.reserve ?? 0) < WEAPONS[bot.weapons[slot]].reserve * 0.4);
    return false;
  }

  // With only a pistol a bot minds its own business unless someone is close.
  // Caught out in the storm, they run rather than trade shots, unless someone is right on top of them.
  botSightRange(bot) {
    if (this.storm && this.phase === 'live' && this.botMustMove(bot, now())) return 14;
    if (bot.dropping || (!bot.weapons.primary && !bot.weapons.sidearm)) return 0;
    return bot.weapons.primary ? null : 28;
  }

  // Out in the storm, or about to be when this stage closes: run for it.
  botMustMove(bot, t) {
    if (!this.storm || this.phase !== 'live') return false;
    const { to } = this.storm;
    // Leave early enough to walk it: the further out, the sooner they set off.
    const over = Math.hypot(bot.x - to.x, bot.z - to.z) - to.r * 0.9;
    if (over <= 0) return this.outside(bot, t);
    return this.outside(bot, t) || t > this.storm.shrinkEnd - (over / 4 + 20);
  }

  // Snapshots: each pilot only hears about the pilots near enough to matter.
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
      rows.push({ player, row: [player.id, round2(player.x), round2(player.y), round2(player.z), round3(player.yaw), round3(player.pitch), flags, player.weapons[player.active] || 'knife', 0] });
    }
    const range = ROYALE.viewRange;
    for (const viewer of this.humans()) {
      if (!viewer.connected || !viewer.socket) continue;
      // Dead pilots watch someone else, so they see around whoever they last followed: the whole field.
      const near = viewer.alive ? rows.filter(({ player }) => player === viewer || (Math.abs(player.x - viewer.x) < range && Math.abs(player.z - viewer.z) < range)) : rows;
      this.send(viewer, { type: 's', t: round3(t), p: near.map(({ row }) => row) });
    }
  }
}
