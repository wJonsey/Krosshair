// FROSTBITE STATION: medium to large. An arctic research base: a helipad on stilts in
// the middle, lab modules with walkable roofs, snow berms across open ground and an
// ice trench that runs the length of the west side under the pump house.
import { createBuilder, SYM, DECO, gateBarriers, mirrorZones, mirrorPoints, teamSpawns } from '../mapkit.js';

export function buildFrostbite() {
  const b = createBuilder();
  const { add, slabs, wall, stairs } = b;
  const lights = [];

  // --- Snowfield with the trench cut out --------------------------------------
  slabs(-52, -66, 52, 66, -0.5, 0, 'snow', [[-34, -40, -28, 40], [-28, -2, -22, 2]]);
  add(-35, -41, -21, 41, -3.5, -3, 'ice');
  add(-35, -41, -34, 41, -3.5, -0.5, 'ice');
  add(-28, 2, -27, 41, -3.5, -0.5, 'ice', SYM);
  add(-35, 40, -27, 41, -3.5, -0.5, 'ice', SYM);
  add(-28, 2, -21, 3, -3.5, -0.5, 'ice', SYM);
  add(-22, -2, -21, 2, -3.5, -0.5, 'ice');
  stairs('z', 34, 40, -34, -28, -3, 0, 8, 'ice', SYM);
  stairs('x', -28, -22, -2, 2, -3, 0, 8, 'ice');
  // Grated walkways cross the trench; from below they are a ceiling with gaps either side.
  for (const z of [12, 28]) add(-34, z - 1.5, -28, z + 1.5, -0.3, 0, 'darkMetal', SYM);
  add(-33, 18, -31, 20, -3, -1.8, 'crate', SYM);
  add(-30.5, 5, -28.5, 8, -3, -1.6, 'ice', SYM);
  add(-33.5, 24, -32, 26.5, -3, -1.9, 'ice', SYM);
  lights.push({ pos: [-31, -1, 20], color: '#8fd3ff', intensity: 12, distance: 18 }, { pos: [-31, -1, -20], color: '#8fd3ff', intensity: 12, distance: 18 });
  add(-31.1, 19, -30.9, 21, -0.62, -0.5, 'neonCyan', { ...DECO, sym: true });

  // --- Perimeter ridge ------------------------------------------------------------
  add(-54, -66, -50, 66, 0, 8, 'rock');
  add(50, -66, 54, 66, 0, 8, 'rock');
  add(-54, 64, 54, 68, 0, 8, 'rock', SYM);
  add(-54, -66, -50, 66, 8, 8.6, 'snow', { deco: true });
  add(50, -66, 54, 66, 8, 8.6, 'snow', { deco: true });

  // --- Spawn: a double-stacked container wall with three gates ------------------------
  const gates = [[-38, -32], [-4, 4], [26, 32]];
  const segments = [[-50, -38, 'hazard'], [-32, -18, 'teal'], [-18, -4, 'hull'], [4, 16, 'hazard'], [16, 26, 'hull'], [32, 50, 'teal']];
  segments.forEach(([x1, x2, mat]) => add(x1, 50, x2, 52.5, 0, 5.8, mat, SYM));
  gates.forEach(([x1, x2]) => {
    add(x1, 50, x2, 52.5, 3.7, 5.8, 'darkMetal', SYM);
    add(x1, 49.9, x2, 50, 3.45, 3.7, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  });
  add(-50, 49.8, 50, 52.7, 5.8, 6.1, 'snow', { deco: true, sym: true });
  add(-14, 58, -11, 61, 0, 1.2, 'crate', SYM);
  add(10, 55, 15, 57.4, 0, 2.4, 'hull', SYM);
  add(-27, 56, -24, 58, 0, 1.2, 'snowBerm', SYM);
  lights.push({ pos: [0, 5, 56], color: '#cfe6ff', intensity: 20, distance: 24 }, { pos: [0, 5, -56], color: '#ffd9b0', intensity: 20, distance: 24 });

  // --- The Pad: helipad on stilts, stairs east and west -----------------------------
  add(-9, -9, 9, 9, 2.6, 3, 'concrete');
  for (const [x, z] of [[-8.5, -8.5], [7.5, -8.5], [-8.5, 7.5], [7.5, 7.5]]) add(x, z, x + 1, z + 1, 0, 2.6, 'darkMetal');
  add(-2, -2, 2, 2, 0, 2.6, 'hazard');
  stairs('x', -17, -9, -2, 2, 0, 3, 8, 'darkMetal');
  stairs('x', 17, 9, -2, 2, 0, 3, 8, 'darkMetal');
  add(-7, -7, 7, 7, 3, 3.02, 'hazard', DECO);
  add(-5.5, -5.5, 5.5, 5.5, 3.02, 3.04, 'concrete', DECO);
  // Helicopter.
  add(-3, -1.5, 3, 1.5, 3.5, 5.3, 'hull');
  add(-2.4, -1.2, -1.6, 1.2, 3, 3.5, 'darkMetal');
  add(1.6, -1.2, 2.4, 1.2, 3, 3.5, 'darkMetal');
  add(-4.4, -1, -3, 1, 3.9, 4.9, 'glass', { glass: true });
  add(3, -0.4, 8, 0.4, 4.2, 4.9, 'hull');
  add(7.4, -0.15, 8, 0.15, 4.9, 6.2, 'hazard');
  add(-0.3, -0.3, 0.3, 0.3, 5.3, 5.9, 'darkMetal', { deco: true });
  add(-6.5, -0.25, 6.5, 0.25, 5.9, 6, 'darkMetal', { deco: true });
  add(-0.25, -6.5, 0.25, 6.5, 5.9, 6, 'darkMetal', { deco: true });
  add(-8.6, 6, -6.6, 8.6, 3, 4.2, 'crate', SYM);
  add(5.6, 6.8, 8.6, 8.6, 3, 4.15, 'hull', SYM);
  add(-6, 4.5, -3, 7, 0, 1.2, 'snowBerm', SYM);
  add(3.5, 3.5, 6.5, 5.5, 0, 1.2, 'crate', SYM);
  lights.push({ pos: [0, 2.2, 5], color: '#ffb36b', intensity: 12, distance: 16 }, { pos: [0, 2.2, -5], color: '#ffb36b', intensity: 12, distance: 16 });

  // --- Pump house and weather hut close the west lane on the centre line --------------------
  add(-43, -3, -35.5, 3, 0, 3.2, 'hull');
  add(-35.5, -3, -27, 3, 0, 3.4, 'hazard');
  add(-43.3, -3.3, -26.7, 3.3, 3.4, 3.7, 'snow', { deco: true });
  add(-47, -1, -45, 1, 0, 1.4, 'concrete');
  add(-46.2, -0.2, -45.8, 0.2, 1.4, 16, 'darkMetal');
  add(-46.4, -0.4, -45.6, 0.4, 16, 16.5, 'neonOrange', DECO);

  // --- Lab module (east): enterable, roof reached by outside stairs -------------------------
  wall('x', 20, 20.5, 16, 36, 0, 3.2, 'hull', [{ a: 18, b: 23, y1: 1.1, y2: 2.3, glass: true }, { a: 25, b: 27.4, y1: 0, y2: 2.6 }, { a: 29, b: 34, y1: 1.1, y2: 2.3, glass: true }], SYM);
  wall('x', 29.5, 30, 16, 36, 0, 3.2, 'hull', [], SYM);
  wall('z', 16, 16.5, 20.5, 29.5, 0, 3.2, 'hull', [{ a: 24, b: 26.4, y1: 0, y2: 2.6 }], SYM);
  wall('z', 35.5, 36, 20.5, 29.5, 0, 3.2, 'hull', [{ a: 24, b: 26.4, y1: 0, y2: 2.6 }], SYM);
  add(16, 20, 36, 30, 3.2, 3.6, 'hull', SYM);
  wall('z', 25.8, 26.1, 20.5, 29.5, 0, 3.2, 'hull', [{ a: 26.5, b: 29, y1: 0, y2: 2.6 }], SYM);
  add(18, 27.6, 22, 28.6, 0, 0.95, 'hull', SYM);
  add(30, 21.4, 31, 25, 0, 2, 'darkMetal', SYM);
  add(32.5, 27.8, 34.5, 29, 0, 1.2, 'crate', SYM);
  stairs('x', 36, 28, 30, 32, 0, 3.6, 10, 'darkMetal', SYM);
  add(16, 20, 36, 20.3, 3.6, 4.1, 'hull', SYM);
  add(16, 20.3, 16.3, 30, 3.6, 4.1, 'hull', SYM);
  add(35.7, 20.3, 36, 30, 3.6, 4.1, 'hull', SYM);
  add(19, 23, 22, 25.4, 3.6, 4.75, 'darkMetal', SYM);
  add(29, 21.4, 31.4, 23, 3.6, 4.8, 'hull', SYM);
  add(24.8, 26, 25.2, 26.4, 3.6, 6, 'darkMetal', SYM); // solid: the post stands on the walkable deck
  add(24, 25.4, 26, 27, 6, 6.2, 'hull', SYM);
  lights.push({ pos: [21, 2.7, 25], color: '#d6ecff', intensity: 12, distance: 14 }, { pos: [21, 2.7, -25], color: '#d6ecff', intensity: 12, distance: 14 });
  lights.push({ pos: [31, 2.7, 25], color: '#d6ecff', intensity: 12, distance: 14 }, { pos: [31, 2.7, -25], color: '#d6ecff', intensity: 12, distance: 14 });

  // --- Vehicle bay (west of centre): open to the north -----------------------------------------
  add(-20, 24, -19.5, 36, 0, 4, 'hull', SYM);
  add(-6.5, 24, -6, 36, 0, 4, 'hull', SYM);
  add(-20, 35.5, -6, 36, 0, 4, 'hull', SYM);
  add(-20.3, 23.7, -5.7, 36.3, 4, 4.4, 'hull', SYM);
  add(-17, 27, -14.4, 33, 0.4, 2.4, 'hazard', SYM);
  add(-17.2, 27.4, -14.2, 32.6, 0, 0.6, 'darkMetal', SYM);
  add(-11, 31, -8, 34, 0, 1.2, 'crate', SYM);
  add(-10.6, 31.4, -8.6, 33.4, 1.2, 2.2, 'crate', SYM);
  lights.push({ pos: [-13, 3.4, 30], color: '#ffd9b0', intensity: 14, distance: 16 }, { pos: [-13, 3.4, -30], color: '#ffd9b0', intensity: 14, distance: 16 });

  // --- Fuel farm and pipe rack (east) ---------------------------------------------------------
  add(40, 5, 46, 11, 0, 4.2, 'hazard', SYM);
  add(40, 13, 46, 19, 0, 4.2, 'hull', SYM);
  add(39, 4, 47, 20, 0, 0.3, 'concrete', SYM); // a step up, not a floor to sink through
  for (const x of [38, 42.5, 47]) add(x - 0.2, -4, x + 0.2, 4, 2.4, 2.8, 'darkMetal'); // solid: low enough to jump into
  add(37.5, 3.6, 47.5, 4, 0, 2.8, 'darkMetal', SYM);

  // --- Open ground: drifts, berms, sleds. Tall drifts stop a rifle round, thin berms do not. ---------
  add(1, 24, 4.6, 29, 0, 2.4, 'hazard', SYM);
  add(1.2, 24.4, 4.4, 28.6, 2.4, 2.7, 'snow', SYM); // the drift's crest, so it stops a round like the rest of it
  add(-5, 36, -1.5, 39, 0, 2.5, 'snowBerm', SYM);
  add(6, 40, 12, 41.2, 0, 1.25, 'snowBerm', SYM);
  add(-12, 14, -8, 17, 0, 1.3, 'snowBerm', SYM);
  add(10, 13, 15, 14.2, 0, 1.25, 'snowBerm', SYM);
  add(22, 8, 27, 11, 0, 2.3, 'snowBerm', SYM);
  add(30, 38, 34, 39.2, 0, 1.25, 'snowBerm', SYM);
  add(38, 28, 40.4, 30.4, 0, 1.2, 'crate', SYM);
  add(42, 40, 47, 42.4, 0, 2.4, 'teal', SYM);
  add(-46, 18, -42, 21, 0, 2.2, 'snowBerm', SYM);
  add(-41, 34, -38.5, 36.5, 0, 1.2, 'crate', SYM);
  add(-47.5, 30, -45, 32.5, 0, 1.3, 'snowBerm', SYM);
  add(-26, 14, -23, 15.2, 0, 1.25, 'snowBerm', SYM);
  add(-25, 40, -21, 43, 0, 2.2, 'snowBerm', SYM);
  add(14, 44, 17, 46.4, 0, 1.2, 'crate', SYM);
  // Containers parked in front of the side gates break the long corner-to-corner diagonals.
  add(21.5, 44, 29, 46.5, 0, 2.6, 'teal', SYM);
  add(-35.5, 44, -27.5, 46.5, 0, 2.6, 'hazard', SYM);

  const signs = [
    { text: 'FROSTBITE STATION', pos: [0, 4.9, 49.95], face: 'north', size: 1.1, color: '#6ce6d1' },
    { text: 'FROSTBITE STATION', pos: [0, 4.9, -49.95], face: 'south', size: 1.1, color: '#ff7148' },
    { text: 'LAB 1', pos: [26, 2.95, 19.95], face: 'north', size: 0.6, color: '#1d242c' },
    { text: 'LAB 2', pos: [26, 2.95, -19.95], face: 'south', size: 0.6, color: '#1d242c' },
    { text: 'PUMP HOUSE', pos: [-26.95, 2.6, 0], face: 'east', size: 0.55, color: '#1d242c' },
  ];

  const zones = mirrorZones([
    { name: 'Helipad', box: [-9, 2.5, -9, 9, 20, 9] },
    { name: 'Under Pad', box: [-9, -1, -9, 9, 2.5, 9] },
    { name: 'Pad Stairs', box: [-17, -1, -2, 17, 4, 2] },
    { name: 'Pump House', box: [-43, -0.4, -6, -21, 20, 6] },
    { name: 'Trench Stairs', box: [-28, -4, -3, -21, -0.4, 3] },
    { name: 'A Trench', box: [-35, -4, 0, -27, -0.4, 41] },
    { name: 'A Base', box: [-50, -1, 52.5, 50, 20, 64] },
    { name: 'A Lab Roof', box: [16, 3.5, 20, 36, 20, 32] },
    { name: 'A Lab', box: [16, -1, 20, 36, 3.5, 30] },
    { name: 'A Vehicle Bay', box: [-20, -1, 24, -6, 20, 36] },
    { name: 'A Fuel Farm', box: [36, -1, 3, 50, 20, 21] },
    { name: 'A West Flats', box: [-50, -1, 3, -35, 20, 50] },
    { name: 'A East Flats', box: [36, -1, 21, 50, 20, 50] },
    { name: 'A Yard', box: [-27, -1, 36, 36, 20, 50] },
    { name: 'A Midfield', box: [-27, -1, 9, 36, 20, 36] },
    { name: 'Midfield', box: [-27, -1, -9, 50, 20, 9] },
  ]);

  const interest = mirrorPoints([
    [0, 0, 44], [0, 0, 20], [-10, 0, 20], [8, 0, 18], [0, 3, 6], [-6, 3, 0], [6, 3, 0], [0, 0, 6], [26, 0, 25], [20, 0, 24], [33, 0, 24],
    [24, 3.6, 25], [33, 3.6, 22], [26, 0, 16], [43, 0, 24], [44, 0, 2], [38, 0, 36], [-13, 0, 28], [-13, 0, 20], [-24, 0, 10],
    [-31, -3, 20], [-31, -3, 4], [-42, 0, 26], [-46, 0, 8], [-39, 0, 44], [20, 0, 0], [-19, 0, 5],
  ]);
  const lanes = [
    [[-35, 0, 47], [-44, 0, 8]], [[-35, 0, 47], [-31, -3, 20]], [[-31, -3, 30], [-25, 0, 0]], [[0, 0, 46], [-10, 0, 18]],
    [[0, 0, 46], [6, 3, 0]], [[29, 0, 47], [26, 0, 25]], [[29, 0, 47], [24, 3.6, 25]], [[29, 0, 47], [44, 0, 3]], [[0, 0, 46], [8, 0, 16]],
  ];

  return {
    id: 'frostbite', title: 'Frostbite Station',
    bounds: { minX: -50, maxX: 50, minZ: -64, maxZ: 64, minY: -4, maxY: 12 },
    boxes: b.boxes, barriers: gateBarriers(gates, 51, 51.5), lights, signs, zones, interest, lanes,
    env: { backdrop: 'mountains', variants: ['snow', 'noon', 'night', 'dusk'] },
    spawnZones: { A: [-50, 50.9, 50, 64], B: [-50, -64, 50, -50.9] },
    spawns: teamSpawns([-7.5, -2.5, 2.5, 7.5], 58),
    dummies: [],
  };
}
