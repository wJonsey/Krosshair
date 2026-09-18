// Shared client state + a tiny event bus so modules stay decoupled.
const listeners = new Map();
export const bus = {
  on(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
  emit(type, payload) { listeners.get(type)?.forEach((handler) => handler(payload)); },
};

export function stored(key, fallback) {
  try { const value = localStorage.getItem(`krosshair:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(`krosshair:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

const legacyName = (() => { try { return localStorage.getItem('neon-arena-name') || ''; } catch { return ''; } })();
let session = null;
try {
  session = sessionStorage.getItem('krosshair:session');
  if (!session) { session = crypto.randomUUID(); sessionStorage.setItem('krosshair:session', session); }
} catch { session = `${Date.now()}-${Math.random()}`; }

export const DEFAULT_SETTINGS = {
  sensitivity: 1, scopeSensitivity: 0.7, fov: 78, volume: 0.8, ambience: 0.6, music: 0.9, musicInMatch: true, announcer: true, invertY: false, padSensitivity: 1, toggleScope: false, toggleCrouch: false, visualizeSound: true,
  // Graphics: `quality` is a preset; touching any of the fine controls below turns it into 'custom'.
  quality: 'high', renderScale: 1, shadows: 'high', streetLights: true, brightness: 1, fpsCap: 0, autoQuality: true, showFps: true,
  binds: {},        // action → [primary, secondary]; anything missing falls back to DEFAULT_BINDS (input.js)
  crosshair: null,  // null = the default in crosshair.js
  settingsVersion: 4,
};
// When a default changes, players who saved settings before the change get the new default once; after
// that their own choice sticks. v2: FPS counter and sound visualiser on. v3: music keeps playing during rounds.
// v4: the Music slider was rescaled so its old 50% is the new 100% — positions are converted, loudness stays put.
export function migrateSettings(settings) {
  if ((settings.settingsVersion || 1) < 2) { settings.showFps = true; settings.visualizeSound = true; }
  if ((settings.settingsVersion || 1) < 3) settings.musicInMatch = true;
  if ((settings.settingsVersion || 1) < 4 && Number.isFinite(settings.music)) settings.music = Math.min(1, Math.round((settings.music / 0.5) * 20) / 20);
  settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  return settings;
}
// What each graphics preset means. 'custom' leaves the fine controls alone.
export const GRAPHICS_PRESETS = {
  low: { renderScale: 0.75, shadows: 'off', streetLights: false },
  medium: { renderScale: 0.85, shadows: 'low', streetLights: true },
  high: { renderScale: 1, shadows: 'high', streetLights: true },
  ultra: { renderScale: 1.5, shadows: 'ultra', streetLights: true },
};
export function graphics(settings = game.settings) { return { renderScale: settings.renderScale, shadows: settings.shadows, streetLights: settings.streetLights, brightness: settings.brightness, ...(GRAPHICS_PRESETS[settings.quality] || {}) }; }

export const game = {
  name: stored('name', legacyName),
  token: stored('token', null), // pre-accounts guest progress, claimed on sign-up
  authSession: stored('authSession', null),
  username: null,
  avatar: null,
  discord: { enabled: false, invite: '' }, // from the server's 'config' message
  loginRequired: false, // set by the server's 'config' message: true once it can offer a login
  session,
  look: stored('look', { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' }),
  settings: migrateSettings({ ...DEFAULT_SETTINGS, settingsVersion: 1, ...stored('settings', {}) }),
  tutorialDone: stored('tutorialDone', false),
  profile: null,
  online: 0,
  publicRooms: [],
  dailyModifier: 'headhunter',
  id: null,            // my player id inside the current room
  room: null,          // last 'room' message
  you: null,           // last 'you' message
  roster: new Map(),   // id → roster entry
  marks: new Map(),    // id → { until, reason }
  screen: 'home',      // home | lobby | game
  report: null,
};

export function me() { return game.roster.get(game.id) || null; }
export function myTeam() { return me()?.team || 'A'; }
export function isEnemy(id) { const other = game.roster.get(id); return other ? other.team !== myTeam() : true; }
export function nameOf(id) { return game.roster.get(id)?.name || (game.room?.mode === 'range' ? 'Target' : 'Unknown'); }
export function saveSettings() { store('settings', game.settings); bus.emit('settings'); }
