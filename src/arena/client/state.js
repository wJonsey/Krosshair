// Shared client state + a tiny event bus so modules stay decoupled.
import { DEFAULT_LOOK } from '../shared/constants.js';
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
// Guest play is kept for this tab only: closing it forgets the callsign and the progress token.
export function tabStored(key, fallback) {
  try { const value = sessionStorage.getItem(`krosshair:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
export function tabStore(key, value) {
  try { if (value === null) sessionStorage.removeItem(`krosshair:${key}`); else sessionStorage.setItem(`krosshair:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

let session = null;
try {
  session = sessionStorage.getItem('krosshair:session');
  if (!session) { session = crypto.randomUUID(); sessionStorage.setItem('krosshair:session', session); }
} catch { session = `${Date.now()}-${Math.random()}`; }

export const DEFAULT_SETTINGS = {
  sensitivity: 1, scopeSensitivity: 0.7, fov: 78, volume: 0.8, ambience: 0.6, music: 0.9, musicInMatch: true, announcer: true, invertY: false, padSensitivity: 1, aimAssist: true, padLayout: '', toggleScope: false, toggleCrouch: false, speedFov: true, moveDebug: false, visualizeSound: true,
  // Graphics: `quality` is a preset; touching any of the fine controls below turns it into 'custom'.
  quality: 'high', renderScale: 1, shadows: 'high', streetLights: true, viewDistance: 'high', aimBlur: true, brightness: 1, fpsCap: 0, autoQuality: true, showFps: true,
  binds: {},        // action → [primary, secondary]; anything missing falls back to DEFAULT_BINDS (input.js)
  crosshair: null,  // null = the default in crosshair.js
  settingsVersion: 4,
};
// When a default changes, players who saved settings before the change get the new default once; after
// that their own choice sticks. v2: FPS counter and sound visualiser on. v3: music keeps playing during rounds.
// v4: the Music slider was rescaled so its old 50% is the new 100%: positions are converted, loudness stays put.
export function migrateSettings(settings) {
  if ((settings.settingsVersion || 1) < 2) { settings.showFps = true; settings.visualizeSound = true; }
  if ((settings.settingsVersion || 1) < 3) settings.musicInMatch = true;
  if ((settings.settingsVersion || 1) < 4 && Number.isFinite(settings.music)) settings.music = Math.min(1, Math.round((settings.music / 0.5) * 20) / 20);
  settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  return settings;
}
// What each graphics preset means. 'custom' leaves the fine controls alone.
export const GRAPHICS_PRESETS = {
  // Sharpness is the last thing to go: a soft picture hurts a sniper more than a missing shadow.
  low: { renderScale: 0.85, shadows: 'off', streetLights: false, viewDistance: 'low' },
  medium: { renderScale: 1, shadows: 'low', streetLights: true, viewDistance: 'medium' },
  high: { renderScale: 1, shadows: 'high', streetLights: true, viewDistance: 'high' },
  ultra: { renderScale: 1.5, shadows: 'ultra', streetLights: true, viewDistance: 'ultra' },
};
export function graphics(settings = game.settings) { return { renderScale: settings.renderScale, shadows: settings.shadows, streetLights: settings.streetLights, viewDistance: settings.viewDistance || 'high', brightness: settings.brightness, ...(GRAPHICS_PRESETS[settings.quality] || {}) }; }

export const game = {
  name: tabStored('name', ''),
  token: tabStored('guest', null), // this tab's guest progress; a brand-new Discord account adopts it
  legacyToken: stored('token', null), // progress from before accounts, same deal
  authSession: stored('authSession', null),
  username: null,
  avatar: null,
  discord: { enabled: false, invite: '' }, // from the server's 'config' message
  loginRequired: false, // set by the server's 'config' message: true once it can offer a login
  session,
  look: { ...DEFAULT_LOOK, ...stored('look', {}) },
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
