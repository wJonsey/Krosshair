// KESTREL ISLAND: the battle royale map. 600 x 600 m, generated from a seed so the server and every
// browser build exactly the same island. Twelve named places with buildings to loot (houses with an
// upstairs, warehouses with a mezzanine, watchtowers, container yards, farms, hangars, a quarry, docks),
// open ground between them broken up by terraced hills, woods, rocks and field walls, roads with wrecks
// on them, a beach and cliffs.
// It is not an arena: nothing is mirrored and it never appears in the map vote.
import { createBuilder, DECO, flight } from '../mapkit.js';

export const ISLAND_HALF = 300;
const H = 3.3;          // storey height
// Bots navigate a 2 m grid whose points sit on odd whole metres. Buildings are centred on those points so
// every door (always centred on its building) has a grid point in it, and stairs are 3 m wide so a row of
// points always runs up them.
const odd = (v) => Math.round((v - 1) / 2) * 2 + 1;
const STAIR = 3;
const T = 0.3;          // wall thickness

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PLACES = [
  { name: 'Kestrel Docks', x: -205, z: 215, type: 'docks' },
  { name: 'Redwater', x: 15, z: 190, type: 'town' },
  { name: 'Old Mill', x: 205, z: 205, type: 'farm' },
  { name: 'Signal Hill', x: -205, z: 45, type: 'outpost' },
  { name: 'Crossroads', x: -80, z: 100, type: 'town' },
  { name: 'Central Yards', x: 10, z: 10, type: 'yard' },
  { name: 'Pine Hollow', x: 195, z: 30, type: 'town' },
  { name: 'Farmstead', x: 105, z: 115, type: 'farm' },
  { name: 'Lookout', x: -80, z: -75, type: 'outpost' },
  { name: 'Quarry', x: -195, z: -175, type: 'quarry' },
  { name: 'Hangar Row', x: 25, z: -195, type: 'hangars' },
  { name: 'Saltmarsh', x: 200, z: -185, type: 'town' },
];

export function buildIsland(seed = 7) {
  const b = createBuilder();
  const { add, wall, slabs } = b;
  const random = rng(seed);
  const range = (lo, hi) => lo + random() * (hi - lo);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const loot = [];
  const zones = [];
  const interest = [];
  const lights = [];
  const pads = [];
  // A jump pad: a low plate that throws you onto the roof beside it.
  const pad = (x, z) => { x = odd(x); z = odd(z); add(x - 0.9, z - 0.9, x + 0.9, z + 0.9, 0, 0.12, 'darkMetal'); pads.push([x, z]); claim(x - 1, z - 1, x + 1, z + 1); };
  const taken = [];
  const clear = (x1, z1, x2, z2, pad = 2) => !taken.some(([a, b2, c, d]) => x1 - pad < c && x2 + pad > a && z1 - pad < d && z2 + pad > b2);
  const claim = (x1, z1, x2, z2) => taken.push([x1, z1, x2, z2]);
  const spot = (x, y, z) => { loot.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]); };

  // --- Ground, beach, cliffs ---------------------------------------------------------------------
  const R = ISLAND_HALF;
  add(-R - 12, -R - 12, R + 12, R + 12, -0.5, 0, 'grass');
  for (const [x1, z1, x2, z2] of [[-R, -R, R, -R + 18], [-R, R - 18, R, R], [-R, -R + 18, -R + 18, R - 18], [R - 18, -R + 18, R, R - 18]]) add(x1, z1, x2, z2, 0, 0.02, 'sand', DECO);
  // Cliffs in uneven chunks so the edge doesn't read as a wall.
  for (let a = -R - 12; a < R + 12; a += 20) {
    for (const [x1, z1, x2, z2] of [[a, -R - 12, a + 20, -R], [a, R, a + 20, R + 12], [-R - 12, a, -R, a + 20], [R, a, R + 12, a + 20]]) add(x1, z1, x2, z2, 0, range(11, 19), 'rock');
  }

  // --- Building pieces ------------------------------------------------------------------------------
  // A house: one or two storeys, a door, windows on every side, stairs inside when it has an upstairs.
  function house(cx, cz, { w = 12, d = 9, floors = 1, mat = 'plaster', roof = 'terracotta', doorSide = random() < 0.5 ? -1 : 1 } = {}) {
    cx = odd(cx); cz = odd(cz);
    const x1 = cx - w / 2, x2 = cx + w / 2, z1 = cz - d / 2, z2 = cz + d / 2;
    add(x1, z1, x2, z2, 0, 0.1, 'wood');
    for (let f = 0; f < floors; f += 1) {
      const y0 = f * H + (f ? 0.2 : 0.1), y1 = (f + 1) * H;
      const windows = (a1, a2) => [{ a: a1 + 1.5, b: a1 + 2.9, y1: y0 + 1, y2: y0 + 2.1 }, { a: a2 - 2.9, b: a2 - 1.5, y1: y0 + 1, y2: y0 + 2.1 }];
      const door = { a: cx - 0.8, b: cx + 0.8, y1: y0, y2: y0 + 2.4 };
      wall('x', z1, z1 + T, x1, x2, y0, y1, mat, [...windows(x1, x2), ...(f === 0 && doorSide < 0 ? [door] : [])]);
      wall('x', z2 - T, z2, x1, x2, y0, y1, mat, [...windows(x1, x2), ...(f === 0 && doorSide > 0 ? [door] : [])]);
      wall('z', x1, x1 + T, z1 + T, z2 - T, y0, y1, mat, [{ a: cz - 0.7, b: cz + 0.7, y1: y0 + 1, y2: y0 + 2.1 }]);
      wall('z', x2 - T, x2, z1 + T, z2 - T, y0, y1, mat, [{ a: cz - 0.7, b: cz + 0.7, y1: y0 + 1, y2: y0 + 2.1 }]);
    }
    spot(cx - w / 4, 0.1, cz);
    spot(cx + w / 4, 0.1, cz - d / 5);
    if (floors > 1) {
      // Stairs along the back wall, away from the door, with the upstairs floor open above them.
      const back = doorSide > 0 ? -1 : 1;
      const l1 = back > 0 ? z2 - T - STAIR : z1 + T, l2 = back > 0 ? z2 - T : z1 + T + STAIR;
      // Starting 2.4 m in leaves a floor point at the foot of the stairs to walk onto them from.
      const end = flight(b, 'x', x1 + 2.4, 1, l1, l2, H + 0.2, 'wood');
      slabs(x1 + T, z1 + T, x2 - T, z2 - T, H, H + 0.2, 'wood', [[x1 + T, l1 - 0.05, end, l2 + 0.05]]);
      spot(cx + w / 4, H + 0.2, cz + (back > 0 ? -1 : 1) * d / 5);
      interest.push([cx + w / 4, H + 0.2, cz]);
    }
    add(x1 - 0.3, z1 - 0.3, x2 + 0.3, z2 + 0.3, floors * H, floors * H + 0.3, roof);
    interest.push([cx, 0.1, cz]);
    claim(x1, z1, x2, z2);
    if (floors > 1 && random() < 0.7) { pad(x2 + 2.2, cz + 2); spot(cx, floors * H + 0.3, cz); }
  }
  // A warehouse or hangar: big doors at both ends, a side door, a mezzanine with stairs, crates.
  function warehouse(cx, cz, { w = 28, d = 18, h = 7, mat = 'metal', roof = 'darkMetal', bigDoor = 5 } = {}) {
    cx = odd(cx); cz = odd(cz);
    const x1 = cx - w / 2, x2 = cx + w / 2, z1 = cz - d / 2, z2 = cz + d / 2, t = 0.4;
    add(x1, z1, x2, z2, 0, 0.1, 'concrete');
    const doors = (y) => [{ a: cx - bigDoor / 2, b: cx + bigDoor / 2, y1: y, y2: Math.min(h - 1, y + bigDoor * 0.8) }];
    wall('x', z1, z1 + t, x1, x2, 0.1, h, mat, doors(0.1));
    wall('x', z2 - t, z2, x1, x2, 0.1, h, mat, [{ a: x1 + 3, b: x1 + 5, y1: 0.1, y2: 2.5 }]);
    wall('z', x1, x1 + t, z1 + t, z2 - t, 0.1, h, mat, [{ a: cz - 0.9, b: cz + 0.9, y1: 0.1, y2: 2.5 }, { a: z1 + 2, b: z1 + 4, y1: h - 2.2, y2: h - 1 }]);
    wall('z', x2 - t, x2, z1 + t, z2 - t, 0.1, h, mat, [{ a: cz - 0.9, b: cz + 0.9, y1: 0.1, y2: 2.5 }, { a: z2 - 4, b: z2 - 2, y1: h - 2.2, y2: h - 1 }]);
    add(x1 - 0.4, z1 - 0.4, x2 + 0.4, z2 + 0.4, h, h + 0.4, roof);
    // Mezzanine along the back wall, reached by a flight that runs up beside it.
    const mz1 = z2 - t - 3.6, top = 3.4;
    const end = flight(b, 'x', x1 + 2.4, 1, mz1 - STAIR, mz1, top, 'metal');
    add(end, mz1 - STAIR, end + 1.4, mz1, top - 0.2, top, 'metal');
    add(x1 + t, mz1, x2 - t - 6, z2 - t, top - 0.2, top, 'metal');
    add(end + 1.4, mz1 - 0.15, x2 - t - 6, mz1, top, top + 1, 'metal');
    spot(end + 4, top, mz1 + 1.8);
    spot(x2 - t - 10, top, mz1 + 1.8);
    for (let i = 0; i < 5; i += 1) {
      const px = range(x1 + 3, x2 - 3), pz = range(z1 + 3, mz1 - 3);
      const high = random() < 0.4 ? 2.4 : 1.2;
      add(px - 0.6, pz - 0.6, px + 0.6, pz + 0.6, 0.1, 0.1 + high, 'crate');
    }
    spot(cx - w / 4, 0.1, cz - d / 5); spot(cx + w / 4, 0.1, cz - d / 5); spot(cx, 0.1, cz);
    interest.push([cx, 0.1, cz], [end + 4, top, mz1 + 1.8]);
    claim(x1, z1, x2, z2 + 0.5);
    pad(x1 - 2.4, cz - 3); spot(cx, h + 0.4, cz);
    // Roof furniture to hide behind once you are up there.
    add(cx - 3, cz - 1, cx - 1, cz + 1, h + 0.4, h + 1.6, 'metal'); add(cx + 4, cz - 3, cx + 7, cz - 2.4, h + 0.4, h + 1.5, 'metal');
  }
  // A watchtower: platform on posts with rails, a long flight up one side.
  function tower(cx, cz, h = 9) {
    cx = odd(cx); cz = odd(cz);
    const top = h + 0.3, steps = Math.ceil(top / 0.334), len = steps * 0.6;
    for (const [px, pz] of [[-2.3, -2.3], [2, -2.3], [-2.3, 2], [2, 2]]) add(cx + px, cz + pz, cx + px + 0.3, cz + pz + 0.3, 0, h, 'wood');
    add(cx - 2.5, cz - 2.5, cx + 2.5, cz + 2.5, h, top, 'wood');
    add(cx - 2.5, cz - 2.5, cx + 2.5, cz - 2.3, top, top + 1.1, 'wood');
    add(cx - 2.5, cz - 2.3, cx - 2.3, cz + 2.5, top, top + 1.1, 'wood');
    add(cx + 2.3, cz - 2.3, cx + 2.5, cz + 2.5, top, top + 1.1, 'wood');
    add(cx - 2.5, cz + 2.3, cx - STAIR / 2, cz + 2.5, top, top + 1.1, 'wood');
    flight(b, 'z', cz + 2.5 + len, -1, cx - STAIR / 2, cx + STAIR / 2, top, 'wood');
    add(cx - 2.7, cz - 2.7, cx + 2.7, cz + 2.7, top + 2.6, top + 2.8, 'wood');
    for (const [px, pz] of [[-2.5, -2.5], [2.3, -2.5], [-2.5, 2.3], [2.3, 2.3]]) add(cx + px, cz + pz, cx + px + 0.2, cz + pz + 0.2, top, top + 2.6, 'wood');
    spot(cx, top, cz);
    interest.push([cx, top, cz]);
    claim(cx - 2.7, cz - 2.7, cx + 2.7, cz + 2.7 + len);
  }
  // A shipping container, shut or open at one end with something inside.
  function container(x, z, alongX, open, y = 0) {
    // Open ones line up with the grid so a row of points runs inside them.
    if (open) { if (alongX) { x = odd(x) - 0.5; z = odd(z) - 1.2; } else { x = odd(x) - 1.2; z = odd(z) - 0.5; } }
    const mat = pick(['rust', 'teal', 'metal', 'hull']);
    const [lx, lz] = alongX ? [6, 2.4] : [2.4, 6];
    if (!open) { add(x, z, x + lx, z + lz, y, y + 2.6, mat); return; }
    add(x, z, x + lx, z + lz, y, y + 0.15, mat);
    add(x, z, x + lx, z + lz, y + 2.45, y + 2.6, mat);
    if (alongX) { add(x, z, x + lx, z + 0.15, y + 0.15, y + 2.45, mat); add(x, z + lz - 0.15, x + lx, z + lz, y + 0.15, y + 2.45, mat); add(x + lx - 0.15, z + 0.15, x + lx, z + lz - 0.15, y + 0.15, y + 2.45, mat); spot(x + 3.8, y + 0.15, z + 1.2); }
    else { add(x, z, x + 0.15, z + lz, y + 0.15, y + 2.45, mat); add(x + lx - 0.15, z, x + lx, z + lz, y + 0.15, y + 2.45, mat); add(x + 0.15, z + lz - 0.15, x + lx - 0.15, z + lz, y + 0.15, y + 2.45, mat); spot(x + 1.2, y + 0.15, z + 3.8); }
  }
  function sandbags(x1, z1, x2, z2) { add(x1, z1, x2, z2, 0, 1.15, 'sandbag'); }
  function bunker(cx, cz) {
    cx = odd(cx); cz = odd(cz);
    const w = 9, d = 7, x1 = cx - w / 2, x2 = cx + w / 2, z1 = cz - d / 2, z2 = cz + d / 2;
    add(x1, z1, x2, z2, 0, 0.1, 'concrete');
    wall('x', z1, z1 + 0.5, x1, x2, 0.1, 2.9, 'concrete', [{ a: cx - 0.8, b: cx + 0.8, y1: 0.1, y2: 2.3 }]);
    wall('x', z2 - 0.5, z2, x1, x2, 0.1, 2.9, 'concrete', [{ a: x1 + 1.5, b: x2 - 1.5, y1: 1.5, y2: 1.9 }]);
    wall('z', x1, x1 + 0.5, z1 + 0.5, z2 - 0.5, 0.1, 2.9, 'concrete', [{ a: z1 + 1.5, b: z2 - 1.5, y1: 1.5, y2: 1.9 }]);
    wall('z', x2 - 0.5, x2, z1 + 0.5, z2 - 0.5, 0.1, 2.9, 'concrete', [{ a: z1 + 1.5, b: z2 - 1.5, y1: 1.5, y2: 1.9 }]);
    add(x1 - 0.3, z1 - 0.3, x2 + 0.3, z2 + 0.3, 2.9, 3.4, 'concrete');
    spot(cx, 0.1, cz);
    interest.push([cx, 0.1, cz]);
    claim(x1, z1, x2, z2);
  }

  // --- Places --------------------------------------------------------------------------------------
  const BUILD = {
    town(px, pz) {
      const mats = ['plaster', 'brick', 'plasterWhite', 'ochre', 'rosePlaster'];
      for (let row = -1; row <= 1; row += 1) {
        for (let col = -1; col <= 1; col += 1) {
          if (random() < 0.2) continue;
          const cx = px + col * 24 + range(-2, 2), cz = pz + row * 22 + range(-2, 2);
          house(cx, cz, { floors: random() < 0.45 ? 2 : 1, mat: pick(mats), roof: pick(['terracotta', 'darkMetal', 'wood']) });
        }
      }
      for (let i = 0; i < 6; i += 1) { const x = px + range(-30, 30), z = pz + range(-30, 30); if (clear(x - 1, z - 1, x + 1, z + 1, 1)) add(x - 0.9, z - 0.9, x + 0.9, z + 0.9, 0, 1.2, pick(['crate', 'sandbag'])); }
    },
    docks(px, pz) {
      warehouse(px - 20, pz, { mat: 'rust' });
      warehouse(px + 18, pz - 6, { w: 22, d: 16, mat: 'teal' });
      for (let i = 0; i < 10; i += 1) { const x = px + range(-40, 40), z = pz - 32 + range(-8, 8); if (clear(x, z, x + 6, z + 2.4, 1)) { container(x, z, true, random() < 0.4); claim(x, z, x + 6, z + 2.4); } }
      for (let i = 0; i < 3; i += 1) add(px - 30 + i * 22, pz + 22, px - 24 + i * 22, pz + 70, 0, 0.35, 'wood');
      tower(px + 40, pz + 20);
    },
    farm(px, pz) {
      warehouse(px, pz, { w: 22, d: 16, h: 8, mat: 'terracotta', roof: 'wood', bigDoor: 6 });
      house(px - 30, pz + 4, { floors: 2, mat: 'plasterWhite', roof: 'terracotta' });
      for (const dx of [18, 24]) { add(px + dx, pz - 12, px + dx + 4, pz - 8, 0, 13, 'metal'); claim(px + dx, pz - 12, px + dx + 4, pz - 8); }
      for (let i = 0; i < 12; i += 1) { const x = px + range(-35, 35), z = pz + range(14, 40); if (clear(x, z, x + 2, z + 1.2, 1)) { add(x, z, x + 2, z + 1.2, 0, 1.2, 'hedge'); claim(x, z, x + 2, z + 1.2); } }
      for (const side of [-1, 1]) for (let a = -40; a < 40; a += 6) if (random() < 0.8) add(px + a, pz + side * 45, px + a + 4.5, pz + side * 45 + 0.15, 0, 1.1, 'wood');
      // Hay bales out in the field, some stacked.
      for (let i = 0; i < 9; i += 1) { const x = px + range(-38, 38), z = pz - range(18, 40); if (clear(x, z, x + 2.2, z + 1.4, 1)) { add(x, z, x + 2.2, z + 1.4, 0, 1.3, 'ochre'); if (random() < 0.35) add(x + 0.3, z, x + 1.9, z + 1.4, 1.3, 2.5, 'ochre'); claim(x, z, x + 2.2, z + 1.4); } }
    },
    outpost(px, pz) {
      tower(px, pz - 12, 11);
      bunker(px + 16, pz + 6);
      bunker(px - 18, pz + 10);
      house(px, pz + 20, { mat: 'concrete', roof: 'darkMetal' });
      for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2, x = px + Math.cos(a) * 34, z = pz + Math.sin(a) * 34; if (clear(x - 3, z - 0.6, x + 3, z + 0.6, 1)) { sandbags(x - 3, z - 0.6, x + 3, z + 0.6); claim(x - 3, z - 0.6, x + 3, z + 0.6); } }
    },
    yard(px, pz) {
      warehouse(px, pz + 26, { w: 32, d: 20, h: 8 });
      for (let gx = -3; gx <= 3; gx += 1) {
        for (let gz = -2; gz <= 1; gz += 1) {
          if (random() < 0.25) continue;
          const x = px + gx * 9 - 3, z = pz + gz * 7 - 6;
          container(x, z, true, random() < 0.3);
          if (random() < 0.45) container(x, z, true, false, 2.6);
          claim(x, z, x + 6, z + 2.4);
        }
      }
      tower(px - 40, pz - 30);
      tower(px + 40, pz - 30);
    },
    quarry(px, pz) {
      for (let i = 0; i < 26; i += 1) { const x = px + range(-45, 45), z = pz + range(-45, 45), s = range(3, 9), h = range(2, 7); if (clear(x - s, z - s, x + s, z + s, 1)) { add(x - s, z - s * 0.7, x + s, z + s * 0.7, 0, h, pick(['rock', 'stone', 'sandstone'])); claim(x - s, z - s, x + s, z + s); } }
      house(px + 5, pz - 5, { mat: 'metal', roof: 'darkMetal' });
      bunker(px - 20, pz + 20);
      tower(px + 30, pz + 30, 12);
    },
    hangars(px, pz) {
      warehouse(px - 30, pz, { w: 34, d: 24, h: 9, bigDoor: 12, mat: 'metal' });
      warehouse(px + 30, pz, { w: 34, d: 24, h: 9, bigDoor: 12, mat: 'darkMetal', roof: 'metal' });
      add(px - 60, pz - 34, px + 60, pz - 22, 0, 0.03, 'asphalt', DECO);
      tower(px, pz + 30, 12);
      for (let i = 0; i < 5; i += 1) { const x = px + range(-50, 50), z = pz + range(-20, -14); if (clear(x, z, x + 6, z + 2.4, 1)) { container(x, z, true, random() < 0.5); claim(x, z, x + 6, z + 2.4); } }
    },
  };
  const placed = PLACES.map((place) => ({ ...place, x: Math.round(place.x + range(-8, 8)), z: Math.round(place.z + range(-8, 8)) }));
  for (const place of placed) {
    BUILD[place.type](place.x, place.z);
    zones.push({ name: place.name, box: [place.x - 55, -1, place.z - 55, place.x + 55, 40, place.z + 55] });
  }

  // --- Roads between neighbouring places (visual only) ---------------------------------------------
  const roads = new Set();
  for (const place of placed) {
    const nearest = placed.filter((other) => other !== place).sort((m, n) => Math.hypot(m.x - place.x, m.z - place.z) - Math.hypot(n.x - place.x, n.z - place.z)).slice(0, 2);
    for (const other of nearest) {
      const key = [place.name, other.name].sort().join('|');
      if (roads.has(key)) continue;
      roads.add(key);
      add(Math.min(place.x, other.x) - 3.5, place.z - 3.5, Math.max(place.x, other.x) + 3.5, place.z + 3.5, 0, 0.03, 'asphalt', DECO);
      add(other.x - 3.5, Math.min(place.z, other.z) - 3.5, other.x + 3.5, Math.max(place.z, other.z) + 3.5, 0, 0.03, 'asphalt', DECO);
    }
  }

  // --- Wrecks along the roads: cover where there would be none, and something in the boot ---------------
  function vehicle(x, z, alongX) {
    const [lx, lz] = alongX ? [4.6, 2] : [2, 4.6];
    if (!clear(x, z, x + lx, z + lz, 1)) return;
    const paint = pick(['rust', 'teal', 'hull', 'darkMetal', 'plasterWhite']);
    add(x, z, x + lx, z + lz, 0.35, 1.05, paint);
    if (alongX) add(x + 1.2, z + 0.12, x + 3.5, z + lz - 0.12, 1.05, 1.75, paint); else add(x + 0.12, z + 1.2, x + lx - 0.12, z + 3.5, 1.05, 1.75, paint);
    for (const [wx, wz] of alongX ? [[0.5, -0.05], [3.4, -0.05], [0.5, lz - 0.25], [3.4, lz - 0.25]] : [[-0.05, 0.5], [-0.05, 3.4], [lx - 0.25, 0.5], [lx - 0.25, 3.4]]) add(x + wx, z + wz, x + wx + (alongX ? 0.8 : 0.3), z + wz + (alongX ? 0.3 : 0.8), 0, 0.8, 'darkMetal');
    claim(x, z, x + lx, z + lz);
    if (random() < 0.6) spot(alongX ? x - 1.2 : x + 1, 0, alongX ? z + 1 : z - 1.2);
  }
  for (const place of placed) {
    const nearest = placed.filter((other) => other !== place).sort((m, n) => Math.hypot(m.x - place.x, m.z - place.z) - Math.hypot(n.x - place.x, n.z - place.z)).slice(0, 2);
    for (const other of nearest) {
      for (let a = Math.min(place.x, other.x) + 30; a < Math.max(place.x, other.x) - 30; a += range(38, 70)) if (random() < 0.6) vehicle(a, place.z + pick([-2.6, 0.8]), true);
      for (let a = Math.min(place.z, other.z) + 30; a < Math.max(place.z, other.z) - 30; a += range(38, 70)) if (random() < 0.6) vehicle(other.x + pick([-2.6, 0.8]), a, false);
    }
  }

  // --- Hills: terraces low enough to walk up, a ring of sandbags and something worth having on top -------
  const inland = R - 26;
  for (let tries = 0, made = 0; tries < 60 && made < 7; tries += 1) {
    const cx = odd(range(-inland + 40, inland - 40)), cz = odd(range(-inland + 40, inland - 40)), levels = Math.floor(range(7, 12)), r0 = levels * 2 + 5;
    if (placed.some((place) => Math.hypot(place.x - cx, place.z - cz) < 70 + r0) || !clear(cx - r0, cz - r0, cx + r0, cz + r0, 4)) continue;
    for (let level = 0; level < levels; level += 1) { const r = r0 - level * 2; add(cx - r, cz - r, cx + r, cz + r, 0, (level + 1) * 0.4, level % 3 === 2 ? 'rock' : 'grass'); }
    const top = levels * 0.4, rim = r0 - (levels - 1) * 2;
    add(cx - rim, cz - rim, cx + rim, cz - rim + 0.6, top, top + 1.1, 'sandbag');
    add(cx - rim, cz - rim + 0.6, cx - rim + 0.6, cz + rim - 2.4, top, top + 1.1, 'sandbag');
    add(cx + rim - 0.6, cz - rim + 2.4, cx + rim, cz + rim, top, top + 1.1, 'sandbag');
    spot(cx, top, cz); spot(cx + 1.5, top, cz + 1.5);
    interest.push([cx, top, cz]);
    claim(cx - r0, cz - r0, cx + r0, cz + r0);
    made += 1;
  }

  // --- Between the named places: cabins, ruins, camps, hides, bunkers, boulder fields -----------------------
  // Nowhere on the island should be more than a short sprint from something to get behind.
  const free = (x1, z1, x2, z2, pad2 = 3) => Math.abs(x1) < inland && Math.abs(x2) < inland && Math.abs(z1) < inland && Math.abs(z2) < inland && clear(x1, z1, x2, z2, pad2);
  const scatter = (count, tries, make) => { for (let i = 0, made = 0; i < tries && made < count; i += 1) if (make(range(-inland, inland), range(-inland, inland))) made += 1; };
  // Cabins: a small house, sometimes with an upstairs.
  scatter(26, 200, (x, z) => { if (!free(x - 8, z - 7, x + 8, z + 7)) return false; const tall = random() < 0.3; house(x, z, { w: tall ? 12 : 8, d: tall ? 9 : 7, floors: tall ? 2 : 1, mat: pick(['wood', 'brick', 'plaster', 'concrete']), roof: pick(['wood', 'darkMetal', 'terracotta']) }); return true; });
  // Ruins: broken walls at odd heights with gaps to shoot through.
  scatter(34, 260, (x, z) => {
    const w = range(7, 13), d = range(6, 10), mat = pick(['stone', 'brick', 'concrete', 'sandstone']);
    if (!free(x - 1, z - 1, x + w + 1, z + d + 1)) return false;
    const chunk = (x1, z1, x2, z2) => add(x1, z1, x2, z2, 0, range(1.1, 3.4), mat);
    for (let a = 0; a < w; a += range(2.2, 4)) { if (random() < 0.75) chunk(x + a, z, Math.min(x + w, x + a + range(1.4, 2.6)), z + 0.5); if (random() < 0.6) chunk(x + a, z + d - 0.5, Math.min(x + w, x + a + range(1.4, 2.6)), z + d); }
    for (let a = 1; a < d - 1; a += range(2.2, 4)) { if (random() < 0.7) chunk(x, z + a, x + 0.5, Math.min(z + d, z + a + range(1.4, 2.4))); if (random() < 0.7) chunk(x + w - 0.5, z + a, x + w, Math.min(z + d, z + a + range(1.4, 2.4))); }
    if (random() < 0.5) add(x + w / 2 - 0.6, z + d / 2 - 0.6, x + w / 2 + 0.6, z + d / 2 + 0.6, 0, 1.2, 'crate');
    spot(x + w / 2 + 1.5, 0, z + d / 2); interest.push([odd(x + w / 2), 0, odd(z + d / 2)]);
    claim(x, z, x + w, z + d);
    return true;
  });
  // Camps: a horseshoe of sandbags, crates, something left behind.
  scatter(20, 160, (x, z) => {
    if (!free(x - 6, z - 6, x + 6, z + 6)) return false;
    sandbags(x - 5, z - 5, x + 5, z - 4.2); sandbags(x - 5, z - 4.2, x - 4.2, z + 3); sandbags(x + 4.2, z - 4.2, x + 5, z + 3);
    add(x - 1.5, z - 2, x - 0.3, z - 0.8, 0, 1.2, 'crate'); add(x + 0.8, z - 1, x + 2, z + 0.2, 0, random() < 0.5 ? 2.4 : 1.2, 'crate');
    spot(x, 0, z + 1); if (random() < 0.5) spot(x + 2.5, 0, z + 1.5);
    interest.push([odd(x), 0, odd(z)]);
    claim(x - 5, z - 5, x + 5, z + 3);
    return true;
  });
  // Hides: a low stand to watch from, and the odd full watchtower.
  scatter(14, 120, (x, z) => { const h = random() < 0.3 ? 9 : 4.6; if (!free(x - 4, z - 4, x + 4, z + 4 + h * 2)) return false; tower(x, z, h); return true; });
  scatter(10, 100, (x, z) => { if (!free(x - 6, z - 5, x + 6, z + 5)) return false; bunker(x, z); return true; });
  scatter(14, 120, (x, z) => { const alongX = random() < 0.5; if (!free(x - 1, z - 1, x + 7, z + 7)) return false; container(x, z, alongX, true); if (random() < 0.6) container(alongX ? x : x + 3.4, alongX ? z + 3.4 : z, alongX, false); claim(x, z, x + 6.5, z + 6.5); return true; });
  // Boulder fields: big rocks close together, lanes between them.
  scatter(24, 160, (x, z) => {
    if (!free(x - 12, z - 12, x + 12, z + 12, 1)) return false;
    for (let i = 0; i < Math.floor(range(5, 10)); i += 1) { const bx = x + range(-10, 10), bz = z + range(-10, 10), bs = range(1.2, 3.4); if (clear(bx - bs, bz - bs, bx + bs, bz + bs, 1.2)) { add(bx - bs, bz - bs * range(0.6, 1), bx + bs, bz + bs * range(0.6, 1), 0, range(1.6, 4.5), pick(['rock', 'rock', 'stone'])); claim(bx - bs, bz - bs, bx + bs, bz + bs); } }
    if (random() < 0.4) spot(x, 0, z);
    return true;
  });

  // --- Countryside: woods, rocks, field walls -------------------------------------------------------
  for (let cluster = 0; cluster < 110; cluster += 1) {
    const fx = range(-inland, inland), fz = range(-inland, inland);
    if (placed.some((place) => Math.hypot(place.x - fx, place.z - fz) < 46)) continue;
    const count = Math.floor(range(10, 26));
    for (let i = 0; i < count; i += 1) {
      const x = fx + range(-26, 26), z = fz + range(-26, 26);
      if (Math.abs(x) > inland || Math.abs(z) > inland || !clear(x - 1.6, z - 1.6, x + 1.6, z + 1.6, 0.5)) continue;
      const height = range(4.5, 7);
      add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 0, height, 'wood');
      add(x - 1.6, z - 1.6, x + 1.6, z + 1.6, height - 1.2, height + 2.2, 'hedge');
      claim(x - 1.6, z - 1.6, x + 1.6, z + 1.6);
    }
  }
  // Lone trees and bushes fill what is left: a bush hides a crouched pilot, a trunk stops a bullet.
  for (let i = 0; i < 420; i += 1) {
    const x = range(-inland, inland), z = range(-inland, inland);
    if (!clear(x - 1.4, z - 1.4, x + 1.4, z + 1.4, 0.8)) continue;
    const height = range(4, 7.5);
    add(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 0, height, 'wood');
    add(x - 1.5, z - 1.5, x + 1.5, z + 1.5, height - 1.2, height + range(1.6, 2.6), 'hedge');
    claim(x - 1.4, z - 1.4, x + 1.4, z + 1.4);
  }
  for (let i = 0; i < 520; i += 1) {
    const x = range(-inland, inland), z = range(-inland, inland), w = range(1.2, 2.6), d = range(1.2, 2.6);
    if (!clear(x, z, x + w, z + d, 0.8)) continue;
    add(x, z, x + w, z + d, 0, range(0.9, 1.5), 'hedge');
    claim(x, z, x + w, z + d);
  }
  for (let i = 0; i < 520; i += 1) {
    const x = range(-inland, inland), z = range(-inland, inland), s = range(0.8, 3.2);
    if (!clear(x - s, z - s, x + s, z + s, 1.5)) continue;
    add(x - s, z - s * range(0.5, 1), x + s, z + s * range(0.5, 1), 0, range(0.9, s * 1.3), 'rock');
    claim(x - s, z - s, x + s, z + s);
  }
  for (let i = 0; i < 170; i += 1) {
    const x = range(-inland, inland), z = range(-inland, inland), len = range(8, 22), alongX = random() < 0.5;
    const [x1, z1, x2, z2] = alongX ? [x, z, x + len, z + 0.6] : [x, z, x + 0.6, z + len];
    if (!clear(x1, z1, x2, z2, 1.5)) continue;
    // A gap in the middle so a wall is cover, not a detour.
    const cut = len * range(0.35, 0.55);
    if (alongX) { add(x1, z1, x1 + cut, z2, 0, 1.2, 'stone'); add(x1 + cut + 2, z1, x2, z2, 0, 1.2, 'stone'); } else { add(x1, z1, x2, z1 + cut, 0, 1.2, 'stone'); add(x1, z1 + cut + 2, x2, z2, 0, 1.2, 'stone'); }
    claim(x1, z1, x2, z2);
  }

  return {
    id: 'island', title: 'Kestrel Island', royale: true,
    bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R, minY: -1, maxY: 30, ceiling: 480 },
    navCell: 2,
    boxes: b.boxes, barriers: [], lights, signs: [], zones, interest, lanes: [], loot, pads, places: placed.map(({ name, x, z }) => ({ name, x, z })),
    env: { backdrop: 'sea', variants: ['noon', 'dusk'] },
    spawnZones: {},
    spawns: { A: [{ x: 0, y: 0, z: 0, yaw: 0 }], B: [{ x: 0, y: 0, z: 0, yaw: 0 }] },
    dummies: [],
  };
}
