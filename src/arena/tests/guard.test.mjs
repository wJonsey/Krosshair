import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAG, GUARD, flagNames, guardSignature } from '../shared/guard.js';
import { Guard } from '../server/guard.js';

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
