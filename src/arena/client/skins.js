// Gun finishes and suit patterns, painted in code. Metalness stays moderate: nothing in the game has a
// reflection map, so fully metallic surfaces would render black. Every texture tiles, and the materials sample it
// triplanar in the part's own space, so a camo reads the same on a long barrel as on a stubby grip.
import * as THREE from 'three';

const SIZE = 256;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function surface() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  return { canvas, c: canvas.getContext('2d') };
}
// Draw a shape at every wrap offset so it continues across the tile's edges.
function wrapped(fn) { for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) fn(dx, dy); }
function grain(c, strength, seed) {
  const r = rng(seed);
  for (let i = 0; i < 2600; i += 1) { c.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * strength})`; c.fillRect(Math.floor(r() * SIZE), Math.floor(r() * SIZE), 2, 2); }
}
function blobs(c, colors, count, min, max, seed) {
  const r = rng(seed);
  for (let i = 0; i < count; i += 1) {
    const x = r() * SIZE, y = r() * SIZE, rx = min + r() * (max - min), ry = rx * (0.45 + r() * 0.6), rot = r() * Math.PI;
    c.fillStyle = colors[i % colors.length];
    wrapped((dx, dy) => { c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, rot, 0, Math.PI * 2); c.fill(); });
  }
}
function lines(c, color, width, count, seed, length = [30, 120]) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineWidth = width;
  for (let i = 0; i < count; i += 1) { const x = r() * SIZE, y = r() * SIZE, a = r() * Math.PI * 2, l = length[0] + r() * (length[1] - length[0]); wrapped((dx, dy) => { c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); c.stroke(); }); }
}
function pixels(c, colors, cell, seed) { const r = rng(seed); for (let x = 0; x < SIZE; x += cell) for (let y = 0; y < SIZE; y += cell) { c.fillStyle = colors[Math.floor(r() * colors.length)]; c.fillRect(x, y, cell, cell); } }
function stripes(c, base, ink, count, wobble, width, seed) {
  c.fillStyle = base; c.fillRect(0, 0, SIZE, SIZE);
  const r = rng(seed); c.fillStyle = ink;
  for (let i = 0; i < count; i += 1) { const x0 = (i / count) * SIZE + r() * 6, w = width * (0.6 + r() * 0.8); c.beginPath(); for (let y = 0; y <= SIZE; y += 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * wobble - w / 2, y); for (let y = SIZE; y >= 0; y -= 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * wobble + w / 2, y); c.fill(); }
}
function circuit(c, color, width, seed) {
  const r = rng(seed);
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = width;
  for (let i = 0; i < 38; i += 1) {
    let x = Math.round(r() * 16) * 16, y = Math.round(r() * 16) * 16;
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 4; k += 1) { if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * 16 * (1 + Math.floor(r() * 3)); else y += (r() < 0.5 ? -1 : 1) * 16 * (1 + Math.floor(r() * 3)); c.lineTo(x, y); }
    c.stroke(); c.beginPath(); c.arc(x, y, width * 2, 0, Math.PI * 2); c.fill();
  }
}
// Ten rows of eight hexes: an even row count so the offset rows line up across the tile edge.
function hexes(c, stroke, width, fill = null) {
  const cw = SIZE / 8, rh = SIZE / 10, radius = cw * 0.56;
  c.strokeStyle = stroke; c.lineWidth = width;
  for (let row = -1; row <= 10; row += 1) for (let col = -1; col <= 8; col += 1) {
    const x = col * cw + (row % 2 ? cw / 2 : 0), y = row * rh;
    c.beginPath(); for (let k = 0; k < 6; k += 1) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius * 0.92); } c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); } c.stroke();
  }
}
// Veins that wander: a few long random walks with thinner branches coming off them.
function veins(c, color, width, count, seed) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineCap = 'round';
  for (let i = 0; i < count; i += 1) {
    let x = r() * SIZE, y = r() * SIZE, a = r() * Math.PI * 2;
    const path = [[x, y]];
    for (let k = 0; k < 26; k += 1) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 12; y += Math.sin(a) * 12; path.push([x, y]); }
    wrapped((dx, dy) => { c.lineWidth = width; c.beginPath(); path.forEach(([px, py], k) => (k ? c.lineTo(px + dx, py + dy) : c.moveTo(px + dx, py + dy))); c.stroke(); });
    const [bx, by] = path[6 + Math.floor(r() * 12)]; let ba = a + 1.2, px = bx, py = by; const branch = [[bx, by]];
    for (let k = 0; k < 9; k += 1) { ba += (r() - 0.5) * 0.8; px += Math.cos(ba) * 9; py += Math.sin(ba) * 9; branch.push([px, py]); }
    wrapped((dx, dy) => { c.lineWidth = width * 0.45; c.beginPath(); branch.forEach(([qx, qy], k) => (k ? c.lineTo(qx + dx, qy + dy) : c.moveTo(qx + dx, qy + dy))); c.stroke(); });
  }
}
// Spider webs: spokes from a hub, joined by sagging threads.
function webs(c, color, width, seed) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineWidth = width;
  for (const [hx, hy] of [[64, 70], [192, 60], [128, 190], [250, 200], [10, 160]]) {
    const spokes = 9 + Math.floor(r() * 3), turn = r() * 6, reach = 78;
    wrapped((dx, dy) => {
      for (let k = 0; k < spokes; k += 1) { const a = turn + (k / spokes) * Math.PI * 2; c.beginPath(); c.moveTo(hx + dx, hy + dy); c.lineTo(hx + dx + Math.cos(a) * reach, hy + dy + Math.sin(a) * reach); c.stroke(); }
      for (let ring = 1; ring <= 5; ring += 1) for (let k = 0; k < spokes; k += 1) {
        const a0 = turn + (k / spokes) * Math.PI * 2, a1 = turn + ((k + 1) / spokes) * Math.PI * 2, d = ring * 14, sag = d * 0.82;
        c.beginPath(); c.moveTo(hx + dx + Math.cos(a0) * d, hy + dy + Math.sin(a0) * d);
        c.quadraticCurveTo(hx + dx + Math.cos((a0 + a1) / 2) * sag, hy + dy + Math.sin((a0 + a1) / 2) * sag, hx + dx + Math.cos(a1) * d, hy + dy + Math.sin(a1) * d); c.stroke();
      }
    });
  }
}
// Ice: six-armed crystals with side spurs.
function crystals(c, color, seed, count = 16) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineCap = 'round';
  for (let i = 0; i < count; i += 1) {
    const x = r() * SIZE, y = r() * SIZE, size = 10 + r() * 22, turn = r() * Math.PI;
    wrapped((dx, dy) => { for (let arm = 0; arm < 6; arm += 1) { const a = turn + (arm * Math.PI) / 3; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx + Math.cos(a) * size, y + dy + Math.sin(a) * size); c.stroke(); for (const k of [0.45, 0.7]) for (const side of [-1, 1]) { const px = x + dx + Math.cos(a) * size * k, py = y + dy + Math.sin(a) * size * k; c.lineWidth = 1; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a + side * 1.05) * size * 0.28, py + Math.sin(a + side * 1.05) * size * 0.28); c.stroke(); } } });
  }
}
// Engraved diamonds with a flourish in each: reads as gold work rather than letters.
function filigree(c, line, seed) {
  c.strokeStyle = line; c.lineWidth = 2;
  for (let x = 0; x <= SIZE; x += 64) for (let y = 0; y <= SIZE; y += 64) for (const [ox, oy] of [[0, 0], [32, 32]]) {
    const cx = x + ox, cy = y + oy;
    c.beginPath(); c.moveTo(cx, cy - 26); c.lineTo(cx + 26, cy); c.lineTo(cx, cy + 26); c.lineTo(cx - 26, cy); c.closePath(); c.stroke();
    c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2 + Math.PI / 4; c.beginPath(); c.arc(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 4, 0, Math.PI * 2); c.stroke(); }
  }
  grain(c, 0.07, seed);
}
// Circuit traces drawn at every wrap offset, so they carry on across the tile's edges.
function wrappedCircuit(c, color, width, seed) { wrapped((dx, dy) => { c.save(); c.translate(dx, dy); circuit(c, color, width, seed); c.restore(); }); }
// Tiling cells on a jittered n x n grid. `shade(cell, edge, x, y)` returns [r, g, b]; `edge` is how far the pixel sits from the nearest border.
function voronoi(c, n, seed, shade) {
  const r = rng(seed), pts = [], img = c.createImageData(SIZE, SIZE);
  for (let gy = 0; gy < n; gy += 1) for (let gx = 0; gx < n; gx += 1) pts.push([((gx + 0.15 + r() * 0.7) * SIZE) / n, ((gy + 0.15 + r() * 0.7) * SIZE) / n]);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let i = 0; i < pts.length; i += 1) { let dx = Math.abs(x - pts[i][0]), dy = Math.abs(y - pts[i][1]); dx = Math.min(dx, SIZE - dx); dy = Math.min(dy, SIZE - dy); const d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d; }
    const [cr, cg, cb] = shade(best, Math.sqrt(d2) - Math.sqrt(d1), x, y), i = (y * SIZE + x) * 4;
    img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}
// Contour lines over a height field that repeats every tile, every fifth line heavier. `paper(band)` and `ink` are [r, g, b].
function contours(c, paper, ink, seed) {
  const r = rng(seed), ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28], T = (Math.PI * 2) / SIZE, img = c.createImageData(SIZE, SIZE);
  const h = (x, y) => { const u = x * T, v = y * T; return (0.55 * Math.sin(u + 0.9 * Math.sin(v + ph[0])) + 0.45 * Math.cos(2 * v + 0.7 * Math.sin(u + ph[1])) + 0.25 * Math.sin(2 * u - v + ph[2]) + 0.16 * Math.cos(3 * u + 2 * v + ph[3])) * 5 + 10; };
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const l = h(x, y), g = Math.hypot(h(x + 1, y) - l, h(x, y + 1) - l) + 1e-4, band = Math.floor(l), d = Math.min(l - band, band + 1 - l) / g;
    const t = Math.max(0, Math.min(1, (Math.round(l) % 5 === 0 ? 2 : 1.2) - d)), base = paper(band), i = (y * SIZE + x) * 4;
    for (let k = 0; k < 3; k += 1) img.data[i + k] = base[k] + (ink[k] - base[k]) * t;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}
// Jellyfish outlines: a scalloped bell and wavy trailing tentacles.
function jellies(c, color, seed) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineCap = 'round';
  for (let i = 0; i < 7; i += 1) {
    const x = r() * SIZE, y = r() * SIZE, s = 9 + r() * 9, tilt = (r() - 0.5) * 0.6, legs = Array.from({ length: 5 }, () => [r() * 6.28, 1.6 + r() * 1.4]);
    wrapped((dx, dy) => {
      c.save(); c.translate(x + dx, y + dy); c.rotate(tilt);
      c.lineWidth = 1.4; c.beginPath(); c.ellipse(0, 0, s, s * 0.75, 0, Math.PI, 0); c.quadraticCurveTo(0, s * 0.35, -s, 0); c.stroke();
      c.lineWidth = 0.9; legs.forEach(([ph, len], k) => { const lx = -s * 0.7 + (k / 4) * s * 1.4; c.beginPath(); c.moveTo(lx, s * 0.12); for (let t = 1; t <= 10; t += 1) c.lineTo(lx + Math.sin(ph + t * 0.9) * 2.5, s * 0.12 + t * s * 0.11 * len); c.stroke(); });
      c.restore();
    });
  }
}
function solid(color, seed) { return (c) => { c.fillStyle = color; c.fillRect(0, 0, SIZE, SIZE); grain(c, 0.08, seed); }; }

// Each painter fills the colour tile; `glow` painters also fill an emissive tile.
const FINISH_ART = {
  // Legendary: static, but the most worked-over paint in the game.
  obsidian: { rough: 0.12, metal: 0.35, paint: (c) => { c.fillStyle = '#07080b'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(40,44,60,.55)', 'rgba(18,20,28,.8)'], 20, 16, 44, 131); lines(c, 'rgba(214,168,72,.85)', 1.6, 12, 132, [40, 160]); lines(c, 'rgba(255,214,120,.5)', 0.8, 18, 133, [20, 80]); } },
  royal: { rough: 0.35, metal: 0.35, paint: (c) => { c.fillStyle = '#122052'; c.fillRect(0, 0, SIZE, SIZE); c.strokeStyle = '#d6aa4a'; c.lineWidth = 1.6; for (let x = 0; x < SIZE; x += 64) for (let y = 0; y < SIZE; y += 64) { for (const [ox, oy, r] of [[32, 32, 20], [0, 0, 12], [64, 0, 12], [0, 64, 12], [64, 64, 12]]) { c.beginPath(); c.arc(x + ox, y + oy, r, 0, Math.PI * 2); c.stroke(); } c.beginPath(); c.moveTo(x + 12, y + 32); c.quadraticCurveTo(x + 32, y + 8, x + 52, y + 32); c.quadraticCurveTo(x + 32, y + 56, x + 12, y + 32); c.stroke(); } grain(c, 0.06, 134); } },
  jade: { rough: 0.25, metal: 0.1, paint: (c) => { c.fillStyle = '#1f7a58'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(120,210,160,.35)', 'rgba(10,70,45,.45)', 'rgba(200,240,210,.2)'], 40, 10, 40, 135); c.strokeStyle = 'rgba(8,48,32,.7)'; c.lineWidth = 2; for (let k = 0; k < SIZE; k += 32) { c.beginPath(); for (let x = 0; x <= SIZE; x += 8) c.lineTo(x, k + Math.sin((x / SIZE) * Math.PI * 4) * 8); c.stroke(); } } },
  redline: { rough: 0.3, metal: 0.4, paint: (c) => { for (let x = 0; x < SIZE; x += 16) for (let y = 0; y < SIZE; y += 16) { const g = ((x + y) / 16) % 2 ? c.createLinearGradient(x, y, x + 16, y) : c.createLinearGradient(x, y, x, y + 16); g.addColorStop(0, '#111317'); g.addColorStop(0.5, '#2c3037'); g.addColorStop(1, '#111317'); c.fillStyle = g; c.fillRect(x, y, 16, 16); } c.fillStyle = '#e0202e'; for (const y of [96, 150]) c.fillRect(0, y, SIZE, y === 96 ? 18 : 6); c.fillStyle = '#f2f2f2'; c.fillRect(0, 118, SIZE, 3); } },
  koi: { rough: 0.3, metal: 0.1, paint: (c) => { c.fillStyle = '#0e3a57'; c.fillRect(0, 0, SIZE, SIZE); lines(c, 'rgba(120,200,255,.25)', 2, 26, 136, [30, 90]); const r = rng(137); for (let i = 0; i < 9; i += 1) { const x = r() * SIZE, y = r() * SIZE, a = r() * Math.PI * 2; wrapped((dx, dy) => { c.save(); c.translate(x + dx, y + dy); c.rotate(a); c.fillStyle = i % 3 ? '#ff7a2a' : '#f4f1ea'; c.beginPath(); c.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(-16, 0); c.lineTo(-28, -8); c.lineTo(-28, 8); c.fill(); c.fillStyle = '#f4f1ea'; c.beginPath(); c.ellipse(4, -2, 5, 3, 0, 0, Math.PI * 2); c.fill(); c.restore(); }); } } },
  blueprint: { rough: 0.6, metal: 0.05, paint: (c) => { c.fillStyle = '#1d4f91'; c.fillRect(0, 0, SIZE, SIZE); c.strokeStyle = 'rgba(210,230,255,.2)'; c.lineWidth = 1; for (let k = 0; k <= SIZE; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, SIZE); c.moveTo(0, k); c.lineTo(SIZE, k); c.stroke(); } c.strokeStyle = 'rgba(235,245,255,.85)'; c.lineWidth = 1.5; const r = rng(138); for (let i = 0; i < 10; i += 1) { const x = r() * 200 + 20, y = r() * 200 + 20; if (i % 2) { c.beginPath(); c.arc(x, y, 10 + r() * 20, 0, Math.PI * 2); c.stroke(); } else c.strokeRect(x, y, 20 + r() * 40, 10 + r() * 30); } } },
  // Epic additions.
  bubblegum: { rough: 0.7, metal: 0.05, paint: (c) => { c.fillStyle = '#ff9fcf'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#ff5fa8', '#ffd1e8', '#c23d86'], 34, 14, 34, 139); grain(c, 0.05, 140); } },
  tide: { rough: 0.4, metal: 0.15, paint: (c) => { c.fillStyle = '#0a6d8a'; c.fillRect(0, 0, SIZE, SIZE); for (let k = 0; k < 8; k += 1) { c.strokeStyle = k % 2 ? 'rgba(255,255,255,.55)' : 'rgba(0,40,60,.5)'; c.lineWidth = 6; c.beginPath(); for (let x = 0; x <= SIZE; x += 4) c.lineTo(x, k * 32 + 16 + Math.sin((x / SIZE) * Math.PI * 6 + k) * 7); c.stroke(); } } },
  olive: { paint: solid('#4b5327', 1), rough: 0.8, metal: 0.1 },
  sand: { paint: solid('#bfa272', 2), rough: 0.85, metal: 0.05 },
  slate: { paint: solid('#3b4652', 3), rough: 0.55, metal: 0.35 },
  woodland: { rough: 0.8, metal: 0.05, paint: (c) => { c.fillStyle = '#56633a'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#2f3b22', '#735f3c', '#1d2218'], 34, 14, 34, 11); grain(c, 0.06, 4); } },
  digital: { rough: 0.7, metal: 0.1, paint: (c) => { const r = rng(21), greys = ['#5b6168', '#7d848b', '#3a3f45', '#9ba2a9']; for (let x = 0; x < SIZE; x += 8) for (let y = 0; y < SIZE; y += 8) { c.fillStyle = greys[Math.floor(r() * (r() < 0.6 ? 2 : 4))]; c.fillRect(x, y, 8, 8); } } },
  tiger: { rough: 0.6, metal: 0.15, paint: (c) => { c.fillStyle = '#d9822b'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(31); c.fillStyle = '#17120e'; for (let i = 0; i < 16; i += 1) { const x0 = (i / 16) * SIZE + r() * 8, w = 4 + r() * 7; c.beginPath(); for (let y = 0; y <= SIZE; y += 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * 9 - w / 2, y); for (let y = SIZE; y >= 0; y -= 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * 9 + w / 2 + Math.sin(y * 0.09 + i) * 3, y); c.fill(); } } },
  arctic: { rough: 0.7, metal: 0.05, paint: (c) => { c.fillStyle = '#e7ecf0'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#b5c1ca', '#8b98a4', '#cfd8df'], 30, 12, 30, 41); } },
  carbon: { rough: 0.35, metal: 0.4, paint: (c) => { for (let x = 0; x < SIZE; x += 16) for (let y = 0; y < SIZE; y += 16) { const across = ((x + y) / 16) % 2 === 0; const g = across ? c.createLinearGradient(x, y, x + 16, y) : c.createLinearGradient(x, y, x, y + 16); g.addColorStop(0, '#15181c'); g.addColorStop(0.5, '#343a42'); g.addColorStop(1, '#15181c'); c.fillStyle = g; c.fillRect(x, y, 16, 16); } } },
  hazard: { rough: 0.55, metal: 0.2, paint: (c) => { c.fillStyle = '#f2c14e'; c.fillRect(0, 0, SIZE, SIZE); c.fillStyle = '#16171a'; for (let k = -SIZE; k < SIZE * 2; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 16, 0); c.lineTo(k + 16 - SIZE, SIZE); c.lineTo(k - SIZE, SIZE); c.fill(); } grain(c, 0.1, 5); } },
  neon: {
    rough: 0.4, metal: 0.3, shader: 'gridpulse',
    paint: (c) => { c.fillStyle = '#0c1016'; c.fillRect(0, 0, SIZE, SIZE); c.strokeStyle = '#1b3a44'; c.lineWidth = 2; for (let k = 0; k <= SIZE; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, SIZE); c.moveTo(0, k); c.lineTo(SIZE, k); c.stroke(); } },
    emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); c.strokeStyle = '#3ff2ff'; c.lineWidth = 2; for (let k = 0; k <= SIZE; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, SIZE); c.moveTo(0, k); c.lineTo(SIZE, k); c.stroke(); } },
  },
  damascus: { rough: 0.35, metal: 0.5, paint: (c) => { const img = c.createImageData(SIZE, SIZE); for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) { const wave = Math.sin(((y + 14 * Math.sin((x / SIZE) * Math.PI * 4) + 6 * Math.sin((x / SIZE) * Math.PI * 10)) / SIZE) * Math.PI * 24); const v = 110 + wave * 55; const i = (y * SIZE + x) * 4; img.data[i] = v; img.data[i + 1] = v + 4; img.data[i + 2] = v + 10; img.data[i + 3] = 255; } c.putImageData(img, 0, 0); } },
  crimson: { rough: 0.45, metal: 0.3, paint: (c) => { const g = c.createRadialGradient(128, 128, 20, 128, 128, 190); g.addColorStop(0, '#7a141c'); g.addColorStop(1, '#3d0a0f'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); webs(c, 'rgba(10,3,4,.9)', 1.6, 61); grain(c, 0.06, 62); } },
  midnight: { paint: solid('#1c2538', 8), rough: 0.6, metal: 0.25 },
  bone: { paint: solid('#d8d0bb', 9), rough: 0.8, metal: 0.05 },
  rust: { rough: 0.9, metal: 0.2, paint: (c) => { c.fillStyle = '#7a3b1c'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#a4532a', '#4a2413', '#8c6a4a', '#5e2c14'], 90, 3, 12, 91); grain(c, 0.18, 92); } },
  flecktarn: { rough: 0.8, metal: 0.05, paint: (c) => { c.fillStyle = '#6b6f47'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#2e3a24', '#8a7b4c', '#44502e', '#1f241a'], 260, 3, 7, 93); } },
  desert: { rough: 0.75, metal: 0.05, paint: (c) => pixels(c, ['#c9ab7c', '#a88a5f', '#e0c79c', '#8a7150', '#c9ab7c'], 8, 94) },
  splinter: { rough: 0.75, metal: 0.05, paint: (c) => { c.fillStyle = '#a0a37e'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(95), colors = ['#5b6b4a', '#7e8460', '#3c4535']; for (let i = 0; i < 46; i += 1) { const x = r() * SIZE, y = r() * SIZE, a = r() * Math.PI, l = 30 + r() * 60; c.fillStyle = colors[i % 3]; wrapped((dx, dy) => { c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); c.lineTo(x + dx + Math.cos(a + 0.35) * l * 0.6, y + dy + Math.sin(a + 0.35) * l * 0.6); c.fill(); }); } } },
  zebra: { rough: 0.6, metal: 0.1, paint: (c) => stripes(c, '#ecebe6', '#141414', 12, 14, 12, 96) },
  leopard: { rough: 0.7, metal: 0.05, paint: (c) => { c.fillStyle = '#d9a55a'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(97); for (let i = 0; i < 40; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 7 + r() * 6; wrapped((dx, dy) => { c.fillStyle = '#35200f'; c.beginPath(); c.ellipse(x + dx, y + dy, s, s * 0.8, r() * 3, 0, Math.PI * 2); c.fill(); c.fillStyle = '#b37a36'; c.beginPath(); c.ellipse(x + dx, y + dy, s * 0.55, s * 0.4, 0, 0, Math.PI * 2); c.fill(); }); } } },
  checker: { rough: 0.5, metal: 0.1, paint: (c) => { for (let x = 0; x < SIZE; x += 32) for (let y = 0; y < SIZE; y += 32) { c.fillStyle = (x + y) % 64 ? '#15171a' : '#e9ecef'; c.fillRect(x, y, 32, 32); } } },
  marble: { rough: 0.2, metal: 0.1, paint: (c) => { c.fillStyle = '#ebe9e4'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(200,200,205,.35)', 'rgba(240,238,232,.5)'], 14, 30, 70, 97); veins(c, 'rgba(70,72,84,.55)', 2.6, 5, 98); veins(c, 'rgba(120,122,134,.4)', 1.2, 7, 99); } },
  circuit: {
    rough: 0.45, metal: 0.3, shader: 'dataflow',
    paint: (c) => { c.fillStyle = '#0d2619'; c.fillRect(0, 0, SIZE, SIZE); circuit(c, '#2f6e48', 3, 101); },
    emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); circuit(c, '#39ff88', 1.5, 101); },
  },
  sakura: { rough: 0.5, metal: 0.1, paint: (c) => { c.fillStyle = '#1d1519'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(102); for (let i = 0; i < 34; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 4 + r() * 6, turn = r() * 6; wrapped((dx, dy) => { c.fillStyle = r() < 0.5 ? '#ff9ec7' : '#ffd1e3'; for (let k = 0; k < 5; k += 1) { const a = turn + (k * Math.PI * 2) / 5; c.beginPath(); c.ellipse(x + dx + Math.cos(a) * s, y + dy + Math.sin(a) * s, s * 0.7, s * 0.45, a, 0, Math.PI * 2); c.fill(); } c.fillStyle = '#ffe07a'; c.beginPath(); c.arc(x + dx, y + dy, s * 0.35, 0, Math.PI * 2); c.fill(); }); } } },
  frost: { rough: 0.2, metal: 0.3, shader: 'glint', paint: (c) => { const g = c.createLinearGradient(0, 0, SIZE, SIZE); g.addColorStop(0, '#9fd0ea'); g.addColorStop(0.5, '#c4e6f6'); g.addColorStop(1, '#9fd0ea'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(220,242,252,.6)', 'rgba(120,180,215,.5)'], 22, 14, 36, 103); crystals(c, 'rgba(255,255,255,.85)', 104); }, emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); crystals(c, '#ffffff', 104); } },
  toxic: { rough: 0.5, metal: 0.2, shader: 'ooze', paint: (c) => { c.fillStyle = '#18220e'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#2c3d16', '#101806'], 30, 10, 26, 105); }, emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(110,255,40,.85)', 'rgba(70,200,20,.6)'], 26, 4, 12, 106); } },
  graffiti: { rough: 0.55, metal: 0.05, paint: (c) => { c.fillStyle = '#5f646b'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#ff3d7f', '#2fd6ff', '#ffe23d', '#7cff4f', '#a45cff', '#ff8a1f'], 40, 8, 26, 107); lines(c, '#111', 3, 16, 108, [20, 70]); lines(c, '#fff', 2, 10, 109, [20, 60]); } },
  lava: { rough: 0.85, metal: 0.05, shader: 'magma', paint: (c) => { c.fillStyle = '#1b1310'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#2a1c16', '#120c0a'], 40, 10, 30, 110); grain(c, 0.12, 111); } },
  dragon: { rough: 0.35, metal: 0.45, shader: 'iridescent', paint: (c) => { c.fillStyle = '#5c0c10'; c.fillRect(0, 0, SIZE, SIZE); for (let row = 0; row < 17; row += 1) for (let col = -1; col <= 8; col += 1) { const x = col * 32 + (row % 2 ? 16 : 0), y = row * 16; const g = c.createRadialGradient(x, y - 6, 2, x, y, 18); g.addColorStop(0, '#b3242a'); g.addColorStop(0.75, '#5c0c10'); g.addColorStop(1, '#d49a2a'); c.fillStyle = g; c.beginPath(); c.arc(x, y, 17, 0, Math.PI); c.fill(); c.strokeStyle = '#d49a2a'; c.lineWidth = 1.5; c.stroke(); } } },
  hexcore: { rough: 0.4, metal: 0.4, shader: 'hexwave', paint: (c) => { c.fillStyle = '#101418'; c.fillRect(0, 0, SIZE, SIZE); hexes(c, '#2a323b', 3, '#151a1f'); }, emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); hexes(c, '#ffffff', 2); } },
  aurora: { rough: 0.35, metal: 0.2, shader: 'aurora', paint: (c) => { const g = c.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, '#071022'); g.addColorStop(0.5, '#0b1a2e'); g.addColorStop(1, '#071022'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); grain(c, 0.05, 112); } },
  inferno: { rough: 0.7, metal: 0.1, shader: 'inferno', paint: (c) => { c.fillStyle = '#0c0605'; c.fillRect(0, 0, SIZE, SIZE); grain(c, 0.08, 113); } },
  hologram: { rough: 0.2, metal: 0.2, shader: 'hologram', paint: (c) => { c.fillStyle = '#062630'; c.fillRect(0, 0, SIZE, SIZE); c.strokeStyle = 'rgba(80,230,255,.35)'; c.lineWidth = 1; for (let k = 0; k <= SIZE; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, SIZE); c.moveTo(0, k); c.lineTo(SIZE, k); c.stroke(); } } },
  prism: { rough: 0.15, metal: 0.4, shader: 'prism', paint: (c) => { const g = c.createLinearGradient(0, 0, SIZE, SIZE); ['#ff5a8a', '#ffd35a', '#5affb0', '#5ab8ff', '#b05aff', '#ff5a8a'].forEach((color, i) => g.addColorStop(i / 5, color)); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); } },
  gilded: { rough: 0.3, metal: 0.55, shader: 'shine', paint: (c) => { const g = c.createLinearGradient(0, 0, SIZE, SIZE); g.addColorStop(0, '#d4ad55'); g.addColorStop(0.5, '#b98d36'); g.addColorStop(1, '#d4ad55'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); filigree(c, 'rgba(82,54,8,.6)', 64); } },
  void: {
    rough: 0.3, metal: 0.4, shader: 'starfield',
    paint: (c) => { c.fillStyle = '#08070e'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(88,40,160,.35)', 'rgba(30,20,80,.45)'], 16, 20, 50, 71); },
    emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(140,70,255,.25)'], 10, 16, 40, 72); const r = rng(73); for (let i = 0; i < 90; i += 1) { c.fillStyle = `rgba(230,220,255,${0.4 + r() * 0.6})`; c.fillRect(r() * SIZE, r() * SIZE, 1.5, 1.5); } },
  },
  // Common additions: plain, grounded paint.
  gunmetal: { rough: 0.4, metal: 0.55, paint: (c) => { c.fillStyle = '#3a414b'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(150); for (let y = 0; y < SIZE; y += 1) { c.fillStyle = `rgba(${r() < 0.5 ? '18,22,30' : '160,175,195'},${r() * 0.12})`; c.fillRect(0, y, SIZE, 1); } grain(c, 0.04, 151); } },
  coyote: { paint: solid('#8a6a45', 152), rough: 0.85, metal: 0.05 },
  navy: { paint: solid('#1b2a4a', 153), rough: 0.6, metal: 0.2 },
  brick: { rough: 0.9, metal: 0.05, paint: (c) => { c.fillStyle = '#8e3a2c'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(60,18,12,.16)', 'rgba(176,92,70,.14)'], 30, 8, 22, 154); grain(c, 0.13, 155); } },
  multicam: { rough: 0.8, metal: 0.05, paint: (c) => { c.fillStyle = '#b09d74'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#c7b88f', '#9a8a60'], 26, 16, 36, 156); blobs(c, ['#6f7a4a', '#7e6546', '#5d6a3e'], 30, 8, 22, 157); lines(c, '#3a3122', 2.2, 26, 158, [8, 22]); blobs(c, ['#3a3122'], 18, 2, 4, 159); grain(c, 0.06, 160); } },
  snowcamo: { rough: 0.75, metal: 0.05, paint: (c) => { c.fillStyle = '#eef1f3'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#c9cfd4', '#dde2e6', '#b7bec5'], 28, 12, 30, 161); blobs(c, ['#5a524a', '#6b645c'], 10, 5, 12, 162); grain(c, 0.05, 163); } },
  nightcamo: { rough: 0.7, metal: 0.15, paint: (c) => { c.fillStyle = '#12151f'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#252c3d', '#1a2030', '#303a4f'], 32, 12, 32, 164); grain(c, 0.05, 165); } },
  walnut: { rough: 0.6, metal: 0.05, paint: (c) => { c.fillStyle = '#6a4125'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(166); for (let i = 0; i < 70; i += 1) { const y0 = r() * SIZE, a = 2 + r() * 5, n = 1 + Math.floor(r() * 3), ph = r() * 6.28; c.strokeStyle = r() < 0.6 ? `rgba(38,20,8,${0.25 + r() * 0.4})` : `rgba(160,104,60,${0.2 + r() * 0.3})`; c.lineWidth = 0.6 + r() * 1.8; for (const dy of [-SIZE, 0, SIZE]) { c.beginPath(); for (let x = 0; x <= SIZE; x += 8) c.lineTo(x, y0 + dy + Math.sin((x / SIZE) * Math.PI * 2 * n + ph) * a + Math.sin((x / SIZE) * Math.PI * 6 + i) * 1.5); c.stroke(); } } for (const [kx, ky] of [[70, 60], [190, 170], [30, 214]]) wrapped((dx, dy) => { for (let k = 5; k >= 1; k -= 1) { c.fillStyle = k % 2 ? 'rgba(45,24,10,.55)' : 'rgba(110,68,36,.6)'; c.beginPath(); c.ellipse(kx + dx, ky + dy, k * 3.2, k * 1.6, 0, 0, Math.PI * 2); c.fill(); } }); grain(c, 0.06, 167); } },
  // Rare additions.
  topo: { rough: 0.75, metal: 0.05, paint: (c) => { contours(c, (band) => (band % 2 ? [150, 146, 102] : [136, 134, 90]), [52, 50, 30], 168); grain(c, 0.05, 169); } },
  python: { rough: 0.55, metal: 0.1, paint: (c) => {
    c.fillStyle = '#cdb68c'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(170);
    for (let i = 0; i < 13; i += 1) {
      const x = r() * SIZE, y = r() * SIZE, parts = Array.from({ length: 5 }, () => [(r() - 0.5) * 30, (r() - 0.5) * 18, 7 + r() * 8, r() * 3]);
      for (const [color, grow] of [['#23170c', 3], ['#5b3c20', 0], ['#86653e', -5]]) { c.fillStyle = color; wrapped((dx, dy) => { for (const [ox, oy, s, a] of parts) if (s + grow > 1) { c.beginPath(); c.ellipse(x + dx + ox, y + dy + oy, s + grow, (s + grow) * 0.7, a, 0, Math.PI * 2); c.fill(); } }); }
    }
    c.strokeStyle = 'rgba(40,28,14,.28)'; c.lineWidth = 0.8; c.beginPath(); for (let k = -SIZE; k <= SIZE * 2; k += 8) { c.moveTo(k, 0); c.lineTo(k + SIZE, SIZE); c.moveTo(k, 0); c.lineTo(k - SIZE, SIZE); } c.stroke();
    grain(c, 0.07, 171);
  } },
  kevlar: { rough: 0.5, metal: 0.2, paint: (c) => { for (let x = 0; x < SIZE; x += 16) for (let y = 0; y < SIZE; y += 16) { const across = ((x + y) / 16) % 2 === 0; const g = across ? c.createLinearGradient(x, y, x + 16, y) : c.createLinearGradient(x, y, x, y + 16); g.addColorStop(0, '#7d5c0e'); g.addColorStop(0.5, '#e6bd45'); g.addColorStop(1, '#7d5c0e'); c.fillStyle = g; c.fillRect(x, y, 16, 16); c.fillStyle = 'rgba(90,60,5,.35)'; for (let k = 3; k < 16; k += 4) { if (across) c.fillRect(x + k, y, 1, 16); else c.fillRect(x, y + k, 16, 1); } } grain(c, 0.05, 172); } },
  racing: { rough: 0.15, metal: 0.25, paint: (c) => { const g = c.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, '#1a42a8'); g.addColorStop(0.5, '#0f2a78'); g.addColorStop(1, '#1a42a8'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(0, 70, SIZE, 26); c.fillStyle = '#f4f5f7'; for (const y of [5, SIZE - 25]) c.fillRect(0, y, SIZE, 20); grain(c, 0.03, 173); } },
  giraffe: { rough: 0.7, metal: 0.05, paint: (c) => { const browns = [[150, 86, 40], [128, 70, 32], [166, 102, 52], [112, 60, 28]]; voronoi(c, 5, 174, (i, e) => { const t = Math.max(0, Math.min(1, (e - 5) / 2.5)), deep = 1 - Math.min(e, 40) / 200, b = browns[i % 4]; return [236 + (b[0] * deep - 236) * t, 222 + (b[1] * deep - 222) * t, 190 + (b[2] * deep - 190) * t]; }); grain(c, 0.07, 175); } },
  denim: { rough: 0.85, metal: 0.05, paint: (c) => {
    c.fillStyle = '#2f4d7c'; c.fillRect(0, 0, SIZE, SIZE);
    c.strokeStyle = 'rgba(190,210,235,.22)'; c.lineWidth = 1.4; c.beginPath(); for (let k = -SIZE; k < SIZE * 2; k += 4) { c.moveTo(k, 0); c.lineTo(k + SIZE / 2, SIZE); } c.stroke();
    c.strokeStyle = 'rgba(8,18,40,.3)'; c.lineWidth = 1; c.beginPath(); for (let k = -SIZE + 2; k < SIZE * 2; k += 4) { c.moveTo(k, 0); c.lineTo(k + SIZE / 2, SIZE); } c.stroke();
    const r = rng(176);
    for (let i = 0; i < 7; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 14 + r() * 22; wrapped((dx, dy) => { const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, s); g.addColorStop(0, 'rgba(175,198,228,.45)'); g.addColorStop(1, 'rgba(175,198,228,0)'); c.fillStyle = g; c.fillRect(x + dx - s, y + dy - s, s * 2, s * 2); }); }
    c.fillStyle = 'rgba(10,22,48,.35)'; c.fillRect(0, 18, SIZE, 12); c.fillRect(226, 0, 12, SIZE);
    c.strokeStyle = '#e08a2e'; c.lineWidth = 1.6; c.setLineDash([5, 3]); c.beginPath(); for (const y of [16, 32]) { c.moveTo(0, y); c.lineTo(SIZE, y); } for (const x of [224, 240]) { c.moveTo(x, 0); c.lineTo(x, SIZE); } c.stroke(); c.setLineDash([]);
    grain(c, 0.08, 177);
  } },
  honeycomb: { rough: 0.3, metal: 0.3, paint: (c) => { c.fillStyle = '#b87a14'; c.fillRect(0, 0, SIZE, SIZE); hexes(c, '#5a3505', 6, '#d99a26'); blobs(c, ['rgba(255,214,110,.3)', 'rgba(140,70,5,.3)'], 40, 3, 8, 178); hexes(c, '#5a3505', 5); hexes(c, 'rgba(255,226,150,.55)', 1.2); } },
  ducttape: { rough: 0.65, metal: 0.1, paint: (c) => {
    c.fillStyle = '#3a3d41'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(179);
    for (let i = 0; i < 14; i += 1) {
      const x = r() * SIZE, y = r() * SIZE, a = (r() - 0.5) * 1.4 + (i % 2 ? Math.PI / 2 : 0), l = 110 + r() * 110, w = 28 + r() * 10, black = i === 4 || i === 10, fill = black ? '#1c1d20' : ['#a7abaf', '#989ca1', '#b5b8bb'][i % 3], tear = Array.from({ length: 8 }, () => (r() - 0.5) * 7);
      wrapped((dx, dy) => {
        c.save(); c.translate(x + dx, y + dy); c.rotate(a);
        c.beginPath(); c.moveTo(-l / 2, -w / 2); c.lineTo(l / 2, -w / 2); tear.slice(0, 4).forEach((t, k) => c.lineTo(l / 2 + t, -w / 2 + ((k + 1) / 4) * w)); c.lineTo(-l / 2, w / 2); tear.slice(4).forEach((t, k) => c.lineTo(-l / 2 + t, w / 2 - ((k + 1) / 4) * w)); c.closePath();
        c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 3; c.stroke(); c.fillStyle = fill; c.fill(); c.clip();
        c.strokeStyle = black ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.09)'; c.lineWidth = 1; c.beginPath(); for (let k = -w / 2; k < w / 2; k += 2.5) { c.moveTo(-l / 2 - 8, k); c.lineTo(l / 2 + 8, k); } for (let k = -l / 2; k < l / 2; k += 3) { c.moveTo(k, -w / 2); c.lineTo(k, w / 2); } c.stroke();
        const g = c.createLinearGradient(0, -w / 2, 0, w / 2); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.15)'); c.fillStyle = g; c.fillRect(-l / 2 - 8, -w / 2, l + 16, w);
        c.restore();
      });
    }
  } },
  // Epic additions. The horizon of the vaporwave scene sits on the tile edge, where the gun's flanks sample.
  vaporwave: { rough: 0.35, metal: 0.1, paint: (c) => {
    const sky = c.createLinearGradient(0, 128, 0, SIZE); sky.addColorStop(0, '#2a1060'); sky.addColorStop(0.45, '#01cdfe'); sky.addColorStop(1, '#ff71ce');
    c.fillStyle = sky; c.fillRect(0, 128, SIZE, 128);
    const ground = c.createLinearGradient(0, 0, 0, 128); ground.addColorStop(0, '#b967ff'); ground.addColorStop(1, '#2a1060');
    c.fillStyle = ground; c.fillRect(0, 0, SIZE, 128);
    const r = rng(180); c.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 24; i += 1) c.fillRect(r() * SIZE, 130 + r() * 40, 1.5, 1.5);
    const sun = c.createLinearGradient(0, 190, 0, SIZE); sun.addColorStop(0, '#fff36b'); sun.addColorStop(1, '#ff4fa3');
    c.fillStyle = sun; c.beginPath(); c.arc(128, SIZE, 62, Math.PI, 0); c.fill();
    c.fillStyle = sky; for (let k = 0; k < 6; k += 1) c.fillRect(0, 216 + k * 7, SIZE, 1.5 + k * 0.8);
    c.strokeStyle = '#01cdfe'; c.lineWidth = 1.5; for (let k = -8; k <= 8; k += 1) { c.beginPath(); c.moveTo(128 + k * 3, 0); c.lineTo(128 + k * 16, 128); c.stroke(); }
    c.strokeStyle = '#ff71ce'; for (let k = 1; k <= 7; k += 1) { const y = 128 * (k / 8) ** 2; c.lineWidth = 0.6 + k * 0.2; c.beginPath(); c.moveTo(0, y); c.lineTo(SIZE, y); c.stroke(); }
    c.fillStyle = '#ffd6f2'; c.fillRect(0, 0, SIZE, 1.5); c.fillRect(0, SIZE - 1.5, SIZE, 1.5);
  } },
  stained: { rough: 0.2, metal: 0.1, paint: (c) => { const jewels = [[200, 20, 50], [20, 90, 200], [20, 160, 90], [230, 170, 20], [120, 40, 170], [230, 90, 20], [20, 170, 190]]; voronoi(c, 6, 181, (i, e, x, y) => { if (e < 4) return [18, 16, 20]; const j = jewels[(i * 5 + 3) % jewels.length], f = (0.72 + 0.28 * Math.min(1, e / 18)) * (0.85 + 0.15 * Math.sin((x / SIZE) * Math.PI * 6 + i) * Math.cos((y / SIZE) * Math.PI * 4 + i * 2)), t = Math.min(1, (e - 4) / 1.5); return [18 + (j[0] * f - 18) * t, 16 + (j[1] * f - 16) * t, 20 + (j[2] * f - 20) * t]; }); } },
  comic: { rough: 0.55, metal: 0.05, paint: (c) => {
    c.fillStyle = '#ffe14d'; c.fillRect(0, 0, SIZE, SIZE);
    c.fillStyle = '#ff4a3d'; for (let x = 0; x < SIZE; x += 8) for (let y = 0; y < SIZE; y += 8) { const s = 0.5 + 0.5 * Math.sin(((x + y) / SIZE) * Math.PI * 4); c.beginPath(); c.arc(x + 4, y + 4, 0.6 + s * 2.6, 0, Math.PI * 2); c.fill(); }
    const r = rng(182);
    for (let i = 0; i < 5; i += 1) {
      const x = r() * SIZE, y = r() * SIZE, rx = 22 + r() * 18, ry = rx * (0.6 + r() * 0.4), a = r() * 3;
      wrapped((dx, dy) => {
        if (x + dx < -60 || x + dx > SIZE + 60 || y + dy < -60 || y + dy > SIZE + 60) return;
        c.save(); c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, a, 0, Math.PI * 2); c.fillStyle = '#1f5fd6'; c.fill(); c.clip();
        c.fillStyle = 'rgba(255,255,255,.55)'; for (let px = -42; px <= 42; px += 7) for (let py = -42; py <= 42; py += 7) { c.beginPath(); c.arc(x + dx + px, y + dy + py, 1.6, 0, Math.PI * 2); c.fill(); }
        c.restore(); c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, a, 0, Math.PI * 2); c.stroke();
      });
    }
    for (const [x, y, R, fill] of [[60, 20, 34, '#ff2d2d'], [190, 150, 28, '#ffffff'], [128, 236, 24, '#1f5fd6']]) wrapped((dx, dy) => {
      for (const [scale, color] of [[1, fill], [0.5, fill === '#ff2d2d' ? '#ffe14d' : '#ff2d2d']]) { c.beginPath(); for (let k = 0; k < 24; k += 1) { const a = (k / 24) * Math.PI * 2, rr = (k % 2 ? R * 0.55 : R * (0.9 + ((k * 7) % 5) * 0.05)) * scale; c.lineTo(x + dx + Math.cos(a) * rr, y + dy + Math.sin(a) * rr); } c.closePath(); c.fillStyle = color; c.fill(); c.strokeStyle = '#111'; c.lineWidth = scale > 0.6 ? 3.5 : 2; c.stroke(); }
    });
    lines(c, '#111', 2.5, 10, 183, [10, 26]);
  } },
  pixel: { rough: 0.6, metal: 0.05, paint: (c) => {
    c.fillStyle = '#5c94fc'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(184); c.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 16; i += 1) c.fillRect(Math.floor(r() * 32) * 8 + 2, Math.floor(r() * 32) * 8 + 2, 4, 4);
    const ink = { k: '#101018', r: '#e8323c', w: '#ffffff', y: '#ffd23f', o: '#d68a1c', c: '#fcfcfc', g: '#bcd4fc' };
    const art = { heart: ['.kk.kk.', 'kwrkrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'], coin: ['.kkk.', 'kywok', 'kywok', 'kywok', 'kywok', 'kyyok', '.kkk.'], cloud: ['...cc.ccc..', '.ccccccccc.', 'ccccccccccc', '.ggggggggg.'] };
    const stamp = (name, gx, gy) => art[name].forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.') return; c.fillStyle = ink[ch]; c.fillRect(((gx + x) % 32) * 8, ((gy + y) % 32) * 8, 8, 8); }));
    for (const [name, gx, gy] of [['cloud', 2, 1], ['cloud', 17, 17], ['cloud', 24, 5], ['heart', 15, 7], ['heart', 4, 22], ['heart', 26, 26], ['coin', 8, 10], ['coin', 21, 24], ['coin', 13, 27], ['coin', 28, 12]]) stamp(name, gx, gy);
  } },
  patina: { rough: 0.6, metal: 0.45, paint: (c) => {
    c.fillStyle = '#a45a32'; c.fillRect(0, 0, SIZE, SIZE);
    blobs(c, ['rgba(206,124,72,.45)', 'rgba(110,52,26,.45)'], 30, 10, 30, 185);
    const r = rng(186);
    for (let b = 0; b < 7; b += 1) {
      const bx = r() * SIZE, by = r() * SIZE;
      for (let i = 0; i < 40; i += 1) { const x = bx + (r() + r() - 1) * 34, y = by + (r() + r() - 1) * 34, s = 2 + r() * 9, color = ['rgba(90,185,165,.8)', 'rgba(60,150,140,.75)', 'rgba(140,210,190,.7)', 'rgba(40,110,105,.6)'][i % 4]; wrapped((dx, dy) => { c.fillStyle = color; c.beginPath(); c.ellipse(x + dx, y + dy, s, s * 0.8, i, 0, Math.PI * 2); c.fill(); }); }
    }
    grain(c, 0.12, 187);
  } },
  terrazzo: { rough: 0.3, metal: 0.05, paint: (c) => {
    c.fillStyle = '#ece6da'; c.fillRect(0, 0, SIZE, SIZE); grain(c, 0.05, 188);
    const r = rng(189), chips = ['#c9553f', '#2f6f8f', '#e0a83a', '#4d8a5a', '#8a8f96', '#d89aa8', '#1f2a33', '#f7f4ee', '#b5793d'];
    for (let i = 0; i < 230; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 2 + r() * (i < 30 ? 10 : 5), a = r() * 6.28, sides = 3 + Math.floor(r() * 4), jag = Array.from({ length: sides }, () => 0.6 + r() * 0.6); c.fillStyle = chips[Math.floor(r() * chips.length)]; wrapped((dx, dy) => { c.beginPath(); jag.forEach((j, k) => { const t = a + (k / sides) * Math.PI * 2; c.lineTo(x + dx + Math.cos(t) * s * j, y + dy + Math.sin(t) * s * j); }); c.fill(); }); }
  } },
  glacier: { rough: 0.2, metal: 0.2, paint: (c) => {
    const r = rng(190), blues = ['#e6f4fb', '#c8e6f5', '#a9d5ee', '#86bfe3', '#5f9fd0', '#3f7fb9', '#2a5f9a', '#d6edf8'], band = Array.from({ length: 16 }, () => blues[Math.floor(r() * blues.length)]);
    const edge = (x, k) => k * 16 + Math.sin((x / SIZE) * Math.PI * 4 + (k * Math.PI * 3) / 8) * 6;
    for (let k = -1; k <= 16; k += 1) { c.fillStyle = band[(k + 16) % 16]; c.beginPath(); for (let x = 0; x <= SIZE; x += 8) c.lineTo(x, edge(x, k)); for (let x = SIZE; x >= 0; x -= 8) c.lineTo(x, edge(x, k + 1)); c.fill(); }
    blobs(c, ['rgba(255,255,255,.25)', 'rgba(20,70,130,.18)'], 26, 14, 40, 191);
    veins(c, 'rgba(240,250,255,.85)', 1.6, 6, 192); lines(c, 'rgba(18,60,110,.5)', 1, 22, 193, [8, 40]); lines(c, 'rgba(255,255,255,.6)', 0.8, 18, 194, [6, 30]);
  } },
  // Legendary additions.
  meteorite: { rough: 0.3, metal: 0.5, paint: (c) => {
    c.fillStyle = '#5a5f65'; c.fillRect(0, 0, SIZE, SIZE);
    blobs(c, ['rgba(40,44,50,.5)', 'rgba(120,126,132,.35)'], 60, 3, 9, 195);
    const r = rng(196), greys = ['#9aa1a8', '#b3b9bf', '#848b92', '#a8aeb4', '#8f969d', '#c0c5ca'];
    for (let i = 0; i < 80; i += 1) {
      const x = r() * SIZE, y = r() * SIZE, a = (i % 3) * (Math.PI / 3) + 0.35 + (r() - 0.5) * 0.06, l = 50 + r() * 150, w = 4 + r() * 10, fill = greys[Math.floor(r() * greys.length)];
      wrapped((dx, dy) => { c.save(); c.translate(x + dx, y + dy); c.rotate(a); c.fillStyle = 'rgba(28,30,34,.7)'; c.fillRect(-l / 2 - 1.5, -w / 2 - 1.5, l + 3, w + 3); c.fillStyle = fill; c.fillRect(-l / 2, -w / 2, l, w); c.fillStyle = 'rgba(235,238,240,.8)'; c.fillRect(-l / 2, -w / 2, l, 1); c.fillRect(-l / 2, w / 2 - 1, l, 1); c.restore(); });
    }
    grain(c, 0.1, 197);
  } },
  pearl: { rough: 0.15, metal: 0.25, paint: (c) => {
    const img = c.createImageData(SIZE, SIZE), T = (Math.PI * 2) / SIZE;
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      const u = x * T, v = y * T, s = Math.sin(2 * u + 1.6 * Math.sin(v + 1.3 * Math.cos(u))) + Math.cos(3 * v - u + 1.2 * Math.sin(2 * u)) * 0.7, t = s * 0.9 + Math.sin(u + 2 * v) * 0.4, ring = 0.5 + 0.5 * Math.sin(t * 14), i = (y * SIZE + x) * 4;
      img.data[i] = 226 + 22 * Math.cos(t * 2.1) - ring * 8; img.data[i + 1] = 228 + 22 * Math.cos(t * 2.1 + 2.1) - ring * 8; img.data[i + 2] = 232 + 20 * Math.cos(t * 2.1 + 4.2) - ring * 6; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    blobs(c, ['rgba(255,255,255,.18)'], 24, 10, 30, 198);
  } },
  lacquer: { rough: 0.08, metal: 0.2, paint: (c) => {
    c.fillStyle = '#86101a'; c.fillRect(0, 0, SIZE, SIZE);
    blobs(c, ['rgba(40,0,6,.22)', 'rgba(170,30,40,.18)'], 22, 20, 50, 199);
    c.strokeStyle = '#d9b04f'; c.lineWidth = 1.1;
    for (const y0 of [22, 150]) for (const off of [0, 5]) { c.beginPath(); for (let x = 0; x <= SIZE; x += 4) c.lineTo(x, y0 + off + Math.sin((x / SIZE) * Math.PI * 4) * 10 + Math.sin((x / SIZE) * Math.PI * 10) * 2); c.stroke(); }
    for (const [x, y] of [[64, 86], [192, 214], [0, 214], [128, 86]]) wrapped((dx, dy) => { for (const s of [9, 5]) { c.beginPath(); c.arc(x + dx, y + dy, s, 0, Math.PI * 2); c.stroke(); } for (let k = 0; k < 5; k += 1) { const a = (k / 5) * Math.PI * 2; c.beginPath(); c.arc(x + dx + Math.cos(a) * 13, y + dy + Math.sin(a) * 13, 1.6, 0, Math.PI * 2); c.stroke(); } });
    const r = rng(200);
    for (let i = 0; i < 180; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 0.6 + r() * 2.2, a = r() * 6.28, color = `rgba(${r() < 0.5 ? '240,205,110' : '214,168,72'},${0.35 + r() * 0.65})`; wrapped((dx, dy) => { c.save(); c.translate(x + dx, y + dy); c.rotate(a); c.fillStyle = color; c.fillRect(-s, -s * 0.6, s * 2, s * 1.2); c.restore(); }); }
  } },
  // Scrimshaw: the sea surface sits just above the tile edge so the whale and the ship land on the gun's flanks.
  scrimshaw: { rough: 0.5, metal: 0.05, paint: (c) => {
    c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, SIZE, SIZE);
    blobs(c, ['rgba(196,164,110,.16)', 'rgba(255,250,235,.25)'], 26, 16, 44, 201);
    c.fillStyle = 'rgba(150,120,80,.12)'; for (let y = 3; y < SIZE; y += 7) c.fillRect(0, y, SIZE, 1);
    lines(c, 'rgba(90,70,45,.25)', 0.6, 14, 202, [10, 40]);
    const ink = '#2b2118'; c.strokeStyle = ink; c.lineCap = 'round';
    for (const y0 of [-22, 100, 170]) for (const dy of [0, SIZE]) {
      for (let row = 0; row < 3; row += 1) { c.lineWidth = 1.2 - row * 0.3; c.beginPath(); for (let x = 0; x <= SIZE; x += 2) c.lineTo(x, y0 + dy + row * 5 + Math.sin((x / SIZE) * Math.PI * 16) * 2.5); c.stroke(); }
      c.lineWidth = 1; for (let k = 0; k < 8; k += 1) { c.beginPath(); c.arc(k * 32 + 12, y0 + dy - 4, 4, Math.PI, Math.PI * 2.4); c.stroke(); }
    }
    const whale = () => { c.beginPath(); c.moveTo(-55, 0); c.bezierCurveTo(-30, -14, 10, -20, 40, -16); c.bezierCurveTo(56, -14, 60, 4, 50, 10); c.bezierCurveTo(20, 16, -30, 12, -55, 0); c.lineTo(-70, -10); c.quadraticCurveTo(-65, 0, -72, 10); c.closePath(); };
    wrapped((dx, dy) => {
      c.save(); c.translate(150 + dx, 12 + dy);
      whale(); c.fillStyle = 'rgba(60,45,30,.18)'; c.fill();
      c.save(); c.clip(); c.lineWidth = 0.7; c.beginPath(); for (let k = -90; k <= 90; k += 4) { c.moveTo(k - 25, -25); c.lineTo(k + 25, 25); } for (let k = -90; k <= 90; k += 4) { c.moveTo(k, 2); c.lineTo(k - 20, 22); } c.stroke(); c.restore();
      c.lineWidth = 1.6; whale(); c.stroke();
      c.lineWidth = 1; c.beginPath(); c.arc(36, -2, 1.6, 0, Math.PI * 2); c.moveTo(52, 8); c.lineTo(22, 10); c.moveTo(10, 8); c.quadraticCurveTo(4, 16, -4, 14); c.stroke();
      c.restore();
      c.save(); c.translate(48 + dx, SIZE - 26 + dy);
      c.beginPath(); c.moveTo(-24, -4); c.lineTo(24, -6); c.quadraticCurveTo(20, 6, 0, 6); c.quadraticCurveTo(-18, 6, -24, -4); c.closePath(); c.fillStyle = 'rgba(43,33,24,.85)'; c.fill();
      c.lineWidth = 1.2; c.beginPath(); c.moveTo(24, -6); c.lineTo(36, -16);
      for (const [m, top] of [[-9, -44], [8, -50]]) { c.moveTo(m, -4); c.lineTo(m, top); c.moveTo(m, top); c.lineTo(m + 7, top + 3); c.lineTo(m, top + 5); }
      c.stroke();
      c.lineWidth = 0.9;
      for (const [m, top] of [[-9, -44], [8, -50]]) for (const k of [0, 1]) { const t = top + 7 + k * 16; c.beginPath(); c.moveTo(m - 9, t); c.quadraticCurveTo(m, t + 3, m + 9, t); c.lineTo(m + 8, t + 12); c.quadraticCurveTo(m, t + 15, m - 8, t + 12); c.closePath(); c.stroke(); c.beginPath(); for (let h = -6; h <= 6; h += 3) { c.moveTo(m + h, t + 2); c.lineTo(m + h, t + 12); } c.stroke(); }
      c.restore();
    });
    c.save(); c.translate(200, 102); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-4, -10, -16, -14); c.quadraticCurveTo(-6, -6, 0, -8); c.quadraticCurveTo(6, -6, 16, -14); c.quadraticCurveTo(4, -10, 0, 0); c.fillStyle = 'rgba(43,33,24,.8)'; c.fill(); c.restore();
  } },
  abyss: {
    rough: 0.3, metal: 0.2, glow: 1.1,
    paint: (c) => { const g = c.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, '#020611'); g.addColorStop(0.5, '#04142a'); g.addColorStop(1, '#020611'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(10,40,80,.35)', 'rgba(0,0,0,.4)'], 20, 20, 50, 203); jellies(c, 'rgba(90,200,255,.22)', 204); },
    emit: (c) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE);
      const r = rng(205);
      for (let i = 0; i < 120; i += 1) { const x = r() * SIZE, y = r() * SIZE, s = 0.6 + r() * 1.6, col = r() < 0.75 ? '80,230,255' : '170,120,255', a = 0.45 + r() * 0.55; wrapped((dx, dy) => { const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, s * 3); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.fillRect(x + dx - s * 3, y + dy - s * 3, s * 6, s * 6); }); }
      jellies(c, 'rgba(111,227,255,.65)', 204);
    },
  },
  // Mythic additions: each one has its own shader below.
  plasma: { rough: 0.35, metal: 0.3, shader: 'plasma', paint: (c) => { c.fillStyle = '#0b0a1a'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(70,50,200,.25)', 'rgba(150,60,220,.2)'], 18, 16, 40, 206); veins(c, 'rgba(140,150,255,.8)', 1.6, 6, 207); veins(c, 'rgba(255,255,255,.7)', 0.6, 6, 207); } },
  glitch: { rough: 0.4, metal: 0.25, shader: 'glitch', paint: (c) => {
    c.fillStyle = '#17191f'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(208);
    for (let i = 0; i < 18; i += 1) { const y = Math.floor(r() * 32) * 8, h = 2 + Math.floor(r() * 3) * 3, x = r() * SIZE, len = 40 + r() * 180; c.fillStyle = ['#ff2e88', '#22e6ff', '#f2f2f2', '#2a2e38', '#b6ff3b'][i % 5]; c.fillRect(x, y, len, h); c.fillRect(x - SIZE, y, len, h); }
    for (let i = 0; i < 60; i += 1) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.7)' : 'rgba(34,230,255,.6)'; c.fillRect(Math.floor(r() * 32) * 8, Math.floor(r() * 32) * 8, 8, 4); }
    grain(c, 0.06, 209);
  } },
  quicksilver: { rough: 0.1, metal: 0.5, shader: 'quicksilver', paint: (c) => { const g = c.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, '#9aa3ad'); g.addColorStop(0.5, '#e4e8ec'); g.addColorStop(1, '#9aa3ad'); c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(255,255,255,.35)', 'rgba(60,68,80,.3)'], 26, 10, 30, 210); } },
  nebula: { rough: 0.3, metal: 0.2, shader: 'nebula', paint: (c) => { c.fillStyle = '#07060f'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(255,70,170,.3)', 'rgba(40,220,210,.25)', 'rgba(140,60,255,.3)'], 24, 18, 46, 211); const r = rng(212); for (let i = 0; i < 80; i += 1) { c.fillStyle = `rgba(255,250,240,${0.4 + r() * 0.6})`; c.fillRect(r() * SIZE, r() * SIZE, 1.5, 1.5); } } },
  spectre: { rough: 0.5, metal: 0.15, shader: 'spectre', paint: (c) => { c.fillStyle = '#0a0d15'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(60,100,180,.18)', 'rgba(0,0,0,.4)'], 20, 14, 40, 213); veins(c, 'rgba(150,200,255,.35)', 2.4, 5, 214); } },
  synthwave: { rough: 0.35, metal: 0.25, shader: 'synthwave', paint: (c) => {
    c.fillStyle = '#140822'; c.fillRect(0, 0, SIZE, SIZE);
    c.strokeStyle = 'rgba(255,40,190,.6)'; c.lineWidth = 2; for (let k = 0; k < SIZE; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, SIZE); c.stroke(); }
    c.strokeStyle = 'rgba(40,220,255,.6)'; c.lineWidth = 1.5; for (const y of [5, 13, 25, 41, 63, 91, 124]) for (const at of [y, SIZE - y]) { c.beginPath(); c.moveTo(0, at); c.lineTo(SIZE, at); c.stroke(); }
    c.fillStyle = '#ffb347'; c.fillRect(0, 0, SIZE, 2); c.fillRect(0, SIZE - 2, SIZE, 2);
  } },
  // Dev class: the developers' own finishes, animated and a clear step above the Mythics.
  devsource: {
    rough: 0.12, metal: 0.3, shader: 'devsource',
    paint: (c) => { c.fillStyle = '#030a0a'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['rgba(0,70,60,.25)', 'rgba(0,0,0,.5)'], 16, 20, 50, 215); c.fillStyle = 'rgba(0,255,198,.05)'; for (let y = 0; y < SIZE; y += 16) c.fillRect(0, y, SIZE, 1); },
    // Code on a 32 x 16 glyph grid: the shader scrolls each 16px row (and each 8px column) on its own.
    emit: (c) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE);
      const r = rng(216), words = ['const', 'let', 'fn', '=>', '{', '}', '()', '[]', 'if', 'else', 'return', '0x3f', '&&', '||', '!=', '===', '++', '//', '<>', 'aim', 'fire()', 'hit', 'k', 'dt', '42', '0', '1', ';', ':', '.x', '.y', 'null', 'true', '#', '$', '%', 'ping', 'sync()', '[i]', '->'];
      c.font = 'bold 11px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let row = 0; row < 16; row += 1) {
        if (r() < 0.12) continue;
        let line = ' '.repeat(Math.floor(r() * 3) * 2);
        while (line.length < 32) line += words[Math.floor(r() * words.length)] + (r() < 0.6 ? ' ' : '');
        for (let k = 0; k < 32; k += 1) { const ch = line[k]; if (ch === ' ') continue; c.fillStyle = /[0-9{}()[\]#$%<>=!&|]/.test(ch) ? `rgba(255,181,71,${0.55 + r() * 0.45})` : `rgba(0,255,198,${0.4 + r() * 0.6})`; c.fillText(ch, k * 8 + 4, row * 16 + 8); }
        if (r() < 0.25) { c.fillStyle = '#00ffc6'; c.fillRect(Math.min(line.trimEnd().length, 31) * 8 + 1, row * 16 + 3, 6, 10); }
      }
    },
  },
  singularity: { rough: 0.2, metal: 0.3, shader: 'singularity', paint: (c) => {
    c.fillStyle = '#010103'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(217); for (let i = 0; i < 70; i += 1) { c.fillStyle = `rgba(220,225,255,${0.3 + r() * 0.7})`; c.fillRect(r() * SIZE, r() * SIZE, 1.2, 1.2); }
    for (let k = 0; k < 90; k += 1) { const a = k * 0.21, rr = 20 + k * 0.9; c.strokeStyle = `hsla(${20 + k * 2.8},100%,${70 - k * 0.35}%,${0.55 - k * 0.004})`; c.lineWidth = 2.2 - k * 0.015; c.beginPath(); c.arc(128, 128, rr, a, a + 1.4); c.stroke(); }
    c.fillStyle = '#000'; c.beginPath(); c.arc(128, 128, 18, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff1d6'; c.lineWidth = 2; c.stroke();
  } },
  overclock: {
    rough: 0.35, metal: 0.45, shader: 'overclock',
    paint: (c) => { c.fillStyle = '#101218'; c.fillRect(0, 0, SIZE, SIZE); c.fillStyle = 'rgba(255,255,255,.04)'; for (let y = 0; y < SIZE; y += 8) c.fillRect(0, y, SIZE, 3); wrappedCircuit(c, '#262d3a', 3, 218); },
    emit: (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, SIZE, SIZE); const g = c.createLinearGradient(0, 0, SIZE, 0); ['#2040ff', '#c020ff', '#ff4010', '#ffd040', '#ffffff', '#ffd040', '#ff4010', '#c020ff', '#2040ff'].forEach((color, i) => g.addColorStop(i / 8, color)); wrappedCircuit(c, g, 1.6, 218); },
  },
};
// Suit patterns are grey: they multiply the pilot's suit colour instead of replacing it.
const PATTERN_ART = {
  urban: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#9a9a9a', '#6a6a6a', '#c4c4c4'], 36, 12, 30, 121); },
  flecktarn: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#6f6f6f', '#a5a5a5', '#4c4c4c'], 260, 3, 7, 122); },
  splinter: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); const r = rng(123); for (let i = 0; i < 44; i += 1) { const x = r() * SIZE, y = r() * SIZE, a = r() * Math.PI, l = 30 + r() * 60; c.fillStyle = ['#7a7a7a', '#a8a8a8', '#5a5a5a'][i % 3]; wrapped((dx, dy) => { c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); c.lineTo(x + dx + Math.cos(a + 0.35) * l * 0.6, y + dy + Math.sin(a + 0.35) * l * 0.6); c.fill(); }); } },
  stripes: (c) => stripes(c, '#ffffff', '#6a6a6a', 10, 2, 9, 124),
  hex: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); hexes(c, '#707070', 3); },
  woodland: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#8a8a8a', '#b4b4b4', '#5e5e5e'], 34, 14, 34, 81); },
  digital: (c) => { const r = rng(82), greys = ['#ffffff', '#c8c8c8', '#8e8e8e', '#dcdcdc']; for (let x = 0; x < SIZE; x += 8) for (let y = 0; y < SIZE; y += 8) { c.fillStyle = greys[Math.floor(r() * 4)]; c.fillRect(x, y, 8, 8); } },
  tiger: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); c.fillStyle = '#5a5a5a'; for (let i = 0; i < 14; i += 1) { const x0 = (i / 14) * SIZE; c.beginPath(); for (let y = 0; y <= SIZE; y += 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * 8 - 3, y); for (let y = SIZE; y >= 0; y -= 8) c.lineTo(x0 + Math.sin((y / SIZE) * Math.PI * 4 + i) * 8 + 4, y); c.fill(); } },
  multicam: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); blobs(c, ['#d2d2d2', '#b0b0b0', '#949494'], 30, 10, 26, 220); lines(c, '#5a5a5a', 2.4, 22, 221, [8, 20]); blobs(c, ['#5a5a5a'], 14, 2, 4, 222); },
  chevron: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); c.lineWidth = 9; c.lineJoin = 'miter'; for (let row = -1; row <= 8; row += 1) { c.strokeStyle = row % 2 ? '#8a8a8a' : '#5e5e5e'; c.beginPath(); for (let x = -32; x <= SIZE + 32; x += 32) c.lineTo(x, row * 32 + (x % 64 ? 14 : -2)); c.stroke(); } },
  topo: (c) => contours(c, (band) => (band % 2 ? [236, 236, 236] : [255, 255, 255]), [96, 96, 96], 223),
  honeycomb: (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE);
    const r = rng(224), cw = SIZE / 8, rh = SIZE / 10;
    for (let row = 0; row < 10; row += 1) for (let col = 0; col < 8; col += 1) if (r() < 0.22) { const x = col * cw + (row % 2 ? cw / 2 : 0), y = row * rh; wrapped((dx, dy) => { c.fillStyle = '#c2c2c2'; c.beginPath(); for (let k = 0; k < 6; k += 1) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(x + dx + Math.cos(a) * 15, y + dy + Math.sin(a) * 15 * 0.92); } c.fill(); }); }
    hexes(c, '#7a7a7a', 6); hexes(c, '#bdbdbd', 1.5);
  },
  // Dazzle: big cells, each with its own stripe angle, so the stripes break at every border.
  dazzle: (c) => { const dirs = [[5, 5], [-4, 6], [7, -2], [2, 7], [-6, -3], [6, 1], [1, -6], [-5, 2], [3, 4]]; voronoi(c, 3, 225, (i, e, x, y) => { if (i % 4 === 3) return i % 8 === 3 ? [62, 62, 62] : [255, 255, 255]; const [m, n] = dirs[i % dirs.length], s = Math.sin(((m * x + n * y) / SIZE) * Math.PI * 2 + i * 1.7); if (s > 0.1) return [58, 58, 58]; return s > -0.35 && i % 3 === 0 ? [150, 150, 150] : [255, 255, 255]; }); },
  scales: (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, SIZE, SIZE); for (let row = -2; row <= 17; row += 1) for (let col = -1; col <= 8; col += 1) { const x = col * 32 + (row % 2 ? 16 : 0), y = row * 16; const g = c.createRadialGradient(x, y - 8, 2, x, y, 17); g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#d4d4d4'); g.addColorStop(1, '#8e8e8e'); c.fillStyle = g; c.beginPath(); c.arc(x, y, 16, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#626262'; c.lineWidth = 1.6; c.stroke(); } },
  devcircuit: (c) => { c.fillStyle = '#8a8a8a'; c.fillRect(0, 0, SIZE, SIZE); wrappedCircuit(c, '#f2f2f2', 3, 226); for (const [x, y, w, h] of [[40, 40, 40, 28], [168, 104, 32, 40], [72, 192, 48, 32], [216, 224, 32, 24]]) wrapped((dx, dy) => { c.fillStyle = '#e6e6e6'; for (let k = 4; k < w; k += 8) c.fillRect(x + dx + k, y + dy - 5, 3, h + 10); for (let k = 4; k < h; k += 8) c.fillRect(x + dx - 5, y + dy + k, w + 10, 3); c.fillStyle = '#3a3a3a'; c.fillRect(x + dx, y + dy, w, h); c.fillStyle = '#5a5a5a'; c.fillRect(x + dx + 4, y + dy + 4, w - 8, h - 8); }); },
};

const textures = new Map();
function texture(key, paint) {
  if (textures.has(key)) return textures.get(key);
  const { canvas, c } = surface();
  paint(c);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  textures.set(key, map);
  return map;
}

// One clock for every animated finish, in and out of matches.
const SKIN_TIME = { value: 0 };
(function tick() { SKIN_TIME.value = performance.now() / 1000; requestAnimationFrame(tick); })();

// The expensive finishes are shaders, not just paint. Each snippet runs after the emissive map with:
// sp (part-space position, scaled), V (view direction), N (view normal), fres (rim, 0 facing to 1 edge-on),
// uTime, and the noise helpers below. skinSample(tex) reads a texture triplanar; skinSampleAt(tex, shift) reads it
// with the part-space position moved by `shift`. It may change diffuseColor.rgb and add to totalEmissiveRadiance.
const EFFECTS = {
  // Neon Grid: the lines stay lit and a brighter pulse runs down them toward the muzzle; hue drifts cyan to magenta.
  gridpulse: `
    vec3 grid = skinSample(emissiveMap).rgb;
    float run = pow(0.5 + 0.5 * sin(vSkinPos.z * 9.0 + uTime * 5.0), 6.0);
    float cross = pow(0.5 + 0.5 * sin(vSkinPos.y * 22.0 - uTime * 2.2), 10.0);
    vec3 tint = mix(vec3(0.25, 0.95, 1.0), vec3(1.0, 0.3, 0.85), 0.5 + 0.5 * sin(uTime * 0.6 + vSkinPos.z * 2.0));
    totalEmissiveRadiance += grid * tint * (0.9 + run * 2.6 + cross * 1.2) + tint * fres * 0.25;`,
  // Circuit: traces glow softly and packets of light travel along them.
  dataflow: `
    vec3 trace = skinSample(emissiveMap).rgb;
    float lane = skinHash(floor(vec3(sp.x * 1.0, sp.y * 1.0, 3.0)));
    float packet = pow(0.5 + 0.5 * sin((sp.z + sp.y) * 5.0 - uTime * (3.0 + lane * 4.0) + lane * 40.0), 14.0);
    float idle = 0.55 + 0.15 * sin(uTime * 1.5 + lane * 9.0);
    totalEmissiveRadiance += trace * vec3(0.22, 1.0, 0.53) * (idle + packet * 3.2) + vec3(0.1, 0.9, 0.4) * fres * 0.2;`,
  // Toxic: the glowing patches breathe, and slow drips of light crawl down the gun.
  ooze: `
    vec3 slime = skinSample(emissiveMap).rgb;
    float breathe = 0.6 + 0.4 * sin(uTime * 1.4 + skinNoise(sp * 0.5) * 6.28);
    float drip = smoothstep(0.62, 0.9, skinNoise(vec3(sp.x * 2.2, sp.y * 0.9 + uTime * 0.55, sp.z * 2.2)));
    float bubble = pow(skinNoise(sp * 3.0 + vec3(0.0, -uTime * 0.8, 0.0)), 9.0) * 6.0;
    totalEmissiveRadiance += slime * vec3(0.5, 1.0, 0.12) * breathe * 1.5 + vec3(0.45, 1.0, 0.1) * (drip * 0.55 + bubble) + vec3(0.4, 0.9, 0.1) * fres * 0.3;`,
  // Frostbite: crystals catch the light as the gun moves, with a cold rim.
  glint: `
    vec3 ice = skinSample(emissiveMap).rgb;
    float twinkle = pow(skinNoise(vSkinPos * 60.0 + V * 6.0 + vec3(uTime * 0.6)), 18.0) * 5.0;
    float wash = 0.5 + 0.5 * sin(dot(vSkinPos, vec3(2.0, 5.0, 3.0)) - uTime * 0.9);
    totalEmissiveRadiance += ice * vec3(0.75, 0.93, 1.0) * (0.25 + wash * 0.6) + vec3(twinkle) + vec3(0.6, 0.85, 1.0) * fres * 0.9;`,
  // Gilded: a band of light sweeps along the gun every few seconds.
  shine: `
    float sweep = fract(dot(vSkinPos, vec3(0.25, 0.9, 1.1)) * 0.9 - uTime * 0.35);
    float band = smoothstep(0.06, 0.0, abs(sweep - 0.5));
    totalEmissiveRadiance += vec3(1.0, 0.8, 0.42) * (band * 1.1 + fres * 0.35);`,
  // Void: deep black, stars at three depths that slide with the view, a faint nebula, a violet edge.
  starfield: `
    diffuseColor.rgb *= 0.12;
    vec3 stars = vec3(0.0);
    for (int k = 1; k <= 3; k++) {
      float star = pow(skinNoise(vSkinPos * (30.0 + float(k) * 14.0) + V * float(k) * 2.7), 22.0);
      stars += vec3(0.85, 0.82, 1.0) * star * (2.8 - float(k) * 0.5);
    }
    float cloud = skinFbm(vSkinPos * 5.0 + V * 1.2 + vec3(0.0, uTime * 0.04, 0.0));
    totalEmissiveRadiance += stars + vec3(0.35, 0.12, 0.75) * smoothstep(0.55, 0.85, cloud) * 0.45 + vec3(0.55, 0.3, 1.0) * fres * fres * 1.6;`,
  // Magma: glowing cracks through dark rock, breathing slowly.
  magma: `
    float n = skinNoise(sp * 0.9);
    float crack = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
    float fine = 1.0 - smoothstep(0.0, 0.05, abs(skinNoise(sp * 2.3 + 7.0) - 0.5));
    float pulse = 0.65 + 0.35 * sin(uTime * 1.8 + skinNoise(sp * 0.4) * 6.28);
    vec3 heat = mix(vec3(0.9, 0.12, 0.0), vec3(1.0, 0.72, 0.2), crack);
    diffuseColor.rgb *= 1.0 - crack * 0.8;
    totalEmissiveRadiance += heat * (crack * 2.4 + fine * 0.7) * pulse;`,
  // Dragon scale: the scales shift colour as the gun turns.
  iridescent: `
    float hue = fres * 0.9 + skinNoise(sp * 1.6) * 0.25 + uTime * 0.03;
    vec3 film = skinHue(hue);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * film * 1.9, 0.55);
    totalEmissiveRadiance += film * fres * 0.8;`,
  // Hexcore: waves of light run down the hex edges, muzzle to stock.
  hexwave: `
    float wave = pow(0.5 + 0.5 * sin(vSkinPos.z * 14.0 + vSkinPos.y * 4.0 + uTime * 4.0), 8.0);
    vec3 edge = skinSample(emissiveMap).rgb;
    totalEmissiveRadiance += edge * vec3(1.0, 0.55, 0.12) * (0.35 + wave * 2.6) + vec3(1.0, 0.45, 0.1) * fres * 0.3;`,
  // Aurora: thin ribbons of green and violet drifting over a night-sky finish.
  aurora: `
    float warp = skinFbm(vec3(sp.z * 0.35 + uTime * 0.07, sp.x * 0.3, uTime * 0.05));
    float coord = sp.z * 0.6 + sp.y * 1.1 + warp * 1.5 - uTime * 0.12;
    float ribbon = pow(smoothstep(0.5, 1.0, 1.0 - abs(fract(coord) * 2.0 - 1.0)), 3.0);
    ribbon += 0.6 * pow(smoothstep(0.6, 1.0, 1.0 - abs(fract(coord * 1.7 + 0.3) * 2.0 - 1.0)), 3.0);
    float shimmer = 0.6 + 0.4 * skinNoise(vec3(sp.z * 3.0 - uTime * 1.2, sp.y * 8.0, 0.0));
    vec3 tint = mix(vec3(0.1, 1.0, 0.55), vec3(0.7, 0.25, 1.0), smoothstep(0.3, 0.7, skinNoise(sp * 0.25 + vec3(uTime * 0.1))));
    diffuseColor.rgb *= 0.6;
    totalEmissiveRadiance += tint * (ribbon * shimmer * 2.6 + fres * fres * 0.5);`,
  // Inferno: fire streaming along the gun toward the muzzle, white-hot at the core.
  inferno: `
    vec3 q = vec3(sp.x * 1.8, sp.y * 2.2 - uTime * 2.2, sp.z * 1.4 + uTime * 1.6);
    float flame = skinFbm(q) + 0.35 * skinFbm(q * 2.3 + vec3(0.0, -uTime * 3.0, 0.0));
    float body = smoothstep(0.45, 1.0, flame);
    float core = smoothstep(0.78, 1.15, flame);
    vec3 fire = mix(vec3(0.75, 0.06, 0.0), vec3(1.0, 0.55, 0.05), body);
    fire = mix(fire, vec3(1.0, 0.95, 0.7), core);
    float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + sp.z * 3.0);
    diffuseColor.rgb *= 0.15;
    totalEmissiveRadiance += fire * (body * 3.2 + core * 2.5) * flicker + vec3(1.0, 0.35, 0.05) * fres * 1.2;`,
  // Hologram: a see-through cyan body, thin scanlines, a bright rim, a scan band and now and then a glitch.
  hologram: `
    float line = smoothstep(0.82, 1.0, fract(vSkinPos.y * 90.0 - uTime * 3.0));
    float band = 1.0 - smoothstep(0.0, 0.06, abs(fract(vSkinPos.z * 1.2 + uTime * 0.45) - 0.5));
    float beat = floor(uTime * 9.0);
    float glitch = step(0.94, skinHash(vec3(floor(vSkinPos.y * 22.0), beat, 1.0)));
    float flicker = 0.9 + 0.1 * step(0.5, skinHash(vec3(beat)));
    vec3 cyan = vec3(0.2, 0.9, 1.0);
    diffuseColor.rgb *= 0.12;
    totalEmissiveRadiance += (cyan * (0.12 + line * 0.9 + band * 1.4 + fres * 2.2) + vec3(1.0, 0.25, 0.85) * glitch * 1.4) * flicker;`,
  // Prism: thin-film rainbow that moves with the view, plus sparkle.
  prism: `
    float hue = fres * 1.3 + dot(vSkinPos, vec3(1.4, 0.8, 0.5)) + uTime * 0.12;
    vec3 film = skinHue(hue);
    diffuseColor.rgb = film * 0.75;
    float sparkle = pow(skinNoise(vSkinPos * 140.0 + V * 5.0), 26.0) * 4.0;
    totalEmissiveRadiance += film * (0.28 + fres * 1.3) + vec3(sparkle);`,
  // Plasma: forked blue-violet arcs crawl along the gun and flicker, white-hot along their spines.
  plasma: `
    float beat = floor(uTime * 14.0);
    vec3 q = vec3(sp.x * 2.6, sp.y * 2.6, sp.z * 1.5 + uTime * 1.1) + vec3(skinHash(vec3(beat, 1.0, 2.0)) * 0.12);
    float a = abs(skinFbm(q + vec3(0.0, uTime * 0.5, 0.0)) - 0.5);
    float b = abs(skinFbm(q * 1.7 + vec3(4.0, -uTime * 0.8, 1.0)) - 0.5);
    float arc = 1.0 - smoothstep(0.0, 0.025, a);
    float fork = (1.0 - smoothstep(0.0, 0.018, b)) * (1.0 - smoothstep(0.03, 0.16, a));
    float halo = 1.0 - smoothstep(0.0, 0.09, min(a, b + 0.03));
    float flick = 0.55 + 0.45 * step(0.3, skinHash(vec3(beat, 7.0, 3.0)));
    vec3 volt = mix(vec3(0.35, 0.3, 1.0), vec3(0.75, 0.3, 1.0), skinNoise(sp * 0.7 + vec3(uTime * 0.2)));
    diffuseColor.rgb *= 0.25;
    totalEmissiveRadiance += (volt * (arc * 2.8 + fork * 2.0 + halo * 0.25) + vec3(1.0) * arc * arc * arc * 1.8) * flick + volt * fres * 0.5;`,
  // Glitch: clean paint most of the time. In bursts, blocks jump sideways with their colour channels split,
  // rows tear, and static fizzes through the gaps.
  glitch: `
    float beat = floor(uTime * 7.0);
    float burst = step(0.5, skinHash(vec3(floor(uTime * 1.7), 3.0, 9.0)));
    vec3 cell = floor(vec3(vSkinPos.x * 25.0, vSkinPos.y * 45.0, vSkinPos.z * 9.0));
    float block = step(0.8, skinHash(cell + vec3(beat, 0.0, 0.0))) * burst;
    float tear = step(0.9, skinHash(vec3(floor(vSkinPos.y * 140.0), beat, 5.0))) * burst;
    float hit = clamp(block + tear, 0.0, 1.0);
    vec3 jump = vec3(0.0, 0.0, (skinHash(cell + vec3(beat, 2.0, 0.0)) - 0.5) * 0.9 * block + tear * 0.3);
    vec3 split = vec3(0.06, 0.0, 0.06) * hit;
    vec3 torn = vec3(skinSampleAt(map, jump + split).r, skinSampleAt(map, jump).g, skinSampleAt(map, jump - split).b);
    diffuseColor.rgb = mix(diffuseColor.rgb, torn * 1.25, hit);
    float fizz = skinHash(vec3(floor(vSkinPos.z * 400.0), floor(vSkinPos.y * 400.0), beat));
    float scan = pow(0.5 + 0.5 * sin(vSkinPos.y * 700.0 - uTime * 30.0), 8.0);
    vec3 fringe = mix(vec3(1.0, 0.1, 0.55), vec3(0.1, 0.95, 1.0), step(0.5, skinHash(cell + vec3(beat, 9.0, 1.0))));
    totalEmissiveRadiance += fringe * block * 0.7 + vec3(fizz) * tear * 0.9 + vec3(0.2, 0.9, 1.0) * scan * burst * 0.12 + fringe * fres * 0.3;`,
  // Quicksilver: liquid chrome. A fake sky and ground reflect in it, warped by ripples that roll along the gun,
  // so the bright and dark bands pour and slide as the gun or the view moves.
  quicksilver: `
    float flow = uTime * 0.6;
    vec3 fp = vec3(sp.x * 2.0, sp.y * 2.0, sp.z * 1.2 + flow);
    float h = skinFbm(fp + vec3(skinNoise(fp * 0.7 - vec3(0.0, 0.0, flow * 0.5)) * 1.5));
    float ripple = sin(sp.z * 6.0 + flow * 4.0 + h * 8.0);
    vec3 R = reflect(-V, N);
    float e = R.y * 1.3 + (h - 0.5) * 2.8 + ripple * 0.12 + fres * 0.5;
    float env = smoothstep(-0.14, 0.14, e);
    float line = exp(-e * e * 60.0);
    float bands = 0.5 + 0.5 * sin(e * 9.0);
    float glint = pow(max(dot(R, normalize(vec3(0.4, 0.8, 0.45))), 0.0), 40.0) + pow(max(dot(R, normalize(vec3(-0.6, 0.5, 0.6))), 0.0), 60.0) * 0.6;
    vec3 chrome = mix(vec3(0.05, 0.055, 0.07), vec3(0.8, 0.86, 0.95), env) * (0.85 + bands * 0.25) + vec3(0.95, 0.97, 1.0) * line * 0.9;
    diffuseColor.rgb = chrome * 0.25;
    totalEmissiveRadiance += chrome * 0.6 + vec3(1.0) * glint * 2.4 + vec3(0.7, 0.8, 0.95) * fres * 0.25;`,
  // Nebula: pink, teal and violet gas swirling slowly behind the paint, with twinkling stars at two depths.
  nebula: `
    vec3 p = vSkinPos * 6.0 + V * 0.8;
    vec3 warp = vec3(skinFbm(p + vec3(0.0, 0.0, uTime * 0.05)), skinFbm(p + vec3(5.2, 1.3, -uTime * 0.04)), 0.0);
    float gas = skinFbm(p * 1.3 + warp * 2.5 + vec3(uTime * 0.03, 0.0, 0.0));
    float tint = skinFbm(p * 0.7 - warp * 1.5 + vec3(0.0, uTime * 0.02, 3.0));
    vec3 col = mix(vec3(1.0, 0.25, 0.65), vec3(0.1, 0.9, 0.85), smoothstep(0.35, 0.65, tint));
    col = mix(col, vec3(0.5, 0.2, 1.0), smoothstep(0.55, 0.8, warp.x));
    float dense = smoothstep(0.42, 0.85, gas);
    vec3 stars = vec3(0.0);
    for (int k = 1; k <= 2; k++) stars += vec3(1.0, 0.95, 0.9) * pow(skinNoise(vSkinPos * (45.0 + float(k) * 25.0) + V * float(k) * 3.0), 24.0) * (3.0 - float(k));
    float twinkle = 0.7 + 0.3 * sin(uTime * 3.0 + skinHash(floor(vSkinPos * 80.0)) * 6.28);
    diffuseColor.rgb *= 0.1;
    totalEmissiveRadiance += col * dense * dense * 1.6 + col * 0.06 + stars * twinkle + mix(vec3(1.0, 0.4, 0.8), vec3(0.3, 0.9, 1.0), 0.5 + 0.5 * sin(uTime * 0.3)) * fres * fres * 1.2;`,
  // Spectre: cold blue-white wisps drift up off a dark body, slow and thin, fading in and out like breath.
  spectre: `
    vec3 q = vec3(sp.x * 3.0, sp.y * 0.9 - uTime * 0.5, sp.z * 2.4);
    float bend = skinFbm(q * 0.5 + vec3(0.0, 0.0, uTime * 0.08));
    float n = skinFbm(q + vec3(bend * 2.0, 0.0, bend * 1.5));
    float wisp = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
    float veil = 1.0 - smoothstep(0.0, 0.16, abs(n - 0.5));
    float mask = smoothstep(0.35, 0.75, skinNoise(vec3(sp.x * 1.5, sp.y * 0.8 - uTime * 0.7, sp.z * 1.5)));
    float breath = 0.65 + 0.35 * sin(uTime * 0.9 + sp.z * 0.8);
    vec3 cold = mix(vec3(0.25, 0.5, 1.0), vec3(0.85, 0.95, 1.0), wisp);
    diffuseColor.rgb = diffuseColor.rgb * 0.18 + vec3(0.0, 0.01, 0.03);
    totalEmissiveRadiance += cold * (wisp * 1.8 + veil * 0.35) * (0.3 + mask) * breath + vec3(0.45, 0.7, 1.0) * fres * fres * (0.6 + breath * 0.6);`,
  // Synthwave: a neon floor and sky meet at a glowing horizon down the middle of each part,
  // and the grid races toward the muzzle.
  synthwave: `
    float w = abs(vSkinPos.y) * 26.0 + 0.08;
    float D = 1.0 / w;
    float gx = vSkinPos.z * 9.0 * D + uTime * 2.2;
    float gy = D * 0.9 + uTime * 0.5;
    float gl = vSkinPos.x * 40.0;
    float lx = min(fract(gx), 1.0 - fract(gx)) / max(fwidth(gx), 0.0001);
    float ly = min(fract(gy), 1.0 - fract(gy)) / max(fwidth(gy), 0.0001);
    float ll = min(fract(gl), 1.0 - fract(gl)) / max(fwidth(gl), 0.0001);
    float fade = 1.0 - smoothstep(2.5, 10.0, D);
    float side = 1.0 - abs(normalize(vSkinNrm).y);
    float rungs = (1.0 - smoothstep(0.5, 1.6, lx)) * fade;
    float rails = (1.0 - smoothstep(0.5, 1.6, ly)) * fade * side + (1.0 - smoothstep(0.5, 1.6, ll)) * (1.0 - side);
    float glow = exp(-w * w * 16.0);
    vec3 magenta = vec3(1.0, 0.12, 0.75);
    vec3 cyan = vec3(0.1, 0.9, 1.0);
    vec3 sun = mix(vec3(1.0, 0.6, 0.15), vec3(1.0, 0.15, 0.55), clamp(w, 0.0, 1.0));
    diffuseColor.rgb *= 0.2;
    totalEmissiveRadiance += magenta * rungs * 1.8 + cyan * rails * 1.4 + sun * glow * 1.5 + mix(magenta, cyan, 0.5 + 0.5 * sin(uTime * 0.7)) * fres * 0.4;`,
  // Dev, Source Code: dark glass full of live code. Each lane of glyphs streams toward the muzzle at its own speed,
  // a read head sweeps along lighting it up, bright slices glitch through now and then, and a mint rim traces the edge.
  // Triplanar by hand so every face gets its own lanes (flipped so the text reads the right way round on both flanks
  // and on top); textureGrad keeps the lane seams clean.
  devsource: `
    vec3 nrm = normalize(vSkinNrm);
    vec3 wt = pow(abs(nrm), vec3(4.0));
    wt /= (wt.x + wt.y + wt.z);
    float flip = nrm.x >= 0.0 ? -1.0 : 1.0;
    float beat = floor(uTime * 6.0);
    float burst = step(0.62, skinHash(vec3(floor(uTime * 1.5), 11.0, 4.0)));
    float slice = step(0.86, skinHash(vec3(floor(vSkinPos.z * 55.0), beat, 6.0))) * burst;
    vec2 ga = vec2(sp.z * flip, sp.y), gb = vec2(sp.x, -sp.z), gc = sp.xy;
    float la = skinHash(vec3(floor(ga.y * 16.0), 3.0, 1.0));
    float lb = skinHash(vec3(floor(gb.x * 32.0), 5.0, 2.0));
    float lc = skinHash(vec3(floor(gc.y * 16.0), 7.0, 3.0));
    vec2 ua = ga + vec2((uTime * (0.05 + la * 0.32) + slice * 0.37) * flip, 0.0);
    vec2 ub = gb - vec2(0.0, uTime * (0.05 + lb * 0.32) + slice * 0.37);
    vec2 uc = gc + vec2(uTime * (0.05 + lc * 0.32) + slice * 0.37, 0.0);
    vec3 code = textureGrad(emissiveMap, ua, dFdx(ga), dFdy(ga)).rgb * wt.x + textureGrad(emissiveMap, ub, dFdx(gb), dFdy(gb)).rgb * wt.y + textureGrad(emissiveMap, uc, dFdx(gc), dFdy(gc)).rgb * wt.z;
    float lane = la * wt.x + lb * wt.y + lc * wt.z;
    float hd = fract(vSkinPos.z * 1.6 + uTime * 0.35) - 0.5;
    float head = exp(-hd * hd * 90.0);
    float blink = 0.8 + 0.2 * sin(uTime * (4.0 + lane * 9.0) + lane * 30.0);
    float sheen = pow(max(dot(reflect(-V, N), normalize(vec3(-0.35, 0.85, 0.4))), 0.0), 28.0);
    vec3 mint = vec3(0.0, 1.0, 0.78);
    diffuseColor.rgb = diffuseColor.rgb * 0.18 + vec3(0.0, 0.015, 0.014);
    totalEmissiveRadiance += code * (1.1 * blink + head * 2.8 + slice * 3.5) + mint * (slice * 0.12 + head * 0.06) + vec3(0.7, 1.0, 0.95) * sheen * 0.8 + mint * (fres * 0.45 + smoothstep(0.6, 1.0, fres) * 1.6);`,
  // Dev, Singularity: a black hole. Hot gas spirals round the gun's long axis, starlight bends around the silhouette,
  // and a thin blazing ring marks the event horizon.
  singularity: `
    float ang = atan(vSkinPos.y, vSkinPos.x + 0.00001);
    float spin = ang - uTime * 1.7 + vSkinPos.z * 24.0;
    vec3 swirl = vec3(cos(spin) * 1.3, sin(spin) * 1.3, vSkinPos.z * 8.0 - uTime * 0.35);
    float gas = skinFbm(swirl + vec3(skinNoise(swirl * 2.1) * 1.4));
    float arms = pow(0.5 + 0.5 * sin(spin * 2.0 + gas * 6.0), 3.0) * smoothstep(0.28, 0.72, gas);
    vec3 disk = mix(vec3(0.5, 0.12, 1.0), vec3(1.0, 0.5, 0.12), smoothstep(0.15, 0.7, arms));
    disk = mix(disk, vec3(1.0, 0.96, 0.88), smoothstep(0.7, 1.0, arms));
    vec3 bent = refract(-V, N, 0.5);
    vec3 sky = vSkinPos * 26.0 + bent * (5.0 + fres * 26.0) + vec3(0.0, 0.0, uTime * 0.02);
    float stars = pow(skinNoise(sky * 1.8), 26.0) * 5.0 + pow(skinNoise(sky * 3.3 + 9.0), 30.0) * 3.0;
    float face = 1.0 - smoothstep(0.0, 0.3, fres);
    float ph = (fres - 0.62) * 14.0;
    float photon = exp(-ph * ph);
    float horizon = smoothstep(0.82, 1.0, fres);
    float flare = 0.85 + 0.15 * sin(uTime * 5.0 + ang * 3.0);
    diffuseColor.rgb *= 0.02;
    totalEmissiveRadiance += disk * arms * (1.4 + 1.6 * (1.0 - face)) * flare + vec3(0.75, 0.8, 1.0) * stars * (0.25 + face) + vec3(1.0, 0.72, 0.4) * photon * 0.8 + vec3(1.0, 0.92, 0.8) * horizon * 3.0;`,
  // Dev, Overclock: the gun running far too hot. Heat pulses race from stock to muzzle through a thermal palette,
  // the circuit traces flare white as each wave passes, the air shimmers and sparks spit off the hottest spots.
  overclock: `
    float haze = skinNoise(vec3(sp.x * 5.0, sp.y * 5.0 - uTime * 2.5, sp.z * 5.0)) - 0.5;
    vec3 wobble = vec3(haze * 0.035, 0.0, haze * 0.05);
    float surge = sin(vSkinPos.z * 11.0 + uTime * 4.2 + haze * 1.5 + skinFbm(sp * 0.8 + vec3(0.0, 0.0, uTime * 0.9)) * 3.0);
    float wave = 0.5 + 0.5 * surge;
    float heat = clamp(wave * (0.78 + 0.22 * sin(uTime * 2.6)) + 0.12 * sin(uTime * 17.0 + sp.z) * step(0.8, wave), 0.0, 1.0);
    vec3 thermal = mix(vec3(0.02, 0.04, 0.4), vec3(0.55, 0.05, 0.65), smoothstep(0.0, 0.3, heat));
    thermal = mix(thermal, vec3(1.0, 0.22, 0.04), smoothstep(0.25, 0.55, heat));
    thermal = mix(thermal, vec3(1.0, 0.78, 0.15), smoothstep(0.55, 0.82, heat));
    thermal = mix(thermal, vec3(1.0, 1.0, 0.95), smoothstep(0.82, 1.0, heat));
    vec3 tex = skinSampleAt(emissiveMap, wobble).rgb;
    float trace = max(max(tex.r, tex.g), tex.b);
    float flare = pow(wave, 10.0);
    vec3 cell = floor(vec3(vSkinPos.x * 180.0, vSkinPos.y * 180.0 - uTime * 30.0, vSkinPos.z * 180.0));
    float spark = step(0.993, skinHash(cell + vec3(0.0, 0.0, floor(uTime * 14.0)))) * smoothstep(0.55, 0.9, heat);
    diffuseColor.rgb = skinSampleAt(map, wobble).rgb * 0.3;
    totalEmissiveRadiance += thermal * (0.2 + heat * 1.3) + trace * mix(thermal, vec3(1.0), 0.35 + flare * 0.5) * (0.7 + heat * 2.6 + flare * 4.0) + vec3(1.0, 0.75, 0.4) * spark * 7.0 + thermal * fres * (0.6 + heat);`,
};
const NOISE_GLSL = `
uniform float uTime;
float skinHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float skinNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skinHash(i), skinHash(i + vec3(1, 0, 0)), f.x), mix(skinHash(i + vec3(0, 1, 0)), skinHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(skinHash(i + vec3(0, 0, 1)), skinHash(i + vec3(1, 0, 1)), f.x), mix(skinHash(i + vec3(0, 1, 1)), skinHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float skinFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * skinNoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 skinHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;

// Samples `map` (and `emissiveMap`) from three sides in object space instead of the geometry's UVs,
// then runs the finish's effect, if it has one.
function triplanar(material, scale, effect = null) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkinScale = { value: scale };
    shader.uniforms.uTime = SKIN_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPos;\nvarying vec3 vSkinNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPos = position;\nvSkinNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSkinPos;
varying vec3 vSkinNrm;
uniform float uSkinScale;
${NOISE_GLSL}
vec4 skinSampleAt(sampler2D tex, vec3 shift) {
  vec3 w = pow(abs(normalize(vSkinNrm)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vSkinPos * uSkinScale + shift;
  return texture2D(tex, p.zy) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
}
vec4 skinSample(sampler2D tex) { return skinSampleAt(tex, vec3(0.0)); }`)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= skinSample(map);\n#endif')
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance *= skinSample(emissiveMap).rgb;
#endif
${effect ? `{
  vec3 sp = vSkinPos * uSkinScale;
  vec3 V = normalize(vViewPosition);
  vec3 N = normal;
  float fres = pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0);
  ${EFFECTS[effect]}
}` : ''}`);
  };
  material.customProgramCacheKey = () => `skin-${scale}-${effect || 'flat'}`;
  return material;
}

const materials = new Map();
// Shared per finish: every gun wearing it uses the one material.
export function skinMaterial(id) {
  const art = FINISH_ART[id];
  if (!art) return null;
  if (materials.has(id)) return materials.get(id);
  const material = new THREE.MeshStandardMaterial({ map: texture(`finish:${id}`, art.paint), roughness: art.rough, metalness: art.metal });
  if (art.emit) { material.emissiveMap = texture(`emit:${id}`, art.emit); material.emissive.set('#ffffff'); material.emissiveIntensity = art.shader ? 0 : art.glow; }
  triplanar(material, 4.5, art.shader || null);
  materials.set(id, material);
  return material;
}
// Finishes with their own shader: the shop gives them a live preview and a special card.
export const animatedFinish = (id) => Boolean(FINISH_ART[id]?.shader);

// Suit pattern on an operator's suit material; null or 'solid' takes it off.
export function applyPattern(material, id) {
  const next = PATTERN_ART[id] ? texture(`pattern:${id}`, PATTERN_ART[id]) : null;
  if (material.map === next) return;
  if (!material.userData.triplanar) { triplanar(material, 3); material.userData.triplanar = true; }
  material.map = next;
  material.needsUpdate = true;
}

// Flat swatch for the menus.
const swatches = new Map();
export function finishSwatch(id) {
  if (swatches.has(id)) return swatches.get(id);
  const art = FINISH_ART[id];
  let url = '';
  if (art) {
    const { canvas, c } = surface();
    art.paint(c);
    if (art.emit) { c.globalCompositeOperation = 'lighter'; art.emit(c); }
    url = canvas.toDataURL('image/png');
  }
  swatches.set(id, url);
  return url;
}
export function patternSwatch(id) {
  const key = `pattern:${id}`;
  if (swatches.has(key)) return swatches.get(key);
  let url = '';
  if (PATTERN_ART[id]) { const { canvas, c } = surface(); PATTERN_ART[id](c); url = canvas.toDataURL('image/png'); }
  swatches.set(key, url);
  return url;
}
