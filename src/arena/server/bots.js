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
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, k) => a + (b - a) * k;

// Every bot is its own player. `skill` shifts it up or down within its level (−1 … +1, most near 0);
// the rest are habits: how hard it pushes, how long it holds an angle, whether it dances or plants its
// feet in a fight, how much a hit rattles it. Rolled once when the bot joins and kept for the match.
function rollTraits() {
  const skill = clamp(gauss() * 0.42, -1, 1);
  return {
    skill,
    reaction: lerp(1.3, 0.78, (skill + 1) / 2) * rand(0.9, 1.12),
    error: lerp(1.45, 0.7, (skill + 1) / 2) * rand(0.85, 1.18),
    aimTime: lerp(1.3, 0.8, (skill + 1) / 2) * rand(0.85, 1.15),
    headBias: lerp(0.5, 1.5, (skill + 1) / 2),
    awareness: rand(0.82, 1.12),              // field of view multiplier
    flick: rand(4.2, 7.5) + skill * 1.2,      // fastest turn, rad/s
    snap: rand(6.5, 11),                      // how sharply the aim accelerates toward a point
    damping: rand(0.72, 1.02),                // under 1 overshoots a flick and comes back
    trackLag: rand(0.05, 0.14) - skill * 0.03, // seconds behind a moving target
    wobble: rand(0.7, 1.4),                   // hand tremor while holding an aim
    aggression: Math.random(),
    patience: Math.random(),
    dancer: Math.random(),
    croucher: Math.random(),
    composure: clamp(Math.random() * 0.8 + (skill + 1) * 0.2, 0, 1),
    trigger: rand(0.6, 1.5),                  // how settled the aim must be before a slow weapon fires
    pace: rand(0.9, 1.06),
    curiosity: rand(0.5, 1.5),                // how much it looks around while moving
  };
}
// The level's numbers bent by this bot's personality.
function profile(bot) {
  const base = BOT_DIFFICULTY[bot.difficulty] || BOT_DIFFICULTY.veteran;
  const k = bot.traits || (bot.traits = rollTraits());
  return { reaction: base.reaction * k.reaction, aimTime: base.aimTime * k.aimTime, error: base.error * k.error, headBias: clamp(base.headBias * k.headBias, 0, 0.6), fov: base.fov * k.awareness };
}

function freshAi() {
  return {
    path: null, pathIndex: 0, goal: null, holdUntil: 0, repathAt: 0, targetId: null, visible: false, seen: null, reactAt: 0, lastSeen: 0, lastKnown: null, nextLook: 0,
    errYaw: 0, errPitch: 0, aimHead: false, strafe: 1, strafeUntil: 0, evadeUntil: 0, lookYaw: null, lookUntil: 0, moveYaw: null, holdYaw: null, scanPhase: 0,
    body: makeBody(0, 0, 0),
    // Humanising state: view velocity, hand noise, how settled the aim is, where they think the target is,
    // current walking speed, strafe velocity, and what they are glancing at.
    yawVel: 0, pitchVel: 0, noiseYaw: 0, noisePitch: 0, settle: 0, acquiredAt: 0, track: null, hurtAt: -99,
    moveSpeed: 0, strafeVel: 0, glanceYaw: 0, glancePitch: 0, glanceUntil: 0, pauseUntil: 0, nextPauseCheck: 0, burstLeft: 0, burstRestUntil: 0, plantUntil: 0,
  };
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
  bot.traits = rollTraits();
  // What people see in the lobby follows the bot's own skill, not just the level picked for the room.
  const tier = { recruit: 2, veteran: 9, elite: 18 }[difficulty] || 9;
  bot.level = Math.max(1, Math.round(tier + bot.traits.skill * tier * 0.6 + rand(-1, 1)));
  const titles = { recruit: ['Recruit', 'Recruit', 'Rifleman'], veteran: ['Rifleman', 'Marksman', 'Marksman', 'Sharpshooter'], elite: ['Sharpshooter', 'Deadeye', 'Deadeye', 'Ghost'] }[difficulty] || ['Marksman'];
  bot.title = titles[clamp(Math.round((bot.traits.skill + 1) / 2 * (titles.length - 1)), 0, titles.length - 1)];
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
  // Bots mostly stick to long guns, with the odd rifle or SMG; they keep enough back for armour next round.
  if (room.rules.modifier !== 'sidearms' && bot.weapons.primary === 'm44') {
    // Taste follows temperament: pushers reach for rifles and SMGs, patient pilots stay on long guns.
    const pusher = bot.traits && bot.traits.aggression > 0.62, camper = bot.traits && bot.traits.patience > 0.6 && !pusher;
    const picks = pusher ? [['talon', 0.2], ['halcyon', 0.16], ['wasp', 0.12], ['hornet', 0.1], ['ronin', 0.1], ['breaker', 0.05], ['recon', 0.06]] : camper ? [['recon', 0.22], ['vesper', 0.2], ['harbinger', 0.1], ['anvil', 0.05]] : [['recon', 0.16], ['vesper', 0.12], ['talon', 0.14], ['halcyon', 0.1], ['ronin', 0.08], ['harbinger', 0.05], ['anvil', 0.04], ['wasp', 0.04], ['hornet', 0.03]];
    let chance = roll;
    for (const [id, weight] of picks) {
      chance -= weight;
      if (chance <= 0) { if (bot.credits >= WEAPONS[id].cost + 400) room.buy(bot, id); break; }
    }
  }
  if (room.rules.modifier === 'sidearms' && bot.credits >= 900) room.buy(bot, Math.random() < 0.7 ? 'viper' : 'pike');
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
  ai.reactAt = Math.min(ai.reactAt, room.time + profile(bot).reaction * 0.6);
  // Getting hit throws the aim off, and rattles some pilots more than others.
  const rattle = 1.4 - bot.traits.composure;
  ai.noiseYaw += gauss() * 2.2 * rattle; ai.noisePitch += gauss() * 1.4 * rattle;
  ai.hurtAt = room.time;
  if (ai.visible && Math.random() < 0.35 + (1 - bot.traits.composure) * 0.4) { ai.evadeUntil = room.time + rand(0.4, 0.9); ai.strafe = Math.random() < 0.5 ? 1 : -1; }
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

// Turning is a damped spring, not a constant sweep: the view accelerates toward the point, tops out at
// the pilot's flick speed, slows as it arrives, and (for the less steady ones) overshoots a little and
// comes back. `urgency` scales it: lazy when strolling, sharp when a target appears.
function turnToward(bot, yaw, pitch, urgency, dt) {
  const ai = bot.ai, k = bot.traits;
  const omega = k.snap * urgency, maxRate = k.flick * urgency;
  const dy = angleDiff(yaw, bot.yaw), dp = pitch - bot.pitch;
  ai.yawVel = clamp(ai.yawVel + (dy * omega * omega - 2 * k.damping * omega * ai.yawVel) * dt, -maxRate, maxRate);
  ai.pitchVel = clamp(ai.pitchVel + (dp * omega * omega - 2 * k.damping * omega * ai.pitchVel) * dt, -maxRate * 0.7, maxRate * 0.7);
  bot.yaw += ai.yawVel * dt;
  bot.pitch = clamp(bot.pitch + ai.pitchVel * dt, -1.4, 1.4);
  return Math.hypot(angleDiff(yaw, bot.yaw), pitch - bot.pitch);
}

function perceive(room, bot, t) {
  const ai = bot.ai;
  const diff = profile(bot);
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
      // Reaction time is skewed like a person's: usually near their norm, now and then much slower, and
      // slower still for something at the edge of vision or when they were not expecting company.
      const offCentre = Math.min(1, Math.abs(angleDiff(Math.atan2(-(best.x - bot.x), -(best.z - bot.z)), bot.yaw)) / halfFov);
      const lapse = Math.random() < 0.12 ? rand(1.5, 2.4) : 1;
      const expecting = ai.lastKnown && t - ai.lastKnown.t < 6 ? 0.8 : 1;
      ai.reactAt = t + diff.reaction * rand(0.8, 1.35) * lapse * expecting * (1 + offCentre * 0.5) + best.dist * 0.004;
      // The first flick lands near the target, not on it; the aim then settles over aimTime.
      ai.settle = 1; ai.acquiredAt = t;
      ai.track = { x: best.x, y: best.y, z: best.z };
      ai.aimHead = Math.random() < diff.headBias * (best.dist > 60 ? 0.4 : 1);
      ai.errYaw = gauss(); ai.errPitch = gauss();
    }
    ai.visible = true;
    ai.seen = best;
    ai.lastSeen = t;
    ai.lastKnown = { x: best.x, y: best.y, z: best.z, t };
  } else {
    // Lost them: keep the sights on the spot for a moment, the way anyone would.
    if (ai.visible && ai.lastKnown) { ai.lookYaw = Math.atan2(-(ai.lastKnown.x - bot.x), -(ai.lastKnown.z - bot.z)); ai.lookUntil = t + rand(0.8, 2.2) * (0.6 + bot.traits.patience); }
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
    if (y > 3 && WEAPONS[bot.weapons.primary]?.family === 'sniper') weight *= 1.6;
    if (y < -1) weight *= 0.7;
    return weight;
  });
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let index = 0; index < points.length; index += 1) { roll -= weights[index]; if (roll <= 0) return { x: points[index][0], y: points[index][1], z: points[index][2] }; }
  return { x: 0, y: 0, z: 0 };
}

// Can a body walk the straight line between two points on the same level? Sampled every 0.4 m:
// the body must fit and the floor must still be there. Used to cut the grid's zig-zags into straight runs.
function clearRun(room, ax, az, bx, bz, y) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 0.4);
  for (let step = 1; step <= steps; step += 1) {
    const k = step / steps, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
    if (!room.world.bodyFree(x, y, z) || room.world.groundBelow(x, y + 0.05, z) < y - 0.3) return false;
  }
  return true;
}

function followPath(room, bot, dt, speed) {
  const ai = bot.ai;
  if (!ai.path || ai.pathIndex >= ai.path.length) return true;
  // Look a few nodes ahead and head straight for the furthest one in plain walking reach.
  if (t_skipDue(ai)) {
    for (let ahead = Math.min(ai.path.length - 1, ai.pathIndex + 5); ahead > ai.pathIndex; ahead -= 1) {
      const node = ai.path[ahead];
      let flat = Math.abs(node.y - bot.y) < 0.05;
      for (let index = ai.pathIndex; flat && index < ahead; index += 1) flat = Math.abs(ai.path[index].y - node.y) < 0.05;
      if (flat && clearRun(room, bot.x, bot.z, node.x, node.z, node.y)) { ai.pathIndex = ahead; break; }
    }
  }
  let budget = speed * dt;
  while (budget > 0 && ai.pathIndex < ai.path.length) {
    const node = ai.path[ai.pathIndex];
    const dx = node.x - bot.x, dz = node.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) ai.moveYaw = Math.atan2(-dx, -dz);
    if (dist <= budget) { bot.x = node.x; bot.z = node.z; bot.y = node.y; ai.pathIndex += 1; budget -= dist; ai.skipAt = 0; } else {
      const k = budget / dist;
      bot.x += dx * k; bot.z += dz * k; bot.y += (node.y - bot.y) * k;
      budget = 0;
    }
  }
  return ai.pathIndex >= ai.path.length;
}
// The look-ahead costs a few collision tests, so it runs when a node is reached rather than every tick.
function t_skipDue(ai) { if (ai.skipAt) return false; ai.skipAt = 1; return true; }

function strafe(room, bot, dt, speed) {
  const ai = bot.ai;
  const body = ai.body;
  body.x = bot.x; body.y = bot.y; body.z = bot.z; body.vy = 0; body.onGround = true;
  // Path following interpolates height, so on stairs the bot can sit slightly inside a step.
  let lift = 0;
  while (lift <= 0.6 && !room.world.bodyFree(body.x, body.y + lift, body.z)) lift += 0.15;
  if (lift > 0.6) return 0;
  body.y += lift;
  // Changing direction takes a moment: the strafe speed eases toward the wanted one instead of flipping.
  ai.strafeVel += clamp(ai.strafe * speed - ai.strafeVel, -22 * dt, 22 * dt);
  const sx = Math.cos(bot.yaw), sz = -Math.sin(bot.yaw);
  // Do not strafe off ledges.
  const side = Math.sign(ai.strafeVel) || ai.strafe;
  const aheadX = bot.x + sx * side * 0.7, aheadZ = bot.z + sz * side * 0.7;
  if (room.world.groundBelow(aheadX, bot.y + 0.3, aheadZ) < bot.y - 0.6) { ai.strafe *= -1; ai.strafeVel *= 0.3; return Math.abs(ai.strafeVel); }
  const want = Math.abs(ai.strafeVel) * dt;
  room.world.moveBody(body, sx * ai.strafeVel * dt, -0.05 - lift, sz * ai.strafeVel * dt);
  if (want > 0.01 && Math.hypot(body.x - bot.x, body.z - bot.z) < want * 0.3) { ai.strafe *= -1; ai.strafeVel *= 0.2; }
  bot.x = body.x; bot.y = body.y; bot.z = body.z;
  ai.path = null;
  return Math.abs(ai.strafeVel);
}

// Where someone walking this route would be looking: mostly where they are going, with glances at
// doorways of interest — the last place a rival was heard, the far end of the map, a side angle.
function pickGlance(room, bot, t, holding) {
  const ai = bot.ai, k = bot.traits;
  const forward = holding ? (ai.holdYaw ?? bot.yaw) : (ai.moveYaw ?? bot.yaw);
  const roll = Math.random();
  let yaw = forward + gauss() * (holding ? 0.35 : 0.12);
  if (ai.lastKnown && t - ai.lastKnown.t < 20 && roll < 0.35) yaw = Math.atan2(-(ai.lastKnown.x - bot.x), -(ai.lastKnown.z - bot.z)) + gauss() * 0.15;
  else if (roll < 0.35 + 0.3 * k.curiosity * (holding ? 1.4 : 0.6)) {
    const point = room.map.interest[Math.floor(Math.random() * room.map.interest.length)];
    const bearing = Math.atan2(-(point[0] - bot.x), -(point[2] - bot.z));
    // Only glance at things roughly ahead while moving; nobody runs looking backwards for long.
    yaw = holding || Math.abs(angleDiff(bearing, forward)) < 1.3 ? bearing : forward + Math.sign(angleDiff(bearing, forward)) * rand(0.5, 1.1);
  }
  ai.glanceYaw = yaw;
  ai.glancePitch = rand(-0.07, 0.05);
  ai.glanceUntil = t + (holding ? rand(0.9, 3.2) * (0.6 + k.patience) : rand(0.5, 1.8));
}

export function updateBot(room, bot, dt, t) {
  if (bot.dummy) return updateDummy(room, bot, dt);
  think(room, bot, dt, t);
  // The speed other players see drives the running animation, so it eases between states too.
  const ai = bot.ai;
  ai.shownSpeed = (ai.shownSpeed || 0) + clamp(bot.speed - (ai.shownSpeed || 0), -16 * dt, 16 * dt);
  bot.speed = ai.shownSpeed;
  if (bot.speed > 0.2 && bot.speed < 4 && !(bot.flags & FLAG.crouch)) bot.flags |= FLAG.walking;
}

function think(room, bot, dt, t) {
  const ai = bot.ai;
  const k = bot.traits || (bot.traits = rollTraits());
  bot.flags = FLAG.ground;
  bot.speed = 0;
  if (room.phase !== 'live' && room.phase !== 'overtime') { ai.moveSpeed = 0; ai.strafeVel = 0; return; }
  const diff = profile(bot);
  if (t >= ai.nextLook) { ai.nextLook = t + rand(0.1, 0.18); perceive(room, bot, t); }
  if (room.phase === 'overtime' && !ai.visible && (!ai.lastKnown || t - ai.lastKnown.t > 2)) {
    const nearest = room.enemiesOf(bot).sort((m, n) => Math.hypot(m.x - bot.x, m.z - bot.z) - Math.hypot(n.x - bot.x, n.z - bot.z))[0];
    if (nearest) { ai.lastKnown = { x: nearest.x, y: nearest.y, z: nearest.z, t }; ai.path = null; }
  }

  // Rounds should not stall: once a round has run quiet for a while, bots get a rough fix on the
  // nearest rival (as if from radio chatter) and close in. Cautious pilots wait longer before they do.
  const elapsed = room.rules.roundTime - (room.phaseEnds - t);
  if (room.phase === 'live' && elapsed > 26 + (1 - k.aggression) * 14 && !ai.visible && (!ai.lastKnown || t - ai.lastKnown.t > 9)) {
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

  // The hand is never perfectly still: a slow random drift that pulls back toward zero.
  const tremor = k.wobble * Math.sqrt(dt) * 1.6;
  ai.noiseYaw += -ai.noiseYaw * dt * 1.8 + gauss() * tremor;
  ai.noisePitch += -ai.noisePitch * dt * 1.8 + gauss() * tremor * 0.7;
  ai.settle = Math.max(0, ai.settle - dt / Math.max(0.2, diff.aimTime));

  const target = ai.visible && ai.seen ? ai.seen : null;
  if (target) {
    const eye = room.eyeOf(bot);
    const current = room.players.get(target.id) || [...room.decoys.values()].map((d) => ({ id: d.id, x: d.body.x, y: d.body.y, z: d.body.z, flags: 0, speed: 6 })).find((d) => d.id === target.id);
    if (!current) { ai.visible = false; return; }
    const crouched = Boolean(current.flags & FLAG.crouch);
    // Eyes follow a moving target a beat late, so strafing genuinely throws their aim off.
    if (!ai.track) ai.track = { x: current.x, y: current.y, z: current.z };
    const follow = Math.min(1, dt / Math.max(0.05, k.trackLag));
    ai.track.x += (current.x - ai.track.x) * follow; ai.track.y += (current.y - ai.track.y) * follow; ai.track.z += (current.z - ai.track.z) * follow;
    const dx = ai.track.x - eye[0], dz = ai.track.z - eye[2];
    const dist = Math.hypot(dx, dz);
    // Pick the right tool.
    const wantSidearm = (WEAPONS[bot.weapons.primary]?.action === 'bolt' && dist < 9) || !bot.weapons.primary || (bot.ammo.primary && bot.ammo.primary.mag + bot.ammo.primary.reserve === 0);
    const wantSlot = wantSidearm ? 'sidearm' : 'primary';
    if (bot.active !== wantSlot && !bot.reloadEnd) room.switchWeapon(bot, wantSlot);
    const weapon = WEAPONS[bot.weapons[bot.active]];
    const aimY = ai.track.y + (ai.aimHead && target.seesChest !== false ? (crouched ? 1.06 : 1.6) : target.seesChest ? (crouched ? 0.7 : 1.15) : (crouched ? 1.06 : 1.6));
    const rattled = t - ai.hurtAt < 1.2 ? 1.5 - k.composure * 0.5 : 1;
    const moving = ai.strafeVel * ai.strafeVel > 4 ? 1.35 : 1;
    const errorScale = ((diff.error * Math.PI) / 180) * (1 + dist / 140) * (1 + (current.speed || 0) / 5) * (weapon.family === 'sniper' ? 1 : 1.5) * (room.variant === 'night' || room.variant === 'storm' ? 1.25 : 1) * rattled * moving;
    // Aim point = the target, plus this engagement's bias, the unsettled first flick, and the hand's drift.
    const spread = 1 + ai.settle * 1.8;
    const yaw = Math.atan2(-dx, -dz) + (ai.errYaw * spread + ai.noiseYaw * 0.55) * errorScale;
    const pitch = Math.atan2(aimY - eye[1], dist) + (ai.errPitch * spread + ai.noisePitch * 0.55) * errorScale * 0.7;
    const off = turnToward(bot, yaw, pitch, t < ai.reactAt ? 0.55 : 1, dt);

    // Footwork: dancers strafe, planters stop and shoot; snipers mostly plant, and everyone moves after being hit.
    const sniping = weapon.family === 'sniper' || weapon.family === 'marksman';
    const wantsToMove = t < ai.evadeUntil || dist < 14 || (!sniping && t >= ai.plantUntil);
    if (wantsToMove) {
      if (t > ai.strafeUntil) {
        ai.strafeUntil = t + rand(0.35, 1.5);
        if (Math.random() < 0.55) ai.strafe *= -1;
        // Now and then they just stop for a beat to steady a burst.
        if (!sniping && t >= ai.evadeUntil && Math.random() < 0.3 * (1 - k.dancer) + 0.08) ai.plantUntil = t + rand(0.4, 1.1);
      }
      bot.speed = strafe(room, bot, dt, (sniping ? 3.2 : 4.4) * k.pace);
      if (k.croucher > 0.75 && dist > 12 && t >= ai.evadeUntil && Math.sin(ai.scanPhase * 2.1) > 0.6) bot.flags |= FLAG.crouch;
    } else {
      ai.strafeVel *= Math.max(0, 1 - dt * 9);
      if (sniping) bot.flags |= FLAG.scoped;
      if (dist > 30 && (k.croucher > 0.45 || ai.scanPhase % 7 > 3.5)) bot.flags |= FLAG.crouch;
    }
    ai.scanPhase += dt;

    const ammo = bot.ammo[bot.active];
    const slow = !weapon.auto && weapon.cooldown >= 0.9;
    // A careful shot waits for the aim to settle; a rattled or impatient pilot lets it go early.
    const settledEnough = !slow || ai.settle < 0.25 * k.trigger || t - ai.hurtAt < 1 || t - ai.acquiredAt > diff.aimTime * 2.2;
    if (ammo && ammo.mag <= 0) room.startReload(bot);
    else if (t >= ai.reactAt && t >= ai.burstRestUntil && off < (slow ? 0.04 : 0.07) && settledEnough && t >= bot.nextFire && t >= bot.equipUntil && !bot.reloadEnd && t >= ai.evadeUntil - 0.2) {
      const dir = dirFromAngles(bot.yaw, bot.pitch);
      if (room.fire(bot, eye, dir, t, ++bot.shotSeq)) {
        ai.errYaw = ai.errYaw * 0.5 + gauss() * 0.75; ai.errPitch = ai.errPitch * 0.5 + gauss() * 0.75;
        ai.noisePitch -= (weapon.auto ? 0.5 : 1.2) * rand(0.6, 1.2);      // recoil climbs until they pull it back down
        ai.aimHead = Math.random() < diff.headBias;
        if (slow) {
          ai.reactAt = t + diff.aimTime * rand(0.8, 1.4);
          ai.settle = Math.max(ai.settle, 0.5);
          if (Math.random() < 0.3 + k.dancer * 0.35) { ai.evadeUntil = t + rand(0.5, 1.2); ai.strafe = Math.random() < 0.5 ? 1 : -1; }
        } else {
          // Automatic fire comes in bursts with a breath between them, longer at range.
          if (ai.burstLeft <= 0) ai.burstLeft = Math.round(rand(3, 8) * (dist < 15 ? 1.8 : 1));
          ai.burstLeft -= 1;
          if (ai.burstLeft <= 0 && weapon.auto) ai.burstRestUntil = t + rand(0.18, 0.5) * (dist > 25 ? 1.6 : 1);
          // Semi-autos are tapped at a human rhythm, not at the weapon's maximum rate.
          ai.reactAt = t + (weapon.auto ? rand(0.02, 0.1) : rand(0.16, 0.34) * (1.1 - k.skill * 0.2));
        }
      }
    }
    return;
  }
  ai.track = null;
  ai.strafeVel *= Math.max(0, 1 - dt * 8);

  // Nobody in sight: reload, then move.
  const ammo = bot.ammo[bot.active];
  const weapon = WEAPONS[bot.weapons[bot.active]];
  if (ammo && weapon && ammo.mag < weapon.mag * 0.5 && !bot.reloadEnd) room.startReload(bot);
  if (bot.active !== 'primary' && bot.weapons.primary && !bot.reloadEnd && bot.ammo.primary.mag + bot.ammo.primary.reserve > 0) room.switchWeapon(bot, 'primary');

  let holding = !ai.path;
  if (t < ai.evadeUntil) { bot.speed = strafe(room, bot, dt, 5 * k.pace); holding = false; }
  else if (!ai.path && t >= ai.repathAt && t >= ai.holdUntil) {
    ai.repathAt = t + 0.5;
    ai.goal = chooseGoal(room, bot, t);
    const accept = (node) => room.world.lineOfSight(bot.x, bot.y + 0.9, bot.z, node.x, node.y + 0.9, node.z) && Math.abs(node.y - bot.y) < 1.2;
    const start = room.nav.nearest(bot.x, bot.y, bot.z, accept) || room.nav.nearest(bot.x, bot.y, bot.z);
    // Each bot weighs the underpass and the open plaza differently, so they do not all take the shortest line.
    const path = start ? room.nav.path(start, ai.goal, (node) => (node.y < -1 ? ai.tunnelCost : Math.abs(node.x) < 9 ? ai.midCost : 1)) : null;
    if (path && path.length > 1) { ai.path = path; ai.pathIndex = 0; ai.skipAt = 0; } else { ai.lastKnown = null; ai.holdUntil = t + 1; }
  } else if (ai.path) {
    const hunting = ai.goal?.hunt;
    const nearGoal = ai.path.length - ai.pathIndex < 10;
    // People stop at corners to look before crossing; careful pilots do it more.
    if (t >= ai.nextPauseCheck) {
      ai.nextPauseCheck = t + rand(1.5, 3.5);
      if (Math.random() < 0.1 + (1 - k.aggression) * 0.22) { ai.pauseUntil = t + rand(0.5, 1.6); ai.glanceUntil = 0; }
    }
    const paused = t < ai.pauseUntil;
    const wanted = paused ? 0 : (hunting && nearGoal ? BODY.walkSpeed : 5.4 * k.pace * (hunting ? 1 : 0.92 + k.aggression * 0.08));
    // Speed builds up and bleeds off; nobody goes from a standstill to a sprint in one frame.
    ai.moveSpeed += clamp(wanted - ai.moveSpeed, -18 * dt, 12 * dt);
    bot.speed = ai.moveSpeed;
    if (ai.moveSpeed > 0.2 && ai.moveSpeed < 4) bot.flags |= FLAG.walking;
    holding = paused && ai.moveSpeed < 0.5;
    if (ai.moveSpeed > 0.05 && followPath(room, bot, dt, ai.moveSpeed)) {
      ai.path = null;
      if (hunting) ai.lastKnown = null;
      ai.holdUntil = t + rand(1.5, hunting ? 3 : 6) * (0.6 + k.patience * 0.9) * (1.3 - k.aggression * 0.6);
      ai.holdYaw = Math.atan2(bot.x, bot.z) + rand(-0.4, 0.4);
      ai.glanceUntil = 0;
    }
    // Hunters abandon stale trails when a fresher sound comes in.
    if (ai.lastKnown && ai.goal && !ai.goal.hunt && t - ai.lastKnown.t < 1) ai.path = null;
  }
  if (!ai.path) ai.moveSpeed += clamp(0 - ai.moveSpeed, -18 * dt, 18 * dt);
  // Holding an angle for a while, some settle into a crouch.
  if (holding && t < ai.holdUntil && k.croucher > 0.55 && ai.holdUntil - t < 4) bot.flags |= FLAG.crouch;

  // Where to look.
  ai.scanPhase += dt;
  if (t < ai.lookUntil && ai.lookYaw !== null) turnToward(bot, ai.lookYaw, rand(-0.01, 0.01), 0.8, dt);
  else {
    if (t >= ai.glanceUntil) pickGlance(room, bot, t, holding);
    // While running, the view stays tied to the direction of travel even mid-glance.
    const base = holding ? ai.glanceYaw : (ai.moveYaw ?? bot.yaw) + clamp(angleDiff(ai.glanceYaw, ai.moveYaw ?? bot.yaw), -1.2, 1.2);
    turnToward(bot, base + ai.noiseYaw * 0.01, ai.glancePitch + ai.noisePitch * 0.008, holding ? 0.45 : 0.6, dt);
  }
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
