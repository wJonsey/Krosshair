// Friendship: requests, accepting, blocking, and the migration off the old one-way list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRIEND_LIMIT, accept, block, blockedEitherWay, lists, normalize, reject, relation, request, unblock, unfriend } from '../server/social.js';

// Profiles as the store holds them, plus a resolver like the server's.
function world(...names) {
  const profiles = new Map(names.map((name) => [name.toLowerCase(), lists({ name })]));
  const resolve = (name) => profiles.get(String(name).toLowerCase()) || null;
  return { get: resolve, resolve, of: (name) => profiles.get(name.toLowerCase()) };
}

test('a request is one-sided until it is accepted', () => {
  const w = world('Vex', 'Nova');
  const vex = w.of('Vex'), nova = w.of('Nova');
  const sent = request(vex, 'Vex', nova, 'Nova');
  assert.ok(sent.ok);
  assert.equal(relation(vex, 'Nova'), 'outgoing');
  assert.equal(relation(nova, 'Vex'), 'incoming');
  assert.deepEqual(vex.friends, []);
  assert.deepEqual(nova.friends, []);

  const done = accept(nova, 'Nova', vex, 'Vex');
  assert.ok(done.ok);
  assert.equal(relation(vex, 'Nova'), 'friend');
  assert.equal(relation(nova, 'Vex'), 'friend');
  assert.deepEqual(vex.friends, ['Nova']);
  assert.deepEqual(nova.friends, ['Vex']);
  assert.deepEqual(nova.requestsIn, []);
  assert.deepEqual(vex.requestsOut, []);
});

test('names are matched without case, and you cannot add yourself', () => {
  const w = world('Vex', 'Nova');
  assert.ok(request(w.of('Vex'), 'Vex', w.of('Nova'), 'nova').ok);
  assert.equal(relation(w.of('Vex'), 'NOVA'), 'outgoing');
  assert.equal(request(w.of('Vex'), 'Vex', w.of('Vex'), 'VEX').error, 'That’s you.');
});

test('asking someone who already asked you just accepts', () => {
  const w = world('Vex', 'Nova');
  request(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex');
  const back = request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  assert.equal(back.kind, 'accepted');
  assert.equal(relation(w.of('Vex'), 'Nova'), 'friend');
  assert.equal(relation(w.of('Nova'), 'Vex'), 'friend');
});

test('a request cannot be sent twice, and accepting needs a request', () => {
  const w = world('Vex', 'Nova');
  request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  assert.equal(request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').error, 'Request already sent.');
  assert.equal(accept(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').error, 'No request from that pilot.');
});

test('rejecting clears both sides, whichever end does it', () => {
  const w = world('Vex', 'Nova');
  request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  reject(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex');
  assert.equal(relation(w.of('Vex'), 'Nova'), 'none');
  assert.equal(relation(w.of('Nova'), 'Vex'), 'none');

  request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  reject(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova'); // the sender cancelling
  assert.equal(relation(w.of('Nova'), 'Vex'), 'none');
});

test('removing a friend removes it from both lists', () => {
  const w = world('Vex', 'Nova');
  request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  accept(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex');
  assert.ok(unfriend(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').ok);
  assert.deepEqual(w.of('Vex').friends, []);
  assert.deepEqual(w.of('Nova').friends, []);
  assert.equal(unfriend(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').error, 'Not on your friends list.');
});

test('blocking clears the friendship and stops further requests, both ways', () => {
  const w = world('Vex', 'Nova');
  request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova');
  accept(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex');

  assert.ok(block(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').ok);
  assert.deepEqual(w.of('Vex').friends, []);
  assert.deepEqual(w.of('Nova').friends, []);
  assert.equal(relation(w.of('Vex'), 'Nova'), 'blocked');
  assert.ok(blockedEitherWay(w.of('Nova'), w.of('Vex'), 'Nova', 'Vex'));

  assert.equal(request(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex').error, 'They are not taking requests.');
  assert.equal(request(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').error, 'Unblock them first.');

  assert.ok(unblock(w.of('Vex'), 'Vex', w.of('Nova'), 'Nova').ok);
  assert.equal(relation(w.of('Vex'), 'Nova'), 'none');
  assert.ok(request(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex').ok);
});

test('the old one-way list becomes a pending request, not a silent loss', () => {
  const w = world('Vex', 'Nova');
  w.of('Vex').friends = ['Nova']; // as the address book used to be

  assert.ok(normalize(w.of('Vex'), 'Vex', w.resolve));
  assert.deepEqual(w.of('Vex').friends, []);
  assert.deepEqual(w.of('Vex').requestsOut, ['Nova']);
  assert.deepEqual(w.of('Nova').requestsIn, ['Vex']);

  // Running it again changes nothing.
  assert.equal(normalize(w.of('Vex'), 'Vex', w.resolve), false);
  assert.deepEqual(w.of('Vex').requestsOut, ['Nova']);

  // A mutual pair is left alone.
  accept(w.of('Nova'), 'Nova', w.of('Vex'), 'Vex');
  assert.equal(normalize(w.of('Vex'), 'Vex', w.resolve), false);
  assert.deepEqual(w.of('Vex').friends, ['Nova']);
});

test('normalize drops a friend whose account has gone', () => {
  const w = world('Vex');
  w.of('Vex').friends = ['Ghost'];
  assert.ok(normalize(w.of('Vex'), 'Vex', w.resolve));
  assert.deepEqual(w.of('Vex').friends, []);
  assert.deepEqual(w.of('Vex').requestsOut, []);
});

test('a full friends list refuses both ends of an accept', () => {
  const w = world('Vex', 'Nova');
  const vex = w.of('Vex');
  vex.friends = Array.from({ length: FRIEND_LIMIT }, (_, index) => `Pilot${index}`);
  assert.equal(request(vex, 'Vex', w.of('Nova'), 'Nova').error, 'Your friends list is full.');
  assert.equal(request(w.of('Nova'), 'Nova', vex, 'Vex').error, 'Their friends list is full.');
});
