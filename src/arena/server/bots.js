// Server-side bots. They see with the same line-of-sight test the game uses,
// walk the generated nav grid and shoot through the same authoritative fire path
// as humans, so everything a bot does is a legal play.
import { BODY, BOT_DIFFICULTY, BOT_NAMES, COSMETICS, FLAG, WEAPONS } from '../shared/constants.js';
import { dirFromAngles } from '../shared/combat.js';
import { makeBody } from '../shared/physics.js';

const VISIBILITY = { noon: 130, dusk: 110, storm: 75, night: 62 };
const rand = (min, max) => min + Math.random() * (max - min);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function freshAi() {
  return { path: null, pathIndex: 0, goal: null, holdUntil: 0, targetId: null, visible: false, reactAt: 0, lastSeen: 0, lastKnown: null, nextLook: 0, errYaw: 0, errPitch: 0, aimHead: false, strafe: 1, strafeUntil: 0, evadeUntil: 0, lookYaw: null, lookUntil: 0, scanPhase: Math.random() * 6, pulseAt: 0, repathAt: 0, tunnelCost: 1.5, midCost: 1.5, body: makeBody() };
}

export function createBot(room, team, difficulty) {
  const taken = new Set([...room.players.values()].map((p) => p.name));
  const pool = BOT_NAMES.filter((name) => !taken.has(name));
  const name = pool.length ? pool[Math.floor(Math.random() * pool.length)] : `Unit-${room.nextPlayer}`;
  const suits = COSMETICS.suit, visors = COSMETICS.visor;
  const bot = room.newPlayer({
    name, team, bot: true, ready: true, difficulty, title: difficulty === 'elite' ? 'Deadeye' : difficulty === 'veteran' ? 'Marksman' : 'Recruit',
    color: suits[Math.floor(Math.random() * suits.length)].id, accent: visors[Math.floor(Math.random() * visors.length)].id,
    level: difficulty === 'elite' ? 18 : difficulty === 'veteran' ? 9 : 2,
  });
  bot.ai = freshAi();
  return bot;
}

export function createDummy(room, spec, index) {
  const dummy = room.newPlayer({ name: `Target ${index + 1}`, team: 'B', bot: true, dummy: true, ready: true, color: '#d9d4c8', accent: '#ff7148', home: { x: spec.x, y: 0, z: spec.z, yaw: Math.PI, crouch: spec.crouch, patrol: spec.patrol } });
  dummy.ai = { direction: 1 };
  room.spawn(dummy);
  return dummy;
}

export function resetBot(bot) {
  if (bot.dummy) return;
  const scan = bot.ai?.scanPhase ?? 0;
  bot.ai = freshAi();
  bot.ai.scanPhase = scan;
  bot.ai.pulseAt = rand(6, 30);
  bot.ai.openers = null;
  bot.ai.tunnelCost = rand(1, 3.2);
  bot.ai.midCost = rand(1, 2.4);
}

export function botBuy(room, bot) {
  if (room.rules.modifier !== 'instagib') {
    if (bot.credits >= 1500) room.buy(bot, 'heavy'); else if (bot.credits >= 700) room.buy(bot, 'light');
    if (bot.credits >= 900) room.buy(bot, 'helmet');
  }
  const roll = Math.random();
  if (room.rules.modifier !== 'sidearms' && bot.weapons.primary === 'm44') {
    if (roll < 0.22 && bot.credits >= 2100) room.buy(bot, 'recon'); else if (roll > 0.9 && bot.credits >= 1700) room.buy(bot, 'wasp');
  }
  if (room.rules.modifier === 'sidearms' && bot.credits >= 900) room.buy(bot, 'viper');
  if (bot.credits >= 800 && Math.random() < 0.5) room.buy(bot, Math.random() < 0.5 ? 'pulse' : 'stim');
}

export function botOnHurt(room, bot, attacker) {
  if (bot.dummy || !bot.ai) return;
  const ai = bot.ai;
  ai.lastKnown = { x: attacker.x, y: attacker.y, z: attacker.z, t: room.time };
  if (!ai.visible) {
    ai.lookYaw = Math.atan2(-(attacker.x - bot.x), -(attacker.z - bot.z));
    ai.lookUntil = room.time + 2;
    ai.path = null;
    ai.evadeUntil = room.time + rand(0.5, 1.1);
    ai.strafe = Math.random() < 0.5 ? 1 : -1;
  }
  ai.reactAt = Math.min(ai.reactAt, room.time + BOT_DIFFICULTY[bot.difficulty].reaction * 0.6);
}

export function botOnSound(room, bot, source, loud) {
  if (bot.dummy || !bot.ai || !bot.alive || (source.team && source.team === bot.team)) return;
  const dist = Math.hypot(source.x - bot.x, source.z - bot.z);
  if (dist > loud * 0.75) return;
  const ai = bot.ai;
  const blur = Math.min(8, dist * 0.12);
  ai.lastKnown = { x: source.x + rand(-blur, blur), y: source.y, z: source.z + rand(-blur, blur), t: room.time };
  if (!ai.visible && Math.random() < 0.7) { ai.lookYaw = Math.atan2(-(source.x - bot.x), -(source.z - bot.z)); ai.lookUntil = room.time + 1.6; }
}

function turnToward(bot, yaw, pitch, rate, dt) {
  const dy = angleDiff(yaw, bot.yaw);
  const step = rate * dt;
  bot.yaw += Math.abs(dy) <= step ? dy : Math.sign(dy) * step;
  const dp = pitch - bot.pitch;
  bot.pitch += Math.abs(dp) <= step ? dp : Math.sign(dp) * step;
  return Math.hypot(angleDiff(yaw, bot.yaw), pitch - bot.pitch);
}

function perceive(room, bot, t) {
  const ai = bot.ai;
  const diff = BOT_DIFFICULTY[bot.difficulty];
  const eye = room.eyeOf(bot);
  const maxDist = VISIBILITY[room.variant] || 100;
  const halfFov = ((diff.fov / 2) * Math.PI) / 180;
  let best = null;
  const candidates = room.enemiesOf(bot).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, crouch: Boolean(p.flags & FLAG.crouch), speed: p.speed, firedAt: p.lastFireAt }));
  for (const decoy of room.decoys.values()) if (decoy.team !== bot.team) candidates.push({ id: decoy.id, x: decoy.body.x, y: decoy.body.y, z: decoy.body.z, crouch: false, speed: 6, firedAt: 0 });
  for (const enemy of candidates) {
    const dx = enemy.x - bot.x, dz = enemy.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) continue;
    const bearing = Math.atan2(-dx, -dz);
    const recentlyFired = t - enemy.firedAt < 1.2;
    if (dist > 5 && Math.abs(angleDiff(bearing, bot.yaw)) > halfFov && !(recentlyFired && dist < 40)) continue;
    // Still, crouched rivals far away are genuinely hard to spot.
    if (dist > 45 && enemy.crouch && enemy.speed < 1 && !recentlyFired && ai.targetId !== enemy.id && Math.random() < 0.8) continue;
    const head = enemy.y + (enemy.crouch ? 1.05 : 1.58), chest = enemy.y + (enemy.crouch ? 0.7 : 1.15);
    const seesHead = room.world.lineOfSight(eye[0], eye[1], eye[2], enemy.x, head, enemy.z);
    const seesChest = seesHead && room.world.lineOfSight(eye[0], eye[1], eye[2], enemy.x, chest, enemy.z);
    if (!seesHead) continue;
    const score = dist - (ai.targetId === enemy.id ? 12 : 0);
    if (!best || score < best.score) best = { ...enemy, dist, score, seesChest };
  }
  if (best) {
    if (ai.targetId !== best.id) {
      ai.targetId = best.id;
      ai.reactAt = t + diff.reaction * rand(0.75, 1.3) + best.dist * 0.004;
      ai.aimHead = Math.random() < diff.headBias * (best.dist > 60 ? 0.4 : 1);
      ai.errYaw = gauss(); ai.errPitch = gauss();
    }
    ai.visible = true;
    ai.seen = best;
    ai.lastSeen = t;
    ai.lastKnown = { x: best.x, y: best.y, z: best.z, t };
  } else {
    ai.visible = false;
    if (ai.targetId && t - ai.lastSeen > 0.6) ai.targetId = null;
  }
}

function chooseGoal(room, bot, t) {
  const ai = bot.ai;
  if (ai.lastKnown && t - ai.lastKnown.t < 14) return { x: ai.lastKnown.x, y: ai.lastKnown.y, z: ai.lastKnown.z, hunt: true };
  const side = (room.swapped ? -1 : 1) * (bot.team === 'A' ? 1 : -1); // +1 → home is +z
  // Every round opens with a randomly chosen lane so bots do not all funnel through mid.
  if (ai.openers === null && room.map.lanes?.length) {
    const lane = room.map.lanes[Math.floor(Math.random() * room.map.lanes.length)];
    ai.openers = lane.map(([x, y, z]) => ({ x, y, z: z * side }));
  }
  if (ai.openers?.length) return ai.openers.shift();
  const points = room.map.interest;
  // Prefer pushing toward the middle and the enemy half as the round runs down.
  const remaining = room.phaseEnds - t;
  const weights = points.map(([, y, z]) => {
    const forward = -z * side;
    let weight = 1 + Math.max(0, 30 - Math.abs(forward - (remaining < 45 ? 25 : 0))) / 12;
    if (y > 3 && WEAPONS[bot.weapons.primary]?.id === 'm44') weight *= 1.6;
    if (y < -1) weight *= 0.7;
    return weight;
  });
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let index = 0; index < points.length; index += 1) { roll -= weights[index]; if (roll <= 0) return { x: points[index][0], y: points[index][1], z: points[index][2] }; }
  return { x: 0, y: 0, z: 0 };
}

function followPath(bot, dt, speed) {
  const ai = bot.ai;
  if (!ai.path || ai.pathIndex >= ai.path.length) return true;
  let budget = speed * dt;
  while (budget > 0 && ai.pathIndex < ai.path.length) {
    const node = ai.path[ai.pathIndex];
    const dx = node.x - bot.x, dz = node.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-4) ai.moveYaw = Math.atan2(-dx, -dz);
    if (dist <= budget) { bot.x = node.x; bot.z = node.z; bot.y = node.y; ai.pathIndex += 1; budget -= dist; } else {
      const k = budget / dist;
      bot.x += dx * k; bot.z += dz * k; bot.y += (node.y - bot.y) * k;
      budget = 0;
    }
  }
  return ai.pathIndex >= ai.path.length;
}

function strafe(room, bot, dt, speed) {
  const ai = bot.ai;
  const body = ai.body;
  body.x = bot.x; body.y = bot.y; body.z = bot.z; body.vy = 0; body.onGround = true;
  // Path following interpolates height, so on stairs the bot can sit slightly inside a step.
  let lift = 0;
  while (lift <= 0.6 && !room.world.bodyFree(body.x, body.y + lift, body.z)) lift += 0.15;
  if (lift > 0.6) return;
  body.y += lift;
  const sx = Math.cos(bot.yaw) * ai.strafe, sz = -Math.sin(bot.yaw) * ai.strafe;
  // Do not strafe off ledges.
  const aheadX = bot.x + sx * 0.7, aheadZ = bot.z + sz * 0.7;
  if (room.world.groundBelow(aheadX, bot.y + 0.3, aheadZ) < bot.y - 0.6) { ai.strafe *= -1; return; }
  room.world.moveBody(body, sx * speed * dt, -0.05 - lift, sz * speed * dt);
  if (Math.hypot(body.x - bot.x, body.z - bot.z) < speed * dt * 0.3) ai.strafe *= -1;
  bot.x = body.x; bot.y = body.y; bot.z = body.z;
  ai.path = null;
}

export function updateBot(room, bot, dt, t) {
  if (bot.dummy) return updateDummy(room, bot, dt);
  const ai = bot.ai;
  bot.flags = FLAG.ground;
  bot.speed = 0;
  if (room.phase !== 'live' && room.phase !== 'overtime') return;
  const diff = BOT_DIFFICULTY[bot.difficulty];
  if (t >= ai.nextLook) { ai.nextLook = t + rand(0.1, 0.18); perceive(room, bot, t); }
  if (room.phase === 'overtime' && !ai.visible && (!ai.lastKnown || t - ai.lastKnown.t > 2)) {
    const nearest = room.enemiesOf(bot).sort((m, n) => Math.hypot(m.x - bot.x, m.z - bot.z) - Math.hypot(n.x - bot.x, n.z - bot.z))[0];
    if (nearest) { ai.lastKnown = { x: nearest.x, y: nearest.y, z: nearest.z, t }; ai.path = null; }
  }

  // Rounds should not stall: once a round has run quiet for a while, bots get a rough fix on the
  // nearest rival (as if from radio chatter) and close in.
  const elapsed = room.rules.roundTime - (room.phaseEnds - t);
  if (room.phase === 'live' && elapsed > 38 && !ai.visible && (!ai.lastKnown || t - ai.lastKnown.t > 9)) {
    const nearest = room.enemiesOf(bot).sort((m, n) => Math.hypot(m.x - bot.x, m.z - bot.z) - Math.hypot(n.x - bot.x, n.z - bot.z))[0];
    if (nearest) {
      ai.lastKnown = { x: nearest.x + rand(-7, 7), y: nearest.y, z: nearest.z + rand(-7, 7), t };
      if (!ai.goal?.hunt) ai.path = null;
    }
  }

  // Gadgets
  const pulseSlot = bot.gadgets.indexOf('pulse');
  if (pulseSlot >= 0 && t > room.phaseEnds - room.rules.roundTime + ai.pulseAt && room.phase === 'live') room.useGadget(bot, { slot: pulseSlot });
  const stimSlot = bot.gadgets.indexOf('stim');
  if (stimSlot >= 0 && bot.hp < 55 && !ai.visible) room.useGadget(bot, { slot: stimSlot });

  const target = ai.visible && ai.seen ? ai.seen : null;
  if (target) {
    const eye = room.eyeOf(bot);
    const current = room.players.get(target.id) || [...room.decoys.values()].map((d) => ({ id: d.id, x: d.body.x, y: d.body.y, z: d.body.z, flags: 0, speed: 6 })).find((d) => d.id === target.id);
    if (!current) { ai.visible = false; return; }
    const crouched = Boolean(current.flags & FLAG.crouch);
    const dx = current.x - eye[0], dz = current.z - eye[2];
    const dist = Math.hypot(dx, dz);
    // Pick the right tool.
    const wantSidearm = (bot.weapons.primary === 'm44' && dist < 9) || !bot.weapons.primary || (bot.ammo.primary && bot.ammo.primary.mag + bot.ammo.primary.reserve === 0);
    const wantSlot = wantSidearm ? 'sidearm' : 'primary';
    if (bot.active !== wantSlot && !bot.reloadEnd) room.switchWeapon(bot, wantSlot);
    const weapon = WEAPONS[bot.weapons[bot.active]];
    const aimY = current.y + (ai.aimHead && target.seesChest !== false ? (crouched ? 1.06 : 1.6) : target.seesChest ? (crouched ? 0.7 : 1.15) : (crouched ? 1.06 : 1.6));
    const errorScale = ((diff.error * Math.PI) / 180) * (1 + dist / 140) * (1 + (current.speed || 0) / 4.5) * (weapon.id === 'm44' ? 1 : 1.5) * (room.variant === 'night' || room.variant === 'storm' ? 1.25 : 1);
    const yaw = Math.atan2(-dx, -dz) + ai.errYaw * errorScale;
    const pitch = Math.atan2(aimY - eye[1], dist) + ai.errPitch * errorScale * 0.7;
    const off = turnToward(bot, yaw, pitch, 3.2 + (1 / diff.aimTime) * 2.2, dt);
    const sniping = weapon.id === 'm44' || weapon.id === 'recon';
    if (t < ai.evadeUntil || !sniping || dist < 14) {
      if (t > ai.strafeUntil) { ai.strafeUntil = t + rand(0.5, 1.3); if (Math.random() < 0.5) ai.strafe *= -1; }
      strafe(room, bot, dt, sniping ? 3.4 : 4.6);
      bot.speed = sniping ? 3.4 : 4.6;
    } else {
      bot.flags |= FLAG.scoped;
      if (dist > 35 && ai.scanPhase > 3) bot.flags |= FLAG.crouch;
    }
    const ammo = bot.ammo[bot.active];
    if (ammo && ammo.mag <= 0) room.startReload(bot);
    else if (t >= ai.reactAt && off < 0.05 && t >= bot.nextFire && t >= bot.equipUntil && !bot.reloadEnd && t >= ai.evadeUntil - 0.2) {
      const dir = dirFromAngles(bot.yaw, bot.pitch);
      if (room.fire(bot, eye, dir, t, ++bot.shotSeq)) {
        ai.errYaw = gauss(); ai.errPitch = gauss();
        ai.aimHead = Math.random() < diff.headBias;
        if (weapon.id === 'm44') {
          ai.reactAt = t + diff.aimTime * rand(0.8, 1.3);
          if (Math.random() < 0.45) { ai.evadeUntil = t + rand(0.6, 1.2); ai.strafe = Math.random() < 0.5 ? 1 : -1; }
        } else ai.reactAt = t + rand(0.02, 0.12);
      }
    }
    return;
  }

  // Nobody in sight: reload, then move.
  const ammo = bot.ammo[bot.active];
  const weapon = WEAPONS[bot.weapons[bot.active]];
  if (ammo && weapon && ammo.mag < weapon.mag * 0.5 && !bot.reloadEnd) room.startReload(bot);
  if (bot.active !== 'primary' && bot.weapons.primary && !bot.reloadEnd && bot.ammo.primary.mag + bot.ammo.primary.reserve > 0) room.switchWeapon(bot, 'primary');

  if (t < ai.evadeUntil) { strafe(room, bot, dt, 5); bot.speed = 5; }
  else if (!ai.path && t >= ai.repathAt && t >= ai.holdUntil) {
    ai.repathAt = t + 0.5;
    ai.goal = chooseGoal(room, bot, t);
    const accept = (node) => room.world.lineOfSight(bot.x, bot.y + 0.9, bot.z, node.x, node.y + 0.9, node.z) && Math.abs(node.y - bot.y) < 1.2;
    const start = room.nav.nearest(bot.x, bot.y, bot.z, accept) || room.nav.nearest(bot.x, bot.y, bot.z);
    // Each bot weighs the underpass and the open plaza differently, so they do not all take the shortest line.
    const path = start ? room.nav.path(start, ai.goal, (node) => (node.y < -1 ? ai.tunnelCost : Math.abs(node.x) < 9 ? ai.midCost : 1)) : null;
    if (path && path.length > 1) { ai.path = path; ai.pathIndex = 0; } else { ai.lastKnown = null; ai.holdUntil = t + 1; }
  } else if (ai.path) {
    const hunting = ai.goal?.hunt;
    const nearGoal = ai.path.length - ai.pathIndex < 10;
    const speed = hunting && nearGoal ? BODY.walkSpeed : 5.4;
    bot.speed = speed;
    if (speed < 4) bot.flags |= FLAG.walking;
    if (followPath(bot, dt, speed)) {
      ai.path = null;
      if (hunting) ai.lastKnown = null;
      ai.holdUntil = t + rand(1.5, hunting ? 3 : 6);
      ai.holdYaw = Math.atan2(bot.x, bot.z) + rand(-0.4, 0.4);
    }
    // Hunters abandon stale trails when a fresher sound comes in.
    if (ai.lastKnown && ai.goal && !ai.goal.hunt && t - ai.lastKnown.t < 1) ai.path = null;
  }

  // Where to look.
  ai.scanPhase += dt;
  let lookYaw = ai.moveYaw ?? bot.yaw;
  if (t < ai.lookUntil && ai.lookYaw !== null) lookYaw = ai.lookYaw;
  else if (!ai.path) lookYaw = (ai.holdYaw ?? bot.yaw) + Math.sin(ai.scanPhase * 0.9) * 1.1;
  else lookYaw += Math.sin(ai.scanPhase * 1.3) * 0.35;
  turnToward(bot, lookYaw, 0, 3.4, dt);
}

function updateDummy(room, bot, dt) {
  const patrol = bot.home.patrol;
  bot.speed = 0;
  if (!patrol) return;
  bot.x += bot.ai.direction * 1.8 * dt;
  bot.speed = 1.8;
  if (bot.x > patrol[1]) bot.ai.direction = -1;
  if (bot.x < patrol[0]) bot.ai.direction = 1;
}
