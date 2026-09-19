// The crates you open in the shop, as real models: a painted steel case with a hinged lid, two latches,
// side handles, a glowing seam and a light inside. Each crate type has its own paint job. `poseCrate`
// runs the opening: it shakes, the latches pop one after the other, the lid swings up and light pours out.
import * as THREE from 'three';

const W = 1.0, H = 0.5, D = 0.62, LID = 0.17;
export const CRATE_OPEN_TIME = 1.35; // seconds from the click to the lid being fully up

const STYLES = {
  field: { base: '#5d6b76', dark: '#2b343c', trim: '#1c2227', ink: '#e6edf1', mark: 'FIELD', hazard: true },
  camo: { base: '#56633a', dark: '#2f3b22', trim: '#23291a', ink: '#d9d2b0', mark: 'CAMO', camo: ['#2f3b22', '#735f3c', '#1d2218'] },
  elite: { base: '#1b1822', dark: '#0e0c13', trim: '#c9a14a', ink: '#d9c3ff', mark: 'ELITE', weave: true, metal: 0.55 },
  neon: { base: '#0b1016', dark: '#05080b', trim: '#10202a', ink: '#3ff2ff', mark: 'NEON', grid: true, glow: 1.4 },
  wild: { base: '#ec8a2c', dark: '#3a220c', trim: '#24160a', ink: '#fff1d6', mark: 'WILD', stripes: '#1a1108', metal: 0.25 },
  street: { base: '#2a2d34', dark: '#15171b', trim: '#0f1013', ink: '#f4f4f4', mark: 'STREET', tags: ['#ff3d7f', '#3ff2ff', '#ffe14d', '#7dff5a'], metal: 0.25 },
  winter: { base: '#b8cad6', dark: '#5d7384', trim: '#8fa6b5', ink: '#244157', accent: '#3f8fc4', bright: '#dcecf5', mark: 'WINTER', frost: true, glow: 0.9, metal: 0.55 },
  forge: { base: '#26282c', dark: '#141518', trim: '#34373c', ink: '#ff9448', rivet: '#ff8a3a', mark: 'FORGE', forge: true, glow: 1.8, glowText: 0.6, metal: 0.6 },
  cosmic: { base: '#140b2c', dark: '#0a0618', trim: '#3d2f7a', ink: '#e4d9ff', rivet: '#b9a4ff', bright: '#c9bbff', mark: 'COSMIC', stars: ['#8a5cff', '#ff5cc8', '#3fd8ff'], glow: 1.5, glowText: 0.5, metal: 0.45 },
};
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const RIVETS = (width, height) => [[12, 12], [width - 12, 12], [12, height - 12], [width - 12, height - 12], [width / 2, 12], [width / 2, height - 12]];

// The newer paint jobs. Anything that also glows is placed by its own numbers (`q`), drawn once as paint
// and once for the glow, so the two passes land on exactly the same pixels.
function tigerStripes(c, q, ink, width, height) {
  const shade = c.createLinearGradient(0, 0, 0, height); shade.addColorStop(0, 'rgba(255,214,150,.14)'); shade.addColorStop(1, 'rgba(80,30,0,.16)'); c.fillStyle = shade; c.fillRect(0, 0, width, height);
  c.fillStyle = ink;
  const island = (x1, y1, x2, y2, bulge) => { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, l = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / l, ny = (x2 - x1) / l; c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(mx + nx * bulge, my + ny * bulge, x2, y2); c.quadraticCurveTo(mx - nx * bulge * 0.5, my - ny * bulge * 0.5, x1, y1); c.fill(); };
  for (let x = -10 + q() * 20; x < width + 20; x += 24 + q() * 30) {
    const top = q() < 0.5, dir = top ? 1 : -1, y0 = top ? -4 : height + 4, len = height * (0.35 + q() * 0.45), w = 14 + q() * 20, d = (q() - 0.5) * 80, y1 = y0 + dir * len;
    c.beginPath(); c.moveTo(x - w / 2, y0); c.bezierCurveTo(x - w / 2 + d * 0.5, y0 + dir * len * 0.35, x + d - w * 0.2, y0 + dir * len * 0.7, x + d, y1); c.bezierCurveTo(x + d + w * 0.25, y0 + dir * len * 0.7, x + w / 2 + d * 0.5, y0 + dir * len * 0.35, x + w / 2, y0); c.closePath(); c.fill();
    if (q() < 0.5) { const y = y1 + dir * (8 + q() * 16); island(x + d * 1.1, y, x + d * 1.3 + (q() - 0.5) * 30, y + dir * (20 + q() * 30), 5 + q() * 5); }   // a broken piece past the tip
  }
}
// Street: overspray, fat outlined scribbles that drip, thin signatures over the top.
function graffiti(c, q, colors, width, height) {
  const pick = () => colors[Math.floor(q() * colors.length)], cx = (v) => Math.min(width - 34, Math.max(34, v)), cy = (v) => Math.min(height - 34, Math.max(34, v));
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  for (let i = 0; i < 5; i += 1) { const x = q() * width, y = q() * height, s = 40 + q() * 70, col = pick(), g = c.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, `${col}66`); g.addColorStop(1, `${col}00`); c.fillStyle = g; c.fillRect(x - s, y - s, s * 2, s * 2); }
  for (let i = 0; i < 4; i += 1) {
    const col = pick(), w = 7 + q() * 7, pts = [[cx(q() * width), cy(q() * height)]];
    for (let k = 0; k < 5; k += 1) { const [px, py] = pts[pts.length - 1]; pts.push([cx(px + (q() - 0.5) * 150), cy(py + (q() - 0.5) * 110)]); }
    const mid = (k) => [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2];
    const trace = () => { c.beginPath(); c.moveTo(...pts[0]); for (let k = 1; k < pts.length - 1; k += 1) c.quadraticCurveTo(pts[k][0], pts[k][1], ...mid(k)); c.lineTo(...pts[pts.length - 1]); c.stroke(); };
    c.strokeStyle = 'rgba(8,8,10,.9)'; c.lineWidth = w + 6; trace();
    c.strokeStyle = col; c.lineWidth = w; trace();
    c.fillStyle = col; for (let k = 1; k < pts.length - 1; k += 1) if (q() < 0.6) { const [x, y] = mid(k), l = 10 + q() * 36; c.fillRect(x - 1.5, y + w / 2, 3, l); c.beginPath(); c.arc(x, y + w / 2 + l, 3, 0, Math.PI * 2); c.fill(); }   // drips
  }
  c.strokeStyle = 'rgba(244,244,244,.85)'; c.lineWidth = 2.5;
  for (let i = 0; i < 3; i += 1) { let x = 40 + q() * (width - 160), y = 40 + q() * (height - 80); c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 9; k += 1) { x += 6 + q() * 10; y = cy(y + (q() - 0.5) * 26); c.lineTo(x, y); } c.stroke(); }
  c.restore();
}
// Winter: frost ferns creeping in from the edges, six-armed crystals and glints. Glows cold.
function frostwork(c, q, width, height, glow) {
  const segs = [[], [], []], glints = [];
  const fern = (x, y, a, len, depth) => { const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; segs[depth].push(x, y, x2, y2); if (depth) for (let k = 1; k <= 3; k += 1) { const f = k / 4; for (const side of [-1, 1]) fern(x + (x2 - x) * f, y + (y2 - y) * f, a + side * (0.8 + q() * 0.4), len * (0.45 - f * 0.15), depth - 1); } };
  for (let i = 0; i < 7; i += 1) { const edge = Math.floor(q() * 4), along = q(), x = edge < 2 ? along * width : edge === 2 ? 0 : width, y = edge < 2 ? (edge ? height : 0) : along * height; fern(x, y, [Math.PI / 2, -Math.PI / 2, 0, Math.PI][edge] + (q() - 0.5) * 0.9, 40 + q() * 50, 2); }
  for (let i = 0; i < 7; i += 1) { const x = 30 + q() * (width - 60), y = 30 + q() * (height - 60), s = 5 + q() * 9, turn = q(); for (let k = 0; k < 6; k += 1) { const a = turn + (k * Math.PI) / 3, bx = x + Math.cos(a) * s * 0.55, by = y + Math.sin(a) * s * 0.55; segs[1].push(x, y, x + Math.cos(a) * s, y + Math.sin(a) * s); for (const side of [-1, 1]) segs[0].push(bx, by, bx + Math.cos(a + side * 0.8) * s * 0.35, by + Math.sin(a + side * 0.8) * s * 0.35); } }
  for (let i = 0; i < 40; i += 1) glints.push([q() * width, q() * height, 0.6 + q() * 1.4]);
  c.save(); c.lineCap = 'round'; c.strokeStyle = glow ? 'rgba(160,225,255,.5)' : 'rgba(248,252,255,.7)'; if (glow) { c.shadowColor = '#9fdcff'; c.shadowBlur = 6; }
  segs.forEach((list, depth) => { c.lineWidth = 0.7 + depth * 0.8; c.beginPath(); for (let k = 0; k < list.length; k += 4) { c.moveTo(list[k], list[k + 1]); c.lineTo(list[k + 2], list[k + 3]); } c.stroke(); });
  c.fillStyle = glow ? '#d8f4ff' : 'rgba(255,255,255,.6)'; for (const [x, y, s] of glints) { c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); }
  c.restore();
}
// Forge: hammered steel, dents lit from the top left, with a temper tint rising from the bottom.
function hammered(c, r, width, height) {
  for (let i = 0; i < 170; i += 1) { const x = r() * width, y = r() * height, s = 6 + r() * 12, g = c.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.22)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); }
  const heat = c.createLinearGradient(0, height, 0, height * 0.35); heat.addColorStop(0, 'rgba(255,96,24,.22)'); heat.addColorStop(0.4, 'rgba(120,60,160,.08)'); heat.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = heat; c.fillRect(0, 0, width, height);
}
// Jagged cracks as polylines that fork now and then.
function cracks(q, width, height) {
  const lines = [];
  const walk = (x, y, a, steps) => { const line = [[x, y]]; for (let s = 0; s < steps; s += 1) { a += (q() - 0.5) * 1.1; const l = 7 + q() * 11; x += Math.cos(a) * l; y += Math.sin(a) * l; line.push([x, y]); if (steps > 4 && q() < 0.2) walk(x, y, a + (q() < 0.5 ? -1 : 1) * (0.5 + q() * 0.7), Math.floor(steps / 2)); } lines.push(line); };
  for (let i = 0; i < 4; i += 1) walk(q() * width, q() * height, q() * Math.PI * 2, 7 + Math.floor(q() * 9));
  return lines;
}
function forgework(c, q, color, width, height, glow) {
  const lines = cracks(q, width, height), trace = (w, s) => { c.lineWidth = w; c.strokeStyle = s; for (const line of lines) { c.beginPath(); line.forEach(([x, y], k) => c[k ? 'lineTo' : 'moveTo'](x, y)); c.stroke(); } };
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (glow) {
    const ember = c.createLinearGradient(0, height, 0, height * 0.6); ember.addColorStop(0, 'rgba(255,90,20,.22)'); ember.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = ember; c.fillRect(0, 0, width, height);
    c.shadowColor = color; c.shadowBlur = 14; trace(3.2, color); c.shadowBlur = 4; trace(1.2, '#ffe2a8');
    c.fillStyle = color; c.shadowBlur = 10; for (const [x, y] of RIVETS(width, height)) { c.beginPath(); c.arc(x, y, 4.2, 0, Math.PI * 2); c.fill(); }   // rivets still hot
  } else { trace(5, 'rgba(10,6,4,.9)'); trace(2, color); trace(0.8, '#ffd27a'); }
  c.restore();
}
// Cosmic: nebula clouds and a starfield, a few bright stars with flares.
function starfield(c, q, colors, width, height, glow) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i += 1) { const x = q() * width, y = q() * height, s = 50 + q() * 110, col = colors[i % colors.length], g = c.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, col + (glow ? '30' : '60')); g.addColorStop(0.5, col + (glow ? '12' : '24')); g.addColorStop(1, `${col}00`); c.fillStyle = g; c.fillRect(x - s, y - s, s * 2, s * 2); }
  for (let i = 0; i < 160; i += 1) { const x = q() * width, y = q() * height, s = 0.4 + q() ** 3 * 1.6, dim = 0.35 + q() * 0.65; c.fillStyle = q() < 0.2 ? colors[Math.floor(q() * colors.length)] : '#ffffff'; c.globalAlpha = glow ? Math.min(1, dim + 0.2) : dim; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); }
  c.globalAlpha = 1; c.fillStyle = '#ffffff';
  for (let i = 0; i < 7; i += 1) { const x = 20 + q() * (width - 40), y = 20 + q() * (height - 40), s = 5 + q() * 8; if (glow) { c.shadowColor = colors[i % colors.length]; c.shadowBlur = 10; } c.beginPath(); c.arc(x, y, 1.8, 0, Math.PI * 2); c.fill(); c.fillRect(x - s, y - 0.6, s * 2, 1.2); c.fillRect(x - 0.6, y - s, 1.2, s * 2); }
  c.restore();
}
// Stencil letters with the bridges cut clean out, for paint jobs too busy to paint the bridges over.
function stencil(c, text, fill, width, height) {
  const cut = document.createElement('canvas'); cut.width = width; cut.height = height;
  const k = cut.getContext('2d');
  k.font = `700 ${Math.round(height * 0.34)}px "Geist Mono", ui-monospace, monospace`; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillStyle = fill; k.fillText(text, width / 2, height / 2 + 4);
  k.globalCompositeOperation = 'destination-out'; for (let x = width / 2 - 170; x < width / 2 + 170; x += 38) k.fillRect(x, height / 2 - 46, 4, 100);
  c.drawImage(cut, 0, 0);
}

// One painted panel: paint, a pressed inner panel, rivets, stencil, wear. `emit` paints only what glows.
function panel(style, color, { width = 512, height = 256, text = '', logo = false, emit = false, seed = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d'), r = seeded(seed), q = seeded(seed * 131 + 7);
  const printed = style.stripes || style.tags || style.forge || style.stars, busy = printed || style.frost;
  if (emit) {
    c.fillStyle = '#000'; c.fillRect(0, 0, width, height);
    if (style.grid) {
      c.strokeStyle = color; c.lineWidth = 3; c.shadowColor = color; c.shadowBlur = 12;
      c.strokeRect(26, 26, width - 52, height - 52);
      for (let x = 90; x < width - 60; x += 64) { c.beginPath(); c.moveTo(x, 26); c.lineTo(x, height - 26); c.globalAlpha = 0.35; c.stroke(); c.globalAlpha = 1; }
      if (text) { c.font = `700 ${Math.round(height * 0.34)}px "Geist Mono", ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, width / 2, height / 2 + 4); }
    }
    if (style.frost) { const rim = c.createLinearGradient(0, height, 0, height * 0.55); rim.addColorStop(0, 'rgba(120,200,255,.28)'); rim.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = rim; c.fillRect(0, 0, width, height); frostwork(c, q, width, height, true); }
    if (style.forge) forgework(c, q, color, width, height, true);
    if (style.stars) starfield(c, q, style.stars, width, height, true);
    if (text && style.glowText) { c.globalAlpha = style.glowText; stencil(c, text, style.ink, width, height); c.globalAlpha = 1; }
    return canvas;
  }
  c.fillStyle = style.base; c.fillRect(0, 0, width, height);
  if (style.camo) for (let i = 0; i < 46; i += 1) { c.fillStyle = style.camo[i % style.camo.length]; c.beginPath(); c.ellipse(r() * width, r() * height, 18 + r() * 46, 10 + r() * 26, r() * Math.PI, 0, Math.PI * 2); c.fill(); }
  if (style.weave) for (let x = 0; x < width; x += 16) for (let y = 0; y < height; y += 16) { const g = ((x + y) / 16) % 2 ? c.createLinearGradient(x, y, x + 16, y) : c.createLinearGradient(x, y, x, y + 16); g.addColorStop(0, '#2a2633'); g.addColorStop(1, '#0f0d15'); c.fillStyle = g; c.fillRect(x, y, 16, 16); }
  if (style.stripes) tigerStripes(c, q, style.stripes, width, height);
  if (style.tags) graffiti(c, q, style.tags, width, height);
  if (style.forge) hammered(c, r, width, height);
  if (style.stars) starfield(c, q, style.stars, width, height, false);
  // Pressed panel with a lit top edge and a shadowed bottom edge.
  c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(22, 22, width - 44, height - 44);
  c.fillStyle = style.camo || style.weave || printed ? 'rgba(0,0,0,0)' : style.base; c.fillRect(26, 26, width - 52, height - 52);
  c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(22, 22, width - 44, 3);
  c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(22, height - 25, width - 44, 3);
  for (let x = 70; x < width - 40; x += 92) { c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(x, 28, 5, height - 56); c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x + 5, 28, 2, height - 56); }   // ribs
  if (style.hazard) { c.save(); c.beginPath(); c.rect(width - 150, height - 62, 124, 36); c.clip(); c.fillStyle = '#f2c14e'; c.fillRect(width - 150, height - 62, 124, 36); c.fillStyle = '#15171a'; for (let k = -40; k < 200; k += 28) { c.beginPath(); c.moveTo(width - 150 + k, height - 26); c.lineTo(width - 136 + k, height - 26); c.lineTo(width - 100 + k, height - 62); c.lineTo(width - 114 + k, height - 62); c.fill(); } c.restore(); }
  if (style.frost) {
    for (let i = 0; i < 90; i += 1) { c.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.06})`; c.fillRect(0, r() * height, width, 1); }   // brushed steel
    const haze = c.createLinearGradient(0, height, 0, height * 0.45); haze.addColorStop(0, 'rgba(236,248,255,.5)'); haze.addColorStop(1, 'rgba(236,248,255,0)'); c.fillStyle = haze; c.fillRect(0, 0, width, height);
    frostwork(c, q, width, height, false);
  }
  if (style.forge) forgework(c, q, color, width, height, false);
  for (const [x, y] of RIVETS(width, height)) { c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.arc(x + 1, y + 1.5, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = style.rivet || (style.trim === '#c9a14a' ? '#c9a14a' : '#8e98a1'); c.beginPath(); c.arc(x, y, 4.2, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.arc(x - 1.2, y - 1.4, 1.4, 0, Math.PI * 2); c.fill(); }
  if (text) {
    // Stencil: the letters are broken by bridges, like sprayed paint through a cut card.
    c.font = `700 ${Math.round(height * 0.34)}px "Geist Mono", ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (busy) { c.globalAlpha = 0.9; stencil(c, text, style.ink, width, height); c.globalAlpha = 1; } else {
      c.fillStyle = style.ink; c.globalAlpha = 0.9; c.fillText(text, width / 2, height / 2 + 4); c.globalAlpha = 1;
      c.fillStyle = style.camo || style.weave ? 'rgba(20,22,18,.9)' : style.base; for (let x = width / 2 - 170; x < width / 2 + 170; x += 38) c.fillRect(x, height / 2 - 46, 4, 100);
    }
    c.font = '500 15px "Geist Mono", ui-monospace, monospace'; c.fillStyle = style.ink; c.globalAlpha = 0.6; c.textAlign = 'left'; c.fillText('KROSSHAIR ORDNANCE', 38, height - 42); c.fillText(`LOT ${1000 + Math.floor(r() * 8999)}`, 38, 46); c.globalAlpha = 1;
  }
  if (logo) { const x = width / 2, y = height / 2, s = height * 0.27; c.strokeStyle = style.ink; c.globalAlpha = 0.85; c.lineWidth = 5; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.stroke(); for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2; c.beginPath(); c.moveTo(x + Math.cos(a) * s * 0.78, y + Math.sin(a) * s * 0.78); c.lineTo(x + Math.cos(a) * s * 1.25, y + Math.sin(a) * s * 1.25); c.stroke(); } c.lineWidth = 9; c.strokeStyle = style.accent || color; c.beginPath(); c.moveTo(x - s * 0.28, y - s * 0.5); c.lineTo(x - s * 0.28, y + s * 0.5); c.moveTo(x + s * 0.36, y - s * 0.5); c.lineTo(x - s * 0.22, y + s * 0.02); c.lineTo(x + s * 0.38, y + s * 0.5); c.stroke(); c.globalAlpha = 1; }
  // Wear: scratches, chipped edges, grime toward the bottom.
  for (let i = 0; i < 70; i += 1) { c.strokeStyle = `rgba(${r() < 0.6 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.1})`; c.lineWidth = 0.6 + r(); const x = r() * width, y = r() * height, a = r() * Math.PI, l = 8 + r() * 46; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  for (let i = 0; i < 40; i += 1) { c.fillStyle = `rgba(190,200,208,${0.15 + r() * 0.3})`; const edge = Math.floor(r() * 4); c.fillRect(edge < 2 ? r() * width : (edge === 2 ? 0 : width - 5), edge < 2 ? (edge ? height - 4 : 0) : r() * height, 2 + r() * 9, 2 + r() * 4); }
  const grime = c.createLinearGradient(0, height * 0.55, 0, height); grime.addColorStop(0, 'rgba(0,0,0,0)'); grime.addColorStop(1, 'rgba(0,0,0,.32)'); c.fillStyle = grime; c.fillRect(0, 0, width, height);
  return canvas;
}
function texture(canvas) { const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; }

// crate: an entry of CRATES (id, color). Returns a group; moving parts are in userData.
export function buildCrate(crate) {
  const style = STYLES[crate.id] || { base: crate.color, dark: '#20262c', trim: '#1c2227', ink: '#e6edf1', mark: (crate.name || 'CRATE').split(' ')[0].toUpperCase() };
  const root = new THREE.Group();
  const skin = (options) => { const material = new THREE.MeshStandardMaterial({ map: texture(panel(style, crate.color, options)), roughness: 0.62, metalness: style.metal ?? 0.35 }); if (style.grid || style.frost || style.forge || style.stars) { material.emissiveMap = texture(panel(style, crate.color, { ...options, emit: true })); material.emissive.set('#ffffff'); material.emissiveIntensity = style.glow ?? 1; } return material; };
  const front = skin({ text: style.mark, seed: 11 }), back = skin({ seed: 12 }), side = skin({ width: 320, logo: true, seed: 13 }), top = skin({ height: 320, logo: true, seed: 14 });
  const plain = new THREE.MeshStandardMaterial({ color: style.dark, roughness: 0.7, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.35, metalness: 0.8 });
  const bright = new THREE.MeshStandardMaterial({ color: style.bright || (style.trim === '#c9a14a' ? '#d8b04a' : '#aab4bd'), roughness: 0.3, metalness: 0.85 });
  const glow = new THREE.MeshStandardMaterial({ color: crate.color, emissive: crate.color, emissiveIntensity: 1.2, roughness: 0.4 });
  const mesh = (parent, geometry, material, x, y, z) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m; };

  const body = new THREE.Group(); root.add(body);
  mesh(body, new THREE.BoxGeometry(W, H, D), [side, side, plain, plain, front, back], 0, H / 2, 0);
  for (const x of [-1, 1]) for (const z of [-1, 1]) mesh(body, new THREE.BoxGeometry(0.06, H + 0.02, 0.06), trim, x * (W / 2 - 0.01), H / 2, z * (D / 2 - 0.01));   // corner posts
  for (const z of [-1, 1]) { mesh(body, new THREE.BoxGeometry(W + 0.04, 0.045, 0.05), trim, 0, 0.0225, z * (D / 2)); mesh(body, new THREE.BoxGeometry(W + 0.04, 0.03, 0.05), trim, 0, H - 0.015, z * (D / 2)); }
  for (const x of [-1, 1]) { mesh(body, new THREE.BoxGeometry(0.05, 0.045, D), trim, x * (W / 2), 0.0225, 0); const handle = mesh(body, new THREE.TorusGeometry(0.075, 0.013, 6, 14, Math.PI), bright, x * (W / 2 + 0.018), H * 0.55, 0); handle.rotation.set(0, Math.PI / 2, Math.PI); }
  for (const x of [-1, 1]) for (const z of [-1, 1]) mesh(body, new THREE.BoxGeometry(0.11, 0.03, 0.11), plain, x * (W / 2 - 0.07), -0.015, z * (D / 2 - 0.07));   // feet
  mesh(body, new THREE.BoxGeometry(W + 0.012, 0.014, D + 0.012), glow, 0, H - 0.003, 0);      // the seam the light leaks from
  // What is inside: a bed of light, and a light that actually falls on the lid.
  const bed = mesh(body, new THREE.PlaneGeometry(W - 0.08, D - 0.08), new THREE.MeshBasicMaterial({ color: crate.color, transparent: true, opacity: 0 }), 0, H - 0.03, 0); bed.rotation.x = -Math.PI / 2;
  const lamp = new THREE.PointLight(crate.color, 0, 3.2); lamp.position.set(0, H + 0.1, 0); root.add(lamp);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: crate.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = mesh(root, new THREE.CylinderGeometry(0.62, 0.3, 2.4, 24, 1, true), beamMaterial, 0, H + 1.2, 0);

  // Lid, hinged along the back edge.
  const hinge = new THREE.Group(); hinge.position.set(0, H, -D / 2); root.add(hinge);
  mesh(hinge, new THREE.BoxGeometry(W + 0.05, LID, D + 0.05), [side, side, top, plain, front, back], 0, LID / 2, D / 2);
  for (const x of [-1, 1]) mesh(hinge, new THREE.BoxGeometry(0.07, LID + 0.02, D + 0.07), trim, x * (W / 2), LID / 2, D / 2);
  mesh(hinge, new THREE.BoxGeometry(W + 0.06, 0.03, 0.06), trim, 0, 0.015, D + 0.02);
  for (const x of [-0.3, 0.3]) { const knuckle = mesh(root, new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), bright, x, H, -D / 2 - 0.02); knuckle.rotation.z = Math.PI / 2; }
  // Latches: a hasp on the body and a toggle that swings down and out when it is thrown.
  const latches = [-0.27, 0.27].map((x) => {
    mesh(body, new THREE.BoxGeometry(0.1, 0.07, 0.02), bright, x, H - 0.06, D / 2 + 0.035);
    const pivot = new THREE.Group(); pivot.position.set(x, H - 0.03, D / 2 + 0.05); root.add(pivot);
    mesh(pivot, new THREE.BoxGeometry(0.075, 0.13, 0.018), bright, 0, 0.05, 0);
    mesh(pivot, new THREE.BoxGeometry(0.05, 0.02, 0.03), glow, 0, 0.1, 0.004);
    return pivot;
  });
  root.userData = { hinge, latches, glow, lamp, bed, beam, beamMaterial, color: new THREE.Color(crate.color) };
  return root;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const backOut = (k) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
// open: seconds since the crate was clicked, or null while it waits. now: any running clock, for the idle breathing.
export function poseCrate(crate, open, now) {
  const d = crate.userData;
  if (open === null || open === undefined) {
    crate.position.y = Math.sin(now * 1.4) * 0.012;
    crate.rotation.z = 0;
    d.hinge.rotation.x = 0;
    d.latches.forEach((latch) => { latch.rotation.x = 0; });
    d.glow.emissiveIntensity = 0.9 + Math.sin(now * 2.2) * 0.35;
    d.lamp.intensity = 0; d.bed.material.opacity = 0; d.beamMaterial.opacity = 0;
    return;
  }
  // Something inside wants out: a rattle that builds until the latches go.
  const rattle = clamp01(open / 0.62) * (1 - clamp01((open - 0.62) / 0.2));
  crate.rotation.z = Math.sin(open * 46) * 0.035 * rattle;
  crate.position.y = Math.abs(Math.sin(open * 31)) * 0.03 * rattle;
  d.latches.forEach((latch, index) => { const k = clamp01((open - (0.36 + index * 0.15)) / 0.1); latch.rotation.x = backOut(k) * 2.0 * (k > 0 ? 1 : 0); });
  const lift = clamp01((open - 0.66) / 0.55);
  d.hinge.rotation.x = -backOut(lift) * 1.95 * (lift > 0 ? 1 : 0);
  const light = clamp01((open - 0.6) / 0.35);
  const flash = Math.max(0, 1 - Math.abs(open - 0.78) / 0.14);
  d.glow.emissiveIntensity = 1.2 + clamp01(open / 0.6) * 2.4 + flash * 3;
  d.lamp.intensity = light * 9 + flash * 14;
  d.bed.material.opacity = light;
  d.beamMaterial.opacity = light * (0.2 + Math.sin(now * 9) * 0.03) + flash * 0.35;
  d.beam.scale.set(0.6 + light * 0.4, clamp01((open - 0.66) / 0.4), 0.6 + light * 0.4);
  d.beam.position.y = H + 1.2 * d.beam.scale.y;
  d.beam.rotation.y = now * 0.6;
}
