// Dev spectating, driven over a real WebSocket against a real server. The Room side is covered in
// watch.test.mjs; this is the wiring: the route is reachable, only a developer gets through it, and the
// match being watched is never told anyone arrived.
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

// devs.js matches on the Discord name, so one account carries a real one and the other does not.
async function seed() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-watchwire-'));
  const sessions = {}, accounts = {};
  [['Dev', 'wjonsey'], ['Pilot', 'nobody-in-particular']].forEach(([username, discordName], index) => {
    const token = randomBytes(32).toString('base64url');
    sessions[username] = token;
    accounts[username.toLowerCase()] = {
      username, discordId: String(500000 + index), discordName, created: Date.now(), profileToken: randomUUID(),
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
    settle: async (type, ok = () => true, ms = 6000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = [...inbox].reverse().find((message) => message.type === type && ok(message));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`${name}: no ${type} matched in time. Saw: ${[...new Set(inbox.map((m) => m.type))].join(', ')}`);
    },
    quiet: async (type, ms = 900) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      const found = inbox.find((message) => message.type === type);
      assert.equal(found, undefined, `${name} received a ${type} it should never have got`);
    },
  };
}

async function arena() {
  const { dir, sessions } = await seed();
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
  const clients = {};
  for (const name of ['Dev', 'Pilot']) {
    const pilot = client(port, name);
    await pilot.open();
    await pilot.settle('config');
    pilot.send({ type: 'auth', action: 'resume', session: sessions[name], tab: `tab-${name}` });
    await pilot.settle('identity');
    clients[name] = pilot;
  }
  return { child, ...clients, stop: () => { Object.values(clients).forEach((c) => c.socket.close()); child.kill('SIGKILL'); } };
}

test('a developer can watch a match, and the match is never told', async () => {
  const { Dev, Pilot, stop } = await arena();
  try {
    Pilot.send({ type: 'enter', action: 'quick', queue: 'casual' });
    const room = await Pilot.settle('room', (m) => m.players?.some((p) => p.name === 'Pilot'));
    assert.equal(room.players.filter((p) => !p.bot).length, 1, 'one human in the match to begin with');

    // The card lists the room, which is where the Watch button gets its name.
    Dev.send({ type: 'dev-online' });
    const card = await Dev.settle('dev-online', (m) => m.rooms?.length);
    const name = card.rooms[0].name;

    Dev.send({ type: 'dev-watch', room: name });
    const watching = await Dev.settle('watching');
    assert.equal(watching.room, name, 'the dev was told which match they are in');
    await Dev.settle('welcome', (m) => m.room === name, 8000);
    await Dev.settle('room');

    // What the pilot is shown must not have changed.
    const after = await Pilot.settle('room', (m) => m.players?.some((p) => p.name === 'Pilot'));
    assert.ok(!after.players.some((p) => p.name === 'Dev'), 'the watcher appeared on the pilot’s scoreboard');
    assert.equal(after.players.filter((p) => !p.bot).length, 1, 'the watcher counted as a human in the match');
    assert.ok(!Pilot.inbox.some((m) => m.type === 'feed' && /Dev joined/.test(m.text || '')), 'the match was told the watcher arrived');
  } finally { stop(); }
});

test('an ordinary pilot cannot watch anything', async () => {
  const { Dev, Pilot, stop } = await arena();
  try {
    Dev.send({ type: 'enter', action: 'quick', queue: 'casual' });
    const room = await Dev.settle('room', (m) => m.players?.some((p) => p.name === 'Dev'));
    Pilot.send({ type: 'dev-online' });
    await Pilot.quiet('dev-online');
    Pilot.send({ type: 'dev-watch', room: room.name || 'casual-1' });
    await Pilot.quiet('watching');
    assert.equal(Pilot.last('welcome'), null, 'a pilot was seated in a match they asked to watch');
  } finally { stop(); }
});
