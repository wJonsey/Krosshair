// Visualize sound effects: glowing arcs around the crosshair that point at nearby
// sounds (gunshots, footsteps, blades, glass, gadgets), with an icon for each.
import { bus, game, isEnemy } from './state.js';

// range: how far away it still shows (m). life: seconds on screen. color: [enemy, friendly].
const KINDS = {
  shot: { range: 140, life: 2.2, color: ['#ff6a3d', '#f2f0ea'] },
  step: { range: 32, life: 0.9, color: ['#5fd4ff', '#bfeeff'] },
  swing: { range: 14, life: 1, color: ['#ff6a3d', '#f2f0ea'] },
  glass: { range: 55, life: 1.6, color: ['#f2f0ea', '#f2f0ea'] },
  gadget: { range: 40, life: 1.6, color: ['#ffc857', '#6ce6d1'] },
};

export class SoundViz {
  constructor(camera) {
    this.camera = camera;
    this.sounds = new Map(); // `${kind}:${source}` → sound, so one pilot walking is one arc that follows them
    this.canvas = document.querySelector('#sound-viz');
    this.context = this.canvas.getContext('2d');
    this.width = 0; this.height = 0;
    bus.on('sound', (sound) => this.add(sound));
    bus.on('spawned', () => this.sounds.clear());
  }

  add({ kind, id = null, pos }) {
    const spec = KINDS[kind];
    if (!spec || !pos || !game.settings.visualizeSound || game.screen !== 'game') return;
    if (id && id === game.id) return;
    const camera = this.camera.position;
    const distance = Math.hypot(pos[0] - camera.x, pos[2] - camera.z);
    if (distance > spec.range) return;
    const enemy = id ? isEnemy(id) : true;
    if (kind === 'step' && !enemy) return; // teammates' footsteps would drown out everything else
    const key = `${kind}:${id || pos.map(Math.round).join(',')}`;
    const sound = this.sounds.get(key) || { kind, spec };
    Object.assign(sound, { x: pos[0], y: pos[1], z: pos[2], enemy, born: performance.now() / 1000 });
    this.sounds.set(key, sound);
  }

  resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
    if (width === this.width && height === this.height) return;
    this.width = this.canvas.width = width; this.height = this.canvas.height = height;
    this.ratio = ratio;
  }

  update() {
    const { context } = this;
    const active = game.settings.visualizeSound && game.screen === 'game' && this.sounds.size > 0;
    this.canvas.classList.toggle('hidden', !active);
    if (!active) { this.sounds.clear(); return; }
    this.resize();
    context.clearRect(0, 0, this.width, this.height);
    const now = performance.now() / 1000;
    const camera = this.camera;
    const cx = this.width / 2, cy = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.24;
    const ratio = this.ratio;
    for (const [key, sound] of this.sounds) {
      const age = now - sound.born;
      if (age > sound.spec.life) { this.sounds.delete(key); continue; }
      const dx = sound.x - camera.position.x, dz = sound.z - camera.position.z;
      const distance = Math.hypot(dx, dz);
      const closeness = 1 - Math.min(1, distance / sound.spec.range);
      // Quick fade in, long fade out, dimmer the further away it is.
      const alpha = Math.min(1, age / 0.08) * Math.min(1, (sound.spec.life - age) / (sound.spec.life * 0.5)) * (0.35 + closeness * 0.65);
      const angle = camera.rotation.y - Math.atan2(-dx, -dz); // 0 = straight ahead, clockwise on screen
      const color = sound.spec.color[sound.enemy ? 0 : 1];
      const spread = 0.16 + closeness * 0.16;
      const width = (5 + closeness * 6) * ratio;
      context.save();
      context.globalAlpha = alpha;
      context.shadowColor = color;
      context.shadowBlur = 14 * ratio;
      context.lineCap = 'round';
      const start = angle - Math.PI / 2 - spread, end = angle - Math.PI / 2 + spread;
      const gradient = context.createConicGradient(start, cx, cy);
      const span = (spread * 2) / (Math.PI * 2);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(span * 0.5, color);
      gradient.addColorStop(span, 'rgba(0,0,0,0)');
      context.strokeStyle = gradient;
      context.lineWidth = width;
      context.beginPath();
      context.arc(cx, cy, radius, start, end);
      context.stroke();
      // Icon just inside the arc, plus a chevron if the sound is well above or below.
      const ix = cx + Math.sin(angle) * (radius - 26 * ratio), iy = cy - Math.cos(angle) * (radius - 26 * ratio);
      context.shadowBlur = 6 * ratio;
      context.fillStyle = color; context.strokeStyle = color;
      drawIcon(context, sound.kind, ix, iy, ratio);
      const dy = sound.y - (camera.position.y - 1.6);
      if (Math.abs(dy) > 2.5) {
        const up = dy > 0, s = 4 * ratio, oy = iy + (up ? -14 : 14) * ratio;
        context.lineWidth = 2 * ratio;
        context.beginPath(); context.moveTo(ix - s, oy + (up ? s / 2 : -s / 2)); context.lineTo(ix, oy + (up ? -s / 2 : s / 2)); context.lineTo(ix + s, oy + (up ? s / 2 : -s / 2)); context.stroke();
      }
      context.restore();
    }
  }
}

function drawIcon(context, kind, x, y, ratio) {
  const s = ratio;
  context.lineWidth = 2 * s;
  context.beginPath();
  if (kind === 'step') {
    // Two footprints.
    for (const [ox, oy] of [[-3.5, 3], [3.5, -3]]) {
      context.ellipse(x + ox * s, y + oy * s, 2.4 * s, 4 * s, 0, 0, Math.PI * 2);
      context.moveTo(x + (ox + 1.8) * s, y + (oy + 6.5) * s);
      context.arc(x + ox * s, y + (oy + 6.5) * s, 1.8 * s, 0, Math.PI * 2);
    }
    context.fill();
  } else if (kind === 'shot') {
    // Muzzle burst.
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2, r = (i % 2 ? 3.5 : 9) * s;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) context.lineTo(px, py); else context.moveTo(px, py);
    }
    context.closePath(); context.fill();
  } else if (kind === 'swing') {
    context.moveTo(x - 7 * s, y + 7 * s); context.lineTo(x + 7 * s, y - 7 * s); context.stroke();
    context.beginPath(); context.moveTo(x - 7 * s, y + 3 * s); context.lineTo(x - 3 * s, y + 7 * s); context.stroke();
  } else if (kind === 'glass') {
    for (const [ax, ay, bx, by] of [[-6, -6, 0, 0], [0, 0, 7, -3], [0, 0, -2, 7], [0, 0, 5, 6]]) { context.moveTo(x + ax * s, y + ay * s); context.lineTo(x + bx * s, y + by * s); }
    context.stroke();
  } else {
    context.arc(x, y, 3 * s, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(x, y, 7.5 * s, 0, Math.PI * 2); context.stroke();
  }
}
