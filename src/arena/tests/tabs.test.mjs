// One game per person: an account signed in twice keeps only the newest connection, and the old tab is
// told so it stops reconnecting. Driven over real sockets against a real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const entry = fileURLToPath(new URL('../multiplayer-server.mjs', import.meta.url));
const hashSession = (token) => createHash('sha256').update(token).digest('hex');

// Accounts are Discord-only in this build, so the store is seeded with sessions whose hash we know.
async function seed(names) {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-social-'));
  const sessions = {};
  const accounts = {};
  names.forEach((username, index) => {
    const token = randomBytes(32).toString('base64url');
    sessions[username] = token;
    accounts[username.toLowerCase()] = {
      username, discordId: String(100000 + index), created: Date.now(), profileToken: randomUUID(),
      sessions: [{ hash: hashSession(token), created: Date.now(), seen: Date.now() }],
    };
  });
  await writeFile(path.join(dir, 'accounts.json'), JSON.stringify({ version: 1, accounts }));
  return { dir, sessions };
}

async function freePort() {
  const probe = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => probe.on('listening', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function client(port, name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const inbox = [];
  socket.addEventListener('message', (event) => inbox.push(JSON.parse(event.data)));
  return {
    socket, inbox, name,
    open: () => new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); }),
    send: (message) => socket.send(JSON.stringify(message)),
    last: (type) => [...inbox].reverse().find((message) => message.type === type) || null,
    // Wait for a message of this type that satisfies the test, so an earlier snapshot never passes by mistake.
    settle: async (type, ok = () => true, ms = 4000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = [...inbox].reverse().find((message) => message.type === type && ok(message));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`${name}: no ${type} matched in time. Saw: ${inbox.map((m) => m.type).join(', ')}`);
    },
  };
}


async function server(names) {
  const { dir, sessions } = await seed(names);
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ARENA_PORT: String(port), ARENA_DATA: path.join(dir, 'profiles.json'), ALLOW_GUESTS: '1', DISCORD_WEBHOOK_UPDATES: 'off', DISCORD_WEBHOOK_LEADERBOARD: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('listening') || String(chunk).includes(String(port))) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  return { port, sessions, stop: () => child.kill('SIGKILL') };
}
async function tab(port, name, hello) {
  const pilot = client(port, name);
  pilot.closed = null;
  pilot.socket.addEventListener('close', (event) => { pilot.closed = event.code; });
  await pilot.open();
  await pilot.settle('config');
  pilot.send(hello);
  await pilot.settle('identity');
  return pilot;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('signing in again takes over from the old connection, which is told to stop', async () => {
  const { port, sessions, stop } = await server(['Vex']);
  try {
    const first = await tab(port, 'first', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-1' });
    const second = await tab(port, 'second', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-2' });
    await first.settle('replaced');
    await wait(300);
    assert.equal(first.closed, 4004, 'the old tab was not closed, so both could queue');
    assert.equal(second.closed, null, 'the new tab was closed instead of the old one');
    // And the one left is a working connection.
    second.send({ type: 'leaderboard' });
    await second.settle('leaderboard');
  } finally { stop(); }
});

test('taking over mid-match carries the match into the new tab, same seat', async () => {
  const { port, sessions, stop } = await server(['Vex']);
  try {
    const first = await tab(port, 'first', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-1' });
    first.send({ type: 'enter', action: 'bots', look: {} });
    const welcome = await first.settle('welcome');
    await first.settle('room', (m) => m.phase && m.phase !== 'lobby', 12000);   // under way, so the seat is held
    const second = await tab(port, 'second', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-2' });
    await first.settle('replaced');
    const offer = await second.settle('rejoin-offer');
    assert.equal(offer.room, welcome.room, 'the new tab was not told about the match');
    // What net.js does with the offer.
    second.send({ type: 'enter', action: 'rejoin', room: offer.room, look: {} });
    const back = await second.settle('welcome');
    assert.equal(back.room, welcome.room, 'the new tab could not get back into the match');
    assert.equal(back.id, welcome.id, 'and it should be the same seat, not a second one');
  } finally { stop(); }
});

test('taking over in a lobby just lets the lobby go: nothing to carry', async () => {
  const { port, sessions, stop } = await server(['Vex']);
  try {
    const first = await tab(port, 'first', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-1' });
    first.send({ type: 'enter', action: 'quick', queue: 'casual', look: {} });
    await first.settle('welcome');
    const second = await tab(port, 'second', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-2' });
    await first.settle('replaced');
    await wait(500);
    assert.ok(!second.inbox.some((m) => m.type === 'rejoin-offer'), 'a lobby is not a match to carry on in');
  } finally { stop(); }
});

test('two different accounts are not affected by each other', async () => {
  const { port, sessions, stop } = await server(['Vex', 'Nova']);
  try {
    const vex = await tab(port, 'vex', { type: 'auth', action: 'resume', session: sessions.Vex, tab: 'tab-1' });
    const nova = await tab(port, 'nova', { type: 'auth', action: 'resume', session: sessions.Nova, tab: 'tab-2' });
    await wait(400);
    assert.equal(vex.closed, null); assert.equal(nova.closed, null);
    assert.ok(!vex.inbox.some((m) => m.type === 'replaced'), 'another account signing in knocked this one off');
  } finally { stop(); }
});

// The client half: without it the old tab would reconnect straight away and knock the new one off, and
// the two would take it back from each other for ever.
test('a tab that is taken over stands down instead of reconnecting', async () => {
  const { readFileSync } = await import('node:fs');
  const net = readFileSync(new URL('../client/net.js', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
  assert.match(net, /if \(message\.type === 'replaced'\) return standDown\('device'\);/, 'the server saying so is ignored');
  assert.match(net, /message\.type === 'rejoin-offer'[^\n]*net\.send\(\{ type: 'enter', action: 'rejoin', room: message\.room/, 'the new tab is told about the match and does nothing with it');
  assert.match(net, /tabs\?\.postMessage\(\{ type: 'take', id: tabId \}\)/, 'a tab never tells the others in this browser that it has the game');
  assert.match(net, /event\.data\?\.type === 'take' && event\.data\.id !== tabId\) standDown\('tab'\)/, 'and the others never listen');
  const stand = net.slice(net.indexOf('function standDown'), net.indexOf('export const net'));
  assert.match(stand, /suspended = true;/, 'standing down has to stop the retries');
  assert.match(net, /\/\/ Stood down on purpose[^\n]*\n\s*if \(suspended\) return;/, 'and must not show "connection lost"');
  const card = menu.slice(menu.indexOf("bus.on('elsewhere'"), menu.indexOf("bus.on('elsewhere'") + 700);
  assert.match(card, /sticky: true/, 'the card can be waved away, leaving a dead tab that looks alive');
  assert.match(card, /onAccept: \(\) => net\.resume\(\)/, 'Play here takes the game back');
});
