// WebSocket transport: identify, clock sync, automatic reconnect.
import { bus, game, store, tabStore, tabStored } from './state.js';

const handlers = new Map();
let socket = null;
let offsetSamples = [];
let retry = 0;
let pingTimer = null;
let build = null; // the server's build stamp when this page loaded
const configuredServer = new URLSearchParams(location.search).get('server') || globalThis.KROSSHAIR_SERVER_URL || '';
const serverOrigin = configuredServer ? new URL(configuredServer, location.href) : location;
// Room to rejoin after a dropped connection or a page refresh (the tab keeps its session id).
let wantRoom = (() => { try { return sessionStorage.getItem('krosshair:room'); } catch { return null; } })();
function remember(name) {
  wantRoom = name;
  try { if (name) sessionStorage.setItem('krosshair:room', name); else sessionStorage.removeItem('krosshair:room'); } catch { /* private mode */ }
}

export const net = {
  connected: false,
  // Discord login stores its session on the server's own origin, so it only works when the page is served from there.
  sameOrigin: serverOrigin === location,
  identified: false,
  rtt: 0,
  offset: 0,
  // Several modules can listen for the same message (the royale HUD and the end screen both want match-end).
  on(type, handler) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(handler); },
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
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'pong') return sample(message);
    if (message.type === 'identity') {
      if (message.session) { game.authSession = message.session; store('authSession', message.session); }
      if (message.token) { game.token = message.token; tabStore('guest', message.token); }
      if (message.username) { game.username = message.username; game.name = message.username; game.avatar = message.avatar || null; }
      net.identified = true;
      if (wantRoom) net.send({ type: 'enter', action: 'rejoin', room: wantRoom, look: game.look });
    }
    if (message.type === 'rejoin-failed') remember(null);
    // First thing the server says. It decides how this browser introduces itself: a saved login wins,
    // then a guest callsign if the server still allows guests, otherwise the menu asks for a login.
    if (message.type === 'menu') { game.online = message.online; game.publicRooms = message.rooms; bus.emit('menu'); }
    if (message.type === 'config') {
      // A different build stamp means the server was redeployed while this page was open: pick up the new
      // files straight away, and come back to the same menu page without the loading screen's Enter button.
      if (build && message.build && message.build !== build) {
        bus.emit('net-status', { state: 'updating' });
        try { sessionStorage.setItem('krosshair:skipintro', '1'); } catch { /* private mode */ }
        setTimeout(() => location.reload(), 900);
        return;
      }
      build = message.build || build;
      game.discord = { enabled: Boolean(message.discord), invite: message.invite || '' };
      game.loginRequired = Boolean(message.loginRequired);
      if (game.authSession) net.auth('resume', { legacyToken: game.token || game.legacyToken || undefined });
      else if (!game.loginRequired) { if (game.name.trim().length >= 2) net.identify(); }
      else bus.emit('auth-required', {});
      bus.emit('config');
    }
    if (message.type === 'auth-required' || message.type === 'logged-out') {
      game.authSession = null; store('authSession', null);
      game.username = null; game.avatar = null; game.profile = null; net.identified = false;
      // Back to guest play: the callsign this browser used before logging in.
      if (!game.loginRequired) { game.name = tabStored('name', ''); if (game.name.trim().length >= 2) net.identify(); }
    }
    handlers.get(message.type)?.forEach((handler) => handler(message));
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
