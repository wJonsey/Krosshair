// Fingerprints so a client can tell when its copy of the game no longer matches the server.
// The server always decides the map; a stale page (an old cached or deployed build) would
// otherwise quietly load a different arena from its own files.
const cache = new WeakMap();

// FNV-1a over the map's collision boxes: identical geometry gives an identical print on both sides.
export function mapFingerprint(map) {
  if (!map?.boxes) return '';
  if (cache.has(map)) return cache.get(map);
  let hash = 0x811c9dc5;
  for (const box of map.boxes) {
    const text = `${box.id}|${box.min.join(',')}|${box.max.join(',')}|${box.mat}|${box.glass ? 1 : 0}${box.deco ? 1 : 0};`;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  }
  const print = `${map.id}:${(hash >>> 0).toString(36)}:${map.boxes.length}`;
  cache.set(map, print);
  return print;
}
