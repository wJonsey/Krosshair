// The third-person operator: a faceted, low-poly armoured pilot. Everything is procedural.
// build → style → animate. The weapon in hand is the real first-person model, and the arms are
// solved each frame so both hands always sit on it, whatever is being carried.
// Proportions follow the hit zones in shared/combat.js (1.8 m tall, head centre 1.62 m, torso 0.9–1.4 m).
import * as THREE from 'three';
import { WEAPONS } from '../shared/constants.js';
import { applyPattern } from './skins.js';
import { buildWeapon, stripHands } from './viewmodel.js';
import { buildCharm, updateCharm } from './charms.js';

const TEAM_COLORS = { friend: '#6ce6d1', foe: '#ff4d3d' };
export { TEAM_COLORS };

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: options.rough ?? 0.6, metalness: options.metal ?? 0.1, emissive: options.emissive ?? '#000000', emissiveIntensity: options.glow ?? 0, flatShading: true });
}

// Geometry is shared by every operator in the match; only materials are per pilot.
const GEO = {};
const geo = (key, make) => (GEO[key] ||= make());
const UP = new THREE.Vector3(0, 1, 0);
function add(group, geometry, material, position = [0, 0, 0], rotation = null, scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  group.add(mesh);
  return mesh;
}
const block = (group, key, size, material, position, rotation = null) => add(group, geo(`box:${key}`, () => new THREE.BoxGeometry(...size)), material, position, rotation);
// A tapered prism hanging down from the group's origin: limbs. `sides` keeps it faceted.
function limb(group, key, length, top, bottom, material, sides = 6) {
  return add(group, geo(`limb:${key}`, () => new THREE.CylinderGeometry(top, bottom, length, sides).translate(0, -length / 2, 0)), material);
}
const gem = (group, key, radius, material, position, scale = null) => add(group, geo(`gem:${key}`, () => new THREE.IcosahedronGeometry(radius, 0)), material, position, null, scale);
// Bends a fresh geometry once, before it is cached: `move` shifts each vertex in place.
const bend = new THREE.Vector3();
function warp(geometry, move) {
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i += 1) { move(bend.fromBufferAttribute(points, i)); points.setXYZ(i, bend.x, bend.y, bend.z); }
  geometry.computeVertexNormals();
  return geometry;
}
// A torus arc thinning to `tip` of its thickness: horns. It leaves the origin heading +x and curls up.
function horn(radius, tube, arc, tip) {
  return warp(new THREE.TorusGeometry(radius, tube, 6, 10, arc), (p) => {
    const a = Math.max(0, Math.atan2(p.y, p.x)), cx = Math.cos(a) * radius, cy = Math.sin(a) * radius, k = 1 - (1 - tip) * Math.min(1, a / arc);
    p.set(cx + (p.x - cx) * k, cy + (p.y - cy) * k, p.z * k);
  }).translate(-radius, 0, 0).rotateZ(-Math.PI / 2);
}
// A flat outline from [x, y] points, extruded and centred on z: stars, chevrons.
const outline = (points, depth) => new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
// The full face masks share one shell, an ellipsoid with these radii about the head centre. onMask sits a
// part on its front facing out: `lift` moves it off the surface, `roll` turns it about the surface normal.
const MASK = [0.133, 0.157, 0.147], FRONT = new THREE.Vector3(0, 0, -1), facing = new THREE.Vector3();
function onMask(mesh, x, y, lift = 0, roll = 0) {
  const [a, b, c] = MASK;
  const z = -c * Math.sqrt(Math.max(0.05, 1 - (x / a) ** 2 - (y / b) ** 2));
  facing.set(x / (a * a), y / (b * b), z / (c * c)).normalize();
  mesh.position.set(x, y, z).addScaledVector(facing, lift);
  mesh.quaternion.setFromUnitVectors(FRONT, facing);
  if (roll) mesh.rotateZ(roll);
  return mesh;
}

// ------------------------------------------------------------------ arms
const UPPER = 0.29, FORE = 0.29;
const SHOULDER = 0.215, SHOULDER_Y = -0.015;
// Shoulders as the aim group sees them once the chest is turned by `blade` (support shoulder forward).
const shoulderAt = (side, blade, out) => out.set(side * SHOULDER * Math.cos(blade), SHOULDER_Y, side * SHOULDER * Math.sin(blade));
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
function place(part, from, to) {
  part.position.copy(from);
  part.quaternion.setFromUnitVectors(UP, v4.copy(from).sub(to).normalize());
}
// Two-bone reach from shoulder to hand. `pole` says which way the elbow points.
function solveArm(arm, shoulder, hand, pole) {
  const dir = v1.copy(hand).sub(shoulder);
  const d = Math.min(UPPER + FORE - 0.004, Math.max(0.08, dir.length()));
  dir.normalize();
  const a = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const perp = v2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = v3.copy(shoulder).addScaledVector(dir, a).addScaledVector(perp, h);
  const wrist = v2.copy(shoulder).addScaledVector(dir, d);
  place(arm.upper, shoulder, elbow);
  place(arm.fore, elbow, wrist);
  arm.pad.position.copy(elbow);
  arm.hand.position.copy(wrist);
  arm.hand.quaternion.copy(arm.fore.quaternion);
}

// How each kind of weapon is carried, in the aim group's space (origin between the shoulders, −z forward).
// gun: where the pistol grip sits. support: the off hand, relative to the grip. blade: how far the chest turns.
const HOLDS = {
  long: { gun: [0.07, -0.045, -0.25], rot: [0, 0, 0], support: [0.0, 0.03, -0.31], blade: 0.62 },
  short: { gun: [0.065, -0.055, -0.28], rot: [0, 0, 0], support: [0.0, 0.025, -0.2], blade: 0.5 },
  pistol: { gun: [0.02, 0.015, -0.5], rot: [0, 0, 0], support: [-0.035, -0.035, 0.012], blade: 0.12 },
  melee: { gun: [0.19, -0.2, -0.38], rot: [0.3, 0.3, -0.25], support: null, blade: -0.3, grip: [0, 0, 0.02] },
};
const REST = { right: [0.27, -0.5, -0.04], left: [-0.17, -0.27, -0.3] };
const GUN_SCALE = 0.82;
const GRIP = [0, -0.085 * GUN_SCALE, 0.01];
function holdOf(weapon) {
  if (weapon.melee) return HOLDS.melee;
  if (weapon.slot === 'sidearm') return weapon.family === 'shotgun' ? HOLDS.short : HOLDS.pistol;
  return weapon.family === 'smg' ? HOLDS.short : HOLDS.long;
}

export function buildOperator(color = '#ec6a9e', accent = '#6ce6d1') {
  const root = new THREE.Group();
  const suit = mat(color, { rough: 0.55 });
  const dark = mat('#20262d', { rough: 0.9 });
  const gear = mat('#38424c', { rough: 0.6, metal: 0.2 });
  const plate = mat('#5d6a76', { rough: 0.45, metal: 0.3 });
  const skin = mat('#c99a7c', { rough: 0.85 });
  const visorMat = mat(accent, { emissive: accent, glow: 1.4, rough: 0.15, metal: 0.4 });
  const teamMat = mat('#ffffff', { emissive: '#ffffff', glow: 1.8 });
  const gold = mat('#e2b646', { rough: 0.25, metal: 0.6, emissive: '#6b4a08', glow: 0.6 });
  // Cosmetic materials. The opaque ones join `materials` below so a decoy fades them too.
  const yellow = mat('#f2c21a', { rough: 0.4, metal: 0.15 }), felt = mat('#6b4629', { rough: 0.95 }), silk = mat('#141418', { rough: 0.3, metal: 0.2 });
  const iron = mat('#5b6168', { rough: 0.45, metal: 0.55 }), bone = mat('#e6d9bb', { rough: 0.6 }), lacquer = mat('#1c1418', { rough: 0.25, metal: 0.25 });
  const white = mat('#eeebe2', { rough: 0.5 }), red = mat('#c01c24', { rough: 0.5 }), leather = mat('#6b4526', { rough: 0.85 }), hide = mat('#2e231c', { rough: 0.8 });
  const lens = mat('#0d1318', { rough: 0.08, metal: 0.8 }), steel = mat('#d3dae0', { rough: 0.22, metal: 0.5 }), shieldMat = mat('#3a434d', { rough: 0.45, metal: 0.3 });
  // Item Shop materials. All opaque, so they fade with the rest when a decoy goes see-through.
  const knit = mat('#141619', { rough: 0.95, metal: 0 }), hiVis = mat('#ff7a1f', { rough: 0.7, metal: 0.05 });
  const rime = mat('#dcf3ff', { rough: 0.6, metal: 0.1 }), canvas = mat('#3a382f', { rough: 0.95, metal: 0 });
  const starMat = mat('#fff1a6', { emissive: '#ffd84a', glow: 2.2 }), haloMat = mat('#00ffc6', { emissive: '#00ffc6', glow: 2.6 }), pixelMat = mat('#00ffc6', { emissive: '#00ffc6', glow: 2.4 });
  const mirror = new THREE.MeshStandardMaterial({ color: '#06080b', roughness: 0.12, metalness: 0.85 });
  // The scanner visor and the orbit pack keep their own mint so they never fight the halo for one glow value.
  const scanGlass = mat('#080d12', { rough: 0.14, metal: 0.7 }), scanMat = mat('#00ffc6', { emissive: '#00ffc6', glow: 2.6 }), orbitMat = mat('#00ffc6', { emissive: '#00ffc6', glow: 2.4 });
  lacquer.side = THREE.DoubleSide;
  scanGlass.side = THREE.DoubleSide;
  // See-through ones stay out of that list: glass, and the additive light of the dev items.
  const glass = new THREE.MeshStandardMaterial({ color: '#dff1ff', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.25, depthWrite: false });
  const holo = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  // --- hips and legs ---------------------------------------------------------------------------
  const hips = new THREE.Group();
  hips.position.y = 0.96;
  root.add(hips);
  add(hips, geo('pelvis', () => new THREE.CylinderGeometry(0.175, 0.13, 0.2, 8)), dark, [0, -0.02, 0], null, [1, 1, 0.68]);
  block(hips, 'belt', [0.37, 0.06, 0.25], gear, [0, 0.085, 0]);
  block(hips, 'buckle', [0.08, 0.05, 0.02], plate, [0, 0.085, -0.13]);
  block(hips, 'pouchL', [0.07, 0.12, 0.11], gear, [-0.2, 0.0, 0.02]);
  block(hips, 'dump', [0.15, 0.12, 0.06], gear, [0.05, 0.0, 0.14]);
  block(hips, 'tasset', [0.13, 0.13, 0.025], plate, [0, -0.06, -0.115], [0.12, 0, 0]);
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1, -0.05, 0);
    limb(pivot, 'thigh', 0.44, 0.1, 0.074, dark);
    block(pivot, 'thighPlate', [0.13, 0.24, 0.03], suit, [side * 0.005, -0.19, -0.082], [-0.05, 0, 0]);
    block(pivot, 'thighSide', [0.03, 0.2, 0.12], plate, [side * 0.092, -0.17, 0], [0, 0, side * 0.06]);
    if (side > 0) { block(pivot, 'holster', [0.05, 0.17, 0.11], gear, [0.125, -0.2, 0.0]); block(pivot, 'holsterGrip', [0.035, 0.07, 0.05], dark, [0.125, -0.085, 0.03], [0.3, 0, 0]); }
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    limb(knee, 'shin', 0.4, 0.074, 0.055, dark);
    gem(knee, 'knee', 0.074, plate, [0, 0.0, -0.035], [1, 1.1, 0.8]);
    block(knee, 'shinGuard', [0.105, 0.27, 0.035], suit, [0, -0.2, -0.062], [0.045, 0, 0]);
    block(knee, 'calf', [0.09, 0.18, 0.04], gear, [0, -0.15, 0.06]);
    const foot = new THREE.Group();
    foot.position.set(0, -0.4, 0);
    block(foot, 'ankle', [0.125, 0.15, 0.17], gear, [0, 0.015, 0.0]);
    block(foot, 'toe', [0.125, 0.085, 0.15], gear, [0, -0.018, -0.15], [0.12, 0, 0]);
    block(foot, 'toeCap', [0.13, 0.05, 0.06], plate, [0, -0.025, -0.205]);
    block(foot, 'sole', [0.135, 0.035, 0.33], dark, [0, -0.06, -0.06]);
    knee.add(foot);
    pivot.add(knee);
    hips.add(pivot);
    return { pivot, knee, foot };
  });

  // --- torso: the spine bends, the chest turns to blade the body behind the weapon --------------------
  const spine = new THREE.Group();
  spine.position.y = 0.1;
  hips.add(spine);
  const chest = new THREE.Group();
  spine.add(chest);
  add(chest, geo('waist', () => new THREE.CylinderGeometry(0.155, 0.15, 0.2, 8)), dark, [0, 0.1, 0], null, [1, 1, 0.7]);
  add(chest, geo('ribs', () => new THREE.CylinderGeometry(0.245, 0.16, 0.3, 8)), suit, [0, 0.33, 0], null, [1, 1, 0.6]);
  add(chest, geo('yoke', () => new THREE.CylinderGeometry(0.12, 0.245, 0.07, 8)), suit, [0, 0.515, 0], null, [1, 1, 0.6]);
  add(chest, geo('collar', () => new THREE.CylinderGeometry(0.082, 0.105, 0.07, 8)), gear, [0, 0.53, 0.005]);
  // Armour: a two-part chest plate, abdominal plate, back plate, side panels, magazine pouches.
  block(chest, 'plateF', [0.3, 0.17, 0.05], plate, [0, 0.38, -0.142], [0.16, 0, 0]);
  block(chest, 'plateF2', [0.24, 0.1, 0.05], plate, [0, 0.255, -0.128], [-0.12, 0, 0]);
  block(chest, 'plateB', [0.31, 0.3, 0.05], plate, [0, 0.32, 0.138], [-0.05, 0, 0]);
  for (const side of [-1, 1]) block(chest, 'plateS', [0.03, 0.16, 0.17], gear, [side * 0.185, 0.24, 0]);
  for (const x of [-0.085, 0, 0.085]) block(chest, 'mag', [0.072, 0.11, 0.04], gear, [x, 0.145, -0.125], [0.05, 0, 0]);
  block(chest, 'radio', [0.05, 0.11, 0.04], dark, [-0.12, 0.4, -0.185], [0.16, 0, 0]);
  // Packs: one group per option, shown by styleOperator.
  const packs = {};
  const packGroup = (id) => { const group = new THREE.Group(); group.visible = id === 'radio'; chest.add(group); packs[id] = group; return group; };
  const radio = packGroup('radio');
  block(radio, 'pack', [0.27, 0.28, 0.12], dark, [0, 0.31, 0.225]);
  block(radio, 'packTop', [0.21, 0.07, 0.1], gear, [0, 0.48, 0.215]);
  block(radio, 'packPocket', [0.18, 0.11, 0.03], gear, [0, 0.27, 0.295]);
  const antenna = add(radio, geo('antenna', () => new THREE.CylinderGeometry(0.006, 0.009, 0.42, 5)), dark, [0.1, 0.7, 0.25], [0.12, 0, 0]);
  const rucksack = packGroup('rucksack');
  block(rucksack, 'ruck', [0.32, 0.4, 0.18], gear, [0, 0.28, 0.255]);
  block(rucksack, 'ruckFlap', [0.3, 0.1, 0.19], dark, [0, 0.46, 0.255]);
  add(rucksack, geo('ruckRoll', () => new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8)), suit, [0, 0.545, 0.25], [0, 0, Math.PI / 2]);
  const sling = packGroup('sling');
  block(sling, 'slingBag', [0.19, 0.16, 0.08], gear, [0.13, 0.17, 0.19], [0, 0, -0.3]);
  block(sling, 'slingStrap', [0.04, 0.6, 0.02], dark, [0, 0.31, -0.178], [0.05, 0, 0.75]);
  packGroup('none');
  const parachute = packGroup('parachute');
  block(parachute, 'chute', [0.33, 0.42, 0.15], mat('#4c5a3a', { rough: 0.9 }), [0, 0.28, 0.245]);
  block(parachute, 'chuteHandle', [0.08, 0.03, 0.03], suit, [0.13, 0.2, -0.165]);
  for (const x of [-0.1, 0.1]) block(parachute, 'chuteStrap', [0.035, 0.42, 0.02], dark, [x, 0.33, -0.178], [0.1, 0, 0]);
  const katana = packGroup('katana');
  add(katana, geo('sheath', () => new THREE.CylinderGeometry(0.018, 0.02, 0.78, 6)), mat('#16161a', { rough: 0.35, metal: 0.2 }), [0, 0.34, 0.19], [0, 0, 0.7]);
  add(katana, geo('hilt', () => new THREE.CylinderGeometry(0.016, 0.016, 0.22, 6)), suit, [-0.3, 0.64, 0.19], [0, 0, 0.7]);
  add(katana, geo('tsuba', () => new THREE.CylinderGeometry(0.04, 0.04, 0.012, 8)), gold, [-0.22, 0.57, 0.19], [0, 0, 0.7 + Math.PI / 2]);
  const jetpack = packGroup('jetpack');
  const metal = mat('#8a96a3', { rough: 0.3, metal: 0.6 });
  const flames = [];
  for (const side of [-1, 1]) {
    add(jetpack, geo('jetTank', () => new THREE.CylinderGeometry(0.075, 0.075, 0.36, 8)), metal, [side * 0.09, 0.3, 0.255]);
    add(jetpack, geo('jetCap', () => new THREE.ConeGeometry(0.075, 0.07, 8)), suit, [side * 0.09, 0.515, 0.255]);
    add(jetpack, geo('jetNozzle', () => new THREE.CylinderGeometry(0.04, 0.06, 0.07, 8)), dark, [side * 0.09, 0.085, 0.255]);
    flames.push(add(jetpack, geo('jetFlame', () => new THREE.ConeGeometry(0.035, 0.14, 6)), mat('#ff9a3a', { emissive: '#ff7a1a', glow: 3 }), [side * 0.09, -0.01, 0.255], [Math.PI, 0, 0]));
  }
  block(jetpack, 'jetFrame', [0.26, 0.1, 0.07], gear, [0, 0.38, 0.19]);
  const scuba = packGroup('scuba');
  block(scuba, 'scubaPlate', [0.2, 0.34, 0.03], gear, [0, 0.29, 0.18]);
  for (const side of [-1, 1]) {
    add(scuba, geo('scubaTank', () => new THREE.CylinderGeometry(0.068, 0.068, 0.36, 10)), yellow, [side * 0.076, 0.28, 0.24]);
    for (const [y, flip] of [[0.46, 0], [0.1, Math.PI]]) add(scuba, geo('scubaDome', () => new THREE.SphereGeometry(0.068, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)), yellow, [side * 0.076, y, 0.24], [flip, 0, 0]);
    for (const y of [0.19, 0.37]) add(scuba, geo('scubaBand', () => new THREE.CylinderGeometry(0.071, 0.071, 0.024, 10)), dark, [side * 0.076, y, 0.24]);
    add(scuba, geo('scubaNeck', () => new THREE.CylinderGeometry(0.018, 0.022, 0.05, 6)), dark, [side * 0.076, 0.54, 0.24]);
    add(scuba, geo('scubaKnob', () => new THREE.CylinderGeometry(0.022, 0.022, 0.014, 8)), dark, [side * 0.135, 0.565, 0.24], [0, 0, Math.PI / 2]);
  }
  block(scuba, 'scubaManifold', [0.2, 0.035, 0.04], dark, [0, 0.565, 0.24]);
  block(scuba, 'scubaReg', [0.05, 0.045, 0.05], metal, [0.03, 0.6, 0.245]);
  // The hose runs over the right shoulder to a mouthpiece on the chest.
  add(scuba, geo('scubaHose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.05, 0.605, 0.26], [0.13, 0.63, 0.19], [0.19, 0.585, 0.05], [0.195, 0.53, -0.1], [0.13, 0.46, -0.19]].map((p) => new THREE.Vector3(...p))), 20, 0.012, 5)), dark);
  block(scuba, 'scubaMouth', [0.045, 0.03, 0.03], gear, [0.125, 0.455, -0.2]);
  const quiver = packGroup('quiver');
  const slung = new THREE.Group();
  slung.position.set(0.02, 0.3, 0.225); slung.rotation.z = -0.5; quiver.add(slung);
  add(slung, geo('quiver', () => new THREE.CylinderGeometry(0.058, 0.046, 0.5, 8)), leather);
  add(slung, geo('quiverRim', () => new THREE.CylinderGeometry(0.062, 0.062, 0.035, 8)), dark, [0, 0.24, 0]);
  add(slung, geo('quiverCap', () => new THREE.CylinderGeometry(0.05, 0.04, 0.03, 8)), dark, [0, -0.255, 0]);
  [[-0.022, -0.012, 0.1, 0.08], [0.004, 0.018, -0.06, -0.05], [0.024, -0.008, -0.12, 0.02], [-0.004, -0.028, 0.14, -0.1], [-0.02, 0.02, -0.02, 0.13]].forEach(([x, z, tipX, tipZ], k) => {
    const arrow = new THREE.Group();
    arrow.position.set(x, 0.16, z); arrow.rotation.set(tipX, 0, tipZ); slung.add(arrow);
    add(arrow, geo('arrowShaft', () => new THREE.CylinderGeometry(0.0045, 0.0045, 0.3, 4).translate(0, 0.15, 0)), felt);
    add(arrow, geo('fletch', () => new THREE.ConeGeometry(0.014, 0.07, 4)), k % 2 ? bone : suit, [0, 0.25, 0], [Math.PI, 0, 0]);
    block(arrow, 'nock', [0.01, 0.012, 0.01], dark, [0, 0.3, 0]);
  });
  block(quiver, 'quiverStrap', [0.04, 0.62, 0.02], leather, [0, 0.31, -0.178], [0.05, 0, -0.75]);
  block(quiver, 'quiverBuckle', [0.035, 0.03, 0.012], gold, [0.06, 0.37, -0.19], [0.05, 0, -0.75]);
  // Riot shield: a framed ballistic panel with a viewport, the back strip becomes its stripe.
  const riot = packGroup('riot');
  block(riot, 'riotMount', [0.16, 0.18, 0.11], gear, [0, 0.32, 0.22]);
  block(riot, 'riotRim', [0.48, 0.77, 0.018], plate, [0, 0.175, 0.275]);
  block(riot, 'riotShield', [0.46, 0.75, 0.025], shieldMat, [0, 0.175, 0.285]);
  block(riot, 'riotPort', [0.2, 0.035, 0.006], visorMat, [0, 0.49, 0.2995]);
  for (const x of [-0.2, 0.2]) for (const y of [-0.17, 0.52]) gem(riot, 'riotBolt', 0.009, plate, [x, y, 0.298]);
  // War banner (sashimono): the flag hangs from a crossbar in strips so it can ripple.
  const banner = packGroup('banner');
  add(banner, geo('bannerPole', () => new THREE.CylinderGeometry(0.011, 0.014, 1.2, 6)), lacquer, [0, 0.66, 0.235]);
  add(banner, geo('bannerBar', () => new THREE.CylinderGeometry(0.008, 0.008, 0.33, 5)), lacquer, [0.165, 1.2, 0.235], [0, 0, Math.PI / 2]);
  gem(banner, 'bannerTop', 0.022, gold, [0, 1.275, 0.235]);
  block(banner, 'bannerSocket', [0.045, 0.1, 0.06], dark, [0, 0.1, 0.21]);
  block(banner, 'bannerBrace', [0.045, 0.035, 0.09], dark, [0, 0.47, 0.2]);
  const flag = [];
  for (let k = 0, hinge = banner; k < 5; k += 1) {
    const strip = new THREE.Group();
    strip.position.set(k ? 0.064 : 0.012, k ? 0 : 1.19, k ? 0 : 0.235); strip.rotation.y = k ? -0.05 : -0.08;
    add(strip, geo('flagStrip', () => new THREE.BoxGeometry(0.064, 0.56, 0.007).translate(0.032, -0.28, 0)), suit);
    hinge.add(strip); flag.push(strip); hinge = strip;
  }
  add(flag[2], geo('flagMon', () => new THREE.CylinderGeometry(0.03, 0.03, 0.013, 12)), gold, [0.032, -0.2, 0], [Math.PI / 2, 0, 0]);
  // Cape: four hinged panels from the shoulders to the knees, swung in animateCosmetics.
  const cape = packGroup('cape');
  block(cape, 'capeCollar', [0.38, 0.055, 0.1], suit, [0, 0.515, 0.135]);
  for (const side of [-1, 1]) gem(cape, 'capeClasp', 0.022, gold, [side * 0.16, 0.51, 0.19]);
  const capeParts = [];
  for (let k = 0, hinge = cape; k < 4; k += 1) {
    const part = new THREE.Group();
    part.position.set(0, k ? -0.265 : 0.5, k ? 0 : 0.18); part.rotation.x = k ? 0 : -0.08;
    add(part, geo('capePanel', () => new THREE.BoxGeometry(1, 0.275, 0.014).translate(0, -0.1375, 0)), suit, [0, 0, 0], null, [0.36 + k * 0.035, 1, 1]);
    hinge.add(part); capeParts.push(part); hinge = part;
  }
  // Greatsword across the back, hilt over the right shoulder.
  const greatsword = packGroup('greatsword');
  const sword = new THREE.Group();
  sword.position.set(0, 0.28, 0.225); sword.rotation.z = -0.5; greatsword.add(sword);
  block(sword, 'swordBlade', [0.08, 0.84, 0.012], steel, [0, -0.22, 0]);
  add(sword, geo('swordTip', () => new THREE.ConeGeometry(0.0566, 0.13, 4).rotateY(Math.PI / 4)), steel, [0, -0.705, 0], [Math.PI, 0, 0], [1, 1, 0.15]);
  block(sword, 'swordFuller', [0.014, 0.66, 0.016], dark, [0, -0.17, 0]);
  block(sword, 'swordGuard', [0.3, 0.035, 0.04], metal, [0, 0.215, 0]);
  for (const side of [-1, 1]) gem(sword, 'swordGuardEnd', 0.024, gold, [side * 0.155, 0.215, 0]);
  add(sword, geo('swordGrip', () => new THREE.CylinderGeometry(0.019, 0.021, 0.27, 6)), dark, [0, 0.365, 0]);
  for (let k = 0; k < 5; k += 1) add(sword, geo('swordWrap', () => new THREE.CylinderGeometry(0.023, 0.023, 0.016, 6)), suit, [0, 0.26 + k * 0.05, 0], [0, 0, 0.25]);
  gem(sword, 'swordPommel', 0.034, gold, [0, 0.525, 0]);
  for (const y of [-0.3, 0.05]) block(sword, 'swordStrap', [0.11, 0.03, 0.06], dark, [0, y, -0.025]);
  // Grimoire: a chained tome riding just off the back, never quite touching it.
  const grimoire = packGroup('grimoire');
  block(grimoire, 'tomeMount', [0.16, 0.1, 0.07], gear, [0, 0.43, 0.2]);
  const tome = new THREE.Group();
  tome.position.set(0, 0.34, 0.31); tome.rotation.set(0.1, 0, -0.16); grimoire.add(tome);
  for (const z of [-0.054, 0.054]) block(tome, 'tomeCover', [0.3, 0.38, 0.032], hide, [0, 0, z]);
  block(tome, 'tomePages', [0.278, 0.352, 0.076], bone, [0.01, 0, 0]);
  add(tome, geo('tomeSpine', () => new THREE.CylinderGeometry(0.048, 0.048, 0.382, 10)), hide, [-0.145, 0, 0]);
  for (const y of [-0.105, 0.105]) block(tome, 'tomeClasp', [0.05, 0.055, 0.15], gold, [0.148, y, 0]);
  for (const x of [-1, 1]) for (const y of [-1, 1]) block(tome, 'tomeCorner', [0.055, 0.055, 0.04], gold, [x * 0.12, y * 0.16, 0.058]);
  gem(tome, 'tomeSigil', 0.045, gold, [0.015, 0.015, 0.075], [1, 1, 0.4]);
  for (const y of [-0.06, 0.09]) add(tome, geo('tomeBand', () => new THREE.TorusGeometry(0.1, 0.008, 4, 16)), metal, [0.005, y, 0], [Math.PI / 2, 0, 0], [1.55, 0.85, 1]);
  for (const side of [-1, 1]) add(grimoire, geo('tomeChain', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.05, 0.47, 0.2], [0.1, 0.43, 0.26], [0.13, 0.37, 0.3]].map((p) => new THREE.Vector3(...p))), 12, 0.009, 5)), metal, [0, 0, 0], null, [side, 1, 1]);
  // Jammer: a hard case with two whips and a readout, lights on the face of it.
  const jammer = packGroup('jammer');
  block(jammer, 'jamCase', [0.3, 0.34, 0.16], gear, [0, 0.3, 0.245]);
  block(jammer, 'jamLid', [0.312, 0.05, 0.172], dark, [0, 0.49, 0.245]);
  block(jammer, 'jamFoot', [0.312, 0.035, 0.172], dark, [0, 0.125, 0.245]);
  for (const x of [-0.105, 0.105]) block(jammer, 'jamLatch', [0.05, 0.03, 0.022], plate, [x, 0.455, 0.332]);
  block(jammer, 'jamPanel', [0.17, 0.1, 0.02], dark, [0, 0.36, 0.332]);
  block(jammer, 'jamDial', [0.055, 0.055, 0.022], plate, [0.09, 0.24, 0.332]);
  for (const x of [-0.05, 0, 0.05]) gem(jammer, 'jamLed', 0.012, visorMat, [x, 0.375, 0.345]);
  const whips = [];
  for (const side of [-1, 1]) {
    block(jammer, 'jamBase', [0.05, 0.05, 0.05], dark, [side * 0.1, 0.51, 0.245]);
    whips.push(add(jammer, geo('jamWhip', () => new THREE.CylinderGeometry(0.004, 0.011, 0.55, 5).translate(0, 0.275, 0)), dark, [side * 0.1, 0.53, 0.245], [0.1, 0, -side * 0.18]));
    whips.push(gem(jammer, 'jamTip', 0.013, visorMat, [side * 0.199, 1.068, 0.299]));
  }
  // Data wings (dev): additive feather panels on two hinged bones. Flap, fold and shimmer in animateCosmetics.
  const devwings = packGroup('devwings');
  const wingMats = [0, 1, 2, 3, 4].map((k) => holo(new THREE.Color('#00ffc6').lerp(new THREE.Color('#2ad4ff'), k / 4), 0.45)), spar = holo('#7df5e0', 0.55);
  gem(devwings, 'wingCore', 0.028, haloMat, [0, 0.43, 0.2]);
  const feather = (group, k, x, y, turn, length, layer, width = 1) => add(group, geo('feather', () => new THREE.CircleGeometry(1, 4).scale(0.04, 0.13, 1).translate(0, -0.13, 0)), wingMats[k % 5], [x, y, layer], [0, 0, turn], [width, length, 1]);
  const wings = [-1, 1].map((side) => {
    // Built as the right wing; the left is its mirror image.
    const wing = new THREE.Group();
    wing.position.set(side * 0.05, 0.44, 0.215); wing.scale.x = side; wing.rotation.set(0, -side * 0.3, side * 0.1); devwings.add(wing);
    const hand = new THREE.Group();
    hand.position.set(0.25, 0.14, 0); hand.rotation.z = -0.12; wing.add(hand);
    block(wing, 'wingArm', [0.29, 0.012, 0.012], spar, [0.125, 0.07, 0], [0, 0, 0.51]);
    block(hand, 'wingHand', [0.32, 0.01, 0.01], spar, [0.16, 0, 0]);
    for (let k = 0; k < 5; k += 1) feather(wing, k, 0.03 + k * 0.05, 0.017 + k * 0.028, k * 0.06, 1.15 + k * 0.06, k * 0.004);
    for (let k = 0; k < 6; k += 1) feather(hand, k + 5, 0.02 + k * 0.055, 0, 0.3 + k * 0.2, 1.5 + k * 0.13, k * 0.004);
    for (let k = 0; k < 3; k += 1) { feather(wing, k + 1, 0.06 + k * 0.07, 0.034 + k * 0.039, 0.1, 0.6, 0.012, 0.8); feather(hand, k + 6, 0.05 + k * 0.09, 0, 0.4 + k * 0.25, 0.65, 0.012, 0.8); }
    return { wing, hand, side };
  });
  // Orbit pack (dev): a pulsing core on a small mount with pixel cubes running tilted rings around it,
  // each on its own clock (animateCosmetics). An atom built out of blocks.
  const devorbit = packGroup('devorbit');
  block(devorbit, 'devOrbitMount', [0.12, 0.13, 0.05], gear, [0, 0.34, 0.185]);
  block(devorbit, 'devOrbitStem', [0.04, 0.04, 0.04], plate, [0, 0.34, 0.215]);
  const orbitGlow = holo('#7dffe6', 0.38), orbitHaze = holo('#00ffc6', 0.15);
  const orbitCore = new THREE.Group();
  orbitCore.position.set(0, 0.34, 0.245); devorbit.add(orbitCore);
  const orbitHeart = gem(orbitCore, 'devOrbitCore', 0.028, orbitMat, [0, 0, 0]);
  gem(orbitCore, 'devOrbitBloom', 0.052, orbitHaze, [0, 0, 0]);
  const orbits = [[0.55, 0.25, 1.7], [-0.95, 0.7, -1.15], [0.35, -1.15, 2.3], [1.35, 0.95, -0.8]].map(([tiltX, tiltZ, rate], k) => {
    const ring = new THREE.Group();
    ring.rotation.set(tiltX, 0, tiltZ); orbitCore.add(ring);
    add(ring, geo('devOrbitPath', () => new THREE.TorusGeometry(0.082, 0.0025, 4, 28)), orbitGlow, [0, 0, 0], [Math.PI / 2, 0, 0]);
    const spin = new THREE.Group();
    spin.rotation.y = k * 1.6; ring.add(spin);
    const bit = block(spin, 'devOrbitBit', [0.022, 0.022, 0.022], orbitMat, [0.082, 0, 0]);
    return { spin, bit, rate };
  });
  // Team strips: chest, back and both shoulders, so a side is readable from any angle.
  block(chest, 'stripF', [0.18, 0.03, 0.012], teamMat, [0, 0.43, -0.176], [0.16, 0, 0]);
  block(chest, 'stripB', [0.22, 0.04, 0.015], teamMat, [0, 0.43, 0.3]);
  for (const side of [-1, 1]) {
    const pad = new THREE.Group();
    pad.position.set(side * 0.245, 0.455, 0); pad.rotation.z = -side * 0.42;
    add(pad, geo('pauldron', () => new THREE.CylinderGeometry(0.062, 0.118, 0.11, 6)), suit, [0, 0, 0], null, [1, 1, 1.12]);
    block(pad, 'pauldronRim', [0.17, 0.022, 0.2], plate, [0, -0.06, 0]);
    block(pad, 'stripS', [0.1, 0.02, 0.02], teamMat, [0, -0.06, -0.105]);
    block(pad, 'stripS', [0.1, 0.02, 0.02], teamMat, [0, -0.06, 0.105]);
    chest.add(pad);
  }

  // --- head: centre at 1.62 m ---------------------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 0.56;
  add(head, geo('neck', () => new THREE.CylinderGeometry(0.052, 0.062, 0.12, 6)), dark, [0, -0.09, 0.008]);
  const face = add(head, geo('face', () => new THREE.IcosahedronGeometry(0.128, 1)), skin, [0, 0, 0], null, [0.92, 1.08, 1]);
  add(head, geo('balaclava', () => new THREE.SphereGeometry(0.133, 10, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48)), dark, [0, 0, 0], null, [0.95, 1.08, 1.02]);
  const jaw = block(head, 'jaw', [0.12, 0.05, 0.06], dark, [0, -0.095, -0.075], [0.35, 0, 0]);
  void face;
  // Headgear and face options: one group each, only the chosen one visible. The team lights stay on
  // every option so a side is always readable.
  const headgear = {}, faces = {};
  const option = (map, id, visible) => { const group = new THREE.Group(); group.visible = visible; head.add(group); map[id] = group; return group; };
  const shell = (group, material = gear) => add(group, geo('helmet', () => new THREE.SphereGeometry(0.168, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.56)), material, [0, 0.025, 0], null, [1, 0.98, 1.1]);
  const lid = option(headgear, 'helmet', true);
  shell(lid);
  block(lid, 'crest', [0.045, 0.03, 0.27], suit, [0, 0.183, 0.005]);
  block(lid, 'brim', [0.2, 0.03, 0.07], gear, [0, 0.082, -0.168], [0.3, 0, 0]);
  block(lid, 'nape', [0.2, 0.09, 0.03], gear, [0, -0.03, 0.17], [-0.25, 0, 0]);
  for (const side of [-1, 1]) { block(lid, 'cheek', [0.03, 0.11, 0.13], gear, [side * 0.152, -0.015, 0.015]); block(lid, 'rail', [0.014, 0.025, 0.11], plate, [side * 0.17, 0.06, 0.0]); }
  block(lid, 'nvgMount', [0.05, 0.045, 0.035], plate, [0, 0.135, -0.168]);
  const cap = option(headgear, 'cap', false);
  add(cap, geo('capDome', () => new THREE.SphereGeometry(0.142, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.5)), suit, [0, 0.035, 0], null, [1, 0.85, 1.05]);
  block(cap, 'capPeak', [0.2, 0.014, 0.12], dark, [0, 0.04, -0.175], [0.12, 0, 0]);
  const beanie = option(headgear, 'beanie', false);
  add(beanie, geo('beanie', () => new THREE.SphereGeometry(0.146, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)), dark, [0, 0.04, 0], null, [1, 1.12, 1.06]);
  add(beanie, geo('beanieFold', () => new THREE.CylinderGeometry(0.152, 0.152, 0.05, 10, 1, true)), suit, [0, 0.04, 0]);
  const hairMat = mat('#2a1f18', { rough: 0.95 });
  const hairOn = (group, fringe = true) => { add(group, geo('hair', () => new THREE.SphereGeometry(0.134, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.45)), hairMat, [0, 0.02, 0], null, [0.95, 1.05, 1.03]); if (fringe) block(group, 'fringe', [0.17, 0.035, 0.05], hairMat, [0, 0.09, -0.105], [0.5, 0, 0]); };
  hairOn(option(headgear, 'bare', false));
  const hood = option(headgear, 'hood', false);
  add(hood, geo('hood', () => new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.72)), suit, [0, 0.01, 0.02], null, [1.02, 1.05, 1.12]);
  block(hood, 'hoodPeak', [0.12, 0.03, 0.06], suit, [0, 0.15, -0.15], [0.5, 0, 0]);
  const beret = option(headgear, 'beret', false);
  add(beret, geo('beret', () => new THREE.SphereGeometry(0.15, 10, 6)), suit, [0.03, 0.105, 0], [0, 0, -0.28], [1.12, 0.32, 1.1]);
  block(beret, 'beretBadge', [0.03, 0.035, 0.01], plate, [-0.05, 0.1, -0.14]);
  const boonie = option(headgear, 'boonie', false);
  add(boonie, geo('boonieCrown', () => new THREE.CylinderGeometry(0.12, 0.145, 0.1, 10)), suit, [0, 0.11, 0]);
  add(boonie, geo('boonieBrim', () => new THREE.CylinderGeometry(0.235, 0.235, 0.012, 12)), suit, [0, 0.065, 0], [0.05, 0, 0]);
  const bandana = option(headgear, 'bandana', false);
  add(bandana, geo('bandana', () => new THREE.SphereGeometry(0.138, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.42)), suit, [0, 0.03, 0], null, [0.98, 1.05, 1.04]);
  block(bandana, 'bandanaKnot', [0.05, 0.04, 0.05], suit, [0, 0.03, 0.145]);
  block(bandana, 'bandanaTail', [0.03, 0.09, 0.012], suit, [0.02, -0.02, 0.16], [0.2, 0, 0.2]);
  const headset = option(headgear, 'headset', false);
  hairOn(headset);
  add(headset, geo('headband', () => new THREE.TorusGeometry(0.15, 0.012, 5, 12, Math.PI)), dark, [0, 0.01, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) add(headset, geo('earCup', () => new THREE.CylinderGeometry(0.052, 0.052, 0.04, 8)), gear, [side * 0.155, 0.0, 0.01], [0, 0, Math.PI / 2]);
  block(headset, 'boom', [0.012, 0.012, 0.12], dark, [0.13, -0.05, -0.08], [0, 0.5, 0]);
  const nvg = option(headgear, 'nvg', false);
  shell(nvg);
  block(nvg, 'nvgArm', [0.05, 0.07, 0.05], plate, [0, 0.1, -0.17], [0.4, 0, 0]);
  const nvgGlow = mat('#39ff88', { emissive: '#39ff88', glow: 2.2 });
  for (const side of [-1, 1]) { add(nvg, geo('nvgTube', () => new THREE.CylinderGeometry(0.022, 0.026, 0.08, 8)), dark, [side * 0.03, 0.06, -0.2], [Math.PI / 2, 0, 0]); add(nvg, geo('nvgLens', () => new THREE.CircleGeometry(0.02, 8)), nvgGlow, [side * 0.03, 0.06, -0.241], [0, Math.PI, 0]); }
  const crown = option(headgear, 'crown', false);
  hairOn(crown);
  add(crown, geo('crownBand', () => new THREE.CylinderGeometry(0.13, 0.125, 0.06, 12, 1, true)), gold, [0, 0.13, 0]).material.side = THREE.DoubleSide;
  const ruby = mat('#ff2a4a', { emissive: '#ff2a4a', glow: 1.5 });
  for (let k = 0; k < 6; k += 1) { const a = (k / 6) * Math.PI * 2; add(crown, geo('crownSpike', () => new THREE.ConeGeometry(0.022, 0.07, 4)), gold, [Math.cos(a) * 0.125, 0.19, Math.sin(a) * 0.125]); gem(crown, 'crownGem', 0.013, k % 2 ? ruby : visorMat, [Math.cos(a) * 0.132, 0.13, Math.sin(a) * 0.132]); }
  // Hard hat. The bracket turns the helmet light into its lamp.
  const hardhat = option(headgear, 'hardhat', false);
  hairOn(hardhat, false);
  add(hardhat, geo('hardDome', () => new THREE.SphereGeometry(0.162, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)), yellow, [0, 0.03, 0], null, [1, 1, 1.1]);
  add(hardhat, geo('hardRim', () => new THREE.CylinderGeometry(0.174, 0.178, 0.014, 12)), yellow, [0, 0.032, 0], null, [1, 1, 1.1]);
  add(hardhat, geo('hardRidge', () => new THREE.TorusGeometry(0.162, 0.016, 4, 12, Math.PI)), yellow, [0, 0.03, 0], [0, Math.PI / 2, 0], [1.1, 1, 1]);
  block(hardhat, 'hardPeak', [0.2, 0.014, 0.075], yellow, [0, 0.035, -0.215], [-0.1, 0, 0]);
  block(hardhat, 'hardLamp', [0.03, 0.03, 0.04], dark, [0, 0.105, -0.16]);
  // Cowboy hat: the crown is creased down the middle and pinched at the front; the brim curls up at the sides.
  const cowboy = option(headgear, 'cowboy', false);
  hairOn(cowboy);
  add(cowboy, geo('cowboyCrown', () => warp(new THREE.CylinderGeometry(0.106, 0.135, 0.13, 12), (p) => { if (p.y > 0) { p.y -= 0.032 * Math.max(0, 1 - Math.abs(p.x) / 0.06); p.x *= 1 - Math.max(0, -p.z) * 2.4; } })), felt, [0, 0.14, 0], null, [0.95, 1, 1.12]);
  add(cowboy, geo('cowboyBrim', () => warp(new THREE.CylinderGeometry(0.25, 0.25, 0.012, 20), (p) => { p.z *= 1.12; const s = Math.max(0, Math.abs(p.x) - 0.1); p.y += s * s * 2.6 - p.z * p.z * 0.25; })), felt, [0, 0.078, 0]);
  add(cowboy, geo('cowboyBand', () => new THREE.CylinderGeometry(0.133, 0.136, 0.026, 12, 1, true)), dark, [0, 0.092, 0], null, [0.95, 1, 1.12]);
  gem(cowboy, 'concho', 0.013, gold, [0.13, 0.092, -0.03]);
  // Mohawk: short sides and a crest of fins in the suit colour, front to back.
  const mohawk = option(headgear, 'mohawk', false);
  hairOn(mohawk);
  [0.7, 0.95, 1.15, 1.2, 1.1, 0.9, 0.7].forEach((height, k) => { const a = -0.9 + k / 3; add(mohawk, geo('spike', () => new THREE.ConeGeometry(0.03, 0.13, 4).translate(0, 0.065, 0)), suit, [0, 0.02 + Math.cos(a) * 0.13, Math.sin(a) * 0.128], [a + 0.12, 0, 0], [0.4, height, 1.4]); });
  // Top hat, worn at an angle.
  const tophat = option(headgear, 'tophat', false);
  hairOn(tophat);
  const topper = new THREE.Group();
  topper.position.set(0.01, 0.082, 0); topper.rotation.set(0.05, 0, -0.13); tophat.add(topper);
  add(topper, geo('topCrown', () => new THREE.CylinderGeometry(0.126, 0.116, 0.21, 12)), silk, [0, 0.11, 0], null, [1, 1, 1.1]);
  add(topper, geo('topBand', () => new THREE.CylinderGeometry(0.119, 0.118, 0.036, 12, 1, true)), suit, [0, 0.026, 0], null, [1, 1, 1.1]);
  add(topper, geo('topBrim', () => warp(new THREE.CylinderGeometry(0.19, 0.19, 0.01, 16), (p) => { const s = Math.max(0, Math.abs(p.x) - 0.12); p.y += s * s * 4; })), silk, [0, 0.004, 0], null, [1, 1, 1.12]);
  // Viking helm: iron dome, banded, with a nose guard and horns.
  const viking = option(headgear, 'viking', false);
  add(viking, geo('vikingDome', () => new THREE.SphereGeometry(0.156, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)), iron, [0, 0.045, 0], null, [1, 1.05, 1.08]);
  add(viking, geo('vikingBrow', () => new THREE.CylinderGeometry(0.159, 0.159, 0.03, 12, 1, true)), metal, [0, 0.058, 0], null, [1, 1, 1.08]);
  const vikingBand = () => geo('vikingBand', () => new THREE.TorusGeometry(0.157, 0.01, 4, 12, Math.PI));
  add(viking, vikingBand(), metal, [0, 0.045, 0], null, [1, 1.05, 1.08]);
  add(viking, vikingBand(), metal, [0, 0.045, 0], [0, Math.PI / 2, 0], [1.08, 1.05, 1]);
  gem(viking, 'vikingKnob', 0.02, metal, [0, 0.21, 0]);
  block(viking, 'vikingNose', [0.028, 0.09, 0.014], metal, [0, 0.012, -0.163], [-0.2, 0, 0]);
  for (const side of [-1, 1]) {
    add(viking, geo('vikingHorn', () => horn(0.1, 0.028, 2.0, 0.12).rotateX(-0.3)), bone, [side * 0.148, 0.1, 0.005], null, [side, 1, 1]);
    add(viking, geo('vikingCuff', () => new THREE.CylinderGeometry(0.033, 0.033, 0.02, 8)), metal, [side * 0.152, 0.1, 0.005], [0, 0, Math.PI / 2]);
  }
  // Wizard hat: a floppy cone in three jointed pieces, the tip bent over, stars on the crown.
  const wizard = option(headgear, 'wizard', false);
  hairOn(wizard);
  add(wizard, geo('wizBrim', () => warp(new THREE.CylinderGeometry(0.26, 0.26, 0.012, 20), (p) => { const s = Math.max(0, Math.hypot(p.x, p.z) - 0.14); p.y -= s * s * 1.6 + Math.sin(Math.atan2(p.z, p.x) * 3) * s * 0.25; })), suit, [0, 0.08, 0]);
  const cone = new THREE.Group();
  cone.position.y = 0.085; wizard.add(cone);
  add(cone, geo('wizCone', () => new THREE.CylinderGeometry(0.085, 0.138, 0.17, 12).translate(0, 0.085, 0)), suit);
  add(cone, geo('wizBand', () => new THREE.CylinderGeometry(0.135, 0.137, 0.025, 12, 1, true)), dark, [0, 0.016, 0]);
  const wizMid = new THREE.Group();
  wizMid.position.y = 0.17; wizMid.rotation.set(0.28, 0, 0.1); cone.add(wizMid);
  add(wizMid, geo('wizKnee', () => new THREE.SphereGeometry(0.084, 12, 6)), suit);
  add(wizMid, geo('wizCone2', () => new THREE.CylinderGeometry(0.046, 0.085, 0.13, 12).translate(0, 0.065, 0)), suit);
  const wizTop = new THREE.Group();
  wizTop.position.y = 0.13; wizTop.rotation.set(0.9, 0, 0.2); wizMid.add(wizTop);
  add(wizTop, geo('wizKnee2', () => new THREE.SphereGeometry(0.045, 10, 5)), suit);
  add(wizTop, geo('wizTip', () => new THREE.ConeGeometry(0.046, 0.12, 12).translate(0, 0.06, 0)), suit);
  const starGeo = () => geo('star', () => outline([...Array(10)].map((_, k) => { const r = k % 2 ? 0.42 : 1, a = Math.PI / 2 + (k * Math.PI) / 5; return [Math.cos(a) * r, Math.sin(a) * r]; }), 0.25).scale(0.02, 0.02, 0.02));
  for (const [a, y, roll, size] of [[0.35, 0.05, 0.2, 1], [-0.9, 0.11, -0.3, 0.8], [2.2, 0.07, 0.5, 0.9], [3.6, 0.12, 0.1, 0.75], [-2.4, 0.04, -0.4, 1]]) {
    const r = 0.138 - (0.053 * y) / 0.17 + 0.002;
    add(cone, starGeo(), starMat, [Math.sin(a) * r, y, -Math.cos(a) * r], [0, -a, roll], [size, size, 1]);
  }
  add(wizMid, starGeo(), starMat, [Math.sin(0.5) * 0.073, 0.05, -Math.cos(0.5) * 0.073], [0, -0.5, 0.3], [0.7, 0.7, 1]);
  // Kabuto: lacquered bowl, layered neck guard (shikoro) with gold edges, turned-back flaps (fukigaeshi)
  // and a gold crescent crest (maedate) round a red sun.
  const kabuto = option(headgear, 'kabuto', false);
  add(kabuto, geo('kabutoBowl', () => new THREE.SphereGeometry(0.168, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)), lacquer, [0, 0.03, 0], null, [1, 0.95, 1.08]);
  add(kabuto, geo('kabutoTehen', () => new THREE.TorusGeometry(0.022, 0.007, 4, 10)), gold, [0, 0.19, 0], [Math.PI / 2, 0, 0]);
  block(kabuto, 'kabutoPeak', [0.22, 0.012, 0.07], lacquer, [0, 0.042, -0.19], [0.3, 0, 0]);
  block(kabuto, 'kabutoPeakEdge', [0.22, 0.01, 0.01], gold, [0, 0.052, -0.224]);
  for (let k = 0; k < 4; k += 1) {
    const r = 0.17 + k * 0.013, y = 0.016 - k * 0.025;
    add(kabuto, geo(`shikoro${k}`, () => new THREE.CylinderGeometry(r, r + 0.02, 0.03, 12, 1, true, -1.95, 3.9)), lacquer, [0, y, 0], null, [1, 1, 1.08]);
    add(kabuto, geo(`shikoroEdge${k}`, () => new THREE.CylinderGeometry(r + 0.021, r + 0.022, 0.007, 12, 1, true, -1.95, 3.9)), gold, [0, y - 0.016, 0], null, [1, 1, 1.08]);
  }
  for (const side of [-1, 1]) {
    block(kabuto, 'fukigaeshi', [0.012, 0.06, 0.09], lacquer, [side * 0.205, 0.004, -0.05], [0, side * 0.93, 0]);
    block(kabuto, 'fukiTrim', [0.008, 0.07, 0.1], gold, [side * 0.205 - side * 0.0036, 0.004, -0.05 + 0.0048], [0, side * 0.93, 0]);
    add(kabuto, geo('kabutoMon', () => new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10)), gold, [side * 0.205 + side * 0.0048, 0.004, -0.05 - 0.0064], [0, side * 0.93, Math.PI / 2]);
  }
  add(kabuto, geo('kabutoCrest', () => warp(new THREE.TorusGeometry(0.1, 0.013, 4, 18, 3), (p) => { const a = Math.atan2(p.y, p.x), cx = Math.cos(a) * 0.1, cy = Math.sin(a) * 0.1, k = 1 - (0.8 * Math.abs(a - 1.5)) / 1.5; p.set(cx + (p.x - cx) * k, cy + (p.y - cy) * k, p.z * k); }).rotateZ(Math.PI * 1.5 - 1.5).translate(0, 0.1, 0)), gold, [0, 0.128, -0.152], [0.3, 0, 0], [1.1, 1.3, 0.4]);
  block(kabuto, 'kabutoMount', [0.036, 0.04, 0.012], gold, [0, 0.12, -0.15], [0.3, 0, 0]);
  add(kabuto, geo('kabutoSun', () => new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12)), ruby, [0, 0.168, -0.14], [Math.PI / 2 + 0.3, 0, 0]);
  // Space helmet: a glass bubble on a metal neck ring, with a blinking aerial.
  const bubble = option(headgear, 'bubble', false);
  hairOn(bubble);
  const bubbleGlass = add(bubble, geo('bubble', () => new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.64)), glass, [0, 0.05, 0]);
  add(bubble, geo('bubbleRing', () => new THREE.TorusGeometry(0.183, 0.02, 6, 20)), metal, [0, -0.035, 0], [Math.PI / 2, 0, 0]);
  add(bubble, geo('bubbleSeal', () => new THREE.CylinderGeometry(0.19, 0.2, 0.03, 20, 1, true)), gear, [0, -0.06, 0]);
  for (const side of [-1, 1]) block(bubble, 'bubbleLatch', [0.03, 0.022, 0.014], visorMat, [side * 0.09, -0.035, -0.176], [0, -side * 0.5, 0]);
  block(bubble, 'bubbleMount', [0.03, 0.03, 0.03], gear, [-0.19, -0.02, 0.07]);
  add(bubble, geo('bubbleAerial', () => new THREE.CylinderGeometry(0.004, 0.006, 0.17, 5).translate(0, 0.085, 0)), dark, [-0.19, -0.01, 0.07], [0, 0, 0.16]);
  const beacon = gem(bubble, 'beacon', 0.013, ruby, [-0.217, 0.158, 0.07]);
  // Balaclava: knit pulled down over the whole head, one slit left open for the eyes.
  const balaclava = option(headgear, 'balaclava', false);
  add(balaclava, geo('balaHood', () => new THREE.SphereGeometry(0.139, 12, 7)), knit, [0, 0.004, 0], null, [0.97, 1.06, 1.02]);
  add(balaclava, geo('balaNeck', () => new THREE.CylinderGeometry(0.068, 0.082, 0.1, 10)), knit, [0, -0.105, 0.006]);
  add(balaclava, geo('balaSlit', () => new THREE.CylinderGeometry(0.138, 0.134, 0.046, 14, 1, true, Math.PI - 0.95, 1.9)), lens, [0, 0.032, 0], null, [1, 1, 1.04]).material.side = THREE.DoubleSide;
  const balaLip = () => geo('balaLip', () => new THREE.CylinderGeometry(0.141, 0.141, 0.013, 14, 1, true, Math.PI - 1.05, 2.1));
  for (const y of [0.061, 0.003]) add(balaclava, balaLip(), knit, [0, y, 0], null, [1, 1, 1.04]).material.side = THREE.DoubleSide;
  block(balaclava, 'balaSeam', [0.014, 0.012, 0.13], knit, [0, 0.126, 0.012]);
  // Welding mask: a flipped-down front on a head cradle, one dark window in it.
  const weldmask = option(headgear, 'weldmask', false);
  add(weldmask, geo('weldCradle', () => new THREE.SphereGeometry(0.152, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.45)), gear, [0, 0.045, 0], null, [1, 0.92, 1.06]);
  add(weldmask, geo('weldBand', () => new THREE.CylinderGeometry(0.15, 0.15, 0.046, 12, 1, true)), dark, [0, 0.055, 0]).material.side = THREE.DoubleSide;
  const weldFront = new THREE.Group();
  weldFront.position.set(0, 0.05, 0); weldFront.rotation.x = -0.07; weldmask.add(weldFront);
  add(weldFront, geo('weldShell', () => new THREE.CylinderGeometry(0.153, 0.134, 0.22, 10, 1, true, Math.PI - 1.4, 2.8)), shieldMat, [0, -0.055, 0], null, [1, 1, 1.05]).material.side = THREE.DoubleSide;
  block(weldFront, 'weldChin', [0.175, 0.055, 0.075], shieldMat, [0, -0.175, -0.075], [0.6, 0, 0]);
  block(weldFront, 'weldRim', [0.17, 0.068, 0.014], iron, [0, -0.012, -0.136]);
  block(weldFront, 'weldWindow', [0.152, 0.05, 0.012], lens, [0, -0.012, -0.143]);
  for (const side of [-1, 1]) { block(weldFront, 'weldRib', [0.016, 0.17, 0.014], shieldMat, [side * 0.088, -0.07, -0.118], [0, -side * 0.55, 0]); gem(weldmask, 'weldHinge', 0.019, iron, [side * 0.152, 0.048, -0.012]); }
  // Hi-vis hard hat, reflective tape round the shell and over the ridge.
  const hivis = option(headgear, 'hivis', false);
  hairOn(hivis, false);
  add(hivis, geo('hardDome', () => new THREE.SphereGeometry(0.162, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)), hiVis, [0, 0.03, 0], null, [1, 1, 1.1]);
  add(hivis, geo('hardRim', () => new THREE.CylinderGeometry(0.174, 0.178, 0.014, 12)), hiVis, [0, 0.032, 0], null, [1, 1, 1.1]);
  add(hivis, geo('hardRidge', () => new THREE.TorusGeometry(0.162, 0.016, 4, 12, Math.PI)), hiVis, [0, 0.03, 0], [0, Math.PI / 2, 0], [1.1, 1, 1]);
  block(hivis, 'hardPeak', [0.2, 0.014, 0.075], hiVis, [0, 0.035, -0.215], [-0.1, 0, 0]);
  add(hivis, geo('hiVisTape', () => new THREE.CylinderGeometry(0.166, 0.17, 0.03, 12)), steel, [0, 0.072, 0], null, [1, 1, 1.1]);
  add(hivis, geo('hiVisRidgeTape', () => new THREE.TorusGeometry(0.165, 0.008, 4, 12, Math.PI)), steel, [0, 0.03, 0], [0, Math.PI / 2, 0], [1.1, 1, 1]);
  for (const side of [-1, 1]) block(hivis, 'hiVisStrap', [0.011, 0.15, 0.011], dark, [side * 0.132, -0.04, -0.012], [0, 0, side * 0.08]);
  block(hivis, 'hiVisChin', [0.27, 0.011, 0.011], dark, [0, -0.112, -0.032]);
  // Racing helmet: one shell, a chin bar, and a tinted strip across the eyes.
  const racehelm = option(headgear, 'racehelm', false);
  add(racehelm, geo('raceShell', () => new THREE.SphereGeometry(0.171, 14, 8)), suit, [0, 0.018, 0], null, [1, 1.01, 1.07]);
  block(racehelm, 'raceChinBar', [0.2, 0.062, 0.085], suit, [0, -0.085, -0.145], [0.25, 0, 0]);
  add(racehelm, geo('raceVisor', () => new THREE.CylinderGeometry(0.169, 0.164, 0.062, 14, 1, true, Math.PI - 1.15, 2.3)), lens, [0, 0.03, 0], null, [1, 1, 1.05]).material.side = THREE.DoubleSide;
  const raceTrim = () => geo('raceTrim', () => new THREE.CylinderGeometry(0.172, 0.172, 0.012, 14, 1, true, Math.PI - 1.22, 2.44));
  for (const y of [0.067, -0.006]) add(racehelm, raceTrim(), white, [0, y, 0], null, [1, 1, 1.05]).material.side = THREE.DoubleSide;
  add(racehelm, geo('raceCrest', () => new THREE.TorusGeometry(0.172, 0.011, 4, 16, Math.PI)), white, [0, 0.018, 0], [0, Math.PI / 2, 0], [1.07, 1.01, 1]);
  for (const side of [-1, 1]) block(racehelm, 'raceVent', [0.032, 0.022, 0.05], dark, [side * 0.05, 0.133, -0.132], [0.5, 0, 0]);
  block(racehelm, 'raceIntake', [0.08, 0.026, 0.03], dark, [0, -0.086, -0.192], [0.25, 0, 0]);
  block(racehelm, 'raceSpoiler', [0.13, 0.022, 0.06], plate, [0, 0.055, 0.183], [-0.35, 0, 0]);
  // Dev halo: a ring of light over the head with pixels in orbit. Spins, bobs and pulses in animateCosmetics.
  const devhalo = option(headgear, 'devhalo', false);
  hairOn(devhalo);
  const haloGlow = holo('#7dffe6', 0.45), haloHaze = holo('#00ffc6', 0.16);
  const halo = new THREE.Group(), haloSpin = new THREE.Group(), haloOrbit = new THREE.Group();
  halo.position.y = 0.25; halo.add(haloSpin, haloOrbit); devhalo.add(halo);
  add(haloSpin, geo('haloRing', () => new THREE.TorusGeometry(0.125, 0.011, 6, 40)), haloMat, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2; block(haloSpin, 'haloNode', [0.022, 0.022, 0.022], haloMat, [Math.cos(a) * 0.125, 0, Math.sin(a) * 0.125], [0.6, a, 0.6]); }
  add(halo, geo('haloInner', () => new THREE.TorusGeometry(0.094, 0.004, 4, 32)), haloGlow, [0, 0, 0], [Math.PI / 2, 0, 0]);
  add(halo, geo('haloDisc', () => new THREE.RingGeometry(0.095, 0.165, 40)), haloHaze, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  add(halo, geo('haloBloom', () => new THREE.TorusGeometry(0.125, 0.032, 8, 40)), haloHaze, [0, 0, 0], [Math.PI / 2, 0, 0]);
  const haloBits = [0, 1, 2, 3, 4, 5].map((k) => block(haloOrbit, 'haloBit', [0.013, 0.013, 0.013], haloMat, [Math.cos((k * Math.PI) / 3) * 0.168, 0, Math.sin((k * Math.PI) / 3) * 0.168]));
  // Root crown (dev): shards of light in a ring over the head, nothing holding them up, a disc of haze under
  // them. The front ones are longer and glow harder. Drifts, turns and breathes in animateCosmetics.
  const devcrown = option(headgear, 'devcrown', false);
  hairOn(devcrown);
  const crownGlow = holo('#7dffe6', 0.4), crownHaze = holo('#00ffc6', 0.13);
  const rootCrown = new THREE.Group();
  rootCrown.position.y = 0.185; devcrown.add(rootCrown);
  add(rootCrown, geo('devCrownDisc', () => new THREE.RingGeometry(0.06, 0.15, 32)), crownHaze, [0, -0.042, 0], [-Math.PI / 2, 0, 0]);
  add(rootCrown, geo('devCrownRing', () => new THREE.TorusGeometry(0.118, 0.0035, 4, 32)), crownGlow, [0, -0.042, 0], [Math.PI / 2, 0, 0]);
  const crownShards = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    // k 0 sits at the face (-z); `front` is 1 there and 0 at the back.
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2, front = (1 - Math.sin(a)) / 2;
    const shard = new THREE.Group();
    shard.position.set(Math.cos(a) * 0.118, 0, Math.sin(a) * 0.118); shard.rotation.y = -a;
    add(shard, geo('devShard', () => new THREE.ConeGeometry(0.017, 0.075, 4).translate(0, 0.0375, 0)), haloMat, [0, 0, 0], null, [1, 0.55 + front * 0.8, 1]);
    add(shard, geo('devShardTip', () => new THREE.ConeGeometry(0.017, 0.028, 4)), haloMat, [0, 0.013, 0], [Math.PI, 0, 0]);
    add(shard, geo('devShardBloom', () => new THREE.ConeGeometry(0.032, 0.1, 4).translate(0, 0.05, 0)), crownGlow, [0, -0.012, 0], null, [1, 0.5 + front * 0.9, 1]);
    rootCrown.add(shard);
    return { shard, a };
  });
  // Faces. The visor is a wide wrap-around band.
  const visorFace = option(faces, 'visor', true);
  add(visorFace, geo('visor', () => new THREE.CylinderGeometry(0.139, 0.132, 0.07, 9, 1, true, Math.PI - 1.1, 2.2)), visorMat, [0, 0.022, 0]).material.side = THREE.DoubleSide;
  option(faces, 'none', false);
  const goggles = option(faces, 'goggles', false);
  for (const side of [-1, 1]) add(goggles, geo('goggleLens', () => new THREE.CylinderGeometry(0.036, 0.036, 0.03, 6)), visorMat, [side * 0.048, 0.03, -0.125], [Math.PI / 2, 0, 0]);
  add(goggles, geo('goggleStrap', () => new THREE.CylinderGeometry(0.142, 0.142, 0.03, 10, 1, true)), dark, [0, 0.03, 0]);
  const shades = option(faces, 'shades', false);
  block(shades, 'shades', [0.19, 0.035, 0.02], visorMat, [0, 0.025, -0.13]);
  block(shades, 'shadesArm', [0.25, 0.01, 0.01], dark, [0, 0.03, -0.1]);
  const gasmask = option(faces, 'gasmask', false);
  add(gasmask, geo('mask', () => new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, Math.PI * 0.2, Math.PI * 0.6)), dark, [0, -0.02, -0.06], [Math.PI / 2, 0, 0], [1.05, 1, 0.9]);
  for (const side of [-1, 1]) add(gasmask, geo('maskEye', () => new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6)), visorMat, [side * 0.045, 0.03, -0.125], [Math.PI / 2, 0, 0]);
  add(gasmask, geo('maskCan', () => new THREE.CylinderGeometry(0.035, 0.04, 0.08, 8)), gear, [0, -0.06, -0.17], [Math.PI / 2, 0, 0]);
  const scarf = option(faces, 'scarf', false);
  add(scarf, geo('scarf', () => new THREE.SphereGeometry(0.136, 10, 5, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.35)), suit, [0, 0, 0], null, [1.02, 1.1, 1.08]);
  add(scarf, geo('scarfRoll', () => new THREE.TorusGeometry(0.09, 0.035, 5, 8)), suit, [0, -0.12, 0.0], [Math.PI / 2, 0, 0]);
  const respirator = option(faces, 'respirator', false);
  block(respirator, 'respPlate', [0.11, 0.07, 0.05], dark, [0, -0.05, -0.12]);
  for (const side of [-1, 1]) add(respirator, geo('respFilter', () => new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8)), visorMat, [side * 0.07, -0.06, -0.12], [0, side * 0.5, Math.PI / 2]);
  const skullMask = option(faces, 'skull', false);
  add(skullMask, geo('skullFace', () => new THREE.SphereGeometry(0.131, 10, 6, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.25, Math.PI * 0.55)), mat('#e9e4d6', { rough: 0.7 }), [0, 0, 0], null, [0.95, 1.08, 1.02]);
  const socket = mat('#050506');
  for (const side of [-1, 1]) gem(skullMask, 'skullEye', 0.027, socket, [side * 0.045, 0.02, -0.118]);
  block(skullMask, 'skullTeeth', [0.07, 0.012, 0.01], socket, [0, -0.06, -0.126]);
  const cyber = option(faces, 'cyber', false);
  add(cyber, geo('cyberPlate', () => new THREE.SphereGeometry(0.14, 10, 6, Math.PI * 1.1, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.55)), mat('#10151b', { rough: 0.2, metal: 0.6 }), [0, 0, 0], null, [0.97, 1.08, 1.04]);
  block(cyber, 'cyberSlit', [0.17, 0.018, 0.02], visorMat, [0, 0.025, -0.135]);
  block(cyber, 'cyberChin', [0.05, 0.01, 0.02], visorMat, [0, -0.07, -0.13]);
  const bandit = option(faces, 'bandit', false);
  add(bandit, geo('bandit', () => new THREE.SphereGeometry(0.137, 12, 5, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.33)), suit, [0, 0, 0], null, [0.97, 1.1, 1.06]);
  add(bandit, geo('banditTip', () => new THREE.ConeGeometry(0.085, 0.11, 4).rotateY(Math.PI / 4)), suit, [0, -0.045, -0.155], [Math.PI + 0.35, 0, 0], [1, 1, 0.2]);
  block(bandit, 'banditKnot', [0.045, 0.035, 0.03], suit, [0, -0.02, 0.15]);
  for (const side of [-1, 1]) block(bandit, 'banditTail', [0.024, 0.08, 0.008], suit, [side * 0.016, -0.07, 0.158], [0.15, 0, side * 0.25]);
  // Aviators: teardrop lenses (flat on top, sagging toward the nose) in gold rims.
  const aviators = option(faces, 'aviators', false);
  const teardrop = () => geo('aviatorLens', () => warp(new THREE.CylinderGeometry(0.03, 0.03, 0.005, 14).rotateX(Math.PI / 2), (p) => { if (p.y < 0) { p.y *= 1.45; p.x += p.y * 0.3; } else p.y *= 0.75; }));
  for (const side of [-1, 1]) {
    add(aviators, teardrop(), lens, [side * 0.049, 0.03, -0.133], [0, -side * 0.18, 0], [side, 1, 1]);
    add(aviators, teardrop(), gold, [side * 0.049, 0.03, -0.1305], [0, -side * 0.18, 0], [side * 1.14, 1.12, 0.8]);
    block(aviators, 'aviatorGlint', [0.024, 0.004, 0.002], visorMat, [side * 0.055, 0.041, -0.137], [0, -side * 0.18, side * 0.45]);
    block(aviators, 'aviatorHinge', [0.04, 0.005, 0.005], gold, [side * 0.098, 0.047, -0.126]);
    block(aviators, 'aviatorArm', [0.005, 0.005, 0.12], gold, [side * 0.117, 0.047, -0.065]);
  }
  for (const y of [0.044, 0.056]) block(aviators, 'aviatorBridge', [0.03, 0.004, 0.004], gold, [0, y, -0.137]);
  // Monocle over the right eye, its chain looping back to behind the ear.
  const monocle = option(faces, 'monocle', false);
  add(monocle, geo('monocleRim', () => new THREE.TorusGeometry(0.03, 0.005, 5, 16)), gold, [0.047, 0.03, -0.122], [0, -0.22, 0]);
  const monocleGlass = add(monocle, geo('monocleGlass', () => new THREE.CircleGeometry(0.029, 16)), glass, [0.047, 0.03, -0.122], [0, Math.PI - 0.22, 0]);
  add(monocle, geo('monocleChain', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.068, 0.009, -0.118], [0.088, -0.04, -0.112], [0.1, -0.085, -0.075], [0.112, -0.075, -0.035], [0.122, -0.03, -0.004]].map((p) => new THREE.Vector3(...p))), 16, 0.0022, 4)), gold);
  // Full face masks share one shell (MASK); the jaw hides under them (see styleOperator).
  const maskOn = (group, material) => add(group, geo('faceShell', () => new THREE.SphereGeometry(0.14, 12, 8, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.2, Math.PI * 0.68)), material, [0, 0, 0], null, [0.95, 1.12, 1.05]);
  const strapOn = (group, material) => { for (const [y, sx, sz] of [[0.065, 0.92, 0.98], [-0.03, 1.06, 1.13]]) add(group, geo('maskStrap', () => new THREE.CylinderGeometry(0.12, 0.12, 0.014, 12, 1, true, -2.1, 4.2)), material, [0, y, 0], null, [sx, 1, sz]); };
  // Hockey mask: breathing holes and red chevrons.
  const hockey = option(faces, 'hockey', false);
  maskOn(hockey, white);
  strapOn(hockey, dark);
  for (const side of [-1, 1]) onMask(gem(hockey, 'hockeyEye', 0.024, socket, [0, 0, 0], [1.25, 0.8, 0.5]), side * 0.045, 0.03, -0.008);
  for (const [x, y] of [[0, -0.04], [-0.022, -0.04], [0.022, -0.04], [0, -0.062], [-0.022, -0.062], [0.022, -0.062], [-0.012, -0.013], [0.012, -0.013], [-0.07, -0.035], [0.07, -0.035]]) onMask(gem(hockey, 'hockeyHole', 0.0065, socket, [0, 0, 0]), x, y, -0.003);
  for (const [x, y] of [[0, 0.075], [-0.074, -0.003], [0.074, -0.003]]) onMask(add(hockey, geo('chevron', () => outline([[-1, 1], [0, -1], [1, 1], [0.55, 1], [0, -0.1], [-0.55, 1]], 0.2).scale(0.014, 0.012, 0.014)), red), x, y, 0.0005);
  // Oni mask: angry brows, gold eyes, horns, a snarl with tusks.
  const oni = option(faces, 'oni', false);
  maskOn(oni, red);
  strapOn(oni, dark);
  onMask(gem(oni, 'oniNose', 0.024, red, [0, 0, 0], [1.3, 0.85, 0.9]), 0, 0.002, 0.008);
  onMask(block(oni, 'oniMouth', [0.09, 0.026, 0.012], socket, [0, 0, 0]), 0, -0.042, -0.002);
  onMask(block(oni, 'oniTeeth', [0.07, 0.007, 0.006], white, [0, 0, 0]), 0, -0.033, 0.002);
  for (const side of [-1, 1]) {
    onMask(block(oni, 'oniBrow', [0.06, 0.02, 0.022], dark, [0, 0, 0]), side * 0.046, 0.067, 0.004, side * 0.42);
    onMask(gem(oni, 'oniEye', 0.02, gold, [0, 0, 0], [1.3, 0.7, 0.6]), side * 0.046, 0.03, -0.002);
    onMask(gem(oni, 'oniCheek', 0.028, red, [0, 0, 0], [1, 0.75, 0.5]), side * 0.075, -0.012, 0);
    onMask(add(oni, geo('oniHorn', () => new THREE.ConeGeometry(0.018, 0.075, 6).translate(0, 0.0375, 0)), bone), side * 0.052, 0.1, -0.008, -side * 0.35);
    onMask(add(oni, geo('oniFang', () => new THREE.ConeGeometry(0.012, 0.046, 4).translate(0, 0.023, 0)), white), side * 0.036, -0.062, 0.007);
  }
  // Plague mask: dark leather, a long curved beak, round glass eyes.
  const plague = option(faces, 'plague', false);
  maskOn(plague, hide);
  strapOn(plague, dark);
  add(plague, geo('beak', () => warp(new THREE.ConeGeometry(0.048, 0.22, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.11), (p) => { p.y -= p.z * p.z * 1.4; })), hide, [0, -0.028, -0.13], null, [0.85, 1, 1]);
  add(plague, geo('beakBand', () => new THREE.TorusGeometry(0.044, 0.005, 4, 12)), gold, [0, -0.029, -0.158], null, [0.85, 1, 1]);
  for (const side of [-1, 1]) {
    onMask(add(plague, geo('plagueEye', () => new THREE.CylinderGeometry(0.027, 0.027, 0.018, 12).rotateX(Math.PI / 2)), visorMat), side * 0.05, 0.038, 0.004);
    onMask(add(plague, geo('plagueRim', () => new THREE.TorusGeometry(0.029, 0.006, 5, 14)), gold), side * 0.05, 0.038, 0.012);
  }
  // Frost mask: a filtered lower-face cover, rime creeping up off the vent.
  const frostmask = option(faces, 'frostmask', false);
  add(frostmask, geo('frostShell', () => new THREE.SphereGeometry(0.136, 12, 7, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.46, Math.PI * 0.44)), gear, [0, 0, 0], null, [0.99, 1.1, 1.05]);
  add(frostmask, geo('frostSeam', () => new THREE.CylinderGeometry(0.14, 0.14, 0.012, 14, 1, true, Math.PI - 1.3, 2.6)), iron, [0, -0.012, 0], null, [1, 1, 1.06]).material.side = THREE.DoubleSide;
  onMask(add(frostmask, geo('frostVent', () => new THREE.CylinderGeometry(0.03, 0.03, 0.018, 8).rotateX(Math.PI / 2)), dark), 0, -0.072, 0.004);
  onMask(add(frostmask, geo('frostVentRim', () => new THREE.TorusGeometry(0.032, 0.006, 5, 12)), iron), 0, -0.072, 0.009);
  for (const [x, y, s] of [[-0.062, -0.02, 1], [0.058, -0.036, 0.85], [-0.03, -0.062, 0.7], [0.036, -0.058, 0.9], [-0.076, -0.048, 0.6], [0.072, -0.012, 0.75], [0.004, -0.028, 0.65]]) onMask(gem(frostmask, 'frostShard', 0.016, rime, [0, 0, 0], [s, s * 1.5, s * 0.45]), x, y, 0.003, x * 6);
  // Shroud: torn cloth hung off the brow, dark behind it, ragged along the hem.
  const shroud = option(faces, 'shroud', false);
  add(shroud, geo('shroudBar', () => new THREE.CylinderGeometry(0.145, 0.145, 0.024, 14, 1, true, Math.PI - 1.5, 3)), canvas, [0, 0.064, 0], null, [1, 1, 1.05]).material.side = THREE.DoubleSide;
  add(shroud, geo('shroudVoid', () => new THREE.CylinderGeometry(0.138, 0.131, 0.09, 12, 1, true, Math.PI - 1.35, 2.7)), socket, [0, 0.008, 0]).material.side = THREE.DoubleSide;
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 6 - 0.5) * 2.05, drop = [0.15, 0.19, 0.16, 0.205, 0.145, 0.185, 0.13][k];
    const strip = new THREE.Group();
    strip.position.set(Math.sin(a) * 0.143, 0.058, -Math.cos(a) * 0.143);
    strip.rotation.set(0.05, a, k % 2 ? 0.06 : -0.05);
    shroud.add(strip);
    add(strip, geo('shroudStrip', () => new THREE.BoxGeometry(0.05, 1, 0.008).translate(0, -0.5, 0)), canvas, [0, 0, 0], null, [1, drop, 1]);
    add(strip, geo('shroudFray', () => new THREE.ConeGeometry(0.023, 0.035, 3)), canvas, [0, -drop, 0], [Math.PI, 0, 0]);
  }
  // Rebreather: a moulded mouthpiece with twin scrubber cans, hoses running back to the ears.
  const rebreather = option(faces, 'rebreather', false);
  add(rebreather, geo('rebShell', () => new THREE.SphereGeometry(0.133, 12, 7, Math.PI * 1.16, Math.PI * 0.68, Math.PI * 0.48, Math.PI * 0.42)), dark, [0, 0, 0], null, [1, 1.1, 1.04]);
  block(rebreather, 'rebBlock', [0.102, 0.072, 0.05], gear, [0, -0.052, -0.115], [0.18, 0, 0]);
  add(rebreather, geo('rebGauge', () => new THREE.CylinderGeometry(0.016, 0.016, 0.01, 10)), visorMat, [0, -0.026, -0.146], [Math.PI / 2 + 0.18, 0, 0]);
  for (const side of [-1, 1]) {
    add(rebreather, geo('rebCan', () => new THREE.CylinderGeometry(0.031, 0.031, 0.105, 10)), steel, [side * 0.05, -0.064, -0.175], [Math.PI / 2, 0, 0]);
    add(rebreather, geo('rebCap', () => new THREE.CylinderGeometry(0.034, 0.034, 0.014, 10)), iron, [side * 0.05, -0.064, -0.232], [Math.PI / 2, 0, 0]);
    add(rebreather, geo('rebCollar', () => new THREE.CylinderGeometry(0.034, 0.034, 0.012, 10)), iron, [side * 0.05, -0.064, -0.128], [Math.PI / 2, 0, 0]);
    add(rebreather, geo('rebHose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.078, -0.062, -0.185], [0.115, -0.048, -0.12], [0.132, -0.022, -0.022], [0.118, 0.004, 0.068]].map((p) => new THREE.Vector3(...p))), 16, 0.011, 5)), dark, [0, 0, 0], null, [side, 1, 1]);
  }
  // Pixel mask (dev): a black mirror plate with an LED face that blinks and glitches (animateCosmetics).
  const devmask = option(faces, 'devmask', false);
  maskOn(devmask, mirror);
  const pixelFace = { eyeRow: new THREE.Group(), mouthRow: new THREE.Group(), left: [], right: [], mouth: [], material: pixelMat, state: '' };
  devmask.add(pixelFace.eyeRow, pixelFace.mouthRow);
  for (const [list, row, count] of [[pixelFace.left, pixelFace.eyeRow, 4], [pixelFace.right, pixelFace.eyeRow, 4], [pixelFace.mouth, pixelFace.mouthRow, 5]]) for (let k = 0; k < count; k += 1) list.push(block(row, 'pixel', [0.012, 0.012, 0.004], pixelMat, [0, 0, 0]));
  setPixelFace(pixelFace, 'open', 'smile');
  // Scanner visor (dev): a dark wrap-around band with one emissive strip swept across it on a pivot, so the
  // sweep costs a rotation and nothing else. Trail, edge ticks and a haze band ride with it.
  const devscan = option(faces, 'devscan', false);
  add(devscan, geo('devScanShell', () => new THREE.CylinderGeometry(0.141, 0.134, 0.076, 12, 1, true, Math.PI - 1.25, 2.5)), scanGlass, [0, 0.022, 0]);
  add(devscan, geo('devScanBrow', () => new THREE.CylinderGeometry(0.143, 0.143, 0.01, 12, 1, true, Math.PI - 1.25, 2.5)), gear, [0, 0.062, 0]).material.side = THREE.DoubleSide;
  const scanHaze = add(devscan, geo('devScanHaze', () => new THREE.CylinderGeometry(0.145, 0.139, 0.062, 12, 1, true, Math.PI - 1.2, 2.4)), holo('#00ffc6', 0.12), [0, 0.022, 0]);
  const scanPivot = new THREE.Group();
  scanPivot.position.y = 0.022; devscan.add(scanPivot);
  block(scanPivot, 'devScanLine', [0.007, 0.06, 0.006], scanMat, [0, 0, -0.1375]);
  const scanTrailMat = holo('#00ffc6', 0.3);
  for (const [x, w] of [[0.012, 0.016], [0.03, 0.022]]) block(scanPivot, `devScanTrail${w}`, [w, 0.052, 0.004], scanTrailMat, [x, 0, -0.1365]);
  // Readout ticks at the right edge of the band, always lit.
  for (const [y, w] of [[0.036, 0.016], [0.02, 0.01], [0.004, 0.014]]) block(devscan, `devScanTick${w}`, [w, 0.006, 0.006], scanMat, [0.088, 0.022 + y - 0.02, -0.105], [0, -0.7, 0]);
  block(head, 'helmetLight', [0.05, 0.025, 0.02], teamMat, [0, 0.105, -0.183]);
  block(head, 'rearLight', [0.06, 0.025, 0.02], teamMat, [0, 0.06, 0.185]);
  spine.add(head);

  // --- arms and weapon pitch together about the shoulders ----------------------------------------------
  const aim = new THREE.Group();
  aim.position.y = 0.44;
  spine.add(aim);
  const gun = new THREE.Group();
  aim.add(gun);
  const arms = [-1, 1].map((side) => {
    const upper = limb(aim, 'upperArm', UPPER, 0.062, 0.05, suit);
    const fore = limb(aim, 'foreArm', FORE, 0.046, 0.058, gear);
    const pad = gem(aim, 'elbow', 0.058, plate, [0, 0, 0]);
    const hand = new THREE.Group();
    block(hand, 'glove', [0.07, 0.085, 0.085], dark, [0, -0.035, 0]);
    block(hand, 'knuckle', [0.074, 0.03, 0.05], plate, [0, -0.045, -0.03]);
    aim.add(hand);
    return { side, upper, fore, pad, hand, at: new THREE.Vector3(...(side > 0 ? REST.right : REST.left)) };
  });

  root.traverse((part) => { if (part.isMesh) { part.castShadow = true; part.receiveShadow = true; } });
  // Thin, glassy and glowing parts cast no shadow.
  for (const part of [antenna, ...whips, bubbleGlass, monocleGlass, halo, devwings, pixelFace.eyeRow, pixelFace.mouthRow, rootCrown, scanPivot, scanHaze, orbitCore]) part.traverse((mesh) => { mesh.castShadow = false; });
  root.userData = {
    hips, spine, chest, head, jaw, aim, legs, arms, gun, flames, suit, visorMat, teamMat, headgear, faces, packs, accent,
    guns: new Map(), held: null, skins: {}, recoil: 0, swing: -1, swingDir: 1, reload: 0, reloadK: 0, ads: 0, swap: 0, lastWeapon: null, landDip: 0, wasAir: false, turn: 0, lastYaw: null, blade: 0.6, legYaw: 0, air: 0, gunPos: new THREE.Vector3(...HOLDS.long.gun), gunRot: new THREE.Vector3(),
    charm: 'none', phase: Math.random() * 6, idle: Math.random() * 6, crouch: 0, lean: 0,
    materials: [suit, dark, gear, plate, skin, visorMat, teamMat, hairMat, metal, gold, socket, ruby, yellow, felt, silk, iron, bone, lacquer, white, red, leather, hide, lens, steel, shieldMat, starMat, haloMat, pixelMat, mirror, scanGlass, scanMat, orbitMat],
    beacon, halo: { group: halo, spin: haloSpin, orbit: haloOrbit, bits: haloBits, material: haloMat, glow: haloGlow, haze: haloHaze }, pixelFace, flag, cape: capeParts, wings, wingMats,
    devcrown: { group: rootCrown, shards: crownShards, material: haloMat, glow: crownGlow, haze: crownHaze },
    devscan: { pivot: scanPivot, material: scanMat, trail: scanTrailMat, haze: scanHaze.material },
    devorbit: { core: orbitCore, heart: orbitHeart, rings: orbits, material: orbitMat, glow: orbitGlow, haze: orbitHaze },
  };
  return root;
}

// Faces that cover the chin: the jaw block would poke through them, so it hides.
const CHIN_COVERED = new Set(['bandit', 'hockey', 'oni', 'plague', 'devmask', 'frostmask', 'shroud', 'rebreather']);
// look: any of { color, accent, team, headgear, face, pack, pattern, skins }; missing keys are left alone.
export function styleOperator(root, look) {
  const data = root.userData;
  const { color, accent, team } = look;
  if (color) data.suit.color.set(color);
  if (accent) { data.visorMat.color.set(accent); data.visorMat.emissive.set(accent); data.accent = accent; }
  if (team) { data.teamMat.color.set(TEAM_COLORS[team]); data.teamMat.emissive.set(TEAM_COLORS[team]); }
  const choose = (groups, id) => { if (!id || !groups[id]) return; for (const [key, group] of Object.entries(groups)) group.visible = key === id; };
  choose(data.headgear, look.headgear);
  choose(data.faces, look.face);
  if (data.faces[look.face]) data.jaw.visible = !CHIN_COVERED.has(look.face);
  choose(data.packs, look.pack);
  if (look.pattern) applyPattern(data.suit, look.pattern);
  if (look.skins) data.skins = look.skins;
  if (look.charm !== undefined && look.charm !== data.charm) { data.charm = look.charm; if (data.held) data.held.model.visible = false; data.held = null; }
}

// The weapon in hand is the first-person model, a little smaller, without its arms. One per weapon and
// finish, built the first time it is drawn and kept.
function heldGun(data, weapon) {
  const finish = data.skins[weapon.id] || null;
  const key = `${weapon.id}|${finish}|${data.charm || 'none'}`;
  if (data.held?.key === key) return data.held;
  if (data.held) data.held.model.visible = false;
  let entry = data.guns.get(key);
  if (!entry) {
    const model = buildWeapon(weapon.id, data.accent || '#ffb547', finish);
    stripHands(model);
    model.scale.setScalar(GUN_SCALE);
    model.traverse((part) => { if (part.isMesh) part.castShadow = true; });
    const front = Math.min(-0.2, model.userData.front ?? -0.4);
    // The charm hangs off the left of the receiver, the same place it hangs in your own hands.
    let charm = buildCharm(data.charm);
    // Only a gun with a place to hang one gets a charm: an unattached charm has no parent to swing from.
    if (charm && model.userData.charmAt) { charm.position.set(...model.userData.charmAt); charm.scale.setScalar(model.userData.charmScale * 1.15); charm.traverse((part) => { if (part.isMesh) part.castShadow = false; }); model.add(charm); }
    else charm = null;
    entry = { key, model, charm, reach: -front * GUN_SCALE };
    data.guns.set(key, entry);
    data.gun.add(model);
  }
  entry.model.visible = true;
  data.held = entry;
  return entry;
}

// The pixel mask's LEDs sit on a 1.6 cm grid: four per eye, five for the mouth. Unused ones go dark.
const PIXEL = 0.016;
const EYES = { open: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], blink: [[-1, -0.5], [0, -0.5], [1, -0.5]], happy: [[-1, -0.5], [0, 0.5], [1, -0.5]] };
const MOUTHS = { smile: [[-2, 0.5], [-1, -0.5], [0, -0.5], [1, -0.5], [2, 0.5]], flat: [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]] };
function lightPixels(pixels, layout, x, y) { pixels.forEach((pixel, k) => { pixel.visible = k < layout.length; if (pixel.visible) onMask(pixel, x + layout[k][0] * PIXEL, y + layout[k][1] * PIXEL, 0.002); }); }
function setPixelFace(face, eyes, mouth) {
  lightPixels(face.left, EYES[eyes], -0.042, 0.042);
  lightPixels(face.right, EYES[eyes], 0.042, 0.042);
  lightPixels(face.mouth, MOUTHS[mouth], 0, -0.03);
  face.state = eyes + mouth;
}

// The cosmetics that move, each only while it is worn. `idle` is the clock.
function animateCosmetics(data, stride, sway) {
  const t = data.idle, c = data.crouch, air = data.air;
  if (data.headgear.bubble.visible) data.beacon.visible = t % 1.2 < 0.6;
  if (data.headgear.devhalo.visible) {
    const halo = data.halo;
    halo.group.position.y = 0.25 + Math.sin(t * 1.7) * 0.012;
    halo.group.rotation.set(Math.sin(t * 0.9) * 0.07, 0, Math.cos(t * 0.7) * 0.07);
    halo.spin.rotation.y = t * 0.8;
    halo.orbit.rotation.y = -t * 1.6;
    halo.bits.forEach((bit, k) => { bit.position.y = Math.sin(t * 2.4 + k * 1.7) * 0.022; bit.rotation.set(t * 2 + k, t * 3 + k, 0); });
    halo.material.emissiveIntensity = 2.6 + Math.sin(t * 3.1) * 0.9;
    halo.glow.opacity = 0.35 + Math.sin(t * 3.1 + 1) * 0.2;
    halo.haze.opacity = 0.16 + Math.sin(t * 3.1) * 0.06;
  }
  if (data.headgear.devcrown.visible) {
    // Every shard rides its own slow bob and turn; the ring itself breathes and drifts round the head.
    const crown = data.devcrown, breath = Math.sin(t * 1.3);
    crown.group.position.y = 0.185 + breath * 0.009;
    crown.group.rotation.y = t * 0.3;
    crown.group.scale.setScalar(1 + breath * 0.035);
    crown.shards.forEach(({ shard, a }, k) => { shard.position.y = Math.sin(t * 1.9 + k * 0.85) * 0.014; shard.rotation.y = -a + Math.sin(t * 0.55 + k * 1.3) * 0.35; });
    crown.material.emissiveIntensity = 2.6 + breath * 0.8;
    crown.glow.opacity = 0.3 + Math.sin(t * 2.6) * 0.14;
    crown.haze.opacity = 0.13 + breath * 0.05;
  }
  if (data.faces.devscan.visible) {
    // One strip sweeps across every 2.4 s and rests off-screen between passes; the band itself just breathes.
    const scan = data.devscan, beat = t % 2.4, run = Math.min(1, beat / 0.55);
    scan.pivot.visible = beat < 0.55;
    scan.pivot.rotation.y = (run - 0.5) * 1.9;
    scan.trail.opacity = 0.3 * (1 - run) + 0.05;
    scan.material.emissiveIntensity = 2.6 + Math.sin(t * 2.2) * 0.3;
    scan.haze.opacity = 0.12 + Math.sin(t * 2.2) * 0.035;
  }
  if (data.faces.devmask.visible) {
    // Blinks every 3.1 s. Every 9.7 s it glitches (rows tear sideways, the LEDs stutter) then grins ^ ^ for a moment.
    const face = data.pixelFace, beat = t % 9.7, glitch = beat < 0.16 || t % 4.3 < 0.06;
    const eyes = beat >= 0.16 && beat < 1.5 ? 'happy' : t % 3.1 < 0.13 ? 'blink' : 'open', mouth = glitch ? 'flat' : 'smile';
    if (face.state !== eyes + mouth) setPixelFace(face, eyes, mouth);
    const jolt = glitch ? (Math.floor(t * 45) % 2 ? 0.016 : -0.011) : 0;
    face.eyeRow.position.x = jolt; face.mouthRow.position.x = -jolt;
    face.material.emissiveIntensity = glitch ? 0.8 + (Math.floor(t * 60) % 3) : 2.4 + Math.sin(t * 2) * 0.2;
  }
  // The flag strips swing about their left edges in a travelling wave, streaming back at a run.
  if (data.packs.banner.visible) data.flag.forEach((strip, k) => { strip.rotation.y = Math.sin(t * 2.3 - k * 1.1) * (0.12 + stride * 0.1) - (k ? 0.05 : 0.08 + stride * 0.4 + air * 0.2); });
  if (data.packs.cape.visible) {
    // The top hangs plumb when the torso leans back; running, jumping and crouching drag it out behind.
    const drag = stride * 0.6 + air * 0.4 + c * 0.35;
    data.cape.forEach((part, k) => {
      if (k) part.rotation.x = -drag * 0.18 + Math.sin(data.phase * 2 - k * 0.9) * 0.1 * stride + Math.sin(t * 1.3 - k * 0.8) * 0.03;
      else part.rotation.set(-Math.max(0, data.spine.rotation.x) * 0.9 - 0.08 - drag * 0.55 + Math.sin(data.phase * 2) * 0.04 * stride, 0, Math.sin(data.phase) * 0.07 * stride + sway * 0.04);
    });
  }
  if (data.packs.devorbit.visible) {
    // Each cube keeps its own ring and its own speed, so they never line up; the core beats under them.
    const orbit = data.devorbit, pulse = Math.sin(t * 2.7);
    orbit.rings.forEach(({ spin, bit, rate }, k) => { spin.rotation.y = t * rate + k * 1.6; bit.rotation.set(t * rate * 1.5, t * 1.1 + k, 0); });
    orbit.heart.scale.setScalar(1 + pulse * 0.12);
    orbit.material.emissiveIntensity = 2.4 + pulse * 0.9;
    orbit.glow.opacity = 0.32 + Math.sin(t * 1.6) * 0.1;
    orbit.haze.opacity = 0.15 + pulse * 0.06;
  }
  if (data.packs.devwings.visible) {
    // A slow breath, bigger in the air; running folds them back and down. The opacity shimmer runs root to tip.
    const flap = Math.sin(t * 1.4) * (0.09 + air * 0.3), fold = Math.min(1, stride * 1.2 + c * 0.4);
    data.wings.forEach(({ wing, hand, side }) => { wing.rotation.set(0, -side * (0.3 + fold * 0.55), side * (0.1 + flap - fold * 0.3)); hand.rotation.set(0, -fold * 0.5, -0.12 + flap * 0.8 - fold * 0.35); });
    data.wingMats.forEach((material, k) => { material.opacity = 0.3 + Math.max(0, Math.sin(t * 2.6 - k * 1.3)) * 0.25 + Math.sin(t * 1.4) * 0.04; });
  }
}

const target = new THREE.Vector3(), shoulder = new THREE.Vector3(), grip = new THREE.Vector3(), euler = new THREE.Euler();
const POLE_R = new THREE.Vector3(0.75, -0.65, 0.25), POLE_L = new THREE.Vector3(-0.55, -0.8, 0.1);
// pose: { speed, crouch, pitch, weapon, dt, move?: [right, forward] in the operator's own frame, air?, dead?: 0..1,
//         scoped?, reloading? }. One-off actions come through operatorAction (a shot, a knife swing).
export function animateOperator(root, pose) {
  const data = root.userData;
  const dt = pose.dt, ease = (rate) => Math.min(1, dt * rate);
  const dead = pose.dead || 0;
  data.crouch += ((pose.crouch ? 1 : 0) - data.crouch) * ease(12);
  data.air += ((pose.air ? 1 : 0) - data.air) * ease(pose.air ? 9 : 14);
  const c = data.crouch, air = data.air;
  // Timed actions: recoil decays, a knife swing plays out, a reload runs while the flag is up.
  data.recoil += (0 - data.recoil) * ease(10);
  if (data.swing >= 0) { data.swing += dt / 0.4; if (data.swing >= 1) data.swing = -1; }
  data.reload += ((pose.reloading ? 1 : 0) - data.reload) * ease(9);
  data.reloadK = pose.reloading ? data.reloadK + dt : 0;
  data.ads += ((pose.scoped ? 1 : 0) - data.ads) * ease(11);
  if (pose.weapon !== data.lastWeapon) { if (data.lastWeapon) data.swap = 1; data.lastWeapon = pose.weapon; }
  data.swap += (0 - data.swap) * ease(7);
  if (data.wasAir && !pose.air) data.landDip = 1;
  data.wasAir = Boolean(pose.air);
  data.landDip += (0 - data.landDip) * ease(7);
  // Turning on the spot: the feet shuffle round instead of sliding.
  const yaw = root.rotation.y;
  if (data.lastYaw !== null && dt > 0) { const spin = Math.atan2(Math.sin(yaw - data.lastYaw), Math.cos(yaw - data.lastYaw)) / dt; data.turn += (Math.min(1, Math.abs(spin) / 2.5) - data.turn) * ease(8); }
  data.lastYaw = yaw;
  // Which way the legs are taking them: forwards, sideways, or backwards with the stride reversed.
  let heading = pose.move && pose.speed > 0.6 ? Math.atan2(pose.move[0], pose.move[1]) : 0;
  const backwards = Math.abs(heading) > 1.95;
  if (backwards) heading -= Math.sign(heading) * Math.PI;
  data.legYaw += (THREE.MathUtils.clamp(-heading, -0.95, 0.95) - data.legYaw) * ease(9);
  const pace = Math.min(pose.speed, 7);
  data.phase += dt * pace * 1.9 * (backwards ? -1 : 1);
  data.idle += dt;
  const stride = Math.min(1, pose.speed / 5) * (1 - c * 0.4) * (1 - air);
  data.lean += ((backwards ? -0.5 : 1) * stride - data.lean) * ease(8);
  const shuffle = data.turn * (1 - Math.min(1, pose.speed / 1.5)) * (1 - c * 0.5);
  data.phase += dt * shuffle * 7;
  const swing = Math.sin(data.phase) * (0.8 * stride + 0.22 * shuffle);
  const breath = Math.sin(data.idle * 1.7) * (1 - stride);
  const sway = Math.sin(data.idle * 0.6) * (1 - stride) * (1 - c);

  // Hips: bob twice per stride, sway side to side, and drop for the crouch.
  data.hips.position.y = 0.96 - c * 0.42 + Math.abs(Math.cos(data.phase)) * 0.045 * stride + air * 0.03 - data.landDip * 0.12 * (1 - c);
  data.hips.position.x = Math.sin(data.phase) * 0.02 * stride + sway * 0.012;
  data.hips.rotation.y = data.legYaw + Math.sin(data.phase) * 0.17 * stride;
  data.hips.rotation.z = Math.sin(data.phase) * 0.035 * stride + sway * 0.02;
  data.legs.forEach(({ pivot, knee, foot }, index) => {
    const s = index === 0 ? swing : -swing;
    // Standing still, the feet are set apart: support leg forward, the other back and turned out.
    const stance = (1 - stride) * (1 - c) * (1 - air) * (index === 0 ? -0.16 : 0.12);
    const tuck = air * (index === 0 ? 0.75 : 0.25);
    pivot.rotation.x = -data.landDip * 0.22 * (1 - c) + s - c * 1.15 + stance - tuck - dead * (index === 0 ? 0.5 : 0.1);
    pivot.rotation.z = (index === 0 ? -1 : 1) * (0.035 + (1 - stride) * 0.06 + c * 0.1 + dead * 0.2);
    knee.rotation.x = data.landDip * 0.45 * (1 - c) + Math.max(0, -s) * 1.1 + c * 1.9 + stride * 0.24 + Math.abs(stance) * 0.5 + air * (index === 0 ? 1.2 : 0.7) + dead * (index === 0 ? 1.1 : 0.3);
    // Heel strike and toe-off, flat on the ground when crouched, toes down in the air.
    foot.rotation.x = -(pivot.rotation.x + knee.rotation.x) * (c > 0.5 ? 1 : 0.4) * (1 - air) + Math.max(0, s) * 0.3 * stride + air * 0.5;
  });

  // The weapon and how it is held.
  const weapon = WEAPONS[pose.weapon] || WEAPONS.m44;
  const hold = holdOf(weapon);
  const held = heldGun(data, weapon);
  data.blade += ((dead ? 0 : hold.blade) - data.blade) * ease(8);
  data.gunPos.lerp(target.set(...hold.gun), ease(10));
  data.gunRot.lerp(target.set(...hold.rot), ease(10));
  const bob = Math.sin(data.phase * 2) * 0.012 * stride;
  // Sprinting lowers the muzzle, aiming brings the sights up to the eye, a reload tips the gun in and down,
  // a swap dips it out of sight and back, a shot shoves it into the shoulder.
  const run = Math.max(0, Math.min(1, (pose.speed - 4.6) / 1.2)) * (1 - data.ads) * (weapon.melee ? 0 : 1);
  const rel = data.reload, relBeat = Math.sin(data.reloadK * 5.5) * rel;
  data.gun.position.copy(data.gunPos);
  data.gun.position.y += bob + breath * 0.003 + data.ads * 0.03 - run * 0.07 - rel * 0.09 - data.swap * 0.22;
  data.gun.position.x -= data.ads * 0.025 - rel * 0.03;
  data.gun.position.z += data.recoil * 0.05 + data.ads * 0.03 + rel * 0.05;
  data.gun.rotation.set(data.gunRot.x + stride * 0.05 + data.recoil * 0.12 - run * 0.5 + rel * 0.45 + data.swap * 0.9, data.gunRot.y + run * 0.35 + rel * 0.25, data.gunRot.z + rel * 0.5 + relBeat * 0.05);
  if (data.swing >= 0) {
    // The blade: wind up across the body, cut through, recover.
    const k = data.swing, wind = Math.sin(Math.min(1, k / 0.25) * Math.PI) * (k < 0.25 ? 1 : 0), cut = Math.sin(Math.max(0, Math.min(1, (k - 0.2) / 0.6)) * Math.PI);
    data.gun.position.x -= data.swingDir * (cut * 0.34 - wind * 0.08); data.gun.position.z -= cut * 0.22; data.gun.position.y += cut * 0.1;
    data.gun.rotation.y += data.swingDir * cut * 1.1; data.gun.rotation.z += data.swingDir * cut * 0.8;
  }
  data.gun.visible = !dead;

  // The spine takes part of the pitch so the arms never have to fold through the chest; shoulders
  // counter-rotate against the hips; the torso leans into a run and breathes when still.
  const pitch = THREE.MathUtils.clamp(pose.pitch, -1.45, 1.45);
  data.spine.rotation.x = c * 0.28 + data.lean * 0.13 + pitch * 0.35 + dead * 0.35 + data.landDip * 0.12 - data.recoil * 0.04 + rel * 0.08;
  data.spine.rotation.y = -data.legYaw - Math.sin(data.phase) * 0.22 * stride;
  data.spine.rotation.z = -sway * 0.02 + dead * 0.2;
  data.spine.position.y = 0.1 + breath * 0.004;
  data.chest.rotation.y = -data.blade + Math.sin(data.phase) * 0.06 * stride;
  data.chest.scale.setScalar(1 + breath * 0.006);
  data.aim.rotation.x = pitch - data.spine.rotation.x;
  data.aim.rotation.y = Math.sin(data.phase) * 0.05 * stride;
  data.aim.position.y = 0.44 + breath * 0.004;
  data.head.rotation.x = pitch * 0.85 - data.spine.rotation.x + c * 0.1 + dead * 0.5;
  data.head.rotation.y = Math.sin(data.phase) * 0.08 * stride + sway * 0.06;
  data.head.rotation.z = dead * 0.4 - Math.max(0, data.blade) * (0.16 + data.ads * 0.12);
  data.head.rotation.x += rel * 0.28;
  if (data.packs.jetpack.visible) for (const flame of data.flames) flame.scale.y = 0.8 + Math.sin(data.idle * 31 + flame.position.x * 40) * 0.25 + air * 1.2;
  // The charm swings off the gun for everyone watching, not just the pilot holding it.
  if (held.charm && dt > 0) updateCharm(held.charm, dt, { scale: GUN_SCALE });
  animateCosmetics(data, stride, sway);

  // Hands: strong hand on the grip, support hand out along the fore-end (no further than the gun is long).
  euler.set(data.gun.rotation.x, data.gun.rotation.y, data.gun.rotation.z);
  grip.set(...(hold.grip || GRIP)).applyEuler(euler).add(data.gun.position);
  data.arms.forEach((arm) => {
    const right = arm.side > 0;
    if (dead) target.set(arm.side * 0.34, -0.42, right ? 0.05 : -0.12);
    else if (right) target.copy(grip);
    else if (hold.support && rel > 0.05) { const beat = 0.5 + 0.5 * Math.sin(data.reloadK * 5.5); target.set(0, -0.03 - beat * 0.16, -0.12).applyEuler(euler).add(grip).lerp(shoulder.set(hold.support[0], hold.support[1], Math.max(hold.support[2], -held.reach * 0.62)).applyEuler(euler).add(grip), 1 - rel); }
    else if (hold.support) target.set(hold.support[0], hold.support[1], Math.max(hold.support[2], -held.reach * 0.62)).applyEuler(euler).add(grip);
    else target.set(...REST.left).setY(REST.left[1] + breath * 0.004);
    arm.at.lerp(target, ease(dead ? 5 : 14));
    solveArm(arm, shoulderAt(arm.side, data.blade, shoulder), arm.at, right ? POLE_R : POLE_L);
  });
}

// One-off actions seen on other pilots: a shot kicks the gun, a melee swings the blade (alternating sides).
export function operatorAction(root, action, amount = 1) {
  const data = root.userData;
  if (action === 'fire') data.recoil = Math.min(1.4, data.recoil + 0.55 * amount);
  if (action === 'melee') { data.swing = 0; data.swingDir = -data.swingDir; }
}
