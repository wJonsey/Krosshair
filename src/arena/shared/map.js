// Map geometry, authored as axis-aligned boxes so the exact same data drives
// rendering, movement, bullets, bot navigation and the minimap.
// Convention: +x east, +z south, +y up. Alpha spawns south (z > 0), Bravo north.
// Kestrel Yard is mirrored across z = 0 so both sides play identically.

import { buildIsland } from './maps/island.js';
import { createBuilder, SYM, DECO, deconflict } from './mapkit.js';
import { buildAtrium } from './maps/atrium.js';
import { buildCampanile } from './maps/campanile.js';
import { buildFrostbite } from './maps/frostbite.js';
import { buildDustline } from './maps/dustline.js';
import { buildFoundry } from './maps/foundry.js';
import { buildBreakwater } from './maps/breakwater.js';
import { buildSaffron } from './maps/saffron.js';
import { buildTimberline } from './maps/timberline.js';
import { buildLine9 } from './maps/line9.js';
import { buildTerrace } from './maps/terrace.js';
import { buildRavelin } from './maps/ravelin.js';

function buildYard() {
  const b = createBuilder();
  const { add, slabs, wall, stairs } = b;
  const lights = [];
  const signs = [];

  // --- Ground, with openings above the four underpass stairwells -------
  const stairHoles = [[-2, 36, 2, 44], [-2, -44, 2, -36], [-30, -2, -22, 2], [24, -2, 32, 2]];
  slabs(-45, -61, 45, 61, -0.5, 0, 'asphalt', stairHoles);
  add(-28, -20, 24, 20, 0, 0.02, 'paving', DECO);
  add(-43.5, -59.5, -29, 59.5, 0, 0.02, 'gravel', DECO);
  add(28.2, 9.2, 43.8, 45.8, 0, 0.025, 'paving', { ...DECO, sym: true });
  add(-43.8, 48, 43.8, 59.8, 0, 0.02, 'concrete', { ...DECO, sym: true });

  // --- Underpass: a plus-shaped tunnel with a cistern at the junction ---
  const voids = [[-2, -44, 2, 44], [-30, -2, 32, 2], [-7, -7, 7, 7]];
  slabs(-32, -46, 34, 46, -3.4, -0.5, 'tunnel', voids);
  add(-32, -46, 34, 46, -4, -3.4, 'tunnel');
  stairs('z', 36, 44, -2, 2, -3.4, 0, 10, 'concrete', SYM);
  stairs('x', -22, -30, -2, 2, -3.4, 0, 10, 'concrete');
  stairs('x', 24, 32, -2, 2, -3.4, 0, 10, 'concrete');
  [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]].forEach(([x, z]) => add(x - 0.5, z - 0.5, x + 0.5, z + 0.5, -3.4, -0.5, 'concrete'));
  add(-6.4, 5.2, -4.2, 6.4, -3.4, -2.5, 'crate', SYM);
  add(4.6, -1, 5.8, 1, -3.4, -2.4, 'metal');
  for (const z of [12, 22, 32]) add(-0.12, z - 1, 0.12, z + 1, -0.58, -0.5, 'lamp', { ...DECO, sym: true });
  for (const x of [-26, -16, 12, 20]) add(x - 1, -0.12, x + 1, 0.12, -0.58, -0.5, 'lamp', DECO);
  add(-1, -1, 1, 1, -0.58, -0.5, 'neonCyan', DECO);
  lights.push({ pos: [0, -1.2, 0], color: '#6ce6d1', intensity: 14, distance: 16 });
  lights.push({ pos: [0, -1.1, 24], color: '#ffd9a0', intensity: 10, distance: 18 }, { pos: [0, -1.1, -24], color: '#ffd9a0', intensity: 10, distance: 18 });
  lights.push({ pos: [-16, -1.1, 0], color: '#ffd9a0', intensity: 10, distance: 16 }, { pos: [16, -1.1, 0], color: '#ffd9a0', intensity: 10, distance: 16 });
  // Rails around the stairwell openings.
  add(-2.35, 35.7, -2, 44, 0, 1.1, 'concrete', SYM);
  add(2, 35.7, 2.35, 44, 0, 1.1, 'concrete', SYM);
  add(-2.35, 35.7, 2.35, 36, 0, 1.1, 'concrete', SYM);
  add(-30, 2, -21.7, 2.35, 0, 1.1, 'concrete', SYM);
  add(-22, -2, -21.7, 2, 0, 1.1, 'concrete');
  add(24.5, 2, 32, 2.3, 0, 1.1, 'concrete', SYM);

  // --- Perimeter ------------------------------------------------------
  add(-45, -61, -44, 61, 0, 9, 'wall');
  add(44, -61, 45, 61, 0, 9, 'wall');
  add(-45, 60, 45, 61, 0, 9, 'wall', SYM);

  // --- Spawn walls with three gates -----------------------------------
  [[-44, -36], [-30, -4], [4, 30], [36, 44]].forEach(([x1, x2]) => add(x1, 46, x2, 47.5, 0, 5.5, 'concrete', SYM));
  [[-36, -30], [-4, 4], [30, 36]].forEach(([x1, x2]) => {
    add(x1, 46, x2, 47.5, 3.7, 5.5, 'concrete', SYM);
    add(x1, 45.9, x2, 46, 3.4, 3.7, 'neonCyan', { ...DECO, sym: true, mirrorMat: 'neonOrange' });
  });
  add(-14, 56, -11, 58.5, 0, 1.2, 'crate', SYM);
  add(-13.6, 56.4, -11.6, 58, 1.2, 2.2, 'crate', SYM);
  add(11, 50, 15, 52, 0, 1.4, 'metal', SYM);
  add(-24, 49, -21, 51.5, 0, 2.6, 'teal', SYM);
  add(22, 55, 26, 58, 0, 1.2, 'crate', SYM);

  // --- Depot (west block): enterable, stairs to a sniper roof ----------
  wall('x', 39.5, 40, -28, -9, 0, 3.6, 'brick', [{ a: -20, b: -17, y1: 0, y2: 2.6 }], SYM);
  wall('x', 20, 20.5, -28, -9, 0, 3.6, 'brick', [{ a: -23, b: -17, y1: 1, y2: 2.6, glass: true }, { a: -13.5, b: -11, y1: 0, y2: 2.6 }], SYM);
  wall('z', -9.5, -9, 20.5, 39.5, 0, 3.6, 'brick', [{ a: 23, b: 26, y1: 1, y2: 2.4, glass: true }, { a: 29, b: 31.5, y1: 0, y2: 2.6 }, { a: 34, b: 37, y1: 1, y2: 2.4, glass: true }], SYM);
  wall('z', -28, -27.5, 20.5, 39.5, 0, 3.6, 'brick', [{ a: 24, b: 26.5, y1: 0, y2: 2.6 }], SYM);
  stairs('z', 38, 29.6, -27.5, -25.5, 0, 4, 12, 'concrete', SYM);
  b.slabs(-28, 20, -9, 40, 3.6, 4, 'concrete', [[-27.5, 29.6, -25.5, 38]], SYM);
  add(-28, 20, -9, 20.4, 4, 5.15, 'concrete', SYM);
  add(-28, 39.6, -9, 40, 4, 5.15, 'concrete', SYM);
  add(-28, 20.4, -27.6, 39.6, 4, 5.15, 'concrete', SYM);
  add(-9.4, 20.4, -9, 39.6, 4, 5.15, 'concrete', SYM);
  add(-25.5, 29.6, -25.2, 38.3, 4, 5, 'metal', SYM);
  add(-27.6, 38, -25.2, 38.3, 4, 5, 'metal', SYM);
  add(-16.5, 27.5, -13.5, 30.5, 4, 5.25, 'metal', SYM);
  add(-21, 34, -19.5, 36.5, 4, 5.1, 'teal', SYM);
  add(-23.5, 31, -20, 31.9, 0, 2.2, 'metal', SYM);
  add(-16, 24.5, -14, 26.5, 0, 1.2, 'crate', SYM);
  add(-15.6, 33, -13.2, 35.2, 0, 1.3, 'crate', SYM);
  add(-18.4, 29.6, -17.6, 30.4, 0, 3.6, 'concrete', SYM);
  add(-19, 30, -17, 30.2, 3.4, 3.6, 'lamp', { ...DECO, sym: true });
  lights.push({ pos: [-18, 3, 30], color: '#ffd9a0', intensity: 12, distance: 16 }, { pos: [-18, 3, -30], color: '#ffd9a0', intensity: 12, distance: 16 });

  // --- Warehouses (east block) split by an alley -----------------------
  add(9, 32, 28, 40, 0, 6.5, 'brick', SYM);
  add(9, 20, 28, 28, 0, 5.5, 'plaster', SYM);
  add(9, 19.9, 28, 20, 4.6, 4.9, 'neonPink', { ...DECO, sym: true, mirrorMat: 'neonCyan' });
  add(20, 28.2, 22.4, 29.5, 0, 1.35, 'teal', SYM);
  add(12, 30.6, 13.2, 31.8, 0, 1.1, 'crate', SYM);

  // --- Main approach ---------------------------------------------------
  add(3.6, 23, 6.3, 25.4, 0, 2.5, 'teal', SYM);
  add(3.5, 25.4, 6.4, 30.5, 0.5, 3.2, 'metal', SYM);
  add(3.8, 26, 6.1, 29.8, 0, 0.5, 'wall', SYM);
  add(-7.5, 26, -4.2, 26.6, 0, 1.1, 'concrete', SYM);
  add(-6, 32.4, -2.8, 33, 0, 1.1, 'concrete', SYM);
  add(-8.4, 21, -4.2, 21.4, 0, 2.9, 'brick', SYM);
  add(5.5, 41.5, 8, 43, 0, 1.2, 'crate', SYM);

  // --- Plaza -----------------------------------------------------------
  add(-3, -3, 3, 3, 0, 1.1, 'stone');
  add(-1.2, -1.2, 1.2, 1.2, 1.1, 8, 'stone');
  add(-1.5, -1.5, 1.5, 1.5, 8, 8.3, 'neonOrange', DECO);
  // Wing walls keep the gate-to-gate sightline closed at street level.
  add(-7.5, -0.35, -3, 0.35, 0, 3.1, 'stone');
  add(3, -0.35, 7.5, 0.35, 0, 3.1, 'stone');
  add(6.4, 15, 9, 15.4, 0, 3.3, 'brick', SYM);
  // Shoulders on the monument and a buffer stop between the tracks close the last standing-height lines.
  add(-3, -0.6, -1.2, 0.6, 1.1, 2.5, 'stone');
  add(1.2, -0.6, 3, 0.6, 1.1, 2.5, 'stone');
  add(-38, -1, -35, 1, 0, 2.5, 'rust');
  add(-12, 9, -6, 10.4, 0, 1.15, 'concrete', SYM);
  add(-11.8, 9.2, -6.2, 10.2, 1.15, 1.3, 'grass', { ...DECO, sym: true });
  add(6, 9, 12, 10.4, 0, 1.15, 'concrete', SYM);
  add(6.2, 9.2, 11.8, 10.2, 1.15, 1.3, 'grass', { ...DECO, sym: true });
  // Kiosk: thin wooden walls, so the long rifle punches straight through.
  add(-19, 7, -16, 7.12, 0, 2.7, 'wood', SYM);
  add(-19, 9.88, -16, 10, 0, 2.7, 'wood', SYM);
  add(-19, 7.12, -18.88, 9.88, 0, 2.7, 'wood', SYM);
  add(-16.12, 7.12, -16, 9.88, 0, 2.7, 'wood', SYM);
  add(-19.3, 6.7, -15.7, 10.3, 2.7, 2.82, 'cloth', SYM);
  add(14, 12.4, 18.4, 14.2, 0.3, 1.25, 'rust', SYM);
  add(15.2, 12.5, 17.4, 14.1, 1.25, 1.85, 'rust', SYM);
  add(10, 3.2, 13, 3.8, 0, 0.55, 'wood', SYM);
  add(-14.5, 15, -12, 17, 0, 1.2, 'crate', SYM);
  add(-14.2, 15.3, -12.6, 16.7, 1.2, 2.2, 'crate', SYM);
  [[-24, 16], [20, 16]].forEach(([x, z]) => {
    add(x - 0.12, z - 0.12, x + 0.12, z + 0.12, 0, 5, 'metal', SYM);
    add(x - 0.5, z - 0.25, x + 0.5, z + 0.25, 5, 5.2, 'lamp', { ...DECO, sym: true });
  });
  lights.push({ pos: [-24, 4.8, 16], color: '#ffd9a0', intensity: 22, distance: 22 }, { pos: [20, 4.8, -16], color: '#ffd9a0', intensity: 22, distance: 22 });

  // --- Rail yard (west lane) -------------------------------------------
  for (const x of [-40.4, -38.6, -34.4, -32.6]) add(x - 0.08, -59.5, x + 0.08, 59.5, 0.02, 0.16, 'metal', DECO);
  add(-41, 24, -38, 38, 0.55, 3.8, 'rust', SYM);
  add(-40.6, 25, -38.4, 27, 0, 0.55, 'wall', SYM);
  add(-40.6, 35, -38.4, 37, 0, 0.55, 'wall', SYM);
  add(-41, 6, -38, 20, 0.55, 1.1, 'metal', SYM);
  add(-40.6, 7, -38.4, 9, 0, 0.55, 'wall', SYM);
  add(-40.6, 17, -38.4, 19, 0, 0.55, 'wall', SYM);
  add(-40.5, 8, -38.5, 10, 1.1, 2.1, 'crate', SYM);
  add(-40.6, 14.5, -38.4, 17.5, 1.1, 2.4, 'crate', SYM);
  add(-41, -5, -38, 5, 0.55, 3.6, 'teal');
  add(-40.6, -4, -38.4, -2, 0, 0.55, 'wall');
  add(-40.6, 2, -38.4, 4, 0, 0.55, 'wall');
  add(-35, 12, -32, 24, 0.55, 3.8, 'teal', SYM);
  add(-34.6, 13, -32.4, 15, 0, 0.55, 'wall', SYM);
  add(-34.6, 21, -32.4, 23, 0, 0.55, 'wall', SYM);
  add(-32, 36, -29, 39, 0, 3, 'brick', SYM);
  add(-36.5, 41, -34, 43, 0, 1.2, 'crate', SYM);
  add(-31.5, 5, -29.5, 7, 0, 1.2, 'crate', SYM);

  // --- Market (east lane) ----------------------------------------------
  const stall = (x, z, cloth) => {
    add(x, z, x + 4, z + 1, 0, 1, 'wood', SYM);
    add(x, z + 1.9, x + 4, z + 2.02, 0, 2.5, 'wood', SYM);
    add(x - 0.3, z - 0.5, x + 4.3, z + 2.3, 2.5, 2.6, cloth, SYM);
    add(x - 0.1, z - 0.3, x + 0.02, z - 0.18, 0, 2.5, 'wood', SYM);
    add(x + 3.98, z - 0.3, x + 4.1, z - 0.18, 0, 2.5, 'wood', SYM);
  };
  stall(29.5, 12.5, 'cloth');
  stall(38, 18.5, 'clothAlt');
  stall(30, 25, 'clothAlt');
  stall(38.5, 31.5, 'cloth');
  stall(31, 38, 'cloth');
  add(35.5, 12, 37, 13.5, 0, 1.2, 'crate', SYM);
  add(41.5, 25, 43.5, 27.5, 0, 1.2, 'crate', SYM);
  add(41.8, 25.3, 43.2, 27, 1.2, 2.3, 'crate', SYM);
  add(33.5, 43, 36, 44.5, 0, 1.1, 'concrete', SYM);
  // String lights over the market and work lamps in the rail yard keep night rounds readable.
  add(28.3, 28.4, 43.7, 28.5, 3.3, 3.36, 'lamp', { ...DECO, sym: true });
  add(-43.7, 22, -43.6, 23.2, 3.6, 3.9, 'lamp', { ...DECO, sym: true });
  lights.push({ pos: [36, 3.1, 28.4], color: '#ffcf8a', intensity: 26, distance: 24 }, { pos: [36, 3.1, -28.4], color: '#ffcf8a', intensity: 26, distance: 24 });
  lights.push({ pos: [-42.6, 3.7, 22.6], color: '#cfe4ff', intensity: 30, distance: 26 }, { pos: [-42.6, 3.7, -22.6], color: '#cfe4ff', intensity: 30, distance: 26 });
  lights.push({ pos: [0, 4.6, 45], color: '#6ce6d1', intensity: 18, distance: 20 }, { pos: [0, 4.6, -45], color: '#ff7148', intensity: 18, distance: 20 });

  // --- Office (centre east): glass-fronted overwatch over the plaza -----
  // West face: ground windows and the long upper gallery.
  wall('z', 24, 24.5, -9, 9, 0, 3.4, 'plaster', [{ a: -7, b: -3.5, y1: 1, y2: 2.5, glass: true }, { a: 3.5, b: 7, y1: 1, y2: 2.5, glass: true }]);
  wall('z', 24, 24.5, -9, 9, 3.4, 7, 'plaster', [{ a: -7.5, b: -4.5, y1: 4.8, y2: 6.3, glass: true }, { a: -3.5, b: -0.5, y1: 4.8, y2: 6.3, glass: true }, { a: 0.5, b: 3.5, y1: 4.8, y2: 6.3, glass: true }, { a: 4.5, b: 7.5, y1: 4.8, y2: 6.3, glass: true }]);
  wall('x', 8.5, 9, 24.5, 40, 0, 3.4, 'plaster', [{ a: 30, b: 33, y1: 0, y2: 2.6 }], SYM);
  wall('x', 8.5, 9, 24.5, 40, 3.4, 7, 'plaster', [{ a: 33, b: 36.5, y1: 4.8, y2: 6.3, glass: true }], SYM);
  wall('z', 39.5, 40, -8.5, 8.5, 0, 7, 'plaster', [{ a: -0.9, b: 0.9, y1: 0, y2: 2.6 }]);
  slabs(24.5, -8.5, 39.5, 8.5, 3.4, 3.8, 'concrete', [[37, 1, 39.5, 7.4], [37, -7.4, 39.5, -1]]);
  stairs('z', 7.4, 1, 37, 39.5, 0, 3.8, 12, 'concrete', SYM);
  add(36.7, 1, 37, 8.5, 3.8, 4.8, 'metal', SYM);
  add(24, -9, 40, 9, 7, 7.4, 'concrete');
  add(27.5, 5.2, 29, 8, 3.8, 5, 'metal', SYM);
  add(31, -1.2, 34, 1.2, 3.8, 4.7, 'wood');
  add(33.5, 4.5, 35.5, 6, 0, 1.2, 'crate', SYM);
  add(26, 3, 27.2, 7.4, 0, 0.9, 'wood', SYM);
  add(24.6, -8.4, 24.75, 8.4, 3.2, 3.4, 'neonCyan', DECO);
  lights.push({ pos: [31, 2.8, 0], color: '#bfe9ff', intensity: 12, distance: 16 }, { pos: [30, 6.4, 0], color: '#bfe9ff', intensity: 12, distance: 16 });
  add(41, 4, 43.4, 6.4, 0, 1.35, 'teal', SYM);

  signs.push(
    { text: 'KESTREL YARD', pos: [0, 6.4, 46.05], face: 'north', size: 1.5, color: '#6ce6d1' },
    { text: 'KESTREL YARD', pos: [0, 6.4, -46.05], face: 'south', size: 1.5, color: '#ff7148' },
    { text: 'DEPOT A', pos: [-8.95, 3, 30], face: 'east', size: 0.9, color: '#f2f0ea' },
    { text: 'DEPOT B', pos: [-8.95, 3, -30], face: 'east', size: 0.9, color: '#f2f0ea' },
    { text: 'OFFICE', pos: [23.95, 3, 0], face: 'west', size: 0.9, color: '#f2f0ea' },
    { text: 'UNDERPASS', pos: [0, 1.4, 35.65], face: 'north', size: 0.5, color: '#ffc857' },
    { text: 'UNDERPASS', pos: [0, 1.4, -35.65], face: 'south', size: 0.5, color: '#ffc857' },
    { text: 'MARKET', pos: [28.05, 4.2, 24], face: 'east', size: 1, color: '#ec6a9e' },
    { text: 'MARKET', pos: [28.05, 4.2, -24], face: 'east', size: 1, color: '#ec6a9e' },
  );

  const barriers = [];
  [[-36, -30], [-4, 4], [30, 36]].forEach(([x1, x2], index) => {
    barriers.push({ id: `barrier-A${index}`, min: [x1, 0, 46.5], max: [x2, 3.7, 47], mat: 'barrier', barrier: true });
    barriers.push({ id: `barrier-B${index}`, min: [x1, 0, -47], max: [x2, 3.7, -46.5], mat: 'barrier', barrier: true });
  });

  const zones = [
    { name: 'Cistern', box: [-7, -5, -7, 7, -0.4, 7] },
    { name: 'A Tunnel', box: [-2.5, -5, 7, 2.5, -0.4, 45] },
    { name: 'B Tunnel', box: [-2.5, -5, -45, 2.5, -0.4, -7] },
    { name: 'West Tunnel', box: [-31, -5, -2.5, -7, -0.4, 2.5] },
    { name: 'East Tunnel', box: [7, -5, -2.5, 33, -0.4, 2.5] },
    { name: 'A Spawn', box: [-44, -1, 47.5, 44, 20, 60] },
    { name: 'B Spawn', box: [-44, -1, -60, 44, 20, -47.5] },
    { name: 'A Roof', box: [-28, 3.5, 20, -9, 20, 40] },
    { name: 'B Roof', box: [-28, 3.5, -40, -9, 20, -20] },
    { name: 'A Depot', box: [-28, -1, 20, -9, 3.5, 40] },
    { name: 'B Depot', box: [-28, -1, -40, -9, 3.5, -20] },
    { name: 'Office Top', box: [24, 3.3, -9, 40, 20, 9] },
    { name: 'Office Lobby', box: [24, -1, -9, 40, 3.3, 9] },
    { name: 'Back Alley', box: [40, -1, -9, 44, 20, 9] },
    { name: 'Monument', box: [-5, -1, -5, 5, 20, 5] },
    { name: 'A Alley', box: [9, -1, 28, 28, 20, 32] },
    { name: 'B Alley', box: [9, -1, -32, 28, 20, -28] },
    { name: 'A Street', box: [-44, -1, 40, 44, 20, 47.5] },
    { name: 'B Street', box: [-44, -1, -47.5, 44, 20, -40] },
    { name: 'A Main', box: [-9, -1, 20, 9, 20, 40] },
    { name: 'B Main', box: [-9, -1, -40, 9, 20, -20] },
    { name: 'A Rail', box: [-44, -1, 8, -28, 20, 40] },
    { name: 'B Rail', box: [-44, -1, -40, -28, 20, -8] },
    { name: 'Mid Rail', box: [-44, -1, -8, -28, 20, 8] },
    { name: 'A Market', box: [28, -1, 9, 44, 20, 40] },
    { name: 'B Market', box: [28, -1, -40, 44, 20, -9] },
    { name: 'Plaza', box: [-28, -1, -20, 28, 20, 20] },
  ];

  // Places worth walking to. Bots pick between these.
  const interest = [
    [0, 0, 30], [0, 0, -30], [-6, 0, 14], [6, 0, -14], [-18, 0, 12], [-18, 0, -12], [16, 0, 6], [16, 0, -6],
    [-18, 4, 24], [-18, 4, -24], [-12, 4, 36], [-12, 4, -36], [-20, 0, 28], [-20, 0, -28],
    [-36, 0, 22], [-36, 0, -22], [-36, 0, 0], [-30, 0, 40], [-30, 0, -40],
    [34, 0, 22], [34, 0, -22], [36, 0, 40], [36, 0, -40], [42, 0, 0],
    [32, 0, 5], [32, 0, -5], [26, 3.8, 3.8], [26, 3.8, -3.8], [30, 3.8, 0],
    [0, -3.4, 0], [0, -3.4, 20], [0, -3.4, -20], [-14, -3.4, 0], [14, -3.4, 0], [18, 0, 30], [18, 0, -30],
  ];

  // Opening routes for bots: [gate waypoint, forward waypoint], authored for the +z (south) side.
  const lanes = [
    [[-36, 0, 41], [-36, 0, 2]], [[-33, 0, 41], [-18, 4, 24]], [[0, 0, 30], [8, 0, -12]], [[-6, 0, 30], [-18, 0, 12]],
    [[34, 0, 41], [32, 0, 5]], [[34, 0, 41], [30, 3.8, 0]], [[0, -3.4, 20], [0, -3.4, 0]], [[0, -3.4, 20], [14, -3.4, 0]],
  ];

  return {
    id: 'yard',
    title: 'Kestrel Yard',
    bounds: { minX: -44, maxX: 44, minZ: -60, maxZ: 60, minY: -4, maxY: 12 },
    boxes: b.boxes,
    barriers,
    lights,
    signs,
    zones,
    interest,
    lanes,
    env: { backdrop: 'skyline', variants: ['dusk', 'night', 'storm', 'noon'], underground: true },
    spawnZones: { A: [-44, 46.4, 44, 60], B: [-44, -60, 44, -46.4] },
    spawns: {
      A: [-7.5, -2.5, 2.5, 7.5].map((x) => ({ x, y: 0, z: 54, yaw: 0 })),
      B: [-7.5, -2.5, 2.5, 7.5].map((x) => ({ x, y: 0, z: -54, yaw: Math.PI })),
    },
    dummies: [],
  };
}

function buildRange() {
  const b = createBuilder();
  const { add, wall, stairs } = b;
  add(-17, -112, 17, 15, -0.5, 0, 'paving');
  add(-17, -112, -16, 15, 0, 6, 'wall');
  add(16, -112, 17, 15, 0, 6, 'wall');
  add(-17, -113, 17, -112, 0, 6, 'wall');
  add(-17, 14, 17, 15, 0, 6, 'wall');
  // Firing line
  [[-14, -9], [-7, -2], [2, 7], [9, 14]].forEach(([x1, x2]) => add(x1, -1, x2, -0.5, 0, 1.05, 'concrete'));
  // Distance boards
  const signs = [{ text: 'PRACTICE RANGE', pos: [0, 4.6, 13.95], face: 'north', size: 1.2, color: '#6ce6d1' }];
  [10, 25, 50, 75, 100].forEach((distance) => {
    add(-15.8, -distance - 0.1, -15.2, -distance + 0.1, 0, 2.4, 'neonOrange', { deco: true });
    signs.push({ text: `${distance} M`, pos: [-15.1, 3.1, -distance], face: 'east', size: 0.8, color: '#ffc857' });
    add(-16, -distance - 0.05, 16, -distance + 0.05, 0, 0.02, 'neonCyan', DECO);
  });
  // Wallbang lesson: a plank wall and a brick wall.
  add(7, -16, 12, -15.88, 0, 2.4, 'wood');
  add(7, -30, 12, -29.5, 0, 2.4, 'brick');
  signs.push({ text: 'WOOD: SHOOT THROUGH', pos: [9.5, 2.9, -15.8], face: 'south', size: 0.4, color: '#f2f0ea' }, { text: 'BRICK: TOO THICK', pos: [9.5, 2.9, -29.4], face: 'south', size: 0.4, color: '#f2f0ea' });
  // Glass lesson
  wall('x', -18.1, -17.9, -12, -6, 0, 3, 'plaster', [{ a: -11, b: -7, y1: 0.9, y2: 2.5, glass: true }]);
  // Cover course in mid range
  add(-3, -38, 1, -37.4, 0, 1.1, 'concrete');
  add(3, -60, 6, -59.4, 0, 1.6, 'crate');
  add(-8, -85, -5, -84.4, 0, 1.2, 'concrete');
  // Tower
  stairs('z', 12, 5, 9, 11, 0, 4, 12, 'concrete');
  add(9, -2, 15.5, 5, 3.6, 4, 'concrete');
  add(11, 5, 15.5, 12, 3.6, 4, 'concrete');
  add(9, -2, 15.5, -1.6, 4, 5.3, 'concrete');
  add(8.6, -2, 9, 5, 4, 5.3, 'concrete');
  [[9.2, -1.8], [15, -1.8], [15, 11.5], [11.2, 11.5]].forEach(([x, z]) => add(x, z, x + 0.4, z + 0.4, 0, 3.6, 'metal'));
  return {
    id: 'range',
    title: 'Practice Range',
    bounds: { minX: -16, maxX: 16, minZ: -112, maxZ: 14, minY: -1, maxY: 12 },
    boxes: b.boxes,
    barriers: [],
    lights: [],
    signs,
    zones: [
      { name: 'Tower', box: [8, 3.5, -3, 16, 20, 13] },
      { name: 'Firing Line', box: [-16, -1, -3, 16, 20, 14] },
      { name: 'Short Range', box: [-16, -1, -30, 16, 20, -3] },
      { name: 'Mid Range', box: [-16, -1, -65, 16, 20, -30] },
      { name: 'Long Range', box: [-16, -1, -112, 16, 20, -65] },
    ],
    interest: [],
    spawns: { A: [{ x: 0, y: 0, z: 6, yaw: 0 }, { x: -3, y: 0, z: 6, yaw: 0 }, { x: 3, y: 0, z: 6, yaw: 0 }, { x: 5, y: 0, z: 8, yaw: 0 }], B: [] },
    dummies: [
      { x: -5, z: -10 }, { x: 1, z: -25 }, { x: 6, z: -50, patrol: [-2, 10] }, { x: -4, z: -75 }, { x: 2, z: -100, patrol: [-8, 8] },
      { x: 9.5, z: -18, crouch: true }, { x: 9.5, z: -32 }, { x: -9, z: -21 }, { x: -1, z: -39.5, crouch: true },
    ],
  };
}

// Playable arenas, in rotation order. Geometry is only built the first time a map is asked for.
export const MAP_INFO = [
  { id: 'yard', title: 'Kestrel Yard', size: 'Medium', players: '2v2 – 4v4', style: 'Industrial rail yard', blurb: 'Depot roofs, a glass office, an underpass.' },
  { id: 'atrium', title: 'Halcyon Atrium', size: 'Small', players: '1v1 – 2v2', style: 'Glass-and-marble gallery', blurb: 'Two mezzanines, a skybridge, and glass that won’t last.' },
  { id: 'campanile', title: 'Campanile', size: 'Small – medium', players: '2v2 – 3v3', style: 'Old-town piazza', blurb: 'A bell tower, arcades, a sunken canal walk.' },
  { id: 'frostbite', title: 'Frostbite Station', size: 'Medium – large', players: '3v3 – 4v4', style: 'Arctic research base', blurb: 'A helipad on stilts, lab roofs, an ice trench.' },
  { id: 'foundry', title: 'Foundry 4', size: 'Small – medium', players: '2v2 – 3v3', style: 'Steel mill floor', blurb: 'A dead furnace and two catwalks. Sheet metal stops nothing.' },
  { id: 'saffron', title: 'Saffron Market', size: 'Small – medium', players: '2v2 – 3v3', style: 'Covered souk', blurb: 'Stalls that stop nothing. Two roofs to climb.' },
  { id: 'breakwater', title: 'Breakwater', size: 'Medium – large', players: '3v3 – 4v4', style: 'Container quay', blurb: 'Long lanes between the stacks. A walkway over the crane.' },
  { id: 'line9', title: 'Line 9', size: 'Small', players: '1v1 – 2v2', style: 'Underground station', blurb: 'Two platforms, two trains, one track bed.' },
  { id: 'terrace', title: 'Skyline Terrace', size: 'Medium', players: '2v2 – 4v4', style: 'Tower rooftop', blurb: 'A greenhouse that won’t stay glass. Water tanks to climb.' },
  { id: 'ravelin', title: 'Ravelin', size: 'Large', players: '3v3 – 4v4', style: 'Desert fort', blurb: 'Ramparts, a keep, and a lot of open stone.' },
  { id: 'timberline', title: 'Timberline', size: 'Large', players: '3v3 – 4v4', style: 'Mountain logging camp', blurb: 'Rock stops everything. Hedges stop nothing.' },
  { id: 'dustline', title: 'Dustline Pass', size: 'Large', players: '3v3 – 4v4', style: 'Desert canyon outpost', blurb: 'One bridge, a dry riverbed, a mesa to climb.' },
];
export const MAP_IDS = MAP_INFO.map((info) => info.id);
// The royale island is built like any map but is never in MAP_INFO, so it never appears in the vote.
export const ROYALE_MAP = 'island';
const BUILDERS = { island: buildIsland, yard: buildYard, range: buildRange, atrium: buildAtrium, campanile: buildCampanile, frostbite: buildFrostbite, dustline: buildDustline, foundry: buildFoundry, breakwater: buildBreakwater, saffron: buildSaffron, timberline: buildTimberline, line9: buildLine9, terrace: buildTerrace, ravelin: buildRavelin };

const cache = new Map();
export function getMap(id = 'yard') {
  const key = BUILDERS[id] ? id : 'yard';
  // A few passes: nudging one box apart can leave it flush with a third.
  if (!cache.has(key)) { const built = BUILDERS[key](); for (let pass = 0; pass < 4 && deconflict(built.boxes); pass += 1); cache.set(key, built); }
  return cache.get(key);
}

export function zoneAt(map, x, y, z) {
  for (const zone of map.zones) {
    const [x1, y1, z1, x2, y2, z2] = zone.box;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2) return zone.name;
  }
  return map.title;
}
