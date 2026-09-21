// Parties: invites, joining, leaving, the leader's powers, and the ready check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_LIMIT, PartyBook } from '../server/party.js';

test('everyone starts in their own party of one, and it is theirs', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  assert.deepEqual(party.members, ['Vex']);
  assert.ok(book.isLeader(party, 'Vex'));
  assert.equal(book.ensure('Vex'), party, 'asking again returns the same party');
  assert.equal(book.of('vex'), party, 'lookup ignores case');
});

test('an invite has to exist before it can be accepted', () => {
  const book = new PartyBook();
  const mine = book.ensure('Vex');
  book.ensure('Nova');
  assert.equal(book.invited(mine, 'Nova'), false);
  assert.ok(book.invite(mine, 'Nova').ok);
  assert.ok(book.invited(mine, 'NOVA'));
  assert.ok(book.join(mine, 'Nova').ok);
  assert.deepEqual(mine.members, ['Vex', 'Nova']);
  assert.equal(book.invited(mine, 'Nova'), false, 'the invite is spent');
});

test('joining leaves the party you were in, so the two never disagree', () => {
  const book = new PartyBook();
  const mine = book.ensure('Vex');
  const theirs = book.ensure('Nova');
  book.join(mine, 'Nova');
  assert.deepEqual(mine.members, ['Vex', 'Nova']);
  assert.equal(book.of('Nova'), mine);
  assert.equal(book.get(theirs.id), null, 'the empty party is gone');
});

test('the leader passes to whoever is left when they go', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.join(party, 'Nova');
  book.join(party, 'Kes');
  book.leave(party, 'Vex');
  assert.equal(party.leader, 'Nova');
  assert.deepEqual(party.members, ['Nova', 'Kes']);
  assert.equal(book.of('Vex'), null, 'the one who left is in no party until they ask');
});

test('a party of one disappears when its member leaves', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.leave(party, 'Vex');
  assert.equal(book.get(party.id), null);
  assert.equal(book.of('Vex'), null);
});

test('only the leader can kick or promote', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.join(party, 'Nova');
  assert.equal(book.kick(party, 'Nova', 'Vex').error, 'Only the party leader can do that.');
  assert.equal(book.promote(party, 'Nova', 'Nova').error, 'Only the party leader can do that.');

  assert.ok(book.promote(party, 'Vex', 'Nova').ok);
  assert.equal(party.leader, 'Nova');
  assert.ok(book.kick(party, 'Nova', 'Vex').ok);
  assert.deepEqual(party.members, ['Nova']);
  assert.equal(book.of('Vex'), null);
});

test('a leader leaves rather than kicking themselves', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.join(party, 'Nova');
  assert.equal(book.kick(party, 'Vex', 'Vex').error, 'Leave the party instead.');
});

test('a party fills up and then refuses', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  for (let index = 1; index < PARTY_LIMIT; index += 1) assert.ok(book.join(party, `Pilot${index}`).ok);
  assert.equal(party.members.length, PARTY_LIMIT);
  assert.equal(book.join(party, 'OneTooMany').error, 'That party is full.');
  assert.equal(book.invite(party, 'OneTooMany').error, 'Your party is full.');
});

test('a party already in a match cannot be joined', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.setQueued(party, 'duel-abc');
  assert.equal(book.join(party, 'Nova').error, 'That party is already in a match.');
  book.setQueued(party, null);
  assert.ok(book.join(party, 'Nova').ok);
});

test('the leader counts as ready; everyone else has to say so', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  assert.ok(book.allReady(party), 'a party of one is always ready');
  book.join(party, 'Nova');
  assert.equal(book.allReady(party), false);
  book.setReady(party, 'Nova', true);
  assert.ok(book.allReady(party));
  book.setReady(party, 'Nova', false);
  assert.equal(book.allReady(party), false);
});

test('leaving clears a ready flag so it cannot linger', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.join(party, 'Nova');
  book.setReady(party, 'Nova', true);
  book.leave(party, 'Nova');
  book.join(party, 'Nova');
  assert.equal(book.allReady(party), false, 'rejoining starts not ready');
});

test('an invite expires', () => {
  const book = new PartyBook();
  const party = book.ensure('Vex');
  book.invite(party, 'Nova');
  party.invites.set('nova', Date.now() - 1);
  assert.equal(book.invited(party, 'Nova'), false);
});
