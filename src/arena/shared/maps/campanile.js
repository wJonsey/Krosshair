// CAMPANILE — small to medium. An old-town piazza under a climbable bell tower:
// arcades, a two-storey balcony house on each side, a back alley and a sunken canal walk.
import { createBuilder, SYM, DECO, gateBarriers, mirrorZones, mirrorPoints, teamSpawns } from '../mapkit.js';

export function buildCampanile() {
  const b = createBuilder();
  const { add, slabs, wall, stairs, stall } = b;
  const lights = [];
  const ASYM = { asym: true };

  // --- Ground, with the canal cut along the east edge --------------------------
  slabs(-38, -48, 38, 48, -0.5, 0, 'cobble', [[29, -34, 35, 34], [23, -1.5, 29, 1.5]]);
  add(-16, -17.5, 21, 17.5, 0, 0.02, 'paving', DECO);
  add(-5, 17.5, 5, 38, 0, 0.02, 'paving', { ...DECO, sym: true });
  // Canal walk: quay, kerb, water, retaining walls.
  add(28, -35, 36, 35, -2.9, -2.4, 'cobble');
  add(28, -35, 29, 35, -2.9, -0.5, 'stone');
  add(28, 34, 36, 35, -2.9, -0.5, 'stone', SYM);
  add(32.6, -28, 33, 28, -2.4, -1.9, 'stone');
  add(33, -34, 35, 34, -2.4, -2.05, 'water', DECO);
  stairs('z', 34, 28, 29, 32.6, -2.4, 0, 7, 'stone', SYM);
  add(32.6, 28, 33, 34, -2.4, 0, 'stone', SYM);
  // Centre stairs climb west out of the canal onto the piazza.
  stairs('x', 29, 23, -1.5, 1.5, -2.4, 0, 7, 'stone');
  add(22.4, -2.1, 29, -1.5, -2.9, -0.5, 'stone');
  add(22.4, 1.5, 29, 2.1, -2.9, -0.5, 'stone');
  add(22.4, -1.5, 23, 1.5, -2.9, -0.5, 'stone');
  add(23, 1.5, 28.6, 1.9, 0, 1, 'stone', SYM);
  // Parapet along the canal edge, open at the three stairheads.
  add(28.6, 1.9, 29, 34, 0, 1, 'stone', SYM);

  // --- Perimeter ------------------------------------------------------------
  add(-38, -48, -36, 48, 0, 9, 'ochre');
  add(35, -48, 38, 48, -2.9, 9, 'rosePlaster');
  add(-38, 46, 38, 48, 0, 9, 'ochre', SYM);

  // --- Spawn court and its three gates -----------------------------------------
  const gates = [[-31, -27], [-3, 3], [21, 27]];
  [[-36, -31], [-27, -3], [3, 21], [27, 35]].forEach(([x1, x2]) => add(x1, 38, x2, 39.5, 0, 6, 'ochre', SYM));
  gates.forEach(([x1, x2]) => {
    add(x1, 38, x2, 39.5, 3.7, 6, 'ochre', SYM);
    add(x1, 37.9, x2, 38, 3.45, 3.7, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  });
  add(-36, 37.6, 35, 39.9, 6, 6.3, 'terracotta', { deco: true, sym: true });
  add(-16, 43.5, -13, 45.5, 0, 1.2, 'crate', SYM);
  add(10, 41, 12.4, 42.2, 0, 1.15, 'stone', SYM);
  add(-24, 40.5, -21, 42.5, 0, 2.2, 'wood', SYM);

  // --- Bottega block with an arcade facing the piazza ---------------------------
  add(-25, 22, -5, 36, 0, 7, 'rosePlaster', SYM);
  add(-25.4, 21.6, -4.6, 36.4, 7, 7.35, 'terracotta', { deco: true, sym: true });
  add(-25, 17.5, -5, 22, 4, 4.5, 'stone', SYM);
  for (const x of [-24.6, -20.6, -16.6, -12.6, -8.6, -5.4]) add(x - 0.4, 17.5, x + 0.4, 18.3, 0, 4, 'stone', SYM);
  add(-19, 20.4, -16.5, 21.6, 0, 1.2, 'crate', SYM);
  add(-10.5, 20.8, -8, 21.8, 0, 0.55, 'wood', SYM);
  lights.push({ pos: [-15, 3.4, 20], color: '#ffd59a', intensity: 14, distance: 16 }, { pos: [-15, 3.4, -20], color: '#ffd59a', intensity: 14, distance: 16 });
  add(-15.5, 19.9, -14.5, 20.1, 3.85, 4, 'lamp', { ...DECO, sym: true });

  // --- West alley: arch, laundry, a wellhouse on the centre line ---------------
  wall('x', 11.7, 12.3, -36, -25, 0, 5.5, 'ochre', [{ a: -34, b: -30.5, y1: 0, y2: 3 }], SYM);
  add(-36, -2, -29.5, 2, 0, 3.6, 'stone');
  add(-36.2, -2.3, -29.2, 2.3, 3.6, 3.95, 'terracotta', { deco: true });
  add(-28.5, 25, -26, 27, 0, 1.2, 'crate', SYM);
  add(-28.3, 25.2, -26.6, 26.6, 1.2, 2.2, 'crate', SYM);
  add(-35.5, 30, -33, 33.5, 0, 1.6, 'wood', SYM);
  add(-35.5, 6, -34, 8.5, 0, 1.2, 'crate', SYM);
  for (const z of [18, 21, 30]) add(-36, z - 0.03, -25, z + 0.03, 4.6, 4.66, 'darkMetal', { ...DECO, sym: true });
  for (const [x, z, mat] of [[-33, 18, 'cloth'], [-29, 18, 'plasterWhite'], [-31, 21, 'clothAlt'], [-27.5, 30, 'cloth'], [-32.5, 30, 'plasterWhite']]) add(x - 0.6, z - 0.02, x + 0.6, z + 0.02, 3.7, 4.6, mat, { ...DECO, sym: true });
  // Passage between alley and tower keeps a low wall for cover.
  add(-25, 6, -24.4, 12, 0, 1.15, 'stone', SYM);

  // --- The bell tower ------------------------------------------------------------
  // Stair corridors are 1.2 m wide and centred on the nav grid so bots can climb it too.
  wall('z', -15.9, -15.4, -3.6, 3.6, 0, 9, 'brick', [{ a: -1, b: 1, y1: 0, y2: 2.7 }]);
  add(-22.6, -3.6, -22.1, 3.6, 0, 9, 'brick');
  add(-22.1, 3.1, -15.9, 3.6, 0, 9, 'brick', SYM);
  add(-20.9, -1.9, -17.1, 1.9, 0, 8.6, 'brick');
  stairs('x', -17.1, -20.9, 1.9, 3.1, 0, 2.25, 6, 'stone', ASYM);
  add(-22.1, 1.9, -20.9, 3.1, 0, 2.25, 'stone', ASYM);
  stairs('z', 1.9, -1.9, -22.1, -20.9, 2.25, 4.5, 6, 'stone', ASYM);
  add(-22.1, -3.1, -20.9, -1.9, 0, 4.5, 'stone', ASYM);
  stairs('x', -20.9, -17.1, -3.1, -1.9, 4.5, 6.75, 6, 'stone', ASYM);
  add(-17.1, -3.1, -15.9, -1.9, 0, 6.75, 'stone', ASYM);
  stairs('z', -1.9, 1.9, -17.1, -15.9, 6.75, 9, 6, 'stone', { asym: true, thickness: 0.4 });
  slabs(-22.1, -3.1, -15.9, 3.1, 8.6, 9, 'stone', [[-17.1, -3.1, -15.9, 1.9]], ASYM); // open above the last landing too: stepping up needs headroom
  // Belfry: shoot-through parapet, corner posts, tiled cap, a bronze bell.
  add(-22.6, 3.3, -15.4, 3.6, 9, 10.1, 'plasterWhite', SYM);
  add(-22.6, -3.3, -22.3, 3.3, 9, 10.1, 'plasterWhite');
  add(-15.7, -3.3, -15.4, 3.3, 9, 10.1, 'plasterWhite');
  for (const x of [-22.6, -16]) add(x, 3, x + 0.6, 3.6, 10.1, 12.5, 'brick', SYM);
  add(-23, -4, -15, 4, 12.5, 13, 'terracotta');
  add(-22, -3, -16, 3, 13, 13.8, 'terracotta', { deco: true });
  add(-20.8, -1.8, -17.2, 1.8, 13.8, 14.6, 'terracotta', { deco: true });
  add(-19.5, -0.5, -18.5, 0.5, 11, 12.2, 'bronze', { deco: true });
  lights.push({ pos: [-19, 11.6, 0], color: '#ffd59a', intensity: 10, distance: 14 });

  // --- Fountain and piazza furniture ------------------------------------------------
  add(-3.5, 3, 3.5, 3.5, 0, 0.8, 'stone', SYM);
  add(-3.5, -3, -3, 3, 0, 0.8, 'stone');
  add(3, -3, 3.5, 3, 0, 0.8, 'stone');
  add(-3, -3, 3, 3, 0.05, 0.5, 'water', DECO);
  add(-1.2, -1.2, 1.2, 1.2, 0, 4.5, 'stone');
  add(-0.6, -0.6, 0.6, 0.6, 4.5, 5.6, 'bronze', { deco: true });
  add(1, 9, 3.6, 10.2, 0, 2.3, 'wood', SYM);
  add(0.6, 9.2, 1, 10, 0.2, 0.9, 'darkMetal', { ...DECO, sym: true });
  add(-3.8, 12, -1, 13.2, 0, 2.6, 'wood', SYM);
  add(-4.1, 11.7, -0.7, 13.5, 2.6, 2.72, 'clothAlt', SYM);
  add(-12, 8, -8, 9.2, 0, 0.7, 'stone', SYM);
  add(-11.8, 8.2, -8.2, 9, 0.7, 1.45, 'hedge', SYM);
  add(9, 5, 13, 6.2, 0, 0.7, 'stone', SYM);
  add(9.2, 5.2, 12.8, 6, 0.7, 1.45, 'hedge', SYM);
  add(-13.5, 13, -11, 13.7, 0, 0.55, 'wood', SYM);
  add(14, 12.5, 16.4, 14.5, 0, 1.2, 'crate', SYM);
  for (const [x, z] of [[-9, 14.5], [16, 3.5]]) {
    add(x - 0.1, z - 0.1, x + 0.1, z + 0.1, 0, 4.2, 'darkMetal', SYM);
    add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 4.2, 4.6, 'lamp', { ...DECO, sym: true });
    lights.push({ pos: [x, 4, z], color: '#ffd59a', intensity: 20, distance: 20 }, { pos: [x, 4, -z], color: '#ffd59a', intensity: 20, distance: 20 });
  }

  // --- Casa Alba: two storeys, balcony over the piazza ---------------------------------
  wall('x', 33.5, 34, 5, 21, 0, 7.4, 'ochre', [{ a: 11, b: 13.5, y1: 0, y2: 2.6 }], SYM);
  wall('x', 18, 18.5, 5, 21, 0, 3.6, 'ochre', [{ a: 8, b: 10.4, y1: 0, y2: 2.6 }, { a: 14, b: 18, y1: 1, y2: 2.4, glass: true }], SYM);
  wall('x', 18, 18.5, 5, 21, 3.6, 7.4, 'ochre', [{ a: 7, b: 10, y1: 5, y2: 6.4, glass: true }, { a: 11.2, b: 13.2, y1: 4, y2: 6.4 }, { a: 15, b: 19, y1: 5, y2: 6.4, glass: true }], SYM);
  wall('z', 5, 5.5, 18.5, 33.5, 0, 3.6, 'ochre', [{ a: 20, b: 23, y1: 1, y2: 2.4, glass: true }], SYM);
  wall('z', 5, 5.5, 18.5, 33.5, 3.6, 7.4, 'ochre', [{ a: 21, b: 24, y1: 5, y2: 6.4, glass: true }], SYM);
  wall('z', 20.5, 21, 18.5, 33.5, 0, 3.6, 'ochre', [{ a: 27, b: 29.4, y1: 0, y2: 2.6 }], SYM);
  wall('z', 20.5, 21, 18.5, 33.5, 3.6, 7.4, 'ochre', [{ a: 23, b: 26, y1: 5, y2: 6.4, glass: true }], SYM);
  stairs('z', 32.2, 25.6, 5.5, 7.5, 0, 4, 12, 'wood', SYM);
  slabs(5.5, 18.5, 20.5, 33.5, 3.6, 4, 'wood', [[5.5, 25.6, 7.5, 32.2]], SYM);
  add(7.5, 25.6, 7.62, 32.2, 4, 5, 'wood', SYM);
  add(5.5, 32.2, 7.62, 32.32, 4, 5, 'wood', SYM);
  add(5, 18, 21, 34, 7.4, 7.8, 'stone', SYM);
  add(4.6, 17.6, 21.4, 34.4, 7.8, 8.15, 'terracotta', { deco: true, sym: true });
  add(7, 16.4, 19, 18, 3.6, 4, 'stone', SYM);
  add(7, 16.4, 19, 16.5, 4, 5, 'wood', SYM);
  add(7, 16.5, 7.1, 18, 4, 5, 'wood', SYM);
  add(18.9, 16.5, 19, 18, 4, 5, 'wood', SYM);
  add(7.4, 16.6, 7.9, 17.9, 0, 3.6, 'stone', SYM);
  add(18.1, 16.6, 18.6, 17.9, 0, 3.6, 'stone', SYM);
  add(14, 28, 17, 29.2, 0, 0.9, 'wood', SYM);
  add(9, 21, 10.2, 24, 0, 1.2, 'crate', SYM);
  add(15, 22, 18.5, 23, 4, 5.1, 'wood', SYM);
  add(10, 29.5, 12.5, 31, 4, 5.2, 'crate', SYM);
  lights.push({ pos: [13, 3, 26], color: '#ffd59a', intensity: 12, distance: 15 }, { pos: [13, 3, -26], color: '#ffd59a', intensity: 12, distance: 15 });
  lights.push({ pos: [13, 6.8, 26], color: '#ffd59a', intensity: 10, distance: 14 }, { pos: [13, 6.8, -26], color: '#ffd59a', intensity: 10, distance: 14 });

  // A wayside shrine on the centre line closes the long view down the east lane.
  add(21, -1.1, 22.7, 1.1, 0, 3.2, 'stone');
  add(20.8, -1.3, 22.9, 1.3, 3.2, 3.5, 'terracotta', { deco: true });

  // --- East lane market between the casa and the canal -----------------------------------
  stall(22, 21.5, 'cloth');
  stall(23.5, 8.5, 'clothAlt');
  add(26, 30, 28.2, 32, 0, 1.2, 'crate', SYM);
  add(21.5, 14, 23.5, 15.2, 0, 1.1, 'stone', SYM);
  add(30, 12, 31.6, 13.6, -2.4, -1.2, 'crate', SYM);
  add(29.2, 20, 30.4, 22.4, -2.4, -1.3, 'wood', SYM);
  lights.push({ pos: [30.8, -0.9, 16], color: '#9fd8ff', intensity: 9, distance: 15 }, { pos: [30.8, -0.9, -16], color: '#9fd8ff', intensity: 9, distance: 15 });

  const signs = [
    { text: 'CAMPANILE', pos: [0, 5, 37.95], face: 'north', size: 1.2, color: '#6ce6d1' },
    { text: 'CAMPANILE', pos: [0, 5, -37.95], face: 'south', size: 1.2, color: '#ff7148' },
    { text: 'CASA ALBA', pos: [13, 3.1, 17.95], face: 'north', size: 0.6, color: '#f2f0ea' },
    { text: 'CASA ALBA', pos: [13, 3.1, -17.95], face: 'south', size: 0.6, color: '#f2f0ea' },
    { text: 'BOTTEGA', pos: [-4.95, 4.4, 28], face: 'east', size: 0.8, color: '#ffc857' },
    { text: 'BOTTEGA', pos: [-4.95, 4.4, -28], face: 'east', size: 0.8, color: '#ffc857' },
  ];

  const zones = mirrorZones([
    { name: 'Belfry', box: [-22.6, 8.5, -3.6, -15.4, 20, 3.6] },
    { name: 'Tower Stairs', box: [-22.6, -1, -3.6, -15.4, 8.5, 3.6] },
    { name: 'Canal Stairs', box: [22.4, -3, -2.1, 29, 1.5, 2.1] },
    { name: 'A Canal', box: [28, -3, 2.1, 35, -0.6, 35] },
    { name: 'Fountain', box: [-5, -1, -5, 5, 20, 5] },
    { name: 'Wellhouse', box: [-36, -1, -5, -25, 20, 5] },
    { name: 'A Court', box: [-36, -1, 39.5, 35, 20, 46] },
    { name: 'A Balcony', box: [7, 3.5, 16.4, 19, 20, 18] },
    { name: 'A Casa Upper', box: [5, 3.5, 18, 21, 20, 34] },
    { name: 'A Casa', box: [5, -1, 18, 21, 3.5, 34] },
    { name: 'A Arcade', box: [-25, -1, 17.5, -5, 4, 22] },
    { name: 'A Alley', box: [-36, -1, 5, -25, 20, 38] },
    { name: 'A Market', box: [21, -1, 5, 29, 20, 38] },
    { name: 'A Main', box: [-5, -1, 17.5, 5, 20, 38] },
    { name: 'A Street', box: [-36, -1, 34, 35, 20, 39.5] },
    { name: 'Tower Yard', box: [-25, -1, -17.5, -16, 20, 17.5] },
    { name: 'Piazza', box: [-16, -1, -17.5, 29, 20, 17.5] },
  ]);

  const interest = mirrorPoints([
    [0, 0, 30], [0, 0, 14], [-8, 0, 12], [8, 0, 8], [14, 0, 10], [-15, 0, 20], [-10, 0, 20], [-30, 0, 30], [-30, 0, 16], [-27, 0, 4],
    [13, 0, 26], [13, 4, 26], [13, 4, 17.2], [17, 4, 22], [25, 0, 30], [25, 0, 12], [31, -2.4, 16], [31, -2.4, 5], [-23.5, 0, 8], [-21.5, 9, 0], [20, 0, 0], [-13, 0, 0],
  ]);
  const lanes = [
    [[-29, 0, 36], [-27.5, 0, 6]], [[-29, 0, 36], [-21.5, 9, 0]], [[0, 0, 34], [-8, 0, 10]], [[0, 0, 34], [13, 4, 17.2]],
    [[24, 0, 36], [25, 0, 8]], [[24, 0, 36], [31, -2.4, 6]], [[0, 0, 34], [-15, 0, 20]], [[24, 0, 36], [13, 4, 24]],
  ];

  return {
    id: 'campanile', title: 'Campanile',
    bounds: { minX: -36, maxX: 35, minZ: -46, maxZ: 46, minY: -3, maxY: 15 },
    boxes: b.boxes, barriers: gateBarriers(gates, 38.5, 39), lights, signs, zones, interest, lanes,
    env: { backdrop: 'town', variants: ['noon', 'dusk', 'night', 'storm'] },
    spawnZones: { A: [-36, 37.9, 35, 46], B: [-36, -46, 35, -37.9] },
    spawns: teamSpawns([-6, -2, 2, 6], 43),
    dummies: [],
  };
}
