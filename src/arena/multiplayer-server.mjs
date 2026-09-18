import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ACCOUNTS_ENABLED, DISCORD_INVITE, MAX_PLAYERS, PLACEMENT_MATCHES, dailyModifier, dateKey, levelFromXp } from './shared/constants.js';
import { ProfileStore } from './server/profiles.js';
import { AccountStore } from './server/accounts.js';
import { DiscordAuth, callbackPage, setupPage, tokenPage } from './server/discord.js';
import { Webhooks } from './server/webhooks.js';
import { Room, now } from './server/room.js';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
// Secrets (Discord keys) live in a git-ignored .env next to package.json (or in the working directory).
// Parsed here rather than with process.loadEnvFile so it works on every Node 20, and forgives the usual
// slips: quotes, `export`, spaces around =, Windows line endings. Real environment variables win.
const envFiles = [...new Set([path.join(root, '.env'), path.resolve('.env')])];
const envLoaded = [];
for (const file of envFiles) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  envLoaded.push(file);
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || raw.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1); else value = value.replace(/\s+#.*$/, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
const port = Number(process.env.ARENA_PORT || 4174);
const discord = new DiscordAuth();
// Anyone can play as a guest with a callsign; guest progress is never saved (see ProfileStore.holdGuest).
// A Discord login keeps progress and is needed for ranked. ALLOW_GUESTS=0 makes the login compulsory again.
const LOGIN_REQUIRED = ['0', 'false', 'no'].includes(String(process.env.ALLOW_GUESTS || '').toLowerCase());
// Say what was found (names only, never values) so a missing key is obvious in `journalctl -u krosshair`.
{
  const has = (key) => (process.env[key] ? 'set' : 'MISSING');
  console.log(`discord: .env ${envLoaded.length ? `read from ${envLoaded.join(', ')}` : `not found (looked in ${envFiles.join(', ')})`} · node ${process.version}`);
  console.log(`discord: application id ${process.env.DISCORD_CLIENT_ID ? 'from env' : discord.clientId ? 'from shared/constants.js' : 'MISSING'} · DISCORD_CLIENT_SECRET ${has('DISCORD_CLIENT_SECRET')} · DISCORD_BOT_TOKEN ${has('DISCORD_BOT_TOKEN')} · PUBLIC_URL ${process.env.PUBLIC_URL || '(from request host)'}`);
  if (discord.clientId && !/^\d{15,25}$/.test(discord.clientId)) console.warn('discord: DISCORD_CLIENT_ID should be the numeric Application ID, not the public key or a token.');
  console.log(`discord: login ${discord.enabled ? `ON (${discord.flow} flow)` : 'NOT CONFIGURED: set DISCORD_CLIENT_ID in shared/constants.js'} · ${LOGIN_REQUIRED ? 'required to play (ALLOW_GUESTS=0)' : 'guests allowed'} · auto-join ${discord.autoJoin ? 'ON' : 'OFF (no DISCORD_BOT_TOKEN)'}`);
  if (LOGIN_REQUIRED && !discord.enabled) console.warn('discord: NOBODY CAN PLAY until the application ID is set, or ALLOW_GUESTS=0 is removed.');
}
const profiles = new ProfileStore(process.env.ARENA_DATA || path.join(root, 'data', 'profiles.json'));
await profiles.load();
const accounts = new AccountStore(process.env.ARENA_ACCOUNTS || path.join(path.dirname(profiles.file), 'accounts.json'));
await accounts.load();
// Failed logins per username: after 8 misses the name is locked for a few minutes.
const loginFailures = new Map();
// Bug reports and suggestions, one JSON object per line. data/ is git-ignored.
const feedbackFile = process.env.ARENA_FEEDBACK || path.join(root, 'data', 'feedback.jsonl');

const webhooks = new Webhooks({ root, stateFile: path.join(path.dirname(profiles.file), 'webhooks.json'), siteUrl: (process.env.PUBLIC_URL || 'https://krosshair.online').replace(/\/$/, '') });
{ const hooks = webhooks.status(); console.log(`discord webhooks: updates ${hooks.updates ? 'ON' : 'off'} · leaderboard ${hooks.leaderboard ? 'ON' : 'off'}`); }

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
  if (socket.lastFeedback && t - socket.lastFeedback < 15) return reply(false, 'Wait a few seconds.');
  const title = cleanText(message.title, 90), details = cleanText(message.details, 3000);
  if (title.length < 4) return reply(false, 'Title needs 4+ characters.');
  if (details.length < 10) return reply(false, 'Add a bit more detail.');
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
    return reply(false, 'Couldn’t save. Try again in a minute.');
  }
  console.log(`feedback ${ref}: [${entry.kind}] ${title}`);
  reply(true, 'Sent.', { ref });
}

// A guest's progress goes once nobody is using it: a second tab on the same token keeps it alive.
function dropGuest(socket) {
  if (!socket.guest) return;
  socket.guest = false;
  if (![...sockets].some((other) => other !== socket && other.guest && other.token === socket.token)) profiles.releaseGuest(socket.token);
}

function signIn(socket, account, message, session = null) {
  if (socket.readyState !== 1) return;
  dropGuest(socket);
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
      if (accounts.claim(account, legacy)) { profiles.keepGuest(legacy); console.log(`account ${account.username} kept guest progress`); }
    }
    return signIn(socket, account, message);
  }
  if (message.action === 'logout') {
    accounts.logout(message.session);
    leaveRoom(socket, true);
    dropGuest(socket);
    Object.assign(socket, { identified: false, token: null, name: null, account: null });
    return send(socket, { type: 'logged-out' });
  }
  if (!ACCOUNTS_ENABLED) return fail('Password login is off. Use Discord or a callsign.');
  if (socket.authBusy) return;
  const t = now();
  socket.authAttempts = (socket.authAttempts || []).filter((at) => t - at < 60);
  if (socket.authAttempts.length >= 10) return fail('Too many attempts. Wait a minute.');
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
      if (record && record.count >= 8 && t - record.at < 300) return fail('Too many wrong passwords. Try again later.');
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
    fail('Server error. Try again.');
  } finally {
    socket.authBusy = false;
  }
}

// Leaderboards: accounts only (every pilot has one now), rebuilt at most every 30 s.
const BOARDS = {
  rating: { label: 'Skill rating', value: (p) => Math.round(p.rating), eligible: (p) => p.rankedMatches >= PLACEMENT_MATCHES },
  level: { label: 'Level', value: (p) => p.xp, eligible: (p) => p.xp > 0 },
  kills: { label: 'Player kills', value: (p) => p.stats?.playerKills || 0, eligible: (p) => (p.stats?.playerKills || 0) > 0 },
  wins: { label: 'Wins', value: (p) => p.stats?.wins || 0, eligible: (p) => (p.stats?.wins || 0) > 0 },
  headshots: { label: 'Headshots', value: (p) => p.stats?.headshots || 0, eligible: (p) => (p.stats?.headshots || 0) > 0 },
  longest: { label: 'Longest kill', value: (p) => p.stats?.longest || 0, eligible: (p) => (p.stats?.longest || 0) > 0 },
};
// now() counts from process start, so "never built" must be -Infinity, not 0 (0 looked fresh for the first 30 s).
let boardCache = { at: -Infinity, rows: {} };
function leaderboards() {
  if (now() - boardCache.at < 30) return boardCache.rows;
  const pilots = [];
  for (const account of accounts.accounts.values()) {
    const profile = profiles.profiles.get(ProfileStore.key(account.profileToken));
    if (profile) pilots.push({ account, profile });
  }
  const rows = {};
  for (const [id, board] of Object.entries(BOARDS)) {
    rows[id] = pilots.filter(({ profile }) => board.eligible(profile)).map(({ account, profile }) => ({
      key: account.username.toLowerCase(), name: account.username, title: profile.look?.title || 'Recruit', level: levelFromXp(profile.xp), value: board.value(profile),
      avatar: account.avatar && account.discordId ? `https://cdn.discordapp.com/avatars/${account.discordId}/${account.avatar}.png?size=64` : null,
    })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }
  boardCache = { at: now(), rows };
  return rows;
}
// Top 50 of each board, plus where the asking pilot stands even if that is 4,000th.
function leaderboardFor(socket) {
  const rows = leaderboards();
  const boards = {};
  for (const [id, board] of Object.entries(BOARDS)) {
    const index = socket.account ? rows[id].findIndex((row) => row.key === socket.account) : -1;
    boards[id] = { label: board.label, total: rows[id].length, top: rows[id].slice(0, 50).map(({ key, ...row }, place) => ({ ...row, rank: place + 1, you: key === socket.account })), you: index >= 0 ? { rank: index + 1, value: rows[id][index].value } : null };
  }
  return boards;
}

// Build stamp: the newest change to anything the browser loads. Pages that were opened before a deploy
// see a different stamp when they reconnect to the restarted server, and refresh themselves.
function newestChange(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'server' || entry.name === 'tests' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(full) : statSync(full).mtimeMs);
  }
  return newest;
}
const BUILD = Math.round(newestChange(path.join(root, 'src', 'arena'))).toString(36);

// Menus stay live: anyone not in a room gets the online count and the public room list whenever they change.
let lastMenu = '';
setInterval(() => {
  const menu = { type: 'menu', online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms() };
  const text = JSON.stringify(menu);
  if (text === lastMenu) return;
  lastMenu = text;
  for (const socket of sockets) if (!socket.room && socket.readyState === 1) socket.send(text);
}, 2000).unref();

function publicRooms() {
  return [...rooms.values()].filter((room) => room.isPublic && room.mode === 'match').map((room) => room.info()).filter((info) => info.players > 0);
}
function findQuickRoom(queue, rating = 1000) {
  const open = [...rooms.values()].filter((room) => room.queue === queue && room.isPublic && !room.closed && room.connectedHumans().length < MAX_PLAYERS);
  open.sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.connectedHumans().length - a.connectedHumans().length);
  // Ranked prefers the lobby whose pilots are closest to your rating (never splits the queue, only orders it).
  const gap = (room) => { const humans = room.connectedHumans(); return humans.length ? Math.abs(humans.reduce((sum, p) => sum + p.rating, 0) / humans.length - rating) : 400; };
  if (queue === 'ranked') open.sort((a, b) => gap(a) - gap(b));
  // Ranked never drops you into a match that is already running.
  const pick = open.find((room) => queue !== 'ranked' || room.phase === 'lobby');
  return pick || createRoom(`${queue}-${roomCounter++}`, { queue, isPublic: true });
}

// Only the game itself is served: never the profile store, never dotfiles.
const allowed = [/^\/index\.html$/, /^\/src\/arena\/(?!server\/|tests\/|multiplayer-server)[\w./-]+$/, /^\/node_modules\/three\/build\/three\.(module|core)(\.min)?\.js$/];
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };

async function discordRoute(request, response, url) {
  const page = (status, body) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(callbackPage(body)); };
  const html = (status, body) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(body); };
  if (!discord.enabled) return html(503, setupPage());
  if (url.pathname === '/auth/discord/token') {
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.method !== 'POST') return reply(405, { error: 'Login failed. Try again from the game.' });
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 4096) return reply(413, { error: 'Login failed. Try again from the game.' }); }
      const body = JSON.parse(raw || '{}');
      const { user, joined } = await discord.finishToken(body.access_token, String(body.state || ''));
      const result = accounts.discordSignIn(user);
      if (!result) return reply(400, { error: 'Couldn’t read your Discord account.' });
      console.log(`discord ${result.created ? 'signup' : 'login'}: ${result.account.username}${joined ? ' (in the server)' : ''}`);
      return reply(200, { session: result.session, joined });
    } catch (error) { return reply(400, { error: error instanceof SyntaxError ? 'Bad request.' : error.message }); }
  }
  if (url.pathname === '/auth/discord') {
    const target = discord.start(request);
    if (!target) return page(503, { error: 'Too many logins right now. Try again in a minute.' });
    response.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (url.searchParams.get('error')) return page(400, { error: 'Discord login was cancelled.' });
  // Implicit grant: nothing in the query, the token is in the fragment and the page deals with it.
  if (!url.searchParams.get('code')) return html(200, tokenPage());
  try {
    const { user, joined } = await discord.finish(request, url.searchParams.get('code') || '', url.searchParams.get('state') || '');
    const result = accounts.discordSignIn(user);
    if (!result) return page(400, { error: 'Couldn’t read your Discord account.' });
    console.log(`discord ${result.created ? 'signup' : 'login'}: ${result.account.username}${joined ? ' (in the server)' : ''}`);
    page(200, { session: result.session, joined });
  } catch (error) { page(400, { error: error.message }); }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://arena.local');
  if (url.pathname === '/api/status') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()), discord: { login: discord.enabled, autoJoin: discord.autoJoin, required: LOGIN_REQUIRED, webhooks: webhooks.status() } }));
    return;
  }
  if (url.pathname === '/auth/discord' || url.pathname === '/auth/discord/callback' || url.pathname === '/auth/discord/token') return void discordRoute(request, response, url);
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
    const type = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    // Music: browsers (Safari especially) ask for audio in byte ranges and will not play without them.
    const range = type.startsWith('audio/') && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, file.length - Number(range[2] || 0));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
      if (start > end || start >= file.length) { response.writeHead(416, { 'Content-Range': `bytes */${file.length}` }); return response.end(); }
      response.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'public, max-age=3600' });
      return response.end(file.subarray(start, end + 1));
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('audio/') ? 'public, max-age=3600' : 'no-cache', ...(type.startsWith('audio/') ? { 'Accept-Ranges': 'bytes' } : {}) });
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

const RANKED_LOGIN = 'Ranked needs a Discord login.';
function enter(socket, message) {
  if (!socket.identified) return send(socket, { type: 'error', message: 'Log in to play.' });
  leaveRoom(socket, true);
  const action = String(message.action || 'quick');
  let room = null;
  if (action === 'rejoin') {
    room = rooms.get(String(message.room || ''));
    const held = room && [...room.players.values()].some((p) => !p.bot && !p.connected && p.session === socket.session);
    if (!held) return send(socket, { type: 'rejoin-failed' });
  } else if (action === 'range') room = createRoom(`range-${roomCounter++}`, { queue: 'range' });
  else if (action === 'bots') room = createRoom(`bots-${roomCounter++}`, { queue: 'bots' });
  else if (action === 'quick') {
    const queue = ['casual', 'ranked', 'arcade'].includes(message.queue) ? message.queue : 'casual';
    if (queue === 'ranked' && !socket.account) return send(socket, { type: 'error', message: RANKED_LOGIN });
    room = findQuickRoom(queue, profiles.get(socket.token).rating);
  } else {
    const name = cleanRoomName(message.room);
    if (name.length < 3) return send(socket, { type: 'error', message: 'Room codes need 3+ characters.' });
    room = rooms.get(name);
    if (room?.queue === 'ranked' && !socket.account) return send(socket, { type: 'error', message: RANKED_LOGIN });
    if (room && room.queue !== 'custom' && !room.isPublic) return send(socket, { type: 'error', message: 'That room is private.' });
    if (!room) room = createRoom(name, { queue: 'custom', isPublic: Boolean(message.isPublic) });
  }
  if (message.difficulty && room.queue === 'bots') room.rules.botDifficulty = ['recruit', 'veteran', 'elite'].includes(message.difficulty) ? message.difficulty : 'veteran';
  const look = profiles.sanitizeCosmetics(socket.token, message.look || {});
  const player = room.join(socket, { token: socket.token, session: socket.session, name: socket.name }, look);
  if (!player) send(socket, { type: 'error', message: 'Room full.' });
}

wss.on('connection', (socket) => {
  sockets.add(socket);
  send(socket, { type: 'config', build: BUILD, discord: discord.enabled, loginRequired: LOGIN_REQUIRED, invite: DISCORD_INVITE });
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
        if (!ACCOUNTS_ENABLED && !discord.enabled && message.action !== 'logout') return send(socket, { type: 'auth-required' });
        return void handleAuth(socket, message);
      }
      if (message.type === 'identify') {
        if (LOGIN_REQUIRED) return send(socket, { type: 'auth-required' });
        // Guest play: a callsign and a token the tab keeps until it is closed. Only a token this process
        // handed out is taken back, so nothing saved (and nothing an account owns) can be reached this way.
        const name = cleanName(message.name);
        if (name.length < 2) return send(socket, { type: 'error', message: 'Callsign needs 2+ characters.' });
        if (socket.account) return;
        const token = typeof message.token === 'string' && message.token.length <= 64 && profiles.isGuest(message.token) ? message.token : ProfileStore.newToken();
        if (socket.guest && socket.token !== token) dropGuest(socket);
        socket.token = token;
        socket.guest = true;
        profiles.holdGuest(token);
        socket.session = typeof message.tab === 'string' ? message.tab.slice(0, 64) : ProfileStore.newToken();
        socket.name = name;
        socket.identified = true;
        const profile = profiles.get(socket.token);
        profile.name = name;
        profiles.scheduleSave();
        if (socket.player) { socket.player.name = name; socket.room.pushRoom(); }
        return send(socket, { type: 'identity', token: socket.token, guest: true, profile: profiles.view(socket.token), serverTime: now(), online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) });
      }
      if (message.type === 'prefs' && socket.identified) return profiles.savePrefs(socket.token, message);
      if (message.type === 'feedback') return void saveFeedback(socket, message);
      if (message.type === 'leaderboard') return send(socket, { type: 'leaderboard', boards: leaderboardFor(socket) });
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
  socket.on('close', () => { sockets.delete(socket); leaveRoom(socket); dropGuest(socket); });
  socket.on('error', () => {});
});

// The leaderboard channel hears about it when a podium changes hands. Checked every few minutes.
const boardValue = (id, row) => (id === 'rating' ? `${row.value} SR` : id === 'level' ? `Lv ${row.level} · ${row.value.toLocaleString('en')} XP` : id === 'longest' ? `${row.value} m` : row.value.toLocaleString('en'));
function checkBoards() {
  boardCache.at = -Infinity;
  const rows = leaderboards();
  webhooks.announceBoards(Object.fromEntries(Object.entries(BOARDS).map(([id, board]) => [id, { label: board.label, top: rows[id] }])), boardValue).catch((error) => console.warn('leaderboard webhook failed', error.message));
}
setInterval(checkBoards, 5 * 60 * 1000).unref();
setTimeout(checkBoards, 15 * 1000).unref();

// systemd stops the game with SIGTERM on every deploy. People mid-match get a warning in game and in
// Discord and a short grace period to finish the round; then everything is saved and the process goes.
// (systemd waits 90 s by default before it kills a service, so the grace period must stay well under that.)
const RESTART_GRACE = Math.min(60, Math.max(0, Number(process.env.RESTART_GRACE_SECONDS ?? 20)));
let stopping = false;
function shutdown() { profiles.flush(); accounts.flush(); process.exit(0); }
process.on('SIGINT', shutdown); // Ctrl+C while developing: no ceremony
process.on('SIGTERM', () => {
  if (stopping) return shutdown(); // asked twice: go now
  stopping = true;
  const pilots = [...sockets].filter((socket) => socket.identified).length;
  const matches = [...rooms.values()].filter((room) => room.mode === 'match' && room.phase !== 'lobby').length;
  const seconds = pilots ? RESTART_GRACE : 0;
  console.log(`stopping for a deploy: ${pilots} online, ${matches} matches, ${seconds}s grace`);
  for (const socket of sockets) send(socket, { type: 'notice', tone: 'warn', text: `Update incoming. Server restarts in ${seconds}s. Your match will end.` });
  const posted = webhooks.announceRestart({ seconds, pilots, matches });
  // Never let a slow webhook hold the deploy up: leave when the grace period is over, posted or not.
  Promise.race([Promise.all([posted, new Promise((resolve) => setTimeout(resolve, seconds * 1000))]), new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 3000))]).then(shutdown);
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Krosshair online at http://localhost:${port}/`);
  webhooks.announceBoot().catch((error) => console.warn('update webhook failed', error.message));
});
