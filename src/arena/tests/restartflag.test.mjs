// Windows has no SIGTERM, so a deploy there asks the game to restart by dropping data/restart.flag.
// The game must warn the pilots exactly as it does for SIGTERM, then save and exit cleanly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

async function boot(dir, extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ARENA_PORT: String(port), ARENA_DATA: path.join(dir, 'profiles.json'), ARENA_FEEDBACK: path.join(dir, 'feedback.jsonl'), DISCORD_WEBHOOK_UPDATES: 'off', DISCORD_WEBHOOK_LEADERBOARD: 'off', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { text: '', exit: new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal }))) };
  child.stdout.on('data', (chunk) => { out.text += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', () => { if (out.text.includes('online at')) { clearTimeout(timer); resolve(); } });
  });
  return { port, child, out };
}

const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))]);

test('a restart flag warns connected pilots, then the game saves and exits cleanly', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-flag-'));
  const { port, child, out } = await boot(dir, { RESTART_GRACE_SECONDS: '2' });
  t.after(() => child.kill('SIGKILL'));

  const socket = new Client(`ws://127.0.0.1:${port}/arena`);
  const warning = new Promise((resolve) => socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'notice' && message.kind === 'restart') resolve(message);
  }));
  await new Promise((resolve) => socket.on('open', resolve));
  socket.send(JSON.stringify({ type: 'identify', name: 'Flagged' }));
  await new Promise((resolve) => setTimeout(resolve, 600));

  await writeFile(path.join(dir, 'restart.flag'), '');
  const notice = await within(warning, 6000, 'restart notice');
  assert.equal(notice.seconds, 2, 'the pilot is told how long the grace period is');
  assert.ok(!existsSync(path.join(dir, 'restart.flag')), 'the flag is consumed so the next boot is not restarted again');

  const { code } = await within(out.exit, 10000, 'process exit');
  assert.equal(code, 0, 'a clean exit lets the service manager bring it straight back');
  assert.match(out.text, /restart requested by the deploy script/);
});

test('with nobody online the restart is immediate, and a stale flag from a crash is ignored at boot', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-flag-'));
  await writeFile(path.join(dir, 'restart.flag'), '');
  const { child, out } = await boot(dir, { RESTART_GRACE_SECONDS: '20' });
  t.after(() => child.kill('SIGKILL'));

  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(child.exitCode, null, 'a flag left over from before the boot does not restart the game in a loop');
  assert.ok(!existsSync(path.join(dir, 'restart.flag')), 'and it is cleared');

  const started = Date.now();
  await writeFile(path.join(dir, 'restart.flag'), '');
  const { code } = await within(out.exit, 8000, 'process exit');
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 6000, 'no pilots means no grace period');
});
