// LINE 9 — small. An underground station: two platforms, two parked trains you can run through,
// and a track bed down the middle. Everything is close, and the train walls are only sheet metal.
import { createBuilder, SYM, DECO, arenaShell, mirrorZones, mirrorPoints } from '../mapkit.js';

export function buildLine9() {
  const b = createBuilder();
  const { add, wall, stairs } = b;
  const gates = [[-16, -10], [-2.4, 2.4], [10, 16]];
  const shell = arenaShell(b, { halfW: 18, halfL: 38, lobby: 8, gates, floor: 'tunnel', wallMat: 'tunnel', lobbyMat: 'concrete', wallH: 6.4, lobbyH: 6, spawnXs: [-5, -1.7, 1.7, 5] });
  const lights = [];
  add(-20, -40, 20, 40, 6, 6.6, 'concrete');             // the street above

  for (const side of [-1, 1]) {
    const lo = (a, c) => Math.min(side * a, side * c), hi = (a, c) => Math.max(side * a, side * c);
    // --- Platform, a metre up, with steps from the lobby end and from the track bed --------
    add(lo(8, 18), -26, hi(8, 18), 26, 0, 1, 'paving');
    stairs('z', 27.8, 26, lo(10, 16), hi(10, 16), 0, 1, 3, 'paving', SYM);
    stairs('x', side * 6.2, side * 8, 17, 19.4, 0, 1, 3, 'paving', SYM);
    add(lo(8, 8.3), -26, hi(8, 8.3), 26, 1, 1.02, 'hazard', DECO);
    // Kiosk closes the straight run down the platform; pillars carry the roof.
    add(lo(10, 16.5), -3, hi(10, 16.5), 3, 1, 4.2, 'tunnel');
    add(lo(10, 16.5), -3.1, hi(10, 16.5), -3, 2.6, 3, 'neonPink', DECO);
    add(lo(10, 16.5), 3, hi(10, 16.5), 3.1, 2.6, 3, 'neonPink', DECO);
    for (const z of [9, 15, 21]) add(side * 12.5 - 0.4, z - 0.4, side * 12.5 + 0.4, z + 0.4, 1, 6, 'concrete', SYM);
    add(lo(14.5, 17.5), 11, hi(14.5, 17.5), 12, 1, 1.5, 'wood', SYM);           // bench
    add(lo(9, 10.6), 22.5, hi(9, 10.6), 24.5, 1, 2.2, 'crate', SYM);
    // --- Train: floor level with the platform, sheet-metal sides, doors and windows ---------
    add(lo(2.4, 6), -12, hi(2.4, 6), 12, 0, 1, 'darkMetal');
    add(lo(2.4, 6), -12, hi(2.4, 6), 12, 3.5, 3.8, 'hull');
    const openings = [{ a: -10, b: -8.2, y1: 2, y2: 3, glass: true }, { a: -6.4, b: -4.6, y1: 1, y2: 3.2 }, { a: -2.6, b: -1, y1: 2, y2: 3, glass: true }, { a: 1, b: 2.6, y1: 2, y2: 3, glass: true }, { a: 4.6, b: 6.4, y1: 1, y2: 3.2 }, { a: 8.2, b: 10, y1: 2, y2: 3, glass: true }];
    wall('z', lo(5.85, 6), hi(5.85, 6), -12, 12, 1, 3.5, 'hull', openings);
    wall('z', lo(2.4, 2.55), hi(2.4, 2.55), -12, 12, 1, 3.5, 'hull', openings.filter((o) => o.glass));
    add(lo(2.4, 6), 11.85, hi(2.4, 6), 12, 1, 3.5, 'hull', SYM);                 // cab ends …
    add(lo(3.4, 5), 9, hi(3.4, 5), 9.15, 1, 3.5, 'hull', SYM);                   // … and a bulkhead inside
    for (const z of [5.5, -5.5]) add(lo(6, 8), z - 0.9, hi(6, 8), z + 0.9, 0.8, 1, 'metal');   // boarding plates
    add(lo(3, 5.4), -0.6, hi(3, 5.4), 0.6, 1, 1.5, 'teal');                      // seats
    lights.push({ pos: [side * 13, 5.4, 12], color: '#e8f1ff', intensity: 18, distance: 18 }, { pos: [side * 13, 5.4, -12], color: '#e8f1ff', intensity: 18, distance: 18 }, { pos: [side * 4.2, 3.2, 0], color: '#ffe2b0', intensity: 8, distance: 9 });
    add(side * 13 - 1.4, 11.9, side * 13 + 1.4, 12.1, 5.9, 6, 'lamp', { ...DECO, sym: true });
  }
  // --- Track bed: a works trolley and two tool carts stagger the view down the middle ----------
  add(-0.6, -1.5, 2.4, 1.5, 0, 2.6, 'hazard');
  add(-2.4, 5, 0.6, 8, 0, 2.6, 'rust', SYM);
  add(-1.2, 16, 1.2, 17.2, 0, 1.2, 'crate', SYM);
  add(-2.4, 23.5, 2.4, 24.3, 0, 1.1, 'sandbag', SYM);
  for (const x of [-1.6, 1.6]) add(x - 0.08, -30, x + 0.08, 30, 0, 0.12, 'rust', DECO);
  lights.push({ pos: [0, 5.2, 20], color: '#9fd8ff', intensity: 14, distance: 16 }, { pos: [0, 5.2, -20], color: '#ffc9a0', intensity: 14, distance: 16 });

  const signs = [
    { text: 'LINE 9', pos: [0, 4.8, shell.zWall - 0.05], face: 'north', size: 1, color: '#6ce6d1' },
    { text: 'LINE 9', pos: [0, 4.8, -shell.zWall + 0.05], face: 'south', size: 1, color: '#ff7148' },
    { text: 'WESTBOUND', pos: [-17.95, 4.2, 0], face: 'east', size: 0.5, color: '#f2f0ea' },
    { text: 'EASTBOUND', pos: [17.95, 4.2, 0], face: 'west', size: 0.5, color: '#f2f0ea' },
  ];
  const zones = mirrorZones([
    { name: 'West Train', box: [-6, 0.9, -12, -2.4, 4, 12] }, { name: 'East Train', box: [2.4, 0.9, -12, 6, 4, 12] },
    shell.lobbyZone,
    { name: 'A West Platform', box: [-18, 0.5, 3, -6, 20, 30] }, { name: 'A East Platform', box: [6, 0.5, 3, 18, 20, 30] },
    { name: 'West Kiosk', box: [-18, 0.5, -3, -6, 20, 3] }, { name: 'East Kiosk', box: [6, 0.5, -3, 18, 20, 3] },
    { name: 'A Track Bed', box: [-8, -1, 3, 8, 3, 30] }, { name: 'Works Trolley', box: [-8, -1, -3, 8, 3, 3] },
  ]);
  const interest = mirrorPoints([
    [0, 0, 27], [1.5, 0, 12], [-1.5, 0, 3.5], [0, 0, 20], [-13, 1, 20], [13, 1, 14], [-9, 1, 8], [9, 1, 5], [-17.3, 1, 0], [17.3, 1, 0],
    [-4.2, 1, 7], [4.2, 1, 3], [-4.2, 1, 0], [4.2, 1, 0], [-7, 0, 18.2], [7, 0, 22],
  ]);
  const lanes = [
    [[-13, 0, 29], [-17.3, 1, 0]], [[13, 0, 29], [17.3, 1, 0]], [[0, 0, 29], [1.5, 0, 3.5]], [[-13, 0, 29], [-4.2, 1, 2]], [[13, 0, 29], [4.2, 1, 2]],
  ];
  return {
    id: 'line9', title: 'Line 9', bounds: { ...shell.bounds, maxY: 7 }, boxes: b.boxes, barriers: shell.barriers, lights, signs, zones, interest, lanes,
    env: { backdrop: 'skyline', variants: ['night', 'dusk', 'storm'] },
    spawnZones: shell.spawnZones, spawns: shell.spawns, dummies: [],
  };
}
