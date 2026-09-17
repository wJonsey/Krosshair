// Headless checks for the shared simulation: run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, dailyContracts, levelFromXp, xpForLevel } from '../shared/constants.js';
import { getMap, zoneAt } from '../shared/map.js';
import { World, makeBody } from '../shared/physics.js';
import { damageFor, rayPlayer, traceShot } from '../shared/combat.js';
import { NavGrid } from '../server/nav.js';

const yard = getMap('yard');
const world = new World(yard.boxes);

function walk(body, tx, tz, seconds = 30) {
  for (let step = 0; step < seconds * 60; step += 1) {
    const dx = tx - body.x, dz = tz - body.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;
    body.vy -= 15 / 60;
    world.moveBody(body, (dx / dist) * 0.1, body.vy / 60, (dz / dist) * 0.1);
  }
  return false;
}

test('map ids are unique and the yard mirrors across z = 0', () => {
  assert.equal(new Set(yard.boxes.map((box) => box.id)).size, yard.boxes.length);
  const solid = yard.boxes.filter((box) => !box.deco);
  const key = (box, flip) => [box.min[0], box.min[1], flip ? -box.max[2] : box.min[2], box.max[0], box.max[1], flip ? -box.min[2] : box.max[2]].map((v) => v.toFixed(2)).join(',');
  const keys = new Set(solid.map((box) => key(box, false)));
  for (const box of solid) assert.ok(keys.has(key(box, true)), `no mirror for ${box.id}`);
});

test('spawns are clear and both teams get four', () => {
  for (const team of ['A', 'B']) {
    assert.equal(yard.spawns[team].length, 4);
    for (const spawn of yard.spawns[team]) assert.ok(world.bodyFree(spawn.x, spawn.y, spawn.z));
  }
});

test('a pilot can walk from spawn, down the underpass and up into the office', () => {
  const body = makeBody(0, 0, 54);
  body.onGround = true;
  assert.ok(walk(body, 0, 45));
  assert.ok(walk(body, 0, 30));
  assert.ok(Math.abs(body.y + 3.4) < 0.01, 'reached the tunnel floor');
  assert.equal(zoneAt(yard, body.x, body.y, body.z), 'A Tunnel');
  assert.ok(walk(body, 0, 3) && walk(body, 8, 1.4) && walk(body, 23, 0) && walk(body, 33, 0));
  assert.ok(Math.abs(body.y) < 0.01, 'climbed back to street level');
  assert.equal(zoneAt(yard, body.x, body.y, body.z), 'Office Lobby');
});

test('the depot stairs lead onto the sniper roof', () => {
  const body = makeBody(-18.5, 0, 42);
  body.onGround = true;
  assert.ok(walk(body, -18.5, 38.8) && walk(body, -26.5, 38.8) && walk(body, -26.5, 28));
  assert.equal(zoneAt(yard, body.x, body.y, body.z), 'A Roof');
});

test('gate-to-gate sightlines are closed, roof-to-roof is open', () => {
  for (const x of [-8, -6, -3, 0, 3, 6, 8]) assert.equal(world.lineOfSight(x, 1.6, 45.5, x, 1.6, -45.5), false, `x=${x} is open`);
  assert.equal(world.lineOfSight(-18, 5.7, 21, -18, 5.7, -21), true);
});

test('bots can path to every interest point from both spawns', () => {
  const nav = new NavGrid(new World(yard.boxes), yard);
  for (const team of ['A', 'B']) {
    for (const [x, y, z] of yard.interest) {
      const path = nav.path(yard.spawns[team][0], { x, y, z });
      assert.ok(path && path.length > 1, `${team} cannot reach ${x},${y},${z}`);
      assert.ok(Math.abs(path.at(-1).y - y) < 0.6, `${x},${y},${z} snapped to the wrong floor`);
    }
  }
});

test('hitboxes: head, torso and limb zones', () => {
  const target = { x: 0, y: 0, z: -20, crouch: false };
  assert.equal(rayPlayer([0, 1.6, 0], [0, 0, -1], target).zone, 'head');
  assert.equal(rayPlayer([0, 1.15, 0], [0, 0, -1], target).zone, 'torso');
  assert.equal(rayPlayer([0, 0.4, 0], [0, 0, -1], target).zone, 'limb');
  assert.equal(rayPlayer([1.2, 1.2, 0], [0, 0, -1], target), null);
  assert.equal(rayPlayer([0, 1.6, 0], [0, 0, -1], { ...target, crouch: true }), null, 'crouching ducks a head-height round');
});

test('the long rifle punches through planks but not brick', () => {
  const range = getMap('range');
  const rangeWorld = new World(range.boxes);
  const behindWood = [{ id: 't', kind: 'player', x: 9.5, y: 0, z: -18, crouch: false }];
  const through = traceShot(rangeWorld, [9.5, 1.2, -5], [0, 0, -1], WEAPONS.m44, behindWood);
  assert.equal(through.hits.length, 1);
  assert.ok(through.hits[0].wallbang && through.hits[0].scale < 1);
  const pistol = traceShot(rangeWorld, [9.5, 1.2, -5], [0, 0, -1], WEAPONS.p9, behindWood);
  assert.ok(pistol.hits.length === 1 && pistol.hits[0].scale < through.hits[0].scale, 'a pistol loses more energy in the same wall');
  const behindBrick = [{ id: 't', kind: 'player', x: 9.5, y: 0, z: -32, crouch: false }];
  const blocked = traceShot(rangeWorld, [9.5, 1.2, -20], [0, 0, -1], WEAPONS.m44, behindBrick);
  assert.equal(blocked.hits.length, 0);
});

test('glass breaks and lets the round carry on', () => {
  const range = getMap('range');
  const rangeWorld = new World(range.boxes);
  const trace = traceShot(rangeWorld, [-9.3, 1.2, -5], [0, 0, -1], WEAPONS.m44, [{ id: 't', kind: 'player', x: -9.3, y: 0, z: -21, crouch: false }]);
  assert.equal(trace.glass.length, 1);
  assert.equal(trace.hits.length, 1);
});

test('damage model: one-shot rules of the M-44', () => {
  assert.ok(damageFor(WEAPONS.m44, 'head', 80) >= 300);
  assert.ok(damageFor(WEAPONS.m44, 'torso', 80) >= 100, 'unarmoured body shot is lethal');
  assert.ok(damageFor(WEAPONS.m44, 'limb', 80) < 100);
  assert.ok(damageFor(WEAPONS.wasp, 'torso', 60) < damageFor(WEAPONS.wasp, 'torso', 5), 'SMG damage falls off');
});

test('progression helpers are consistent', () => {
  for (let level = 1; level < 30; level += 1) assert.equal(levelFromXp(xpForLevel(level)), level);
  const today = dailyContracts('2026-09-17');
  assert.equal(today.length, 3);
  assert.deepEqual(today, dailyContracts('2026-09-17'));
  assert.equal(new Set(today.map((contract) => contract.id)).size, 3);
});
