// BREAKWATER — medium to large. A container quay under a gantry crane. Long lanes between the
// stacks, a walkway across the crane beam, and steel boxes that a rifle goes straight through.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildBreakwater() {
  const b = createBuilder();
  const { add } = b;
  const gates = [[-28, -24], [-3, 3], [24, 28]];
  const shell = arenaShell(b, { halfW: 32, halfL: 50, lobby: 10, gates, floor: 'asphalt', wallMat: 'wall', lobbyMat: 'concrete', wallH: 8 });
  const lights = [];
  const box = (x, z, along, mat, levels = 1, opts = SYM) => (along === 'z' ? add(x, z, x + 2.5, z + 6, 0, 2.6 * levels, mat, opts) : add(x, z, x + 6, z + 2.5, 0, 2.6 * levels, mat, opts));

  // --- Gantry crane across the middle --------------------------------------------
  add(-3, -1.25, 3, 1.25, 0, 5.2, 'teal');                 // two-high stack under the beam
  for (const side of [-1, 1]) {
    add(Math.min(side * 11, side * 15), -2, Math.max(side * 11, side * 15), 2, 0, 5.6, 'hazard'); // crane legs
    const top = flight(b, 'x', side * 26, -side, -1.1, 1.1, 6, 'metal');
    add(Math.min(top, side * 15), -1.1, Math.max(top, side * 15), 1.1, 5.6, 6, 'metal');
  }
  add(-15, -1.5, 15, 1.5, 5.6, 6, 'metal');
  for (const z of [-1.45, 1.45]) for (const [x1, x2] of [[-14, -9], [-5, 5], [9, 14]]) add(x1, z - 0.05, x2, z + 0.05, 6, 7.1, 'hazard');
  add(-16, -0.6, 16, 0.6, 9, 10.2, 'hazard', { deco: true });
  add(-1.5, -1.5, 1.5, 1.5, 7.2, 9, 'darkMetal', { deco: true });

  // --- Container stacks (south half, mirrored) -------------------------------------
  box(23, 12, 'x', 'rust', 1);        // closes the east flank lane
  box(-29, 12, 'x', 'teal', 1);       // and the west one
  box(-9, 8, 'z', 'hull', 2);
  box(6.5, 8, 'z', 'rust', 1);
  box(14, 17, 'x', 'teal', 2);
  box(-20, 18, 'x', 'hazard', 1);
  box(-3, 20, 'x', 'hull', 1);
  box(-13, 27, 'z', 'rust', 1);
  box(10.5, 27, 'z', 'teal', 1);
  box(-3, 33.5, 'x', 'rust', 2);      // screen in front of the centre gate
  box(19, 30, 'z', 'hull', 1);
  box(-24, 29, 'z', 'hazard', 1);
  // Low cover: pallets, bollards, a forklift.
  add(-6, 14, -4, 15.5, 0, 1.1, 'crate', SYM);
  add(3, 26, 5, 27.5, 0, 1.1, 'crate', SYM);
  add(17, 8, 19, 9.4, 0, 1.2, 'crate', SYM);
  add(-17, 9, -15.4, 11.8, 0, 1.7, 'hazard', SYM);
  add(-31, 22, -30, 26, 0, 1, 'concrete', SYM);
  add(30, 3, 31, 7, 0, 1, 'concrete', SYM);
  // Quay edge and water beyond the fence (decoration).
  add(-31.9, -40, -31.6, 40, 0, 0.12, 'hazard', DECO);
  add(31.6, -40, 31.9, 40, 0, 0.12, 'hazard', DECO);
  for (const z of [10, 30]) lights.push({ pos: [-16, 7, z], color: '#ffd9a8', intensity: 26, distance: 30 }, { pos: [16, 7, -z], color: '#ffd9a8', intensity: 26, distance: 30 }, { pos: [16, 7, z], color: '#cfe6ff', intensity: 20, distance: 26 }, { pos: [-16, 7, -z], color: '#cfe6ff', intensity: 20, distance: 26 });

  const signs = [
    { text: 'BERTH 7', pos: [0, 4.4, shell.zWall - 0.05], face: 'north', size: 1, color: '#6ce6d1' },
    { text: 'BERTH 7', pos: [0, 4.4, -shell.zWall + 0.05], face: 'south', size: 1, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'Crane Walk', box: [-26, 3, -1.6, 26, 20, 1.6] },
    { name: 'Under the Crane', box: [-16, -1, -5, 16, 3, 5] },
    shell.lobbyZone,
    { name: 'A West Stacks', box: [-32, -1, 5, -10, 20, 40] }, { name: 'A East Stacks', box: [10, -1, 5, 32, 20, 40] },
    { name: 'A Centre Lane', box: [-10, -1, 5, 10, 20, 40] },
    { name: 'West Quay', box: [-32, -1, -5, -16, 20, 5] }, { name: 'East Quay', box: [16, -1, -5, 32, 20, 5] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 28], [-5, 0, 12], [4, 0, 17], [-16, 0, 14], [12, 0, 12], [-22, 0, 25], [22, 0, 22], [-30.5, 0, 8], [30.5, 0, 16],
    [0, 0, 5], [-8, 0, 3], [8, 0, 3], [0, 6, 0], [-10, 6, 0], [10, 6, 0], [-20, 0, 3.5], [20, 0, 3.5],
  ]);
  const lanes = [
    [[-26, 0, 38], [-30.5, 0, 4]], [[26, 0, 38], [30.5, 0, 4]], [[0, 0, 38], [8, 0, 6]], [[0, 0, 38], [-8, 0, 6]],
    [[26, 0, 38], [10, 6, 0]], [[-26, 0, 38], [-10, 6, 0]],
  ];
  return {
    id: 'breakwater', title: 'Breakwater', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'skyline', variants: ['storm', 'dusk', 'night', 'noon'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
