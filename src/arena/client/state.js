// Shared client state + a tiny event bus so modules stay decoupled.
const listeners = new Map();
export const bus = {
  on(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
  emit(type, payload) { listeners.get(type)?.forEach((handler) => handler(payload)); },
};

function stored(key, fallback) {
  try { const value = localStorage.getItem(`sniper-shootout:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(`sniper-shootout:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

const legacyName = (() => { try { return localStorage.getItem('neon-arena-name') || ''; } catch { return ''; } })();
let session = null;
try {
  session = sessionStorage.getItem('sniper-shootout:session');
  if (!session) { session = crypto.randomUUID(); sessionStorage.setItem('sniper-shootout:session', session); }
} catch { session = `${Date.now()}-${Math.random()}`; }

export const DEFAULT_SETTINGS = { sensitivity: 1, scopeSensitivity: 0.7, fov: 78, quality: 'high', volume: 0.8, announcer: true, invertY: false, padSensitivity: 1, toggleScope: false, toggleCrouch: false, visualizeSound: false };

export const game = {
  name: stored('name', legacyName),
  token: stored('token', null), // pre-accounts guest progress, claimed on sign-up
  authSession: stored('authSession', null),
  username: null,
  session,
  look: stored('look', { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' }),
  settings: { ...DEFAULT_SETTINGS, ...stored('settings', {}) },
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
