// Server-side bots. They see with the same line-of-sight test the game uses,
// walk the generated nav grid and shoot through the same authoritative fire path
// as humans, so everything a bot does is a legal play.
import { BODY, BOT_DIFFICULTY, BOT_NAMES, COSMETICS, FLAG, MODIFIERS, WEAPONS, BOT_TYPES, BOT_TYPE_IDS } from '../shared/constants.js';
import { FINISHES, RARITY } from '../shared/economy.js';
import { dirFromAngles } from '../shared/combat.js';
import { makeBody } from '../shared/physics.js';

const VISIBILITY = { noon: 130, dusk: 110, storm: 75, night: 62 };
// A hop: how high it goes and how long it is off the floor.
const HOP = { peak: 0.55, time: 0.5 };
// How often a level does something daft. A Recruit throws rounds away; an Elite almost never does.
const QUIRK_RATE = { recruit: 1.6, veteran: 0.85, elite: 0.28 };
const GUN_IDS = Object.keys(WEAPONS);
const rand = (min, max) => min + Math.random() * (max - min);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, k) => a + (b - a) * k;

// Every bot is its own player. `skill` shifts it up or down within its level (−1 … +1, most near 0);
// the rest are habits: how hard it pushes, how long it holds an angle, whether it dances or plants its
// feet in a fight, how much a hit rattles it. Rolled once when the bot joins and kept for the match.
// One of the personalities, by weight.
function pickType() {
  const total = BOT_TYPE_IDS.reduce((sum, id) => sum + BOT_TYPES[id].weight, 0);
  let roll = Math.random() * total;
  for (const id of BOT_TYPE_IDS) { roll -= BOT_TYPES[id].weight; if (roll <= 0) return id; }
  return 'allround';
}
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
    chatty: Math.random(),                    // how often they call things out
    blade: Math.random(),                     // appetite for the knife up close
    jumpy: Math.random(),                     // hops for no good reason
  };
}
// The level's numbers bent by this bot's personality and how the match is going for them.
function profile(bot) {
  const base = BOT_DIFFICULTY[bot.difficulty] || BOT_DIFFICULTY.veteran;
  const k = bot.traits || (bot.traits = rollTraits());
  // Form drifts across a match, so a pilot has a sharp spell and then a scrappy one.
  const form = bot.ai?.form || 0;
  return { reaction: base.reaction * k.reaction * (1 + form * 0.18), aimTime: base.aimTime * k.aimTime * (1 + form * 0.14), error: base.error * k.error * (1 + form * 0.3), headBias: clamp(base.headBias * k.headBias * (1 - form * 0.25), 0, 0.6), fov: base.fov * k.awareness };
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
    // Judgement calls and bad seconds: the sidearm swap, the knife, the whiffed burst, the greedy push.
    form: 0, formAt: 0, nextQuirk: 0, whiffUntil: 0, panicUntil: 0, freezeUntil: 0, pushUntil: 0, peekUntil: 0,
    sidearmUntil: 0, dryAt: -99, bladeUntil: 0, bladeBan: 0, bladeCheck: 0, bladeSwings: 0, bladeMark: 0,
    // Radio discipline and both feet off the floor.
    quietUntil: 0, sawKill: null, hopAt: 0, hopEnd: 0, hopLift: 0, nextHop: 0,
  };
}

// Radio: one team should not sound like a radio play, so a call books the whole team quiet for a while.
const chatter = new WeakMap();
function canSpeak(room, bot, t, gap) {
  let book = chatter.get(room);
  if (!book) chatter.set(room, (book = {}));
  if (t < (book[bot.team] || 0)) return false;
  book[bot.team] = t + gap;
  return true;
}
function callOut(room, bot, t, id, chance) {
  const ai = bot.ai;
  if (t < ai.quietUntil || Math.random() > chance * (0.35 + bot.traits.chatty)) return;
  if (!canSpeak(room, bot, t, rand(20, 42))) return;
  ai.quietUntil = t + rand(30, 70);
  room.onQuick(bot, { id });
}
function spotCall(room, bot, seen, t) {
  const ai = bot.ai;
  if (t < ai.quietUntil || Math.random() > 0.3 * (0.3 + bot.traits.chatty)) return;
  if (!canSpeak(room, bot, t, rand(16, 34))) return;
  ai.quietUntil = t + rand(24, 60);
  room.onPing(bot, { x: seen.x, y: seen.y, z: seen.z, danger: true });
  if (Math.random() < 0.4) room.onQuick(bot, { id: 'spotted' });
}

// A hop is an arc laid on top of whatever the movement code already decided, so it can never walk a bot
// into geometry: only the headroom above them and the floor under them have to check out.
function tryHop(room, bot, t, chance) {
  const ai = bot.ai;
  if (t < ai.hopEnd || t < ai.nextHop || Math.random() > chance) return false;
  ai.nextHop = t + rand(4, 10);
  const node = ai.path && ai.pathIndex < ai.path.length ? ai.path[ai.pathIndex] : null;
  if (node && Math.abs(node.y - bot.y) > 0.05) return false;                       // stairs or a ramp: both feet stay down
  if (room.world.groundBelow(bot.x, bot.y + 0.1, bot.z) < bot.y - 0.12) return false;
  if (!room.world.bodyFree(bot.x, bot.y, bot.z, BODY.radius, BODY.height + HOP.peak)) return false;
  ai.hopAt = t; ai.hopEnd = t + HOP.time;
  return true;
}

// The magazine runs out mid-fight. Close in, with a loaded sidearm, most pilots pull it and keep shooting;
// the patient ones would rather break off and reload properly. Decided once, not every tick.
function dryMagazine(room, bot, t, near, sideReady) {
  const ai = bot.ai, k = bot.traits;
  if (bot.active === 'primary' && sideReady && near < 25 && t - ai.dryAt > 4) {
    ai.dryAt = t;
    const swap = 0.2 + k.aggression * 0.45 + (1 - k.patience) * 0.3 - (near / 25) * 0.25;
    if (Math.random() < swap) { ai.sidearmUntil = t + rand(5, 9); room.switchWeapon(bot, 'sidearm'); return; }
  }
  room.startReload(bot);
}

// One bad second, picked to suit the moment. Nothing here stops a bot acting for as long as a second.
function quirk(room, bot, t) {
  const ai = bot.ai;
  const roll = Math.random();
  if (ai.visible) {
    if (roll < 0.26) ai.whiffUntil = t + rand(0.4, 0.9);                            // a burst at where they were
    else if (roll < 0.48) { ai.panicUntil = t + rand(0.5, 1.2); ai.burstLeft = 14; }
    else if (roll < 0.6) ai.freezeUntil = t + rand(0.2, 0.7);                       // caught out, does nothing for a beat
    else if (roll < 0.82) { ai.pushUntil = t + rand(0.8, 1.8); ai.evadeUntil = 0; } // walks into a fight they should not take
    else room.startReload(bot);                                                     // reloading in the open
    return;
  }
  if (roll < 0.45 && ai.lastKnown) ai.peekUntil = t + rand(0.5, 1.2);               // one peek too many
  else if (roll < 0.7) ai.pauseUntil = t + rand(0.4, 0.9);
  else tryHop(room, bot, t, 0.6);
}

// Bots dress like pilots who have played a while: free and cheap gear is everywhere, the pricey pieces are
// a treat. Never anything from the Dev class: that belongs to the developers' accounts only.
const priceWeight = (item) => (item.price ? Math.min(1, (260 / item.price) ** 1.25) : 1.5);
const wearable = (item) => !item.dev && item.id !== 'devprism';
function lookPick(kind) {
  const list = COSMETICS[kind];
  let total = 0;
  for (const item of list) if (wearable(item)) total += priceWeight(item);
  let roll = Math.random() * total;
  for (const item of list) {
    if (!wearable(item)) continue;
    roll -= priceWeight(item);
    if (roll <= 0) return item.id;
  }
  return list[0].id;
}
// Gun finishes, weighted per rarity and shared out over the finishes in it, so a Mythic barely ever shows up.
const FINISH_ODDS = { common: 60, rare: 26, epic: 10, legendary: 3, mythic: 1 };
const BOT_FINISHES = (() => {
  const counts = {};
  for (const finish of FINISHES) counts[finish.rarity] = (counts[finish.rarity] || 0) + 1;
  return FINISHES.filter((finish) => !RARITY[finish.rarity].secret && FINISH_ODDS[finish.rarity])
    .map((finish) => ({ id: finish.id, weight: FINISH_ODDS[finish.rarity] / counts[finish.rarity] }));
})();
const FINISH_TOTAL = BOT_FINISHES.reduce((sum, finish) => sum + finish.weight, 0);
// Most pilots run a plain gun. The ones who do have a skin wear it on everything, the way the shop sells it.
function botSkins() {
  if (Math.random() > 0.34) return {};
  let roll = Math.random() * FINISH_TOTAL;
  let picked = BOT_FINISHES[0].id;
  for (const finish of BOT_FINISHES) { roll -= finish.weight; if (roll <= 0) { picked = finish.id; break; } }
  const skins = {};
  for (const id of GUN_IDS) skins[id] = picked;
  return skins;
}

export function createBot(room, team, difficulty) {
  const taken = new Set([...room.players.values()].map((p) => p.name));
  const pool = BOT_NAMES.filter((name) => !taken.has(name));
  const name = pool.length ? pool[Math.floor(Math.random() * pool.length)] : `Unit-${room.nextPlayer}`;
  const bot = room.newPlayer({
    name, team, bot: true, ready: true, difficulty, title: difficulty === 'elite' ? 'Deadeye' : difficulty === 'veteran' ? 'Marksman' : 'Recruit',
    color: lookPick('suit'), accent: lookPick('visor'), tracer: lookPick('tracer'),
    level: difficulty === 'elite' ? 18 : difficulty === 'veteran' ? 9 : 2,
    headgear: lookPick('headgear'), face: lookPick('face'), pack: lookPick('pack'), pattern: lookPick('pattern'), charm: lookPick('charm'), skins: botSkins(),
  });
  // Temperament: the type bends the rolled traits, so two Rushers still play a little differently.
  bot.botType = pickType();
  bot.traits = Object.assign(rollTraits(), BOT_TYPES[bot.botType].traits);
  // What people see in the lobby follows the bot's own skill, not just the level picked for the room.
  const tier = { recruit: 2, veteran: 9, elite: 18 }[difficulty] || 9;
  bot.level = Math.max(1, Math.round(tier + bot.traits.skill * tier * 0.6 + rand(-1, 1)));
  const titles = { recruit: ['Recruit', 'Recruit', 'Rifleman'], veteran: ['Rifleman', 'Marksman', 'Marksman', 'Sharpshooter'], elite: ['Sharpshooter', 'Deadeye', 'Deadeye', 'Ghost'] }[difficulty] || ['Marksman'];
  bot.title = titles[clamp(Math.round((bot.traits.skill + 1) / 2 * (titles.length - 1)), 0, titles.length - 1)];
  // Plenty of pilots wear something they bought rather than the rank they earned.
  if (Math.random() < 0.35) bot.title = lookPick('title');
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
  // Form runs across the whole match, not the round: a pilot having a night of it keeps having one.
  const form = bot.ai?.form ?? 0;
  bot.ai = freshAi();
  bot.ai.scanPhase = scan;
  bot.ai.form = form;
  bot.ai.pulseAt = rand(6, 30);
  bot.ai.openers = null;
  bot.ai.tunnelCost = rand(1, 3.2);
  bot.ai.midCost = rand(1, 2.4);
}

export function botBuy(room, bot) {
  // Some modes hand the guns out: there is nothing to buy.
  if (MODIFIERS[room.rules.modifier]?.fixed) return;
  if (room.rules.modifier !== 'instagib') {
    if (bot.credits >= 1500) room.buy(bot, 'heavy'); else if (bot.credits >= 700) room.buy(bot, 'light');
    if (bot.credits >= 900) room.buy(bot, 'helmet');
  }
  const roll = Math.random();
  // Bots mostly stick to long guns, with the odd rifle or SMG; they keep enough back for armour next round.
  if (room.rules.modifier !== 'sidearms' && bot.weapons.primary === 'm44') {
    // Taste follows temperament: pushers reach for rifles and SMGs, patient pilots stay on long guns.
    const pusher = bot.traits && bot.traits.aggression > 0.62, camper = bot.traits && bot.traits.patience > 0.6 && !pusher;
    const families = MODIFIERS[room.rules.modifier]?.families;
    const typeGuns = BOT_TYPES[bot.botType]?.guns;
    const picks = typeGuns ? typeGuns.map(([id, weight]) => [id, weight * 0.8]) : pusher ? [['talon', 0.2], ['halcyon', 0.16], ['wasp', 0.12], ['hornet', 0.1], ['ronin', 0.1], ['breaker', 0.05], ['recon', 0.06]] : camper ? [['recon', 0.22], ['vesper', 0.2], ['harbinger', 0.1], ['anvil', 0.05]] : [['recon', 0.16], ['vesper', 0.12], ['talon', 0.14], ['halcyon', 0.1], ['ronin', 0.08], ['harbinger', 0.05], ['anvil', 0.04], ['wasp', 0.04], ['hornet', 0.03]];
    // In the restricted modes they can only reach for what that mode allows.
    const allowed = families ? (picks.filter(([id]) => families.includes(WEAPONS[id].family)).length ? picks.filter(([id]) => families.includes(WEAPONS[id].family)) : Object.values(WEAPONS).filter((w) => families.includes(w.family)).map((w) => [w.id, 0.2])) : picks;
    let chance = roll;
    for (const [id, weight] of allowed) {
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
  // Shooting a team mate is worth an apology, whoever pulled the trigger.
  if (attacker.team === bot.team && attacker.bot && attacker.ai && attacker !== bot) callOut(room, attacker, room.time, 'sorry', 0.8);
  // Hurt and short of bodies: ask for help rather than die quietly.
  if (bot.hp < 45 && Math.random() < 0.5) {
    let mates = 0, foes = 0;
    for (const other of room.players.values()) {
      if (!other.alive || other.dummy) continue;
      if (other.team === bot.team) mates += 1; else foes += 1;
    }
    if (foes > mates) callOut(room, bot, room.time, 'help', 0.7);
  }
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
  // A mode can shorten how far a bot bothers to look (royale: nobody picks a fight at 100 m with a pistol).
  const maxDist = room.botSightRange?.(bot) ?? (VISIBILITY[room.variant] || 100);
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
      spotCall(room, bot, best, t);
      // A jump-peek round the corner, from the ones who play that way.
      if (best.dist > 8 && best.dist < 34) tryHop(room, bot, t, 0.05 * bot.traits.jumpy);
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
  // A mode can steer bots itself (the royale room sends them to loot and into the safe zone).
  const steered = room.botGoal?.(bot, t);
  if (steered) return steered;
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

// Sideways footwork, plus an optional walk straight ahead for the ones closing a knife or pushing a fight.
function strafe(room, bot, dt, speed, forward = 0) {
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
  const vx = sx * ai.strafeVel - Math.sin(bot.yaw) * forward, vz = sz * ai.strafeVel - Math.cos(bot.yaw) * forward;
  const want = Math.hypot(vx, vz);
  // Do not walk off ledges, whichever way the feet are taking them.
  if (want > 0.01) {
    const aheadX = bot.x + (vx / want) * 0.7, aheadZ = bot.z + (vz / want) * 0.7;
    if (room.world.groundBelow(aheadX, bot.y + 0.3, aheadZ) < bot.y - 0.6) { ai.strafe *= -1; ai.strafeVel *= 0.3; return Math.abs(ai.strafeVel); }
  }
  const fromX = bot.x, fromY = bot.y, fromZ = bot.z;
  room.world.moveBody(body, vx * dt, -0.05 - lift, vz * dt);
  if (want * dt > 0.01 && Math.hypot(body.x - bot.x, body.z - bot.z) < want * dt * 0.3) { ai.strafe *= -1; ai.strafeVel *= 0.2; }
  bot.x = body.x; bot.y = body.y; bot.z = body.z;
  // Walking forwards can wedge a body into a corner. If the step lands somewhere the server would reject
  // a pilot for standing, stay where they were and turn around instead.
  if (forward && !room.world.bodyFree(bot.x, bot.y + 0.3, bot.z, BODY.radius * 0.5, 0.9)) {
    bot.x = fromX; bot.y = fromY; bot.z = fromZ;
    ai.strafe *= -1; ai.strafeVel *= 0.2;
    return 0;
  }
  ai.path = null;
  return want;
}

// Where someone walking this route would be looking: mostly where they are going, with glances at
// doorways of interest: the last place a rival was heard, the far end of the map, a side angle.
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
  // Coming down under a parachute (royale): the room moves them until they land.
  if (bot.dropping) return;
  if (bot.dummy) return updateDummy(room, bot, dt);
  const ai = bot.ai;
  // Put them back on the floor before thinking, so every move is worked out from the ground they stand on.
  if (ai.hopLift) { bot.y -= ai.hopLift; ai.hopLift = 0; }
  think(room, bot, dt, t);
  // The speed other players see drives the running animation, so it eases between states too.
  ai.shownSpeed = (ai.shownSpeed || 0) + clamp(bot.speed - (ai.shownSpeed || 0), -16 * dt, 16 * dt);
  bot.speed = ai.shownSpeed;
  if (bot.speed > 0.2 && bot.speed < 4 && !(bot.flags & FLAG.crouch)) bot.flags |= FLAG.walking;
  if (t < ai.hopEnd) {
    const k = (t - ai.hopAt) / HOP.time;
    ai.hopLift = HOP.peak * 4 * k * (1 - k);
    bot.y += ai.hopLift;
    bot.flags &= ~FLAG.ground;              // watching clients animate the pilot in the air
  }
}

function think(room, bot, dt, t) {
  const ai = bot.ai;
  const k = bot.traits || (bot.traits = rollTraits());
  bot.flags = FLAG.ground;
  bot.speed = 0;
  if (room.phase !== 'live' && room.phase !== 'overtime') { ai.moveSpeed = 0; ai.strafeVel = 0; return; }
  const diff = profile(bot);
  // A mode can make a bot keep running its route whatever else is going on (the royale storm closing in):
  // it still shoots, but doesn't stop to strafe, pause or hunt.
  const fleeing = Boolean(room.botMustMove?.(bot, t));
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

  // Form: a slow walk up and down through the match, so nobody plays at one level for twenty minutes.
  if (t >= ai.formAt) { ai.formAt = t + rand(8, 18); ai.form = clamp(ai.form * 0.75 + gauss() * 0.4, -1, 1); }
  // A bad second now and then: a whiff, a panic spray, a greedy push, a reload in the open. Rare, and
  // weighted by the pilot's own level, so Recruits are a mess and Elites almost never slip.
  if (t >= ai.nextQuirk) {
    ai.nextQuirk = t + rand(4, 9);
    const sloppy = clamp(0.5 - k.skill * 0.45, 0.05, 1) * (QUIRK_RATE[bot.difficulty] ?? 1) * (1.2 - k.composure * 0.4);
    if (!fleeing && Math.random() < 0.3 * sloppy) quirk(room, bot, t);
  }
  // The kill feed: a hop for their own, a word for a team mate's.
  const feed = room.lastKill;
  if (feed && feed !== ai.sawKill) {
    ai.sawKill = feed;
    if (feed.killer === bot.id) tryHop(room, bot, t, 0.1 + k.jumpy * 0.3);
    else if (room.players.get(feed.killer)?.team === bot.team) callOut(room, bot, t, 'nice', 0.3);
  }

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
    // A whiffed burst is just the eyes falling a long way behind: the shots go where they were.
    const follow = Math.min(1, dt / Math.max(0.05, k.trackLag * (t < ai.whiffUntil ? 9 : 1)));
    ai.track.x += (current.x - ai.track.x) * follow; ai.track.y += (current.y - ai.track.y) * follow; ai.track.z += (current.z - ai.track.z) * follow;
    const dx = ai.track.x - eye[0], dz = ai.track.z - eye[2];
    const dist = Math.hypot(dx, dz);
    const near = Math.hypot(current.x - bot.x, current.z - bot.z);   // where they really are: for the knife and the swap
    const sideReady = Boolean(bot.weapons.sidearm) && (bot.ammo.sidearm?.mag ?? 0) > 0;
    const primaryOut = Boolean(bot.ammo.primary) && bot.ammo.primary.mag + bot.ammo.primary.reserve === 0;

    // The knife: close, in front, and either the gun is empty or this pilot likes it. A few swings without
    // a body and they give it up and go back to shooting, the way anyone would.
    if (t >= ai.bladeCheck && bot.weapons.melee) {
      ai.bladeCheck = t + 0.35;
      const facing = Math.abs(angleDiff(Math.atan2(-(current.x - bot.x), -(current.z - bot.z)), bot.yaw));
      const empty = (bot.ammo[bot.active]?.mag ?? 1) <= 0 && !sideReady;
      if (near < 3.5 && facing < 0.9 && t >= ai.bladeBan && t >= ai.bladeUntil) {
        const appetite = k.blade * (0.3 + k.aggression * 0.7) * (bot.botType === 'rusher' ? 1.8 : 1);
        if (empty || Math.random() < 0.2 * appetite) { ai.bladeUntil = t + 2.6; ai.bladeSwings = 0; ai.bladeMark = bot.match.kills; }
      }
    }
    const blading = t < ai.bladeUntil && Boolean(bot.weapons.melee) && near < 4.5;
    // A knife run that came to nothing: back to the gun, and no more knife ideas for a while.
    if (!blading && ai.bladeUntil) { ai.bladeUntil = 0; if (bot.match.kills === ai.bladeMark) ai.bladeBan = t + rand(6, 16); }
    // Pick the right tool. A dry magazine in a close fight is a judgement call: pull the sidearm and keep
    // shooting, or duck the fight and reload. Impatient pilots swap; patient ones reload.
    const wantSidearm = (WEAPONS[bot.weapons.primary]?.action === 'bolt' && dist < 9) || !bot.weapons.primary || primaryOut || (t < ai.sidearmUntil && sideReady);
    const wantSlot = blading ? 'melee' : wantSidearm ? 'sidearm' : 'primary';
    if (bot.active !== wantSlot && !bot.reloadEnd) room.switchWeapon(bot, wantSlot);
    const weapon = WEAPONS[bot.weapons[bot.active]];
    const aimY = ai.track.y + (ai.aimHead && target.seesChest !== false ? (crouched ? 1.06 : 1.6) : target.seesChest ? (crouched ? 0.7 : 1.15) : (crouched ? 1.06 : 1.6));
    const rattled = t - ai.hurtAt < 1.2 ? 1.5 - k.composure * 0.5 : 1;
    const moving = ai.strafeVel * ai.strafeVel > 4 ? 1.35 : 1;
    const panic = t < ai.panicUntil;
    const errorScale = ((diff.error * Math.PI) / 180) * (1 + dist / 140) * (1 + (current.speed || 0) / 5) * (weapon.family === 'sniper' ? 1 : 1.5) * (room.variant === 'night' || room.variant === 'storm' ? 1.25 : 1) * rattled * moving * (panic ? 2.4 : 1);
    // Aim point = the target, plus this engagement's bias, the unsettled first flick, and the hand's drift.
    const spread = 1 + ai.settle * 1.8;
    const yaw = Math.atan2(-dx, -dz) + (ai.errYaw * spread + ai.noiseYaw * 0.55) * errorScale;
    const pitch = Math.atan2(aimY - eye[1], dist) + (ai.errPitch * spread + ai.noisePitch * 0.55) * errorScale * 0.7;
    const off = turnToward(bot, yaw, pitch, t < ai.reactAt ? 0.55 : 1, dt);

    // Footwork: dancers strafe, planters stop and shoot; snipers mostly plant, and everyone moves after being hit.
    // A knife run or a greedy push walks them straight at the fight instead.
    const sniping = weapon.family === 'sniper' || weapon.family === 'marksman';
    const charge = blading ? 5.6 * k.pace : (t < ai.pushUntil ? 5 * k.pace : 0);
    const frozen = t < ai.freezeUntil;
    const wantsToMove = !frozen && (charge > 0 || t < ai.evadeUntil || dist < 14 || (!sniping && t >= ai.plantUntil));
    if (fleeing) ai.evadeUntil = 0;
    else if (wantsToMove) {
      if (t > ai.strafeUntil) {
        ai.strafeUntil = t + rand(0.35, 1.5);
        if (Math.random() < 0.55) ai.strafe *= -1;
        // Now and then they just stop for a beat to steady a burst.
        if (!sniping && t >= ai.evadeUntil && Math.random() < 0.3 * (1 - k.dancer) + 0.08) ai.plantUntil = t + rand(0.4, 1.1);
      }
      bot.speed = strafe(room, bot, dt, (charge ? 2.2 : sniping ? 3.2 : 4.4) * k.pace, charge);
      if (k.croucher > 0.75 && dist > 12 && t >= ai.evadeUntil && !charge && Math.sin(ai.scanPhase * 2.1) > 0.6) bot.flags |= FLAG.crouch;
    } else {
      ai.strafeVel *= Math.max(0, 1 - dt * 9);
      if (sniping) bot.flags |= FLAG.scoped;
      if (dist > 30 && (k.croucher > 0.45 || ai.scanPhase % 7 > 3.5)) bot.flags |= FLAG.crouch;
    }
    ai.scanPhase += dt;

    const ammo = bot.ammo[bot.active];
    const slow = !weapon.auto && weapon.cooldown >= 0.9;
    // A careful shot waits for the aim to settle; a rattled or impatient pilot lets it go early.
    const settledEnough = !slow || ai.settle < 0.25 * k.trigger || t - ai.hurtAt < 1 || t - ai.acquiredAt > diff.aimTime * 2.2 || panic;
    if (blading) {
      // Swing only once they are genuinely inside reach: a swing at air is a wasted second.
      if (bot.active === 'melee' && t >= bot.nextFire && t >= bot.equipUntil && !frozen && near <= weapon.range - 0.2) {
        room.onMelee(bot, { t });
        ai.bladeSwings += 1;
        if (bot.match.kills > ai.bladeMark) ai.bladeUntil = 0;
        else if (ai.bladeSwings >= 3) { ai.bladeUntil = 0; ai.bladeBan = t + rand(10, 25); }  // three swings and no body: back to the gun
      }
    } else if (ammo && ammo.mag <= 0) dryMagazine(room, bot, t, near, sideReady);
    else if (!frozen && t >= ai.reactAt && (t >= ai.burstRestUntil || panic) && off < (slow ? 0.04 : 0.07) * (panic ? 2.5 : 1) && settledEnough && t >= bot.nextFire && t >= bot.equipUntil && !bot.reloadEnd && t >= ai.evadeUntil - 0.2) {
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
  if (t < ai.freezeUntil && !fleeing) { ai.moveSpeed = 0; holding = true; }   // frozen for a beat, not for a round
  else if (t < ai.evadeUntil && !fleeing) { bot.speed = strafe(room, bot, dt, 5 * k.pace); holding = false; }
  else if (t < ai.peekUntil && ai.lastKnown && !fleeing) {
    // One peek too many: they lean out at the noise instead of holding the wall.
    ai.lookYaw = Math.atan2(-(ai.lastKnown.x - bot.x), -(ai.lastKnown.z - bot.z));
    ai.lookUntil = Math.max(ai.lookUntil, ai.peekUntil);
    bot.speed = strafe(room, bot, dt, 1.4 * k.pace, 3.4 * k.pace);
    holding = false;
  } else if (!ai.path && t >= ai.repathAt && (t >= ai.holdUntil || fleeing)) {
    ai.repathAt = t + 0.5;
    ai.goal = chooseGoal(room, bot, t);
    // A change of plan is worth saying out loud: chasing someone down, or settling on an angle.
    if (ai.goal?.hunt) callOut(room, bot, t, 'push', 0.05);
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
    const paused = t < ai.pauseUntil && !fleeing;
    const wanted = paused ? 0 : (hunting && nearGoal ? BODY.walkSpeed : 5.4 * k.pace * (hunting ? 1 : 0.92 + k.aggression * 0.08));
    // Speed builds up and bleeds off; nobody goes from a standstill to a sprint in one frame.
    ai.moveSpeed += clamp(wanted - ai.moveSpeed, -18 * dt, 12 * dt);
    bot.speed = ai.moveSpeed;
    if (ai.moveSpeed > 0.2 && ai.moveSpeed < 4) bot.flags |= FLAG.walking;
    holding = paused && ai.moveSpeed < 0.5;
    // The odd hop on a long run, for no better reason than people do it.
    if (!paused && ai.moveSpeed > 4 && t >= ai.nextHop) tryHop(room, bot, t, 0.004 * k.jumpy);
    if (ai.moveSpeed > 0.05 && followPath(room, bot, dt, ai.moveSpeed)) {
      ai.path = null;
      if (hunting) ai.lastKnown = null;
      ai.holdUntil = t + rand(1.5, hunting ? 3 : 6) * (0.6 + k.patience * 0.9) * (1.3 - k.aggression * 0.6);
      ai.holdYaw = Math.atan2(bot.x, bot.z) + rand(-0.4, 0.4);
      ai.glanceUntil = 0;
      if (!hunting) callOut(room, bot, t, 'hold', 0.08);
    }
    // Hunters abandon stale trails when a fresher sound comes in.
    if (!fleeing && ai.lastKnown && ai.goal && !ai.goal.hunt && t - ai.lastKnown.t < 1) ai.path = null;
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
