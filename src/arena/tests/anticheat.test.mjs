// The server is the authority: what a tampered client sends is checked against what a real one could
// do. Every exploit here was reproduced against the old code first. Each check is paired with an honest
// pilot doing the same thing properly, because a check that snaps real players back is its own bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

let clock = performance.now();
performance.now = () => clock;
const { ProfileStore } = await import('../server/profiles.js');
const { Room } = await import('../server/room.js');
const { RoyaleRoom } = await import('../server/royale.js');
const { setRoomMap } = await import('../server/mapflow.js');
const { BODY, FLAG } = await import('../shared/constants.js');
const { MAP_IDS } = await import('../shared/map.js');
const { World, makeBody } = await import('../shared/physics.js');
const { mulberry32 } = await import('../shared/combat.js');
const { DEPLOY, descentStep } = await import('../shared/royale.js');

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const socket = () => ({ readyState: 1, sent: [], send(raw) { const message = JSON.parse(raw); if (message.type !== 's') this.sent.push(message); } });
const round = (value) => Math.round(value * 100) / 100;
const tick = (seconds) => { clock += seconds * 1000; };

async function arena(map = 'yard', queue = 'custom') {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-cheat-')), 'profiles.json'));
  const room = new Room({ name: `cheat-${Math.random().toString(36).slice(2, 7)}`, queue, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  setRoomMap(room, map);
  const player = room.join(socket(), { token: ProfileStore.newToken(), session: 's1', name: 'Pilot' }, look);
  room.phase = 'live';
  room.setBarriers(false);
  room.spawn(player, 0);
  return { room, player, profiles };
}
// One state message, where the pilot says it is.
const state = (room, player, x, y, z, extra = {}) => room.onState(player, { e: player.epoch, x, y, z, yaw: 0, pitch: 0, f: 4, ...extra });
const at = (player, x, y, z) => Math.abs(player.x - x) < 1e-6 && Math.abs(player.y - y) < 1e-6 && Math.abs(player.z - z) < 1e-6;

// A pilot running flat out the way the browser moves one: the shared physics, 60 frames a second, a
// state every other frame, and the network bunching those up now and then.
function honestRun(room, player, { seconds = 20, speed = BODY.flowMax, seed = 1, hitch = 0.02 } = {}) {
  const world = new World(room.map.boxes);
  const body = makeBody(player.x, player.y, player.z);
  body.onGround = true;
  const random = mulberry32(seed);
  const { bounds } = room.map;
  let heading = random() * Math.PI * 2, holdUntil = 0, refused = 0, sent = 0;
  const queue = [];
  for (let frame = 0; frame < seconds * 60; frame += 1) {
    const dt = 1 / 60;
    tick(dt);
    if (random() < 0.01) heading += (random() - 0.5) * 2.5;
    if (body.onGround && random() < 0.03) body.vy = BODY.jumpVelocity;
    body.vy -= BODY.gravity * dt;
    const beforeX = body.x, beforeZ = body.z;
    const dx = -Math.sin(heading) * speed * dt, dz = -Math.cos(heading) * speed * dt;
    world.moveBody(body, dx, body.vy * dt, dz);
    if (Math.hypot(body.x - beforeX, body.z - beforeZ) < Math.hypot(dx, dz) * 0.5) heading += Math.PI / 2 + random();
    body.x = Math.min(bounds.maxX - 0.4, Math.max(bounds.minX + 0.4, body.x));
    body.z = Math.min(bounds.maxZ - 0.4, Math.max(bounds.minZ + 0.4, body.z));
    if (frame % 2 === 0) queue.push([round(body.x), round(body.y), round(body.z)]);
    // A hitch holds the updates back, then they all arrive at once.
    if (!holdUntil && random() < hitch) holdUntil = clock + random() * 250;
    if (holdUntil && clock < holdUntil) continue;
    holdUntil = 0;
    for (const [x, y, z] of queue.splice(0)) {
      sent += 1;
      state(room, player, x, y, z);
      if (!at(player, x, y, z)) refused += 1;
    }
  }
  return { refused, sent };
}

test('an honest pilot flat out on every arena is never refused, hitches and all', async () => {
  for (const map of MAP_IDS) {
    const { room, player } = await arena(map);
    for (let seed = 1; seed <= 3; seed += 1) {
      room.spawn(player, seed);
      const { refused, sent } = honestRun(room, player, { seed: seed * 7 + map.length, seconds: 15 });
      assert.equal(refused, 0, `${map}: ${refused} of ${sent} honest updates refused`);
    }
    room.close();
  }
});

// A straight run of open, level floor from where the pilot stands, so what stops a move is the check
// under test and not a crate in the way.
const probe = (room) => (x, y, z) => room.world.bodyFree(x, y + 0.3, z, BODY.radius * 0.5, 0.9);
function openLane(room, player, length) {
  for (const map of [room.map]) for (let k = 0; k < 16; k += 1) {
    const dx = Math.sin(k * Math.PI / 8), dz = Math.cos(k * Math.PI / 8);
    const end = [player.x + dx * length, player.y, player.z + dz * length];
    const level = Math.abs(room.world.groundBelow(end[0], player.y + 0.2, end[2]) - player.y) < 0.05;
    if (level && room.swept([player.x, player.y, player.z], end, probe(room))) return [dx, dz];
    void map;
  }
  return null;
}

test('short steps sent fast no longer add up to any speed you like', async () => {
  const { room, player } = await arena('range');
  const lane = openLane(room, player, 40);
  assert.ok(lane, 'no open lane');
  const start = { x: player.x, z: player.z };
  // 0.89 m a message at 140 messages a second, down open floor: 125 m/s asked for.
  for (let i = 0; i < 140; i += 1) { tick(1 / 140); state(room, player, player.x + lane[0] * 0.89, player.y, player.z + lane[1] * 0.89); }
  const moved = Math.hypot(player.x - start.x, player.z - start.z);
  assert.ok(moved <= BODY.speedLimit * (1 + 0.3) + 0.5, `covered ${moved.toFixed(1)} m in a second`);
  room.close();
});

test('going quiet does not bank a teleport', async () => {
  const { room, player } = await arena('range');
  const lane = openLane(room, player, 40);
  assert.ok(lane, 'no open lane');
  // One honest update, so the server has a last time to measure the silence from.
  tick(1 / 30);
  state(room, player, player.x, player.y, player.z);
  tick(8);
  const x = player.x, z = player.z;
  state(room, player, x + lane[0] * 40, player.y, z + lane[1] * 40);
  assert.ok(at(player, x, player.y, z), 'eight quiet seconds bought a 40 m jump');
  room.close();
});

// A wall no thicker than a step, open floor either side of it.
function thinWall(room) {
  for (const box of room.map.boxes) {
    if (box.deco || box.max[1] - box.min[1] < 2 || box.min[1] > 0.3) continue;
    for (const axis of [0, 2]) {
      const other = axis === 0 ? 2 : 0;
      if (box.max[axis] - box.min[axis] > 0.4 || box.max[other] - box.min[other] < 1.5) continue;
      const mid = (box.min[other] + box.max[other]) / 2, y = room.world.groundBelow(box.min[0] - 0.5, 1, box.min[2] - 0.5);
      const spot = (along) => (axis === 0 ? [along, y, mid] : [mid, y, along]);
      const before = spot(box.min[axis] - 0.3), after = spot(box.max[axis] + 0.3);
      if (probe(room)(...before) && probe(room)(...after) && Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.9) return { before, after, axis, box };
    }
  }
  return null;
}

test('one step does not go through a wall', async () => {
  let found = null, room = null, player = null;
  for (const map of MAP_IDS) { ({ room, player } = await arena(map)); found = thinWall(room); if (found) break; room.close(); }
  assert.ok(found, 'no thin wall on any map to test against');
  room.spawn(player, 0, { x: found.before[0], y: found.before[1], z: found.before[2] });
  tick(0.2);
  state(room, player, ...found.after);
  assert.ok(at(player, ...found.before), 'stepped straight through the wall');
  room.close();
});

test('landing on top of something is still only a jump high', async () => {
  const { room, player } = await arena('yard');
  // Something solid well over a jump high, stood right at its foot, and a spot just over the edge on top.
  const block = room.map.boxes.find((box) => !box.deco && box.min[1] < 0.3 && box.max[1] > 4 && box.max[1] < 12 && (box.max[0] - box.min[0]) > 1.5 && (box.max[2] - box.min[2]) > 1.5
    && probe(room)(box.min[0] - 0.4, 0, (box.min[2] + box.max[2]) / 2) && probe(room)(box.min[0] + 0.35, box.max[1], (box.min[2] + box.max[2]) / 2));
  assert.ok(block, 'nothing tall to climb');
  const z = (block.min[2] + block.max[2]) / 2;
  room.spawn(player, 0, { x: block.min[0] - 0.4, y: room.world.groundBelow(block.min[0] - 0.4, 1, z), z });
  tick(1 / 60);
  state(room, player, block.min[0] + 0.35, block.max[1], z);
  assert.ok(player.y < block.max[1] - 1, `stood on a ${block.max[1].toFixed(1)} m block in one message`);
  room.close();
});

test('nobody gets under the floor', async () => {
  const { room, player } = await arena('atrium');
  const { x, z } = player;
  for (let i = 0; i < 20; i += 1) { tick(1 / 30); state(room, player, x, -0.6 - i * 0.1, z); }
  assert.ok(player.y > -0.05, `sank to ${player.y.toFixed(2)} m, under the floor`);
  room.close();
});

// Off the ramp the fall is the pilot's own movement, so the server holds it to the free fall and chute
// speeds. Each honest way down is flown with the browser's own descent code (descentStep).
async function freshDrop() {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-drop-')), 'profiles.json'));
  const room = new RoyaleRoom({ name: `drop-${Math.random()}`, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join(socket(), { token: ProfileStore.newToken(), session: 'd', name: 'Faller' }, look);
  room.startMatch(); room.deploy();
  clock = room.flight.doorsAt * 1000 + 100;
  room.handle(player, { type: 'royale-jump' });
  assert.ok(!player.inPlane, 'the jump was refused');
  return { room, player };
}
function flyDown(room, player, { pitch = -0.2, forward = 0, openAt = null } = {}) {
  const world = new World(room.map.boxes);
  const body = makeBody(player.x, player.y, player.z);
  let stage = 'freefall', vy = 0, since = 0, refused = 0, yaw = player.yaw;
  for (let frame = 0; frame < 60 * 150 && !body.onGround; frame += 1) {
    const dt = 1 / 60;
    tick(dt); since += dt;
    const above = body.y - world.groundBelow(body.x, body.y + 0.2, body.z);
    if (stage === 'freefall' && (above < DEPLOY.autoDeploy || (openAt !== null && since >= openAt))) stage = 'chute';
    const step = descentStep(stage, vy, forward, stage === 'chute' ? 0 : pitch, dt);
    vy = step.vy;
    world.moveBody(body, -Math.sin(yaw) * step.glide * dt, vy * dt, -Math.cos(yaw) * step.glide * dt);
    // The browser holds a pilot inside the island's bounds (player.js); gliding off the edge stops there.
    const edge = room.map.bounds.maxX - 0.4;
    body.x = Math.max(-edge, Math.min(edge, body.x)); body.z = Math.max(-edge, Math.min(edge, body.z));
    if (frame % 2) continue;
    state(room, player, round(body.x), round(body.y), round(body.z), { f: stage === 'chute' ? FLAG.chute : 0 });
    if (!at(player, round(body.x), round(body.y), round(body.z))) refused += 1;
  }
  // A browser keeps sending once it is down, which is how the server hears it landed.
  tick(1 / 30);
  state(room, player, round(body.x), round(body.y), round(body.z));
  return { landed: body.onGround, refused };
}

test('the royale drop cannot be skipped, and every honest way down is taken', async () => {
  // Cheat: one message from the ramp to the ground.
  const cheat = await freshDrop();
  const top = cheat.player.y, ground = cheat.room.world.groundBelow(cheat.player.x, top, cheat.player.z);
  tick(1 / 30);
  state(cheat.room, cheat.player, cheat.player.x, ground, cheat.player.z);
  assert.ok(cheat.player.y > top - 20, 'landed from the aircraft in one message');
  // Cheat: the chute says open, then falls at free fall speed anyway.
  tick(1.5);
  for (let i = 0; i < 30; i += 1) { tick(1 / 30); state(cheat.room, cheat.player, cheat.player.x, cheat.player.y - 0.3, cheat.player.z, { f: FLAG.chute }); }
  const at1 = cheat.player.y;
  tick(DEPLOY.parachute.open + 1);
  for (let i = 0; i < 30; i += 1) { tick(1 / 30); state(cheat.room, cheat.player, cheat.player.x, cheat.player.y - 1.2, cheat.player.z, { f: FLAG.chute }); }
  assert.ok(at1 - cheat.player.y < DEPLOY.parachute.dive * 1.3 * 1.3 + 5, `fell ${(at1 - cheat.player.y).toFixed(1)} m in a second under an open chute`);
  cheat.room.close();
  // Honest: level, diving, opening early, diving under the chute, braking under it.
  for (const way of [{}, { pitch: -1.4 }, { openAt: 2 }, { openAt: 2, forward: 1 }, { openAt: 3, forward: -1 }]) {
    const { room, player } = await freshDrop();
    const { landed, refused } = flyDown(room, player, way);
    assert.ok(landed, `${JSON.stringify(way)}: never landed`);
    assert.equal(refused, 0, `${JSON.stringify(way)}: ${refused} honest updates refused`);
    assert.ok(!player.inDrop, `${JSON.stringify(way)}: still deploying after landing`);
    room.close();
  }
});

test('nothing is fired, swung or thrown on the way down', async () => {
  const { room, player } = await freshDrop();
  player.weapons.sidearm = 'p9'; player.active = 'sidearm'; player.ammo.sidearm = { mag: 10, reserve: 10 }; player.gadgets = ['stim'];
  player.hp = 50;
  room.onFire(player, { o: room.eyeOf(player), d: [0, -1, 0], t: performance.now() / 1000, seq: 1 });
  assert.equal(player.ammo.sidearm.mag, 10, 'fired during the deployment');
  room.handle(player, { type: 'gadget', slot: 0 });
  assert.deepEqual(player.gadgets, ['stim'], 'a gadget went off during the deployment');
  room.close();
});

test('the drone flies at drone speed and stays in the map', async () => {
  const { room, player } = await arena('yard');
  player.gadgets = ['drone'];
  room.handle(player, { type: 'gadget', slot: 0 });
  assert.ok(player.drone, 'no drone');
  const start = { ...player.drone };
  // Ten 2.9 m hops, a frame apart, climbing: just under the old 3 m a message, so it took every one.
  for (let i = 0; i < 10; i += 1) { tick(0.033); state(room, player, player.x, player.y, player.z, { drone: [start.x, start.y + (i + 1) * 2.9, start.z, 0, 0] }); }
  assert.ok(player.drone.y <= 14 + 1e-6, `the drone is ${player.drone.y.toFixed(1)} m up, over the map`);
  assert.ok(player.drone.y - start.y < 18 * 0.33 + 18 * 0.3 + 0.1, `the drone climbed ${(player.drone.y - start.y).toFixed(1)} m in a third of a second`);
  // Flown honestly, flat out down a clear lane, it goes where it is flown.
  const from = { ...player.drone };
  const free = (x, y, z) => room.world.bodyFree(x, y - 0.15, z, 0.15, 0.3);
  const lane = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.sin(k * Math.PI / 4), Math.cos(k * Math.PI / 4)])
    .find(([dx, dz]) => room.swept([from.x, from.y, from.z], [from.x + dx * 8.4, from.y, from.z + dz * 8.4], free));
  assert.ok(lane, 'no clear lane to fly');
  for (let i = 1; i <= 30; i += 1) {
    tick(1 / 30);
    const to = [from.x + lane[0] * i * 0.28, from.y, from.z + lane[1] * i * 0.28];
    state(room, player, player.x, player.y, player.z, { drone: [...to, 0, 0] });
    assert.ok(Math.hypot(player.drone.x - to[0], player.drone.z - to[2]) < 1e-6, `an honest drone move was refused at step ${i}`);
  }
  room.close();
});

// ------------------------------------------------------------------ shooting
async function duel(map = 'range') {
  const { room, player, profiles } = await arena(map);
  const target = room.join(socket(), { token: ProfileStore.newToken(), session: 's2', name: 'Target' }, look);
  target.team = player.team === 'A' ? 'B' : 'A';
  room.phase = 'live';
  room.spawn(target, 0);
  return { room, shooter: player, target, profiles };
}
const shoot = (room, shooter, origin, aim, seq) => {
  shooter.nextFire = 0; shooter.equipUntil = 0; shooter.reloadEnd = 0;
  shooter.ammo[shooter.active] = { mag: 30, reserve: 90 };
  const d = [aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]];
  room.onFire(shooter, { o: origin, d, t: performance.now() / 1000, seq });
  return shooter.shotLog[shooter.shotLog.length - 1];
};

test('a shot starts at the shooter\'s eye, not on the far side of a wall', async () => {
  let found = null, room = null, player = null;
  for (const map of MAP_IDS) { ({ room, player } = await arena(map)); found = thinWall(room); if (found) break; room.close(); }
  assert.ok(found, 'no wall to shoot through');
  room.spawn(player, 0, { x: found.before[0], y: found.before[1], z: found.before[2] });
  const eye = room.eyeOf(player);
  // 0.9 m from the eye, but through the wall.
  const beyond = [...eye];
  beyond[found.axis] += found.after[found.axis] > found.before[found.axis] ? 0.9 : -0.9;
  const aim = [...beyond]; aim[found.axis] += (beyond[found.axis] - eye[found.axis]) * 10;
  const shot = shoot(room, player, beyond, aim, 1);
  assert.deepEqual(shot.origin, eye.map(round), 'the shot was fired from the far side of the wall');
  // And from a spot the pilot could really be, it is taken as sent.
  const near = [eye[0], eye[1] - 0.4, eye[2]];
  const honest = shoot(room, player, near, [near[0] + 5, near[1], near[2] + 5], 2);
  assert.deepEqual(honest.origin, near.map(round), 'an honest origin was moved');
  room.close();
});

test('the spread seed is the server\'s count, so a cheat cannot pick a lucky one', async () => {
  const { room, shooter } = await duel();
  const eye = room.eyeOf(shooter), aim = [eye[0], eye[1], eye[2] - 10];
  // An honest page counts up by one, and the server agrees with it shot for shot.
  for (let seq = 40; seq < 45; seq += 1) { shoot(room, shooter, room.eyeOf(shooter), aim, seq); assert.equal(shooter.shotSeq, seq, 'an honest count was not followed'); }
  // A cheat jumping to whichever number it likes gets the next one in line instead.
  for (const pick of [4127, 9, 4127, 88888]) { const before = shooter.shotSeq; shoot(room, shooter, room.eyeOf(shooter), aim, pick); assert.equal(shooter.shotSeq, before + 1, `seq ${pick} was used as sent`); }
  // A page that reloads starts counting again, and a reconnect lets it.
  shooter.connected = false;
  room.join(socket(), { token: shooter.token, session: shooter.session, name: shooter.name }, look);
  shoot(room, shooter, room.eyeOf(shooter), aim, 1);
  assert.equal(shooter.shotSeq, 1, 'a reloaded page is out of step with the server for the rest of the match');
  room.close();
});

// ------------------------------------------------------------------ buying and rules
test('a prototype key buys nothing, and credits stay a number', async () => {
  const { room, player } = await arena('yard');
  room.phase = 'buy';
  player.credits = 800;
  for (const item of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) room.handle(player, { type: 'buy', item });
  assert.ok(Number.isFinite(player.credits), `credits became ${player.credits}`);
  assert.equal(player.credits, 800);
  room.handle(player, { type: 'buy', item: 'heavy' });
  assert.ok(player.credits < 800 || player.armor === 0, 'armour was free');
  assert.ok(!Object.values(player.weapons).some((id) => id && typeof id === 'string' && !['m44', 'p9', 'knife'].includes(id)), 'a junk weapon ended up in the loadout');
  room.close();
});

test('host rules and bots take only real values', async () => {
  const { room, player } = await arena('yard');
  room.phase = 'lobby';
  player.host = true;
  const before = { ...room.rules };
  room.handle(player, { type: 'rules', rules: { modifier: 'constructor', botDifficulty: '__proto__', variant: 'toString' } });
  assert.equal(room.rules.modifier, before.modifier);
  assert.equal(room.rules.botDifficulty, before.botDifficulty);
  assert.equal(room.rules.variant, before.variant);
  room.handle(player, { type: 'addbot', team: 'B', difficulty: 'constructor' });
  const bot = [...room.players.values()].find((p) => p.bot);
  assert.ok(bot && bot.difficulty !== 'constructor', 'a bot was made on a prototype key');
  room.close();
});

test('Gun Game and One in the Chamber sell nothing', async () => {
  const { room, player } = await arena('yard');
  for (const modifier of ['gungame', 'chamber']) {
    room.rules.modifier = modifier;
    room.phase = 'buy';
    player.credits = 9000; player.armor = 0; player.helmet = false; player.gadgets = [];
    for (const item of ['heavy', 'helmet', 'stim', 'drone']) room.handle(player, { type: 'buy', item });
    assert.equal(player.credits, 9000, `${modifier} sold something`);
    assert.equal(player.armor, 0, `${modifier} sold armour`);
  }
  room.close();
});

test('dev tools stay out of ranked and wagers, and still work elsewhere', async () => {
  for (const queue of ['ranked-1v1', 'custom']) {
    const { room, player } = await arena('yard', queue);
    player.dev = true;
    room.handle(player, { type: 'dev', tool: 'god', on: true });
    assert.equal(Boolean(player.devTools.god), queue === 'custom', `${queue}: god mode ${player.devTools.god ? 'on' : 'off'}`);
    room.close();
  }
});

// ------------------------------------------------------------------ who gets paid for a match
async function matchRoom(queue) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-late-')), 'profiles.json'));
  const room = new Room({ name: `${queue}-${Math.random().toString(36).slice(2, 6)}`, queue, isPublic: true, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  return { room, profiles };
}
const seatUp = (room, name, extra = {}) => room.join(socket(), { token: ProfileStore.newToken(), session: name, name, ...extra }, look);

test('a seat taken at match point earns nothing, and ranked turns it away', async () => {
  const { room, profiles } = await matchRoom('casual');
  const a = seatUp(room, 'Alpha'), b = seatUp(room, 'Bravo');
  room.startMatch();
  room.scores = { A: room.rules.roundsToWin - 1, B: 0 };
  for (let i = 1; i < 4; i += 1) room.startRound();
  const hopper = seatUp(room, 'Hopper');
  hopper.team = 'A';
  room.scores.A = room.rules.roundsToWin;
  room.endMatch();
  const record = profiles.get(hopper.token);
  assert.equal(record.stats.matches, 0, 'a match nobody played in was put on their record');
  assert.equal(record.xp, 0, 'XP for a match they never played');
  assert.equal(profiles.get(a.token).stats.matches, 1, 'the pilots who played it were not recorded');
  void b;
  room.close();
  const ranked = await matchRoom('ranked-2v2');
  seatUp(ranked.room, 'One'); seatUp(ranked.room, 'Two');
  ranked.room.startMatch();
  assert.equal(seatUp(ranked.room, 'Late'), null, 'a ranked match that had started took a new pilot');
  ranked.room.close();
});

test('a win needs a fair share of the rounds', async () => {
  const { room, profiles } = await matchRoom('casual');
  const a = seatUp(room, 'Alpha'); seatUp(room, 'Bravo');
  room.startMatch();
  for (let i = 1; i < 6; i += 1) room.startRound();
  a.match.roundsPlayed = 1; // arrived with most of it gone
  room.scores = { [a.team]: room.rules.roundsToWin, [a.team === 'A' ? 'B' : 'A']: 0 };
  room.endMatch();
  const record = profiles.get(a.token);
  assert.equal(record.stats.wins, 0, 'a win for one round of six');
  assert.equal(record.history[0].result, 'win', 'the result itself should still read as it happened');
  room.close();
});

test('walking out of ranked is a loss, and the winner still gets rated', async () => {
  const { room, profiles } = await matchRoom('ranked-1v1');
  const stayer = seatUp(room, 'Stayer'), leaver = seatUp(room, 'Leaver');
  room.startMatch();
  room.scores = { [leaver.team]: 0, [stayer.team]: 4 };
  room.leave(leaver, true);
  assert.equal(profiles.get(leaver.token).rankedMatches, 1, 'the loss was never recorded');
  assert.ok(profiles.get(leaver.token).rating < 1000, 'leaving cost no rating');
  room.scores[stayer.team] = room.rules.roundsToWin;
  room.endMatch();
  assert.ok(profiles.get(stayer.token).rating > 1000, 'the winner lost their rating because the other side walked out');
  room.close();
});

test('a party is kept on one side when teams are dealt', async () => {
  const { room } = await matchRoom('2v2');
  const one = seatUp(room, 'One', { party: 'party-7' });
  seatUp(room, 'Solo');
  const two = seatUp(room, 'Two', { party: 'party-7' });
  seatUp(room, 'Other');
  room.startMatch();
  assert.equal(one.team, two.team, 'two friends who queued together were dealt onto opposite sides');
  room.close();
});

// ------------------------------------------------------------------ gun builds
test('parts saved after buying a gun do not go on the gun already in your hands', async () => {
  const { room, player, profiles } = await arena('yard');
  const { MAX_WEAPON_LEVEL, XP_CURVE } = await import('../shared/gunlevels.js');
  profiles.awardGunXp(player.token, 'talon', XP_CURVE[MAX_WEAPON_LEVEL - 1]);
  room.phase = 'buy';
  player.credits = 9000;
  room.handle(player, { type: 'buy', item: 'talon' });
  const paid = 9000 - player.credits;
  const bare = room.currentWeapon(player).mag;
  // Mid-round, a drum magazine and the rest are saved for the talon.
  profiles.saveBuilds(player.token, { talon: { mag: 'drum', optic: 'holo' } });
  room.phase = 'live';
  room.takeBuilds(player, profiles.get(player.token).builds);
  assert.equal(room.currentWeapon(player).mag, bare, 'the gun in hand took parts nobody paid for');
  assert.equal(9000 - player.credits, paid);
  // Bought again next time, it comes with them, and is charged for them.
  room.phase = 'buy';
  player.weapons.primary = 'm44'; player.bought = {}; // a new round
  player.credits = 9000;
  room.handle(player, { type: 'buy', item: 'talon' });
  assert.ok(room.currentWeapon(player).mag > bare, 'a gun bought with the build did not get it');
  assert.ok(9000 - player.credits > paid, 'the parts were not charged for');
  room.close();
});

test('parts unlock at a level on the server too', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-lvl-')), 'profiles.json'));
  const token = ProfileStore.newToken();
  profiles.saveBuilds(token, { m44: { optic: 'dot' }, toString: { optic: 'dot' }, constructor: {} });
  assert.deepEqual(profiles.get(token).builds || {}, {}, 'a level 1 pilot saved a build, or a prototype key was stored');
});

// ------------------------------------------------------------------ royale loot
test('loot is taken only in sight, not through a wall or a floor', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-loot-')), 'profiles.json'));
  const room = new RoyaleRoom({ name: `loot-${Math.random()}`, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const me = room.join(socket(), { token: ProfileStore.newToken(), session: 'l', name: 'Looter' }, look);
  room.startMatch(); room.deploy();
  // Somewhere open on the ground.
  const spot = room.map.places?.[0] || { x: 0, z: 0 };
  const ground = room.world.groundBelow(spot.x, 60, spot.z);
  room.exit(me);
  Object.assign(me, { x: spot.x, y: ground, z: spot.z, alive: true, inDrop: false });
  room.phase = 'live';
  const behind = room.addLoot(me.x + 2.5, ground, me.z, { kind: 'helmet' });
  room.world.addDynamic({ id: 'test-wall', mat: 'concrete', min: [me.x + 1.2, ground - 1, me.z - 3], max: [me.x + 1.5, ground + 4, me.z + 3] });
  room.handle(me, { type: 'royale-take', id: behind.id });
  assert.ok(room.loot.has(behind.id) && !me.helmet, 'a helmet came through a wall');
  room.world.removeDynamic('test-wall');
  room.handle(me, { type: 'royale-take', id: behind.id });
  assert.ok(!room.loot.has(behind.id), 'in plain sight it could not be taken');
  room.close();
});

// ------------------------------------------------------------------ floods
test('a burst of lobby messages does not become a burst of rosters to everyone', async () => {
  const { room } = await matchRoom('custom');
  const watcher = socket();
  const listener = room.join(watcher, { token: ProfileStore.newToken(), session: 'w', name: 'Watcher' }, look);
  const spammer = seatUp(room, 'Spammer');
  void listener;
  tick(2);
  const before = watcher.sent.filter((m) => m.type === 'room').length;
  for (let i = 0; i < 150; i += 1) room.handle(spammer, { type: 'ready', ready: i % 2 === 0 });
  const sent = watcher.sent.filter((m) => m.type === 'room').length - before;
  assert.ok(sent <= 21, `${sent} full rosters from 150 ready toggles`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const last = [...watcher.sent].reverse().find((m) => m.type === 'room');
  assert.equal(last.players.find((p) => p.name === 'Spammer').ready, false, 'the last change never went out');
  room.close();
});

// ------------------------------------------------------------------ stores and stakes
test('a store that will not parse stops the boot instead of being saved over', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  const { AccountStore } = await import('../server/accounts.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-corrupt-'));
  for (const [name, make] of [['profiles.json', (file) => new ProfileStore(file)], ['accounts.json', (file) => new AccountStore(file)]]) {
    const file = path.join(dir, name);
    await writeFile(file, '{"abc": {"coins": 100249, "na');
    await assert.rejects(make(file).load(), /not valid JSON/, `${name}: a truncated file loaded as empty`);
    assert.equal(await readFile(file, 'utf8'), '{"abc": {"coins": 100249, "na', `${name} was touched`);
  }
  // Missing is a first boot, as before.
  await new ProfileStore(path.join(dir, 'none.json')).load();
});

test('one stake at a time, and one room settling never clears another\'s', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-stake-')), 'profiles.json'));
  const token = ProfileStore.newToken();
  profiles.credit(token, 1000, 'test', 'seed');
  assert.ok(profiles.hold(token, 300, 'wager-a'));
  assert.equal(profiles.hold(token, 400, 'wager-b'), false, 'a second stake overwrote the first');
  profiles.settle(token, 0, 'lost', 'wager-b');
  assert.equal(profiles.get(token).escrow?.room, 'wager-a', 'another room cleared this stake');
  profiles.settle(token, 600, 'won', 'wager-a');
  assert.equal(profiles.get(token).escrow, null);
});

test('a wager stopped early (a pulled map) hands its stakes back', async () => {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-pot-')), 'profiles.json'));
  const room = new Room({ name: `wager-${Math.random().toString(36).slice(2, 6)}`, queue: 'custom', profiles, onEmpty: () => {}, wager: { size: 1, stake: 100 } });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  const players = ['X', 'Y'].map((name) => { const token = ProfileStore.newToken(); profiles.credit(token, 400, 'test', 'seed'); return room.join(socket(), { token, session: name, name }, look); });
  const start = players.map((p) => profiles.coins(p.token));
  players.forEach((p) => room.handle(p, { type: 'ready', ready: true }));
  room.handle(players.find((p) => p.host) || players[0], { type: 'start' });
  assert.equal(room.phase, 'buy', 'the wager never started');
  room.toLobby();
  players.forEach((p, i) => assert.equal(profiles.coins(p.token), start[i], `${p.name}'s stake vanished`));
  room.close();
});

// ------------------------------------------------------------------ ESP
// An ESP draws what the page is sent, so an enemy nobody could see or hear is not sent at all.
async function sightRoom() {
  const { room, player: viewer } = await arena('range');
  // This one keeps the snapshots: they are the thing under test.
  const inbox = { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
  viewer.socket = inbox;
  const enemy = room.join(socket(), { token: ProfileStore.newToken(), session: 'e', name: 'Enemy' }, look);
  const mate = room.join(socket(), { token: ProfileStore.newToken(), session: 'm', name: 'Mate' }, look);
  enemy.team = viewer.team === 'A' ? 'B' : 'A'; mate.team = viewer.team;
  room.phase = 'live';
  const ground = room.world.groundBelow(0, 5, -40);
  const place = (p, x, z) => { room.spawn(p, 0, { x, y: ground, z }); p.flags = FLAG.ground | FLAG.walking; p.speed = 0; };
  place(viewer, 0, -30); place(enemy, 0, -45); place(mate, 3, -30);
  // A long, tall wall between them, well clear of both.
  room.world.addDynamic({ id: 'sight-wall', mat: 'concrete', min: [-12, ground - 1, -38.2], max: [12, ground + 5, -37.8] });
  const sent = () => { const last = [...inbox.sent].reverse().find((m) => m.type === 's'); return new Set(last.p.map((row) => row[0])); };
  const snap = () => { tick(0.2); room.snapshot(performance.now() / 1000); return sent(); };
  return { room, viewer, enemy, mate, ground, place, snap };
}

test('an enemy behind a wall is not sent; a team mate always is; a developer gets everyone', async () => {
  const { room, viewer, enemy, mate, snap } = await sightRoom();
  let seen = snap();
  assert.ok(!seen.has(enemy.id), 'an enemy nobody can see or hear was sent, so an ESP could draw them');
  assert.ok(seen.has(mate.id), 'a team mate was left out');
  // Out from behind the wall, they are sent.
  room.world.removeDynamic('sight-wall');
  seen = snap();
  assert.ok(seen.has(enemy.id), 'an enemy in plain sight was not sent');
  room.world.addDynamic({ id: 'sight-wall', mat: 'concrete', min: [-12, enemy.y - 1, -38.2], max: [12, enemy.y + 5, -37.8] });
  tick(1);
  assert.ok(!snap().has(enemy.id), 'still sent long after going out of sight');
  // The dev account is the one exception.
  viewer.dev = true;
  assert.ok(snap().has(enemy.id), 'a developer lost their view');
  room.close();
});

test('what can be heard or has been marked is still sent', async () => {
  const { room, enemy, snap } = await sightRoom();
  enemy.flags = FLAG.ground; enemy.speed = 6.5; // running: the browser plays those footsteps
  assert.ok(snap().has(enemy.id), 'a running enemy in earshot was cut, so their footsteps went silent');
  enemy.flags = FLAG.ground | FLAG.crouch;
  tick(1);
  assert.ok(!snap().has(enemy.id), 'a crouching enemy behind a wall was sent');
  enemy.ghostUntil = performance.now() / 1000 + 10; enemy.flags = FLAG.ground; enemy.speed = 6.5;
  assert.ok(!snap().has(enemy.id), 'Silent Step still gave them away');
  room.mark(enemy, 5, 'pulse');
  assert.ok(snap().has(enemy.id), 'a marked enemy was not sent to the side that marked them');
  room.close();
});

test('the dead see what their side sees, and no more', async () => {
  const { room, viewer, enemy, mate, place, snap } = await sightRoom();
  viewer.alive = false;
  assert.ok(!snap().has(enemy.id), 'a dead pilot was sent an enemy none of their side could see');
  place(mate, 0, -39.5); // round the wall's end is not needed: the mate is on the enemy's side of it
  mate.flags = FLAG.ground | FLAG.walking;
  assert.ok(snap().has(enemy.id), 'spectating a team mate would show nothing they were looking at');
  room.close();
});

// The check that keeps honest play honest: an enemy is never missing from the page at a moment the
// pilot could really see them, even sprinting out from behind cover with updates on the wire.
test('stepping out from cover, the enemy is already there when they come into sight', async () => {
  const { room, viewer, enemy, ground, snap } = await sightRoom();
  void snap;
  room.world.removeDynamic('sight-wall');
  // A short wall this time, with the enemy straight behind it and the pilot stepping sideways past its end.
  room.world.addDynamic({ id: 'corner', mat: 'concrete', min: [-4, ground - 1, -38.2], max: [1, ground + 5, -37.8] });
  room.spawn(viewer, 0, { x: -2, y: ground, z: -30 }); viewer.flags = FLAG.ground;
  enemy.x = -1; enemy.z = -46;
  const inbox = viewer.socket;
  let missed = 0, visible = 0, x = -2;
  for (let frame = 0; frame < 90; frame += 1) {
    tick(1 / 60);
    x += BODY.sprintSpeed / 60;
    if (frame % 2 === 0) state(room, viewer, round(x), ground, -30, { f: FLAG.ground });
    if (frame % 3 === 0) room.snapshot(performance.now() / 1000);
    const eye = [x, ground + BODY.eye, -30];
    const clear = room.world.lineOfSight(eye[0], eye[1], eye[2], enemy.x, enemy.y + 1.2, enemy.z) || room.world.lineOfSight(eye[0], eye[1], eye[2], enemy.x, enemy.y + 1.65, enemy.z);
    if (!clear) continue;
    visible += 1;
    const last = [...inbox.sent].reverse().find((m) => m.type === 's');
    if (!last.p.some((row) => row[0] === enemy.id)) missed += 1;
  }
  assert.ok(visible > 10, 'the pilot never came into sight of the enemy: the test is not testing anything');
  assert.equal(missed, 0, `the enemy was missing for ${missed} of ${visible} frames the pilot could see them`);
  room.close();
});
