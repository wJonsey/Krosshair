// RAVELIN: large. A desert fort: ramparts down both long walls with crenels to shoot from, a keep
// in the courtyard, and a lot of open stone between them.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildRavelin() {
  const b = createBuilder();
  const { add, wall } = b;
  const gates = [[-32, -28], [-3, 3], [28, 32]];
  const shell = arenaShell(b, { halfW: 36, halfL: 56, lobby: 10, gates, floor: 'sand', wallMat: 'sandstone', lobbyMat: 'stone', wallH: 11, lobbyH: 6 });
  const lights = [];

  // --- Keep: four doors, a pillar so nobody sees straight through, a roof ------------------------
  const door = [{ a: -1.8, b: 1.8, y1: 0, y2: 3 }];
  wall('x', 8, 9, -9, 9, 0, 6, 'stone', door, SYM);
  for (const side of [-1, 1]) wall('z', Math.min(side * 8, side * 9), Math.max(side * 8, side * 9), -8, 8, 0, 6, 'stone', door);
  add(-3, -3, 3, 3, 0, 6, 'stone');
  add(-9, -9, 9, 9, 6, 6.5, 'stone');
  for (const [x, z] of [[-9, -9], [7.6, -9], [-9, 7.6], [7.6, 7.6]]) add(x, z, x + 1.4, z + 1.4, 6.5, 7.6, 'stone');
  add(-6.5, 4.5, -4.5, 6.5, 0, 1.2, 'crate', SYM);
  // Corner towers of the inner ward close the long diagonals.
  for (const side of [-1, 1]) add(Math.min(side * 13, side * 19), -3, Math.max(side * 13, side * 19), 3, 0, 7, 'sandstone');

  // --- Ramparts: a wall walk at 5 m down each side, stairs at both ends ------------------------------
  for (const side of [-1, 1]) {
    const lo = (a, c) => Math.min(side * a, side * c), hi = (a, c) => Math.max(side * a, side * c);
    const top = flight(b, 'z', 40, -1, lo(33.4, 36), hi(33.4, 36), 5, 'sandstone', SYM);
    add(lo(30, 36), -top, hi(30, 36), top, 4.6, 5, 'sandstone');
    // Crenellations on the courtyard edge: merlon, gap, merlon …
    for (let z = 1.5; z < top - 1; z += 4) add(lo(30, 30.6), z, hi(30, 30.6), z + 2.4, 5, 6.3, 'sandstone', SYM);
    add(lo(30, 30.6), -1, hi(30, 30.6), 1, 5, 6.3, 'sandstone');
    // Arcade underneath, and a guardroom that closes the straight run below the wall walk.
    for (let z = 6; z < top; z += 6) add(lo(30, 31), z - 0.5, hi(30, 31), z + 0.5, 0, 4.6, 'sandstone', SYM);
    add(lo(26, 36), 12, hi(26, 36), 17, 0, 4.6, 'stone', SYM);
    lights.push({ pos: [side * 33, 4, 8], color: '#ffc27a', intensity: 12, distance: 14 }, { pos: [side * 33, 4, -8], color: '#ffc27a', intensity: 12, distance: 14 });
  }

  // --- Courtyard -----------------------------------------------------------------------------------------
  add(-6, 37, 6, 38.2, 0, 3.4, 'stone', SYM);             // screen in front of the centre gate
  add(-16, 20, -8, 21.2, 0, 2.4, 'adobe', SYM);           // broken walls
  add(8, 27, 16, 28.2, 0, 2.4, 'adobe', SYM);
  add(-2, 15, 2, 17, 0, 1.1, 'stone', SYM);               // well
  add(-1.2, 15.6, 1.2, 16.4, 1.1, 3.2, 'wood', { ...DECO, sym: true });
  add(-23, 26, -19, 29, 0, 2.6, 'cloth', SYM);            // tents: cloth, stops nothing
  add(19, 33, 23, 36, 0, 2.6, 'clothAlt', SYM);
  add(14, 14, 17, 16, 0, 1.3, 'sandbag', SYM);
  add(-13, 31, -10, 33, 0, 1.3, 'sandbag', SYM);
  add(-24, 6, -21, 9, 0, 1.4, 'crate', SYM);
  add(21, 20, 24, 22, 0, 1.4, 'crate', SYM);
  add(4, 22, 6, 24, 0, 2.2, 'wood', SYM);                 // cart
  lights.push({ pos: [0, 5, 0.1], color: '#ffc27a', intensity: 14, distance: 12 }, { pos: [0, 6, 30], color: '#cfe6ff', intensity: 14, distance: 22 }, { pos: [0, 6, -30], color: '#ffd9b0', intensity: 14, distance: 22 });

  const signs = [
    { text: 'RAVELIN', pos: [0, 5.2, shell.zWall - 0.05], face: 'north', size: 1.1, color: '#6ce6d1' },
    { text: 'RAVELIN', pos: [0, 5.2, -shell.zWall + 0.05], face: 'south', size: 1.1, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'Keep', box: [-9, -1, -9, 9, 6, 9] },
    { name: 'West Tower', box: [-20, -1, -9, -9, 20, 9] }, { name: 'East Tower', box: [9, -1, -9, 20, 20, 9] },
    { name: 'West Rampart', box: [-36, 4.5, -40, -30, 20, 40] }, { name: 'East Rampart', box: [30, 4.5, -40, 36, 20, 40] },
    shell.lobbyZone,
    { name: 'A West Arcade', box: [-36, -1, 9, -26, 4.5, 46] }, { name: 'A East Arcade', box: [26, -1, 9, 36, 4.5, 46] },
    { name: 'West Arcade', box: [-36, -1, -9, -20, 4.5, 9] }, { name: 'East Arcade', box: [20, -1, -9, 36, 4.5, 9] },
    { name: 'A Courtyard', box: [-26, -1, 9, 26, 20, 46] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 33], [-10, 0, 25], [11, 0, 22], [0, 0, 12], [-5, 0, 5.5], [5, 0, 5.5], [-22, 0, 22], [22, 0, 30], [-33, 0, 6], [33, 0, 6],
    [-33, 5, 12], [33, 5, 12], [-33, 5, 0], [33, 5, 0], [-11, 0, 0], [11, 0, 0], [-24, 0, 0], [24, 0, 0], [-33, 5, 24],
  ]);
  const lanes = [
    [[-30, 0, 44], [-24, 0, 4]], [[30, 0, 44], [24, 0, 4]], [[0, 0, 44], [11, 0, 8]], [[0, 0, 44], [-11, 0, 8]],
    [[30, 0, 44], [33, 5, 10]], [[-30, 0, 44], [-33, 5, 10]],
  ];
  return {
    id: 'ravelin', title: 'Ravelin', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'mesas', variants: ['noon', 'haze', 'dusk', 'night'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
