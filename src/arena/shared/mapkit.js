// Tools for authoring maps out of axis-aligned boxes. Every arena is mirrored
// across z = 0 (Alpha spawns at +z, Bravo at -z), so authors build the south half
// with `SYM` and only place centre-line pieces once.

export const SYM = { sym: true };
export const DECO = { deco: true, noShadow: true };

export function createBuilder() {
  const boxes = [];
  let counter = 0;

  // opts: sym (mirror across z=0), mirrorMat, glass, deco, noShadow, asym (exempt from the mirror test)
  function add(x1, z1, x2, z2, y1, y2, mat, opts = {}) {
    const make = (za, zb, suffix, material) => {
      const entry = {
        id: `${opts.glass ? 'g' : 'b'}${counter}${suffix}`,
        min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(za, zb)],
        max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(za, zb)],
        mat: material,
      };
      if (opts.glass) entry.glass = true;
      if (opts.deco) entry.deco = true;
      if (opts.noShadow) entry.noShadow = true;
      if (opts.asym) entry.asym = true;
      boxes.push(entry);
    };
    make(z1, z2, '', mat);
    if (opts.sym) make(-z1, -z2, 'm', opts.mirrorMat || mat);
    counter += 1;
  }

  // Fills a rectangle with slabs, leaving rectangular holes [x1, z1, x2, z2] open.
  function slabs(x1, z1, x2, z2, y1, y2, mat, holes = [], opts = {}) {
    const xs = [...new Set([x1, x2, ...holes.flatMap((h) => [h[0], h[2]])])].filter((v) => v >= x1 && v <= x2).sort((a, b) => a - b);
    const zs = [...new Set([z1, z2, ...holes.flatMap((h) => [h[1], h[3]])])].filter((v) => v >= z1 && v <= z2).sort((a, b) => a - b);
    const inHole = (x, z) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      let runStart = null;
      for (let zi = 0; zi < zs.length - 1; zi += 1) {
        const solid = !inHole((xs[xi] + xs[xi + 1]) / 2, (zs[zi] + zs[zi + 1]) / 2);
        if (solid && runStart === null) runStart = zs[zi];
        const last = zi === zs.length - 2;
        if (runStart !== null && (!solid || last)) {
          add(xs[xi], runStart, xs[xi + 1], solid ? zs[zi + 1] : zs[zi], y1, y2, mat, opts);
          runStart = null;
        }
      }
    }
  }

  // axis 'x': wall runs along x, c1..c2 is its z thickness. axis 'z': runs along z, c1..c2 is x thickness.
  // openings: [{ a, b, y1, y2, glass? }] — doors, windows, arches.
  function wall(axis, c1, c2, from, to, y1, y2, mat, openings = [], opts = {}) {
    const put = (a, b, ya, yb, material, extra = {}) => {
      if (Math.abs(b - a) < 1e-6 || Math.abs(yb - ya) < 1e-6) return;
      if (axis === 'x') add(a, c1, b, c2, ya, yb, material, { ...opts, ...extra });
      else add(c1, a, c2, b, ya, yb, material, { ...opts, ...extra });
    };
    let cursor = from;
    [...openings].sort((m, n) => m.a - n.a).forEach((opening) => {
      put(cursor, opening.a, y1, y2, mat);
      put(opening.a, opening.b, y1, opening.y1, mat);
      put(opening.a, opening.b, opening.y2, y2, mat);
      if (opening.glass) {
        const panes = Math.max(1, Math.ceil((opening.b - opening.a) / 3.2));
        const width = (opening.b - opening.a) / panes;
        const mid = (c1 + c2) / 2;
        for (let pane = 0; pane < panes; pane += 1) {
          const a = opening.a + pane * width, b = a + width;
          if (axis === 'x') add(a, mid - 0.04, b, mid + 0.04, opening.y1, opening.y2, 'glass', { ...opts, glass: true });
          else add(mid - 0.04, a, mid + 0.04, b, opening.y1, opening.y2, 'glass', { ...opts, glass: true });
        }
      }
      cursor = opening.b;
    });
    put(cursor, to, y1, y2, mat);
  }

  // A run of free-standing glass panes (railings, display cases). Each pane breaks on its own.
  function glassRun(axis, c, from, to, y1, y2, opts = {}) {
    const panes = Math.max(1, Math.ceil(Math.abs(to - from) / 3));
    const width = (to - from) / panes;
    for (let pane = 0; pane < panes; pane += 1) {
      const a = from + pane * width, b = a + width;
      if (axis === 'x') add(a, c - 0.04, b, c + 0.04, y1, y2, 'glass', { ...opts, glass: true });
      else add(c - 0.04, a, c + 0.04, b, y1, y2, 'glass', { ...opts, glass: true });
    }
  }

  // Steps rising from `from` to `to` along the axis. Solid down to yBottom by default;
  // pass opts.thickness for a floating flight (upper storeys of a stairwell).
  function stairs(axis, from, to, l1, l2, yBottom, yTop, steps, mat, opts = {}) {
    const { thickness, ...rest } = opts;
    for (let step = 0; step < steps; step += 1) {
      const a = from + ((to - from) * step) / steps;
      const b = from + ((to - from) * (step + 1)) / steps;
      const top = yBottom + ((yTop - yBottom) * (step + 1)) / steps;
      const bottom = thickness ? top - thickness : yBottom;
      if (axis === 'x') add(a, l1, b, l2, bottom, top, mat, rest);
      else add(l1, a, l2, b, bottom, top, mat, rest);
    }
  }

  // Market stall: counter, thin plank back wall and a cloth canopy. All of it can be shot through.
  function stall(x, z, cloth = 'cloth', opts = SYM, width = 4) {
    add(x, z, x + width, z + 1, 0, 1, 'wood', opts);
    add(x, z + 1.9, x + width, z + 2.02, 0, 2.5, 'wood', opts);
    add(x - 0.3, z - 0.5, x + width + 0.3, z + 2.3, 2.5, 2.6, cloth, opts);
    add(x - 0.1, z - 0.3, x + 0.02, z - 0.18, 0, 2.5, 'wood', opts);
    add(x + width - 0.02, z - 0.3, x + width + 0.1, z - 0.18, 0, 2.5, 'wood', opts);
  }

  return { boxes, add, slabs, wall, glassRun, stairs, stall };
}

// Spawn-gate force fields, mirrored for both teams. gates: [[x1, x2], ...] at |z| = z1..z2.
export function gateBarriers(gates, z1, z2, height = 3.7) {
  const barriers = [];
  gates.forEach(([x1, x2], index) => {
    barriers.push({ id: `barrier-A${index}`, min: [x1, 0, z1], max: [x2, height, z2], mat: 'barrier', barrier: true });
    barriers.push({ id: `barrier-B${index}`, min: [x1, 0, -z2], max: [x2, height, -z1], mat: 'barrier', barrier: true });
  });
  return barriers;
}

// Zones authored for the south half: name "A …" mirrors to "B …"; others keep their name.
// box: [x1, y1, z1, x2, y2, z2]
export function mirrorZones(zones) {
  const out = [];
  for (const zone of zones) {
    out.push(zone);
    const [x1, y1, z1, x2, y2, z2] = zone.box;
    if (z1 >= 0 || z2 <= 0) {
      const name = zone.name.startsWith('A ') ? `B ${zone.name.slice(2)}` : zone.name.startsWith('South ') ? `North ${zone.name.slice(6)}` : zone.name;
      if (zone.mirror !== false) out.push({ name, box: [x1, y1, -z2, x2, y2, -z1] });
    }
  }
  return out;
}

// Interest points / lanes authored for the south half get a northern twin.
export function mirrorPoints(points) {
  const out = [];
  for (const [x, y, z] of points) { out.push([x, y, z]); if (Math.abs(z) > 0.01) out.push([x, y, -z]); }
  return out;
}

export function teamSpawns(xs, z, y = 0) {
  return { A: xs.map((x) => ({ x, y, z, yaw: 0 })), B: xs.map((x) => ({ x, y, z: -z, yaw: Math.PI })) };
}
