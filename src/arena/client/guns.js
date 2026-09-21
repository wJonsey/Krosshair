// Every weapon model, first person and in a pilot's hands. Built from real side profiles (receivers, stocks,
// grips, magazines), stepped barrels, rails, optics and hands with fingers, to the standard of the Kestrel
// Blade. Parts that never move are merged into one mesh per material, so a whole rifle is a handful of draw
// calls; parts that do move (magazine, bolt, slide, pump, cylinder, break-open barrels) are their own groups.
// Conventions: muzzle toward -z, the firing hand's grip at the origin, y up. A finish covers the body,
// furniture and dark parts and leaves bare metal, rubber and the glow strip alone.
import * as THREE from 'three';
import { WEAPONS } from '../shared/constants.js';
import { ATTACHMENTS } from '../shared/attachments.js';
import { skinMaterial } from './skins.js';

const M = (color, rough = 0.4, metal = 0.5, emissive = null) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive || '#000000', emissiveIntensity: emissive ? 1.3 : 0 });
const LENS = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
const GLASS = new THREE.MeshStandardMaterial({ color: '#0b1a26', roughness: 0.08, metalness: 0.9, emissive: '#1d4a66', emissiveIntensity: 0.5 });
const ALONG = [Math.PI / 2, 0, 0];
// Eye relief when aimed through an open optic: the back of the housing ends up a hand's width from the camera.
const OPTIC_ADS_Z = -0.055;
export const EYE_RELIEF = 0.092;

// ------------------------------------------------------------------ geometry kit
function merge(list) {
  let count = 0;
  for (const geometry of list) count += geometry.attributes.position.count;
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let at = 0;
  for (const geometry of list) {
    position.set(geometry.attributes.position.array, at * 3);
    normal.set(geometry.attributes.normal.array, at * 3);
    if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array, at * 2);
    at += geometry.attributes.position.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), place = new THREE.Vector3(), size = new THREE.Vector3();
// A side profile, points as [forward, up], extruded across the gun and lightly bevelled.
function profileGeometry(points, width, bevel = 0.003) {
  const shape = new THREE.Shape();
  points.forEach(([forward, up], index) => (index ? shape.lineTo(forward, up) : shape.moveTo(forward, up)));
  shape.closePath();
  const depth = Math.max(0.001, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 6 });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
// Collects parts by material and bakes each pile into one mesh on `root`.
function kit(root) {
  const piles = new Map();
  const put = (material, geometry, position = [0, 0, 0], rotation = null, scale = null) => {
    euler.set(...(rotation || [0, 0, 0]));
    matrix.compose(place.set(...position), quaternion.setFromEuler(euler), scale ? size.set(...scale) : size.set(1, 1, 1));
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.applyMatrix4(matrix);
    if (!piles.has(material)) piles.set(material, []);
    piles.get(material).push(flat);
  };
  const self = {
    box: (material, w, h, d, position, rotation) => put(material, new THREE.BoxGeometry(w, h, d), position, rotation),
    tube: (material, r, length, position, sides = 12, rotation = ALONG, r2 = r) => put(material, new THREE.CylinderGeometry(r2, r, length, sides), position, rotation),
    ring: (material, r, thick, position, rotation = null) => put(material, new THREE.TorusGeometry(r, thick, 6, 18), position, rotation),
    ball: (material, r, position, scale) => put(material, new THREE.SphereGeometry(r, 10, 8), position, null, scale),
    disc: (material, r, position, rotation = null) => put(material, new THREE.CircleGeometry(r, 20), position, rotation),
    profile: (material, points, width, position = [0, 0, 0], rotation = null, bevel) => put(material, profileGeometry(points, width, bevel), position, rotation),
    put,
    // A moving part: its own group, baked the same way.
    part: (position = [0, 0, 0]) => { const group = new THREE.Group(); group.position.set(...position); root.add(group); const inner = kit(group); inner.group = group; self.children.push(inner); return inner; },
    children: [],
    bake: () => {
      for (const [material, list] of piles) { const mesh = new THREE.Mesh(merge(list), material); root.add(mesh); }
      piles.clear();
      self.children.forEach((child) => child.bake());
    },
  };
  return self;
}

// ------------------------------------------------------------------ shared pieces
// Picatinny rail: a base with evenly cut teeth.
function rail(k, m, y, zFront, zBack, width = 0.021) {
  k.box(m.dark, width, 0.006, zBack - zFront, [0, y + 0.003, (zFront + zBack) / 2]);
  for (let z = zFront + 0.006; z < zBack - 0.004; z += 0.0125) k.box(m.dark, width + 0.003, 0.005, 0.0065, [0, y + 0.0085, z]);
  return y + 0.011;
}
function pins(k, m, width, list) { for (const [z, y, r = 0.0045] of list) k.tube(m.grey, r, width + 0.004, [0, y, z], 8, [0, 0, Math.PI / 2]); }
// Trigger and its guard, hanging under the receiver just ahead of the grip.
function trigger(k, m, y, z = -0.045, long = 0.07) {
  k.box(m.black, 0.012, 0.004, long, [0, y - 0.042, z]);
  k.box(m.black, 0.012, 0.042, 0.004, [0, y - 0.021, z - long / 2], [0.25, 0, 0]);
  k.box(m.black, 0.012, 0.016, 0.004, [0, y - 0.036, z + long / 2 - 0.004], [-0.5, 0, 0]);
  k.profile(m.grey, [[0, 0], [0.006, 0], [0.011, -0.014], [0.009, -0.028], [0.004, -0.028], [0.005, -0.014]], 0.007, [0, y, z + 0.012], null, 0.001);
}
// A pistol-style grip raked back under the receiver, with a backstrap swell and a flat base.
function pistolGrip(k, material, m, top = -0.04, length = 0.105, width = 0.036) {
  const b = -length;
  k.profile(material, [[0.024, 0], [0.02, b * 0.35], [0.008, b * 0.7], [-0.004, b], [-0.05, b + 0.004], [-0.046, b * 0.55], [-0.036, b * 0.2], [-0.03, 0]], width, [0, top, 0.002], null, 0.005);
  for (let i = 0; i < 4; i += 1) k.box(m.black, width + 0.002, 0.004, 0.03, [0, top - 0.03 - i * 0.016, 0.014 + i * 0.006], [-0.3, 0, 0]);
}
// Magazines. Returned as a moving part so a reload can drop it and bring a fresh one up.
function magazine(k, m, kind, h, top, z, width = 0.03, tape = false) {
  const part = k.part([0, top, z]);
  // A fast mag is a short mag with a pull tab taped round it.
  if (tape) { part.box(m.black, width + 0.005, 0.026, 0.062, [0, -h * 0.55, 0]); part.box(m.glow, width * 0.5, 0.01, 0.026, [0, -h * 0.55, 0.042], [-0.4, 0, 0]); }
  if (kind === 'curved') {
    part.profile(m.dark, [[0.034, 0], [0.04, -h * 0.5], [0.058, -h], [0.004, -h - 0.008], [-0.014, -h * 0.5], [-0.03, 0]], width, [0, 0, 0], null, 0.003);
    for (const t of [0.3, 0.55, 0.8]) part.box(m.black, width + 0.002, 0.003, 0.05, [0, -h * t, -0.006 - t * 0.016], [0.3, 0, 0]);
    part.box(m.grey, width + 0.004, 0.008, 0.058, [0, -h - 0.004, -0.03], [0.32, 0, 0]);
  } else if (kind === 'stick') {
    part.profile(m.dark, [[0.02, 0], [0.026, -h], [-0.012, -h], [-0.018, 0]], width, [0, 0, 0], null, 0.002);
    part.box(m.grey, width + 0.004, 0.007, 0.046, [0, -h - 0.002, -0.006]);
  } else if (kind === 'drum') {
    part.tube(m.dark, 0.072, 0.058, [0, -0.078, -0.004], 20, [0, 0, Math.PI / 2]);
    part.tube(m.grey, 0.03, 0.062, [0, -0.078, -0.004], 12, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; part.box(m.black, 0.06, 0.006, 0.03, [0, -0.078 + Math.sin(a) * 0.05, -0.004 + Math.cos(a) * 0.05], [a, 0, 0]); }
    part.box(m.dark, width, 0.03, 0.05, [0, -0.012, -0.004]);
  } else if (kind === 'belt') {
    part.profile(m.dark, [[0.075, 0], [0.08, -0.1], [-0.06, -0.1], [-0.065, 0]], 0.1, [0.02, 0, 0], null, 0.005);
    part.box(m.black, 0.104, 0.01, 0.13, [0.02, -0.03, -0.006]);
    for (let i = 0; i < 5; i += 1) part.tube(m.brass, 0.0055, 0.04, [0.052, 0.034, -0.05 + i * 0.013], 8, [0, 0, 0.4]);
    part.box(m.grey, 0.014, 0.012, 0.1, [0.05, 0.02, 0]);
  } else {
    part.profile(m.dark, [[0.03, 0], [0.034, -h], [-0.026, -h], [-0.03, 0]], width, [0, 0, 0], null, 0.003);
    part.box(m.grey, width + 0.004, 0.006, 0.066, [0, -h - 0.002, -0.004]);
  }
  part.group.userData.rest = part.group.position.clone();
  return part;
}
// Whatever is screwed on the end of the barrel. Returns the new muzzle z, which the flash follows.
function muzzleDevice(k, m, y, from, bore, device) {
  let end = from;
  if (device === 'brake') {
    k.box(m.black, 0.044, 0.036, 0.095, [0, y, end - 0.03]);
    for (const z of [-0.008, -0.034, -0.06]) k.box(m.grey, 0.048, 0.016, 0.012, [0, y, end + z]);
    end -= 0.078;
  } else if (device === 'hider') {
    k.tube(m.black, bore * 1.5, 0.06, [0, y, end - 0.02], 12);
    for (let i = 0; i < 4; i += 1) { const a = (i / 4) * Math.PI * 2 + 0.78; k.box(m.grey, 0.004, 0.004, 0.034, [Math.cos(a) * bore * 1.5, y + Math.sin(a) * bore * 1.5, end - 0.03]); }
    end -= 0.05;
  } else if (device === 'suppressor') {
    k.tube(m.black, 0.026, 0.22, [0, y, end - 0.1], 16);
    for (const z of [0, -0.07, -0.14, -0.2]) k.ring(m.grey, 0.0262, 0.0022, [0, y, end + z]);
    end -= 0.21;
  } else if (device === 'comp') {
    // Compensator: a slotted block, cuts open across the top.
    k.box(m.dark, 0.038, 0.032, 0.074, [0, y, end - 0.035]);
    for (const z of [-0.014, -0.034, -0.054]) { k.box(m.black, 0.042, 0.012, 0.009, [0, y + 0.013, end + z]); k.box(m.black, 0.042, 0.009, 0.009, [0, y - 0.014, end + z]); }
    k.tube(m.black, bore * 0.92, 0.006, [0, y, end - 0.069], 12);
    end -= 0.07;
  } else if (device === 'ported') {
    // Muzzle brake: a short cap with ports blown out either side.
    k.tube(m.grey, bore * 1.75, 0.05, [0, y, end - 0.024], 14);
    for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2 + 0.5; k.box(m.black, 0.007, 0.007, 0.026, [Math.cos(a) * bore * 1.7, y + Math.sin(a) * bore * 1.7, end - 0.024]); }
    k.ring(m.black, bore * 1.72, 0.003, [0, y, end - 0.047]);
    end -= 0.048;
  } else if (device === 'crown') { k.tube(m.black, bore * 1.25, 0.03, [0, y, end + 0.004], 12); }
  return end;
}
// Barrel with a collar at the receiver, optional flutes, and a muzzle device. Returns the muzzle's z.
function barrel(k, m, y, zStart, length, bore, device, fluted = false) {
  k.tube(m.grey, bore * 1.35, 0.05, [0, y, zStart - 0.025], 14);
  k.tube(m.grey, bore, length, [0, y, zStart - length / 2], 14);
  // Flutes on a heavy barrel: the cuts that let it shed the weight it just put on.
  if (fluted) for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; k.box(m.black, 0.005, 0.005, length * 0.74, [Math.cos(a) * bore, y + Math.sin(a) * bore, zStart - length * 0.52]); }
  return muzzleDevice(k, m, y, zStart - length, bore, device);
}
// Magnified scope: tube, bells, turrets, mounts and glass at both ends.
function scope(k, m, y, z, length, r) {
  k.tube(m.black, r * 0.72, length, [0, y, z], 16);
  k.tube(m.black, r, length * 0.3, [0, y, z - length * 0.4], 16, ALONG, r * 0.74);
  k.tube(m.black, r * 1.34, length * 0.2, [0, y, z + length * 0.42], 24, ALONG, r * 0.78);
  k.put(m.black, new THREE.RingGeometry(r * 0.985, r * 1.34, 32), [0, y, z + length * 0.52 + 0.0012]);
  k.ring(m.grey, r * 1.3, 0.003, [0, y, z + length * 0.47]);
  k.tube(m.black, r * 1.04, 0.012, [0, y, z - length * 0.55 + 0.004], 16);
  k.tube(m.grey, r * 0.5, 0.03, [0, y + r * 0.95, z], 12, null);
  k.tube(m.grey, r * 0.5, 0.03, [r * 0.95, y, z], 12, [0, 0, Math.PI / 2]);
  k.disc(GLASS, r * 0.9, [0, y, z - length * 0.553], [0, Math.PI, 0]);
  for (const dz of [-length * 0.2, length * 0.22]) { k.ring(m.grey, r * 0.78, 0.005, [0, y, z + dz]); k.box(m.grey, 0.022, r * 0.9, 0.022, [0, y - r * 0.9, z + dz]); }
  return { y, z: z + length * 0.52 + 0.0015, r: r * 0.99 };
}
// Open optics you actually look through. Both return the height of the window centre.
function redDot(k, m, railY, z) {
  const r = 0.03, centre = railY + 0.016 + r;
  const shell = new THREE.MeshStandardMaterial({ color: '#1b222a', roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide });
  k.box(m.black, 0.044, 0.016, 0.085, [0, railY + 0.008, z]);
  k.put(shell, new THREE.CylinderGeometry(r, r, 0.075, 20, 1, true), [0, centre, z], ALONG);
  k.ring(m.black, r, 0.0045, [0, centre, z - 0.0375]);
  k.ring(m.black, r, 0.0045, [0, centre, z + 0.0375]);
  k.tube(m.grey, 0.008, 0.014, [0, centre + r + 0.006, z], 10, null);
  k.tube(m.grey, 0.007, 0.012, [r + 0.006, centre, z + 0.01], 10, [0, 0, Math.PI / 2]);
  k.disc(LENS, r - 0.002, [0, centre, z - 0.03]);
  k.lastWindow = { kind: 'dot', y: centre, r: r - 0.003 };
  return centre;
}
function holoSight(k, m, railY, z) {
  const w = 0.058, h = 0.046, centre = railY + 0.018 + h / 2;
  k.box(m.black, w + 0.012, 0.018, 0.11, [0, railY + 0.009, z]);
  k.box(m.black, 0.006, h, 0.05, [w / 2 + 0.003, centre, z - 0.025]);
  k.box(m.black, 0.006, h, 0.05, [-w / 2 - 0.003, centre, z - 0.025]);
  k.box(m.black, w + 0.012, 0.007, 0.06, [0, centre + h / 2 + 0.0035, z - 0.025]);
  k.box(m.black, w + 0.018, 0.01, 0.014, [0, centre + h / 2 + 0.006, z - 0.05], [0.5, 0, 0]);
  k.box(m.grey, 0.02, 0.014, 0.03, [w / 2 + 0.012, railY + 0.016, z + 0.03]);
  k.box(m.grey, 0.008, 0.008, 0.012, [-w / 2 - 0.008, railY + 0.02, z + 0.04]);
  k.put(LENS, new THREE.PlaneGeometry(w, h), [0, centre, z - 0.04]);
  k.lastWindow = { kind: 'holo', y: centre, w: w / 2 - 0.002, h: h / 2 - 0.002 };
  return centre;
}
function ironSights(k, m, y, zFront, zRear) {
  k.box(m.black, 0.02, 0.008, 0.02, [0, y + 0.004, zFront]);
  k.box(m.grey, 0.004, 0.022, 0.006, [0, y + 0.017, zFront]);
  for (const x of [-0.011, 0.011]) { k.box(m.black, 0.004, 0.026, 0.014, [x * 1.5, y + 0.015, zFront]); k.box(m.grey, 0.008, 0.022, 0.012, [x, y + 0.017, zRear]); }
  k.box(m.black, 0.034, 0.008, 0.02, [0, y + 0.004, zRear]);
  return y + 0.028;
}
function bipod(k, m, y, z, folded = false) {
  k.box(m.black, 0.04, 0.016, 0.03, [0, y, z]);
  if (folded) {
    // Stowed: the legs lie back along the barrel, which is where they spend most of a match.
    for (const side of [-1, 1]) { k.tube(m.grey, 0.007, 0.19, [side * 0.024, y - 0.014, z + 0.09], 8, [Math.PI / 2 - 0.1, 0, 0]); k.box(m.black, 0.018, 0.01, 0.028, [side * 0.024, y - 0.032, z + 0.184]); }
    k.box(m.black, 0.05, 0.014, 0.018, [0, y - 0.01, z + 0.03]);
    return;
  }
  for (const side of [-1, 1]) { k.tube(m.grey, 0.007, 0.24, [side * 0.052, y - 0.1, z - 0.046], 8, [0.42, 0, side * 0.34]); k.box(m.black, 0.02, 0.01, 0.03, [side * 0.09, y - 0.208, z - 0.094]); }
}
// Foregrip under the hand guard. `angled` rakes it forward, which is why it comes up quicker.
function foreGrip(k, m, y, z, angled) {
  const tilt = angled ? 0.9 : 0, drop = Math.cos(tilt), lean = Math.sin(tilt);
  const at = (d) => [0, y - 0.01 - drop * d, z - lean * d];
  k.box(m.black, 0.03, 0.014, 0.038, [0, y - 0.004, z]);
  k.put(m.dark, new THREE.CapsuleGeometry(0.014, angled ? 0.05 : 0.062, 4, 10), at(0.042), [tilt, 0, 0]);
  k.box(m.black, 0.03, 0.012, 0.03, at(angled ? 0.072 : 0.08), [tilt, 0, 0]);
  for (let i = 0; i < 3; i += 1) k.put(m.black, new THREE.TorusGeometry(0.0152, 0.0022, 6, 14), at(0.024 + i * 0.018), [Math.PI / 2 + tilt, 0, 0]);
}

// ------------------------------------------------------------------ hands
// A gloved hand with fingers, on a sleeve with a cuff. `pose`: grip (round a pistol grip), cup (under a
// fore-end) or fist (round a knife handle). The group's origin is the middle of the palm.
function hand(sleeve, glove, pose, side) {
  const group = new THREE.Group();
  const k = kit(group);
  const knuckle = M('#2a323b', 0.6, 0.2);
  if (pose === 'cup') {
    k.box(glove, 0.082, 0.026, 0.1, [0, -0.012, 0]);
    for (let i = 0; i < 4; i += 1) { k.box(glove, 0.019, 0.05, 0.02, [-side * 0.046, 0.012, -0.036 + i * 0.024], [0, 0, side * 0.2]); k.box(glove, 0.018, 0.016, 0.02, [-side * 0.036, 0.04, -0.036 + i * 0.024], [0, 0, side * 0.9]); }
    k.box(glove, 0.02, 0.05, 0.026, [side * 0.046, 0.012, 0.03], [0.3, 0, -side * 0.25]);
    k.box(knuckle, 0.06, 0.008, 0.05, [0, -0.028, -0.01]);
    k.put(sleeve, new THREE.CapsuleGeometry(0.043, 0.36, 4, 10), [0, -0.012, 0.29], ALONG);
    k.tube(glove, 0.047, 0.05, [0, -0.012, 0.085], 12);
  } else {
    const fist = pose === 'fist';
    k.box(glove, 0.03, 0.088, 0.07, [side * 0.03, fist ? 0 : -0.012, 0.012]);
    k.box(glove, 0.064, 0.086, 0.026, [0, fist ? 0 : -0.012, 0.05]);
    for (let i = 0; i < 4; i += 1) { const y = (fist ? 0.032 : 0.018) - i * 0.021; k.box(glove, 0.066, 0.019, 0.026, [-side * 0.002, y, -0.034]); k.box(glove, 0.024, 0.019, 0.05, [-side * 0.034, y, -0.006]); }
    k.box(glove, 0.022, 0.024, 0.06, [-side * 0.03, fist ? 0.052 : 0.04, 0.0], [0.15, side * 0.2, 0]);
    k.box(knuckle, 0.012, 0.07, 0.05, [side * 0.048, fist ? 0 : -0.012, 0.0]);
    k.put(sleeve, new THREE.CapsuleGeometry(0.044, 0.36, 4, 10), [side * 0.012, -0.012, 0.31], ALONG);
    k.tube(glove, 0.048, 0.05, [side * 0.012, -0.012, 0.105], 12);
  }
  k.bake();
  group.userData.arm = true;
  return group;
}

// ------------------------------------------------------------------ long guns
// One builder, many rifles. o: { len, h, w, fore: [length, style], barrel, bore, device, stock, grip, mag: [kind, h],
// optic, bolt, pump, bipod, charge, carry, hip, ads, reach }
function longGun(root, o, m) {
  const k = kit(root);
  const h = o.h || 0.09, w = o.w || 0.056, top = h / 2, bottom = -h / 2;
  const back = 0.085, front = back - o.len;
  // Receiver: chamfered top, a magazine well, a stepped tail. forward = -z.
  const F = o.len - back;
  k.profile(m.steel, [[-back, top - 0.014], [-back + 0.014, top], [F - 0.012, top], [F, top - 0.012], [F, bottom + 0.016], [F - 0.03, bottom], [0.035, bottom], [0.0, bottom + 0.012], [-0.05, bottom + 0.018], [-back, bottom + 0.03]], w, [0, 0, 0], null, 0.004);
  k.box(m.black, 0.004, h * 0.34, o.len * 0.2, [w / 2 + 0.0005, top * 0.35, front + o.len * 0.52]);           // ejection port
  k.box(m.grey, 0.003, h * 0.22, o.len * 0.16, [w / 2 + 0.002, top * 0.35, front + o.len * 0.53]);            // bolt carrier seen through it
  pins(k, m, w, [[back - 0.05, bottom + 0.03], [front + 0.06, bottom + 0.02], [front + o.len * 0.5, bottom + 0.022, 0.0035]]);
  k.box(m.grey, w + 0.008, 0.012, 0.022, [0, bottom + 0.04, back - 0.075]);                                    // safety lever
  // Fore-end.
  let foreEnd = front;
  if (o.fore) {
    const [length, style] = o.fore;
    foreEnd = front - length;
    if (style === 'none') { /* a bare magazine tube and barrel: the pump rides on them */ } else if (style === 'wood') {
      k.profile(m.wood, [[0, top - 0.03], [length, top - 0.034], [length, bottom + 0.02], [length - 0.03, bottom + 0.004], [0, bottom - 0.004]], w + 0.01, [0, 0, front + 0.0], null, 0.006);
      for (let i = 0; i < 3; i += 1) k.box(m.black, w + 0.014, 0.006, 0.03, [0, -0.012, front - length * (0.3 + i * 0.22)]);
    } else if (style === 'round') {
      k.put(m.dark, new THREE.CylinderGeometry(0.036, 0.036, length, 10), [0, 0.004, front - length / 2], ALONG, [1, 1, 0.9]);
      for (let i = 0; i < 5; i += 1) for (const side of [-1, 1]) k.box(m.black, 0.005, 0.014, 0.022, [side * 0.035, 0.006, front - length * (0.16 + i * 0.17)]);
    } else {
      k.profile(m.dark, [[0, top - 0.004], [length, top - 0.004], [length, bottom + 0.022], [length - 0.02, bottom + 0.012], [0, bottom + 0.012]], w + 0.008, [0, 0, front], null, 0.005);
      for (let i = 0; i < Math.floor(length / 0.045); i += 1) for (const side of [-1, 1]) k.box(m.black, 0.004, 0.012, 0.028, [side * (w / 2 + 0.0045), -0.002, front - 0.03 - i * 0.045]);
      rail(k, m, top - 0.006, foreEnd + 0.01, front - 0.004);
      rail(k, m, bottom + 0.0, foreEnd + 0.02, foreEnd + length * 0.55, 0.019);
    }
  }
  // Barrel and gas block.
  const barrelY = o.barrelY ?? 0.008;
  const bare = o.fore && o.fore[1] === 'none';
  const muzzle = barrel(k, m, barrelY, bare ? front + 0.01 : foreEnd + 0.01, o.barrel + (bare ? o.fore[0] : 0), o.bore || 0.0125, o.device, o.fluted);
  if (o.gas) { k.box(m.black, 0.03, 0.036, 0.03, [0, barrelY + 0.012, foreEnd - o.barrel * 0.35]); k.tube(m.grey, 0.006, o.barrel * 0.36, [0, barrelY + 0.026, foreEnd - o.barrel * 0.17], 8); }
  // Stock. A build can skeletonise it, bulk it out, or take it off the gun entirely.
  const s0 = back;
  const stockKind = o.stockMod === 'light' ? 'skeleton' : o.stockMod === 'none' ? 'none' : o.stock;
  let stockL = o.stockLen || 0.25;
  if (stockKind === 'sporter' || stockKind === 'shotgun') {
    const L = o.stockLen || 0.32, shot = o.stock === 'shotgun';
    stockL = L;
    k.profile(m.wood, [[0.02, top - 0.034], [-0.04, top - 0.036], [-0.1, top - 0.02], [-L, top - (shot ? 0.03 : 0.012)], [-L, bottom - 0.05], [-L + 0.04, bottom - 0.052], [-0.13, bottom - 0.012], [-0.06, bottom - 0.03], [-0.035, bottom - 0.062], [0.0, bottom - 0.06], [0.012, bottom - 0.01], [0.02, bottom + 0.004]], w - 0.004, [0, 0, s0], null, 0.007);
    k.box(m.black, w + 0.002, 0.125, 0.016, [0, -0.028, s0 + L + 0.006]);
    if (!shot) k.profile(m.wood, [[-0.12, top - 0.014], [-L + 0.03, top + 0.008], [-L + 0.03, top - 0.02], [-0.12, top - 0.026]], w - 0.014, [0, 0, s0], null, 0.004);
  } else if (stockKind === 'fixed') {
    const L = o.stockLen || 0.27;
    stockL = L;
    k.profile(m.dark, [[0, top - 0.006], [-L, top - 0.014], [-L, bottom - 0.04], [-L + 0.05, bottom - 0.04], [-0.06, bottom + 0.014], [0, bottom + 0.02]], w - 0.006, [0, 0, s0], null, 0.006);
    k.box(m.black, w - 0.012, 0.05, L * 0.4, [0, -0.012, s0 + L * 0.55]);
    k.box(m.black, w, 0.11, 0.014, [0, -0.026, s0 + L + 0.005]);
  } else if (stockKind === 'tube') {
    const L = o.stockLen || 0.22;
    stockL = L;
    k.tube(m.grey, 0.016, L, [0, 0.004, s0 + L / 2], 12);
    k.profile(m.dark, [[-0.07, top - 0.012], [-L - 0.02, top - 0.014], [-L - 0.02, bottom - 0.035], [-L + 0.02, bottom - 0.035], [-0.1, bottom + 0.024], [-0.07, bottom + 0.03]], w - 0.014, [0, 0, s0], null, 0.005);
    k.box(m.black, w - 0.01, 0.1, 0.012, [0, -0.025, s0 + L + 0.024]);
    k.box(m.grey, 0.012, 0.012, 0.03, [0, bottom + 0.018, s0 + 0.1]);
  } else if (stockKind === 'wire') {
    const L = o.stockLen || 0.2;
    stockL = L;
    for (const y of [top - 0.016, bottom + 0.022]) k.tube(m.grey, 0.0055, L, [0, y, s0 + L / 2], 8);
    k.box(m.black, 0.03, h + 0.02, 0.012, [0, 0, s0 + L + 0.004]);
    k.box(m.black, 0.026, 0.02, 0.03, [0, 0, s0 + 0.012]);
  } else if (stockKind === 'chassis') {
    const L = o.stockLen || 0.34;
    stockL = L;
    k.profile(m.dark, [[0, top - 0.01], [-0.08, top - 0.012], [-0.08, bottom + 0.03], [0, bottom + 0.02]], w - 0.008, [0, 0, s0], null, 0.004);
    k.tube(m.grey, 0.012, L - 0.08, [0, 0.0, s0 + 0.08 + (L - 0.08) / 2], 10);
    k.profile(m.dark, [[-L + 0.08, top + 0.006], [-L, top + 0.004], [-L, bottom - 0.05], [-L + 0.06, bottom - 0.05], [-L + 0.09, bottom + 0.0], [-L + 0.08, bottom + 0.03]], w - 0.012, [0, 0, s0], null, 0.005);
    k.box(m.black, w - 0.004, 0.13, 0.016, [0, -0.025, s0 + L + 0.007]);
    k.box(m.black, w - 0.02, 0.014, 0.1, [0, top + 0.014, s0 + L - 0.07]);
  } else if (stockKind === 'skeleton') {
    // Everything that was not holding the stock together, cut away.
    const L = Math.max(0.16, (o.stockLen || 0.24) - 0.03);
    stockL = L;
    for (const y of [top - 0.016, bottom + 0.02]) k.tube(m.grey, 0.0055, L, [0, y, s0 + L / 2], 8);
    for (const dz of [0.28, 0.62]) k.box(m.grey, 0.012, h - 0.04, 0.012, [0, 0, s0 + L * dz], [0.3, 0, 0]);
    k.box(m.dark, w - 0.02, 0.012, L * 0.5, [0, top - 0.004, s0 + L * 0.58]);
    k.box(m.black, w - 0.018, 0.085, 0.01, [0, -0.02, s0 + L + 0.004]);
    k.tube(m.grey, 0.0055, 0.05, [0, bottom - 0.004, s0 + L - 0.02], 8, [0, 0, Math.PI / 2]);
  } else if (stockKind === 'none') {
    // Nothing behind the receiver but the plate that closed it off.
    stockL = 0.03;
    k.box(m.dark, w - 0.004, h - 0.012, 0.014, [0, 0, s0 + 0.008]);
    k.ring(m.grey, 0.008, 0.002, [0, top - 0.018, s0 + 0.016], [0, Math.PI / 2, 0]);
  }
  if (o.stockMod === 'heavy' && stockKind !== 'none') {
    // Heavy stock: a full cheek riser and a slab of a recoil pad bolted over the gun's own.
    k.profile(m.dark, [[-0.05, top + 0.03], [-stockL + 0.02, top + 0.032], [-stockL + 0.02, top - 0.016], [-0.05, top - 0.012]], w - 0.004, [0, 0, s0], null, 0.005);
    for (const dz of [0.12, stockL - 0.09]) k.tube(m.grey, 0.005, 0.03, [0, top + 0.012, s0 + dz], 8, null);
    k.box(m.black, w + 0.008, 0.15, 0.028, [0, -0.03, s0 + stockL + 0.018]);
  }
  if (o.grip !== false) { pistolGrip(k, m.dark, m, bottom + 0.008); }
  trigger(k, m, bottom + 0.004, o.grip === false ? -0.02 : -0.05);
  // Magazine.
  const [kind, magH = 0.16] = o.mag || ['box'];
  const magZ = o.magZ ?? front + o.len * 0.4;
  let mag = null;
  // The pump rides on the magazine tube, so a drum conversion keeps the tube and hangs the drum under it.
  if (kind === 'tube' || o.keepTube) { const tube = ((o.fore ? o.fore[0] : 0.3) + o.barrel * 0.72) * (o.magTube || 1); k.tube(m.grey, 0.0155, tube, [0, -0.026, front - tube / 2 + 0.02], 12); }
  if (kind !== 'tube') { mag = magazine(k, m, kind, magH, bottom + 0.004, magZ, o.magW || 0.032, o.magTape); if (kind !== 'belt' && kind !== 'drum') k.profile(m.steel, [[0.04, 0], [0.042, -0.022], [-0.034, -0.022], [-0.036, 0]], w + 0.004, [0, bottom + 0.004, magZ], null, 0.003); }
  // Sights.
  let sightLine = null;
  const railTop = o.optic === 'iron' || o.optic === 'bead' ? top : rail(k, m, top, front + o.len * 0.12, back - 0.02);
  let glass = null;
  if (o.optic === 'scope' || o.optic === 'bigscope') { const big = o.optic === 'bigscope'; glass = scope(k, m, railTop + (big ? 0.05 : 0.042), front + o.len * 0.52, big ? 0.42 : 0.32, big ? 0.043 : 0.035); }
  else if (o.optic === 'prism') { glass = scope(k, m, railTop + 0.04, front + o.len * 0.5, 0.2, 0.032); }
  else if (o.optic === 'holo') sightLine = holoSight(k, m, railTop, -0.15);
  else if (o.optic === 'dot') sightLine = redDot(k, m, railTop, -0.15);
  else if (o.optic === 'bead') { const beadY = Math.max(top + 0.006, barrelY + (o.bore || 0.02) + 0.004); k.tube(m.grey, 0.002, beadY - barrelY, [0, (beadY + barrelY) / 2, muzzle + 0.03], 6, null); k.ball(m.brass, 0.0055, [0, beadY, muzzle + 0.03]); k.box(m.black, 0.018, 0.004, o.len * 0.7, [0, top + 0.002, front + o.len * 0.45]); sightLine = beadY + 0.004; }
  else sightLine = ironSights(k, m, top, o.fore ? foreEnd + 0.04 : front + 0.03, 0.03);
  // A carry handle sits where an open sight's eye line runs, so a gun wearing a dot or a holo loses it:
  // the handle was drawn straight through the Anvil's red dot and blocked half the sight picture.
  if (o.carry && o.optic !== 'dot' && o.optic !== 'holo') { k.box(m.dark, 0.016, 0.012, 0.16, [0, top + 0.05, front + o.len * 0.5]); for (const dz of [-0.07, 0.07]) k.box(m.dark, 0.016, 0.044, 0.014, [0, top + 0.026, front + o.len * 0.5 + dz]); }
  // Under the fore-end: the gun's own bipod, or whatever the build bolted on there. On a pump gun the
  // grip goes on the pump, because that is the part the hand is already holding.
  const gripZ = foreEnd + (o.fore ? 0.07 : 0.05);
  const holdOn = (into, y, z) => { if (o.hold === 'bipod') bipod(into, m, y + 0.002, z, true); else foreGrip(into, m, y, z, o.hold === 'anglegrip'); };
  if (o.hold && !o.pump) holdOn(k, bottom + 0.002, gripZ);
  else if (o.bipod) bipod(k, m, bottom + 0.004, foreEnd + 0.06);
  // Accent strip and a sling loop.
  k.box(m.glow, 0.004, 0.008, o.len * 0.6, [w / 2 + 0.002, -0.012, front + o.len * 0.5]);
  k.box(m.glow, 0.004, 0.008, o.len * 0.6, [-w / 2 - 0.002, -0.012, front + o.len * 0.5]);
  k.ring(m.grey, 0.009, 0.002, [0, bottom - 0.004, back + stockL * 0.8], [0, Math.PI / 2, 0]);
  // Moving parts.
  const stud = [-(w / 2 + 0.006), bottom + 0.016, front + 0.035];
  k.ring(m.grey, 0.007, 0.0018, stud, [0, Math.PI / 2, 0]);
  k.tube(m.grey, 0.003, 0.008, [stud[0] + 0.004, stud[1] + 0.006, stud[2]], 6, [0, 0, Math.PI / 2]);
  const out = { muzzle, sightLine, window: k.lastWindow || null, mag: mag?.group || null, front, foreEnd, gripZ: o.hold && !o.pump ? gripZ : null, charmAt: [stud[0] - 0.002, stud[1] - 0.006, stud[2]] };
  if (glass) {
    // The eyepiece is its own mesh: in first person it shows the magnified view, elsewhere it is dark glass.
    const lens = new THREE.Mesh(new THREE.CircleGeometry(glass.r, 32), GLASS);
    lens.position.set(0, glass.y, glass.z);
    root.add(lens);
    out.lens = lens; out.glass = glass;
  }
  if (o.bolt) {
    const bolt = k.part([w / 2 - 0.004, top * 0.4, back - 0.07]);
    bolt.tube(m.grey, 0.0085, 0.06, [0.026, -0.008, 0], 8, [0, 0, Math.PI / 2 + 0.35]);
    bolt.ball(m.black, 0.016, [0.058, -0.02, 0]);
    bolt.tube(m.grey, 0.011, 0.07, [-0.004, 0, -0.02], 10);
    out.bolt = bolt.group;
  } else if (o.charge !== false && !o.pump) {
    const charge = k.part([w / 2 + 0.004, top * 0.5, front + o.len * 0.6]);
    charge.box(m.grey, 0.014, 0.012, 0.03, [0.004, 0, 0]);
    charge.box(m.black, 0.02, 0.016, 0.012, [0.01, 0, 0.008]);
    out.slide = charge.group; out.slideTravel = 0.05;
  }
  if (o.pump) {
    const pump = k.part([0, -0.026, front - o.fore[0] * 0.55]);
    pump.profile(m.wood, [[0.085, 0.026], [0.085, -0.024], [0.07, -0.032], [-0.07, -0.032], [-0.085, -0.024], [-0.085, 0.026]], w + 0.012, [0, 0, 0], null, 0.006);
    for (let i = 0; i < 6; i += 1) pump.box(m.black, w + 0.016, 0.04, 0.005, [0, -0.004, -0.06 + i * 0.024]);
    if (o.hold) holdOn(pump, -0.03, 0);
    out.pump = pump.group;
  }
  k.bake();
  return out;
}

// ------------------------------------------------------------------ gunsmith
// A build is folded into the gun's spec before a single triangle is drawn, so the muzzle, the sight line
// and the ADS position all still fall out of the same code that draws a stock gun. Nothing downstream
// has to know an attachment was ever there.
const OPTIC_KIND = { dot: 'dot', holo: 'holo', prism: 'prism', longscope: 'scope' };
const DEVICE_KIND = { suppressor: 'suppressor', compensator: 'comp', brake: 'ported' };
function buildSpec(spec, build) {
  if (!build) return spec;
  const o = { ...spec };
  // A carry handle stands exactly where a fitted optic's eye line runs, so choosing one takes it off.
  if (build.optic === 'irons') { o.optic = spec.optic === 'bead' ? 'bead' : 'iron'; o.carry = false; }
  else if (OPTIC_KIND[build.optic]) { o.optic = OPTIC_KIND[build.optic]; o.carry = false; }
  if (DEVICE_KIND[build.muzzle]) o.device = DEVICE_KIND[build.muzzle];
  if (build.barrel === 'longbarrel') o.barrel = spec.barrel * 1.45;
  else if (build.barrel === 'shortbarrel') o.barrel = Math.max(0.07, spec.barrel * 0.55);
  else if (build.barrel === 'heavybarrel') { o.bore = (spec.bore || 0.0125) * 1.32; o.fluted = true; }
  const [kind, magH = 0.16] = spec.mag || ['box'];
  if (build.mag === 'extmag') { if (kind === 'tube') o.magTube = 1.22; else if (kind !== 'drum' && kind !== 'belt') o.mag = [kind, magH * 1.5]; }
  else if (build.mag === 'fastmag') { if (kind === 'tube') o.magTube = 0.82; else if (kind !== 'drum' && kind !== 'belt') { o.mag = [kind, magH * 0.66]; o.magTape = true; } }
  else if (build.mag === 'drum') { o.mag = ['drum']; o.magW = 0.032; o.keepTube = kind === 'tube'; }
  if (build.stock === 'heavystock') o.stockMod = 'heavy';
  else if (build.stock === 'lightstock') o.stockMod = 'light';
  else if (build.stock === 'nostock') o.stockMod = 'none';
  if (build.grip) o.hold = build.grip;
  return o;
}

const LONG = {
  m44: { len: 0.56, fore: [0.26, 'wood'], barrel: 0.5, bore: 0.0135, device: 'brake', stock: 'sporter', stockLen: 0.34, grip: false, mag: ['box', 0.05], magZ: -0.17, optic: 'scope', bolt: true, reach: -0.5, ads: [0, -0.098, -0.2] },
  vesper: { len: 0.5, fore: [0.22, 'wood'], barrel: 0.4, bore: 0.011, device: 'crown', stock: 'sporter', stockLen: 0.3, grip: false, mag: ['box', 0.04], magZ: -0.15, optic: 'scope', bolt: true, reach: -0.46, ads: [0, -0.098, -0.2] },
  harbinger: { len: 0.64, h: 0.11, w: 0.068, fore: [0.2, 'slab'], barrel: 0.62, bore: 0.019, device: 'brake', stock: 'chassis', stockLen: 0.36, mag: ['box', 0.11], magW: 0.044, optic: 'bigscope', bolt: true, bipod: true, reach: -0.52, hip: [0.16, -0.175, -0.44], ads: [0, -0.12, -0.2] },
  recon: { len: 0.5, fore: [0.3, 'slab'], barrel: 0.24, bore: 0.012, device: 'hider', stock: 'fixed', stockLen: 0.26, mag: ['box', 0.13], optic: 'prism', gas: true, reach: -0.46, ads: [0, -0.096, -0.2] },
  talon: { len: 0.44, h: 0.094, w: 0.058, fore: [0.27, 'slab'], barrel: 0.2, device: 'hider', stock: 'tube', mag: ['curved', 0.15], optic: 'dot', gas: true, reach: -0.42, hip: [0.145, -0.155, -0.38] },
  ronin: { len: 0.44, fore: [0.22, 'wood'], barrel: 0.26, bore: 0.0135, device: 'brake', stock: 'sporter', stockLen: 0.27, mag: ['curved', 0.19], optic: 'iron', gas: true, reach: -0.44, adsZ: -0.4 },
  halcyon: { len: 0.4, fore: [0.2, 'slab'], barrel: 0.12, device: 'hider', stock: 'tube', stockLen: 0.17, mag: ['curved', 0.14], optic: 'holo', reach: -0.38 },
  anvil: { len: 0.56, h: 0.11, w: 0.068, fore: [0.24, 'round'], barrel: 0.32, bore: 0.0165, device: 'hider', stock: 'fixed', stockLen: 0.28, mag: ['belt'], magZ: -0.2, optic: 'dot', bipod: true, carry: true, gas: true, reach: -0.5, hip: [0.16, -0.175, -0.42] },
  wasp: { len: 0.36, h: 0.1, w: 0.058, fore: [0.12, 'slab'], barrel: 0.1, bore: 0.014, device: 'crown', stock: 'wire', stockLen: 0.2, mag: ['stick', 0.19], magZ: -0.2, optic: 'dot', reach: -0.31, hip: [0.14, -0.15, -0.35] },
  hornet: { len: 0.33, h: 0.1, fore: [0.1, 'slab'], barrel: 0.08, bore: 0.013, device: 'suppressor', stock: 'wire', stockLen: 0.15, mag: ['stick', 0.21], magZ: -0.005, optic: 'holo', reach: -0.3, hip: [0.14, -0.15, -0.35] },
  breaker: { len: 0.34, fore: [0.34, 'none'], barrel: 0.3, barrelY: 0.02, bore: 0.0185, device: 'crown', stock: 'shotgun', stockLen: 0.3, grip: false, mag: ['tube'], optic: 'bead', pump: true, reach: null, ads: [0, -0.06, -0.26] },
  maul: { len: 0.42, fore: [0.2, 'round'], barrel: 0.3, barrelY: 0.016, bore: 0.0185, device: 'brake', stock: 'fixed', stockLen: 0.27, mag: ['drum'], magZ: -0.17, optic: 'iron', gas: true, reach: -0.44, adsZ: -0.38 },
};

// ------------------------------------------------------------------ handguns
// A build reaches a handgun through the same ids: the optic bridges the slide, a muzzle device screws on
// the nose, the barrel grows or shrinks out of the front and the magazine changes length. Stocks fit a
// handgun on paper only, so they change nothing here.
function pistol(root, id, m, build) {
  const k = kit(root);
  const spec = { p9: { len: 0.2, mag: 0.0 }, pike: { len: 0.22, mag: 0.085, comp: true, auto: true }, wren: { len: 0.17, mag: 0.0, can: true } }[id];
  const L = spec.len, y = 0.022;
  const stretch = build?.barrel === 'longbarrel' ? 0.07 : build?.barrel === 'shortbarrel' ? -0.016 : 0;
  const bore = build?.barrel === 'heavybarrel' ? 0.0105 : 0.0075;
  const magLen = build?.mag === 'extmag' ? spec.mag + 0.055 : build?.mag === 'fastmag' ? Math.max(0, spec.mag - 0.012) : spec.mag;
  // Frame with a dust-cover rail, grip with a beavertail and texture, flared magazine well.
  k.profile(m.dark, [[-0.036, 0.01], [L - 0.02, 0.01], [L - 0.02, -0.012], [L - 0.08, -0.016], [0.05, -0.016], [0.046, -0.03], [0.02, -0.03], [0.016, -0.016], [-0.02, -0.016], [-0.05, 0.004]], 0.03, [0, y - 0.022, 0], null, 0.003);
  for (let i = 0; i < 3; i += 1) k.box(m.black, 0.032, 0.004, 0.006, [0, y - 0.037, -L + 0.04 + i * 0.013]);
  k.profile(m.dark, [[0.02, 0], [0.012, -0.05], [-0.004, -0.108], [-0.058, -0.1], [-0.05, -0.04], [-0.044, 0]], 0.034, [0, y - 0.03, 0.004], null, 0.005);
  for (let i = 0; i < 5; i += 1) k.box(m.black, 0.036, 0.004, 0.034, [0, y - 0.05 - i * 0.014, 0.022 + i * 0.004], [-0.2, 0, 0]);
  trigger(k, m, y - 0.034, -0.042, 0.052);
  k.box(m.grey, 0.036, 0.008, 0.018, [0, y - 0.01, -0.01]);
  const mag = k.part([0, y - 0.13, 0.034]);
  mag.profile(m.dark, [[0.02, 0.09], [0.012, -magLen], [-0.03, -magLen + 0.004], [-0.024, 0.09]], 0.026, [0, 0, 0], null, 0.002);
  mag.box(m.grey, 0.036, 0.008, 0.058, [0, -magLen - 0.002, 0.008], [-0.12, 0, 0]);
  if (build?.mag === 'extmag') mag.box(m.black, 0.03, 0.03, 0.05, [0, -magLen + 0.026, 0.004]);
  if (build?.mag === 'fastmag') { mag.box(m.black, 0.033, 0.016, 0.052, [0, -magLen + 0.012, 0.006]); mag.box(m.glow, 0.014, 0.008, 0.022, [0, -magLen + 0.012, 0.042], [-0.3, 0, 0]); }
  mag.group.userData.rest = mag.group.position.clone();
  // Slide: the part that moves. Serrations, ejection port, sights, the barrel showing at the front.
  const slide = k.part([0, y, 0]);
  slide.profile(m.steel, [[-0.04, -0.008], [-0.04, 0.022], [-0.034, 0.028], [L - 0.006, 0.028], [L, 0.022], [L, -0.008]], 0.032, [0, 0, 0], null, 0.003);
  for (let i = 0; i < 6; i += 1) for (const side of [-1, 1]) slide.box(m.black, 0.003, 0.024, 0.004, [side * 0.0165, 0.01, 0.032 - i * 0.009], [0, 0, 0]);
  slide.box(m.black, 0.004, 0.014, 0.04, [0.0165, 0.016, -L * 0.45]);
  slide.box(m.grey, 0.006, 0.01, 0.008, [0, 0.033, -L + 0.012]);
  for (const side of [-1, 1]) slide.box(m.black, 0.008, 0.01, 0.01, [side * 0.01, 0.033, 0.03]);
  slide.box(m.glow, 0.003, 0.005, L * 0.55, [0.0168, 0.0, -L * 0.45]);
  slide.box(m.glow, 0.003, 0.005, L * 0.55, [-0.0168, 0.0, -L * 0.45]);
  k.box(m.grey, 0.012, 0.02, 0.014, [0, y + 0.018, 0.046], [0.5, 0, 0]);                                           // hammer
  // Barrel showing past the slide: a long one pokes out, a short one pulls back inside.
  const nose = -L - 0.012 - stretch, shown = -L + 0.019 - nose;
  k.tube(m.grey, bore, shown, [0, y + 0.012, nose + shown / 2], 10);
  if (build?.barrel === 'heavybarrel') k.ring(m.grey, bore + 0.003, 0.0028, [0, y + 0.012, nose + 0.008]);
  let muzzle = nose;
  const device = build?.muzzle ? DEVICE_KIND[build.muzzle] : spec.comp ? 'own-comp' : spec.can ? 'own-can' : null;
  if (device === 'own-comp') { k.profile(m.black, [[L - 0.004, 0.05], [L + 0.05, 0.05], [L + 0.05, 0.004], [L - 0.004, 0.0]], 0.034, [0, 0, -stretch], null, 0.003); for (const z of [0.014, 0.032]) k.box(m.grey, 0.036, 0.006, 0.008, [0, 0.052, -L - z - stretch]); muzzle = -L - 0.055 - stretch; }
  else if (device === 'own-can') { k.tube(m.black, 0.019, 0.17, [0, y + 0.012, -L - 0.085 - stretch], 14); for (const z of [0.02, 0.085, 0.15]) k.ring(m.grey, 0.0192, 0.002, [0, y + 0.012, -L - z - stretch]); muzzle = -L - 0.175 - stretch; }
  else if (device) muzzle = muzzleDevice(k, m, y + 0.012, nose, bore, device);
  // Optics bridge the frame rather than ride the slide: the sight line has to stay where the maths put it.
  const optic = build?.optic && build.optic !== 'irons' ? build.optic : null;
  let sightY = y + 0.038, glass = null;
  if (optic) for (const side of [-1, 1]) k.box(m.dark, 0.006, 0.03, 0.024, [side * 0.02, y + 0.016, 0.028]);
  if (optic === 'dot') sightY = redDot(k, m, y + 0.028, 0.012);
  else if (optic === 'holo') sightY = holoSight(k, m, y + 0.028, -0.01);
  else if (optic) glass = scope(k, m, y + 0.086, -0.03, optic === 'prism' ? 0.15 : 0.22, 0.028);
  if (build?.grip === 'vertgrip' || build?.grip === 'anglegrip') foreGrip(k, m, y - 0.036, -L + 0.05, build.grip === 'anglegrip');
  k.bake();
  return { mag: mag.group, slide: slide.group, slideTravel: 0.035, muzzle, sightY, glass, window: k.lastWindow || null, charmAt: [-0.019, y - 0.038, -L + 0.05] };
}
// Viper: a heavy revolver. Rib and underlug on the barrel, a fluted cylinder that turns, a wooden grip.
function revolver(root, m, build) {
  const k = kit(root);
  const y = 0.024;
  // The barrel, rib and underlug are all cut to one length, so a barrel swap moves the lot.
  const bl = 0.22 * (build?.barrel === 'longbarrel' ? 1.4 : build?.barrel === 'shortbarrel' ? 0.55 : 1);
  const bore = build?.barrel === 'heavybarrel' ? 0.016 : 0.012, end = 0.1 + bl;
  k.profile(m.steel, [[-0.05, 0.03], [0.1, 0.034], [0.1, -0.012], [0.06, -0.03], [0.022, -0.034], [0.018, -0.02], [-0.03, -0.02], [-0.056, 0.0]], 0.03, [0, y - 0.012, 0], null, 0.004);
  k.tube(m.steel, bore, bl, [0, y + 0.006, -0.1 - bl / 2], 12);
  k.box(m.steel, 0.012, 0.012, bl, [0, y + 0.022, -0.1 - bl / 2]);
  for (let i = 0; i < Math.floor(bl / 0.05); i += 1) k.box(m.black, 0.014, 0.004, 0.018, [0, y + 0.026, -0.13 - i * 0.045]);
  k.profile(m.steel, [[0.1, -0.006], [end - 0.008, -0.006], [end, -0.022], [0.1, -0.03]], 0.02, [0, y, 0], null, 0.003);
  k.profile(m.wood, [[0.016, 0], [0.01, -0.06], [-0.012, -0.118], [-0.064, -0.108], [-0.058, -0.05], [-0.046, -0.004]], 0.036, [0, y - 0.03, 0.006], null, 0.007);
  k.tube(m.brass, 0.008, 0.04, [0, y - 0.085, 0.036], 10, [0, 0, Math.PI / 2]);
  trigger(k, m, y - 0.03, -0.034, 0.05);
  k.box(m.grey, 0.01, 0.026, 0.014, [0, y + 0.03, 0.05], [0.7, 0, 0]);                                              // hammer spur
  k.box(m.glow, 0.008, 0.014, 0.01, [0, y + 0.04, -end + 0.012]);
  for (const side of [-1, 1]) k.box(m.black, 0.006, 0.022, 0.01, [side * 0.009, y + 0.036, 0.036]);
  const cylinder = k.part([0, y + 0.004, -0.06]);
  cylinder.tube(m.grey, 0.031, 0.075, [0, 0, 0], 18);
  for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; cylinder.tube(m.black, 0.007, 0.05, [Math.cos(a) * 0.029, Math.sin(a) * 0.029, -0.014], 8); cylinder.disc(m.brass, 0.0075, [Math.cos(a + 0.52) * 0.019, Math.sin(a + 0.52) * 0.019, 0.0378]); }
  // Gunsmith parts: glass on the rib, a device on the muzzle. Nothing else bolts to a revolver.
  const optic = build?.optic && build.optic !== 'irons' ? build.optic : null;
  let sightY = y + 0.047, glass = null;
  if (optic === 'dot') sightY = redDot(k, m, y + 0.03, -0.1);
  else if (optic === 'holo') sightY = holoSight(k, m, y + 0.03, -0.09);
  else if (optic) glass = scope(k, m, y + 0.09, -0.12, optic === 'prism' ? 0.16 : 0.24, 0.028);
  const muzzle = build?.muzzle ? muzzleDevice(k, m, y + 0.006, -end, bore, DEVICE_KIND[build.muzzle]) : -end - 0.005;
  k.bake();
  return { mag: null, cylinder: cylinder.group, muzzle, sightY, glass, window: k.lastWindow || null, charmAt: [-0.013, y - 0.024, -0.2] };
}
// Sawn-off: two barrels on a hinge, a colour-cased action, a bird's-head grip.
function sawnOff(root, m, build) {
  const k = kit(root);
  k.profile(m.steel, [[-0.05, 0.03], [0.08, 0.032], [0.085, -0.02], [0.03, -0.034], [-0.03, -0.026], [-0.056, 0.004]], 0.062, [0, 0, 0], null, 0.005);
  k.profile(m.wood, [[-0.03, 0.02], [-0.09, 0.0], [-0.14, -0.05], [-0.13, -0.1], [-0.085, -0.104], [-0.07, -0.06], [-0.02, -0.03]], 0.044, [0, 0, 0], null, 0.009);
  k.box(m.grey, 0.014, 0.008, 0.04, [0, 0.036, 0.03], [0.2, 0, 0]);                                                 // top lever
  trigger(k, m, -0.028, -0.02, 0.06);
  k.box(m.glow, 0.004, 0.008, 0.08, [0.0325, 0.004, -0.02]); k.box(m.glow, 0.004, 0.008, 0.08, [-0.0325, 0.004, -0.02]);
  pins(k, m, 0.062, [[-0.07, -0.012, 0.006]]);
  // Both barrels are cut to one length, so a barrel swap takes the rib, the fore-end and the bead with it.
  const bl = 0.3 * (build?.barrel === 'longbarrel' ? 1.35 : build?.barrel === 'shortbarrel' ? 0.6 : 1);
  const bore = build?.barrel === 'heavybarrel' ? 0.023 : 0.0195;
  const barrels = k.part([0, -0.012, -0.078]);
  for (const side of [-1, 1]) { barrels.tube(m.grey, bore, bl, [side * (bore + 0.001), 0.03, -bl / 2], 14); barrels.tube(m.black, bore * 0.85, 0.004, [side * (bore + 0.001), 0.03, -bl - 0.0005], 14); }
  barrels.box(m.grey, 0.012, 0.008, bl - 0.02, [0, 0.05, -bl / 2]);
  barrels.profile(m.wood, [[0.02, 0.012], [bl * 0.67, 0.014], [bl * 0.67, -0.008], [bl * 0.57, -0.02], [0.02, -0.014]], 0.058, [0, 0, 0], null, 0.006);
  barrels.ball(m.brass, 0.005, [0, 0.058, -bl + 0.015]);
  // Optics only: nothing screws onto two barrels that break open.
  const optic = build?.optic && build.optic !== 'irons' ? build.optic : null;
  let sightY = 0.0525, glass = null;
  if (optic === 'dot') sightY = redDot(k, m, 0.034, -0.02);
  else if (optic === 'holo') sightY = holoSight(k, m, 0.034, -0.01);
  else if (optic) glass = scope(k, m, 0.094, -0.04, optic === 'prism' ? 0.16 : 0.24, 0.028);
  k.bake();
  return { mag: null, hinge: barrels.group, muzzle: -0.085 - bl, sightY, glass, window: k.lastWindow || null, charmAt: [-0.034, -0.022, -0.04] };
}

// ------------------------------------------------------------------ Nin Launcher
// A tube on a shoulder. Heat shield over the middle, a boxed sight, a grip at each end, a wide mouth and
// a venturi out the back. The rocket is its own group: firing hides it, a reload brings it back.
function launcher(root, m, build) {
  const k = kit(root);
  const y = 0.024, r = 0.046, front = -0.6, back = 0.3;
  k.tube(m.dark, r, back - front, [0, y, (front + back) / 2], 20);
  k.tube(m.grey, r * 1.14, 0.3, [0, y, -0.22], 20);
  for (let i = 0; i < 8; i += 1) for (const side of [-1, 1]) k.box(m.black, 0.005, 0.024, 0.03, [side * r * 1.14, y, -0.35 + i * 0.04]);
  for (const z of [-0.075, -0.365]) k.ring(m.grey, r * 1.16, 0.004, [0, y, z]);
  // The blast has to go somewhere: a wide mouth at the front, a cone out the back.
  k.tube(m.grey, r * 1.32, 0.08, [0, y, front + 0.04], 20, ALONG, r);
  k.ring(m.black, r * 1.3, 0.005, [0, y, front + 0.004]);
  k.tube(m.dark, r * 0.98, 0.11, [0, y, back - 0.055], 20, ALONG, r * 1.3);
  k.ring(m.black, r * 1.28, 0.005, [0, y, back - 0.002]);
  // Grips: firing hand at the origin, the other under the tube.
  const gripZ = -0.3;
  pistolGrip(k, m.dark, m, y - r - 0.004, 0.1, 0.036);
  trigger(k, m, y - r - 0.008, -0.046);
  foreGrip(k, m, y - r - 0.002, gripZ, false);
  // Shoulder rest, folded down where the tube sits on a plate carrier.
  k.profile(m.dark, [[0.03, -0.006], [0.03, -0.055], [-0.11, -0.07], [-0.11, -0.01]], 0.05, [0, y - r, 0.19], null, 0.005);
  k.box(m.black, 0.062, 0.012, 0.11, [0, y - r - 0.066, 0.245]);
  // Sights on the rail. A gunsmith optic replaces the boxed sight it comes with.
  const railY = rail(k, m, y + r * 0.95, -0.36, -0.16, 0.024);
  const optic = build?.optic && build.optic !== 'irons' ? build.optic : null;
  let sightLine = null, glass = null;
  if (optic === 'dot') sightLine = redDot(k, m, railY, -0.26);
  else if (optic === 'holo') sightLine = holoSight(k, m, railY, -0.26);
  else if (optic) glass = scope(k, m, railY + 0.044, -0.26, optic === 'prism' ? 0.2 : 0.32, optic === 'prism' ? 0.032 : 0.035);
  else {
    const centre = railY + 0.03;
    k.box(m.dark, 0.05, 0.014, 0.12, [0, railY + 0.007, -0.26]);
    for (const side of [-1, 1]) k.box(m.dark, 0.006, 0.05, 0.1, [side * 0.026, centre, -0.26]);
    k.box(m.dark, 0.058, 0.008, 0.11, [0, centre + 0.028, -0.26]);
    k.box(m.black, 0.05, 0.006, 0.016, [0, centre + 0.03, -0.32], [0.45, 0, 0]);
    k.put(LENS, new THREE.PlaneGeometry(0.04, 0.036), [0, centre, -0.3]);
    k.box(m.glow, 0.005, 0.006, 0.018, [0, centre, -0.312]);                       // the post you put on a target
    sightLine = centre;
  }
  if (build?.grip === 'bipod') bipod(k, m, y - r - 0.004, -0.52, true);
  // Accent down both sides, and a stud for the charm.
  for (const side of [-1, 1]) k.box(m.glow, 0.004, 0.01, 0.16, [side * (r * 1.16), y - 0.016, -0.22]);
  const stud = [-(r + 0.012), y - 0.022, -0.14];
  k.ring(m.grey, 0.007, 0.0018, stud, [0, Math.PI / 2, 0]);
  // The rocket. Warhead out of the mouth, body down the tube.
  const rocket = k.part([0, y, front + 0.005]);
  rocket.tube(m.dark, 0.012, 0.09, [0, 0, -0.045], 14, ALONG, 0.05);
  rocket.ball(m.grey, 0.012, [0, 0, -0.088]);
  rocket.ring(m.glow, 0.05, 0.004, [0, 0, -0.004]);
  rocket.tube(m.grey, 0.034, 0.16, [0, 0, 0.08], 14);
  rocket.ring(m.black, 0.0345, 0.003, [0, 0, 0.06]);
  rocket.group.userData.rest = rocket.group.position.clone();
  k.bake();
  return { muzzle: front - 0.008, muzzleY: y, sightLine, glass, window: k.lastWindow || null, rocket: rocket.group, gripZ, charmAt: [stud[0] - 0.002, stud[1] - 0.006, stud[2]] };
}

// Kestrel Blade: a drop-point fighting knife. The blade is a real profile (belly, clip point, ground edge),
// with a fuller carrying the accent glow, jimping on the spine, a two-quillon guard, a contoured grip with
// scales and a steel pommel with a lanyard ring. Blade along -z, edge down. A finish covers blade and scales.
function knife(root, m) {
  const k = kit(root);
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.019); shape.lineTo(0.018, -0.021);
  shape.bezierCurveTo(0.09, -0.024, 0.165, -0.02, 0.232, 0.009);
  shape.lineTo(0.17, 0.0205); shape.lineTo(0.0, 0.0205); shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0085, bevelSegments: 1, steps: 1, curveSegments: 10 });
  blade.translate(0, 0, -0.0011); blade.rotateY(Math.PI / 2);
  k.put(m.blade, blade, [0, 0, -0.05]);
  for (const side of [-1, 1]) { k.box(m.glow, 0.0012, 0.006, 0.13, [side * 0.0034, 0.009, -0.125]); k.box(m.grip, 0.0016, 0.012, 0.03, [side * 0.0032, -0.004, -0.068]); }
  for (let notch = 0; notch < 6; notch += 1) k.box(m.fittings, 0.0062, 0.004, 0.0045, [0, 0.03, -0.06 - notch * 0.0085]);
  k.box(m.fittings, 0.017, 0.03, 0.013, [0, 0.028, -0.046], [0.3, 0, 0]);
  k.box(m.fittings, 0.017, 0.034, 0.013, [0, -0.03, -0.047], [-0.35, 0, 0]);
  k.box(m.fittings, 0.02, 0.05, 0.012, [0, 0, -0.043]);
  k.put(m.grip, new THREE.CapsuleGeometry(0.0155, 0.088, 4, 12), [0, -0.002, 0.014], ALONG, [0.82, 1, 1.25]);
  for (const side of [-1, 1]) {
    k.put(m.scales, new THREE.CapsuleGeometry(0.012, 0.074, 4, 10), [side * 0.0105, -0.002, 0.014], ALONG, [0.45, 1, 1.45]);
    for (const z of [-0.012, 0.014, 0.04]) k.tube(m.fittings, 0.0032, 0.0035, [side * 0.0148, -0.002, z], 8, [0, 0, Math.PI / 2]);
  }
  for (const z of [-0.024, -0.004, 0.016, 0.036]) k.put(m.grip, new THREE.TorusGeometry(0.0178, 0.0022, 6, 14), [0, -0.002, z], null, [0.84, 1.24, 1]);
  k.tube(m.fittings, 0.0165, 0.016, [0, -0.003, 0.076], 12);
  k.ring(m.fittings, 0.0085, 0.0022, [0, -0.003, 0.094], [0, Math.PI / 2, 0]);
  k.bake();
}

// A magnified optic bolted onto a gun that never had one. Aiming has to pull the eyepiece to its eye
// relief, or the reticle and the shot end up looking at different things.
function fitGlass(data, glass, root, prism) {
  const lens = new THREE.Mesh(new THREE.CircleGeometry(glass.r, 32), GLASS);
  lens.position.set(0, glass.y, glass.z);
  root.add(lens);
  data.lens = lens; data.lensAt = glass; data.prism = !!prism;
  data.ads = [0, -glass.y, -EYE_RELIEF - glass.z];
}

// finish: a gun skin id; it covers the body, furniture and dark parts, leaving bare metal and the glow strip.
// build: `{ optic, muzzle, barrel, mag, stock, grip }` of attachment ids from shared/attachments.js, or
// null for the gun as it comes. A build changes the model, and with it the muzzle and the sight line.
export function buildWeapon(id, accent, finish = null, build = null) {
  const g = new THREE.Group();
  const skin = skinMaterial(finish);
  const m = {
    steel: skin || M('#39424c', 0.38, 0.55), dark: skin || M('#222931', 0.6, 0.3), wood: skin || M('#6e4a2b', 0.7, 0.05),
    grey: M('#5b6671', 0.32, 0.75), black: M('#0c0f12', 0.7, 0.2), brass: M('#b8923a', 0.3, 0.8), glow: M(accent, 0.3, 0.2, accent),
  };
  const data = { muzzle: new THREE.Vector3(0, 0.01, -0.9), mag: null, bolt: null, pump: null, slide: null, cylinder: null, hinge: null, hip: [0.15, -0.155, -0.4], ads: [0, -0.115, -0.3], adsHide: false, kind: 'long' };
  let reach = null, gripY = -0.085;
  if (LONG[id]) {
    const spec = buildSpec(LONG[id], build);
    const built = longGun(g, spec, m);
    if (built.window) data.window = built.window;
    if (built.lens) { data.lens = built.lens; data.lensAt = built.glass; data.prism = spec.optic === 'prism'; }
    Object.assign(data, { mag: built.mag, bolt: built.bolt || null, pump: built.pump || null, slide: built.slide || null, slideTravel: built.slideTravel || 0 });
    data.muzzle.set(0, spec.barrelY ?? 0.008, built.muzzle);
    data.charmAt = built.charmAt; data.charmScale = 1.05;
    if (spec.hip) data.hip = spec.hip;
    data.ads = built.sightLine ? [0, -built.sightLine, spec.adsZ ?? OPTIC_ADS_Z] : spec.ads || [0, -0.1, -0.2];
    if (spec.optic === 'iron') data.ads = [0, -built.sightLine, spec.adsZ ?? -0.38];
    if (spec.optic === 'bead') data.ads = [0, -built.sightLine, -0.26];
    // Aimed, the eyepiece sits at its eye relief: close enough that the glass is most of what you see.
    if (built.glass) data.ads = [0, -built.glass.y, -EYE_RELIEF - built.glass.z];
    reach = spec.reach === undefined ? -0.42 : spec.reach;
    // A foregrip is where the other hand goes, so it takes the hand with it.
    if (built.gripZ !== null && reach !== null) reach = built.gripZ + 0.02;
    if (spec.pump) { reach = null; data.pumpHand = true; }
    if (spec.grip === false) gripY = -0.075;
  } else if (id === 'nin') {
    const built = launcher(g, m, build);
    if (built.window) data.window = built.window;
    data.charmAt = built.charmAt; data.charmScale = 1.05;
    Object.assign(data, { rocket: built.rocket, hip: [0.17, -0.17, -0.34], ads: [0, -built.sightLine, -0.26] });
    data.muzzle.set(0, built.muzzleY, built.muzzle);
    reach = built.gripZ + 0.02; gripY = -0.09;
    if (built.glass) fitGlass(data, built.glass, g, build?.optic === 'prism');
  } else if (id === 'viper') {
    const built = revolver(g, m, build);
    if (built.window) data.window = built.window;
    data.charmAt = built.charmAt; data.charmScale = 0.8;
    Object.assign(data, { cylinder: built.cylinder, kind: 'revolver', hip: [0.13, -0.125, -0.4], ads: [0, -built.sightY, -0.34] });
    data.muzzle.set(0, 0.03, built.muzzle); gripY = -0.075;
    if (built.glass) fitGlass(data, built.glass, g, build?.optic === 'prism');
  } else if (id === 'sawn') {
    const built = sawnOff(g, m, build);
    if (built.window) data.window = built.window;
    data.charmAt = built.charmAt; data.charmScale = 0.8;
    Object.assign(data, { hinge: built.hinge, kind: 'break', hip: [0.13, -0.13, -0.38], ads: [0, -built.sightY, -0.32] });
    data.muzzle.set(0, 0.018, built.muzzle); gripY = -0.06;
    if (built.glass) fitGlass(data, built.glass, g, build?.optic === 'prism');
  } else if (['p9', 'pike', 'wren'].includes(id)) {
    const built = pistol(g, id, m, build);
    if (built.window) data.window = built.window;
    data.charmAt = built.charmAt; data.charmScale = 0.8;
    Object.assign(data, { mag: built.mag, slide: built.slide, slideTravel: built.slideTravel, kind: 'pistol', hip: [0.13, -0.125, -0.4], ads: [0, -built.sightY, -0.34] });
    data.muzzle.set(0, 0.034, built.muzzle); gripY = -0.07;
    if (built.glass) fitGlass(data, built.glass, g, build?.optic === 'prism');
  } else {
    knife(g, { blade: skin || M('#aeb9c4', 0.22, 0.75), scales: skin || M('#1a1f25', 0.75, 0.1), fittings: m.grey, grip: M('#0e1114', 0.9, 0.05), glow: m.glow });
    Object.assign(data, { knife: true, kind: 'knife', hip: [0.16, -0.17, -0.42] });
    data.ads = data.hip;
    data.muzzle.set(0, 0.01, -0.3);
  }
  // Hands. The strong hand wraps the grip (or the knife's handle); the other cups the fore-end.
  const sleeve = M('#ec6a9e', 0.7, 0.05), glove = M('#171c22', 0.8, 0.05);
  const right = hand(sleeve, glove, data.knife ? 'fist' : 'grip', 1);
  if (data.knife) { right.position.set(0.004, -0.002, 0.018); right.rotation.set(-0.35, -0.25, 0.1); } else { right.position.set(0.0, gripY, 0.022); right.rotation.set(0.32, -0.3, 0); }
  g.add(right);
  data.rightHand = right;
  if (reach !== null || data.pumpHand) {
    const left = hand(sleeve, glove, 'cup', -1);
    if (data.pumpHand) { left.position.set(0, -0.036, 0); left.rotation.set(0.3, 0.85, 0); data.pump.add(left); }
    else { left.position.set(-0.004, -0.058, reach); left.rotation.set(0.3, 0.85, 0); g.add(left); }
    data.leftHand = left; data.leftRest = left.position.clone();
  } else if (data.kind === 'pistol' || data.kind === 'revolver') {
    // Support hand wrapped round the firing hand.
    const left = hand(sleeve, glove, 'grip', -1);
    left.position.set(-0.024, gripY - 0.012, 0.012); left.rotation.set(0.3, 0.6, 0.1);
    g.add(left);
    data.leftHand = left; data.leftRest = left.position.clone();
  }
  data.sleeve = sleeve;
  // The sight the HUD draws follows the optic that is actually on the gun.
  data.sight = (build?.optic && ATTACHMENTS[build.optic]?.set?.sight) || WEAPONS[id]?.sight || null;
  data.adsHide = false;
  data.front = data.muzzle.z;
  for (const key of ['bolt', 'pump', 'slide', 'cylinder', 'hinge']) if (data[key]) data[key].userData.rest = data[key].position.clone();
  g.userData = data;
  g.traverse((mesh) => { mesh.frustumCulled = false; });
  return g;
}

// The bare weapon, for anywhere it is shown without the first-person hands: the shop, the armoury, the
// kill feed, a pilot's own hands in third person.
export function stripHands(model) {
  const arms = [];
  model.traverse((node) => { if (node.userData.arm) arms.push(node); });
  arms.forEach((arm) => arm.parent?.remove(arm));
  return model;
}
