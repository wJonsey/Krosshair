// Third-person operators: procedural model + animation, snapshot interpolation
// for remote players, decoys, drones, and replay playback (killcam / final kill).
import * as THREE from 'three';
import { BODY, FLAG, INTERP_DELAY, MATERIALS, WEAPONS } from '../shared/constants.js';
import { bus, game, isEnemy } from './state.js';
import { playFootstep, startLoop, loop } from './audio.js';

const DUMMY_LOOK = { color: '#d9d4c8', accent: '#ff7148', name: '' };
const TEAM_COLORS = { friend: '#6ce6d1', foe: '#ff4d3d' };
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: options.rough ?? 0.6, metalness: options.metal ?? 0.1, emissive: options.emissive ?? '#000000', emissiveIntensity: options.glow ?? 0 });
}

// Geometry is shared by every operator in the match; only materials are per pilot.
const GEO = {};
const geo = (key, make) => (GEO[key] ||= make());
const UP = new THREE.Vector3(0, 1, 0);
// A limb segment between two points: a capsule whose round ends read as joints.
function bone(group, from, to, radius, material) {
  const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
  const length = a.distanceTo(c);
  const mesh = new THREE.Mesh(geo(`bone:${radius}:${length.toFixed(3)}`, () => new THREE.CapsuleGeometry(radius, length, 4, 10)), material);
  mesh.position.copy(a).add(c).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, c.sub(a).normalize());
  group.add(mesh);
  return mesh;
}
function block(group, key, size, material, position, rotation = null) {
  const mesh = new THREE.Mesh(geo(`box:${key}`, () => new THREE.BoxGeometry(...size)), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

// Builds a 1.8 m operator: fatigues, plate carrier, helmet with a wrap-around visor, jointed arms on
// the rifle. The pilot's suit colour is on the sleeves, shoulders, thighs and helmet stripe so it reads
// at range; the visor carries the accent; white strips take the team colour. Animated parts live in
// userData. Proportions follow the hit zones in shared/combat.js (head centre 1.6 m, torso 0.9–1.4 m).
export function buildOperator(color = '#ec6a9e', accent = '#6ce6d1') {
  const root = new THREE.Group();
  const suit = mat(color, { rough: 0.6 });
  const dark = mat('#2b333c', { rough: 0.85 });
  const gear = mat('#3d4853', { rough: 0.55, metal: 0.2 });
  const plate = mat('#56636f', { rough: 0.5, metal: 0.25 });
  const skin = mat('#c99a7c', { rough: 0.85 });
  const visorMat = mat(accent, { emissive: accent, glow: 1.4, rough: 0.15, metal: 0.4 });
  const teamMat = mat('#ffffff', { emissive: '#ffffff', glow: 1.8 });

  // --- hips and legs ---------------------------------------------------------------------------
  const hips = new THREE.Group();
  hips.position.y = 0.96;
  root.add(hips);
  block(hips, 'pelvis', [0.38, 0.22, 0.25], dark, [0, 0, 0]);
  block(hips, 'belt', [0.41, 0.07, 0.28], gear, [0, 0.09, 0]);
  block(hips, 'buckle', [0.07, 0.05, 0.02], plate, [0, 0.09, -0.145]);
  block(hips, 'holster', [0.07, 0.2, 0.13], gear, [0.215, -0.1, 0.0]);
  block(hips, 'pouch', [0.08, 0.13, 0.12], gear, [-0.215, -0.02, 0.03]);
  block(hips, 'dump', [0.16, 0.13, 0.07], gear, [0.06, -0.01, 0.16]);
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.105, -0.06, 0);
    bone(pivot, [0, 0, 0], [side * 0.01, -0.4, 0], 0.088, dark);
    block(pivot, 'thighPanel', [0.11, 0.2, 0.025], suit, [side * 0.01, -0.2, -0.085]);
    const knee = new THREE.Group();
    knee.position.set(side * 0.01, -0.44, 0);
    bone(knee, [0, 0, 0], [0, -0.36, 0.01], 0.07, dark);
    block(knee, 'kneePad', [0.13, 0.13, 0.06], plate, [0, 0.0, -0.075]);
    block(knee, 'kneeStripe', [0.13, 0.025, 0.065], suit, [0, -0.02, -0.078]);
    const foot = new THREE.Group();
    foot.position.set(0, -0.4, 0);
    block(foot, 'boot', [0.125, 0.12, 0.27], gear, [0, -0.01, -0.05]);
    block(foot, 'sole', [0.135, 0.035, 0.29], dark, [0, -0.075, -0.05]);
    block(foot, 'cuff', [0.13, 0.08, 0.15], dark, [0, 0.07, 0.0]);
    knee.add(foot);
    pivot.add(knee);
    hips.add(pivot);
    return { pivot, knee, foot };
  });

  // --- torso ----------------------------------------------------------------------------------------
  const spine = new THREE.Group();
  spine.position.y = 0.1;
  hips.add(spine);
  const belly = new THREE.Mesh(geo('belly', () => new THREE.CapsuleGeometry(0.155, 0.12, 4, 10)), dark);
  belly.position.y = 0.1; belly.scale.set(1.08, 1, 0.78);
  const chest = new THREE.Mesh(geo('chest', () => new THREE.CapsuleGeometry(0.185, 0.16, 4, 12)), suit);
  chest.position.y = 0.31; chest.scale.set(1.12, 1, 0.74);
  spine.add(belly, chest);
  // Plate carrier: front and back plates, cummerbund, three magazine pouches, a radio.
  block(spine, 'plateF', [0.31, 0.3, 0.05], plate, [0, 0.31, -0.15], [0.06, 0, 0]);
  block(spine, 'plateB', [0.31, 0.32, 0.05], plate, [0, 0.31, 0.15], [-0.04, 0, 0]);
  block(spine, 'cummer', [0.43, 0.13, 0.27], gear, [0, 0.19, 0]);
  for (const x of [-0.1, 0, 0.1]) block(spine, 'mag', [0.082, 0.13, 0.05], gear, [x, 0.2, -0.185], [0.08, 0, 0]);
  block(spine, 'radio', [0.06, 0.13, 0.05], dark, [-0.13, 0.36, -0.185]);
  block(spine, 'strapL', [0.06, 0.04, 0.3], gear, [-0.12, 0.47, 0]);
  block(spine, 'strapL', [0.06, 0.04, 0.3], gear, [0.12, 0.47, 0]);
  // Pack with a whip antenna.
  block(spine, 'pack', [0.28, 0.3, 0.13], dark, [0, 0.31, 0.24]);
  block(spine, 'packTop', [0.22, 0.08, 0.1], gear, [0, 0.49, 0.22]);
  const antenna = new THREE.Mesh(geo('antenna', () => new THREE.CylinderGeometry(0.006, 0.009, 0.42, 5)), dark);
  antenna.position.set(0.1, 0.7, 0.26); antenna.rotation.x = 0.12;
  spine.add(antenna);
  // Team strips: chest, back and both shoulders, so a side is readable from any angle.
  block(spine, 'stripF', [0.2, 0.035, 0.015], teamMat, [0.02, 0.42, -0.18], [0.06, 0, 0]);
  block(spine, 'stripB', [0.22, 0.04, 0.015], teamMat, [0, 0.41, 0.31]);
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(geo('shoulder', () => new THREE.SphereGeometry(0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), suit);
    pad.position.set(side * 0.235, 0.43, 0); pad.rotation.z = -side * 0.35; pad.scale.set(1, 0.9, 1.1);
    spine.add(pad);
    block(spine, 'stripS', [0.02, 0.03, 0.12], teamMat, [side * 0.305, 0.42, 0]);
  }

  // --- head: centre at 1.62 m ---------------------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 0.56;
  bone(head, [0, -0.13, 0.01], [0, -0.03, 0], 0.055, skin);
  const face = new THREE.Mesh(geo('face', () => new THREE.SphereGeometry(0.128, 14, 10)), skin);
  face.scale.set(0.92, 1.08, 1);
  const balaclava = new THREE.Mesh(geo('balaclava', () => new THREE.SphereGeometry(0.133, 14, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48)), dark);
  balaclava.scale.set(0.95, 1.08, 1.02);
  const helmet = new THREE.Mesh(geo('helmet', () => new THREE.SphereGeometry(0.168, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)), gear);
  helmet.position.y = 0.025; helmet.scale.set(1, 0.98, 1.1);
  const stripe = new THREE.Mesh(geo('helmetStripe', () => new THREE.BoxGeometry(0.05, 0.02, 0.3)), suit);
  stripe.position.set(0, 0.185, 0.0);
  block(head, 'brim', [0.2, 0.025, 0.06], gear, [0, 0.075, -0.17], [0.25, 0, 0]);
  // Wrap-around visor: a slice of a cylinder rather than a flat bar.
  const visor = new THREE.Mesh(geo('visor', () => new THREE.CylinderGeometry(0.139, 0.139, 0.062, 18, 1, true, Math.PI - 1.05, 2.1)), visorMat);
  visor.material.side = THREE.DoubleSide;
  visor.position.set(0, 0.02, 0.0);
  for (const side of [-1, 1]) { const cup = new THREE.Mesh(geo('earCup', () => new THREE.CylinderGeometry(0.052, 0.052, 0.04, 10)), gear); cup.rotation.z = Math.PI / 2; cup.position.set(side * 0.158, 0.0, 0.015); head.add(cup); }
  block(head, 'nvgMount', [0.05, 0.05, 0.04], plate, [0, 0.135, -0.165]);
  const helmetLight = block(head, 'helmetLight', [0.05, 0.025, 0.02], teamMat, [0, 0.105, -0.183]);
  block(head, 'rearLight', [0.06, 0.025, 0.02], teamMat, [0, 0.06, 0.185]);
  head.add(face, balaclava, helmet, stripe, visor);
  spine.add(head);

  // --- arms and weapon pitch together about the shoulders -----------------------------------------------------
  const aim = new THREE.Group();
  aim.position.y = 0.44;
  spine.add(aim);
  const gun = new THREE.Group();
  gun.position.set(0.11, -0.07, -0.1);
  const gunBody = block(gun, 'gunBody', [0.055, 0.095, 0.5], gear, [0, 0, -0.3]);
  block(gun, 'gunGuard', [0.06, 0.07, 0.24], dark, [0, -0.005, -0.62]);
  block(gun, 'gunGrip', [0.04, 0.11, 0.05], dark, [0, -0.09, -0.1], [-0.3, 0, 0]);
  const gunMag = block(gun, 'gunMag', [0.04, 0.15, 0.065], dark, [0, -0.11, -0.34], [0.15, 0, 0]);
  const gunBarrel = new THREE.Mesh(geo('gunBarrel', () => new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8)), dark);
  gunBarrel.rotation.x = Math.PI / 2; gunBarrel.position.set(0, 0.015, -0.95);
  const gunScope = new THREE.Mesh(geo('gunScope', () => new THREE.CylinderGeometry(0.028, 0.028, 0.26, 10)), dark);
  gunScope.rotation.x = Math.PI / 2; gunScope.position.set(0, 0.088, -0.34);
  const gunStock = block(gun, 'gunStock', [0.045, 0.11, 0.26], dark, [0, -0.02, 0.06]);
  gun.add(gunBarrel, gunScope);
  // Right hand on the grip, left hand forward on the guard; elbows out like someone who has done this before.
  const arms = new THREE.Group();
  bone(arms, [0.215, -0.01, 0.0], [0.29, -0.22, -0.06], 0.058, suit);
  bone(arms, [0.29, -0.22, -0.06], [0.125, -0.15, -0.2], 0.05, suit);
  block(arms, 'glove', [0.075, 0.075, 0.09], gear, [0.115, -0.15, -0.21]);
  bone(arms, [-0.215, -0.01, 0.0], [-0.24, -0.2, -0.3], 0.058, suit);
  bone(arms, [-0.24, -0.2, -0.3], [0.06, -0.12, -0.66], 0.05, suit);
  block(arms, 'glove', [0.075, 0.075, 0.09], gear, [0.085, -0.115, -0.69]);
  for (const x of [0.29, -0.24]) block(arms, 'elbowPad', [0.085, 0.085, 0.085], plate, [x, x > 0 ? -0.22 : -0.2, x > 0 ? -0.06 : -0.3]);
  aim.add(gun, arms);

  root.traverse((part) => { if (part.isMesh) { part.castShadow = true; part.receiveShadow = true; } });
  antenna.castShadow = false;
  root.userData = { hips, spine, head, aim, legs, gun, gunBody, gunBarrel, gunScope, gunStock, gunMag, helmetLight, suit, visorMat, teamMat, phase: Math.random() * 6, idle: Math.random() * 6, crouch: 0, lean: 0, materials: [suit, dark, gear, plate, skin, visorMat, teamMat] };
  return root;
}

export function styleOperator(root, { color, accent, team }) {
  const data = root.userData;
  if (color) data.suit.color.set(color);
  if (accent) { data.visorMat.color.set(accent); data.visorMat.emissive.set(accent); }
  if (team) { data.teamMat.color.set(TEAM_COLORS[team]); data.teamMat.emissive.set(TEAM_COLORS[team]); }
}

const GUN_SHAPES = { sniper: [1, true], marksman: [0.95, true], lmg: [1, true], rifle: [0.85, true], shotgun: [0.95, true], smg: [0.68, true], pistol: [0.42, false] };
// pose: { speed, crouch, pitch, weapon, dt }
export function animateOperator(root, pose) {
  const data = root.userData;
  data.crouch += ((pose.crouch ? 1 : 0) - data.crouch) * Math.min(1, pose.dt * 12);
  const c = data.crouch;
  const pace = Math.min(pose.speed, 7);
  data.phase += pose.dt * pace * 1.9;
  data.idle += pose.dt;
  const stride = Math.min(1, pose.speed / 5) * (1 - c * 0.4);
  data.lean += (stride - data.lean) * Math.min(1, pose.dt * 8);
  const swing = Math.sin(data.phase) * 0.78 * stride;
  const breath = Math.sin(data.idle * 1.7) * (1 - stride);
  // Hips: bob twice per stride, sway side to side, and drop for the crouch.
  data.hips.position.y = 0.96 - c * 0.42 + Math.abs(Math.cos(data.phase)) * 0.04 * stride;
  data.hips.position.x = Math.sin(data.phase) * 0.018 * stride;
  data.hips.rotation.y = Math.sin(data.phase) * 0.16 * stride;
  data.hips.rotation.z = Math.sin(data.phase) * 0.03 * stride;
  data.legs.forEach(({ pivot, knee, foot }, index) => {
    const s = index === 0 ? swing : -swing;
    pivot.rotation.x = s - c * 1.15;
    knee.rotation.x = Math.max(0, -s) * 1.05 + c * 1.9 + stride * 0.22;
    // Heel strike and toe-off, and flat on the ground when crouched.
    foot.rotation.x = -(pivot.rotation.x + knee.rotation.x) * (c > 0.5 ? 1 : 0.35) + Math.max(0, s) * 0.3 * stride;
  });
  // Shoulders counter-rotate against the hips; the torso leans into a run and breathes when still.
  data.spine.rotation.x = c * 0.28 + data.lean * 0.13;
  data.spine.rotation.y = -Math.sin(data.phase) * 0.24 * stride;
  data.spine.position.y = 0.1 + breath * 0.004;
  data.aim.rotation.x = pose.pitch - data.spine.rotation.x;
  data.aim.rotation.y = Math.sin(data.phase) * 0.1 * stride;
  data.aim.position.y = 0.44 + breath * 0.005 + Math.abs(Math.sin(data.phase)) * 0.012 * stride;
  data.head.rotation.x = pose.pitch * 0.6 - data.lean * 0.08;
  data.head.rotation.y = Math.sin(data.phase) * 0.12 * stride;
  // The weapon in their hands matches what they are carrying.
  const weapon = WEAPONS[pose.weapon] || WEAPONS.m44;
  const [length, long] = weapon.melee ? [0.3, false] : GUN_SHAPES[weapon.slot === 'sidearm' && weapon.family !== 'shotgun' ? 'pistol' : weapon.family] || GUN_SHAPES.pistol;
  data.gun.scale.z = length;
  data.gunBarrel.visible = !weapon.melee;
  data.gunStock.visible = long;
  data.gunMag.visible = !weapon.melee && weapon.action !== 'bolt' && weapon.family !== 'shotgun';
  data.gunScope.visible = Boolean(weapon.scope && weapon.scope[0] < 40);
}

function nameTag(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 64;
  const context = canvas.getContext('2d');
  context.font = '400 30px "Michroma", sans-serif';
  context.textAlign = 'center';
  context.fillStyle = 'rgba(7,9,12,.7)';
  const width = Math.min(300, context.measureText(text).width + 44);
  context.fillRect(160 - width / 2, 10, width, 44);
  context.fillStyle = color;
  context.fillRect(160 - width / 2, 10, 4, 44);
  context.fillText(text.toUpperCase(), 164, 43);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false, sizeAttenuation: false }));
  sprite.scale.set(0.16, 0.032, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function markSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  context.translate(32, 32); context.rotate(Math.PI / 4);
  context.strokeStyle = '#ff4d3d'; context.lineWidth = 6; context.strokeRect(-15, -15, 30, 30);
  context.fillStyle = 'rgba(255,77,61,.35)'; context.fillRect(-15, -15, 30, 30);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, fog: false, sizeAttenuation: false }));
  sprite.scale.set(0.035, 0.035, 1);
  sprite.renderOrder = 21;
  return sprite;
}

function buildDrone() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), mat('#222a33', { metal: 0.5, rough: 0.4 }));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#ff7148', { emissive: '#ff7148', glow: 2 }));
  eye.position.set(0, -0.03, -0.17);
  group.add(body, eye);
  group.userData.rotors = [];
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) {
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.012, 12), new THREE.MeshBasicMaterial({ color: '#9fb2c4', transparent: true, opacity: 0.35 }));
    rotor.position.set(x, 0.07, z);
    group.add(rotor);
  }
  group.traverse((part) => { if (part.isMesh) part.castShadow = true; });
  return group;
}

class Entity {
  constructor(id, scene) {
    this.id = id;
    this.scene = scene;
    this.model = buildOperator();
    this.root = new THREE.Group();
    this.root.add(this.model);
    this.root.visible = false;
    scene.add(this.root);
    this.buffer = [];
    this.state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, weapon: 'm44', speed: 0 };
    this.stride = 0;
    this.dead = 0;
    this.tag = null; this.tagText = '';
    this.mark = markSprite();
    this.mark.position.y = 2.15;
    this.mark.visible = false;
    this.root.add(this.mark);
    this.styleKey = '';
    this.ghost = false;
  }

  style(entry, friendly, hologram = false) {
    const key = `${entry.color}|${entry.accent}|${friendly}|${entry.name}|${hologram}`;
    if (key === this.styleKey) return;
    this.styleKey = key;
    styleOperator(this.model, { color: entry.color, accent: entry.accent, team: friendly ? 'friend' : 'foe' });
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag = null; }
    if (friendly && entry.name) { this.tag = nameTag(entry.name, TEAM_COLORS.friend); this.tag.position.y = 2.1; this.root.add(this.tag); }
    this.model.userData.materials.forEach((material) => { material.transparent = hologram; material.opacity = hologram ? 0.45 : 1; });
  }

  push(sample) {
    this.buffer.push(sample);
    if (this.buffer.length > 40) this.buffer.shift();
  }

  sampleAt(time) {
    const buffer = this.buffer;
    if (!buffer.length) return null;
    if (time <= buffer[0].t) return buffer[0];
    for (let i = buffer.length - 1; i > 0; i -= 1) {
      const a = buffer[i - 1], b = buffer[i];
      if (time >= a.t && time <= b.t) {
        const k = (time - a.t) / Math.max(1e-6, b.t - a.t);
        return { t: time, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k), pitch: a.pitch + (b.pitch - a.pitch) * k, flags: b.flags, weapon: b.weapon };
      }
    }
    // Ran out of data: hold the last pose, with a touch of extrapolation.
    const last = buffer[buffer.length - 1], prev = buffer[buffer.length - 2];
    if (!prev || time - last.t > 0.25) return last;
    const k = (time - last.t) / Math.max(1e-6, last.t - prev.t);
    return { ...last, x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k, z: last.z + (last.z - prev.z) * k };
  }

  apply(sample, dt, { footsteps = true } = {}) {
    const s = this.state;
    const moved = Math.hypot(sample.x - s.x, sample.z - s.z);
    const speed = dt > 0 ? Math.min(9, moved / dt) : 0;
    s.speed += (speed - s.speed) * Math.min(1, dt * 10);
    Object.assign(s, { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, pitch: sample.pitch, flags: sample.flags, weapon: sample.weapon || s.weapon });
    this.root.position.set(s.x, s.y, s.z);
    this.model.rotation.y = s.yaw;
    animateOperator(this.model, { speed: s.speed, crouch: Boolean(s.flags & FLAG.crouch), pitch: s.pitch, weapon: s.weapon, dt });
    const loud = s.speed > 3.6 && (s.flags & FLAG.ground) && !(s.flags & (FLAG.crouch | FLAG.ghost | FLAG.walking));
    if (footsteps && loud) {
      this.stride += moved;
      if (this.stride > 2.1) { this.stride = 0; playFootstep(this.surface?.(s.x, s.y, s.z) || 'concrete', [s.x, s.y + 0.1, s.z], isEnemy(this.id) ? 0.8 : 0.45); bus.emit('sound', { kind: 'step', id: this.id, pos: [s.x, s.y, s.z] }); }
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((part) => { if (part.isMesh) part.geometry.dispose(); });
  }
}

export class Operators {
  constructor(scene, physics) {
    this.scene = scene;
    this.physicsRef = physics;
    this.entities = new Map();
    this.decoys = new Map();
    this.drones = new Map();
    this.corpses = [];
    this.replay = null;
    this.hidden = null; // id hidden because we are looking through their eyes
    this.lastSoundBlip = new Map();
  }

  surfaceAt(x, y, z) {
    const world = this.physicsRef();
    let sound = 'concrete', best = -Infinity;
    world.query(x, z, x, z, (box) => {
      if (x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2] && box.max[1] <= y + 0.2 && box.max[1] > best) { best = box.max[1]; sound = MATERIALS[box.mat]?.sound || 'concrete'; }
      return false;
    });
    return sound;
  }

  entity(id) {
    if (!this.entities.has(id)) {
      const entity = new Entity(id, this.scene);
      entity.surface = (x, y, z) => this.surfaceAt(x, y, z);
      this.entities.set(id, entity);
    }
    return this.entities.get(id);
  }

  remove(id) { const entity = this.entities.get(id); if (entity) { entity.dispose(); this.entities.delete(id); } }
  clear() { [...this.entities.keys()].forEach((id) => this.remove(id)); [...this.decoys.keys()].forEach((id) => this.removeDecoy(id)); [...this.drones.keys()].forEach((id) => this.removeDrone(id)); this.corpses.forEach((c) => this.scene.remove(c.root)); this.corpses = []; }

  onSnapshot(message) {
    const seen = new Set();
    for (const [id, x, y, z, yaw, pitch, flags, weapon, dummy] of message.p) {
      seen.add(id);
      if (id === game.id) continue;
      const entity = this.entity(id);
      entity.dummy = Boolean(dummy);
      entity.push({ t: message.t, x, y, z, yaw, pitch, flags, weapon });
    }
    this.present = seen;
    const decoys = new Set();
    for (const [id, owner, x, y, z, yaw] of message.c || []) {
      decoys.add(id);
      if (!this.decoys.has(id)) { const entity = new Entity(id, this.scene); entity.owner = owner; entity.surface = (px, py, pz) => this.surfaceAt(px, py, pz); this.decoys.set(id, entity); }
      this.decoys.get(id).push({ t: message.t, x, y, z, yaw, pitch: 0, flags: FLAG.ground, weapon: 'm44' });
    }
    for (const id of [...this.decoys.keys()]) if (!decoys.has(id)) this.removeDecoy(id);
    const drones = new Set();
    for (const [owner, x, y, z, yaw] of message.d || []) {
      drones.add(owner);
      if (!this.drones.has(owner)) { const mesh = buildDrone(); this.scene.add(mesh); this.drones.set(owner, { mesh, target: new THREE.Vector3(x, y, z), yaw }); mesh.position.set(x, y, z); if (owner !== game.id) startLoop(`drone-${owner}`, 'drone', [x, y, z]); }
      const drone = this.drones.get(owner);
      drone.target.set(x, y, z); drone.yaw = yaw;
    }
    for (const id of [...this.drones.keys()]) if (!drones.has(id)) this.removeDrone(id);
  }

  removeDecoy(id) { const entity = this.decoys.get(id); if (entity) { entity.dispose(); this.decoys.delete(id); } }
  removeDrone(id) { const drone = this.drones.get(id); if (drone) { this.scene.remove(drone.mesh); this.drones.delete(id); loop(`drone-${id}`)?.stop(); } }

  // Interpolated position used for local tracer prediction and spectating.
  poseOf(id) { return this.entities.get(id)?.state || null; }

  targets() {
    const list = [];
    for (const [id, entity] of this.entities) if (entity.root.visible && isEnemy(id) && !entity.dead) list.push({ id, kind: 'player', x: entity.state.x, y: entity.state.y, z: entity.state.z, crouch: Boolean(entity.state.flags & FLAG.crouch) });
    for (const [id, entity] of this.decoys) if (isEnemy(entity.owner)) list.push({ id, kind: 'decoy', x: entity.state.x, y: entity.state.y, z: entity.state.z, crouch: false });
    return list;
  }

  kill(id, local = null) {
    const entity = this.entities.get(id);
    const source = entity?.root.visible ? entity.state : local;
    if (!source) return;
    const entry = game.roster.get(id) || {};
    const model = buildOperator(entry.color, entry.accent);
    styleOperator(model, { team: isEnemy(id) ? 'foe' : 'friend' });
    animateOperator(model, { speed: 0, crouch: false, pitch: 0, weapon: 'm44', dt: 1 });
    const root = new THREE.Group();
    root.add(model);
    root.position.set(source.x, source.y, source.z);
    model.rotation.y = source.yaw;
    this.scene.add(root);
    this.corpses.push({ root, model, age: 0, fall: Math.random() < 0.5 ? 1 : -1 });
    if (entity) { entity.root.visible = false; entity.buffer = []; }
  }

  clearCorpses() { this.corpses.forEach((corpse) => this.scene.remove(corpse.root)); this.corpses = []; }

  startReplay(replay, onDone, { speed = 1, from = 0 } = {}) {
    this.replay = { data: replay, time: from, speed, onDone, entities: new Map() };
    for (const [id, track] of Object.entries(replay.tracks)) {
      const entity = new Entity(`replay-${id}`, this.scene);
      entity.id = id;
      const entry = game.roster.get(id) || {};
      entity.style({ color: entry.color, accent: entry.accent, name: '' }, !isEnemy(id));
      entity.buffer = track.map(([t, x, y, z, yaw, pitch, flags, weapon]) => ({ t, x, y, z, yaw, pitch, flags, weapon: weapon || (replay.weapon && id === replay.killer ? replay.weapon : 'm44') }));
      this.replay.entities.set(id, entity);
    }
    this.entities.forEach((entity) => { entity.root.visible = false; });
  }

  stopReplay() {
    if (!this.replay) return;
    this.replay.entities.forEach((entity) => entity.dispose());
    this.replay = null;
  }

  update(dt, serverTime, camera, wallDt = dt) {
    if (this.replay) {
      const replay = this.replay;
      replay.time += wallDt * replay.speed;
      for (const [id, entity] of replay.entities) {
        const last = entity.buffer[entity.buffer.length - 1];
        const sample = entity.sampleAt(Math.min(replay.time, last.t));
        const gone = replay.time > last.t + 0.08 && id === replay.data.victim;
        entity.root.visible = id !== this.hidden && !gone;
        if (sample) entity.apply(sample, dt * replay.speed, { footsteps: false });
      }
      if (replay.time >= replay.data.duration + 0.7) { const done = replay.onDone; this.stopReplay(); done?.(); }
    } else {
      const renderTime = serverTime - INTERP_DELAY;
      const now = performance.now() / 1000;
      for (const [id, entity] of this.entities) {
        const entry = game.roster.get(id) || (entity.dummy ? DUMMY_LOOK : null);
        const alive = this.present?.has(id) && entry;
        const sample = alive ? entity.sampleAt(renderTime) : null;
        entity.root.visible = Boolean(sample) && id !== this.hidden;
        if (!sample) continue;
        entity.style(entry, !isEnemy(id));
        entity.apply(sample, dt);
        const mark = game.marks.get(id);
        entity.mark.visible = Boolean(mark && mark.until > serverTime && isEnemy(id));
        if (entity.tag) entity.tag.visible = true;
        void now;
      }
      for (const entity of this.decoys.values()) {
        const owner = game.roster.get(entity.owner);
        const sample = entity.sampleAt(renderTime);
        entity.root.visible = Boolean(sample && owner);
        if (!sample || !owner) continue;
        const friendly = !isEnemy(entity.owner);
        entity.style({ color: owner.color, accent: owner.accent, name: friendly ? `${owner.name} · DECOY` : '' }, friendly, friendly);
        entity.id = entity.owner;
        entity.apply(sample, dt);
      }
    }
    for (const [owner, drone] of this.drones) {
      drone.mesh.position.lerp(drone.target, Math.min(1, dt * 12));
      drone.mesh.rotation.y = lerpAngle(drone.mesh.rotation.y, drone.yaw, Math.min(1, dt * 10));
      drone.mesh.visible = owner !== game.id || !this.pilotView;
      loop(`drone-${owner}`)?.move(drone.mesh.position.x, drone.mesh.position.y, drone.mesh.position.z);
    }
    for (const corpse of this.corpses) {
      corpse.age += dt;
      const k = Math.min(1, corpse.age / 0.55);
      const ease = 1 - (1 - k) ** 3;
      corpse.model.rotation.x = ease * (Math.PI / 2) * corpse.fall;
      corpse.model.position.y = ease * 0.12;
      if (corpse.age > 7) corpse.root.position.y -= dt * 0.4;
    }
    this.corpses = this.corpses.filter((corpse) => { if (corpse.age > 9) { this.scene.remove(corpse.root); return false; } return true; });
    void camera;
  }
}

export { BODY };
