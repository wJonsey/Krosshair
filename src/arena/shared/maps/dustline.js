// DUSTLINE PASS — large. Two desert outposts face each other across a dry riverbed.
// One stone bridge and two plank crossings above, the whole wadi as a covered route
// below; a watchtower, a roof-top house and a climbable mesa for the long guns.
import { createBuilder, SYM, DECO, gateBarriers, mirrorZones, mirrorPoints, teamSpawns } from '../mapkit.js';

export function buildDustline() {
  const b = createBuilder();
  const { add, slabs, wall, stairs, stall } = b;
  const lights = [];

  // --- Desert floor, the wadi and the four ramps into it ------------------------------
  slabs(-64, -84, 64, 84, -0.5, 0, 'sand', [[-64, -7, 64, 7], [-25, 7, -19, 13], [19, 7, 25, 13], [-25, -13, -19, -7], [19, -13, 25, -7]]);
  add(-64, -14, 64, 14, -3.7, -3.2, 'gravel');
  [[-64, -26], [-18, 18], [26, 64]].forEach(([x1, x2]) => add(x1, 7, x2, 8, -3.7, -0.5, 'sandstone', SYM));
  for (const x of [-26, -19, 18, 25]) add(x, 7, x + 1, 14, -3.7, -0.5, 'sandstone', SYM);
  for (const [x1, x2] of [[-25, -19], [19, 25]]) {
    stairs('z', 7, 13, x1, x2, -3.2, 0, 9, 'sandstone', SYM);
    add(x1 - 1, 13, x2 + 1, 14, -3.7, -0.5, 'sandstone', SYM);
  }
  add(-5, -66, 5, 66, 0, 0.02, 'gravel', DECO);

  // --- Crossings -------------------------------------------------------------------------
  add(-4, -7, 4, 7, -0.6, 0, 'stone');
  add(-4, -7, -3.5, 7, 0, 1, 'stone');
  add(3.5, -7, 4, 7, 0, 1, 'stone');
  add(-4, -1, 4, 1, -3.2, -0.6, 'stone');
  add(-40, -7, -37, 7, -0.3, 0, 'wood');
  add(37, -7, 40, 7, -0.3, 0, 'wood');
  for (const x of [-40, -37.3, 37, 39.7]) add(x, -0.3, x + 0.3, 0.3, -3.2, -0.3, 'wood');
  lights.push({ pos: [0, -1.4, 3.5], color: '#ffb36b', intensity: 12, distance: 16 }, { pos: [0, -1.4, -3.5], color: '#ffb36b', intensity: 12, distance: 16 });

  // --- In the wadi: boulders, reeds (shoot-through), a wreck ------------------------------
  add(-12, 1.5, -8.5, 4.5, -3.2, -1.2, 'rock', SYM);
  add(9, 2, 13, 5.5, -3.2, -0.9, 'rock', SYM);
  add(-33, 0.8, -29, 4, -3.2, -1.4, 'rock', SYM);
  add(29, 3, 33, 6.4, -3.2, -1, 'rock', SYM);
  add(-52, 2, -47, 6, -3.2, -0.8, 'rock', SYM);
  add(47, 1, 52, 5, -3.2, -1.1, 'rock', SYM);
  add(-17, 4.6, -14, 6.2, -3.2, -1.9, 'hedge', SYM);
  add(15, 0.6, 18, 2, -3.2, -1.9, 'hedge', SYM);
  add(42, 4.4, 45, 6, -3.2, -1.9, 'hedge', SYM);
  add(-23.5, -1.2, -19.5, 1.2, -3.2, -1.6, 'rust');
  add(-22.6, -0.9, -20.8, 0.9, -1.6, -0.95, 'rust');
  add(20, -1, 24.5, 1, -3.2, -1.7, 'crate');

  // --- Perimeter cliffs ---------------------------------------------------------------------
  add(-66, -84, -60, 84, -3.7, 10, 'sandstone');
  add(60, -84, 66, 84, -3.7, 10, 'sandstone');
  add(-66, 80, 66, 86, 0, 10, 'sandstone', SYM);

  // --- Spawn: rock wall with three gates ------------------------------------------------------
  const gates = [[-40, -34], [-4, 4], [34, 40]];
  [[-60, -40], [-34, -4], [4, 34], [40, 60]].forEach(([x1, x2]) => add(x1, 66, x2, 69, 0, 7, 'sandstone', SYM));
  gates.forEach(([x1, x2]) => {
    add(x1, 66, x2, 69, 3.8, 7, 'sandstone', SYM);
    add(x1, 65.9, x2, 66, 3.5, 3.8, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  });
  add(-16, 73, -12, 76, 0, 1.2, 'crate', SYM);
  add(12, 71, 18, 73.5, 0, 2.5, 'rust', SYM);
  add(-30, 72, -27, 74.5, 0, 1.15, 'sandbag', SYM);
  lights.push({ pos: [0, 5, 72], color: '#cfe6ff', intensity: 20, distance: 24 }, { pos: [0, 5, -72], color: '#ffd9b0', intensity: 20, distance: 24 });

  // --- The road: ruined gatehouse at the bridge head, a shot-up convoy behind it ------------------
  add(-4.5, 9, -2.5, 11, 0, 5, 'adobe', SYM);
  add(2.5, 9, 4.5, 11, 0, 5, 'adobe', SYM);
  add(-4.5, 9.2, 4.5, 10.8, 3.7, 4.5, 'adobe', SYM);
  add(-9, 9.4, -4.5, 10.4, 0, 1.6, 'adobe', SYM);
  add(4.5, 9.4, 8, 10.4, 0, 2.4, 'adobe', SYM);
  add(-2.8, 20, 0.2, 27, 0.5, 2.9, 'rust', SYM);
  add(-2.5, 20.6, -0.1, 26.4, 0, 0.5, 'darkMetal', SYM);
  add(-0.2, 32, 3, 38.5, 0.5, 2.9, 'teal', SYM);
  add(0.1, 32.6, 2.7, 37.9, 0, 0.5, 'darkMetal', SYM);
  add(-4.6, 44, -2, 46, 0, 1.2, 'crate', SYM);
  // Checkpoint wall: the centre gate opens onto a chicane, so no one sees in from across the map.
  add(-8, 55, 8, 56, 0, 3.2, 'adobe', SYM);
  add(-8, 54.9, 8, 55, 2.3, 2.6, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  add(9, 50, 12, 51.2, 0, 1.15, 'sandbag', SYM);
  add(-12, 60, -9, 61.2, 0, 1.15, 'sandbag', SYM);

  // --- House with a roof terrace (east of the road) ---------------------------------------------
  wall('x', 26, 26.5, 10, 26, 0, 3.4, 'adobe', [{ a: 14, b: 16.4, y1: 0, y2: 2.6 }, { a: 20, b: 23, y1: 1, y2: 2.2 }], SYM);
  wall('x', 39.5, 40, 10, 26, 0, 3.4, 'adobe', [{ a: 19, b: 21.4, y1: 0, y2: 2.6 }], SYM);
  wall('z', 10, 10.5, 26.5, 39.5, 0, 3.4, 'adobe', [{ a: 27.5, b: 30, y1: 1, y2: 2.2 }, { a: 32, b: 34.4, y1: 0, y2: 2.6 }], SYM);
  wall('z', 25.5, 26, 26.5, 39.5, 0, 3.4, 'adobe', [], SYM);
  add(10, 26, 26, 40, 3.4, 3.8, 'adobe', SYM);
  wall('z', 17.8, 18.1, 26.5, 39.5, 0, 3.4, 'adobe', [{ a: 35, b: 37.4, y1: 0, y2: 2.6 }], SYM);
  add(12, 36.5, 15, 38.5, 0, 1.2, 'crate', SYM);
  add(21, 27.5, 24.5, 28.6, 0, 0.9, 'wood', SYM);
  add(11.5, 28, 16.5, 34, 0, 0.03, 'cloth', { ...DECO, sym: true });
  stairs('z', 40, 31, 26, 28, 0, 3.8, 10, 'adobe', SYM);
  // Parapet: thin enough for the long rifle, with a gap at the stairhead.
  add(10, 26, 26, 26.3, 3.8, 4.7, 'adobe', SYM);
  add(10, 39.7, 26, 40, 3.8, 4.7, 'adobe', SYM);
  add(10, 26.3, 10.3, 39.7, 3.8, 4.7, 'adobe', SYM);
  add(25.7, 26.3, 26, 30.4, 3.8, 4.7, 'adobe', SYM);
  add(25.7, 32.6, 26, 39.7, 3.8, 4.7, 'adobe', SYM);
  add(14, 31, 16.4, 33.4, 3.8, 5, 'crate', SYM);
  add(19.5, 27.5, 23, 28.5, 3.8, 4.9, 'sandbag', SYM);
  lights.push({ pos: [18, 2.9, 33], color: '#ffc98a', intensity: 12, distance: 15 }, { pos: [18, 2.9, -33], color: '#ffc98a', intensity: 12, distance: 15 });

  // --- Caravan camp (west of the road): stalls, a tent you can shoot through, sandbags ---------------
  stall(-22, 27, 'cloth');
  stall(-14, 35, 'clothAlt');
  add(-24, 40, -18, 40.1, 0, 2.4, 'clothAlt', SYM);
  add(-24, 45.9, -18, 46, 0, 2.4, 'clothAlt', SYM);
  add(-24, 40.1, -23.9, 45.9, 0, 2.4, 'clothAlt', SYM);
  add(-24.3, 39.7, -17.7, 46.3, 2.4, 2.52, 'cloth', SYM);
  add(-11, 22, -8, 24.4, 0, 1.2, 'crate', SYM);
  add(-16, 14.4, -10, 15.4, 0, 1.15, 'sandbag', SYM);
  add(8, 14.4, 14, 15.4, 0, 1.15, 'sandbag', SYM);
  add(-13.6, 28.4, -12.4, 29.6, 0, 0.4, 'rock', SYM);
  lights.push({ pos: [-13, 1, 29], color: '#ff8a3c', intensity: 16, distance: 16 }, { pos: [-13, 1, -29], color: '#ff8a3c', intensity: 16, distance: 16 });
  add(-13.3, 28.7, -12.7, 29.3, 0.4, 0.6, 'neonOrange', { ...DECO, sym: true });
  for (const [x, z] of [[-7, 17], [6.5, 42], [-27, 50], [30, 18]]) {
    add(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, 5.2, 'wood', SYM);
    add(x - 1.6, z - 0.3, x + 1.6, z + 0.3, 5, 5.5, 'hedge', { deco: true, sym: true });
    add(x - 0.3, z - 1.6, x + 0.3, z + 1.6, 5, 5.5, 'hedge', { deco: true, sym: true });
  }

  // --- Watchtower (west): wooden, exposed, railings stop nothing ----------------------------------------
  add(-32, 38, -28, 42, 4.6, 5, 'wood', SYM);
  for (const [x, z] of [[-32, 38], [-28.4, 38], [-32, 41.6], [-28.4, 41.6]]) add(x, z, x + 0.4, z + 0.4, 0, 7.2, 'wood', SYM);
  stairs('x', -40, -32, 39, 41, 0, 5, 13, 'wood', SYM);
  add(-31.6, 38, -28.4, 38.1, 5, 6, 'wood', SYM);
  add(-31.6, 41.9, -28.4, 42, 5, 6, 'wood', SYM);
  add(-28.1, 38.4, -28, 41.6, 5, 6, 'wood', SYM);
  add(-32.4, 37.6, -27.6, 42.4, 7.2, 7.4, 'wood', { deco: true, sym: true });
  lights.push({ pos: [-30, 6.6, 40], color: '#ffc98a', intensity: 10, distance: 14 }, { pos: [-30, 6.6, -40], color: '#ffc98a', intensity: 10, distance: 14 });
  add(-43, 19, -33.5, 26, 0, 4, 'rock', SYM);
  add(-41, 20.5, -36, 24.5, 4, 5.2, 'rock', { deco: true, sym: true });
  add(-52, 44, -47, 48, 0, 2.6, 'rock', SYM);
  add(-56, 28, -52, 33, 0, 3, 'rock', SYM);
  add(-47, 14, -44, 15.2, 0, 1.15, 'sandbag', SYM);

  // --- The Anvil (east): a mesa with a stair for bots and ledges for jumpers -----------------------------
  add(42, 24, 58, 42, 0, 3, 'sandstone', SYM);
  stairs('x', 36, 42, 31, 35, 0, 3, 8, 'sandstone', SYM);
  add(44, 22, 50, 24, 0, 1, 'sandstone', SYM);
  add(50, 22, 54, 24, 0, 2, 'sandstone', SYM);
  add(44, 27, 47, 29.5, 3, 4.2, 'rock', SYM);
  add(51, 36, 55, 38, 3, 4.3, 'rock', SYM);
  add(48.8, 31.8, 49.2, 32.2, 3, 6.5, 'wood', SYM);
  add(33, 48, 41.5, 54, 0, 3.6, 'rock', SYM);
  add(30, 12, 34, 13.2, 0, 1.15, 'sandbag', SYM);
  add(46, 12, 52, 16, 0, 2.4, 'rock', SYM);
  add(20, 48, 24, 51, 0, 2.2, 'rock', SYM);
  add(-20, 56, -15, 59, 0, 2.4, 'rock', SYM);

  const signs = [
    { text: 'DUSTLINE PASS', pos: [0, 5.6, 65.95], face: 'north', size: 1.3, color: '#6ce6d1' },
    { text: 'DUSTLINE PASS', pos: [0, 5.6, -65.95], face: 'south', size: 1.3, color: '#ff7148' },
  ];

  const zones = mirrorZones([
    { name: 'Stone Bridge', box: [-4.5, -0.7, -7, 4.5, 20, 7] },
    { name: 'West Planks', box: [-40.5, -0.4, -7, -36.5, 20, 7] },
    { name: 'East Planks', box: [36.5, -0.4, -7, 40.5, 20, 7] },
    { name: 'Under Bridge', box: [-8, -4, -7, 8, -0.7, 7] },
    { name: 'A West Ramp', box: [-26, -4, 7, -18, 0.5, 14] },
    { name: 'A East Ramp', box: [18, -4, 7, 26, 0.5, 14] },
    { name: 'Wadi West', box: [-60, -4, -7, -8, -0.4, 7], mirror: false },
    { name: 'Wadi East', box: [8, -4, -7, 60, -0.4, 7], mirror: false },
    { name: 'A Outpost', box: [-60, -1, 69, 60, 20, 80] },
    { name: 'A Watchtower', box: [-40, 0.3, 37.5, -27.5, 20, 42.5] },
    { name: 'A Terrace', box: [10, 3.7, 26, 28, 20, 40] },
    { name: 'A House', box: [10, -1, 26, 26, 3.7, 40] },
    { name: 'A Anvil', box: [36, 0.3, 20, 58, 20, 42] },
    { name: 'A Gatehouse', box: [-9, -1, 7, 9, 20, 14] },
    { name: 'A Convoy', box: [-6, -1, 14, 6, 20, 66] },
    { name: 'A Camp', box: [-26, -1, 14, -6, 20, 48] },
    { name: 'A West Dunes', box: [-60, -1, 7, -26, 20, 66] },
    { name: 'A East Dunes', box: [26, -1, 7, 60, 20, 66] },
    { name: 'A Bank', box: [-60, -1, 7, 60, 20, 66] },
  ]);

  const interest = mirrorPoints([
    [0, 0, 60], [0, 0, 42], [2, 0, 16], [-6, 0, 30], [0, 0, 4], [-38.5, 0, 3], [38.5, 0, 3], [-22, -3.2, 4], [22, -3.2, 3], [0, -3.2, 4], [-45, -3.2, 3], [44, -3.2, 3],
    [18, 0, 33], [14, 0, 30], [18, 3.8, 33], [13, 3.8, 28], [30, 0, 36], [-30, 5, 40], [-36, 0, 32], [-16, 0, 31], [-21, 0, 43], [-13, 0, 18], [11, 0, 18],
    [50, 3, 33], [45, 3, 40], [38, 0, 28], [-48, 0, 36], [-50, 0, 16], [48, 0, 50], [-38, 0, 58], [30, 0, 58],
  ]);
  const lanes = [
    [[0, 0, 62], [2, 0, 15]], [[0, 0, 62], [0, 0, 3]], [[-37, 0, 62], [-38.5, 0, 2]], [[-37, 0, 62], [-30, 5, 40]], [[-37, 0, 62], [-22, -3.2, 3]],
    [[37, 0, 62], [38.5, 0, 2]], [[37, 0, 62], [50, 3, 33]], [[37, 0, 62], [22, -3.2, 3]], [[0, 0, 62], [18, 3.8, 33]], [[0, 0, 62], [-16, 0, 30]],
  ];

  return {
    id: 'dustline', title: 'Dustline Pass',
    bounds: { minX: -60, maxX: 60, minZ: -80, maxZ: 80, minY: -4, maxY: 12 },
    boxes: b.boxes, barriers: gateBarriers(gates, 67.2, 67.8, 3.8), lights, signs, zones, interest, lanes,
    env: { backdrop: 'mesas', variants: ['noon', 'haze', 'dusk', 'night'] },
    spawnZones: { A: [-60, 67.1, 60, 80], B: [-60, -80, 60, -67.1] },
    spawns: teamSpawns([-7.5, -2.5, 2.5, 7.5], 74),
    dummies: [],
  };
}
