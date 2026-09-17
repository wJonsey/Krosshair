import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAX_PLAYERS, dailyModifier, dateKey } from './shared/constants.js';
import { ProfileStore } from './server/profiles.js';
import { Room, now } from './server/room.js';

const port = Number(process.env.ARENA_PORT || 4174);
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const profiles = new ProfileStore(process.env.ARENA_DATA || path.join(root, 'data', 'profiles.json'));
await profiles.load();

const rooms = new Map();
let roomCounter = 1;
const sockets = new Set();

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}
function createRoom(name, options) {
  const room = new Room({ name, profiles, onEmpty: (empty) => { empty.close(); rooms.delete(empty.name); }, ...options });
  rooms.set(name, room);
  return room;
}
function cleanRoomName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
}
function cleanName(value) {
  return String(value || '').replace(/[\x00-\x1f<>&"']/g, '').trim().slice(0, 16);
}
function publicRooms() {
  return [...rooms.values()].filter((room) => room.isPublic && room.mode === 'match').map((room) => room.info()).filter((info) => info.players > 0);
}
function findQuickRoom(queue) {
  const open = [...rooms.values()].filter((room) => room.queue === queue && room.isPublic && !room.closed && room.connectedHumans().length < MAX_PLAYERS);
  open.sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.connectedHumans().length - a.connectedHumans().length);
  // Ranked never drops you into a match that is already running.
  const pick = open.find((room) => queue !== 'ranked' || room.phase === 'lobby');
  return pick || createRoom(`${queue}-${roomCounter++}`, { queue, isPublic: true });
}

// Only the game itself is served: never the profile store, never dotfiles.
const allowed = [/^\/index\.html$/, /^\/src\/arena\/(?!server\/|tests\/|multiplayer-server)[\w./-]+$/, /^\/node_modules\/three\/build\/three\.(module|core)(\.min)?\.js$/];
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://arena.local');
  if (url.pathname === '/api/status') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) }));
    return;
  }
  const requested = decodeURIComponent(url.pathname);
  // Relative asset paths only resolve from the real page URL, so send bare visits there.
  if (requested === '/' || requested === '/index.html' || requested === '/src/arena/' || requested === '/src/arena') {
    response.writeHead(302, { Location: `/src/arena/index.html${url.search}` });
    response.end();
    return;
  }
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root) || requested.includes('..') || !allowed.some((pattern) => pattern.test(requested))) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  readFile(filePath).then((file) => {
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(file);
  }).catch(() => {
    response.writeHead(404);
    response.end('Not found');
  });
});

const wss = new WebSocketServer({ server, path: '/arena', maxPayload: 16 * 1024 });

function leaveRoom(socket, deliberate = false) {
  if (socket.room && socket.player) socket.room.leave(socket.player, deliberate);
  socket.room = null;
  socket.player = null;
}

function enter(socket, message) {
  if (!socket.identified) return send(socket, { type: 'error', message: 'Identify first.' });
  leaveRoom(socket, true);
  const action = String(message.action || 'quick');
  let room = null;
  if (action === 'rejoin') {
    room = rooms.get(String(message.room || ''));
    const held = room && [...room.players.values()].some((p) => !p.bot && !p.connected && p.session === socket.session);
    if (!held) return send(socket, { type: 'rejoin-failed' });
  } else if (action === 'range') room = createRoom(`range-${roomCounter++}`, { queue: 'range' });
  else if (action === 'bots') room = createRoom(`bots-${roomCounter++}`, { queue: 'bots' });
  else if (action === 'quick') room = findQuickRoom(['casual', 'ranked', 'arcade'].includes(message.queue) ? message.queue : 'casual');
  else {
    const name = cleanRoomName(message.room);
    if (name.length < 3) return send(socket, { type: 'error', message: 'Room codes need at least 3 letters or numbers.' });
    room = rooms.get(name);
    if (room && room.queue !== 'custom' && !room.isPublic) return send(socket, { type: 'error', message: 'That room is private.' });
    if (!room) room = createRoom(name, { queue: 'custom', isPublic: Boolean(message.isPublic) });
  }
  if (message.difficulty && room.queue === 'bots') room.rules.botDifficulty = ['recruit', 'veteran', 'elite'].includes(message.difficulty) ? message.difficulty : 'veteran';
  const look = profiles.sanitizeCosmetics(socket.token, message.look || {});
  const player = room.join(socket, { token: socket.token, session: socket.session, name: socket.name }, look);
  if (!player) send(socket, { type: 'error', message: 'Room is full. Try another room code.' });
}

wss.on('connection', (socket) => {
  sockets.add(socket);
  socket.identified = false;
  socket.room = null;
  socket.player = null;
  socket.budget = 0;
  socket.budgetAt = now();
  socket.on('message', (raw) => {
    // Simple flood guard: ~150 messages a second is far beyond what a client sends.
    const t = now();
    if (t - socket.budgetAt > 1) { socket.budgetAt = t; socket.budget = 0; }
    if ((socket.budget += 1) > 150) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    try {
      if (message.type === 'ping') {
        if (socket.player) socket.player.ping = Math.round(Math.min(999, Number(message.rtt) || 0));
        return send(socket, { type: 'pong', c: message.c, s: now() });
      }
      if (message.type === 'identify') {
        const name = cleanName(message.name);
        if (name.length < 2) return send(socket, { type: 'error', message: 'Choose a callsign with at least 2 characters.' });
        socket.token = typeof message.token === 'string' && message.token.length >= 16 && message.token.length <= 64 ? message.token : ProfileStore.newToken();
        socket.session = typeof message.session === 'string' ? message.session.slice(0, 64) : ProfileStore.newToken();
        socket.name = name;
        socket.identified = true;
        const profile = profiles.get(socket.token);
        profile.name = name;
        profiles.scheduleSave();
        if (socket.player) { socket.player.name = name; socket.room.pushRoom(); }
        return send(socket, { type: 'identity', token: socket.token, profile: profiles.view(socket.token), serverTime: now(), online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) });
      }
      if (message.type === 'enter') return enter(socket, message);
      if (message.type === 'leave-room') { leaveRoom(socket, true); return send(socket, { type: 'left', profile: profiles.view(socket.token), rooms: publicRooms() }); }
      if (message.type === 'look' && socket.identified && socket.player && socket.room.phase === 'lobby') {
        Object.assign(socket.player, profiles.sanitizeCosmetics(socket.token, message.look || {}));
        return socket.room.pushRoom();
      }
      if (socket.room && socket.player) socket.room.handle(socket.player, message);
    } catch (error) {
      console.error('message failed', message.type, error);
    }
  });
  socket.on('close', () => { sockets.delete(socket); leaveRoom(socket); });
  socket.on('error', () => {});
});

server.listen(port, '0.0.0.0', () => console.log(`Sniper Shootout online at http://localhost:${port}/`));
