// Small living things the boxes cannot give a map: tufts of grass standing up out of every lawn, and dust
// hanging in the air where the light catches it. Both are one draw call that follows the camera, placed
// entirely on the GPU, so they cost the same on a street corner as on the whole island.
import * as THREE from 'three';
import { MATERIALS } from '../shared/constants.js';
import { NOISE_GLSL, NOISE_TEX, SURFACE_TIME } from './surface.js';

const SPAN = 46;          // metres of grass kept around the eye
const TUFTS = 15000;
const MASK_STEP = 25.5;   // the mask stores a lawn's height in 8 bits: tenths of a metre

// One tuft: a handful of tapered blades leaning out from a point. `tall` runs 0 at the root to 1 at the tip.
function tuftGeometry() {
  const position = [], tall = [], index = [];
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blades = 7;
  for (let i = 0; i < blades; i += 1) {
    const turn = (i / blades) * Math.PI * 2 + random() * 0.9, out = 0.03 + random() * 0.13;
    const height = 0.13 + random() * 0.14, width = 0.016 + random() * 0.012, lean = 0.03 + random() * 0.09;
    const rx = Math.cos(turn) * out, rz = Math.sin(turn) * out;          // where the blade is rooted
    const sx = -Math.sin(turn + random()) * width, sz = Math.cos(turn + random()) * width;   // across the blade
    const lx = Math.cos(turn) * lean, lz = Math.sin(turn) * lean;        // the way it leans
    const base = position.length / 3;
    position.push(rx - sx, 0, rz - sz, rx + sx, 0, rz + sz);
    position.push(rx - sx * 0.7 + lx * 0.35, height * 0.55, rz - sz * 0.7 + lz * 0.35, rx + sx * 0.7 + lx * 0.35, height * 0.55, rz + sz * 0.7 + lz * 0.35);
    position.push(rx + lx, height, rz + lz);
    tall.push(0, 0, 0.55, 0.55, 1);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(position.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('tall', new THREE.Float32BufferAttribute(tall, 1));
  geometry.setIndex(index);
  const spot = new Float32Array(TUFTS * 4);
  for (let i = 0; i < TUFTS; i += 1) spot.set([random() * SPAN, random() * SPAN, random(), 0.7 + random() * 0.75], i * 4);
  geometry.setAttribute('spot', new THREE.InstancedBufferAttribute(spot, 4));
  geometry.instanceCount = TUFTS;
  return geometry;
}

export class Grass {
  constructor() {
    this.uniforms = { uNoiseTex: NOISE_TEX, uEye: { value: new THREE.Vector3() }, uTime: SURFACE_TIME, uMask: { value: null }, uArea: { value: new THREE.Vector4(0, 0, 1, 1) } };
    const material = new THREE.MeshLambertMaterial({ color: MATERIALS.grass.color, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 spot; attribute float tall; uniform vec3 uEye; uniform float uTime; uniform sampler2D uMask; uniform vec4 uArea;
          varying float vTall; varying vec3 vTone;
          ${NOISE_GLSL}`)
        // Lit as the ground it stands on, so a lawn is one surface and not a field of dark and light cards.
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          // The same few thousand tufts, wrapped round the eye: walk and the ones behind come back in front.
          vec2 at = mod(spot.xy - uEye.xz + ${(SPAN / 2).toFixed(1)}, ${SPAN.toFixed(1)}) - ${(SPAN / 2).toFixed(1)} + uEye.xz;
          vec4 lawn = texture2D(uMask, (at - uArea.xy) * uArea.zw);
          // The lawn's own patches (surface.js, grass): thin where it is worn to earth, yellower where it is dry.
          float worn = smoothstep(0.3, 0.16, fbm(at * 0.33 + 12.0));
          float dry = smoothstep(0.42, 0.78, vnoise(at * 0.2) * 0.55 + vnoise(at * 0.406 + 7.1) * 0.3 + 0.075);
          float grow = step(0.5, lawn.r) * (1.0 - smoothstep(${(SPAN * 0.3).toFixed(1)}, ${(SPAN * 0.47).toFixed(1)}, distance(at, uEye.xz))) * spot.w * (1.0 - worn * 0.85);
          float cs = cos(spot.z * 6.2832), sn = sin(spot.z * 6.2832);
          vec3 transformed = vec3(position.x * cs - position.z * sn, position.y, position.x * sn + position.z * cs) * grow;
          float gust = sin(uTime * 0.7 + at.x * 0.11 + at.y * 0.07) * 0.5 + 0.5;
          transformed.xz += tall * tall * grow * (0.035 + 0.05 * gust) * vec2(sin(uTime * 1.7 + at.x * 0.8 + at.y * 0.35), cos(uTime * 1.3 + at.y * 0.7 + spot.z * 9.0));
          transformed += vec3(at.x, lawn.g * ${MASK_STEP.toFixed(1)}, at.y);
          vTall = tall;
          vTone = mix(vec3(0.82, 1.06, 0.78), vec3(1.3, 1.18, 0.7), dry) * (0.85 + 0.3 * fract(spot.z * 7.31));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTall; varying vec3 vTone;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTone * mix(0.5, 1.28, vTall);')
        // Both sides of a blade face the sky.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.mesh = new THREE.Mesh(tuftGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.enabled = true;
  }

  // Where grass can stand on this map, seen from above: a picture with one pixel per patch of ground, holding
  // whether there is a lawn there and how high it is. Anything standing on the lawn rubs its footprint out.
  setMap(map) {
    this.uniforms.uMask.value?.dispose();
    this.uniforms.uMask.value = null;
    const lawns = map.boxes.filter((box) => box.mat === 'grass' && !box.glass);
    this.has = lawns.length > 0;
    this.mesh.visible = this.has && this.enabled;
    if (!this.has) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const box of lawns) { minX = Math.min(minX, box.min[0]); minZ = Math.min(minZ, box.min[2]); maxX = Math.max(maxX, box.max[0]); maxZ = Math.max(maxZ, box.max[2]); }
    const width = maxX - minX, depth = maxZ - minZ;
    const size = Math.max(width, depth) > 260 ? 2048 : 1024;
    // One pixel of nothing all round, so past the edge of the picture there is no grass.
    const stepX = width / (size - 2), stepZ = depth / (size - 2);
    const data = new Uint8Array(size * size * 4);
    const span = (lo, hi, min, step) => [Math.max(1, Math.ceil((lo - min) / step + 0.5)), Math.min(size - 2, Math.floor((hi - min) / step + 0.5))];
    for (const box of [...lawns].sort((a, b) => a.max[1] - b.max[1])) {
      if (box.max[1] < 0 || box.max[1] > MASK_STEP) continue;
      const [x1, x2] = span(box.min[0], box.max[0], minX, stepX), [z1, z2] = span(box.min[2], box.max[2], minZ, stepZ);
      const height = Math.round(box.max[1] * 10);
      for (let z = z1; z <= z2; z += 1) for (let x = x1; x <= x2; x += 1) { const i = (z * size + x) * 4; data[i] = 255; data[i + 1] = height; }
    }
    const margin = 0.12;
    for (const box of map.boxes) {
      // Anything that is not lawn and stands on it, or lies flush over it (a beach, a road), takes the grass off.
      if (box.mat === 'grass' && !box.glass) continue;
      if (box.max[0] < minX || box.min[0] > maxX || box.max[2] < minZ || box.min[2] > maxZ) continue;
      const [x1, x2] = span(box.min[0] - margin - stepX, box.max[0] + margin + stepX, minX, stepX), [z1, z2] = span(box.min[2] - margin - stepZ, box.max[2] + margin + stepZ, minZ, stepZ);
      for (let z = z1; z <= z2; z += 1) for (let x = x1; x <= x2; x += 1) {
        const i = (z * size + x) * 4;
        if (!data[i]) continue;
        const top = data[i + 1] / 10;
        if (box.min[1] < top + 0.32 && box.max[1] > top - 0.005) data[i] = 0;
      }
    }
    const mask = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    mask.magFilter = mask.minFilter = THREE.NearestFilter;
    mask.needsUpdate = true;
    this.uniforms.uMask.value = mask;
    this.uniforms.uArea.value.set(minX - stepX, minZ - stepZ, 1 / (stepX * size), 1 / (stepZ * size));
  }

  setEnabled(on) { this.enabled = on; this.mesh.visible = Boolean(this.has) && on; }
  update(camera) { this.uniforms.uEye.value.copy(camera.position); }
}

// Dust in the air: specks drifting round the eye, brightest where you look toward the sun.
export class Motes {
  constructor() {
    const count = 900, box = 22;
    const position = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i += 1) { position.set([Math.random() * box, Math.random() * 12, Math.random() * box], i * 3); seed[i] = Math.random(); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: SURFACE_TIME, uEye: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uTint: { value: new THREE.Color(1, 1, 1) }, uAmount: { value: 0.5 }, uScale: { value: 600 } };
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, uniforms: this.uniforms,
      vertexShader: `attribute float seed; uniform float uTime; uniform vec3 uEye; uniform vec3 uSun; uniform float uScale; varying float vAlpha;
        void main() { vec3 p = position;
          p += vec3(sin(uTime * 0.21 + seed * 40.0), sin(uTime * 0.17 + seed * 71.0) * 0.6, cos(uTime * 0.19 + seed * 23.0)) * 0.7 + vec3(uTime * 0.12, -uTime * 0.03, uTime * 0.05);
          p = mod(p - uEye + vec3(${(box / 2).toFixed(1)}, 6.0, ${(box / 2).toFixed(1)}), vec3(${box.toFixed(1)}, 12.0, ${box.toFixed(1)})) - vec3(${(box / 2).toFixed(1)}, 6.0, ${(box / 2).toFixed(1)}) + uEye;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float far = -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.012 + seed * 0.02) * uScale / max(far, 0.2), 1.0, 7.0);
          // Gone right at the lens and again in the distance; a slow shimmer as each one turns in the light.
          float toSun = max(dot(normalize(p - uEye), uSun), 0.0);
          vAlpha = smoothstep(0.5, 2.2, far) * (1.0 - smoothstep(6.0, 11.0, far)) * (0.35 + 0.65 * sin(uTime * (0.6 + seed) + seed * 90.0) * 0.5 + 0.5) * (0.4 + 1.6 * toSun * toSun); }`,
      fragmentShader: 'uniform vec3 uTint; uniform float uAmount; varying float vAlpha; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uTint * uAmount * vAlpha * smoothstep(0.5, 0.1, d), 1.0); }',
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  update(camera, renderer) {
    this.uniforms.uEye.value.copy(camera.position);
    this.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
