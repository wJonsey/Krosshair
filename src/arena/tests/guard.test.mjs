import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAG, GUARD, flagNames, guardSignature } from '../shared/guard.js';
import { Guard } from '../server/guard.js';
import { readFileSync } from 'node:fs';

function clockAt(start = 1000) {
  const box = { t: start };
  return [() => box.t, box];
}
function fakeSocket(extra = {}) {
  return { token: 'token-abc', session: 'tab-1', room: {}, ...extra };
}

test('a heartbeat only passes with the salt the server issued', () => {
  const [clock] = clockAt();
  const guard = new Guard(clock);
  const socket = fakeSocket();
  const challenge = guard.challenge(socket);
  assert.equal(challenge.type, 'guard-challenge');
  assert.equal(guard.heartbeat(socket, { sig: guardSignature(challenge.salt, 0), flags: 0 }), null);
  assert.equal(guard.heartbeat(socket, { sig: 'made-up', flags: 0 }), 'silent');
  // The flags are signed too, so a stub cannot report clean while sending dirty.
  assert.equal(guard.heartbeat(socket, { sig: guardSignature(challenge.salt, FLAG.userscript), flags: 0 }), 'silent');
  assert.equal(guard.heartbeat(socket, { sig: guardSignature(challenge.salt, FLAG.userscript), flags: FLAG.userscript }), null);
  assert.deepEqual(flagNames(socket.guardFlags), ['userscript']);
});

test('a seated player whose heartbeats stop counts as tampered with', () => {
  const [clock, box] = clockAt();
  const guard = new Guard(clock);
  const socket = fakeSocket();
  guard.challenge(socket);
  assert.equal(guard.overdue(socket), false);
  box.t += GUARD.missing - 1;
  assert.equal(guard.overdue(socket), false);
  box.t += 2;
  assert.equal(guard.overdue(socket), true);
  // Someone sitting in the menus holds no seat, so there is nothing to enforce.
  assert.equal(guard.overdue({ ...socket, room: null }), false);
});

test('lockouts double per strike and expire', () => {
  const [clock, box] = clockAt();
  const guard = new Guard(clock);
  const socket = fakeSocket();
  assert.equal(guard.locked(socket), 0);
  assert.equal(guard.strike(socket, 'userscript'), 1);
  assert.equal(guard.locked(socket), GUARD.lockout);
  box.t += GUARD.lockout + 1;
  assert.equal(guard.locked(socket), 0, 'the first lockout runs out');
  assert.equal(guard.strike(socket, 'userscript'), 2, 'but the strike is remembered');
  assert.equal(guard.locked(socket), GUARD.lockout * 2);
  box.t += GUARD.strikeWindow + 1;
  assert.equal(guard.strike(socket, 'userscript'), 1, 'strikes are forgotten after the window');
  assert.ok(guard.lockout(20) <= GUARD.maxLockout, 'lockouts are capped');
});

test('strikes follow the account token, then the tab, then the address', () => {
  const [clock] = clockAt();
  const guard = new Guard(clock);
  assert.equal(guard.key(fakeSocket()), 'token-abc');
  assert.equal(guard.key(fakeSocket({ token: null })), 'tab-1');
  assert.equal(guard.key({ token: null, session: null, _socket: { remoteAddress: '10.0.0.4' } }), '10.0.0.4');
});

// A player was banned with nothing running on their page. Going quiet is not evidence: a hidden tab
// has its timers throttled, a closed lid stops them, and a stalled connection loses the beats in
// flight. It drops the socket now, but it never banks a strike.
test('going quiet is not treated as cheating', async () => {
  const { isDetection } = await import('../shared/guard.js');
  assert.equal(isDetection('silent'), false, 'a stopped heartbeat is not a detection');
  for (const reason of ['userscript', 'injected', 'patched', 'api', 'honeypot']) {
    assert.equal(isDetection(reason), true, `${reason} is a real detection and must still strike`);
  }
});

test('the quiet window is wide enough to survive an ordinary interruption', () => {
  assert.ok(GUARD.missing / GUARD.heartbeat >= 6, `only ${GUARD.missing / GUARD.heartbeat} beats can be missed, which a throttled tab will do`);
  assert.ok(GUARD.missing >= 40, 'a tab that is hidden for half a minute must not be treated as tampered with');
});

test('deleting the guard is still not a way to play', async () => {
  const { isDetection } = await import('../shared/guard.js');
  // Not striking is not the same as not acting: the socket is still dropped every time, so a page
  // with the guard pulled out of it never gets to stay in a room.
  assert.equal(isDetection('silent'), false);
  const server = readFileSync(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  const kick = server.slice(server.indexOf('function kickCheater'), server.indexOf('function enter'));
  assert.match(kick, /leaveRoom\(socket, true\)/, 'the seat is still taken away');
  assert.match(kick, /socket\.close\(4003/, 'and the socket is still dropped');
});
