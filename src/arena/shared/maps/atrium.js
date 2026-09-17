// HALCYON ATRIUM — small. A marble gallery hall open to the sky, flanked by two
// mezzanines with glass railings and joined by a skybridge. Close, fast, vertical.
import { createBuilder, SYM, DECO, gateBarriers, mirrorZones, mirrorPoints, teamSpawns } from '../mapkit.js';

export function buildAtrium() {
  const b = createBuilder();
  const { add, slabs, wall, glassRun, stairs } = b;
  const lights = [];
  const SHADOW_DECO = { deco: true };

  // --- Shell ------------------------------------------------------------
  add(-27, -38, 27, 38, -0.5, 0, 'marble');
  add(-13, -26.5, 13, 26.5, 0, 0.02, 'marbleDark', DECO);
  add(-11.5, -25, 11.5, 25, 0.02, 0.04, 'marble', DECO);
  add(-27, -38, -25, 38, 0, 10, 'plasterWhite');
  add(25, -38, 27, 38, 0, 10, 'plasterWhite');
  add(-27, 36, 27, 38, 0, 10, 'plasterWhite', SYM);
  // Roof over both wings and the lobbies; the hall itself is open to the weather.
  add(-27, -27.5, -13, 27.5, 8, 8.4, 'concrete');
  add(13, -27.5, 27, 27.5, 8, 8.4, 'concrete');
  add(-27, 26.5, 27, 38, 8, 8.4, 'concrete', SYM);
  for (const z of [4, 12, 20]) add(-13, z - 0.25, 13, z + 0.25, 8, 8.5, 'darkMetal', { ...SHADOW_DECO, sym: true });
  add(-0.25, -26.5, 0.25, 26.5, 8, 8.5, 'darkMetal', SHADOW_DECO);

  // --- Lobby walls with three gates --------------------------------------
  const gates = [[-21, -17], [-3, 3], [17, 21]];
  [[-25, -21], [-17, -3], [3, 17], [21, 25]].forEach(([x1, x2]) => add(x1, 26.5, x2, 27.5, 0, 8, 'plasterWhite', SYM));
  gates.forEach(([x1, x2]) => {
    add(x1, 26.5, x2, 27.5, 3.7, 8, 'plasterWhite', SYM);
    add(x1, 26.4, x2, 26.5, 3.45, 3.7, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  });
  add(-9, 33.2, -4, 34.4, 0, 1.15, 'marbleDark', SYM);
  add(5, 29.5, 9, 30.6, 0, 1.15, 'marbleDark', SYM);
  add(-22, 33, -19.5, 35, 0, 1.2, 'crate', SYM);
  add(14, 33.5, 16.4, 35.5, 0, 2.2, 'darkMetal', SYM);

  // --- Mezzanines ---------------------------------------------------------
  const stairHoles = (side) => (side < 0 ? [[-25, 16.8, -23, 24], [-25, -24, -23, -16.8]] : [[23, 16.8, 25, 24], [23, -24, 25, -16.8]]);
  slabs(-25, -24, -13, 24, 3.6, 4, 'marble', stairHoles(-1));
  slabs(13, -24, 25, 24, 3.6, 4, 'marble', stairHoles(1));
  for (const side of [-1, 1]) {
    const outer = side * 25, inner = side * 13;
    const railX = side * 13.3;
    // Stairs hug the outer wall at both ends of each mezzanine.
    stairs('z', 24, 16.8, Math.min(outer, side * 23), Math.max(outer, side * 23), 0, 4, 12, 'marbleDark', SYM);
    add(side * 23 - 0.06, 16.8, side * 23 + 0.06, 24, 4, 5, 'darkMetal', SYM);
    // Columns carry the roof; between them the railing is glass, except one marble bay per half.
    for (const z of [2, 9, 16.5, 24]) add(inner - 0.3 * side - 0.3, z - 0.3, inner - 0.3 * side + 0.3, z + 0.3, 0, 8, 'marbleDark', SYM);
    glassRun('z', railX, 2.35, 8.65, 4, 5.1, SYM);
    add(railX - 0.15, 9.35, railX + 0.15, 16.15, 4, 5.1, 'marble', SYM);
    glassRun('z', railX, 16.85, 23.65, 4, 5.1, SYM);
    glassRun('x', 24, Math.min(side * 23, inner), Math.max(side * 23, inner) - (side < 0 ? 0.7 : 0) + (side > 0 ? 0 : 0), 4, 5.1, SYM);
    // Cover up top.
    add(outer - side * 0.2, 4, outer - side * 1.4, 9, 4, 5.1, 'marbleDark', SYM);
    add(side * 17, 11, side * 18.2, 12.2, 4, 5.2, 'marble', SYM);
    add(side * 20, 19.5, side * 21.6, 20.6, 4, 4.55, 'wood', SYM);
    // Ground-floor galleries: staggered partitions so nobody sees gate to gate.
    wall('x', 13.85, 14.15, Math.min(outer, side * 18), Math.max(outer, side * 18), 0, 3.6, 'plasterWhite', [], SYM);
    wall('x', 5.85, 6.15, Math.min(side * 20, side * 13.6), Math.max(side * 20, side * 13.6), 0, 3.6, 'plasterWhite', [], SYM);
    // Display cases: marble plinth with a breakable glass vitrine.
    for (const [x, z] of [[side * 16, 10], [side * 22, 3], [side * 15.5, 20.5]]) {
      add(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0, 0.9, 'marble', SYM);
      add(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0.9, 1.9, 'glass', { glass: true, sym: true });
    }
    add(side * 21, 9, side * 24, 9.8, 0, 0.5, 'wood', SYM);
    add(side * 14.4, 0.8, side * 16.4, 2.8, 0, 1.2, 'crate', SYM);
    lights.push({ pos: [side * 19, 3.1, 11], color: '#ffe9c4', intensity: 16, distance: 17 }, { pos: [side * 19, 3.1, -11], color: '#ffe9c4', intensity: 16, distance: 17 });
    add(side * 19 - 1.2, 10.9, side * 19 + 1.2, 11.1, 3.5, 3.6, 'lamp', { ...DECO, sym: true });
  }

  // --- Skybridge and the plinth that carries it ------------------------------
  add(-13, -1.5, 13, 1.5, 3.6, 4, 'marble');
  add(-2, -2, 2, 2, 0, 3.6, 'marbleDark');
  for (const z of [-1.42, 1.42]) {
    glassRun('x', z, -12.7, -4, 4, 5.1);
    add(-4, z - 0.05, 4, z + 0.05, 4, 5.1, 'bronze');
    glassRun('x', z, 4, 12.7, 4, 5.1);
  }
  // Hanging sculpture (decoration only).
  [[-1.4, 6.4, 0.5], [0.3, 7.2, -0.4], [1.2, 6.8, 0.9], [-0.4, 8, 0.2]].forEach(([x, y, z]) => add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, y, y + 0.7, 'bronze', SHADOW_DECO));

  // --- Reflecting pool around the plinth --------------------------------------
  add(-7, 4.6, 7, 5, 0, 0.5, 'marbleDark', SYM);
  add(-7, -4.6, -6.6, 4.6, 0, 0.5, 'marbleDark');
  add(6.6, -4.6, 7, 4.6, 0, 0.5, 'marbleDark');
  add(-6.6, -4.6, 6.6, 4.6, 0.04, 0.28, 'water', DECO);

  // --- Hall cover: thin exhibit panels (shoot-through) and banner columns ------
  add(4, 11.9, 11, 12.1, 0, 2.7, 'plasterWhite', SYM);
  add(-11, 17.9, -4, 18.1, 0, 2.7, 'plasterWhite', SYM);
  add(-9.1, 7, -8.9, 13, 0, 2.7, 'plasterWhite', SYM);
  add(8.9, 15.5, 9.1, 22, 0, 2.7, 'plasterWhite', SYM);
  add(2.1, 13.5, 3.1, 14.5, 0, 4.2, 'marbleDark', SYM);
  add(-3.1, 13.5, -2.1, 14.5, 0, 4.2, 'marbleDark', SYM);
  add(2.15, 13.45, 3.05, 13.5, 1.2, 3.8, 'neonPink', { ...DECO, sym: true, mirrorMat: 'neonCyan' });
  // Reception screen: nobody sees into (or out of) the centre gate from across the hall.
  add(-4.6, 22.2, 4.6, 22.6, 0, 3.2, 'marbleDark', SYM);
  add(-4.6, 22.1, 4.6, 22.2, 2.2, 2.5, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  add(-6, 23.2, -3.5, 24.2, 0, 0.55, 'wood', SYM);
  add(5.2, 6.2, 6.4, 7.4, 0, 0.9, 'marble', SYM);
  add(5.3, 6.3, 6.3, 7.3, 0.9, 1.9, 'glass', { glass: true, sym: true });
  lights.push({ pos: [0, 5.5, 32], color: '#cfe6ff', intensity: 18, distance: 20 }, { pos: [0, 5.5, -32], color: '#ffd9b0', intensity: 18, distance: 20 });

  const signs = [
    { text: 'HALCYON', pos: [0, 5.6, 26.45], face: 'north', size: 1.3, color: '#6ce6d1' },
    { text: 'HALCYON', pos: [0, 5.6, -26.45], face: 'south', size: 1.3, color: '#ff7148' },
    { text: 'WEST GALLERY', pos: [-24.95, 2.9, 0], face: 'east', size: 0.55, color: '#f2f0ea' },
    { text: 'EAST GALLERY', pos: [24.95, 2.9, 0], face: 'west', size: 0.55, color: '#f2f0ea' },
  ];

  const zones = mirrorZones([
    { name: 'Skybridge', box: [-13, 3.5, -1.6, 13, 20, 1.6] },
    { name: 'Pool', box: [-7.5, -1, -5.5, 7.5, 3.5, 5.5] },
    { name: 'Hall Centre', box: [-13, -1, -5.5, 13, 3.5, 5.5] },
    { name: 'West Mezzanine', box: [-25, 3.5, -24.5, -13, 20, 24.5] },
    { name: 'East Mezzanine', box: [13, 3.5, -24.5, 25, 20, 24.5] },
    { name: 'A Lobby', box: [-25, -1, 27.5, 25, 20, 36] },
    { name: 'A Stairs West', box: [-25, -1, 16.8, -23, 3.5, 26.5] },
    { name: 'A Stairs East', box: [23, -1, 16.8, 25, 3.5, 26.5] },
    { name: 'A West Gallery', box: [-25, -1, 6, -13, 3.5, 26.5] },
    { name: 'A East Gallery', box: [13, -1, 6, 25, 3.5, 26.5] },
    { name: 'West Gallery', box: [-25, -1, -6, -13, 3.5, 6] },
    { name: 'East Gallery', box: [13, -1, -6, 25, 3.5, 6] },
    { name: 'A Hall', box: [-13, -1, 5.5, 13, 20, 26.5] },
  ]);

  const interest = mirrorPoints([
    [0, 0, 19], [-8, 0, 15], [8, 0, 9], [-10, 0, 3], [10, 0, 3], [-19, 0, 20], [19, 0, 20], [-23, 0, 10], [16, 0, 3],
    [-19, 4, 12], [19, 4, 12], [-16, 4, 20], [16, 4, 5], [-19, 4, 0], [19, 4, 0], [-6, 4, 0], [6, 4, 0], [0, 0, 8],
  ]);
  const lanes = [
    [[-19, 0, 24], [-22, 0, 2]], [[19, 0, 24], [22, 0, 2]], [[6, 0, 24], [9, 0, 6]], [[-6, 0, 24], [-9, 0, 4]],
    [[-24, 0, 25], [-19, 4, 10]], [[24, 0, 25], [19, 4, 10]], [[-24, 0, 25], [-6, 4, 0]], [[24, 0, 25], [6, 4, 0]],
  ];

  return {
    id: 'atrium', title: 'Halcyon Atrium',
    bounds: { minX: -25, maxX: 25, minZ: -36, maxZ: 36, minY: -1, maxY: 12 },
    boxes: b.boxes, barriers: gateBarriers(gates, 26.85, 27.15), lights, signs, zones, interest, lanes,
    env: { backdrop: 'skyline', variants: ['noon', 'dusk', 'night', 'storm'] },
    spawnZones: { A: [-25, 26.4, 25, 36], B: [-25, -36, 25, -26.4] },
    spawns: teamSpawns([-6, -2, 2, 6], 32),
    dummies: [],
  };
}
