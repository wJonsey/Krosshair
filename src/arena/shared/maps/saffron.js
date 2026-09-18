// SAFFRON MARKET: small to medium. A covered souk: cloth and plank stalls that hide you and
// stop nothing, two flat-roofed houses to climb, and a kiosk in the middle of the square.
import { createBuilder, SYM, DECO, arenaShell, flight, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildSaffron() {
  const b = createBuilder();
  const { add, wall, stall } = b;
  const gates = [[-21, -17], [-3, 3], [17, 21]];
  const shell = arenaShell(b, { halfW: 24, halfL: 36, lobby: 8, gates, floor: 'cobble', wallMat: 'adobe', lobbyMat: 'ochre', wallH: 8 });
  const lights = [];

  // --- Kiosk in the square, with two low walls that close the diagonals ---------------
  add(-4, -2, 4, 2, 0, 3.4, 'adobe');
  add(-5, -3, 5, 3, 3.4, 3.55, 'clothAlt');
  for (const side of [-1, 1]) add(Math.min(side * 7, side * 12), -1, Math.max(side * 7, side * 12), 1, 0, 2.8, 'ochre');

  // --- Houses: one per side in each half, roof at 4 m ------------------------------------
  for (const side of [-1, 1]) {
    const x1 = Math.min(side * 13, side * 22), x2 = Math.max(side * 13, side * 22);
    const inner = side * 13, outer = side * 22;
    wall('x', 13.7, 14, x1, x2, 0, 3.6, 'rosePlaster', [{ a: Math.min(side * 14, side * 16), b: Math.max(side * 14, side * 16), y1: 0, y2: 2.6 }], SYM);
    wall('x', 5, 5.3, x1, x2, 0, 3.6, 'rosePlaster', [], SYM);
    wall('z', Math.min(inner, inner + side * 0.3), Math.max(inner, inner + side * 0.3), 5, 14, 0, 3.6, 'rosePlaster', [{ a: 8, b: 10, y1: 0, y2: 2.6 }, { a: 11, b: 12.6, y1: 1.1, y2: 2.3, glass: true }], SYM);
    wall('z', Math.min(outer, outer - side * 0.3), Math.max(outer, outer - side * 0.3), 5, 14, 0, 3.6, 'rosePlaster', [], SYM);
    add(x1, 5, x2, 14, 3.6, 4, 'adobe', SYM);
    // Parapet with firing gaps.
    add(x1, 5, x2, 5.3, 4, 5, 'adobe', SYM);
    for (const [z1, z2] of [[5.3, 8], [10.5, 14]]) add(Math.min(inner, inner + side * 0.3), z1, Math.max(inner, inner + side * 0.3), z2, 4, 5, 'adobe', SYM);
    // Outside stair up the south face, hugging the perimeter.
    const top = flight(b, 'z', 21.2, -1, Math.min(side * 22, side * 23.9), Math.max(side * 22, side * 23.9), 4, 'adobe', SYM);
    add(Math.min(side * 22, side * 23.9), top - 4, Math.max(side * 22, side * 23.9), top, 3.6, 4, 'adobe', SYM); // landing beside the roof
    add(side * 16, 8, side * 18.5, 9.2, 0, 0.9, 'wood', SYM);
    lights.push({ pos: [side * 17.5, 3, 9.5], color: '#ffd29a', intensity: 12, distance: 12 }, { pos: [side * 17.5, 3, -9.5], color: '#ffd29a', intensity: 12, distance: 12 });
  }

  // --- Stalls and street cover ---------------------------------------------------------------
  stall(-10, 8, 'cloth');
  stall(5, 11, 'clothAlt');
  stall(-8, 18, 'clothAlt');
  stall(6, 21, 'cloth');
  add(-4.5, 23, 4.5, 23.6, 0, 3, 'ochre', SYM);          // screen in front of the centre gate
  add(-1, 14.5, 1, 16.5, 0, 1.1, 'crate', SYM);
  add(-0.6, 14.9, 0.6, 16.1, 1.1, 2, 'crate', SYM);
  add(-16, 18, -13.5, 19.5, 0, 1.2, 'crate', SYM);
  add(11, 24, 14, 25, 0, 1.2, 'sandbag', SYM);
  add(-12.5, 24.5, -9.5, 25.5, 0, 1.2, 'sandbag', SYM);
  add(-2.4, 5.6, -0.8, 7.2, 0, 1, 'terracotta', SYM);
  // Awning poles and strings of cloth over the street (decoration).
  for (const z of [10, 20]) add(-12, z, 12, z + 0.12, 5.2, 5.3, 'cloth', { ...DECO, sym: true });
  lights.push({ pos: [0, 4.6, 12], color: '#ffc27a', intensity: 18, distance: 18 }, { pos: [0, 4.6, -12], color: '#ffc27a', intensity: 18, distance: 18 });

  const signs = [
    { text: 'SAFFRON MARKET', pos: [0, 4.4, shell.zWall - 0.05], face: 'north', size: 0.8, color: '#6ce6d1' },
    { text: 'SAFFRON MARKET', pos: [0, 4.4, -shell.zWall + 0.05], face: 'south', size: 0.8, color: '#ff7148' },
  ];
  const zones = mirrorZones([
    { name: 'Kiosk', box: [-12, -1, -4, 12, 20, 4] },
    shell.lobbyZone,
    { name: 'A West Roof', box: [-24, 3.5, 5, -13, 20, 22] }, { name: 'A East Roof', box: [13, 3.5, 5, 24, 20, 22] },
    { name: 'A West House', box: [-22, -1, 5, -13, 3.5, 14] }, { name: 'A East House', box: [13, -1, 5, 22, 3.5, 14] },
    { name: 'A Stalls', box: [-13, -1, 4, 13, 20, 28] },
    { name: 'A West Alley', box: [-24, -1, 4, -13, 3.5, 28] }, { name: 'A East Alley', box: [13, -1, 4, 24, 3.5, 28] },
    { name: 'West Alley', box: [-24, -1, -4, -12, 20, 4] }, { name: 'East Alley', box: [12, -1, -4, 24, 20, 4] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 19], [-6, 0, 13], [9, 0, 16], [-3, 0, 5], [3, 0, 9], [-17, 0, 20], [17, 0, 24], [-18, 0, 2], [18, 0, 2],
    [-17, 0, 9.5], [17, 0, 9.5], [-17, 4, 9], [17, 4, 9], [-23, 4, 12], [23, 4, 12], [-6, 0, 0], [6, 0, 0],
  ]);
  const lanes = [
    [[-19, 0, 26], [-18, 0, 1]], [[19, 0, 26], [18, 0, 1]], [[0, 0, 26], [6, 0, 4]], [[0, 0, 26], [-6, 0, 4]],
    [[19, 0, 26], [17, 4, 9]], [[-19, 0, 26], [-17, 4, 9]],
  ];
  return {
    id: 'saffron', title: 'Saffron Market', bounds: shell.bounds, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'town', variants: ['noon', 'dusk', 'haze', 'night'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
