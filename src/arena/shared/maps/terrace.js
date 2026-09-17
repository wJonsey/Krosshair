// SKYLINE TERRACE — medium. A tower rooftop: a glass greenhouse in the middle that will not stay
// glass for long, water tanks on stilts to climb, and plant rooms humming on both flanks.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildTerrace() {
  const b = createBuilder();
  const { add, glassRun } = b;
  const gates = [[-24, -20], [-3, 3], [20, 24]];
  const shell = arenaShell(b, { halfW: 28, halfL: 44, lobby: 9, gates, floor: 'concrete', wallMat: 'wall', lobbyMat: 'plaster', wallH: 7 });
  const lights = [];

  // --- Greenhouse: glass all round, hedges inside so it is not a window across the map ------
  for (const z of [-5, 5]) { glassRun('x', z, -7, -1.5, 0, 3.2); glassRun('x', z, 1.5, 7, 0, 3.2); }
  for (const x of [-7, 7]) { glassRun('z', x, -5, -1.5, 0, 3.2); glassRun('z', x, 1.5, 5, 0, 3.2); }
  for (const [x, z] of [[-7, -5], [7, -5], [-7, 5], [7, 5], [-1.5, -5], [1.5, -5], [-1.5, 5], [1.5, 5], [-7, -1.5], [-7, 1.5], [7, -1.5], [7, 1.5]]) add(x - 0.12, z - 0.12, x + 0.12, z + 0.12, 0, 3.4, 'darkMetal');
  add(-7.2, -5.2, 7.2, 5.2, 3.4, 3.5, 'glass', { glass: true });
  add(-6, -0.7, -1.2, 0.7, 0, 2.5, 'hedge');
  add(1.2, -0.7, 6, 0.7, 0, 2.5, 'hedge');
  add(-5.5, 2.4, -2.5, 3.6, 0, 1, 'wood', SYM);
  add(2.5, 2.4, 5.5, 3.6, 0, 1.6, 'hedge', SYM);
  // Chiller banks close the diagonals either side of it.
  for (const side of [-1, 1]) { add(Math.min(side * 9.5, side * 14.5), -2.2, Math.max(side * 9.5, side * 14.5), 2.2, 0, 3, 'metal'); add(Math.min(side * 10, side * 14), -1.6, Math.max(side * 10, side * 14), 1.6, 3, 3.5, 'darkMetal', { deco: true }); }

  for (const side of [-1, 1]) {
    const lo = (a, c) => Math.min(side * a, side * c), hi = (a, c) => Math.max(side * a, side * c);
    // Plant room: a brick box with a door through it, closing the straight flank run.
    add(lo(18, 26), -3, hi(18, 26), -0.9, 0, 3.6, 'brick');
    add(lo(18, 26), 0.9, hi(18, 26), 3, 0, 3.6, 'brick');
    add(lo(18, 21), -0.9, hi(18, 21), 0.9, 0, 3.6, 'brick');
    add(lo(18, 26), -3, hi(18, 26), 3, 3.6, 4, 'concrete');
    // Water tank on stilts: platform at 4 m with a flight up from the lobby side.
    const top = flight(b, 'z', 26, -1, lo(15, 17.2), hi(15, 17.2), 4, 'metal', SYM);
    add(lo(11, 17.2), top - 5, hi(11, 17.2), top, 3.6, 4, 'metal', SYM);
    add(lo(11.4, 14.4), top - 4.6, hi(11.4, 14.4), top - 1.6, 4, 6.4, 'teal', SYM);           // the tank itself
    for (const [px, pz] of [[11.3, top - 4.7], [16.9, top - 4.7], [11.3, top - 0.3]]) add(side * px - 0.2, pz - 0.2, side * px + 0.2, pz + 0.2, 0, 3.6, 'darkMetal', SYM);
    add(lo(11, 17.2), top - 5, hi(11, 17.2), top - 4.9, 4, 5.1, 'metal', SYM);
    // Billboard frame: thin sheet, good to hide behind, useless as armour.
    add(lo(3, 9), 14, hi(3, 9), 14.12, 0.6, 4.4, 'metal', SYM);
    add(side * 3.2 - 0.15, 13.9, side * 3.2 + 0.15, 14.25, 0, 4.4, 'darkMetal', SYM);
    add(side * 8.8 - 0.15, 13.9, side * 8.8 + 0.15, 14.25, 0, 4.4, 'darkMetal', SYM);
    add(lo(3, 9), 13.95, hi(3, 9), 14, 1, 4, side < 0 ? 'neonPink' : 'neonCyan', { ...DECO, sym: true });
    // Vents, skylights and AC units.
    add(lo(20, 23), 12, hi(20, 23), 14, 0, 1.4, 'metal', SYM);
    add(lo(23.5, 26.5), 22, hi(23.5, 26.5), 24.5, 0, 2.2, 'hull', SYM);
    add(lo(5, 8), 24, hi(5, 8), 26, 0, 1.2, 'metal', SYM);
    add(lo(8.5, 10), 7.5, hi(8.5, 10), 9, 0, 1.2, 'crate', SYM);
    lights.push({ pos: [side * 14, 3.2, top - 2.5], color: '#9fd8ff', intensity: 12, distance: 14 }, { pos: [side * 14, 3.2, -(top - 2.5)], color: '#9fd8ff', intensity: 12, distance: 14 });
  }
  add(-4.5, 30, 4.5, 30.8, 0, 3.1, 'plaster', SYM);          // screen in front of the centre gate
  add(-1.5, 19, 1.5, 21, 0, 1.3, 'hull', SYM);
  add(-13, 29, -10, 31, 0, 1.3, 'crate', SYM);
  // Helipad markings and a parapet lip (decoration).
  add(-5, 8, 5, 8.3, 0, 0.03, 'hazard', { ...DECO, sym: true });
  lights.push({ pos: [0, 3, 0], color: '#c8ffd6', intensity: 16, distance: 14 }, { pos: [0, 6, 28], color: '#cfe6ff', intensity: 14, distance: 20 }, { pos: [0, 6, -28], color: '#ffd9b0', intensity: 14, distance: 20 });

  const signs = [
    { text: 'LEVEL 61', pos: [0, 4.4, shell.zWall - 0.05], face: 'north', size: 0.9, color: '#6ce6d1' },
    { text: 'LEVEL 61', pos: [0, 4.4, -shell.zWall + 0.05], face: 'south', size: 0.9, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'Greenhouse', box: [-7.2, -1, -5.2, 7.2, 3.4, 5.2] },
    { name: 'West Chillers', box: [-18, -1, -5, -7.2, 20, 5] }, { name: 'East Chillers', box: [7.2, -1, -5, 18, 20, 5] },
    { name: 'West Plant Room', box: [-28, -1, -5, -18, 20, 5] }, { name: 'East Plant Room', box: [18, -1, -5, 28, 20, 5] },
    shell.lobbyZone,
    { name: 'A West Tank', box: [-17.2, 3.5, 13, -11, 20, 26] }, { name: 'A East Tank', box: [11, 3.5, 13, 17.2, 20, 26] },
    { name: 'A West Deck', box: [-28, -1, 5, -10, 3.5, 35] }, { name: 'A East Deck', box: [10, -1, 5, 28, 3.5, 35] },
    { name: 'A Helipad', box: [-10, -1, 5, 10, 20, 35] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 25], [-6, 0, 17], [6, 0, 11], [-3, 0, 7], [0, 0, 3], [-22, 0, 18], [22, 0, 28], [-27, 0, 8], [27, 0, 8],
    [-16, 4, 16], [16, 4, 16], [-23, 0, 0], [23, 0, 0], [-16, 0, 0], [16, 0, 0], [-12, 0, 10], [12, 0, 22],
  ]);
  const lanes = [
    [[-22, 0, 33], [-27, 0, 4]], [[22, 0, 33], [27, 0, 4]], [[0, 0, 33], [8, 0, 6]], [[0, 0, 33], [-8, 0, 6]],
    [[22, 0, 33], [16, 4, 16]], [[-22, 0, 33], [-16, 4, 16]],
  ];
  return {
    id: 'terrace', title: 'Skyline Terrace', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'skyline', variants: ['night', 'dusk', 'storm', 'noon'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
