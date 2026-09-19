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
// uTime, and the noise helpers below. It may change diffuseColor.rgb and add to totalEmissiveRadiance.
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
vec4 skinSample(sampler2D tex) {
  vec3 w = pow(abs(normalize(vSkinNrm)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vSkinPos * uSkinScale;
  return texture2D(tex, p.zy) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
}`)
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
