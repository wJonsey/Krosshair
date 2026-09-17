// WebSocket transport: identify, clock sync, automatic reconnect.
import { bus, game, store } from './state.js';
import { ACCOUNTS_ENABLED } from '../shared/constants.js';

const handlers = new Map();
let socket = null;
let offsetSamples = [];
let retry = 0;
let pingTimer = null;
const pagesBackend = 'https://sturdy-couscous-wr4gp496w77g25jpp-4174.app.github.dev';
const configuredServer = new URLSearchParams(location.search).get('server') || globalThis.KROSSHAIR_SERVER_URL || (location.hostname.endsWith('github.io') ? pagesBackend : '');
const serverOrigin = configuredServer ? new URL(configuredServer, location.href) : location;
// Room to rejoin after a dropped connection or a page refresh (the tab keeps its session id).
let wantRoom = (() => { try { return sessionStorage.getItem('krosshair:room'); } catch { return null; } })();
function remember(name) {
  wantRoom = name;
  try { if (name) sessionStorage.setItem('krosshair:room', name); else sessionStorage.removeItem('krosshair:room'); } catch { /* private mode */ }
}

export const net = {
  connected: false,
  identified: false,
  rtt: 0,
  offset: 0,
  on(type, handler) { handlers.set(type, handler); },
  send(message) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); },
  // Server clock, in seconds.
  time() { return performance.now() / 1000 + net.offset; },
  connect,
  // action: resume | login | signup | logout
  identify() { net.send({ type: 'identify', name: game.name, token: game.token, tab: game.session }); },
  auth(action, fields = {}) { net.send({ type: 'auth', action, tab: game.session, session: game.authSession, ...fields }); },
  enter(payload) { net.send({ type: 'enter', look: game.look, ...payload }); },
  leaveRoom() { remember(null); net.send({ type: 'leave-room' }); },
  holdRoom(name) { remember(name); },
};

function sample(message) {
  const nowMs = performance.now();
  const rtt = nowMs - message.c;
  offsetSamples.push({ rtt, offset: message.s + rtt / 2000 - nowMs / 1000 });
  if (offsetSamples.length > 10) offsetSamples.shift();
  const best = offsetSamples.reduce((a, b) => (a.rtt <= b.rtt ? a : b));
  net.offset = best.offset;
  net.rtt = Math.round(offsetSamples[offsetSamples.length - 1].rtt);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocol = serverOrigin.protocol === 'https:' ? 'wss' : 'ws';
  bus.emit('net-status', { state: 'connecting' });
  try { socket = new WebSocket(`${protocol}://${serverOrigin.host}/arena`); } catch { scheduleRetry(); return; }
  socket.addEventListener('open', () => {
    retry = 0;
    net.connected = true;
    offsetSamples = [];
    bus.emit('net-status', { state: 'open' });
    clearInterval(pingTimer);
    const ping = () => net.send({ type: 'ping', c: performance.now(), rtt: net.rtt });
    ping();
    setTimeout(ping, 250);
    setTimeout(ping, 600);
    pingTimer = setInterval(ping, 2000);
    if (!ACCOUNTS_ENABLED) { if (game.name.trim().length >= 2) net.identify(); } else if (game.authSession) net.auth('resume'); else bus.emit('auth-required', {});
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'pong') return sample(message);
    if (message.type === 'identity') {
      if (message.session) { game.authSession = message.session; store('authSession', message.session); }
      if (message.token) { game.token = message.token; store('token', message.token); }
      if (message.username) { game.username = message.username; game.name = message.username; }
      net.identified = true;
      if (wantRoom) net.send({ type: 'enter', action: 'rejoin', room: wantRoom, look: game.look });
    }
    if (message.type === 'rejoin-failed') remember(null);
    if (message.type === 'auth-required' || message.type === 'logged-out') {
      game.authSession = null; store('authSession', null);
      game.username = null; game.profile = null; net.identified = false;
    }
    handlers.get(message.type)?.(message);
  });
  socket.addEventListener('close', () => {
    net.connected = false;
    net.identified = false;
    clearInterval(pingTimer);
    bus.emit('net-status', { state: 'closed', rejoining: Boolean(wantRoom) });
    scheduleRetry();
  });
  socket.addEventListener('error', () => {});
}

function scheduleRetry() {
  retry += 1;
  setTimeout(connect, Math.min(5000, 400 * retry));
}
