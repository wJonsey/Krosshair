// Battle royale: up to 50 pilots on Kestrel Island, everyone for themselves, last one standing wins.
// Built on Room: every pilot gets a team of their own, so all the "same team?" checks in combat,
// kill credit and bot targeting already treat it as a free-for-all. Loot lies on the floor and is
// picked up by looking at it and pressing the interact key (bots walk over it); the storm closes in over
// six stages. Everyone drops in from the sky with a blade and nothing else.
import { randomInt } from 'node:crypto';
import { ARMOR, FLAG, GADGETS, GADGET_SLOTS, WEAPONS } from '../shared/constants.js';
import { ROYALE_MAP } from '../shared/map.js';
import { mapFingerprint } from '../shared/version.js';
import { AIRDROP_LOOT, AIRDROP_STAGES, DEPLOY, LOOT_CHANCE, POWERS, LOOT_TABLE, ROYALE, ROYALE_LOADOUT, STORM, aircraftAt, flightPlan, flightRoute, lootInSight, rampAt, royaleWeapon, weaponRarity, weaponTier } from '../shared/royale.js';
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
    this.drops = new Map();      // pilot id → the landing spot they marked (navigation, and where bots head)
    this.airdrops = [];          // { id, x, z, landAt } still in the air
    this.flight = null;          // the transport's plan for this match (shared/royale.js flightPlan)
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
    const seated = () => [...this.players.values()].filter((p) => !p.watching).length;
    const target = Math.min(ROYALE.max, Math.max(ROYALE.fill, seated()));
    // A spread of skill, so the field has easy pickings and a few real threats.
    while (seated() < target) if (!this.addBot('A', pick(['recruit', 'recruit', 'veteran', 'veteran', 'veteran', 'elite']))) break;
  }

  roomState() {
    const state = super.roomState();
    state.royale = { alive: this.alivePilots().length, total: [...this.players.values()].filter((p) => !p.dummy && !p.watching).length };
    return state;
  }
  // A developer watching from the online card. Royale sends positions and loot to each pilot itself
  // rather than through broadcast, and humans() leaves watchers out on purpose, so they are added here or
  // a watcher sees an empty island.
  watchers() { return [...this.players.values()].filter((p) => p.watching && p.connected && p.socket); }
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
      if (player.watching) continue;   // not in the match: no team, no kit, no placement
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
    // Everyone boards one transport, flying a line across the island. The countdown is flown too, so
    // it is already on its way in when the match goes live and the ramp opens a moment after.
    const half = this.map.bounds.maxX;
    this.flight = flightPlan(flightRoute(half, random), now(), half);
    const plane = aircraftAt(this.flight, now());
    // Bots each take a spot of their own, spread over the whole island rather than piling into the
    // named places, and go off the ramp somewhere near where the line passes it.
    const bots = [...this.players.values()].filter((p) => p.bot && !p.watching);
    const spots = this.startPoints(bots.length);
    for (const player of this.players.values()) {
      if (player.watching) continue;
      if (!(player.bot || player.connected)) { player.alive = false; continue; }
      this.board(player, plane);
      if (player.bot) {
        const target = spots[bots.indexOf(player)];
        this.drops.set(player.id, target);
        player.jumpAt = Math.min(this.flight.ejectAt, this.nearestPass(target) + (random() - 0.5) * 6);
      }
    }
    this.phase = 'drop';
    this.phaseEnds = this.flight.liveAt;
    this.broadcast({ type: 'match-start', variant: this.variant, rules: this.rules, map: this.map.id, mapTitle: this.map.title, mapPrint: mapFingerprint(this.map) });
    this.broadcast({ type: 'phase', phase: 'drop', phaseEnds: this.phaseEnds });
    this.broadcast({ type: 'royale-flight', flight: this.flight });
    for (const player of this.humans()) this.pushYou(player);
    this.pushRoom();
  }
  // Aboard: alive and in the match, but nowhere anyone can reach. No snapshot, no damage, no storm.
  board(player, plane) {
    Object.assign(player, { alive: true, inPlane: true, inDrop: false, hp: 100, x: plane.x, y: plane.y, z: plane.z, yaw: plane.heading, pitch: 0, flags: 0, speed: 0, history: [], footing: plane.y, active: 'melee' });
    player.epoch += 1;          // anything sent from before boarding is old news
    player.dropping = Boolean(player.bot);
    player.match.roundsPlayed = 1;
    this.refillAmmo(player);
  }
  // When the aircraft is nearest a spot: when a bot heading there goes off the ramp.
  nearestPass(target) {
    const f = this.flight, along = (target.x - f.from[0]) * f.dir[0] + (target.z - f.from[1]) * f.dir[1];
    return Math.max(f.doorsAt + 0.5, Math.min(f.ejectAt, f.launchAt + along / f.speed));
  }
  // Off the ramp: the pilot is placed at the ramp's edge, where the aircraft is right now, and falls.
  exit(player, t = now()) {
    const ramp = rampAt(aircraftAt(this.flight, t)), edge = this.map.bounds.maxX - 2;
    ramp.x = Math.max(-edge, Math.min(edge, ramp.x)); ramp.z = Math.max(-edge, Math.min(edge, ramp.z));
    this.spawn(player, 0, { x: ramp.x, y: ramp.y, z: ramp.z, yaw: this.flight.heading });
    player.flags &= ~FLAG.ground;
    player.jumpedAt = t;
    player.match.roundsPlayed = 1;
    if (player.bot) {
      // Its spot, or as near it as a glide from here reaches: the aircraft is high enough that it nearly
      // always does.
      const aim = this.drops.get(player.id) || { x: ramp.x, z: ramp.z };
      const gap = Math.hypot(aim.x - ramp.x, aim.z - ramp.z), reach = (ramp.y / DEPLOY.bot.chuteFall) * DEPLOY.bot.glide * 0.9, k = gap > reach ? reach / gap : 1;
      player.dropping = true;
      player.landAt = this.landingPoint({ x: ramp.x + (aim.x - ramp.x) * k, z: ramp.z + (aim.z - ramp.z) * k }, []);
    } else player.inDrop = true;
  }
  // The pilot asked to go. Only from aboard, only once, only with the ramp open.
  jump(player) {
    const t = now();
    if (this.phase !== 'live' || !this.flight || !player.alive || !player.inPlane || t < this.flight.doorsAt) return;
    this.exit(player, t);
  }
  // Riders move with the aircraft; anyone still aboard at the far coast goes anyway.
  fly(t) {
    if (!this.flight) return;
    const plane = aircraftAt(this.flight, t);
    for (const player of this.players.values()) {
      if (!player.inPlane) continue;
      player.x = plane.x; player.y = plane.y; player.z = plane.z;
      if (this.phase === 'live' && (t >= this.flight.ejectAt || (player.bot && t >= player.jumpAt))) this.exit(player, t);
    }
  }
  youState(player) { return { ...super.youState(player), inPlane: Boolean(player.inPlane) }; }
  // The sky is part of the map here: pilots come down from the aircraft. Aboard, the aircraft decides
  // where you are, so nothing a rider says about their position is taken.
  onState(player, m) {
    if (player.inPlane) return;
    const { bounds } = this.map;
    const roof = bounds.maxY;
    bounds.maxY = bounds.ceiling || roof;
    try { super.onState(player, m); } finally { bounds.maxY = roof; }
    // The chute counts from when the server first heard it was open, and never before a moment of free
    // fall. Once open it stays open as far as the descent limit is concerned.
    if (player.inDrop && (m.f & FLAG.chute) && !player.chuteSince && now() - player.jumpedAt >= DEPLOY.parachute.minFreefall) player.chuteSince = now();
  }
  // The fall is the pilot's own movement, so one message used to land them from the sky, looting before
  // anyone else was down. Free fall until the chute has had time to open, whether they opened it or it
  // opened itself near the ground, then chute speed.
  fallLimit(player) {
    if (!player.inDrop) return super.fallLimit(player);
    const t = now();
    const above = player.y - this.world.groundBelow(player.x, player.y + 0.2, player.z);
    if (above < DEPLOY.autoDeploy && !player.lowSince) player.lowSince = t;
    const slowed = (since) => since && t - since > DEPLOY.parachute.open + 0.4;
    return slowed(player.chuteSince) || slowed(player.lowSince) ? DEPLOY.parachute.dive * 1.3 : DEPLOY.freefall.dive * 1.12;
  }
  // Look at it, press the key: a pilot picks up one thing, swapping a gun for the one in that slot.
  takeLoot(player, message) {
    const loot = this.loot.get(String(message.id));
    if (!player.alive || player.inPlane || this.phase !== 'live' || !loot) return;
    if (Math.hypot(loot.x - player.x, loot.z - player.z) > ROYALE.reach + 1 || Math.abs(loot.y - player.y) > 3) return;
    if (!lootInSight(this.world, this.eyeOf(player), loot)) return;
    const text = this.take(player, loot.item, true);
    if (!text) { this.send(player, { type: 'pickup', text: loot.item.kind === 'heal' ? 'Health is full.' : 'No use for that right now.', refused: true }); return; }
    this.loot.delete(loot.id);
    this.broadcast({ type: 'loot-take', id: loot.id, by: player.id });
    const power = loot.item.kind === 'power' ? { power: loot.item.id, seconds: POWERS[loot.item.id].seconds } : {};
    this.send(player, { type: 'pickup', text, ...power });
    this.pushYou(player);
  }
  // A marker to steer by. It moves nobody: bots head for theirs, pilots fly to theirs themselves.
  chooseDrop(player, message) {
    if (this.phase !== 'drop' && !(this.phase === 'live' && (player.inPlane || player.inDrop))) return;
    const x = Number(message.x), z = Number(message.z), limit = this.map.bounds.maxX - 24;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.drops.set(player.id, { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)) });
  }
  handle(player, message) {
    // Before royale's own messages, or a watcher could pick a drop, take loot and throw it about.
    if (player.watching) return super.handle(player, message);
    if (message.type === 'royale-drop') return this.chooseDrop(player, message);
    if (message.type === 'royale-jump') return this.jump(player);
    if (message.type === 'royale-take') return this.takeLoot(player, message);
    if (message.type === 'royale-toss') return this.toss(player, message);
    return super.handle(player, message);
  }

  // Putting something down on purpose, from the inventory. A gun goes down with what is in it, the same
  // as one swapped out, so this is not a way to launder ammo. The blade does not go: it is what you land
  // with, and a pilot with nothing at all would just be standing there.
  toss(player, message) {
    if (!player.alive || this.phase !== 'live') return;
    const put = (item) => Object.assign(this.addLoot(player.x, player.y, player.z, item), { dropper: player.id, dropUntil: now() + 2.5 });
    const slot = String(message.slot || '');
    if (slot === 'primary' || slot === 'sidearm') {
      const id = player.weapons[slot];
      if (!id) return;
      const ammo = player.ammo[slot];
      put({ kind: 'weapon', id, rarity: player.rarity?.[slot], mag: ammo?.mag ?? 0, reserve: ammo?.reserve ?? 0 });
      player.weapons[slot] = null;
      player.ammo[slot] = null;
      if (player.rarity) delete player.rarity[slot];
      player.kit = null; player.kitFor = null;
      // Landing with a blade only is already how a royale starts, so an empty hand is nothing new.
      if (player.active === slot) this.switchWeapon(player, player.weapons.primary ? 'primary' : player.weapons.sidearm ? 'sidearm' : 'melee');
      this.pushYou(player);
      return;
    }
    const gadget = String(message.gadget || '');
    if (!gadget || !player.gadgets.includes(gadget)) return;
    player.gadgets = player.gadgets.filter((held) => held !== gadget);
    put({ kind: 'gadget', id: gadget });
    this.pushYou(player);
  }
  // The countdown is over: the match is live and the ramp opens shortly. Nobody is placed here any
  // more; everyone leaves the aircraft when they choose, or at the far coast.
  deploy() {
    this.startStorm();
    this.phase = 'live';
    this.phaseEnds = now() + 3600;
    this.broadcast({ type: 'phase', phase: 'live', phaseEnds: this.phaseEnds });
    this.sendStorm();
    for (const player of [...this.humans(), ...this.watchers()]) this.sendLoot(player);
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
      if (!player.alive || player.dummy || player.inPlane) continue;
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
        if (!ammo) return null;
        // What the gun on the floor is actually carrying. One off the floor comes loaded; one somebody
        // put down has only what was left in it, so taking your own gun back is not a resupply.
        const spare = Number.isFinite(item.reserve) ? item.reserve : weapon.reserve;
        const after = Math.min(weapon.reserve, ammo.reserve + spare);
        if (after <= ammo.reserve) return null;
        ammo.reserve = after;
        return `${weapon.short} ammo`;
      }
      if (held && !swap) return null;
      // The gun you put down ignores you for a moment, or crouching would swap them back and forth.
      if (held) {
        const carried = player.ammo[slot];
        const dropped = { kind: 'weapon', id: held, rarity: player.rarity?.[slot], mag: carried?.mag ?? 0, reserve: carried?.reserve ?? 0 };
        Object.assign(this.addLoot(player.x, player.y, player.z, dropped), { dropper: player.id, dropUntil: now() + 2.5 });
      }
      player.weapons[slot] = item.id;
      (player.rarity = player.rarity || {})[slot] = item.rarity || weaponRarity(item.id);
      player.kit = null; player.kitFor = null;
      // A gun comes as it lies. Handing over a full one either way made dropping a gun and picking it
      // straight back up a free reload and a free resupply, over and over, for nothing.
      player.ammo[slot] = {
        mag: Number.isFinite(item.mag) ? Math.min(weapon.mag, item.mag) : weapon.mag,
        reserve: Number.isFinite(item.reserve) ? Math.min(weapon.reserve, item.reserve) : weapon.reserve,
      };
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
      if (!player.alive || player.dummy || player.inPlane || !this.outside(player, t)) continue;
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
    if (this.flight && (this.phase === 'drop' || this.phase === 'live')) this.send(player, { type: 'royale-flight', flight: this.flight });
    if (this.phase === 'live') { this.send(player, { type: 'royale', alive: this.alivePilots().length, storm: this.stormState() }); this.sendLoot(player); for (const drop of this.airdrops) this.send(player, { type: 'airdrop', drop }); }
  }

  // ---------------------------------------------------------------- deaths and the end
  kill(victim, killer, weapon, zone, meta = {}) {
    if (!victim.alive) return;
    const place = this.alivePilots().length;
    // Gone from the aircraft (a dropped connection): nothing of theirs falls out of the sky.
    const aboard = victim.inPlane;
    victim.inPlane = false;
    // What they carried lands where they fell.
    if (!victim.dummy && !aboard) {
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
    const everyone = [...this.players.values()].filter((p) => !p.dummy && !p.watching);
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
    this.flight = null;
    for (const player of this.players.values()) { player.inPlane = false; player.inDrop = false; if (!player.watching) player.team = 'A'; }
    super.toLobby();
  }

  // ---------------------------------------------------------------- per tick
  tick() {
    super.tick();
    if (this.closed) return;
    if (this.phase === 'drop' && now() >= this.phaseEnds) this.deploy();
    if (this.phase === 'drop' || this.phase === 'live') this.fly(now());
    if (this.phase !== 'live') return;
    const t = now();
    // Bots off the ramp: a straight dive, a late chute, a glide for their spot.
    for (const bot of this.players.values()) {
      if (!bot.dropping || !bot.alive || bot.inPlane || !bot.landAt) continue;
      // Down as fast as it can while still reaching its spot: free fall when it has height to spare, the
      // chute when the glide needs the time, and never faster than a pilot may fall.
      const dt = 1 / 30, above = bot.y - bot.landAt.y;
      const dx = bot.landAt.x - bot.x, dz = bot.landAt.z - bot.z, gap = Math.hypot(dx, dz), step = Math.min(gap, DEPLOY.bot.glide * dt);
      const rate = Math.max(DEPLOY.bot.chuteFall, Math.min(DEPLOY.freefall.fall, above / Math.max(0.5, gap / DEPLOY.bot.glide)));
      const chute = rate < DEPLOY.freefall.fall * 0.6 || above < DEPLOY.bot.chuteAt;
      bot.y -= (chute ? Math.min(rate, DEPLOY.parachute.fall * 1.5) : rate) * dt;
      if (chute) bot.flags |= FLAG.chute;
      if (gap > 0.01) { bot.x += (dx / gap) * step; bot.z += (dz / gap) * step; bot.yaw = Math.atan2(-dx, -dz); }
      if (bot.y <= bot.landAt.y) { Object.assign(bot, { x: bot.landAt.x, y: bot.landAt.y, z: bot.landAt.z, dropping: false }); bot.flags = (bot.flags | FLAG.ground) & ~FLAG.chute; }
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
      if (!player.alive || player.inPlane) continue;
      let flags = player.flags & ~(FLAG.ghost | FLAG.reloading | FLAG.piloting);
      if (player.ghostUntil > t) flags |= FLAG.ghost;
      if (player.reloadEnd) flags |= FLAG.reloading;
      if (player.drone) flags |= FLAG.piloting;
      player.history.push({ t, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, flags, weapon: player.weapons[player.active] || 'knife' });
      if (player.history.length > 110) player.history.shift();
      rows.push({ player, row: [player.id, round2(player.x), round2(player.y), round2(player.z), round3(player.yaw), round3(player.pitch), flags, player.weapons[player.active] || 'knife', 0] });
    }
    const range = ROYALE.viewRange, sets = new Map();
    for (const viewer of [...this.humans(), ...this.watchers()]) {
      if (!viewer.connected || !viewer.socket) continue;
      // Dead pilots watch someone else, so they see around whoever they last followed: the whole field.
      // Everyone else is sent what they could see or hear, the same rule as the arenas, so an ESP on the
      // island has nothing to draw either. Riders look down from the aircraft like anyone else.
      const seen = this.seesAll(viewer) || !this.culling() ? null : this.sightSet(viewer, t, sets);
      const near = viewer.alive ? rows.filter(({ player }) => player === viewer || (Math.abs(player.x - viewer.x) < range && Math.abs(player.z - viewer.z) < range && (!seen || seen.has(player.id)))) : rows;
      this.send(viewer, { type: 's', t: round3(t), p: near.map(({ row }) => row) });
    }
  }
}
