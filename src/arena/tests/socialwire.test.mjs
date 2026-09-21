// The Social wiring in the entry point, driven over a real WebSocket against a real server:
// requests reach the other pilot, parties form, and a party follows its leader into the match.
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

async function arena(names) {
  const { dir, sessions } = await seed(names);
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ARENA_PORT: String(port), ARENA_DATA: path.join(dir, 'profiles.json'), ALLOW_GUESTS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('listening') || String(chunk).includes(String(port))) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  const clients = [];
  for (const name of names) {
    const pilot = client(port, name);
    await pilot.open();
    await pilot.settle('config');
    pilot.send({ type: 'auth', action: 'resume', session: sessions[name], tab: `tab-${name}` });
    await pilot.settle('identity');
    clients.push(pilot);
  }
  return { child, clients, stop: () => { clients.forEach((c) => c.socket.close()); child.kill('SIGKILL'); } };
}

const hasName = (list, name) => (list || []).some((entry) => entry.name === name);
// `friends` goes through the coins rate limiter, which refuses two actions inside 200ms.
const pace = () => new Promise((resolve) => setTimeout(resolve, 260));

// Vex and Nova, friends, in one party, ready to queue.
async function paired(vex, nova) {
  vex.send({ type: 'friends', action: 'add', name: 'Nova' });
  await nova.settle('social', (m) => hasName(m.requestsIn, 'Vex'));
  await pace();
  nova.send({ type: 'friends', action: 'accept', name: 'Vex' });
  await vex.settle('social', (m) => hasName(m.friends, 'Nova'));
  vex.send({ type: 'party', action: 'invite', name: 'Nova' });
  const invite = await nova.settle('party-invite');
  nova.send({ type: 'party', action: 'join', id: invite.id });
  await vex.settle('social', (m) => m.party?.members.length === 2);
  return invite;
}

test('a friend request reaches the other pilot, and accepting makes it mutual', async (t) => {
  const { clients: [vex, nova], stop } = await arena(['Vex', 'Nova']);
  t.after(stop);

  vex.send({ type: 'friends', action: 'add', name: 'nova' });
  const asked = await nova.settle('social', (m) => hasName(m.requestsIn, 'Vex'));
  assert.equal(asked.requestsIn[0].name, 'Vex');
  assert.equal(asked.friends.length, 0, 'not a friend until accepted');

  const mine = await vex.settle('friends-result', (m) => hasName(m.requestsOut, 'Nova'));
  assert.equal(mine.error, null);

  nova.send({ type: 'friends', action: 'accept', name: 'Vex' });
  const both = await vex.settle('social', (m) => hasName(m.friends, 'Nova'));
  assert.equal(both.friends[0].name, 'Nova');
  assert.equal(both.friends[0].online, true, 'a signed-in friend shows as online');
  assert.equal(both.friends[0].where, 'In the menu');
  assert.equal(both.requestsOut.length, 0);
});

test('a party invite has to be sent before it can be joined, and the party forms', async (t) => {
  const { clients: [vex, nova], stop } = await arena(['Vex', 'Nova']);
  t.after(stop);
  vex.send({ type: 'friends', action: 'add', name: 'Nova' });
  await nova.settle('social', (m) => hasName(m.requestsIn, 'Vex'));
  await pace();
  nova.send({ type: 'friends', action: 'accept', name: 'Vex' });
  await vex.settle('social', (m) => hasName(m.friends, 'Nova'));

  // Forged join: no invite was sent.
  const partyId = (await vex.settle('social', (m) => Boolean(m.party))).party.id;
  nova.send({ type: 'party', action: 'join', id: partyId });
  const refused = await nova.settle('party-result', (m) => Boolean(m.error));
  assert.equal(refused.error, 'You were not invited.');

  vex.send({ type: 'party', action: 'invite', name: 'Nova' });
  const invite = await nova.settle('party-invite');
  assert.equal(invite.from.name, 'Vex');
  nova.send({ type: 'party', action: 'join', id: invite.id });

  const party = (await vex.settle('social', (m) => m.party?.members.length === 2)).party;
  assert.equal(party.leader, 'Vex');
  assert.deepEqual(party.members.map((m) => m.name), ['Vex', 'Nova']);
  assert.equal(party.members[0].leader, true);
  assert.equal(party.members[1].ready, false, 'a new member is not ready yet');
});

test('the party follows its leader into the match', async (t) => {
  const { clients: [vex, nova], stop } = await arena(['Vex', 'Nova']);
  t.after(stop);
  await paired(vex, nova);

  vex.send({ type: 'enter', action: 'bots', look: {} });
  const leaderRoom = await vex.settle('room');
  const mateRoom = await nova.settle('room');
  assert.equal(mateRoom.name, leaderRoom.name, 'both are in the same room');
  assert.ok(leaderRoom.name.startsWith('bots-'));
  assert.ok(mateRoom.players.some((player) => player.name === 'Nova'), 'the mate is really in the roster');
});

test('blocking a party member removes them from the party', async (t) => {
  const { clients: [vex, nova], stop } = await arena(['Vex', 'Nova']);
  t.after(stop);
  await paired(vex, nova);
  await pace();

  vex.send({ type: 'friends', action: 'block', name: 'Nova' });
  const after = await vex.settle('social', (m) => hasName(m.blocked, 'Nova'));
  assert.equal(after.party.members.length, 1, 'the blocked pilot is out of the party');
  assert.equal(after.friends.length, 0, 'blocking ends the friendship');

  // And they cannot ask again.
  await pace();
  nova.send({ type: 'friends', action: 'add', name: 'Vex' });
  const denied = await nova.settle('friends-result', (m) => Boolean(m.error));
  assert.equal(denied.error, 'They are not taking requests.');
});

// The invite worked on the server and went nowhere, because the client had no handler for it.
// This is the cheap check that would have caught it: every message the social system sends has
// somewhere to land.
test('every social message the server sends is handled by the client', async () => {
  const server = await readFile(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  const client = await readFile(new URL('../client/social.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../client/main.js', import.meta.url), 'utf8');

  // What the friends and party handlers send back.
  const sent = new Set();
  for (const [, type] of server.matchAll(/type:\s*'(social|party-[a-z]+|friends-[a-z]+)'/g)) sent.add(type);
  assert.ok(sent.has('party-invite'), 'the server does send party invites');
  assert.ok(sent.size >= 4, `expected the social messages, saw ${[...sent].join(', ')}`);

  const handled = new Set();
  for (const source of [client, main]) for (const [, type] of source.matchAll(/net\.on\('([^']+)'/g)) handled.add(type);
  const orphans = [...sent].filter((type) => !handled.has(type));
  assert.deepEqual(orphans, [], `these arrive at the browser and nothing listens: ${orphans.join(', ')}`);
});
