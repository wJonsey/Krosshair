// Axis-aligned box world shared by the client (movement prediction) and the
// server (hit detection, bots, validation). Boxes are { id, min:[x,y,z], max:[x,y,z], mat, ... }.
import { BODY, MATERIALS } from './constants.js';

const EPS = 1e-5;
const TOUCH = 1e-4;
const CELL = 8;

export class World {
  constructor(boxes = []) {
    this.boxes = [];
    this.dynamic = new Map();
    this.disabled = new Set();
    this.grid = new Map();
    this.byId = new Map();
    this.stamp = 0;
    boxes.forEach((box) => this.addStatic(box));
  }

  addStatic(box) {
    if (box.deco) return;
    box._stamp = 0;
    this.boxes.push(box);
    if (box.id) this.byId.set(box.id, box);
    const x0 = Math.floor(box.min[0] / CELL), x1 = Math.floor(box.max[0] / CELL);
    const z0 = Math.floor(box.min[2] / CELL), z1 = Math.floor(box.max[2] / CELL);
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const key = `${x},${z}`;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(box);
      }
    }
  }

  addDynamic(box) { box._stamp = 0; this.dynamic.set(box.id, box); }
  removeDynamic(id) { this.dynamic.delete(id); }
  clearDynamic(prefix) { for (const id of [...this.dynamic.keys()]) if (!prefix || id.startsWith(prefix)) this.dynamic.delete(id); }
  setDisabled(id, value = true) { if (value) this.disabled.add(id); else this.disabled.delete(id); }
  resetDisabled() { this.disabled.clear(); }
  active(box) { return !(box.id && this.disabled.has(box.id)); }

  // Calls visit(box) for every live box whose footprint may touch the rectangle.
  query(minX, minZ, maxX, maxZ, visit) {
    this.stamp += 1;
    const stamp = this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const cell = this.grid.get(`${x},${z}`);
        if (!cell) continue;
        for (const box of cell) {
          if (box._stamp === stamp) continue;
          box._stamp = stamp;
          if (this.active(box) && visit(box) === true) return true;
        }
      }
    }
    for (const box of this.dynamic.values()) if (visit(box) === true) return true;
    return false;
  }

  overlaps(minX, minY, minZ, maxX, maxY, maxZ, ignore = null) {
    return this.query(minX, minZ, maxX, maxZ, (box) => (
      box !== ignore && !(ignore && box.group && box.group === ignore)
      && minX < box.max[0] - EPS && maxX > box.min[0] + EPS
      && minY < box.max[1] - EPS && maxY > box.min[1] + EPS
      && minZ < box.max[2] - EPS && maxZ > box.min[2] + EPS
    ));
  }

  bodyFree(x, y, z, radius = BODY.radius, height = BODY.height) {
    return !this.overlaps(x - radius, y, z - radius, x + radius, y + height, z + radius);
  }

  // Swept move along one axis. Boxes the body already overlaps are ignored, so something
  // that starts embedded (a shield deployed on top of you, a bot mid-stair) can walk out
  // instead of being flung to the far face of whatever it is stuck in.
  moveAxis(body, axis, amount) {
    if (!amount) return false;
    const r = body.radius;
    const lo = [body.x - r, body.y, body.z - r], hi = [body.x + r, body.y + body.height, body.z + r];
    const a = axis === 0 ? 1 : 0, b = axis === 2 ? 1 : 2;
    let allowed = amount, hit = false;
    const minX = axis === 0 && amount < 0 ? lo[0] + amount : lo[0], maxX = axis === 0 && amount > 0 ? hi[0] + amount : hi[0];
    const minZ = axis === 2 && amount < 0 ? lo[2] + amount : lo[2], maxZ = axis === 2 && amount > 0 ? hi[2] + amount : hi[2];
    this.query(minX, minZ, maxX, maxZ, (box) => {
      if (!(lo[a] < box.max[a] - EPS && hi[a] > box.min[a] + EPS && lo[b] < box.max[b] - EPS && hi[b] > box.min[b] + EPS)) return false;
      if (amount > 0) {
        const gap = box.min[axis] - hi[axis];
        if (gap >= -TOUCH && gap < allowed) { allowed = Math.max(0, gap); hit = true; }
      } else {
        const gap = box.max[axis] - lo[axis];
        if (gap <= TOUCH && gap > allowed) { allowed = Math.min(0, gap); hit = true; }
      }
      return false;
    });
    if (axis === 0) body.x += allowed; else if (axis === 1) body.y += allowed; else body.z += allowed;
    return hit;
  }

  // body: { x, y, z (feet), radius, height, vy, onGround }
  moveBody(body, dx, dy, dz) {
    const startX = body.x, startY = body.y, startZ = body.z;
    const wasGrounded = body.onGround;
    const blockedX = this.moveAxis(body, 0, dx);
    const blockedZ = this.moveAxis(body, 2, dz);
    if ((blockedX || blockedZ) && wasGrounded && dy <= 0) {
      const flatX = body.x, flatZ = body.z;
      const flatProgress = (flatX - startX) ** 2 + (flatZ - startZ) ** 2;
      body.x = startX; body.z = startZ;
      this.moveAxis(body, 1, BODY.step);
      const raised = body.y - startY;
      this.moveAxis(body, 0, dx);
      this.moveAxis(body, 2, dz);
      const stepProgress = (body.x - startX) ** 2 + (body.z - startZ) ** 2;
      if (stepProgress > flatProgress + 1e-7) {
        this.moveAxis(body, 1, -raised - 0.001);
      } else {
        body.x = flatX; body.y = startY; body.z = flatZ;
      }
    }
    let grounded = false;
    let remaining = dy;
    while (Math.abs(remaining) > 1e-9) {
      const chunk = Math.max(-0.35, Math.min(0.35, remaining));
      remaining -= chunk;
      if (this.moveAxis(body, 1, chunk)) {
        if (chunk < 0) grounded = true;
        body.vy = 0;
        break;
      }
    }
    // Stick to stairs when walking down instead of hopping off every step.
    if (!grounded && wasGrounded && dy <= 0 && body.vy <= 0) {
      const before = body.y;
      if (this.moveAxis(body, 1, -BODY.step)) { grounded = true; body.vy = 0; } else body.y = before;
    }
    body.onGround = grounded;
    return body;
  }

  // Returns every box crossed by the ray, sorted by entry distance.
  raycast(origin, dir, maxDist = 400, filter = null) {
    const hits = [];
    const test = (box) => {
      if (!this.active(box) || (filter && !filter(box))) return;
      const hit = rayBox(origin, dir, box, maxDist);
      if (hit) hits.push(hit);
    };
    this.boxes.forEach(test);
    this.dynamic.forEach(test);
    hits.sort((a, b) => a.t0 - b.t0);
    return hits;
  }

  // True when nothing opaque sits between the two points.
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return true;
    const origin = [ax, ay, az];
    const dir = [dx / dist, dy / dist, dz / dist];
    for (const box of this.boxes) {
      if (!this.active(box) || MATERIALS[box.mat]?.seeThrough) continue;
      if (rayBox(origin, dir, box, dist)) return false;
    }
    for (const box of this.dynamic.values()) {
      if (MATERIALS[box.mat]?.seeThrough) continue;
      if (rayBox(origin, dir, box, dist)) return false;
    }
    return true;
  }

  // Height of the first surface below a point (or -Infinity).
  groundBelow(x, y, z) {
    let best = -Infinity;
    this.query(x, z, x, z, (box) => {
      if (x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2] && box.max[1] <= y + 0.01 && box.max[1] > best) best = box.max[1];
      return false;
    });
    return best;
  }

  // Is there anything overhead? Used to mute rain indoors.
  covered(x, y, z) {
    return this.query(x, z, x, z, (box) => x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2] && box.min[1] >= y && !MATERIALS[box.mat]?.seeThrough);
  }
}

export function rayBox(origin, dir, box, maxDist) {
  let t0 = 0, t1 = maxDist, axisHit = 0, sign = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < box.min[axis] || o > box.max[axis]) return null;
      continue;
    }
    let near = (box.min[axis] - o) / d, far = (box.max[axis] - o) / d, s = -1;
    if (near > far) { const swap = near; near = far; far = swap; s = 1; }
    if (near > t0) { t0 = near; axisHit = axis; sign = s; }
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  const normal = [0, 0, 0];
  normal[axisHit] = sign;
  return { box, t0, t1, normal };
}

export function makeBody(x = 0, y = 0, z = 0) {
  return { x, y, z, radius: BODY.radius, height: BODY.height, vy: 0, onGround: false };
}
