// Tiny JSON-file profile store. Profiles are keyed by a secret profile token that only
// the server knows; accounts (server/accounts.js) map a login to one of these tokens.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { dailyContracts, dateKey, levelFromXp, COSMETICS, cosmeticUnlocked } from '../shared/constants.js';

const HISTORY_LIMIT = 25;
// Settings a pilot's account remembers, with the values the server will accept.
// Key binds and the crosshair are structured, so they get their own checks: only the shapes the client
// writes are kept, everything is bounded, and nothing unexpected reaches the saved file.
function cleanBinds(binds) {
  if (!binds || typeof binds !== 'object' || Array.isArray(binds)) return null;
  const out = {};
  for (const [action, slots] of Object.entries(binds).slice(0, 40)) {
    if (!/^[A-Za-z0-9]{1,24}$/.test(action) || !Array.isArray(slots)) continue;
    out[action] = [0, 1].map((index) => (typeof slots[index] === 'string' && /^[A-Za-z0-9]{1,24}$/.test(slots[index]) ? slots[index] : null));
  }
  return out;
}
function cleanCrosshair(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const num = (value, min, max) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);
  const lines = (g = {}) => ({ on: Boolean(g.on), opacity: num(g.opacity, 0, 1), length: num(g.length, 0, 30), thickness: num(g.thickness, 1, 10), offset: num(g.offset, 0, 40) });
  return {
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : '#e6edf1',
    outline: { on: Boolean(c.outline?.on), opacity: num(c.outline?.opacity, 0, 1), thickness: num(c.outline?.thickness, 1, 10) },
    dot: { on: Boolean(c.dot?.on), size: num(c.dot?.size, 1, 12), opacity: num(c.dot?.opacity, 0, 1) },
    inner: lines(c.inner), outer: lines(c.outer), dynamic: Boolean(c.dynamic), tee: Boolean(c.tee),
  };
}

const SETTING_RULES = {
  sensitivity: [0.1, 5], scopeSensitivity: [0.1, 3], padSensitivity: [0.1, 5], fov: [50, 120], volume: [0, 1],
  quality: ['ultra', 'high', 'medium', 'low', 'custom'], renderScale: [0.4, 2], shadows: ['off', 'low', 'high', 'ultra'], streetLights: 'bool', brightness: [0.5, 2], fpsCap: [0, 360], autoQuality: 'bool', showFps: 'bool',
  announcer: 'bool', invertY: 'bool', toggleScope: 'bool', toggleCrouch: 'bool', visualizeSound: 'bool',
};

export class ProfileStore {
  constructor(file) {
    this.file = file;
    this.profiles = new Map();
    this.saveTimer = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      Object.entries(data).forEach(([key, profile]) => this.profiles.set(key, profile));
    } catch { /* first boot */ }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(Object.fromEntries(this.profiles)));
        await rename(`${this.file}.tmp`, this.file);
      } catch (error) { console.warn('profile save failed', error.message); }
    }, 1500);
  }

  // Shutdown: write whatever is waiting, right now. Restarts (every deploy) must not cost anyone progress.
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer); this.saveTimer = null;
    try { mkdirSync(path.dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify(Object.fromEntries(this.profiles))); renameSync(`${this.file}.tmp`, this.file); } catch (error) { console.warn('profile save failed', error.message); }
  }

  static key(token) { return createHash('sha256').update(token).digest('hex').slice(0, 32); }
  static newToken() { return randomUUID(); }

  get(token) {
    const key = ProfileStore.key(token);
    if (!this.profiles.has(key)) {
      this.profiles.set(key, {
        name: 'Pilot', created: Date.now(), xp: 0, rating: 1000, rankedMatches: 0,
        stats: { matches: 0, wins: 0, kills: 0, playerKills: 0, botKills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, shots: 0, hits: 0, roundsWon: 0, roundsPlayed: 0, longest: 0, mvps: 0, clutches: 0, wallbangs: 0 },
        weapons: {}, history: [], contracts: { date: '', progress: {}, claimed: {} }, recent: [],
        look: null, settings: null, tutorialDone: false,
      });
    }
    const profile = this.profiles.get(key);
    this.rollContracts(profile);
    return profile;
  }

  rollContracts(profile) {
    const today = dateKey();
    if (profile.contracts.date !== today) profile.contracts = { date: today, progress: {}, claimed: {} };
  }

  // Shape sent to the browser.
  view(token) {
    const profile = this.get(token);
    const level = levelFromXp(profile.xp);
    return {
      name: profile.name, xp: profile.xp, level, rating: Math.round(profile.rating), rankedMatches: profile.rankedMatches,
      look: profile.look || null, settings: profile.settings || null, tutorialDone: Boolean(profile.tutorialDone),
      stats: { playerKills: 0, botKills: 0, ...profile.stats }, weapons: profile.weapons, history: profile.history, recent: profile.recent,
      contracts: dailyContracts(profile.contracts.date).map((contract) => ({
        ...contract, text: contract.text.replace('{n}', contract.n),
        progress: Math.min(contract.n, profile.contracts.progress[contract.id] || 0),
        done: Boolean(profile.contracts.claimed[contract.id]),
      })),
    };
  }

  // Look, settings and tutorial progress follow the account between browsers.
  savePrefs(token, { look, settings, tutorialDone } = {}) {
    const profile = this.get(token);
    if (look && typeof look === 'object') profile.look = this.sanitizeCosmetics(token, look);
    if (settings && typeof settings === 'object') {
      const clean = {};
      for (const [key, rule] of Object.entries(SETTING_RULES)) {
        const value = settings[key];
        if (rule === 'bool') { if (typeof value === 'boolean') clean[key] = value; } else if (typeof rule[0] === 'string') { if (rule.includes(value)) clean[key] = value; } else if (Number.isFinite(value)) clean[key] = Math.min(rule[1], Math.max(rule[0], value));
      }
      const binds = cleanBinds(settings.binds); if (binds) clean.binds = binds;
      const crosshair = cleanCrosshair(settings.crosshair); if (crosshair) clean.crosshair = crosshair;
      profile.settings = clean;
    }
    if (tutorialDone === true) profile.tutorialDone = true;
    this.scheduleSave();
  }

  sanitizeCosmetics(token, look) {
    const level = levelFromXp(this.get(token).xp);
    const pick = (kind, value) => (cosmeticUnlocked(kind, value, level) ? value : COSMETICS[kind][0].id);
    return { color: pick('suit', look.color), accent: pick('visor', look.accent), tracer: pick('tracer', look.tracer), title: pick('title', look.title) };
  }

  // summary: { won, draw, ranked, ratingDelta, mode, score, kills, deaths, ..., weaponKills: {id:{kills,headshots}}, rivals: [names] }
  recordMatch(token, summary) {
    const profile = this.get(token);
    const before = levelFromXp(profile.xp);
    const s = profile.stats;
    s.matches += 1;
    if (summary.won) s.wins += 1;
    for (const field of ['kills', 'playerKills', 'botKills', 'deaths', 'assists', 'headshots', 'damage', 'shots', 'hits', 'roundsWon', 'roundsPlayed', 'clutches', 'wallbangs']) s[field] = (s[field] || 0) + (summary[field] || 0);
    if (summary.mvp) s.mvps += 1;
    s.longest = Math.max(s.longest, Math.round(summary.longest || 0));
    Object.entries(summary.weaponKills || {}).forEach(([id, entry]) => {
      const record = profile.weapons[id] || (profile.weapons[id] = { kills: 0, headshots: 0 });
      record.kills += entry.kills; record.headshots += entry.headshots;
    });
    // Bots are worth less than people.
    let xp = 100 + (summary.playerKills || 0) * 25 + (summary.botKills || 0) * 10 + (summary.headshots || 0) * 10 + (summary.roundsWon || 0) * 30 + (summary.assists || 0) * 10 + (summary.won ? 200 : 0) + (summary.mvp ? 75 : 0);
    const progress = {
      kills: summary.kills, headshots: summary.headshotKills || 0, rounds: summary.roundsWon || 0, wins: summary.won ? 1 : 0,
      damage: Math.round(summary.damage || 0), longshots: summary.longshots || 0, wallbangs: summary.wallbangs || 0,
      knife: summary.knifeKills || 0, sidearm: summary.sidearmKills || 0, gadgets: summary.gadgets || 0,
      clutches: summary.clutches || 0, matches: 1,
    };
    const completed = [];
    for (const contract of dailyContracts(profile.contracts.date)) {
      const value = (profile.contracts.progress[contract.id] || 0) + (progress[contract.id] || 0);
      profile.contracts.progress[contract.id] = value;
      if (value >= contract.n && !profile.contracts.claimed[contract.id]) {
        profile.contracts.claimed[contract.id] = true;
        xp += contract.xp;
        completed.push({ text: contract.text.replace('{n}', contract.n), xp: contract.xp });
      }
    }
    profile.xp += xp;
    if (summary.ranked) { profile.rating = Math.max(100, profile.rating + summary.ratingDelta); profile.rankedMatches += 1; }
    profile.history.unshift({
      at: Date.now(), result: summary.draw ? 'draw' : summary.won ? 'win' : 'loss', score: summary.score, mode: summary.mode,
      kills: summary.kills, playerKills: summary.playerKills || 0, botKills: summary.botKills || 0, deaths: summary.deaths, assists: summary.assists || 0, headshots: summary.headshots || 0, mvp: Boolean(summary.mvp),
      rating: summary.ranked ? Math.round(summary.ratingDelta) : null, variant: summary.variant,
    });
    profile.history.length = Math.min(profile.history.length, HISTORY_LIMIT);
    for (const rival of summary.rivals || []) {
      profile.recent = [rival, ...profile.recent.filter((name) => name !== rival)].slice(0, 12);
    }
    this.scheduleSave();
    const after = levelFromXp(profile.xp);
    const unlocks = [];
    if (after > before) {
      for (const [kind, items] of Object.entries(COSMETICS)) for (const item of items) if (item.level > before && item.level <= after) unlocks.push({ kind, name: item.name });
    }
    return { xp, levelBefore: before, levelAfter: after, completed, unlocks, ratingDelta: summary.ranked ? Math.round(summary.ratingDelta) : 0 };
  }
}
