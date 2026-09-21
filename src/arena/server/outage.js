// The list of things currently pulled from the game, and where it is kept.
//
// It is written to disk beside the profiles, because the usual reason to pull something is a bug, and
// the usual next thing to happen is a deploy. If this only lived in memory, the restart that carries
// the fix would also quietly put the broken thing back.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { MAP_IDS, ROYALE_MAP } from '../shared/map.js';
import { WEAPONS } from '../shared/constants.js';
import { OUTAGE_KINDS, cleanReason, emptyOutages } from '../shared/outage.js';

const known = (kind, id) => (kind === 'map' ? [...MAP_IDS, ROYALE_MAP].includes(id) : kind === 'weapon' ? Boolean(WEAPONS[id]) : false);

export class OutageBook {
  constructor(file) {
    this.file = file;
    this.out = emptyOutages();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const kind of OUTAGE_KINDS) {
        for (const [id, entry] of Object.entries(raw?.[kind] || {})) {
          // Anything that is no longer in the game is dropped rather than kept as a ghost.
          if (known(kind, id)) this.out[kind][id] = { kind, id, reason: cleanReason(entry?.reason), by: String(entry?.by || 'dev').slice(0, 32), at: Number(entry?.at) || Date.now() };
        }
      }
    } catch { /* first run, or nothing pulled */ }
  }

  save() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.out, null, 2));
      renameSync(temporary, this.file);
    } catch (error) { console.warn(`outages: could not save (${error.message})`); }
  }

  view() { return { map: { ...this.out.map }, weapon: { ...this.out.weapon } }; }
  isOut(kind, id) { return Boolean(this.out[kind]?.[id]); }
  get(kind, id) { return this.out[kind]?.[id] || null; }
  // Maps still in rotation. The caller decides what to do when that is empty.
  playableMaps(ids) { return ids.filter((id) => !this.isOut('map', id)); }

  // Returns what changed, or null when the call was nonsense or made no difference.
  set(kind, id, on, reason, by) {
    if (!OUTAGE_KINDS.includes(kind) || !known(kind, id)) return null;
    if (on) {
      // Never let the last arena be pulled: there would be nothing to play.
      if (kind === 'map' && id !== ROYALE_MAP && this.playableMaps(MAP_IDS).filter((other) => other !== id).length === 0) return { error: 'That is the last arena left.' };
      const entry = { kind, id, reason: cleanReason(reason), by: String(by || 'dev').slice(0, 32), at: Date.now() };
      this.out[kind][id] = entry;
      this.save();
      return { entry, on: true };
    }
    if (!this.out[kind][id]) return null;
    const was = this.out[kind][id];
    delete this.out[kind][id];
    this.save();
    return { entry: was, on: false };
  }
}
