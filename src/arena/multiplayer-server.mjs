import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WEAPONS, ACCOUNTS_ENABLED, DISCORD_INVITE, MAX_PLAYERS, PLACEMENT_MATCHES, RANKED_IDS, TEAM_MODE_IDS, dailyModifier, dateKey, isRanked, levelFromXp } from './shared/constants.js';
import { ProfileStore } from './server/profiles.js';
import { AccountStore } from './server/accounts.js';
import { isDev } from './server/devs.js';
import { DiscordAuth, callbackPage, setupPage, tokenPage } from './server/discord.js';
import { Webhooks } from './server/webhooks.js';
import { Room, now } from './server/room.js';
import { RoyaleRoom } from './server/royale.js';
import { ROYALE } from './shared/royale.js';
import { installCatalogue, publicCatalogue } from './server/itemsets.js';
import { getMap } from './shared/map.js';
import { OutageBook } from './server/outage.js';
import { cleanReason, featureName, outageLine, OUTAGE_KINDS } from './shared/outage.js';
import { buyGear, buyItemShop, buySkin, cashOutCrash, refundCrashes, openCrate, playGame, scrapSkin, sendCoins, startCrash, tradeUp } from './server/economy.js';
import { accept as acceptFriend, block as blockPilot, blockedEitherWay, lists as socialLists, normalize as normalizeFriends, reject as rejectFriend, relation, request as requestFriend, unblock as unblockPilot, unfriend } from './server/social.js';
import { PartyBook } from './server/party.js';
import { WAGER } from './shared/economy.js';
import { Guard } from './server/guard.js';
import { isDetection } from './shared/guard.js';

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
// Things a developer has pulled from the game. Kept beside the profiles so a deploy restart does not
// quietly put a broken map or gun back.
const outages = new OutageBook(process.env.ARENA_OUTAGES || path.join(path.dirname(process.env.ARENA_DATA || path.join(root, 'data', 'profiles.json')), 'outages.json'));
Room.useOutages(outages);
await profiles.load();
const accounts = new AccountStore(process.env.ARENA_ACCOUNTS || path.join(path.dirname(profiles.file), 'accounts.json'));
await accounts.load();
// Failed logins per username: after 8 misses the name is locked for a few minutes.
const loginFailures = new Map();
// Bug reports and suggestions, one JSON object per line. data/ is git-ignored.
const feedbackFile = process.env.ARENA_FEEDBACK || path.join(root, 'data', 'feedback.jsonl');

const webhooks = new Webhooks({ root, stateFile: path.join(path.dirname(profiles.file), 'webhooks.json'), siteUrl: (process.env.PUBLIC_URL || 'https://krosshair.online').replace(/\/$/, '') });
{ const hooks = webhooks.status(); console.log(`discord webhooks: updates ${hooks.updates ? 'ON' : 'off'} · leaderboard ${hooks.leaderboard ? 'ON' : 'off'}`); }

const guard = new Guard(now);
const rooms = new Map();
let roomCounter = 1;
const sockets = new Set();
const parties = new PartyBook();

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

const avatarOf = (account) => (account.avatar && account.discordId ? `https://cdn.discordapp.com/avatars/${account.discordId}/${account.avatar}.png?size=64` : null);

// Big drops (Legendary and Mythic, from crates or trade-ups): the last few are shown in the shop, and
// everyone in the menus hears about each one once the opener's reel has had time to land.
const recentDrops = [];
const DROP_DELAY = 5.5;
function announceDrops(name, drops) {
  const big = drops.filter((drop) => drop.rarity === 'legendary' || drop.rarity === 'mythic');
  if (!big.length) return;
  setTimeout(() => {
    for (const drop of big) {
      const entry = { name, weapon: drop.weapon, finish: drop.finish, rarity: drop.rarity, at: Date.now() };
      recentDrops.unshift(entry);
      recentDrops.length = Math.min(recentDrops.length, 12);
      for (const socket of sockets) if (socket.identified) send(socket, { type: 'drop', drop: entry });
    }
  }, DROP_DELAY * 1000).unref?.();
}

// Coins: shop, crates, minigames, transfers, username lookup. Accounts only, one request at a time,
// and a short cooldown so nobody can hammer the dice.
function handleCoins(socket, message) {
  const reply = (type, body) => send(socket, { type, ...body, profile: socket.token ? profiles.view(socket.token) : null });
  if (!socket.account) return reply('coins-error', { error: 'Coins need a Discord login.' });
  const t = now();
  // Cashing out of Crash is never throttled: a click that arrives must count.
  const urgent = message.type === 'crash' && message.action === 'out';
  if (!urgent && socket.coinsAt && t - socket.coinsAt < (message.type === 'lookup' || message.type === 'friends' ? 0.2 : 0.45)) return reply('coins-error', { error: 'Slow down.' });
  if (!urgent) socket.coinsAt = t;
  if (message.type === 'friends') return handleFriends(socket, message);
  if (message.type === 'lookup') {
    const account = accounts.accounts.get(String(message.name || '').toLowerCase().slice(0, 32));
    const profile = account && profiles.profiles.get(ProfileStore.key(account.profileToken));
    return send(socket, { type: 'lookup-result', query: String(message.name || '').slice(0, 32), pilot: account ? { name: account.username, avatar: avatarOf(account), level: levelFromXp(profile?.xp || 0), title: profile?.look?.title || 'Recruit', you: account.username.toLowerCase() === socket.account } : null });
  }
  let result;
  if (message.type === 'shop') {
    const action = message.action;
    // A pulled feature is refused here, whatever the page thinks it is allowed to ask for.
    const shut = action === 'crate' ? 'crates' : action === 'item' ? 'itemshop' : null;
    if (shut && outages.featureOut(shut)) return send(socket, { type: 'coins-error', message: outageLine(outages.get('feature', shut), featureName(shut)) });
    result = action === 'crate' ? openCrate(profiles, socket.token, String(message.crate || ''), message.count, message.free === true)
      : action === 'scrap' ? scrapSkin(profiles, socket.token, String(message.finish || ''))
      : action === 'tradeup' ? tradeUp(profiles, socket.token, message.items)
      : action === 'gear' ? buyGear(profiles, socket.token, message.kind, message.id)
      : action === 'item' ? buyItemShop(profiles, socket.token, String(message.set || ''), String(message.kind || ''), String(message.id || ''))
      : buySkin(profiles, socket.token, String(message.finish || ''));
    if (result.unboxed) announceDrops(socket.name, result.unboxed.drops);
    if (result.traded) announceDrops(socket.name, [result.traded]);
  }
  else if (message.type === 'game') {
    if (outages.featureOut('games')) return send(socket, { type: 'coins-error', message: outageLine(outages.get('feature', 'games'), 'Games') });
    result = playGame(profiles, socket.token, message);
  }
  else if (message.type === 'crash') {
    // Cashing out is always allowed: a bet already running must never be trapped by the switch.
    if (message.action !== 'out' && outages.featureOut('games')) return send(socket, { type: 'coins-error', message: outageLine(outages.get('feature', 'games'), 'Games') });
    result = message.action === 'out' ? cashOutCrash(socket.token) : startCrash(profiles, socket.token, message, now, crashSettled);
  }
  else if (message.type === 'send-coins') {
    if (outages.featureOut('trading')) return send(socket, { type: 'coins-error', message: outageLine(outages.get('feature', 'trading'), 'Sending coins') });
    result = sendCoins(profiles, accounts, socket.token, socket.name, message.to, message.amount);
    if (result.sent) {
      console.log(`coins: ${socket.name} sent ${result.sent.amount} to ${result.sent.to}`);
      const view = profiles.view(result.account.profileToken);
      for (const other of sockets) if (other.account === result.account.username.toLowerCase()) { send(other, { type: 'profile', profile: view }); send(other, { type: 'notice', tone: 'good', text: `${socket.name} sent you ${result.sent.amount} coins` }); }
      delete result.account;
    }
  }
  if (!result) return;
  reply(result.error ? 'coins-error' : 'coins-result', result);
}

// Who is on the server right now, for the developers' accounts only. Nobody else can ask, and it is
// never broadcast: it names guests as well as accounts, so it stays between the people running the game.
function sendOnline(socket) {
  if (!socket.identified || !profiles.get(socket.token).dev) return;
  const players = [...sockets].filter((other) => other.identified).map((other) => ({
    name: other.name || 'Pilot',
    account: Boolean(other.account),
    room: other.room?.name || null,
    queue: other.room?.queue || null,
    phase: other.room?.phase || null,
    playing: Boolean(other.player?.alive),
    level: levelFromXp(profiles.get(other.token).xp),
    ping: other.player?.ping || 0,
    you: other === socket,
  })).sort((a, b) => Number(b.account) - Number(a.account) || a.name.localeCompare(b.name));
  const rooms = [...rooms_()].map((room) => ({ name: room.name, queue: room.queue, phase: room.phase, humans: room.connectedHumans().length, bots: [...room.players.values()].filter((p) => p.bot && !p.dummy).length }));
  send(socket, { type: 'dev-online', players, rooms, bots: rooms.reduce((sum, room) => sum + room.bots, 0) });
}
const rooms_ = () => rooms.values();

// Watch a live match from the online card. Developers only, like the card itself. It seats nobody: the
// room takes them as a watcher, which every count that runs a match skips, so a developer looking at a
// game cannot change the game they are looking at.
function watchRoom(socket, message) {
  if (!socket.identified || !profiles.get(socket.token).dev) return;
  const room = rooms.get(String(message.room || ''));
  if (!room) return send(socket, { type: 'error', message: 'That match has ended.' });
  if (socket.room === room) return;
  leaveRoom(socket, true);
  const look = profiles.sanitizeCosmetics(socket.token, socket.lastLook || {});
  if (!room.watch(socket, { token: socket.token, session: socket.session, name: socket.name }, look)) {
    send(socket, { type: 'error', message: 'You are already in that match.' });
  }
}


// A Crash round that ended on its own (crashed, or hit the auto cash-out): tell every tab on that account.
function crashSettled(token, game) {
  for (const socket of sockets) if (socket.token === token && socket.account) send(socket, { type: 'coins-result', game, profile: profiles.view(token) });
}

// Friends: name, picture, level and where they are right now.
function profileOf(name) {
  const account = accounts.accounts.get(String(name || '').toLowerCase());
  if (!account) return null;
  const profile = profiles.profiles.get(ProfileStore.key(account.profileToken));
  return profile ? socialLists(profile) : null;
}
function accountOf(name) { return accounts.accounts.get(String(name || '').toLowerCase()) || null; }
function socketOf(name) {
  const key = String(name || '').toLowerCase();
  return [...sockets].find((other) => other.account === key) || null;
}
// Where a pilot is, in as few words as the menu can show.
function presenceOf(name) {
  const other = socketOf(name);
  if (!other) return { online: false, where: 'Offline' };
  if (!other.room) return { online: true, where: parties.of(name)?.members.length > 1 ? 'In a party' : 'In the menu' };
  const room = other.room;
  const queue = room.royale ? 'Royale' : String(room.queue || 'match').toUpperCase();
  return { online: true, where: room.phase === 'lobby' ? `${queue} lobby` : `Playing ${queue}`, room: room.name };
}
function pilotView(name, viewer = null) {
  const account = accountOf(name);
  if (!account) return null;
  const profile = profiles.profiles.get(ProfileStore.key(account.profileToken));
  return {
    name: account.username, avatar: avatarOf(account), level: levelFromXp(profile?.xp || 0),
    title: profile?.look?.title || 'Recruit', ...presenceOf(account.username),
    relation: viewer ? relation(viewer, account.username) : 'none',
  };
}
function partyView(party) {
  if (!party) return null;
  return {
    id: party.id, leader: party.leader, limit: parties.limit, queued: party.queued || null,
    members: party.members.map((member) => ({
      ...pilotView(member), ready: parties.isLeader(party, member) || party.ready.has(member.toLowerCase()),
      leader: parties.isLeader(party, member),
    })).filter(Boolean),
  };
}
// Everything the Social page draws, in one message.
function socialView(socket) {
  const me = profiles.wallet(socket.token);
  socialLists(me);
  if (normalizeFriends(me, socket.name, profileOf)) profiles.scheduleSave();
  const view = (name) => pilotView(name, me);
  const seen = new Set([...me.friends, ...me.requestsIn, ...me.requestsOut, ...me.blocked].map((n) => n.toLowerCase()));
  return {
    friends: me.friends.map(view).filter(Boolean).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    requestsIn: me.requestsIn.map(view).filter(Boolean),
    requestsOut: me.requestsOut.map(view).filter(Boolean),
    blocked: me.blocked.map(view).filter(Boolean),
    // Pilots you have played against and not dealt with yet.
    recent: (me.recent || []).filter((name) => !seen.has(name.toLowerCase())).map(view).filter(Boolean).slice(0, 8),
    party: partyView(parties.ensure(socket.name)),
  };
}
function pushSocial(socket) {
  if (socket && socket.account && socket.readyState === 1) send(socket, { type: 'social', ...socialView(socket) });
}
function pushSocialTo(name) { const other = socketOf(name); if (other) pushSocial(other); }
function tellFriends(name) {
  const key = String(name).toLowerCase();
  for (const other of sockets) {
    if (!other.account || other.readyState !== 1 || other.account === key) continue;
    const profile = profiles.profiles.get(ProfileStore.key(other.token));
    if (profile?.friends?.some((friend) => friend.toLowerCase() === key)) pushSocial(other);
  }
}
function pushParty(party) {
  if (!party) return;
  for (const member of party.members) pushSocialTo(member);
}
function tell(name, text, tone = 'info') {
  const other = socketOf(name);
  if (other) send(other, { type: 'notice', tone, text });
}

function handleFriends(socket, message) {
  const me = profiles.wallet(socket.token);
  socialLists(me);
  if (message.action === 'list') return void pushSocial(socket);
  const name = String(message.name || '').slice(0, 32);
  const account = accountOf(name);
  const other = account && profileOf(account.username);
  if (!account || !other) return send(socket, { type: 'friends-result', error: 'No pilot with that name.', ...socialView(socket) });
  const them = account.username;
  const actions = {
    add: () => requestFriend(me, socket.name, other, them),
    accept: () => acceptFriend(me, socket.name, other, them),
    reject: () => rejectFriend(me, socket.name, other, them),
    remove: () => unfriend(me, socket.name, other, them),
    block: () => blockPilot(me, socket.name, other, them),
    unblock: () => unblockPilot(me, socket.name, other, them),
  };
  const run = actions[message.action];
  if (!run) return;
  const result = run();
  if (result.ok) {
    // Blocking has to break the party too, or a blocked pilot is still sitting in it.
    if (result.kind === 'blocked') {
      const party = parties.of(socket.name);
      if (parties.has(party, them)) { parties.leave(party, them); tell(them, 'You were removed from the party.', 'bad'); pushParty(party); }
    }
    profiles.scheduleSave();
    if (result.tell) tell(them, result.tell, 'good');
    pushSocialTo(them);
  }
  send(socket, { type: 'friends-result', error: result.error || null, note: result.note || null, ...socialView(socket) });
}

function handleParty(socket, message) {
  const party = parties.ensure(socket.name);
  const name = String(message.name || '').slice(0, 32);
  const account = name ? accountOf(name) : null;
  const them = account?.username || null;
  const fail = (error) => send(socket, { type: 'party-result', error, ...socialView(socket) });

  if (message.action === 'invite') {
    if (!them) return fail('No pilot with that name.');
    const other = profileOf(them);
    const me = profiles.wallet(socket.token);
    if (!other || blockedEitherWay(me, other, socket.name, them)) return fail('You cannot invite that pilot.');
    if (!socketOf(them)) return fail('They are offline.');
    const result = parties.invite(party, them);
    if (result.error) return fail(result.error);
    send(socketOf(them), { type: 'party-invite', id: party.id, from: pilotView(socket.name), size: party.members.length });
    return send(socket, { type: 'party-result', note: `Invite sent to ${them}.`, ...socialView(socket) });
  }
  if (message.action === 'join') {
    const target = parties.get(String(message.id || ''));
    if (!target) return fail('That party has gone.');
    if (!parties.invited(target, socket.name)) return fail('You were not invited.');
    const leaderProfile = profileOf(target.leader);
    const me = profiles.wallet(socket.token);
    if (leaderProfile && blockedEitherWay(me, leaderProfile, socket.name, target.leader)) return fail('You cannot join that party.');
    const before = parties.of(socket.name);
    const result = parties.join(target, socket.name);
    if (result.error) return fail(result.error);
    for (const member of target.members) if (member !== socket.name) tell(member, `${socket.name} joined the party`);
    pushParty(target);
    if (before && before !== target) pushParty(before);
    return void pushSocial(socket);
  }
  if (message.action === 'leave') {
    const left = parties.leave(party, socket.name);
    if (left) { for (const member of left.members) tell(member, `${socket.name} left the party`); pushParty(left); }
    parties.ensure(socket.name);
    return void pushSocial(socket);
  }
  if (message.action === 'kick') {
    const result = parties.kick(party, socket.name, them || name);
    if (result.error) return fail(result.error);
    tell(them || name, 'You were removed from the party.', 'bad');
    pushSocialTo(them || name);
    pushParty(party);
    return void pushSocial(socket);
  }
  if (message.action === 'promote') {
    const result = parties.promote(party, socket.name, them || name);
    if (result.error) return fail(result.error);
    pushParty(party);
    return void pushSocial(socket);
  }
  if (message.action === 'ready') {
    parties.setReady(party, socket.name, message.ready !== false);
    return void pushParty(party);
  }
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
  profiles.setDev(socket.token, isDev(account));
  profiles.scheduleSave();
  if (socket.player) { socket.player.name = account.username; socket.room.pushRoom(); }
  send(socket, { type: 'identity', username: account.username, avatar: avatarOf(account), session, profile: profiles.view(socket.token), serverTime: now(), online: [...sockets].filter((s) => s.identified).length, rooms: publicRooms(), modifier: dailyModifier(dateKey()) });
  parties.ensure(account.username);
  pushSocial(socket);
  tellFriends(account.username);
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
  royale: { label: 'Royale kills', value: (p) => p.stats?.royaleKills || 0, eligible: (p) => (p.stats?.royaleKills || 0) > 0 },
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
      avatar: avatarOf(account),
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
installCatalogue();
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
  const open = [...rooms.values()].filter((room) => room.queue === queue && room.isPublic && !room.closed && room.connectedHumans().length < room.capacity);
  open.sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.connectedHumans().length - a.connectedHumans().length);
  // Ranked prefers the lobby whose pilots are closest to your rating (never splits the queue, only orders it).
  const gap = (room) => { const humans = room.connectedHumans(); return humans.length ? Math.abs(humans.reduce((sum, p) => sum + p.rating, 0) / humans.length - rating) : 400; };
  if (isRanked(queue)) open.sort((a, b) => gap(a) - gap(b));
  // Ranked never drops you into a match that is already running.
  const pick = open.find((room) => !isRanked(queue) || room.phase === 'lobby');
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
  if (!socket.account) return;
  // Once nobody is left in the match, the party can queue again.
  const party = parties.of(socket.name);
  if (party?.queued && !party.members.some((member) => socketOf(member)?.room)) { parties.setQueued(party, null); pushParty(party); }
  tellFriends(socket.name);
}

const RANKED_LOGIN = 'Ranked needs a Discord login.';
const WAGER_LOGIN = 'Wagers need a Discord login.';

// Anti-cheat: pull the seat, tell the page why, then drop the socket. The page
// keeps itself locked out until the injected script is gone, and the ledger
// makes each repeat wait longer.
function kickCheater(socket, reason) {
  if (socket.guardKicked) return;
  socket.guardKicked = true;
  // Going quiet is not proof of anything, so it drops the socket without banking a strike. Deleting
  // the guard still means never getting to play, because it happens again on every reconnect.
  const detected = isDetection(reason);
  const count = detected ? guard.strike(socket, reason) : 0;
  const seconds = detected ? guard.lockout(count) : 0;
  console.log(`anti-cheat: ${detected ? 'kicked' : 'dropped'} ${socket.name || 'unidentified'}: ${reason} (${guard.describe(socket)})${detected ? `, strike ${count}, ${seconds}s` : ', no strike'}`);
  leaveRoom(socket, true);
  send(socket, { type: 'kicked', reason, seconds, strikes: count });
  setTimeout(() => { try { socket.close(4003, 'anti-cheat'); } catch { /* already gone */ } }, 150);
}

function enter(socket, message) {
  if (!socket.identified) return send(socket, { type: 'error', message: 'Log in to play.' });
  const wait = guard.locked(socket);
  if (wait) return send(socket, { type: 'error', message: `Anti-cheat lockout: wait ${wait}s, and turn off any userscripts first.` });
  leaveRoom(socket, true);
  const action = String(message.action || 'quick');
  let room = null;
  if (action === 'rejoin') {
    room = rooms.get(String(message.room || ''));
    const held = room && [...room.players.values()].some((p) => !p.bot && !p.connected && p.session === socket.session);
    if (!held) return send(socket, { type: 'rejoin-failed' });
  } else if (action === 'range') room = createRoom(`range-${roomCounter++}`, { queue: 'range' });
  else if (action === 'bots') room = createRoom(`bots-${roomCounter++}`, { queue: 'bots' });
  else if (action === 'royale') {
    if (outages.featureOut('royale')) return send(socket, { type: 'error', message: outageLine(outages.get('feature', 'royale'), 'Battle royale') });
    // One open royale lobby at a time; a new one once it has started or filled.
    room = [...rooms.values()].find((r) => r.royale && r.phase === 'lobby' && r.connectedHumans().length < ROYALE.max);
    if (!room) { const name = `royale-${roomCounter++}`; room = new RoyaleRoom({ name, profiles, onEmpty: (empty) => { empty.close(); rooms.delete(empty.name); } }); rooms.set(name, room); }
  }
  else if (action === 'wager') {
    if (!socket.account) return send(socket, { type: 'error', message: WAGER_LOGIN });
    const size = WAGER.sizes.includes(message.size) ? message.size : 1;
    const stake = Number.isInteger(message.stake) && message.stake >= WAGER.minStake && message.stake <= WAGER.maxStake ? message.stake : null;
    if (!stake) return send(socket, { type: 'error', message: `Stakes are ${WAGER.minStake} to ${WAGER.maxStake} coins.` });
    if (profiles.coins(socket.token) < stake) return send(socket, { type: 'error', message: 'Not enough coins for that stake.' });
    let name;
    do name = `wager-${Math.random().toString(36).slice(2, 6)}`; while (rooms.has(name));
    room = createRoom(name, { queue: 'custom', isPublic: Boolean(message.isPublic), wager: { size, stake } });
  }
  else if (action === 'quick') {
    const queue = ['casual', 'ranked', 'arcade', ...TEAM_MODE_IDS, ...RANKED_IDS].includes(message.queue) ? message.queue : 'casual';
    if (isRanked(queue) && outages.featureOut('ranked')) return send(socket, { type: 'error', message: outageLine(outages.get('feature', 'ranked'), 'Ranked') });
    if (isRanked(queue) && !socket.account) return send(socket, { type: 'error', message: RANKED_LOGIN });
    room = findQuickRoom(queue, profiles.get(socket.token).rating);
  } else {
    const name = cleanRoomName(message.room);
    if (name.length < 3) return send(socket, { type: 'error', message: 'Room codes need 3+ characters.' });
    room = rooms.get(name);
    if (room && isRanked(room.queue) && !socket.account) return send(socket, { type: 'error', message: RANKED_LOGIN });
    if (room?.wager && !socket.account) return send(socket, { type: 'error', message: WAGER_LOGIN });
    if (room && room.queue !== 'custom' && !room.isPublic) return send(socket, { type: 'error', message: 'That room is private.' });
    if (!room) room = createRoom(name, { queue: 'custom', isPublic: Boolean(message.isPublic) });
  }
  if (message.difficulty && room.queue === 'bots') room.rules.botDifficulty = ['recruit', 'veteran', 'elite'].includes(message.difficulty) ? message.difficulty : 'veteran';
  if (!place(socket, room, message)) return;
  // A party follows its leader in. Anyone who cannot be seated is told, and stays in the menu.
  const party = socket.account ? parties.of(socket.name) : null;
  if (party && parties.isLeader(party, socket.name) && party.members.length > 1 && action !== 'rejoin') {
    parties.setQueued(party, room.name);
    for (const member of party.members) {
      if (member === socket.name) continue;
      const mate = socketOf(member);
      if (!mate || !mate.identified) { tell(member, 'You were not taken into the match.', 'bad'); continue; }
      leaveRoom(mate, true);
      if (!place(mate, room, { look: mate.lastLook || {} })) tell(member, 'That room filled up before you got in.', 'bad');
    }
    pushParty(party);
  }
}
// Seat one socket in a room. Returns false when the room is full.
function place(socket, room, message) {
  // Say which it is: a second tab on the same account reads as a full room otherwise.
  const taken = room.seatOf(socket.token);
  if (taken && taken.connected) { send(socket, { type: 'error', message: 'You are already in that match in another tab.' }); return false; }
  const look = profiles.sanitizeCosmetics(socket.token, message.look || {});
  socket.lastLook = message.look || socket.lastLook || {};
  const player = room.join(socket, { token: socket.token, session: socket.session, name: socket.name }, look);
  if (!player) { send(socket, { type: 'error', message: 'Room full.' }); return false; }
  return true;
}

wss.on('connection', (socket) => {
  sockets.add(socket);
  // Only the sets that have already been out. A set still to come is not described to anyone.
  send(socket, { type: 'config', build: BUILD, discord: discord.enabled, loginRequired: LOGIN_REQUIRED, invite: DISCORD_INVITE, itemShop: publicCatalogue(dateKey()), outages: outages.view() });
  socket.identified = false;
  socket.room = null;
  socket.player = null;
  socket.budget = 0;
  socket.budgetAt = now();
  send(socket, guard.challenge(socket));
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
      if (message.type === 'guard') {
        const bad = guard.heartbeat(socket, message);
        if (bad) return kickCheater(socket, bad);
        if (message.flags) console.log(`anti-cheat: ${socket.name || 'unidentified'} reports ${guard.describe(socket)}`);
        return;
      }
      if (message.type === 'guard-report') {
        const reason = typeof message.reason === 'string' && message.reason.length < 32 ? message.reason : 'injected';
        return kickCheater(socket, reason);
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
      if (['shop', 'game', 'crash', 'friends', 'send-coins', 'lookup'].includes(message.type)) return handleCoins(socket, message);
      if (message.type === 'party') { if (!socket.account) return send(socket, { type: 'party-result', error: 'Log in to use parties.' }); return handleParty(socket, message); }
      if (message.type === 'social' && socket.account) return void pushSocial(socket);
      if (message.type === 'drops') return send(socket, { type: 'drops', drops: recentDrops });
      if (message.type === 'dev-online') return sendOnline(socket);
      if (message.type === 'dev-watch') return watchRoom(socket, message);
      if (message.type === 'enter') return enter(socket, message);
      if (message.type === 'leave-room') { leaveRoom(socket, true); return send(socket, { type: 'left', profile: profiles.view(socket.token), rooms: publicRooms() }); }
      // Saved gun builds. Kept on the profile, and handed to the player so the armoury sells the build.
      // Pull a map or a gun, or put it back. Developers only, checked here on every call.
      if (message.type === 'outage') {
        if (!socket.identified || !profiles.get(socket.token).dev) return;
        const kind = String(message.kind || ''), id = String(message.id || '');
        if (!OUTAGE_KINDS.includes(kind)) return;
        const result = outages.set(kind, id, message.on === true, cleanReason(message.reason), socket.name);
        if (!result) return send(socket, { type: 'outages', outages: outages.view() });
        if (result.error) return send(socket, { type: 'error', message: result.error });
        const view = outages.view();
        console.log(`outage: ${socket.name} ${result.on ? 'pulled' : 'restored'} ${kind} ${id}`);
        for (const other of sockets) send(other, { type: 'outages', outages: view });
        // Told plainly, and only after the list is saved and sent: a developer should never be left
        // wondering whether it actually went out.
        // getMap falls back to a default arena for an id it does not know, so each kind is named
        // explicitly rather than letting a feature come out as "Kestrel Yard".
        const label = kind === 'weapon' ? (WEAPONS[id]?.name || id)
          : kind === 'feature' ? featureName(id)
          : (getMap(id)?.title || id);
        const heard = sockets.size;
        send(socket, { type: 'outage-done', kind, id, on: result.on,
          text: result.on ? `${label} is pulled. ${heard} ${heard === 1 ? 'pilot has' : 'pilots have'} been told.` : `${label} is back in the game.` });
        // Rooms fix themselves up straight away: a pulled gun leaves every hand, a pulled map ends its round.
        for (const room of rooms.values()) room.applyOutages();
        return;
      }
      if (message.type === 'builds' && socket.identified) {
        if (outages.featureOut('gunsmith')) return send(socket, { type: 'error', message: outageLine(outages.get('feature', 'gunsmith'), 'The Gunsmith') });
        profiles.saveBuilds(socket.token, message.builds);
        const saved = profiles.get(socket.token).builds || {};
        if (socket.player) socket.player.builds = saved;
        return send(socket, { type: 'profile', profile: profiles.view(socket.token) });
      }
      if (message.type === 'look' && socket.identified && socket.player && socket.room.phase === 'lobby') {
        profiles.savePrefs(socket.token, { look: message.look });
        Object.assign(socket.player, profiles.sanitizeCosmetics(socket.token, message.look || {}));
        return socket.room.pushRoom();
      }
      if (guard.overdue(socket)) return kickCheater(socket, 'silent');
      if (socket.room && socket.player) socket.room.handle(socket.player, message);
    } catch (error) {
      console.error('message failed', message.type, error);
    }
  });
  socket.on('close', () => {
    const name = socket.account ? socket.name : null;
    sockets.delete(socket);
    leaveRoom(socket);
    dropGuest(socket);
    if (!name) return;
    // Their party carries on without them, and their friends see them go.
    const party = parties.of(name);
    if (party) { parties.leave(party, name); pushParty(party); }
    tellFriends(name);
  });
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
function shutdown() { refundCrashes(); profiles.flush(); accounts.flush(); process.exit(0); }
process.on('SIGINT', shutdown); // Ctrl+C while developing: no ceremony
process.on('SIGTERM', () => {
  if (stopping) return shutdown(); // asked twice: go now
  stopping = true;
  const pilots = [...sockets].filter((socket) => socket.identified).length;
  const matches = [...rooms.values()].filter((room) => room.mode === 'match' && room.phase !== 'lobby').length;
  const seconds = pilots ? RESTART_GRACE : 0;
  console.log(`stopping for a deploy: ${pilots} online, ${matches} matches, ${seconds}s grace`);
  // kind and seconds let a pilot in a match get this as a banner instead of a line in the feed, where
  // it scrolls past in a firefight. Anything that does not know the fields still shows the text.
  for (const socket of sockets) send(socket, { type: 'notice', tone: 'warn', kind: 'restart', seconds, text: `Update incoming. Server restarts in ${seconds}s. Your match will end.` });
  const posted = webhooks.announceRestart({ seconds, pilots, matches });
  // Never let a slow webhook hold the deploy up: leave when the grace period is over, posted or not.
  Promise.race([Promise.all([posted, new Promise((resolve) => setTimeout(resolve, seconds * 1000))]), new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 3000))]).then(shutdown);
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Krosshair online at http://localhost:${port}/`);
  webhooks.announceBoot().catch((error) => console.warn('update webhook failed', error.message));
});
