// The nav graph answers "is there a route at all" before searching for one: different patches of ground,
// or a spot joined to the rest only by drops, cannot be reached, and searching for them flooded the whole
// graph. That shortcut must never say no to a place a search would have found, or yes to one it would
// not, so it is checked against a plain walk of the directed edges on random pairs, on every map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, ROYALE_MAP, getMap } from '../shared/map.js';
import { World } from '../shared/physics.js';
import { NavGrid } from '../server/nav.js';

function walkable(nav, from, to) {
  const seen = new Uint8Array(nav.nodes.length), todo = [from];
  seen[from] = 1;
  while (todo.length) { const id = todo.pop(); if (id === to) return true; for (const e of nav.nodes[id].edges) if (!seen[e.to]) { seen[e.to] = 1; todo.push(e.to); } }
  return false;
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

for (const id of [...MAP_IDS, ROYALE_MAP]) {
  test(`on ${id}, a route is ruled out only when there is none`, () => {
    const map = getMap(id);
    const nav = new NavGrid(new World(map.boxes), map);
    const rand = seeded(id.length * 104729 + 3);
    const pairs = id === ROYALE_MAP ? 60 : 300;
    let yes = 0, no = 0;
    for (let i = 0; i < pairs; i += 1) {
      // Mostly random, some from the small patches, where the answer is interesting.
      const pick = () => (rand() < 0.7 ? Math.floor(rand() * nav.nodes.length) : nav.patch.findIndex((p, n) => p === nav.patch[Math.floor(rand() * nav.nodes.length)] && n % 7 === 0));
      const a = Math.max(0, pick()), b = Math.max(0, pick());
      const truth = walkable(nav, a, b);
      const quick = nav.patch[a] === nav.patch[b] && nav.reaches(a, b);
      assert.equal(quick, truth, `${id}: node ${a} to ${b}`);
      const route = nav.path(nav.nodes[a], nav.nodes[b]);
      assert.equal(Boolean(route), truth, `${id}: path() and a plain walk disagree for ${a} to ${b}`);
      if (truth) yes += 1; else no += 1;
    }
    assert.ok(yes > 0, 'no reachable pairs were tried, so nothing was proved');
  });
}

test('an unreachable spot is ruled out without a search', () => {
  const map = getMap(ROYALE_MAP);
  const nav = new NavGrid(new World(map.boxes), map);
  const big = nav.patch[0];
  const lonely = nav.nodes.findIndex((n, id) => nav.patch[id] !== big);
  const t = performance.now();
  for (let i = 0; i < 200; i += 1) assert.equal(nav.path(nav.nodes[0], nav.nodes[lonely]), null);
  assert.ok(performance.now() - t < 200, 'two hundred impossible routes should take next to no time');
});

// The island's graph takes seconds to build and is not in the map vote, so it has to be built with the
// rest after boot: built on demand, the first royale lobby after a deploy froze every match with it.
test('the island is built at boot with the arenas, not when the first royale opens', async () => {
  const { readFileSync } = await import('node:fs');
  const flow = readFileSync(new URL('../server/mapflow.js', import.meta.url), 'utf8');
  assert.match(flow, /const queue = \[\.\.\.MAP_IDS, ROYALE_MAP\];/, 'the island is left to be built mid-session');
});
