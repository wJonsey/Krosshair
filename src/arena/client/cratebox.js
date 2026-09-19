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
};
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// One painted panel: paint, a pressed inner panel, rivets, stencil, wear. `emit` paints only what glows.
function panel(style, color, { width = 512, height = 256, text = '', logo = false, emit = false, seed = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d'), r = seeded(seed);
  if (emit) {
    c.fillStyle = '#000'; c.fillRect(0, 0, width, height);
    if (!style.grid) return canvas;
    c.strokeStyle = color; c.lineWidth = 3; c.shadowColor = color; c.shadowBlur = 12;
    c.strokeRect(26, 26, width - 52, height - 52);
    for (let x = 90; x < width - 60; x += 64) { c.beginPath(); c.moveTo(x, 26); c.lineTo(x, height - 26); c.globalAlpha = 0.35; c.stroke(); c.globalAlpha = 1; }
    if (text) { c.font = `700 ${Math.round(height * 0.34)}px "Geist Mono", ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, width / 2, height / 2 + 4); }
    return canvas;
  }
  c.fillStyle = style.base; c.fillRect(0, 0, width, height);
  if (style.camo) for (let i = 0; i < 46; i += 1) { c.fillStyle = style.camo[i % style.camo.length]; c.beginPath(); c.ellipse(r() * width, r() * height, 18 + r() * 46, 10 + r() * 26, r() * Math.PI, 0, Math.PI * 2); c.fill(); }
  if (style.weave) for (let x = 0; x < width; x += 16) for (let y = 0; y < height; y += 16) { const g = ((x + y) / 16) % 2 ? c.createLinearGradient(x, y, x + 16, y) : c.createLinearGradient(x, y, x, y + 16); g.addColorStop(0, '#2a2633'); g.addColorStop(1, '#0f0d15'); c.fillStyle = g; c.fillRect(x, y, 16, 16); }
  // Pressed panel with a lit top edge and a shadowed bottom edge.
  c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(22, 22, width - 44, height - 44);
  c.fillStyle = style.camo || style.weave ? 'rgba(0,0,0,0)' : style.base; c.fillRect(26, 26, width - 52, height - 52);
  c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(22, 22, width - 44, 3);
  c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(22, height - 25, width - 44, 3);
  for (let x = 70; x < width - 40; x += 92) { c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(x, 28, 5, height - 56); c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x + 5, 28, 2, height - 56); }   // ribs
  if (style.hazard) { c.save(); c.beginPath(); c.rect(width - 150, height - 62, 124, 36); c.clip(); c.fillStyle = '#f2c14e'; c.fillRect(width - 150, height - 62, 124, 36); c.fillStyle = '#15171a'; for (let k = -40; k < 200; k += 28) { c.beginPath(); c.moveTo(width - 150 + k, height - 26); c.lineTo(width - 136 + k, height - 26); c.lineTo(width - 100 + k, height - 62); c.lineTo(width - 114 + k, height - 62); c.fill(); } c.restore(); }
  for (const [x, y] of [[12, 12], [width - 12, 12], [12, height - 12], [width - 12, height - 12], [width / 2, 12], [width / 2, height - 12]]) { c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.arc(x + 1, y + 1.5, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = style.trim === '#c9a14a' ? '#c9a14a' : '#8e98a1'; c.beginPath(); c.arc(x, y, 4.2, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.arc(x - 1.2, y - 1.4, 1.4, 0, Math.PI * 2); c.fill(); }
  if (text) {
    // Stencil: the letters are broken by bridges, like sprayed paint through a cut card.
    c.font = `700 ${Math.round(height * 0.34)}px "Geist Mono", ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = style.ink; c.globalAlpha = 0.9; c.fillText(text, width / 2, height / 2 + 4); c.globalAlpha = 1;
    c.fillStyle = style.camo || style.weave ? 'rgba(20,22,18,.9)' : style.base; for (let x = width / 2 - 170; x < width / 2 + 170; x += 38) c.fillRect(x, height / 2 - 46, 4, 100);
    c.font = '500 15px "Geist Mono", ui-monospace, monospace'; c.fillStyle = style.ink; c.globalAlpha = 0.6; c.textAlign = 'left'; c.fillText('KROSSHAIR ORDNANCE', 38, height - 42); c.fillText(`LOT ${1000 + Math.floor(r() * 8999)}`, 38, 46); c.globalAlpha = 1;
  }
  if (logo) { const x = width / 2, y = height / 2, s = height * 0.27; c.strokeStyle = style.ink; c.globalAlpha = 0.85; c.lineWidth = 5; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.stroke(); for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2; c.beginPath(); c.moveTo(x + Math.cos(a) * s * 0.78, y + Math.sin(a) * s * 0.78); c.lineTo(x + Math.cos(a) * s * 1.25, y + Math.sin(a) * s * 1.25); c.stroke(); } c.lineWidth = 9; c.strokeStyle = color; c.beginPath(); c.moveTo(x - s * 0.28, y - s * 0.5); c.lineTo(x - s * 0.28, y + s * 0.5); c.moveTo(x + s * 0.36, y - s * 0.5); c.lineTo(x - s * 0.22, y + s * 0.02); c.lineTo(x + s * 0.38, y + s * 0.5); c.stroke(); c.globalAlpha = 1; }
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
  const skin = (options) => { const material = new THREE.MeshStandardMaterial({ map: texture(panel(style, crate.color, options)), roughness: 0.62, metalness: style.metal ?? 0.35 }); if (style.grid) { material.emissiveMap = texture(panel(style, crate.color, { ...options, emit: true })); material.emissive.set('#ffffff'); material.emissiveIntensity = style.glow; } return material; };
  const front = skin({ text: style.mark, seed: 11 }), back = skin({ seed: 12 }), side = skin({ width: 320, logo: true, seed: 13 }), top = skin({ height: 320, logo: true, seed: 14 });
  const plain = new THREE.MeshStandardMaterial({ color: style.dark, roughness: 0.7, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.35, metalness: 0.8 });
  const bright = new THREE.MeshStandardMaterial({ color: style.trim === '#c9a14a' ? '#d8b04a' : '#aab4bd', roughness: 0.3, metalness: 0.85 });
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
