// What the web server hands out. Only the game is served: never server code, tests or dotfiles, however
// the path is spelled, and no request, however broken, takes the process down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket as Client, WebSocketServer } from 'ws';

const entry = fileURLToPath(new URL('../multiplayer-server.mjs', import.meta.url));

async function freePort() {
  const probe = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => probe.on('listening', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function boot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-serve-'));
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ARENA_PORT: String(port), ARENA_DATA: path.join(dir, 'profiles.json'), ARENA_FEEDBACK: path.join(dir, 'feedback.jsonl'), DISCORD_WEBHOOK_UPDATES: 'off', DISCORD_WEBHOOK_LEADERBOARD: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = null;
  child.on('exit', (code) => { exited = code ?? 'signal'; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('online at')) { clearTimeout(timer); resolve(); } });
  });
  return { port, child, alive: () => exited === null };
}

// Sent byte for byte, so the path is exactly what an attacker types, not what fetch() normalises it to.
function raw(port, target) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    let text = '';
    socket.on('data', (chunk) => { text += chunk; });
    socket.on('close', () => resolve({ status: Number(text.match(/^HTTP\/1\.1 (\d+)/)?.[1] || 0), body: text.slice(text.indexOf('\r\n\r\n') + 4) }));
    socket.on('error', () => resolve({ status: 0, body: '' }));
  });
}

test('server code, tests and dotfiles are never served, however the path is spelled', async (t) => {
  const { port, child } = await boot();
  t.after(() => child.kill('SIGINT'));
  const hidden = [
    '/src/arena/server/itemsets.js', '/src/arena//server/itemsets.js', '/src/arena/%2Fserver/itemsets.js', '/src/arena/.%2Fserver/itemsets.js',
    '/src/arena/./server/devs.js', '/src/arena/client/../server/devs.js', '/src/arena/client/%2e%2e/server/devs.js',
    '/src/arena//tests/smoke.test.mjs', '/src/arena/%2Ftests/smoke.test.mjs', '/src/arena//multiplayer-server.mjs', '/src/arena/%2Fmultiplayer-server.mjs',
    '/src/arena/../../.env', '/src/arena/%2e%2e/%2e%2e/.env', '/data/profiles.json', '/src/arena/client/.hidden', '/package.json', '//src/arena/server/itemsets.js', '/src/arena/SERVER/itemsets.js', '/src/arena/Tests/smoke.test.mjs', // only bites on a case-blind disk (a Mac), not here
  ];
  for (const target of hidden) {
    const { status, body } = await raw(port, target);
    assert.notEqual(status, 200, `${target} was served`);
    assert.ok(!body.includes('ALL_SETS') && !body.includes('DEV_DISCORD'), `${target} leaked server code`);
  }
  // The game itself still loads, and nobody can frame it.
  for (const target of ['/src/arena/index.html', '/src/arena/client/shop.js', '/src/arena/shared/itemshop.js', '/src/arena/arena.css']) {
    assert.equal((await raw(port, target)).status, 200, `${target} is no longer served`);
  }
  const page = await fetch(`http://127.0.0.1:${port}/src/arena/index.html`);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
});

test('a malformed request is refused, and the server stays up', async (t) => {
  const { port, child, alive } = await boot();
  t.after(() => child.kill('SIGINT'));
  for (const target of ['/%', '//', '///', '/src/arena/%E0%A4%A', '/%zz', 'http://[zz', '/src/arena/client/shop.js%00.png']) {
    const { status } = await raw(port, target);
    assert.ok(status >= 400 || status === 0, `${target} answered ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(alive(), `${target} crashed the server`);
  }
  assert.equal((await raw(port, '/api/status')).status, 200, 'the server stopped answering');
});

// String() on an object runs its toString. A message can make that throw, and inside an async handler
// nothing caught it: one feedback message ended the process.
test('a hostile message cannot end the process, and real feedback still saves', async (t) => {
  const { port, child, alive } = await boot();
  t.after(() => child.kill('SIGINT'));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const inbox = [];
  socket.addEventListener('message', (event) => inbox.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  const evil = { toString: 1, valueOf: 1 };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const message of [
    { type: 'feedback', title: evil, details: 'x'.repeat(20) },
    { type: 'feedback', title: 'A real title', details: evil },
    { type: 'feedback', title: 'A real title', details: 'x'.repeat(20), device: { gpu: evil, [`k${'x'.repeat(40)}`]: evil } },
    { type: 'identify', name: evil, token: evil, session: evil },
    { type: 'auth', action: 'resume', session: evil, legacyToken: evil },
    { type: 'enter', action: evil, room: evil, queue: evil },
  ]) {
    socket.send(JSON.stringify(message));
    await pause(120);
    assert.ok(alive(), `${JSON.stringify(message).slice(0, 60)} ended the process`);
  }
  // The flood guard spaces feedback 15 s apart per socket, so a fresh socket sends the real one.
  const fresh = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const replies = [];
  fresh.addEventListener('message', (event) => replies.push(JSON.parse(event.data)));
  await new Promise((resolve) => fresh.addEventListener('open', resolve));
  fresh.send(JSON.stringify({ type: 'feedback', kind: 'bug', title: 'Scope is dark', details: 'The glass stays black at the hip.', device: { width: 1920, touch: false } }));
  for (let i = 0; i < 40 && !replies.some((m) => m.type === 'feedback-result'); i += 1) await pause(50);
  assert.equal(replies.find((m) => m.type === 'feedback-result')?.ok, true, 'real feedback was refused');
  socket.close(); fresh.close();
});

test('one socket cannot mint guest after guest', async (t) => {
  const { port, child } = await boot();
  t.after(() => child.kill('SIGINT'));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const tokens = new Set();
  socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.type === 'identity') tokens.add(message.token); });
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  for (let i = 0; i < 30; i += 1) socket.send(JSON.stringify({ type: 'identify', name: `Pilot${i}` }));
  for (let i = 0; i < 40 && tokens.size === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(tokens.size, 1, `${tokens.size} guest profiles from one socket`);
  socket.close();
});

// Behind the tunnel every connection comes from cloudflared on the same machine, so the limit counts the
// address Cloudflare saw. That header is only believed from loopback, where the tunnel is.
test('one address cannot open connections without limit, and one address is not everyone', async (t) => {
  const { port, child } = await boot();
  t.after(() => child.kill('SIGINT'));
  const open = (address) => new Promise((resolve) => {
    const socket = new Client(`ws://127.0.0.1:${port}/arena`, { headers: { 'cf-connecting-ip': address } });
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve({ socket, ok }); } };
    socket.on('message', () => setTimeout(() => done(socket.readyState === 1), 50));
    socket.on('close', () => done(false));
    socket.on('error', () => done(false));
  });
  const held = [];
  for (let i = 0; i < 40; i += 1) held.push(await open('203.0.113.7'));
  assert.ok(held.every((entry) => entry.ok), 'a legitimate number of connections was refused');
  const extra = await open('203.0.113.7');
  assert.equal(extra.ok, false, 'the 41st connection from one address was let in');
  const other = await open('198.51.100.9');
  assert.equal(other.ok, true, 'a different address was refused as well');
  // Closing one frees a place.
  held[0].socket.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const again = await open('203.0.113.7');
  assert.equal(again.ok, true, 'a closed connection never gave its place back');
  for (const entry of [...held, extra, other, again]) entry.socket.terminate();
});

test('a guest cannot hide invisible characters in a callsign', async (t) => {
  const { port, child } = await boot();
  t.after(() => child.kill('SIGINT'));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`);
  const inbox = [];
  socket.addEventListener('message', (event) => inbox.push(JSON.parse(event.data)));
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  socket.send(JSON.stringify({ type: 'identify', name: 'Al​ice‮' }));
  for (let i = 0; i < 40 && !inbox.some((m) => m.type === 'identity'); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(inbox.find((m) => m.type === 'identity')?.profile?.name, 'Alice', 'the invisible characters were kept');
  socket.close();
});
