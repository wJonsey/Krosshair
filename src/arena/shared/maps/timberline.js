// TIMBERLINE: large. A logging camp in a mountain clearing: a lodge in the middle, a watchtower
// for each team, rock outcrops that stop everything and hedgerows that stop nothing.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildTimberline() {
  const b = createBuilder();
  const { add, wall } = b;
  const gates = [[-30, -26], [-3, 3], [26, 30]];
  const shell = arenaShell(b, { halfW: 34, halfL: 54, lobby: 10, gates, floor: 'grass', wallMat: 'rock', lobbyMat: 'wood', wallH: 10 });
  const lights = [];

  // --- Lodge: log walls, doors east and west, a partition so nobody sees through it ------
  wall('x', 5, 5.4, -8, 8, 0, 4, 'wood', [{ a: -6, b: -4.2, y1: 1.1, y2: 2.4, glass: true }, { a: 4.2, b: 6, y1: 1.1, y2: 2.4, glass: true }], SYM);
  for (const side of [-1, 1]) wall('z', Math.min(side * 8, side * 7.6), Math.max(side * 8, side * 7.6), -5.4, 5.4, 0, 4, 'wood', [{ a: -2.3, b: 2.3, y1: 0, y2: 2.7 }]);
  add(-6.4, -0.2, 6.4, 0.2, 0, 4, 'wood');             // the partition …
  add(-8.6, -6, 8.6, 6, 4, 4.4, 'darkMetal');           // … and a tin roof
  add(-1, 2, 1, 3.4, 0, 1, 'crate', SYM);
  // Rock shoulders either side of the lodge close the long diagonals.
  for (const side of [-1, 1]) { add(Math.min(side * 12, side * 18), -3.5, Math.max(side * 12, side * 18), 3.5, 0, 4.2, 'rock'); add(Math.min(side * 13, side * 16.5), -2, Math.max(side * 13, side * 16.5), 2, 4.2, 5.6, 'rock'); }

  // --- Watchtowers: one per flank in each half --------------------------------------------
  for (const side of [-1, 1]) {
    const x1 = Math.min(side * 20, side * 26), x2 = Math.max(side * 20, side * 26);
    const top = flight(b, 'z', 34, -1, Math.min(side * 23.8, side * 26), Math.max(side * 23.8, side * 26), 5, 'wood', SYM);
    add(x1, top - 6, x2, top, 4.6, 5, 'wood', SYM);
    for (const [px, pz] of [[x1 + 0.3, top - 5.7], [x2 - 0.3, top - 5.7], [x1 + 0.3, top - 0.3]]) add(px - 0.25, pz - 0.25, px + 0.25, pz + 0.25, 0, 4.6, 'wood', SYM);
    // Plank rail on the three open sides.
    add(x1, top - 6, x2, top - 5.88, 5, 6.1, 'wood', SYM);
    const inner = side < 0 ? x2 : x1;
    add(inner - 0.06, top - 6, inner + 0.06, top - 2, 5, 6.1, 'wood', SYM);
    // Outcrop that closes the straight flank run, with a gap against the cliff.
    add(Math.min(side * 24, side * 31.5), 8, Math.max(side * 24, side * 31.5), 13, 0, 4, 'rock', SYM);
    lights.push({ pos: [side * 23, 4.2, top - 3], color: '#ffd9a0', intensity: 10, distance: 12 }, { pos: [side * 23, 4.2, -(top - 3)], color: '#ffd9a0', intensity: 10, distance: 12 });
  }

  // --- The clearing: hedgerows, log piles, boulders ---------------------------------------
  add(-18, 17.4, -6, 18.6, 0, 2.2, 'hedge', SYM);
  add(5, 24.4, 17, 25.6, 0, 2.2, 'hedge', SYM);
  add(-4.5, 12, 4.5, 13.4, 0, 1.3, 'wood', SYM);        // log pile
  add(-3.2, 12.2, 3.2, 13.2, 1.3, 2.2, 'wood', SYM);
  add(-5.5, 36, 5.5, 37.2, 0, 3.2, 'wood', SYM);        // palisade in front of the centre gate
  add(8, 9, 11, 12, 0, 2.6, 'rock', SYM);
  add(-13, 27, -10, 30, 0, 3, 'rock', SYM);
  add(-23, 33, -20, 35.5, 0, 1.4, 'crate', SYM);
  add(15, 35, 18.5, 37, 0, 1.4, 'crate', SYM);
  add(-2, 27, 2, 28.4, 0, 1.2, 'sandbag', SYM);
  add(19, 15, 20.4, 19, 0, 1.2, 'wood', SYM);
  // Pines (trunks only collide; the crowns are decoration).
  for (const [x, z] of [[-27, 22], [29, 24], [-9, 23], [13, 31], [-31, 40], [2, 20]]) {
    add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 0, 7, 'wood', SYM);
    add(x - 2, z - 2, x + 2, z + 2, 4.5, 6.5, 'hedge', { deco: true, sym: true });
    add(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 6.5, 8.5, 'hedge', { deco: true, sym: true });
  }
  add(-0.6, 8, 0.6, 9.2, 0, 0.5, 'rock', SYM);
  lights.push({ pos: [0, 3.4, 2.6], color: '#ffc27a', intensity: 12, distance: 10 }, { pos: [0, 3.4, -2.6], color: '#ffc27a', intensity: 12, distance: 10 });

  const signs = [
    { text: 'TIMBERLINE CAMP', pos: [0, 4.4, shell.zWall - 0.05], face: 'north', size: 0.8, color: '#6ce6d1' },
    { text: 'TIMBERLINE CAMP', pos: [0, 4.4, -shell.zWall + 0.05], face: 'south', size: 0.8, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'Lodge', box: [-8.6, -1, -6, 8.6, 4, 6] },
    { name: 'West Rocks', box: [-19, -1, -5, -8.6, 20, 5] }, { name: 'East Rocks', box: [8.6, -1, -5, 19, 20, 5] },
    shell.lobbyZone,
    { name: 'A West Tower', box: [-26, 4, 20, -20, 20, 34] }, { name: 'A East Tower', box: [20, 4, 20, 26, 20, 34] },
    { name: 'A West Flank', box: [-34, -1, 5, -19, 4, 44] }, { name: 'A East Flank', box: [19, -1, 5, 34, 4, 44] },
    { name: 'A Clearing', box: [-19, -1, 5, 19, 20, 44] },
    { name: 'West Pass', box: [-34, -1, -5, -19, 20, 5] }, { name: 'East Pass', box: [19, -1, -5, 34, 20, 5] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 32], [-8, 0, 22], [10, 0, 20], [-3, 0, 9], [6, 0, 15], [-24, 0, 20], [24, 0, 40], [-32.8, 0, 10], [32.8, 0, 10],
    [-23, 5, 25], [23, 5, 25], [4, 0, 2.6], [-10, 0, 0], [10, 0, 0], [-22, 0, 2], [22, 0, 2], [-15, 0, 33],
  ]);
  const lanes = [
    [[-28, 0, 42], [-32.8, 0, 4]], [[28, 0, 42], [32.8, 0, 4]], [[0, 0, 42], [10, 0, 6]], [[0, 0, 42], [-10, 0, 6]],
    [[28, 0, 42], [23, 5, 25]], [[-28, 0, 42], [-23, 5, 25]],
  ];
  return {
    id: 'timberline', title: 'Timberline', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'mountains', variants: ['noon', 'dusk', 'snow', 'night'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
