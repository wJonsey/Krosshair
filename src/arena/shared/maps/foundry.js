// FOUNDRY — small to medium. A steel mill floor around a dead furnace: catwalks down both
// sides, two bridges across, and a lot of sheet metal that stops nothing.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildFoundry() {
  const b = createBuilder();
  const { add } = b;
  const gates = [[-22, -18], [-3, 3], [18, 22]];
  const shell = arenaShell(b, { halfW: 26, halfL: 40, lobby: 9, gates, floor: 'concrete', wallMat: 'wall', lobbyMat: 'brick', wallH: 11 });
  const lights = [];

  // --- Furnace and the two ladle cars that flank it ---------------------------
  add(-6, -5, 6, 5, 0, 7.5, 'rust');
  add(-4.5, -3.5, 4.5, 3.5, 7.5, 10.5, 'darkMetal');
  add(-6.1, -2, -6, 2, 0.4, 2.2, 'neonOrange', DECO);
  add(6, -2, 6.1, 2, 0.4, 2.2, 'neonOrange', DECO);
  for (const side of [-1, 1]) {
    add(side * 9, -3, side * 12.5, 3, 0, 3.4, 'darkMetal');
    add(side * 9.4, -2.4, side * 12.1, 2.4, 3.4, 4.2, 'hazard');
  }

  // --- Catwalks: one down each side at 4 m, stairs at both ends ------------------
  for (const side of [-1, 1]) {
    const x1 = Math.min(side * 15, side * 21), x2 = Math.max(side * 15, side * 21);
    const top = flight(b, 'z', 26, -1, Math.min(side * 18.8, side * 21), Math.max(side * 18.8, side * 21), 4, 'metal', SYM);
    add(x1, -top, x2, top, 3.6, 4, 'metal');
    // Inner rail: sheet metal with gaps to shoot from.
    for (const [z1, z2] of [[2, 7], [11, 16]]) add(side * 15 - 0.06, z1, side * 15 + 0.06, z2, 4, 5.1, 'metal', SYM);
    add(side * 15 - 0.06, -1, side * 15 + 0.06, 1, 4, 5.1, 'hazard');
    // Legs.
    for (const z of [0.4, 9, 17.6]) { add(side * 15.2 - 0.2, z - 0.2, side * 15.2 + 0.2, z + 0.2, 0, 3.6, 'darkMetal', SYM); add(side * 20.8 - 0.2, z - 0.2, side * 20.8 + 0.2, z + 0.2, 0, 3.6, 'darkMetal', SYM); }
    // Under the catwalk: a coil store that closes the straight run from gate to gate.
    add(side * 16, -2.2, side * 23, 2.2, 0, 3.2, 'rust');
    add(side * 23.4, 8, side * 25.4, 10.4, 0, 1.3, 'crate', SYM);
    lights.push({ pos: [side * 18, 3.3, 12], color: '#ffb36b', intensity: 14, distance: 16 }, { pos: [side * 18, 3.3, -12], color: '#ffb36b', intensity: 14, distance: 16 });
  }
  // Two bridges tie the catwalks together across the floor.
  add(-15, 9, 15, 11, 3.6, 4, 'metal', SYM);
  for (const z of [9.06, 10.94]) { add(-14, z - 0.05, -5, z + 0.05, 4, 5, 'metal', SYM); add(5, z - 0.05, 14, z + 0.05, 4, 5, 'metal', SYM); }
  for (const x of [-7, 7]) add(x - 0.25, 9.75, x + 0.25, 10.25, 0, 3.6, 'darkMetal', SYM);

  // --- Floor cover ----------------------------------------------------------------
  add(-13, 15.5, -7, 16.5, 0, 2.6, 'metal', SYM);      // sheet-metal screens
  add(7, 19.5, 13, 20.5, 0, 2.6, 'metal', SYM);
  add(-2.5, 17, 2.5, 19, 0, 1.2, 'crate', SYM);
  add(-1.2, 17.4, 1.2, 18.6, 1.2, 2.3, 'crate', SYM);
  add(-5, 24, 5, 25, 0, 3.2, 'brick', SYM);             // screen in front of the centre gate
  add(-12.5, 24.5, -9.5, 27, 0, 1.4, 'hazard', SYM);
  add(9.5, 12.5, 12, 14.5, 0, 1.3, 'crate', SYM);
  add(-4, 7, -2.6, 8.4, 0, 1.1, 'rust', SYM);
  add(2.6, 6.4, 4, 7.8, 0, 2.4, 'rust', SYM);
  // Overhead pipes and a gantry rail (decoration).
  for (const x of [-10, 10]) add(x - 0.3, -30, x + 0.3, 30, 8.6, 9.2, 'rust', { deco: true });
  add(-25.8, -0.5, 25.8, 0.5, 9.6, 10.4, 'hazard', { deco: true });
  lights.push({ pos: [0, 6, 22], color: '#cfe6ff', intensity: 16, distance: 20 }, { pos: [0, 6, -22], color: '#ffd9b0', intensity: 16, distance: 20 }, { pos: [-7.5, 2.4, 0], color: '#ff6a2a', intensity: 22, distance: 14 }, { pos: [7.5, 2.4, 0], color: '#ff6a2a', intensity: 22, distance: 14 });

  const signs = [
    { text: 'FOUNDRY 4', pos: [0, 4.4, shell.zWall - 0.05], face: 'north', size: 0.9, color: '#6ce6d1' },
    { text: 'FOUNDRY 4', pos: [0, 4.4, -shell.zWall + 0.05], face: 'south', size: 0.9, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'West Catwalk', box: [-21, 3.5, -19, -15, 20, 19] }, { name: 'East Catwalk', box: [15, 3.5, -19, 21, 20, 19] },
    { name: 'A Bridge', box: [-15, 3.5, 9, 15, 20, 11] },
    { name: 'Furnace', box: [-13, -1, -6, 13, 3.5, 6] },
    shell.lobbyZone,
    { name: 'A West Floor', box: [-26, -1, 6, -13, 3.5, 31] }, { name: 'A East Floor', box: [13, -1, 6, 26, 3.5, 31] },
    { name: 'West Coil Store', box: [-26, -1, -6, -13, 3.5, 6] }, { name: 'East Coil Store', box: [13, -1, -6, 26, 3.5, 6] },
    { name: 'A Mill Floor', box: [-13, -1, 6, 13, 3.5, 31] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 21], [-10, 0, 13], [10, 0, 17], [-8, 0, 3], [8, 0, 7], [-14, 0, 22], [14, 0, 24], [-24.5, 0, 3], [24.5, 0, 12],
    [-18, 4, 5], [18, 4, 13], [0, 4, 10], [-9, 4, 10], [18, 4, 0], [-18, 4, 0],
  ]);
  const lanes = [
    [[-20, 0, 29], [-24.5, 0, 0]], [[20, 0, 29], [24.5, 0, 0]], [[0, 0, 29], [8, 0, 8]], [[0, 0, 29], [-8, 0, 8]],
    [[-20, 0, 28], [-18, 4, 8]], [[20, 0, 28], [18, 4, 8]], [[20, 0, 28], [0, 4, 10]],
  ];
  return {
    id: 'foundry', title: 'Foundry 4', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'skyline', variants: ['dusk', 'night', 'storm', 'noon'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
