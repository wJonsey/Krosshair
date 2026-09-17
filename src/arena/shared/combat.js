// Hit detection shared by the server (authoritative) and the client (instant
// tracers / impact prediction). No allocations of engine types in here.
import { BODY, MATERIALS, clamp } from './constants.js';

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
export function anglesFromDir(dir) {
  return { yaw: Math.atan2(-dir[0], -dir[2]), pitch: Math.asin(clamp(dir[1], -1, 1)) };
}

// Bloom grows with every shot and decays over time. Both ends run the same maths.
export class SpreadTracker {
  constructor() { this.bloom = 0; this.last = 0; }
  current(weapon, now) {
    return Math.max(0, this.bloom - (now - this.last) * (weapon.spread.bloomMax || 1) * 2.2);
  }
  shot(weapon, now) {
    const value = this.current(weapon, now);
    this.bloom = Math.min(weapon.spread.bloomMax, value + weapon.spread.bloom);
    this.last = now;
    return value;
  }
}

// state: { scoped, speed (m/s horizontal), airborne, crouched, bloom }
export function spreadAngle(weapon, state) {
  const s = weapon.spread;
  let angle = state.scoped ? s.ads : s.hip;
  angle += s.move * clamp(state.speed / BODY.runSpeed, 0, 1.2) * (state.scoped ? 0.6 : 1);
  if (state.airborne) angle += s.air;
  if (state.crouched) angle *= 0.75;
  return angle + (state.bloom || 0);
}

export function applySpread(dir, angleDeg, rng) {
  if (angleDeg <= 0) return dir;
  const radius = Math.tan((angleDeg * Math.PI) / 180) * Math.sqrt(rng());
  const theta = rng() * Math.PI * 2;
  // Build a basis around dir.
  const up = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const right = normalize(cross(dir, up));
  const realUp = cross(right, dir);
  const ox = Math.cos(theta) * radius, oy = Math.sin(theta) * radius;
  return normalize([
    dir[0] + right[0] * ox + realUp[0] * oy,
    dir[1] + right[1] * ox + realUp[1] * oy,
    dir[2] + right[2] * ox + realUp[2] * oy,
  ]);
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(v) { const length = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / length, v[1] / length, v[2] / length]; }

// Hit shapes, relative to the feet. [zone, y0, y1, radius] (y0 === y1 → sphere)
const STAND_SHAPES = [['head', 1.6, 1.6, 0.21], ['torso', 0.92, 1.36, 0.29], ['limb', 0.22, 0.8, 0.25], ['limb', 1.0, 1.34, 0.45]];
const CROUCH_SHAPES = [['head', 1.07, 1.07, 0.21], ['torso', 0.52, 0.84, 0.3], ['limb', 0.2, 0.42, 0.32], ['limb', 0.58, 0.82, 0.45]];
const ZONE_RANK = { head: 3, torso: 2, limb: 1 };

function raySphere(origin, dir, cx, cy, cz, radius) {
  const ox = origin[0] - cx, oy = origin[1] - cy, oz = origin[2] - cz;
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const t = -b - root;
  if (t >= 0) return t;
  return -b + root >= 0 ? 0 : Infinity;
}
function rayVerticalCapsule(origin, dir, cx, cz, y0, y1, radius) {
  let best = Math.min(raySphere(origin, dir, cx, y0, cz, radius), raySphere(origin, dir, cx, y1, cz, radius));
  const ox = origin[0] - cx, oz = origin[2] - cz;
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  if (a > 1e-9) {
    const b = ox * dir[0] + oz * dir[2];
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - a * c;
    if (disc >= 0) {
      let t = (-b - Math.sqrt(disc)) / a;
      if (t < 0 && c < 0) t = 0;
      if (t >= 0) {
        const y = origin[1] + dir[1] * t;
        if (y >= y0 && y <= y1) best = Math.min(best, t);
      }
    }
  }
  return best;
}

// Returns { t, zone } for the best zone the ray passes through, or null.
export function rayPlayer(origin, dir, target) {
  const shapes = target.crouch ? CROUCH_SHAPES : STAND_SHAPES;
  let result = null;
  for (const [zone, y0, y1, radius] of shapes) {
    const t = y0 === y1
      ? raySphere(origin, dir, target.x, target.y + y0, target.z, radius)
      : rayVerticalCapsule(origin, dir, target.x, target.z, target.y + y0, target.y + y1, radius);
    if (t === Infinity) continue;
    if (!result || ZONE_RANK[zone] > ZONE_RANK[result.zone]) result = { t: result ? Math.min(t, result.t) : t, zone };
  }
  return result;
}
export function rayDrone(origin, dir, drone) {
  const t = raySphere(origin, dir, drone.x, drone.y, drone.z, 0.38);
  return t === Infinity ? null : { t, zone: 'torso' };
}

export function damageFor(weapon, zone, distance, powerScale = 1) {
  let damage = weapon.damage;
  if (zone === 'head') damage *= weapon.head; else if (zone === 'limb') damage *= weapon.limb;
  if (weapon.falloff) {
    const [start, end, floor] = weapon.falloff;
    damage *= 1 - (1 - floor) * clamp((distance - start) / (end - start), 0, 1);
  }
  return damage * powerScale;
}

// Traces one projectile through the world.
// targets: [{ id, kind: 'player'|'drone'|'decoy', x, y, z, crouch }]
// Returns { end, distance, impacts: [{ point, normal, mat, exit }], hits: [{ id, kind, zone, distance, scale, wallbang }], glass: [id], shields: [{ id, distance }] }
export function traceShot(world, origin, dir, weapon, targets, maxDist = 260) {
  const events = [];
  for (const hit of world.raycast(origin, dir, maxDist)) events.push({ t: hit.t0, world: hit });
  for (const target of targets) {
    const hit = target.kind === 'drone' ? rayDrone(origin, dir, target) : rayPlayer(origin, dir, target);
    if (hit && hit.t <= maxDist) events.push({ t: hit.t, target, zone: hit.zone });
  }
  events.sort((a, b) => a.t - b.t);
  const result = { end: null, distance: maxDist, impacts: [], hits: [], glass: [], shields: [] };
  let power = weapon.pen;
  let wallbang = false;
  const at = (t) => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  for (const event of events) {
    if (event.world) {
      const { box, t0, t1, normal } = event.world;
      if (box.glass) { result.glass.push(box.id); result.impacts.push({ point: at(t0), normal, mat: 'glass' }); power -= 0.04; continue; }
      if (box.barrier) { result.impacts.push({ point: at(t0), normal, mat: box.mat }); result.distance = t0; break; }
      if (box.shield) { result.shields.push({ id: box.id, distance: t0 }); result.impacts.push({ point: at(t0), normal, mat: 'shield' }); result.distance = t0; break; }
      const resist = MATERIALS[box.mat]?.resist ?? 99;
      const cost = (t1 - t0) * resist;
      result.impacts.push({ point: at(t0), normal, mat: box.mat });
      if (t0 <= 0 || cost >= power) { result.distance = t0; break; }
      power -= cost;
      wallbang = true;
      result.impacts.push({ point: at(t1), normal: [-normal[0], -normal[1], -normal[2]], mat: box.mat, exit: true });
    } else {
      const scale = clamp(power / weapon.pen, 0.3, 1);
      result.hits.push({ id: event.target.id, kind: event.target.kind, zone: event.zone, distance: event.t, scale, wallbang });
      // Only the long rifle carries enough energy to pass through a body.
      if (weapon.id !== 'm44' || event.target.kind !== 'player') { result.distance = event.t; break; }
      power -= 0.45;
      if (power <= 0.1) { result.distance = event.t; break; }
    }
  }
  result.end = at(result.distance);
  return result;
}
