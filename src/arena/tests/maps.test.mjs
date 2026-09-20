// Every arena must be fair, walkable and bot-navigable. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY, MATERIALS } from '../shared/constants.js';
import { getMap, MAP_IDS, MAP_INFO, zoneAt } from '../shared/map.js';
import { World } from '../shared/physics.js';
import { NavGrid } from '../server/nav.js';

const only = process.env.MAP ? process.env.MAP.split(',') : MAP_IDS;

for (const id of only) {
  const map = getMap(id);
  const world = new World(map.boxes);

  test(`${id}: metadata, ids, materials`, () => {
    assert.equal(map.id, id);
    assert.ok(MAP_INFO.find((info) => info.id === id && info.title === map.title), 'listed in MAP_INFO with the same title');
    assert.equal(new Set(map.boxes.map((box) => box.id)).size, map.boxes.length, 'box ids are unique');
    for (const box of map.boxes) {
      assert.ok(MATERIALS[box.mat], `unknown material ${box.mat}`);
      for (let axis = 0; axis < 3; axis += 1) assert.ok(box.max[axis] > box.min[axis], `degenerate box ${box.id}`);
    }
    assert.ok(map.env?.variants?.length, 'declares its weather variants');
    assert.ok(map.spawnZones?.A && map.spawnZones?.B, 'declares spawn zones');
  });

  test(`${id}: no two surfaces fight for the same plane`, () => {
    // Faces in exactly the same plane flicker as the camera moves. getMap nudges them apart; this is the
    // check that it worked, on the real map the game hands out.
    const solid = map.boxes.filter((box) => box.max[1] > box.min[1] + 0.001);
    const order = [...solid].sort((a, b) => a.min[0] - b.min[0]);
    const clashes = [];
    for (let i = 0; i < order.length; i += 1) {
      const a = order[i];
      for (let j = i + 1; j < order.length && order[j].min[0] < a.max[0]; j += 1) {
        const b = order[j];
        if (a.min[1] >= b.max[1] || b.min[1] >= a.max[1] || a.min[2] >= b.max[2] || b.min[2] >= a.max[2]) continue;
        for (let axis = 0; axis < 3; axis += 1) {
          const u = (axis + 1) % 3, v = (axis + 2) % 3;
          const side = Math.min(Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]), Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]));
          if (side <= 0.05) continue;
          if (Math.abs(a.max[axis] - b.max[axis]) < 0.002 || Math.abs(a.min[axis] - b.min[axis]) < 0.002) clashes.push(`${a.id}/${b.id}`);
        }
      }
    }
    assert.deepEqual(clashes, [], 'these faces sit in the same plane and will flicker');
  });

  test(`${id}: nowhere a pilot can stand and never leave`, () => {
    const nav = new NavGrid(world, map);
    const seen = new Set(), groups = [];
    for (const node of nav.nodes) {
      if (seen.has(node.id)) continue;
      const queue = [node]; seen.add(node.id); const group = [];
      while (queue.length) { const current = queue.pop(); group.push(current); for (const edge of current.edges) { const other = nav.nodes[edge.to]; if (other && !seen.has(other.id)) { seen.add(other.id); queue.push(other); } } }
      groups.push(group);
    }
    // A ledge you can only jump to is fine. A patch of floor with walls all round and no drop is not.
    const escapes = (node) => {
      for (let a = 0; a < 16; a += 1) {
        const angle = (a / 16) * Math.PI * 2;
        for (const step of [0.45, 0.9, 1.4]) {
          const x = node.x + Math.cos(angle) * step, z = node.z + Math.sin(angle) * step;
          const ground = world.groundBelow(x, node.y + 1.3, z);
          if (!Number.isFinite(ground) || ground - node.y > 0.62) continue;
          if (world.bodyFree(x, ground + 0.02, z, BODY.radius, BODY.height)) return true;
        }
      }
      return false;
    };
    const traps = groups.filter((group) => group.length <= 4 && !group.some(escapes)).map((group) => [group[0].x, group[0].y, group[0].z]);
    assert.deepEqual(traps, [], 'a pilot could stand here with no way out');
  });

  test(`${id}: mirrored across z = 0`, () => {
    const solid = map.boxes.filter((box) => !box.deco && !box.asym);
    const key = (box, flip) => [box.min[0], box.min[1], flip ? -box.max[2] : box.min[2], box.max[0], box.max[1], flip ? -box.min[2] : box.max[2]].map((v) => v.toFixed(2)).join(',');
    const keys = new Set(solid.map((box) => key(box, false)));
    for (const box of solid) assert.ok(keys.has(key(box, true)), `no mirror twin for ${box.id} ${JSON.stringify(box.min)} ${JSON.stringify(box.max)}`);
  });

  test(`${id}: spawns are clear, grounded and inside their zone`, () => {
    for (const team of ['A', 'B']) {
      assert.equal(map.spawns[team].length, 4);
      const [x1, z1, x2, z2] = map.spawnZones[team];
      for (const spawn of map.spawns[team]) {
        assert.ok(world.bodyFree(spawn.x, spawn.y, spawn.z), `${team} spawn blocked`);
        assert.ok(Math.abs(world.groundBelow(spawn.x, spawn.y + 0.1, spawn.z) - spawn.y) < 0.01, `${team} spawn floats`);
        assert.ok(spawn.x > x1 && spawn.x < x2 && spawn.z > z1 && spawn.z < z2, 'spawn outside its zone');
      }
    }
  });

  test(`${id}: spawn gates cannot see each other`, () => {
    const gates = map.barriers.filter((barrier) => barrier.id.includes('-A'));
    const other = map.barriers.filter((barrier) => barrier.id.includes('-B'));
    assert.ok(gates.length >= 2, 'at least two ways out of spawn');
    let open = 0;
    for (const from of gates) for (const to of other) {
      for (const fx of [from.min[0] + 0.4, (from.min[0] + from.max[0]) / 2, from.max[0] - 0.4]) for (const tx of [to.min[0] + 0.4, (to.min[0] + to.max[0]) / 2, to.max[0] - 0.4]) {
        for (const y of [1.62, 1.06]) if (world.lineOfSight(fx, y, from.min[2] - 0.5, tx, y, to.max[2] + 0.5)) { open += 1; if (open < 4) console.log(`  open line ${fx},${from.min[2]} -> ${tx},${to.max[2]} y=${y}`); }
      }
    }
    assert.equal(open, 0, `${open} gate-to-gate sightlines are open`);
  });

  test(`${id}: bots can reach every point of interest from both spawns`, () => {
    const nav = new NavGrid(new World(map.boxes), map);
    const targets = [...map.interest, ...map.lanes.flat().flatMap(([x, y, z]) => [[x, y, z], [x, y, -z]])];
    assert.ok(map.interest.length >= 12, 'enough interest points for varied bot play');
    for (const team of ['A', 'B']) {
      for (const [x, y, z] of targets) {
        const path = nav.path(map.spawns[team][0], { x, y, z });
        assert.ok(path && path.length > 1, `${team} cannot reach ${x},${y},${z}`);
        const end = path.at(-1);
        assert.ok(Math.abs(end.y - y) < 0.6 && Math.hypot(end.x - x, end.z - z) < 2.5, `${x},${y},${z} snapped to ${end.x},${end.y},${end.z}`);
      }
    }
    // Both teams face the same trip to the middle.
    const a = nav.path(map.spawns.A[0], { x: 0, y: 0, z: 0 }) || [], b = nav.path(map.spawns.B[0], { x: 0, y: 0, z: 0 }) || [];
    assert.ok(Math.abs(a.length - b.length) <= 3, `uneven routes to centre: ${a.length} vs ${b.length}`);
  });

  test(`${id}: every zone name resolves somewhere and spawns are named`, () => {
    assert.match(zoneAt(map, map.spawns.A[0].x, 0.5, map.spawns.A[0].z), /^A /);
    assert.match(zoneAt(map, map.spawns.B[0].x, 0.5, map.spawns.B[0].z), /^B /);
  });
}
