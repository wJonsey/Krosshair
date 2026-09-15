import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const port = Number(process.env.ARENA_PORT || 4174);
const root = path.resolve(new URL('../../', import.meta.url).pathname);
const rooms = new Map();
let nextId = 1;

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}
function broadcast(room, message, except = null) {
  for (const client of room) if (client !== except) send(client, message);
}
function roomFor(name) {
  if (!rooms.has(name)) rooms.set(name, new Set());
  return rooms.get(name);
}
function roster(room) {
  return [...room].map((client) => ({ id: client.playerId, name: client.name, kills: client.kills, deaths: client.deaths }));
}

const server = createServer((request, response) => {
  const requestedPath = decodeURIComponent(new URL(request.url, 'http://arena.local').pathname);
  const relativePath = requestedPath === '/' ? '/src/arena/index.html' : requestedPath;
  const filePath = path.resolve(root, `.${relativePath}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  readFile(filePath).then((file) => {
    const extension = path.extname(filePath);
    const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
    response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
    response.end(file);
  }).catch(() => {
    response.writeHead(404);
    response.end('Not found');
  });
});
const wss = new WebSocketServer({ server, path: '/arena' });

wss.on('connection', (socket) => {
  socket.playerId = `pilot-${nextId++}`;
  socket.roomName = null;
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'join') {
      socket.roomName = String(message.room || 'night-shift').slice(0, 24);
      socket.name = String(message.name || 'Pilot').slice(0, 16);
      const room = roomFor(socket.roomName);
      if (room.size >= 8) return send(socket, { type: 'error', message: 'Room is full. Try another room code.' });
      socket.kills = 0;
      socket.deaths = 0;
      room.add(socket);
      send(socket, { type: 'welcome', id: socket.playerId, room: socket.roomName, count: room.size, max: 8, roster: roster(room) });
      broadcast(room, { type: 'player-joined', id: socket.playerId, count: room.size, roster: roster(room) }, socket);
      return;
    }
    if (!socket.roomName) return;
    const room = roomFor(socket.roomName);
    if (message.type === 'state') {
      if (typeof message.name === 'string') socket.name = message.name.slice(0, 16);
      broadcast(room, { ...message, id: socket.playerId, name: socket.name }, socket);
    }
    if (message.type === 'shot' || message.type === 'hit') broadcast(room, { ...message, id: socket.playerId }, socket);
    if (message.type === 'eliminated') {
      const killer = [...room].find((client) => client.playerId === message.winner);
      if (killer) killer.kills += 1;
      socket.deaths += 1;
      broadcast(room, { type: 'eliminated', winner: message.winner, victim: socket.playerId, roster: roster(room) });
    }
  });
  socket.on('close', () => {
    if (!socket.roomName) return;
    const room = rooms.get(socket.roomName);
    if (!room) return;
    room.delete(socket);
    broadcast(room, { type: 'player-left', id: socket.playerId, count: room.size, roster: roster(room) });
    if (!room.size) rooms.delete(socket.roomName);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`Neon Arena online at http://0.0.0.0:${port}/src/arena/index.html`));
