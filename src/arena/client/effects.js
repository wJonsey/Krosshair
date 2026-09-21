// Transient visuals: tracers, vapour trails, impact particles and decals,
// muzzle lights, pings, radar pulse rings.
import * as THREE from 'three';

const MAX_PARTICLES = 900;
const DUST = { concrete: '#b9b4aa', wall: '#8c949b', brick: '#b0715a', plaster: '#c9c3b2', stone: '#b5b8b6', tunnel: '#8a9094', asphalt: '#6d7379', paving: '#9a9da0', gravel: '#9b9384', grass: '#5f8a5c', wood: '#c29a62', crate: '#c9a466', cloth: '#d97762', clothAlt: '#e3c565', metal: '#ffd79a', rust: '#ffb677', teal: '#ffd79a', glass: '#d6f3fa', shield: '#9fe4ff', barrier: '#9ff5e6', flesh: '#ff6f91', target: '#e9e4d8' };
const SPARKY = new Set(['metal', 'rust', 'teal', 'shield', 'barrier']);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.trails = [];
    this.decals = [];
    this.rings = [];
    this.pings = [];
    // One shared particle cloud, simulated on the CPU.
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, gravity: 9, size: 1, r: 1, g: 1, b: 1 }));
    this.cursor = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.cloud = new THREE.Points(geometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: 'attribute float size; varying vec3 vColor; void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (220.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vColor; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vColor, smoothstep(0.5, 0.1, d) * 0.9); }',
    }));
    this.cloud.frustumCulled = false;
    scene.add(this.cloud);
    this.tracerGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    this.tracerGeometry.rotateX(Math.PI / 2);
    this.decalGeometry = new THREE.CircleGeometry(1, 8);
    this.decalMaterial = new THREE.MeshBasicMaterial({ color: '#0b0d10', transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.color = new THREE.Color();
    // Fixed pool: adding or removing lights at runtime would force shader recompiles mid-fight.
    this.lightPool = Array.from({ length: 3 }, () => { const light = new THREE.PointLight('#ffb45e', 0, 16, 1.8); scene.add(light); return { light, life: 0 }; });
    this.lightCursor = 0;
  }

  emit(point, count, { color = '#ffffff', speed = 2, spread = 1, up = 1, life = 0.5, gravity = 9, size = 0.06, normal = null }) {
    this.color.set(color);
    for (let i = 0; i < count; i += 1) {
      const p = this.particles[this.cursor];
      const index = this.cursor * 3;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      this.positions[index] = point[0]; this.positions[index + 1] = point[1]; this.positions[index + 2] = point[2];
      const rx = (Math.random() - 0.5) * spread, ry = (Math.random() - 0.5) * spread + up * 0.4, rz = (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vx = (rx + (normal ? normal[0] : 0)) * s; p.vy = (ry + (normal ? normal[1] : 0)) * s; p.vz = (rz + (normal ? normal[2] : 0)) * s;
      p.life = p.max = life * (0.6 + Math.random() * 0.7);
      p.gravity = gravity; p.size = size * (0.6 + Math.random() * 0.8);
      const shade = 0.75 + Math.random() * 0.35;
      p.r = this.color.r * shade; p.g = this.color.g * shade; p.b = this.color.b * shade;
    }
  }

  tracer(from, to, color = '#ffc857', width = 0.014) {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
    const length = start.distanceTo(end);
    if (length < 0.5) return;
    // Prism Rail, the Dev class tracer: a colour that walks the whole spectrum, a white-hot core, and a
    // wider halo that hangs on a little longer.
    const prism = color === 'devprism';
    if (prism) color = new THREE.Color().setHSL((performance.now() / 900) % 1, 1, 0.6);
    const beam = (tint, size, life, opacity = 0.95) => {
      const mesh = new THREE.Mesh(this.tracerGeometry, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      mesh.position.copy(start).lerp(end, 0.5);
      mesh.scale.set(size, size, length);
      mesh.lookAt(end);
      this.scene.add(mesh);
      this.tracers.push({ mesh, life, max: life, base: opacity });
    };
    beam(color, width, 0.11);
    if (prism) { beam('#ffffff', width * 0.45, 0.11); beam(color, width * 3.2, 0.3, 0.35); }
  }

  // The long rifle leaves a lingering vapour trail that points back at the shooter.
  trail(from, to) {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
    const length = start.distanceTo(end);
    if (length < 2) return;
    const mesh = new THREE.Mesh(this.tracerGeometry, new THREE.MeshBasicMaterial({ color: '#dfe8f0', transparent: true, opacity: 0.22, depthWrite: false }));
    mesh.position.copy(start).lerp(end, 0.5);
    mesh.scale.set(0.02, 0.02, length);
    mesh.lookAt(end);
    this.scene.add(mesh);
    this.trails.push({ mesh, life: 1.6, max: 1.6 });
  }

  impact(point, normal, material, exit = false) {
    const color = DUST[material] || DUST.concrete;
    if (SPARKY.has(material)) this.emit(point, 9, { color, speed: 5, spread: 1.2, life: 0.28, gravity: 12, size: 0.035, normal });
    else this.emit(point, exit ? 12 : 8, { color, speed: exit ? 3.4 : 2.2, spread: 0.9, life: 0.6, gravity: 5, size: 0.085, normal });
    if (material === 'glass' || material === 'shield' || material === 'barrier' || material === 'flesh') return;
    const decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
    decal.position.set(point[0] + normal[0] * 0.012, point[1] + normal[1] * 0.012, point[2] + normal[2] * 0.012);
    decal.lookAt(decal.position.x + normal[0], decal.position.y + normal[1], decal.position.z + normal[2]);
    decal.scale.setScalar(0.035 + Math.random() * 0.02);
    this.scene.add(decal);
    this.decals.push(decal);
    if (this.decals.length > 90) this.scene.remove(this.decals.shift());
  }

  shatter(box) {
    const count = 46;
    for (let i = 0; i < count; i += 1) {
      const point = [box.min[0] + Math.random() * (box.max[0] - box.min[0]), box.min[1] + Math.random() * (box.max[1] - box.min[1]), box.min[2] + Math.random() * (box.max[2] - box.min[2])];
      this.emit(point, 1, { color: '#d6f3fa', speed: 2.2, spread: 1.6, life: 0.9, gravity: 11, size: 0.07 });
    }
  }

  hitPuff(point) { this.emit(point, 12, { color: DUST.flesh, speed: 2.6, spread: 1.4, life: 0.35, gravity: 6, size: 0.06 }); }
  burst(point, color, count = 30) { this.emit(point, count, { color, speed: 4, spread: 2, life: 0.7, gravity: 4, size: 0.08 }); }

  muzzleLight(position, color = '#ffb45e', power = 22) {
    const slot = this.lightPool[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lightPool.length;
    slot.light.color.set(color);
    slot.light.position.copy(position);
    slot.light.intensity = power;
    slot.life = 0.07;
  }

  ring(x, y, z, radius, color = '#6ce6d1') {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.15, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0, max: 1.1, radius });
  }

  ping(x, y, z, label, danger = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const context = canvas.getContext('2d');
    const color = danger ? '#ff4d3d' : '#ffc857';
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 6;
    context.beginPath(); context.moveTo(128, 100); context.lineTo(108, 62); context.lineTo(128, 24); context.lineTo(148, 62); context.closePath(); context.stroke();
    context.font = '400 24px "Michroma", sans-serif'; context.textAlign = 'center';
    context.fillText(label.toUpperCase(), 128, 124);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, fog: false, sizeAttenuation: false }));
    sprite.scale.set(0.12, 0.06, 1);
    sprite.position.set(x, y + 0.6, z);
    sprite.renderOrder = 25;
    this.scene.add(sprite);
    this.pings.push({ sprite, life: 5 });
  }

  clearRound() {
    this.decals.forEach((decal) => this.scene.remove(decal));
    this.decals = [];
    this.pings.forEach((ping) => { this.scene.remove(ping.sprite); ping.sprite.material.map.dispose(); });
    this.pings = [];
  }

  update(dt) {
    let moved = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = this.particles[i];
      if (p.life <= 0) { if (this.sizes[i] !== 0) { this.sizes[i] = 0; moved = true; } continue; }
      p.life -= dt;
      const index = i * 3;
      p.vy -= p.gravity * dt;
      this.positions[index] += p.vx * dt; this.positions[index + 1] += p.vy * dt; this.positions[index + 2] += p.vz * dt;
      const k = Math.max(0, p.life / p.max);
      this.sizes[i] = p.size * (0.4 + k * 0.6);
      this.colors[index] = p.r * k; this.colors[index + 1] = p.g * k; this.colors[index + 2] = p.b * k;
      moved = true;
    }
    // The whole cloud goes back to the card every time one of these is set, and between firefights
    // nothing in it has moved. Nine hundred particles of position, colour and size is not free.
    if (moved) {
      const attributes = this.cloud.geometry.attributes;
      attributes.position.needsUpdate = true; attributes.color.needsUpdate = true; attributes.size.needsUpdate = true;
    }
    const fade = (list, shape) => list.filter((item) => {
      item.life -= dt;
      if (item.life <= 0) { this.scene.remove(item.mesh); item.mesh.material.dispose(); return false; }
      shape(item);
      return true;
    });
    this.tracers = fade(this.tracers, (item) => { item.mesh.material.opacity = (item.base ?? 1) * (item.life / item.max); });
    this.trails = fade(this.trails, (item) => { item.mesh.material.opacity = 0.22 * (item.life / item.max); const grow = 0.02 + (1 - item.life / item.max) * 0.05; item.mesh.scale.x = grow; item.mesh.scale.y = grow; });
    this.rings = this.rings.filter((item) => {
      item.life += dt;
      const k = item.life / item.max;
      if (k >= 1) { this.scene.remove(item.mesh); item.mesh.geometry.dispose(); return false; }
      item.mesh.scale.setScalar(Math.max(0.01, item.radius * (1 - (1 - k) ** 2)));
      item.mesh.material.opacity = 0.8 * (1 - k);
      return true;
    });
    for (const slot of this.lightPool) if (slot.life > 0) { slot.life -= dt; if (slot.life <= 0) slot.light.intensity = 0; }
    this.pings = this.pings.filter((item) => { item.life -= dt; item.sprite.material.opacity = Math.min(1, item.life); if (item.life <= 0) { this.scene.remove(item.sprite); item.sprite.material.map.dispose(); return false; } return true; });
  }
}
