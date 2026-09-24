// A party follows its leader into a match, but only where that is fair to everyone else in it: never out
// of a match a member is playing, never past the anti-cheat, never onto both sides of a ranked match.
// Driven over real sockets against a real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const entry = fileURLToPath(new URL('../multiplayer-server.mjs', import.meta.url));
const hashSession = (token) => createHash('sha256').update(token).digest('hex');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function server(names) {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-follow-'));
  const sessions = {}, accounts = {};
  names.forEach((username, index) => {
    const token = randomBytes(32).toString('base64url');
    sessions[username] = token;
    accounts[username.toLowerCase()] = { username, discordId: String(200000 + index), created: Date.now(), profileToken: randomUUID(), sessions: [{ hash: hashSession(token), created: Date.now(), seen: Date.now() }] };
  });
  await writeFile(path.join(dir, 'accounts.json'), JSON.stringify({ version: 1, accounts }));
  const probe = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => probe.on('listening', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ARENA_PORT: String(port), ARENA_DATA: path.join(dir, 'profiles.json'), ARENA_FEEDBACK: path.join(dir, 'feedback.jsonl'), DISCORD_WEBHOOK_UPDATES: 'off', DISCORD_WEBHOOK_LEADERBOARD: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('online at')) { clearTimeout(timer); resolve(); } });
  });
  return { port, sessions, stop: () => child.kill('SIGKILL') };
}

async function pilot(port, sessions, name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const inbox = [];
  socket.addEventListener('message', (event) => inbox.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  const me = {
    name, inbox,
    send: (message) => socket.send(JSON.stringify(message)),
    // `from`: only messages after this point in the inbox, so an old one never answers for a new event.
    settle: async (type, ok = () => true, ms = 6000, from = 0) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = inbox.slice(from).reverse().find((message) => message.type === type && ok(message));
        if (found) return found;
        await wait(25);
      }
      throw new Error(`${name}: no ${type} in time. Saw: ${inbox.map((m) => m.type).join(', ')}`);
    },
    room: () => [...inbox].reverse().find((message) => message.type === 'welcome')?.room || null,
    close: () => socket.close(),
  };
  await me.settle('config');
  me.send({ type: 'auth', action: 'resume', session: sessions[name], tab: `tab-${name}` });
  await me.settle('identity');
  return me;
}

async function party(leader, mate) {
  // Invites go to friends only.
  if (!leader.friends?.has(mate.name)) {
    leader.send({ type: 'friends', action: 'add', name: mate.name });
    await mate.settle('social', (message) => message.requestsIn?.some((who) => who.name === leader.name));
    mate.send({ type: 'friends', action: 'accept', name: leader.name });
    await leader.settle('social', (message) => message.friends?.some((who) => who.name === mate.name));
    (leader.friends ||= new Set()).add(mate.name);
  }
  await wait(1100); // invites are paced
  const [led, got] = [leader.inbox.length, mate.inbox.length];
  leader.send({ type: 'party', action: 'invite', name: mate.name });
  const invite = await mate.settle('party-invite', () => true, 6000, got).catch((error) => { throw new Error(`${error.message.slice(0, 80)} / leader: ${JSON.stringify(leader.inbox.slice(led).filter((m) => m.type === 'party-result').map((m) => m.error || m.note))}`); });
  mate.send({ type: 'party', action: 'join', id: invite.id });
  await leader.settle('social', (message) => message.party?.members?.length === 2, 6000, led);
}

test('a party of two is not put on both sides of a ranked 1v1', async () => {
  const { port, sessions, stop } = await server(['Lead', 'Mate']);
  try {
    const lead = await pilot(port, sessions, 'Lead'), mate = await pilot(port, sessions, 'Mate');
    await party(lead, mate);
    lead.send({ type: 'enter', action: 'quick', queue: 'ranked-1v1', look: {} });
    await lead.settle('welcome');
    await mate.settle('notice', (message) => /too big/.test(message.text || ''));
    assert.equal(mate.room(), null, 'the party mate was seated as the leader\'s opponent');
  } finally { stop(); }
});

test('a member in the middle of a match is not pulled out of it', async () => {
  const { port, sessions, stop } = await server(['Lead', 'Mate']);
  try {
    const lead = await pilot(port, sessions, 'Lead'), mate = await pilot(port, sessions, 'Mate');
    await party(lead, mate);
    // The mate goes off to play on their own first.
    mate.send({ type: 'party', action: 'leave' });
    await wait(200);
    mate.send({ type: 'enter', action: 'bots', look: {} });
    const welcome = await mate.settle('welcome');
    await mate.settle('phase', (message) => message.phase !== 'lobby', 12000).catch(() => mate.settle('round', () => true, 12000));
    // Back into the party while the match runs, and the leader presses Play.
    await party(lead, mate);
    lead.send({ type: 'enter', action: 'range', look: {} });
    await lead.settle('welcome', (message) => message.room.startsWith('range'));
    await mate.settle('notice', (message) => /in one/.test(message.text || ''));
    assert.equal(mate.room(), welcome.room, 'the member was dragged out of their match');
  } finally { stop(); }
});

test('the anti-cheat lockout holds for a party member too', async () => {
  const { port, sessions, stop } = await server(['Lead', 'Mate']);
  try {
    const lead = await pilot(port, sessions, 'Lead');
    let mate = await pilot(port, sessions, 'Mate');
    mate.send({ type: 'guard-report', reason: 'injected' });
    await mate.settle('kicked');
    await wait(300);
    mate = await pilot(port, sessions, 'Mate');
    await party(lead, mate);
    lead.send({ type: 'enter', action: 'bots', look: {} });
    await lead.settle('welcome');
    await mate.settle('notice', (message) => /lockout/.test(message.text || ''));
    assert.equal(mate.room(), null, 'a locked-out pilot rode the party into a match');
  } finally { stop(); }
});

test('a guest cannot go by an account\'s name', async () => {
  const { port, stop } = await server(['Lead']);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
    const inbox = [];
    socket.addEventListener('message', (event) => inbox.push(JSON.parse(event.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    socket.send(JSON.stringify({ type: 'identify', name: 'lead' }));
    for (let i = 0; i < 40 && !inbox.some((m) => m.type === 'identity' || m.type === 'error'); i += 1) await wait(50);
    assert.equal(inbox.find((m) => m.type === 'error')?.message, 'That callsign belongs to an account.');
    assert.ok(!inbox.some((m) => m.type === 'identity'), 'the guest was let in under the account\'s name');
    socket.send(JSON.stringify({ type: 'identify', name: 'Wanderer' }));
    for (let i = 0; i < 40 && !inbox.some((m) => m.type === 'identity'); i += 1) await wait(50);
    assert.ok(inbox.some((m) => m.type === 'identity'), 'any other callsign is still fine');
    socket.close();
  } finally { stop(); }
});
