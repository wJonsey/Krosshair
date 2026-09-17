import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ACCOUNTS_ENABLED, DISCORD_INVITE, MAX_PLAYERS, dailyModifier, dateKey } from './shared/constants.js';
import { ProfileStore } from './server/profiles.js';
import { AccountStore } from './server/accounts.js';
import { DiscordAuth, callbackPage } from './server/discord.js';
import { Room, now } from './server/room.js';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
// Secrets (Discord keys) can live in a git-ignored .env next to package.json.
try { process.loadEnvFile?.(path.join(root, '.env')); } catch { /* no .env */ }
const port = Number(process.env.ARENA_PORT || 4174);
const discord = new DiscordAuth();
// Playing needs an account whenever there is a way to get one. Without Discord keys nobody could log in,
// so the server falls back to guest callsigns rather than locking everyone out.
const LOGIN_REQUIRED = ACCOUNTS_ENABLED || discord.enabled;
if (!LOGIN_REQUIRED) console.warn('Discord keys are not set (see .env.example): login is NOT enforced and pilots play as guests.');
const profiles = new ProfileStore(process.env.ARENA_DATA || path.join(root, 'data', 'profiles.json'));
await profiles.load();
const accounts = new AccountStore(process.env.ARENA_ACCOUNTS || path.join(path.dirname(profiles.file), 'accounts.json'));
await accounts.load();
// Failed logins per username: after 8 misses the name is locked for a few minutes.
const loginFailures = new Map();
// Bug reports and suggestions, one JSON object per line. data/ is git-ignored.
const feedbackFile = process.env.ARENA_FEEDBACK || path.join(root, 'data', 'feedback.jsonl');

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
function cleanText(value, max) {
  return String(value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max);
}
async function saveFeedback(socket, message) {
  const reply = (ok, text, extra = {}) => send(socket, { type: 'feedback-result', ok, message: text, ...extra });
  const t = now();
  if (socket.lastFeedback && t - socket.lastFeedback < 15) return reply(false, 'Wait a few seconds before sending another report.');
  const title = cleanText(message.title, 90), details = cleanText(message.details, 3000);
  if (title.length < 4) return reply(false, 'Give it a title of at least 4 characters.');
  if (details.length < 10) return reply(false, 'Add a few more words of detail (10 characters or more).');
  socket.lastFeedback = t;
  const device = message.device && typeof message.device === 'object' ? Object.fromEntries(Object.entries(message.device).slice(0, 12).map(([key, value]) => [cleanText(key, 24), cleanText(value, 240)])) : null;
  const ref = `FB-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const entry = { ref, at: new Date().toISOString(), kind: message.kind === 'bug' ? 'bug' : 'suggestion', title, details, name: socket.name || null, room: socket.room?.name || null, device };
  try {
    await mkdir(path.dirname(feedbackFile), { recursive: true });
    await appendFile(feedbackFile, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('feedback save failed', error);
    socket.lastFeedback = 0;
    return reply(false, 'The server could not save that. Try again in a minute.');
  }
  console.log(`feedback ${ref}: [${entry.kind}] ${title}`);
  reply(true, 'Sent.', { ref });
}

function signIn(socket, account, message, session = null) {
  if (socket.readyState !== 1) return;
  socket.token = account.profileToken;
  socket.session = typeof message.tab === 'string' ? message.tab.slice(0, 64) : ProfileStore.newToken();
  socket.name = account.username;
  socket.account = account.username.toLowerCase();
  socket.identified = true;
  const profile = profiles.get(socket.token);
  profile.name = account.username;
  profiles.scheduleSave();
  if (socket.player) { socket.player.name = account.username; socket.room.pushRoom(); }
  send(socket, { type: 'identity', username: account.username, avatar: account.avatar && account.discordId ? `https://cdn.discordapp.com/avatars/${account.discordId}/${account.avatar}.png?size=64` : null, session, profile: profiles.view(socket.token), serverTime: now(), online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) });
}

async function handleAuth(socket, message) {
  const fail = (text) => send(socket, { type: 'auth-error', action: message.action, message: text });
  if (message.action === 'resume') {
    const account = accounts.resume(message.session);
    if (!account) return send(socket, { type: 'auth-required', expired: true });
    if (account.claimOpen) {
      const legacy = typeof message.legacyToken === 'string' && message.legacyToken.length >= 16 && message.legacyToken.length <= 64 && profiles.profiles.has(ProfileStore.key(message.legacyToken)) ? message.legacyToken : null;
      if (accounts.claim(account, legacy)) console.log(`account ${account.username} kept guest progress`);
    }
    return signIn(socket, account, message);
  }
  if (message.action === 'logout') {
    accounts.logout(message.session);
    leaveRoom(socket, true);
    Object.assign(socket, { identified: false, token: null, name: null, account: null });
    return send(socket, { type: 'logged-out' });
  }
  if (!ACCOUNTS_ENABLED) return fail('Password accounts are switched off. Log in with Discord or play with a callsign.');
  if (socket.authBusy) return;
  const t = now();
  socket.authAttempts = (socket.authAttempts || []).filter((at) => t - at < 60);
  if (socket.authAttempts.length >= 10) return fail('Too many attempts. Wait a minute and try again.');
  socket.authAttempts.push(t);
  socket.authBusy = true;
  try {
    if (message.action === 'signup') {
      // A browser that played before accounts existed brings its progress along, unless an account already owns it.
      const legacy = typeof message.legacyToken === 'string' && message.legacyToken.length >= 16 && message.legacyToken.length <= 64 && profiles.profiles.has(ProfileStore.key(message.legacyToken)) && !accounts.ownsProfile(message.legacyToken) ? message.legacyToken : null;
      const result = await accounts.signup(String(message.username || ''), message.password, legacy);
      if (result.error) return fail(result.error);
      console.log(`account created: ${result.account.username}${legacy ? ' (kept guest progress)' : ''}`);
      return signIn(socket, result.account, message, result.session);
    }
    if (message.action === 'login') {
      const key = String(message.username || '').toLowerCase().slice(0, 32);
      const record = loginFailures.get(key);
      if (record && record.count >= 8 && t - record.at < 300) return fail('Too many wrong passwords for this username. Try again in a few minutes.');
      const result = await accounts.login(String(message.username || ''), message.password);
      if (!result) {
        loginFailures.set(key, { count: (record && t - record.at < 300 ? record.count : 0) + 1, at: t });
        return fail('Wrong username or password.');
      }
      loginFailures.delete(key);
      return signIn(socket, result.account, message, result.session);
    }
  } catch (error) {
    console.error('auth failed', error);
    fail('Something went wrong on the server. Try again.');
  } finally {
    socket.authBusy = false;
  }
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

async function discordRoute(request, response, url) {
  const page = (status, body) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(callbackPage(body)); };
  if (!discord.enabled) return page(503, { error: 'Discord login is not set up on this server yet.' });
  if (url.pathname === '/auth/discord') {
    const target = discord.start(request);
    if (!target) return page(503, { error: 'Too many logins in progress. Try again in a minute.' });
    response.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (url.searchParams.get('error')) return page(400, { error: 'Discord login was cancelled.' });
  try {
    const { user, joined } = await discord.finish(request, url.searchParams.get('code') || '', url.searchParams.get('state') || '');
    const result = accounts.discordSignIn(user);
    if (!result) return page(400, { error: 'Discord sent back an account we could not read.' });
    console.log(`discord ${result.created ? 'signup' : 'login'}: ${result.account.username}${joined ? ' (in the server)' : ''}`);
    page(200, { session: result.session, joined });
  } catch (error) { page(400, { error: error.message }); }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://arena.local');
  if (url.pathname === '/api/status') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) }));
    return;
  }
  if (url.pathname === '/auth/discord' || url.pathname === '/auth/discord/callback') return void discordRoute(request, response, url);
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
  send(socket, { type: 'config', discord: discord.enabled, loginRequired: LOGIN_REQUIRED, invite: DISCORD_INVITE });
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
      if (message.type === 'auth') {
        if (!ACCOUNTS_ENABLED && !discord.enabled) return send(socket, { type: 'auth-error', action: message.action, message: 'Accounts are switched off for now. Play with a callsign instead.' });
        return void handleAuth(socket, message);
      }
      if (message.type === 'identify') {
        if (LOGIN_REQUIRED) return send(socket, { type: 'auth-required' });
        // Guest play: a callsign plus a device token the browser keeps.
        const name = cleanName(message.name);
        if (name.length < 2) return send(socket, { type: 'error', message: 'Choose a callsign with at least 2 characters.' });
        socket.token = typeof message.token === 'string' && message.token.length >= 16 && message.token.length <= 64 ? message.token : ProfileStore.newToken();
        // Progress that now belongs to an account is only reachable by logging in to it.
        if (accounts.ownsProfile(socket.token)) socket.token = ProfileStore.newToken();
        socket.session = typeof message.tab === 'string' ? message.tab.slice(0, 64) : ProfileStore.newToken();
        socket.name = name;
        socket.identified = true;
        const profile = profiles.get(socket.token);
        profile.name = name;
        profiles.scheduleSave();
        if (socket.player) { socket.player.name = name; socket.room.pushRoom(); }
        return send(socket, { type: 'identity', token: socket.token, profile: profiles.view(socket.token), serverTime: now(), online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) });
      }
      if (message.type === 'prefs' && socket.identified) return profiles.savePrefs(socket.token, message);
      if (message.type === 'feedback') return void saveFeedback(socket, message);
      if (message.type === 'enter') return enter(socket, message);
      if (message.type === 'leave-room') { leaveRoom(socket, true); return send(socket, { type: 'left', profile: profiles.view(socket.token), rooms: publicRooms() }); }
      if (message.type === 'look' && socket.identified && socket.player && socket.room.phase === 'lobby') {
        profiles.savePrefs(socket.token, { look: message.look });
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

server.listen(port, '0.0.0.0', () => console.log(`Krosshair online at http://localhost:${port}/`));
