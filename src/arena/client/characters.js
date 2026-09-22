// Third-person operators: procedural model + animation, snapshot interpolation
// for remote players, decoys, drones, and replay playback (killcam / final kill).
import * as THREE from 'three';
import { BODY, FLAG, INTERP_DELAY, MATERIALS, WEAPONS } from '../shared/constants.js';
import { bus, game, isEnemy } from './state.js';
import { playFootstep, startLoop, loop } from './audio.js';
import { TEAM_COLORS, animateOperator, buildOperator, operatorAction, styleOperator } from './operator.js';

export { animateOperator, buildOperator, styleOperator };

const DUMMY_LOOK = { color: '#d9d4c8', accent: '#ff7148', name: '' };
// The parts of a roster entry that dress an operator.
export const lookOf = (entry = {}) => ({ color: entry.color, accent: entry.accent, headgear: entry.headgear || 'helmet', face: entry.face || 'visor', pack: entry.pack || 'radio', pattern: entry.pattern || 'solid', charm: entry.charm || 'none', skins: entry.skins || {}, builds: entry.builds || {} });
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

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
    this.move = [0, 0]; this.last = { x: 0, z: 0 };
    this.dead = 0;
    this.tag = null; this.tagText = '';
    this.mark = markSprite();
    this.mark.position.y = 2.15;
    this.mark.visible = false;
    this.root.add(this.mark);
    this.styleKey = null;
    this.ghost = false;
  }

  style(entry, friendly, hologram = false) {
    // A look changes when someone edits it, not every frame, so this only has to be cheap when it has
    // not. The roster hands out a fresh object on a change, so skins compare by identity.
    const was = this.styleKey;
    if (was && was.color === entry.color && was.accent === entry.accent && was.headgear === entry.headgear
      && was.face === entry.face && was.pack === entry.pack && was.pattern === entry.pattern
      && was.charm === entry.charm && was.skins === entry.skins && was.builds === entry.builds && was.name === entry.name
      && was.friendly === friendly && was.hologram === hologram) return;
    this.styleKey = { color: entry.color, accent: entry.accent, headgear: entry.headgear, face: entry.face,
      pack: entry.pack, pattern: entry.pattern, charm: entry.charm, skins: entry.skins, builds: entry.builds, name: entry.name, friendly, hologram };
    styleOperator(this.model, { ...lookOf(entry), team: friendly ? 'friend' : 'foe' });
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
    // Which way they are moving relative to where they face, so the legs can strafe and back-pedal.
    if (dt > 0 && moved < 3) {
      const vx = (sample.x - this.last.x) / dt, vz = (sample.z - this.last.z) / dt;
      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw), k = Math.min(1, dt * 10);
      this.move[0] += ((vx * cos - vz * sin) - this.move[0]) * k;
      this.move[1] += (-(vx * sin + vz * cos) - this.move[1]) * k;
    }
    this.last.x = sample.x; this.last.z = sample.z;
    animateOperator(this.model, { speed: s.speed, crouch: Boolean(s.flags & FLAG.crouch), pitch: s.pitch, weapon: s.weapon, dt, move: this.move, air: !(s.flags & FLAG.ground), scoped: Boolean(s.flags & FLAG.scoped), reloading: Boolean(s.flags & FLAG.reloading) });
    // High in the air means the royale drop: they come down under a canopy.
    const dropping = !(s.flags & FLAG.ground) && s.y > 14;
    if (dropping && !this.chute) {
      this.chute = new THREE.Group();
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.3, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshStandardMaterial({ color: game.roster.get(this.id)?.color || '#e6edf1', roughness: 0.9, side: THREE.DoubleSide, flatShading: true }));
      canopy.position.y = 3.4; canopy.scale.y = 0.75;
      this.chute.add(canopy);
      for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.4, 4), new THREE.MeshBasicMaterial({ color: '#0b0f13' })); line.position.set(x * 0.5, 3.1, z * 0.5); line.rotation.set(z * 0.27, 0, -x * 0.27); this.chute.add(line); }
      this.root.add(this.chute);
    }
    if (this.chute) this.chute.visible = dropping && s.y < 75;
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

  // A pilot fired or swung: their model shows it.
  act(id, action, amount = 1) { const entity = (this.replay?.entities.get(id)) || this.entities.get(id); if (entity) operatorAction(entity.model, action, amount); }

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
    styleOperator(model, { ...lookOf(entry), team: isEnemy(id) ? 'foe' : 'friend' });
    animateOperator(model, { speed: 0, crouch: Boolean(source.flags & FLAG.crouch), pitch: source.pitch || 0, weapon: source.weapon || 'm44', dt: 1 });
    const root = new THREE.Group();
    root.add(model);
    root.position.set(source.x, source.y, source.z);
    model.rotation.y = source.yaw;
    this.scene.add(root);
    root.visible = !this.replay;
    this.corpses.push({ root, model, age: 0, weapon: source.weapon || 'm44', fall: Math.random() < 0.5 ? 1 : -1 });
    if (entity) { entity.root.visible = false; entity.buffer = []; }
  }

  clearCorpses() { this.corpses.forEach((corpse) => this.scene.remove(corpse.root)); this.corpses = []; }

  startReplay(replay, onDone, { speed = 1, from = 0 } = {}) {
    this.replay = { data: replay, time: from, speed, onDone, entities: new Map() };
    for (const [id, track] of Object.entries(replay.tracks)) {
      const entity = new Entity(`replay-${id}`, this.scene);
      entity.id = id;
      const entry = game.roster.get(id) || {};
      entity.style({ ...entry, name: '' }, !isEnemy(id));
      entity.buffer = track.map(([t, x, y, z, yaw, pitch, flags, weapon]) => ({ t, x, y, z, yaw, pitch, flags, weapon: weapon || (replay.weapon && id === replay.killer ? replay.weapon : 'm44') }));
      this.replay.entities.set(id, entity);
    }
    this.entities.forEach((entity) => { entity.root.visible = false; });
    // A replay rewinds the fight: the bodies lying around belong to the present, so they go away while
    // it plays. Otherwise a pilot is on the floor and up and walking at the same time.
    this.corpses.forEach((corpse) => { corpse.root.visible = false; });
  }

  stopReplay() {
    if (!this.replay) return;
    this.replay.entities.forEach((entity) => entity.dispose());
    this.replay = null;
    this.corpses.forEach((corpse) => { corpse.root.visible = true; });
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
      }
      for (const entity of this.decoys.values()) {
        const owner = game.roster.get(entity.owner);
        const sample = entity.sampleAt(renderTime);
        entity.root.visible = Boolean(sample && owner);
        if (!sample || !owner) continue;
        const friendly = !isEnemy(entity.owner);
        entity.style({ ...owner, name: friendly ? `${owner.name} · DECOY` : '' }, friendly, friendly);
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
    // Bodies hold still (and stay hidden) while a replay is on screen.
    for (const corpse of this.corpses) {
      if (this.replay) { corpse.root.visible = false; continue; }
      corpse.age += dt;
      const k = Math.min(1, corpse.age / 0.55);
      const ease = 1 - (1 - k) ** 3;
      // Knees go first, then the body follows them down.
      const tip = Math.max(0, (k - 0.25) / 0.75), fall = 1 - (1 - tip) ** 2;
      if (corpse.age < 1.2) animateOperator(corpse.model, { speed: 0, crouch: false, pitch: 0, weapon: corpse.weapon, dt, dead: Math.min(1, corpse.age / 0.35) });
      corpse.model.rotation.x = fall * (Math.PI / 2) * corpse.fall;
      corpse.model.position.y = fall * 0.14;
      if (corpse.age > 7) corpse.root.position.y -= dt * 0.4;
    }
    this.corpses = this.corpses.filter((corpse) => { if (corpse.age > 9) { this.scene.remove(corpse.root); return false; } return true; });
    void camera;
  }
}

export { BODY };
