// The Nin Launcher. Its rocket is a real projectile on the server, so it has to actually meet people:
// it shipped reading `distance` off rayPlayer, which answers with `t`, so every direct hit compared
// undefined against the step and flew straight through whoever it was aimed at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { WEAPONS } from '../shared/constants.js';
import { rayPlayer } from '../shared/combat.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const socket = () => ({ readyState: 1, send: () => {} });

async function arena() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-launcher-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const room = new Room({ name: `rkt-${Math.random().toString(36).slice(2, 6)}`, queue: 'casual', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  room.phase = 'live';
  const shooter = room.join(socket(), { token: ProfileStore.newToken(), session: 'a', name: 'Shooter' }, look);
  const target = room.join(socket(), { token: ProfileStore.newToken(), session: 'b', name: 'Target' }, look);
  room.spawn(shooter);
  shooter.alive = true; target.alive = true; target.hp = 100;
  shooter.team = 'A'; target.team = 'B';
  return { room, shooter, target };
}

// The spawns have a screen in front of them by design, so a test that fires from one is only ever
// measuring that wall. The map's own interest points are walkable open ground.
function openPair(room, min = 8, max = 22) {
  for (const f of room.map.interest) {
    for (const p of room.map.interest) {
      const from = { x: f[0], y: f[1], z: f[2] }, to = { x: p[0], y: p[1], z: p[2] };
      if (!(Math.hypot(to.x - from.x, to.z - from.z) >= min)) continue;
      if (Math.hypot(to.x - from.x, to.z - from.z) > max) continue;
      if (!room.world.lineOfSight(from.x, from.y + 1.6, from.z, to.x, to.y + 0.9, to.z)) continue;
      if (!room.world.bodyFree(to.x, to.y, to.z, 0.36, 1.8) || !room.world.bodyFree(from.x, from.y, from.z, 0.36, 1.8)) continue;
      return { from, to, gap: Math.hypot(to.x - from.x, to.z - from.z) };
    }
  }
  return null;
}

function launch(room, shooter, target) {
  Object.assign(shooter.ammo, { primary: { mag: 1, reserve: 3 } });
  shooter.weapons.primary = 'nin';
  shooter.active = 'primary';
  shooter.nextFire = 0; shooter.equipUntil = 0; shooter.reloadEnd = 0;
  const len = Math.hypot(target.x - shooter.x, (target.y + 0.9) - (shooter.y + 1.6), target.z - shooter.z);
  const aim = [(target.x - shooter.x) / len, ((target.y + 0.9) - (shooter.y + 1.6)) / len, (target.z - shooter.z) / len];
  const fired = room.fire(shooter, [shooter.x, shooter.y + 1.6, shooter.z], aim, null, 1);
  let steps = 0;
  while (room.rockets.length && steps < 600) { room.stepRockets(1 / 30, 1 + steps / 30); steps += 1; }
  return { fired, seconds: steps / 30 };
}

test('rayPlayer answers with t, which is what the rocket has to read', () => {
  const hit = rayPlayer([0, 1.15, 0], [0, 0, -1], { x: 0, y: 0, z: -5, crouch: false });
  assert.ok(hit, 'the ray does meet the target');
  assert.equal(typeof hit.t, 'number', 'the distance along the ray is `t`');
  assert.equal(hit.distance, undefined, 'there is no `distance`, and reading one silently gives nothing');
});

test('a rocket aimed at somebody hits them', async () => {
  const { room, shooter, target } = await arena();
  const pair = openPair(room);
  assert.ok(pair, 'found two open points with a clear line to fire along');
  Object.assign(shooter, pair.from);
  Object.assign(target, pair.to);
  target.hp = 100;

  const { fired, seconds } = launch(room, shooter, target);
  assert.ok(fired, 'the launcher fired');
  assert.ok(target.hp < 100, `a rocket aimed straight at a pilot ${pair.gap.toFixed(1)}m away did nothing`);
  assert.ok(seconds < pair.gap / WEAPONS.nin.rocket.speed + 0.2, 'and went off on them rather than sailing past');
});

test('a direct hit is lethal, which is what a rocket launcher is for', async () => {
  const { room, shooter, target } = await arena();
  const pair = openPair(room);
  Object.assign(shooter, pair.from);
  Object.assign(target, pair.to);
  target.hp = 100; target.armor = 0;
  launch(room, shooter, target);
  assert.equal(target.hp, 0, 'a rocket to the chest has to kill');
});

test('the blast falls off with distance instead of being all or nothing', async () => {
  const { room, shooter, target } = await arena();
  const spec = WEAPONS.nin.rocket;
  const rocket = { owner: shooter.id, team: 'A', weapon: WEAPONS.nin };
  const spot = room.map.interest.find((p) => room.world.bodyFree(p[0], p[1], p[2], 0.36, 1.8));
  Object.assign(target, { x: spot[0], y: spot[1], z: spot[2] });

  // A kill ends the round, which takes the room out of `live` and makes every later blast a no-op,
  // so the phase is put back between shots.
  // A kill ends the round, which takes the room out of `live` and makes every later blast a no-op,
  // so the phase is put back between shots. Only offsets with a clear line are measured: a blast
  // behind cover is supposed to do nothing, and would be read here as a falloff bug.
  const damageAt = (gap) => {
    const at = [target.x + gap, target.y + 0.9, target.z];
    if (!room.world.lineOfSight(at[0], at[1], at[2], target.x, target.y + 0.9, target.z)) return null;
    target.hp = 100; target.alive = true; room.phase = 'live';
    room.detonate(rocket, at, 1);
    return 100 - target.hp;
  };
  // The offsets are found rather than written down: the target stands near cover, and the blast is
  // lethal near its centre, so a fixed list breaks whenever the radius or the damage is tuned. These
  // are the first few gaps with a clear line that are far enough out to leave someone alive.
  const steps = [];
  for (let gap = 1; gap <= spec.radius && steps.length < 4; gap += 0.5) {
    const hurt = damageAt(gap);
    if (hurt !== null && hurt > 0 && hurt < 100) steps.push([gap, hurt]);
  }
  assert.ok(steps.length >= 3, 'need a few clear offsets to see a curve at all');
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i][1] < steps[i - 1][1], `blast at ${steps[i][0]}m did ${steps[i][1]}, not less than ${steps[i - 1][1]} at ${steps[i - 1][0]}m`);
  }
  assert.ok(steps[steps.length - 1][1] > 0, 'still inside the radius, so it still stings');

  target.hp = 100; target.alive = true; room.phase = 'live';
  room.detonate(rocket, [target.x + spec.radius + 2, target.y + 0.9, target.z], 1);
  assert.equal(target.hp, 100, 'outside the radius is nothing at all');
});

test('you hurt yourself with your own rocket, but less', async () => {
  const { room, shooter } = await arena();
  const spec = WEAPONS.nin.rocket;
  const spot = room.map.interest.find((p) => room.world.bodyFree(p[0], p[1], p[2], 0.36, 1.8));
  Object.assign(shooter, { x: spot[0], y: spot[1], z: spot[2] });
  shooter.hp = 100; shooter.alive = true; shooter.armor = 0;
  room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, [shooter.x + 0.6, shooter.y + 0.9, shooter.z], 1);
  const self = 100 - shooter.hp;
  assert.ok(self > 0, 'standing in your own blast has to cost something');
  assert.ok(spec.selfScale < 1 && self < spec.damage, 'but less than it costs the person you aimed at');
});
