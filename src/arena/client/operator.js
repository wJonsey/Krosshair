// The third-person operator: a faceted, low-poly armoured pilot. Everything is procedural.
// build → style → animate. The weapon in hand is the real first-person model, and the arms are
// solved each frame so both hands always sit on it, whatever is being carried.
// Proportions follow the hit zones in shared/combat.js (1.8 m tall, head centre 1.62 m, torso 0.9–1.4 m).
import * as THREE from 'three';
import { WEAPONS } from '../shared/constants.js';
import { applyPattern } from './skins.js';
import { buildWeapon } from './viewmodel.js';

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
  block(head, 'jaw', [0.12, 0.05, 0.06], dark, [0, -0.095, -0.075], [0.35, 0, 0]);
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
  const hairOn = (group) => { add(group, geo('hair', () => new THREE.SphereGeometry(0.134, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.45)), hairMat, [0, 0.02, 0], null, [0.95, 1.05, 1.03]); block(group, 'fringe', [0.17, 0.035, 0.05], hairMat, [0, 0.09, -0.105], [0.5, 0, 0]); };
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
  add(skullMask, geo('skullFace', () => new THREE.SphereGeometry(0.131, 10, 6, Math.PI * 0.65, Math.PI * 0.7, Math.PI * 0.25, Math.PI * 0.55)), mat('#e9e4d6', { rough: 0.7 }), [0, 0, 0], null, [0.95, 1.08, 1.02]);
  const socket = mat('#050506');
  for (const side of [-1, 1]) gem(skullMask, 'skullEye', 0.027, socket, [side * 0.045, 0.02, -0.118]);
  block(skullMask, 'skullTeeth', [0.07, 0.012, 0.01], socket, [0, -0.06, -0.126]);
  const cyber = option(faces, 'cyber', false);
  add(cyber, geo('cyberPlate', () => new THREE.SphereGeometry(0.14, 10, 6, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.55)), mat('#10151b', { rough: 0.2, metal: 0.6 }), [0, 0, 0], null, [0.97, 1.08, 1.04]);
  block(cyber, 'cyberSlit', [0.17, 0.018, 0.02], visorMat, [0, 0.025, -0.135]);
  block(cyber, 'cyberChin', [0.05, 0.01, 0.02], visorMat, [0, -0.07, -0.13]);
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
  antenna.castShadow = false;
  root.userData = {
    hips, spine, chest, head, aim, legs, arms, gun, flames, suit, visorMat, teamMat, headgear, faces, packs, accent,
    guns: new Map(), held: null, skins: {}, blade: 0.6, legYaw: 0, air: 0, gunPos: new THREE.Vector3(...HOLDS.long.gun), gunRot: new THREE.Vector3(),
    phase: Math.random() * 6, idle: Math.random() * 6, crouch: 0, lean: 0, materials: [suit, dark, gear, plate, skin, visorMat, teamMat, hairMat, metal, gold],
  };
  return root;
}

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
  choose(data.packs, look.pack);
  if (look.pattern) applyPattern(data.suit, look.pattern);
  if (look.skins) data.skins = look.skins;
}

// The weapon in hand is the first-person model, a little smaller, without its arms. One per weapon and
// finish, built the first time it is drawn and kept.
function heldGun(data, weapon) {
  const finish = data.skins[weapon.id] || null;
  const key = `${weapon.id}|${finish}`;
  if (data.held?.key === key) return data.held;
  if (data.held) data.held.model.visible = false;
  let entry = data.guns.get(key);
  if (!entry) {
    const model = buildWeapon(weapon.id, data.accent || '#ffb547', finish);
    for (const child of [...model.children]) if (child.userData.arm) model.remove(child);
    model.scale.setScalar(GUN_SCALE);
    model.traverse((part) => { if (part.isMesh) part.castShadow = true; });
    const front = Math.min(-0.2, ...model.children.filter((child) => child.isMesh).map((child) => child.position.z));
    entry = { key, model, reach: -front * GUN_SCALE };
    data.guns.set(key, entry);
    data.gun.add(model);
  }
  entry.model.visible = true;
  data.held = entry;
  return entry;
}

const target = new THREE.Vector3(), shoulder = new THREE.Vector3(), grip = new THREE.Vector3(), euler = new THREE.Euler();
const POLE_R = new THREE.Vector3(0.75, -0.65, 0.25), POLE_L = new THREE.Vector3(-0.55, -0.8, 0.1);
// pose: { speed, crouch, pitch, weapon, dt, move?: [right, forward] in the operator's own frame, air?, dead?: 0..1 }
export function animateOperator(root, pose) {
  const data = root.userData;
  const dt = pose.dt, ease = (rate) => Math.min(1, dt * rate);
  const dead = pose.dead || 0;
  data.crouch += ((pose.crouch ? 1 : 0) - data.crouch) * ease(12);
  data.air += ((pose.air ? 1 : 0) - data.air) * ease(pose.air ? 9 : 14);
  const c = data.crouch, air = data.air;
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
  const swing = Math.sin(data.phase) * 0.8 * stride;
  const breath = Math.sin(data.idle * 1.7) * (1 - stride);
  const sway = Math.sin(data.idle * 0.6) * (1 - stride) * (1 - c);

  // Hips: bob twice per stride, sway side to side, and drop for the crouch.
  data.hips.position.y = 0.96 - c * 0.42 + Math.abs(Math.cos(data.phase)) * 0.045 * stride + air * 0.03;
  data.hips.position.x = Math.sin(data.phase) * 0.02 * stride + sway * 0.012;
  data.hips.rotation.y = data.legYaw + Math.sin(data.phase) * 0.17 * stride;
  data.hips.rotation.z = Math.sin(data.phase) * 0.035 * stride + sway * 0.02;
  data.legs.forEach(({ pivot, knee, foot }, index) => {
    const s = index === 0 ? swing : -swing;
    // Standing still, the feet are set apart: support leg forward, the other back and turned out.
    const stance = (1 - stride) * (1 - c) * (1 - air) * (index === 0 ? -0.16 : 0.12);
    const tuck = air * (index === 0 ? 0.75 : 0.25);
    pivot.rotation.x = s - c * 1.15 + stance - tuck - dead * (index === 0 ? 0.5 : 0.1);
    pivot.rotation.z = (index === 0 ? -1 : 1) * (0.035 + (1 - stride) * 0.06 + c * 0.1 + dead * 0.2);
    knee.rotation.x = Math.max(0, -s) * 1.1 + c * 1.9 + stride * 0.24 + Math.abs(stance) * 0.5 + air * (index === 0 ? 1.2 : 0.7) + dead * (index === 0 ? 1.1 : 0.3);
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
  data.gun.position.copy(data.gunPos); data.gun.position.y += bob + breath * 0.003;
  data.gun.rotation.set(data.gunRot.x + stride * 0.05, data.gunRot.y, data.gunRot.z);
  data.gun.visible = !dead;

  // The spine takes part of the pitch so the arms never have to fold through the chest; shoulders
  // counter-rotate against the hips; the torso leans into a run and breathes when still.
  const pitch = THREE.MathUtils.clamp(pose.pitch, -1.45, 1.45);
  data.spine.rotation.x = c * 0.28 + data.lean * 0.13 + pitch * 0.35 + dead * 0.35;
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
  data.head.rotation.z = dead * 0.4 - Math.max(0, data.blade) * 0.16;
  if (data.packs.jetpack.visible) for (const flame of data.flames) flame.scale.y = 0.8 + Math.sin(data.idle * 31 + flame.position.x * 40) * 0.25 + air * 1.2;

  // Hands: strong hand on the grip, support hand out along the fore-end (no further than the gun is long).
  euler.set(data.gun.rotation.x, data.gun.rotation.y, data.gun.rotation.z);
  grip.set(...(hold.grip || GRIP)).applyEuler(euler).add(data.gun.position);
  data.arms.forEach((arm) => {
    const right = arm.side > 0;
    if (dead) target.set(arm.side * 0.34, -0.42, right ? 0.05 : -0.12);
    else if (right) target.copy(grip);
    else if (hold.support) target.set(hold.support[0], hold.support[1], Math.max(hold.support[2], -held.reach * 0.62)).applyEuler(euler).add(grip);
    else target.set(...REST.left).setY(REST.left[1] + breath * 0.004);
    arm.at.lerp(target, ease(dead ? 5 : 14));
    solveArm(arm, shoulderAt(arm.side, data.blade, shoulder), arm.at, right ? POLE_R : POLE_L);
  });
}
