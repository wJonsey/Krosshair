// The list of things currently pulled from the game, and where it is kept.
//
// It is written to disk beside the profiles, because the usual reason to pull something is a bug, and
// the usual next thing to happen is a deploy. If this only lived in memory, the restart that carries
// the fix would also quietly put the broken thing back.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { MAP_IDS, ROYALE_MAP } from '../shared/map.js';
import { WEAPONS } from '../shared/constants.js';
import { FEATURE_IDS, OUTAGE_KINDS, cleanDowntime, cleanReason, downtimeLive, emptyOutages } from '../shared/outage.js';

const known = (kind, id) => (kind === 'map' ? [...MAP_IDS, ROYALE_MAP].includes(id)
  : kind === 'weapon' ? Boolean(WEAPONS[id])
  : kind === 'feature' ? FEATURE_IDS.includes(id) : false);

export class OutageBook {
  constructor(file) {
    this.file = file;
    this.out = emptyOutages();
    this.planned = null;   // scheduled downtime: { at, minutes, note, by }
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
      // Kept across the restart too: downtime planned for tonight should survive a deploy this afternoon.
      const planned = raw?.downtime ? cleanDowntime(raw.downtime, raw.downtime.at) : null;
      if (planned) this.planned = { ...planned, by: String(raw.downtime.by || 'dev').slice(0, 32) };
    } catch { /* first run, or nothing pulled */ }
  }

  save() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ ...this.out, downtime: this.planned }, null, 2));
      renameSync(temporary, this.file);
    } catch (error) { console.warn(`outages: could not save (${error.message})`); }
  }

  view() { return Object.fromEntries(OUTAGE_KINDS.map((kind) => [kind, { ...this.out[kind] }])); }
  isOut(kind, id) { return Boolean(this.out[kind]?.[id]); }
  // The question the rest of the server asks constantly, so it reads like a sentence.
  featureOut(id) { return Boolean(this.out.feature?.[id]); }
  get(kind, id) { return this.out[kind]?.[id] || null; }
  // Maps still in rotation. The caller decides what to do when that is empty.
  playableMaps(ids) { return ids.filter((id) => !this.isOut('map', id)); }

  // Planned downtime, or null once it is over. What every pilot is sent.
  downtime(now = Date.now()) {
    if (this.planned && !downtimeLive(this.planned, now)) { this.planned = null; this.save(); }
    return this.planned ? { at: this.planned.at, minutes: this.planned.minutes, note: this.planned.note } : null;
  }
  // Set it (raw: { at, minutes, note }) or take it down (raw: null). Returns false for nonsense.
  plan(raw, by, now = Date.now()) {
    if (raw === null) { const had = Boolean(this.planned); this.planned = null; if (had) this.save(); return true; }
    const clean = cleanDowntime(raw, now);
    if (!clean) return false;
    this.planned = { ...clean, by: String(by || 'dev').slice(0, 32) };
    this.save();
    return true;
  }

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
