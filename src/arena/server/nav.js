// Walkable-surface graph generated straight from the map's collision boxes, so
// bots handle stairs, rooftops and the underpass without hand-placed waypoints.
import { BODY } from '../shared/constants.js';
import { makeBody } from '../shared/physics.js';

const CELL = 1;

export class NavGrid {
  constructor(world, map) {
    this.world = world;
    this.nodes = [];
    this.cells = new Map();
    this.build(map);
  }

  key(ix, iz) { return ix * 4096 + iz; }

  build(map) {
    const { bounds } = map;
    const world = this.world;
    const tops = [...new Set(world.boxes.map((box) => box.max[1]))].filter((y) => y >= bounds.minY - 0.1 && y < bounds.maxY).sort((a, b) => a - b);
    for (let x = bounds.minX + CELL / 2; x < bounds.maxX; x += CELL) {
      for (let z = bounds.minZ + CELL / 2; z < bounds.maxZ; z += CELL) {
        const levels = [];
        for (const y of tops) {
          // A level is standable when a box top sits right under the point and the body fits.
          let supported = false;
          // Footprint, not centre: on stairs the body always rests on the highest step it touches.
          const r = BODY.radius - 0.01;
          world.query(x - r, z - r, x + r, z + r, (box) => {
            if (Math.abs(box.max[1] - y) < 1e-6 && x + r > box.min[0] && x - r < box.max[0] && z + r > box.min[2] && z - r < box.max[2]) supported = true;
            return supported;
          });
          if (supported && world.bodyFree(x, y, z)) levels.push(y);
        }
        if (!levels.length) continue;
        const ix = Math.round((x - bounds.minX - CELL / 2) / CELL), iz = Math.round((z - bounds.minZ - CELL / 2) / CELL);
        const list = levels.map((y) => {
          const node = { id: this.nodes.length, x, y, z, ix, iz, edges: [] };
          this.nodes.push(node);
          return node;
        });
        this.cells.set(this.key(ix, iz), list);
      }
    }
    this.origin = { x: bounds.minX + CELL / 2, z: bounds.minZ + CELL / 2 };
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const node of this.nodes) {
      for (const [dx, dz] of offsets) {
        const neighbours = this.cells.get(this.key(node.ix + dx, node.iz + dz));
        if (!neighbours) continue;
        for (const other of neighbours) {
          const rise = other.y - node.y;
          if (rise > 0.8 || rise < -4.2) continue;
          if (this.walkable(node, other)) node.edges.push({ to: other.id, cost: Math.hypot(dx, dz) + Math.abs(rise) * 0.6 + (rise < -1 ? 2 : 0) });
        }
      }
    }
  }

  // Simulate the walk with the real movement code. Slow but exact, and only run once at boot.
  walkable(from, to) {
    const flat = Math.abs(from.y - to.y) < 1e-6;
    if (flat) {
      const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
      if (from.x !== to.x && from.z !== to.z) {
        if (!this.world.bodyFree(from.x, from.y, to.z) || !this.world.bodyFree(to.x, from.y, from.z)) return false;
      }
      return this.world.bodyFree(mx, from.y, mz) && this.world.groundBelow(mx, from.y + 0.05, mz) > from.y - 0.5;
    }
    const body = makeBody(from.x, from.y, from.z);
    body.onGround = true;
    for (let step = 0; step < 90; step += 1) {
      const dx = to.x - body.x, dz = to.z - body.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12 && body.onGround) return Math.abs(body.y - to.y) < 0.12;
      body.vy -= BODY.gravity / 30;
      const move = Math.min(dist, 0.12);
      this.world.moveBody(body, dist > 1e-6 ? (dx / dist) * move : 0, body.vy / 30, dist > 1e-6 ? (dz / dist) * move : 0);
      if (body.y < Math.min(from.y, to.y) - 0.5) return false;
    }
    return false;
  }

  nearest(x, y, z, accept = null) {
    const ix = Math.round((x - this.origin.x) / CELL), iz = Math.round((z - this.origin.z) / CELL);
    let best = null, bestScore = Infinity;
    for (let radius = 0; radius <= 3 && !best; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          const list = this.cells.get(this.key(ix + dx, iz + dz));
          if (!list) continue;
          for (const node of list) {
            if (accept && !accept(node)) continue;
            const score = Math.hypot(node.x - x, node.z - z) + Math.abs(node.y - y) * 3;
            if (score < bestScore) { bestScore = score; best = node; }
          }
        }
      }
    }
    return best;
  }

  // A* returning [{x,y,z}, ...] or null.
  // scale(node) lets a caller make parts of the map feel more expensive (route variety).
  path(from, to, scale = null) {
    const start = this.nearest(from.x, from.y, from.z), goal = this.nearest(to.x, to.y, to.z);
    if (!start || !goal) return null;
    const count = this.nodes.length;
    const g = new Float32Array(count).fill(Infinity);
    const came = new Int32Array(count).fill(-1);
    const closed = new Uint8Array(count);
    const heap = new MinHeap();
    g[start.id] = 0;
    heap.push(start.id, 0);
    while (heap.size) {
      const current = heap.pop();
      if (current === goal.id) break;
      if (closed[current]) continue;
      closed[current] = 1;
      const node = this.nodes[current];
      for (const edge of node.edges) {
        const next = g[current] + edge.cost * (scale ? scale(this.nodes[edge.to]) : 1);
        if (next < g[edge.to]) {
          g[edge.to] = next;
          came[edge.to] = current;
          const target = this.nodes[edge.to];
          heap.push(edge.to, next + Math.hypot(target.x - goal.x, target.z - goal.z) + Math.abs(target.y - goal.y));
        }
      }
    }
    if (came[goal.id] === -1 && goal.id !== start.id) return null;
    const points = [];
    for (let id = goal.id; id !== -1; id = came[id]) points.push({ x: this.nodes[id].x, y: this.nodes[id].y, z: this.nodes[id].z });
    return points.reverse();
  }
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    let index = this.ids.length;
    this.ids.push(id); this.keys.push(key);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= this.keys[index]) break;
      this.swap(parent, index); index = parent;
    }
  }
  pop() {
    const top = this.ids[0];
    const lastId = this.ids.pop(), lastKey = this.keys.pop();
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < this.ids.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.ids.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(smallest, index); index = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
