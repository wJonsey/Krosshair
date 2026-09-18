// Scene construction: turns the shared box map into instanced meshes with
// procedural surface detail, and owns sky, weather, lighting variants, glass,
// shields and the spawn barriers.
import * as THREE from 'three';
import { MATERIALS } from '../shared/constants.js';
import { getMap } from '../shared/map.js';
import { World } from '../shared/physics.js';

const PATTERNS = { noise: 0, panels: 1, bricks: 2, planks: 3, ribs: 4, tiles: 5, stripes: 6, windows: 7, strata: 8 };

const VARIANTS = {
  dusk: { top: '#1d2a4a', horizon: '#f0a35e', fog: '#c58a66', fogNear: 45, fogFar: 210, sun: '#ffb070', sunPower: 2.6, sunDir: [-0.5, 0.5, 0.42], hemiSky: '#a9b6d6', hemiGround: '#6b5447', hemi: 1.7, lamps: 0.7, exposure: 1.05, stars: 0.15, windows: 0.5 },
  night: { top: '#03050a', horizon: '#142036', fog: '#0a111b', fogNear: 10, fogFar: 100, sun: '#9db9ff', sunPower: 1.1, sunDir: [0.35, 0.7, -0.3], hemiSky: '#5a78ad', hemiGround: '#2c3a52', hemi: 1.7, lamps: 1.6, exposure: 1.2, stars: 1, windows: 1, haze: 0.8 },
  storm: { top: '#262c33', horizon: '#5d6770', fog: '#4f5860', fogNear: 8, fogFar: 110, sun: '#b4c0cd', sunPower: 1.0, sunDir: [0.2, 0.8, 0.35], hemiSky: '#9aa7b4', hemiGround: '#4a4f54', hemi: 1.6, lamps: 0.9, exposure: 0.95, stars: 0, windows: 0.7, haze: 0.85, precip: 'rain' },
  snow: { top: '#a9b5c1', horizon: '#dde5eb', fog: '#d3dce3', fogNear: 10, fogFar: 92, sun: '#ffffff', sunPower: 1.3, sunDir: [0.3, 0.75, 0.3], hemiSky: '#e6eef6', hemiGround: '#a8b3be', hemi: 1.9, lamps: 0.8, exposure: 0.95, stars: 0, windows: 0.5, haze: 0.92, precip: 'snow' },
  haze: { top: '#8f7655', horizon: '#dfc08c', fog: '#d1af7a', fogNear: 18, fogFar: 150, sun: '#ffd9a0', sunPower: 2.4, sunDir: [-0.4, 0.6, 0.3], hemiSky: '#e6cfa4', hemiGround: '#8a6e48', hemi: 1.6, lamps: 0.2, exposure: 1.0, stars: 0, windows: 0.1, haze: 0.85 },
  noon: { top: '#2b6cb3', horizon: '#cfe3f2', fog: '#bfd5e8', fogNear: 90, fogFar: 340, sun: '#fff1d6', sunPower: 3.1, sunDir: [0.3, 0.85, 0.25], hemiSky: '#bcd7f5', hemiGround: '#6f6553', hemi: 1.6, lamps: 0, exposure: 1.0, stars: 0, windows: 0.05 },
};

const NOISE_GLSL = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
`;

function surfaceMaterial(key) {
  const spec = MATERIALS[key];
  const material = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.rough ?? 0.8, metalness: spec.metal ?? 0.05 });
  if (spec.emissive) { material.emissive = new THREE.Color(spec.color); material.emissiveIntensity = spec.emissive; }
  const pattern = PATTERNS[spec.pattern] ?? -1;
  if (pattern < 0) return material;
  material.userData.uniforms = { uWindowGlow: { value: 0.5 }, uHaze: { value: 0 }, uHazeColor: { value: new THREE.Color() } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 wpos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwpos = instanceMatrix * wpos;\n#endif\nwpos = modelMatrix * wpos;\nvWPos = wpos.xyz;\nvWNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform float uWindowGlow;\nuniform float uHaze;\nuniform vec3 uHazeColor;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 an = abs(vWNrm);
        vec2 suv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
        float grain = vnoise(suv * 1.3) * 0.55 + vnoise(suv * 6.1) * 0.3 + vnoise(suv * 23.0) * 0.15;
        float shade = mix(0.78, 1.1, grain);
        float glow = 0.0;
        #if PATTERN == 1
          vec2 cell = suv / vec2(2.4, 1.2);
          vec2 edge = abs(fract(cell) - 0.5);
          shade *= 1.0 - 0.35 * smoothstep(0.485, 0.5, max(edge.x, edge.y));
          shade *= 0.94 + 0.12 * h21(floor(cell));
        #elif PATTERN == 2
          vec2 b = suv / vec2(0.52, 0.2);
          b.x += step(1.0, mod(b.y, 2.0)) * 0.5;
          vec2 be = abs(fract(b) - 0.5);
          float mortar = smoothstep(0.455, 0.5, max(be.x * 0.2 + 0.4, be.y));
          shade *= 0.82 + 0.36 * h21(floor(b));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.3, 0.28), mortar * 0.75);
        #elif PATTERN == 3
          float along = an.y > 0.5 ? suv.x : suv.y;
          float plank = along / 0.24;
          shade *= 0.8 + 0.35 * h21(vec2(floor(plank), 3.0));
          shade *= 1.0 - 0.45 * smoothstep(0.42, 0.5, abs(fract(plank) - 0.5));
          shade *= 0.92 + 0.16 * vnoise(vec2(suv.x * 1.5, suv.y * 22.0));
        #elif PATTERN == 4
          shade *= 0.86 + 0.16 * sin(suv.x * 21.0);
          shade *= 1.0 - 0.25 * vnoise(suv * 0.7) * step(0.55, vnoise(suv * 2.3));
        #elif PATTERN == 5
          vec2 te = abs(fract(suv / 1.5) - 0.5);
          shade *= 1.0 - 0.3 * smoothstep(0.48, 0.5, max(te.x, te.y));
          shade *= 0.93 + 0.14 * h21(floor(suv / 1.5));
        #elif PATTERN == 6
          shade *= 1.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.84), step(0.5, fract(suv.x / 0.9)) * 0.85);
        #elif PATTERN == 8
          // Sedimentary bands on cliff faces; tops stay plain.
          float warp = vnoise(suv * 0.12) * 2.4;
          float bands = vnoise(vec2(2.7, suv.y * 1.7 + warp)) * 0.6 + vnoise(vec2(9.1, suv.y * 5.3 + warp)) * 0.4;
          shade *= mix(1.0, 0.72 + 0.5 * bands, 1.0 - an.y);
          shade *= 1.0 - 0.22 * (1.0 - an.y) * smoothstep(0.44, 0.5, abs(fract(suv.y * 0.55 + warp * 0.3) - 0.5));
        #elif PATTERN == 7
          vec2 w = suv / vec2(2.2, 3.0);
          vec2 we = abs(fract(w) - 0.5);
          float pane = (1.0 - smoothstep(0.3, 0.34, we.x)) * (1.0 - smoothstep(0.26, 0.3, we.y)) * (1.0 - an.y);
          float lit = step(0.74, h21(floor(w) + 7.0));
          glow = pane * lit * uWindowGlow;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.03, 0.05), pane);
        #endif
        diffuseColor.rgb *= shade;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * glow * 1.6;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#if PATTERN == 7\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, uHaze * (1.0 - glow * 0.85));\n#endif');
  };
  material.defines = { PATTERN: pattern };
  material.customProgramCacheKey = () => `surface-${pattern}`;
  return material;
}

function textSprite(text, color, size) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = '400 96px "Michroma", sans-serif';
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 40;
  canvas.height = 128;
  context.font = font;
  context.textBaseline = 'middle';
  context.shadowColor = color; context.shadowBlur = 18;
  context.fillStyle = color;
  context.fillText(text, 20, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((canvas.width / canvas.height) * size, size), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, fog: true }));
  return mesh;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class Arena {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.materials = new Map();
    this.mapGroup = null;
    this.physics = new World([]);
    this.map = null;
    this.glass = new Map();
    this.shields = new Map();
    this.barrierMeshes = [];
    this.lamps = [];
    this.glows = [];
    this.variant = VARIANTS.dusk;
    this.variantName = 'dusk';
    this.time = 0;
    this.lightning = 0;
    this.nextLightning = 8;
    this.shelter = 0;
    this.onThunder = null;
    this.glowMap = glowTexture();

    this.scene.fog = new THREE.Fog('#c58a66', 45, 210);
    this.hemi = new THREE.HemisphereLight('#8fa3c9', '#3a2e2a', 0.9);
    this.sun = new THREE.DirectionalLight('#ffb070', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -75; shadowCamera.right = 75; shadowCamera.top = 75; shadowCamera.bottom = -75; shadowCamera.near = 1; shadowCamera.far = 260;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, stars: { value: 0 }, flash: { value: 0 } },
      vertexShader: 'varying vec3 dir; void main() { dir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars; uniform float flash; varying vec3 dir;
        float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() { vec3 d = normalize(dir); float h = max(d.y, 0.0);
          vec3 color = mix(horizon, top, pow(smoothstep(0.0, 0.65, h), 0.7));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          color += sunColor * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.28);
          vec3 cell = floor(d * 220.0); float star = step(0.9975, h31(cell)) * smoothstep(0.02, 0.25, h);
          color += vec3(star) * stars; color += vec3(0.75, 0.8, 1.0) * flash * (0.35 + 0.65 * (1.0 - h));
          gl_FragColor = vec4(color, 1.0); }`,
    }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Rain: streaks wrapped around the camera entirely on the GPU.
    const drops = 5000;
    const positions = new Float32Array(drops * 6);
    const seeds = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i += 1) {
      const x = Math.random() * 50, y = Math.random() * 30, z = Math.random() * 50;
      positions.set([x, y, z, x, y, z], i * 6);
      seeds.set([0, 1], i * 2);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rainGeometry.setAttribute('end', new THREE.BufferAttribute(seeds, 1));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, eye: { value: new THREE.Vector3() }, opacity: { value: 0.3 }, fall: { value: 26 }, streak: { value: 0.7 }, drift: { value: 3 }, sway: { value: 0 }, tint: { value: new THREE.Color(0.75, 0.82, 0.9) } },
      vertexShader: `attribute float end; uniform float time; uniform vec3 eye; uniform float fall; uniform float streak; uniform float drift; uniform float sway; varying float alpha;
        void main() { vec3 p = position; p.y = mod(p.y - time * fall, 30.0); p.x += time * drift + sin(time * 0.8 + position.z * 1.7) * sway; p.z += cos(time * 0.6 + position.x * 1.3) * sway;
          p.xz = mod(p.xz - eye.xz + 25.0, 50.0) - 25.0 + eye.xz; p.y += eye.y - 10.0;
          p.y += end * streak; p.x += end * streak * 0.12; alpha = 1.0 - end * 0.6;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: 'uniform float opacity; uniform vec3 tint; varying float alpha; void main() { gl_FragColor = vec4(tint, opacity * alpha); }',
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  material(key) {
    if (!this.materials.has(key)) this.materials.set(key, surfaceMaterial(key));
    return this.materials.get(key);
  }

  loadMap(id) {
    if (this.map?.id === id) { this.resetRound(); return; }
    if (this.mapGroup) { this.scene.remove(this.mapGroup); this.mapGroup.traverse((o) => o.geometry?.dispose()); }
    this.map = getMap(id);
    this.physics = new World(this.map.boxes);
    this.glass.clear(); this.shields.clear(); this.barrierMeshes = []; this.lamps = []; this.glows = [];
    const group = new THREE.Group();
    this.mapGroup = group;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const buckets = new Map();
    for (const box of this.map.boxes) {
      if (box.glass) continue;
      const key = `${box.mat}|${box.noShadow ? 0 : 1}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(box);
    }
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (const [key, boxes] of buckets) {
      const [mat, shadow] = key.split('|');
      const mesh = new THREE.InstancedMesh(unit, this.material(mat), boxes.length);
      boxes.forEach((box, index) => {
        position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
        scale.set(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      });
      mesh.castShadow = shadow === '1'; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    const glassMaterial = new THREE.MeshStandardMaterial({ color: '#9fd8e6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, emissive: '#3d6b78', emissiveIntensity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    for (const box of this.map.boxes.filter((entry) => entry.glass)) {
      const mesh = new THREE.Mesh(unit, glassMaterial);
      mesh.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
      mesh.scale.set(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
      mesh.renderOrder = 2;
      group.add(mesh);
      this.glass.set(box.id, { mesh, box });
    }
    for (const spec of this.map.lights) {
      const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 1.6);
      light.position.set(...spec.pos);
      light.userData.base = spec.intensity;
      group.add(light);
      this.lamps.push(light);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowMap, color: spec.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.position.set(...spec.pos);
      glow.scale.setScalar(3.2);
      group.add(glow);
      this.glows.push(glow);
    }
    const facing = { north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2 };
    for (const sign of this.map.signs) {
      const mesh = textSprite(sign.text, sign.color, sign.size);
      mesh.position.set(...sign.pos);
      mesh.rotation.y = facing[sign.face] ?? 0;
      group.add(mesh);
    }
    for (const barrier of this.map.barriers) {
      const teamB = barrier.id.includes('-B');
      const mesh = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: teamB ? '#ff7148' : '#6ce6d1', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      mesh.position.set((barrier.min[0] + barrier.max[0]) / 2, (barrier.min[1] + barrier.max[1]) / 2, (barrier.min[2] + barrier.max[2]) / 2);
      mesh.scale.set(barrier.max[0] - barrier.min[0], barrier.max[1] - barrier.min[1], 0.08);
      mesh.visible = false;
      group.add(mesh);
      this.barrierMeshes.push(mesh);
    }
    this.addBackdrop(group, this.map.env || {});
    this.scene.add(group);
    // Fresh lamps and backdrop materials need the current conditions applied to them.
    if (this.renderer && this.variantName) this.setVariant(this.variantName);
  }

  // Every arena sits in a wider world: an apron of ground beyond the walls and a ring of scenery.
  addBackdrop(group, env) {
    this.skylineMaterial = null;
    const { bounds } = this.map;
    const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    const groundColor = { skyline: '#2a2f35', town: '#6d675c', mountains: '#dfe7ee', mesas: '#bfa06a' }[env.backdrop];
    if (groundColor) {
      // Four slabs around the playable box, so sunken routes inside it stay visible from above.
      const apron = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1, metalness: 0 });
      const pad = 6, far = 700;
      [[-far, bounds.minX - pad, -far, far], [bounds.maxX + pad, far, -far, far], [bounds.minX - pad, bounds.maxX + pad, -far, bounds.minZ - pad], [bounds.minX - pad, bounds.maxX + pad, bounds.maxZ + pad, far]].forEach(([x1, x2, z1, z2]) => {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), apron);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((x1 + x2) / 2, -0.4, (z1 + z2) / 2);
        mesh.receiveShadow = false;
        group.add(mesh);
      });
    }
    let seed = 11 + this.map.id.length * 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ring = (count, geometry, material, place) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + random() * 0.12;
        const spec = place(random);
        rotation.setFromAxisAngle(up, spec.turn || 0);
        mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.sin(angle) * spec.radius, spec.y, Math.cos(angle) * spec.radius * 1.12), rotation, new THREE.Vector3(spec.w, spec.h, spec.d)));
      }
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    if (env.backdrop === 'skyline') this.addSkyline(group, reach + 70);
    if (env.backdrop === 'town') {
      const walls = surfaceMaterial('ochre');
      walls.defines = { PATTERN: PATTERNS.windows };
      walls.customProgramCacheKey = () => 'surface-windows';
      walls.color.set('#a9835a');
      walls.fog = false;
      this.skylineMaterial = walls;
      const specs = [];
      ring(64, new THREE.BoxGeometry(1, 1, 1), walls, (r) => { const spec = { radius: reach + 18 + r() * 70, w: 12 + r() * 16, d: 12 + r() * 16, h: 9 + r() * 14 }; spec.y = spec.h / 2 - 1; specs.push(spec); return spec; });
      let index = 0;
      const roofs = new THREE.MeshStandardMaterial({ color: '#9c4f30', roughness: 0.9 });
      seed = 11 + this.map.id.length * 7;
      ring(64, new THREE.BoxGeometry(1, 1, 1), roofs, (r) => { const base = specs[index]; index += 1; r(); r(); r(); r(); return { radius: base.radius, w: base.w + 1.2, d: base.d + 1.2, h: 0.8, y: base.h - 1 + 0.4 }; });
    }
    if (env.backdrop === 'mountains') {
      const rockMat = new THREE.MeshStandardMaterial({ color: '#c3cfda', roughness: 1, flatShading: true });
      ring(34, new THREE.ConeGeometry(0.7, 1, 5), rockMat, (r) => { const h = 50 + r() * 90; return { radius: reach + 110 + r() * 160, w: h * (1.2 + r()), d: h * (1.2 + r()), h, y: h / 2 - 3, turn: r() * 3 }; });
      const capMat = new THREE.MeshStandardMaterial({ color: '#8d99a6', roughness: 1, flatShading: true });
      ring(22, new THREE.ConeGeometry(0.7, 1, 4), capMat, (r) => { const h = 26 + r() * 40; return { radius: reach + 50 + r() * 50, w: h * (1.6 + r()), d: h * (1.6 + r()), h, y: h / 2 - 3, turn: r() * 3 }; });
    }
    if (env.backdrop === 'mesas') {
      ring(30, new THREE.BoxGeometry(1, 1, 1), surfaceMaterial('sandstone'), (r) => { const h = 16 + r() * 34; return { radius: reach + 45 + r() * 170, w: 30 + r() * 70, d: 30 + r() * 60, h, y: h / 2 - 2 }; });
      ring(18, new THREE.BoxGeometry(1, 1, 1), surfaceMaterial('sandstone'), (r) => { const h = 6 + r() * 10; return { radius: reach + 20 + r() * 40, w: 14 + r() * 26, d: 14 + r() * 26, h, y: h / 2 - 1.5 }; });
    }
  }

  // A ring of dark towers beyond the walls gives the city maps a place in the world.
  addSkyline(group, inner = 130) {
    const material = surfaceMaterial('wall');
    material.defines = { PATTERN: PATTERNS.windows };
    material.customProgramCacheKey = () => 'surface-windows';
    material.color.set('#141a21');
    material.fog = false;
    this.skylineMaterial = material;
    const count = 46;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, count);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    let seed = 11;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + random() * 0.1;
      const radius = inner + random() * 90;
      const width = 14 + random() * 20, depth = 14 + random() * 20, height = 18 + random() * 58;
      mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.sin(angle) * radius, height / 2 - 2, Math.cos(angle) * radius * 1.15), rotation, new THREE.Vector3(width, height, depth)));
    }
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  setVariant(name) {
    const v = VARIANTS[name] || VARIANTS.dusk;
    this.variant = v; this.variantName = name;
    this.scene.fog.color.set(v.fog); this.scene.fog.near = v.fogNear; this.scene.fog.far = v.fogFar;
    this.hemi.color.set(v.hemiSky); this.hemi.groundColor.set(v.hemiGround); this.hemi.intensity = v.hemi;
    this.sun.color.set(v.sun); this.sun.intensity = v.sunPower;
    const u = this.sky.material.uniforms;
    u.top.value.set(v.top); u.horizon.value.set(v.horizon); u.sunDir.value.set(...v.sunDir).normalize(); u.sunColor.value.set(v.sun).multiplyScalar(v.sunPower / 2.6); u.stars.value = v.stars;
    this.baseExposure = v.exposure;
    this.renderer.toneMappingExposure = v.exposure * (this.brightness || 1);
    this.lamps.forEach((lamp) => { lamp.intensity = lamp.userData.base * (0.35 + v.lamps); lamp.visible = this.lampsOn !== false; });
    this.glows.forEach((glow) => { glow.material.opacity = Math.min(1, 0.15 + v.lamps * 0.6); });
    if (this.skylineMaterial) {
      const uniforms = this.skylineMaterial.userData.uniforms;
      uniforms.uWindowGlow.value = v.windows;
      uniforms.uHaze.value = (v.haze ?? 0.6) * (this.map?.env?.backdrop === 'town' ? 0.45 : 1);
      uniforms.uHazeColor.value.set(v.fog).convertLinearToSRGB();
    }
    this.rain.visible = Boolean(v.precip);
    const weather = this.rain.material.uniforms;
    if (v.precip === 'snow') { weather.fall.value = 2.4; weather.streak.value = 0.09; weather.drift.value = 1.1; weather.sway.value = 0.5; weather.tint.value.setRGB(1, 1, 1); } else { weather.fall.value = 26; weather.streak.value = 0.7; weather.drift.value = 3; weather.sway.value = 0; weather.tint.value.setRGB(0.75, 0.82, 0.9); }
    for (const key of ['neonCyan', 'neonOrange', 'neonPink', 'lamp']) if (this.materials.has(key)) this.materials.get(key).emissiveIntensity = MATERIALS[key].emissive * (0.5 + v.lamps * 0.9);
  }

  // g: { renderScale, shadows: off|low|high|ultra, streetLights, brightness }. See graphics() in state.js.
  setGraphics(g) {
    const size = { low: 1024, high: 2048, ultra: 4096 }[g.shadows] || 0;
    this.sun.castShadow = size > 0;
    if (size && this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.lampsOn = g.streetLights !== false;
    this.lamps.forEach((lamp) => { lamp.visible = this.lampsOn; });
    // Render scale is a share of the screen's own resolution; above 1 supersamples.
    this.renderer.setPixelRatio(Math.max(0.4, Math.min(devicePixelRatio * g.renderScale, 3)));
    this.brightness = g.brightness || 1;
    this.renderer.toneMappingExposure = (this.baseExposure ?? 1) * this.brightness;
  }

  resetRound() {
    this.physics.resetDisabled();
    this.glass.forEach(({ mesh }) => { mesh.visible = true; });
    [...this.shields.keys()].forEach((id) => this.removeShield(id));
  }
  breakGlass(id) {
    const pane = this.glass.get(id);
    if (!pane || !pane.mesh.visible) return null;
    pane.mesh.visible = false;
    this.physics.setDisabled(id);
    return pane.box;
  }
  setBarriers(up) {
    this.barrierMeshes.forEach((mesh) => { mesh.visible = up; });
    this.map?.barriers.forEach((barrier) => { if (up) this.physics.addDynamic({ ...barrier }); else this.physics.removeDynamic(barrier.id); });
  }
  addShield(view, friendly) {
    if (this.shields.has(view.id)) return;
    const size = [view.max[0] - view.min[0], view.max[1] - view.min[1], view.max[2] - view.min[2]];
    const color = friendly ? '#6ce6d1' : '#ff7148';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false }));
    mesh.position.set((view.min[0] + view.max[0]) / 2, (view.min[1] + view.max[1]) / 2, (view.min[2] + view.max[2]) / 2);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color }));
    mesh.add(frame);
    mesh.scale.set(1, 0.01, 1);
    mesh.userData.grow = 0;
    this.scene.add(mesh);
    this.shields.set(view.id, mesh);
    this.physics.addDynamic({ id: view.id, min: view.min, max: view.max, mat: 'shield', shield: true });
  }
  flashShield(id) { const mesh = this.shields.get(id); if (mesh) mesh.userData.flash = 1; }
  removeShield(id) {
    const mesh = this.shields.get(id);
    if (!mesh) return null;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    this.shields.delete(id);
    this.physics.removeDynamic(id);
    return mesh.position;
  }

  update(dt, camera) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    const v = this.variant;
    // Keep the shadow frustum centred near the player for crisper shadows.
    this.sun.target.position.set(Math.round(camera.position.x / 8) * 8, 0, Math.round(camera.position.z / 8) * 8);
    this.sun.position.copy(this.sun.target.position).addScaledVector(new THREE.Vector3(...v.sunDir).normalize(), 130);
    this.barrierMeshes.forEach((mesh) => { if (mesh.visible) mesh.material.opacity = 0.18 + Math.sin(this.time * 3) * 0.06; });
    this.shields.forEach((mesh) => {
      if (mesh.userData.grow < 1) { mesh.userData.grow = Math.min(1, mesh.userData.grow + dt * 5); mesh.scale.y = mesh.userData.grow; }
      mesh.userData.flash = Math.max(0, (mesh.userData.flash || 0) - dt * 4);
      mesh.material.opacity = 0.28 + mesh.userData.flash * 0.5;
    });
    const covered = this.physics.covered(camera.position.x, camera.position.y, camera.position.z) ? 1 : 0;
    this.shelter += (covered - this.shelter) * Math.min(1, dt * 4);
    if (v.precip) {
      const u = this.rain.material.uniforms;
      u.time.value = this.time; u.eye.value.copy(camera.position); u.opacity.value = (v.precip === 'snow' ? 0.95 : 0.32) * (1 - this.shelter);
      if (v.precip === 'rain') this.nextLightning -= dt;
      if (this.nextLightning <= 0) { this.nextLightning = 9 + Math.random() * 16; this.lightning = 1; this.onThunder?.(0.6 + Math.random() * 1.8); }
    }
    if (this.lightning > 0) {
      this.lightning = Math.max(0, this.lightning - dt * 2.4);
      const flicker = this.lightning * (0.6 + 0.4 * Math.sin(this.time * 70));
      this.sky.material.uniforms.flash.value = flicker;
      this.hemi.intensity = v.hemi + flicker * 2.5;
    } else this.sky.material.uniforms.flash.value = 0;
  }
}
