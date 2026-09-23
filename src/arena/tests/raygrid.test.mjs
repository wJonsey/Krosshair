// Rays walk only the grid cells they cross instead of testing every box in the world. That has to give
// exactly the answer testing every box gave, or hits, wallbangs and what a bot can see all change. So
// every map is checked against the brute-force version on a few thousand random rays, including rays
// that start inside boxes, run straight down, lie along the grid lines, reach off the map, and cross
// boxes that are switched off (broken glass) or were added at run time (shields).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, ROYALE_MAP, getMap } from '../shared/map.js';
import { World, rayBox } from '../shared/physics.js';
import { MATERIALS } from '../shared/constants.js';

function bruteRaycast(world, origin, dir, maxDist) {
  const hits = [];
  const test = (box) => { if (!world.active(box)) return; const hit = rayBox(origin, dir, box, maxDist); if (hit) hits.push(hit); };
  world.boxes.forEach(test); world.dynamic.forEach(test);
  hits.sort((a, b) => a.t0 - b.t0);
  return hits;
}
function bruteSight(world, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dist = Math.hypot(...d);
  if (dist < 1e-6) return true;
  const dir = d.map((v) => v / dist);
  for (const box of [...world.boxes, ...world.dynamic.values()]) {
    if (!world.active(box) || MATERIALS[box.mat]?.seeThrough) continue;
    if (rayBox(a, dir, box, dist)) return false;
  }
  return true;
}
// A small deterministic generator, so a failure can be reproduced.
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

for (const id of [...MAP_IDS, ROYALE_MAP]) {
  test(`rays on ${id} hit exactly what testing every box hit`, () => {
    const map = getMap(id);
    const world = new World(map.boxes);
    // Some glass switched off, and a shield added, the way a match changes the world.
    world.boxes.filter((box) => box.glass).slice(0, 3).forEach((box) => world.setDisabled(box.id));
    world.addDynamic({ id: 'shield-test', min: [-1, 0, -1], max: [1, 2, 1], mat: 'metal', shield: true });
    const rand = seeded(id.length * 7919 + 17);
    const { minX, maxX, minZ, maxZ } = map.bounds;
    const span = Math.max(maxX - minX, maxZ - minZ);
    const rays = id === ROYALE_MAP ? 1500 : 3000;
    for (let i = 0; i < rays; i += 1) {
      const origin = [minX + rand() * (maxX - minX), -1 + rand() * 12, minZ + rand() * (maxZ - minZ)];
      let dir;
      const kind = i % 10;
      if (kind === 0) dir = [0, -1, 0];                                           // straight down
      else if (kind === 1) dir = unit([rand() < 0.5 ? 1 : -1, 0, 0]);              // along a grid line
      else if (kind === 2) { origin[0] = Math.round(origin[0] / 8) * 8; dir = unit([0, rand() - 0.5, rand() < 0.5 ? 1 : -1]); }
      else dir = unit([rand() * 2 - 1, (rand() * 2 - 1) * 0.4, rand() * 2 - 1]);
      const maxDist = kind === 3 ? span * 1.5 : 5 + rand() * 120;              // some run off the map
      const want = bruteRaycast(world, origin, dir, maxDist).map((h) => `${h.box.id ?? h.box._index}@${h.t0.toFixed(6)}`);
      const got = world.raycast(origin, dir, maxDist).map((h) => `${h.box.id ?? h.box._index}@${h.t0.toFixed(6)}`);
      assert.deepEqual(got, want, `ray ${i} from ${origin.map((v) => v.toFixed(2))} along ${dir.map((v) => v.toFixed(3))} for ${maxDist.toFixed(1)} m`);
      const to = [origin[0] + dir[0] * maxDist, origin[1] + dir[1] * maxDist, origin[2] + dir[2] * maxDist];
      assert.equal(world.lineOfSight(...origin, ...to), bruteSight(world, origin, to), `line of sight ${i} disagrees`);
    }
  });
}

test('a ray on the island tests a few cells, not every box', () => {
  const world = new World(getMap(ROYALE_MAP).boxes);
  let tested = 0;
  world.alongRay([0, 2, 0], unit([1, 0, 0.3]), 40, () => { tested += 1; });
  assert.ok(tested < world.boxes.length / 20, `a 40 m ray looked at ${tested} of ${world.boxes.length} boxes`);
});
