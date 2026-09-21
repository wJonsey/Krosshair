// Mutual friendship: one side asks, the other agrees. Lists hold usernames as they were typed,
// and every comparison is case-insensitive because a login is case-insensitive too.
//
// These are plain functions over profile objects so the tests can drive them without sockets.
// The caller resolves a name to a profile: only it knows about accounts.

export const FRIEND_LIMIT = 50;
export const REQUEST_LIMIT = 50;
export const BLOCK_LIMIT = 100;

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const has = (list, name) => (list || []).some((entry) => same(entry, name));
const without = (list, name) => (list || []).filter((entry) => !same(entry, name));

// Older profiles only had `friends`, so fill in the rest the first time a profile is touched.
export function lists(profile) {
  if (!Array.isArray(profile.friends)) profile.friends = [];
  if (!Array.isArray(profile.requestsIn)) profile.requestsIn = [];
  if (!Array.isArray(profile.requestsOut)) profile.requestsOut = [];
  if (!Array.isArray(profile.blocked)) profile.blocked = [];
  return profile;
}

export function relation(profile, name) {
  lists(profile);
  if (has(profile.blocked, name)) return 'blocked';
  if (has(profile.friends, name)) return 'friend';
  if (has(profile.requestsIn, name)) return 'incoming';
  if (has(profile.requestsOut, name)) return 'outgoing';
  return 'none';
}

export function blockedEitherWay(me, other, meName, otherName) {
  return has(lists(me).blocked, otherName) || has(lists(other).blocked, meName);
}

// The friends list used to be a one-way address book for sending coins, so an entry the other side
// never agreed to becomes a pending request rather than quietly disappearing. Idempotent: it only
// moves an entry that is not matched on the other side.
export function normalize(me, meName, resolve) {
  lists(me);
  let changed = false;
  for (const name of [...me.friends]) {
    const other = resolve(name);
    if (!other) { me.friends = without(me.friends, name); changed = true; continue; }
    lists(other);
    if (has(other.friends, meName)) continue;
    me.friends = without(me.friends, name);
    if (!has(me.requestsOut, name) && !has(other.blocked, meName)) {
      me.requestsOut.push(name);
      if (!has(other.requestsIn, meName)) other.requestsIn.push(meName);
    }
    changed = true;
  }
  return changed;
}

export function request(me, meName, other, otherName) {
  lists(me); lists(other);
  if (same(meName, otherName)) return { error: 'That’s you.' };
  if (has(me.blocked, otherName)) return { error: 'Unblock them first.' };
  if (has(other.blocked, meName)) return { error: 'They are not taking requests.' };
  if (has(me.friends, otherName)) return { error: 'Already a friend.' };
  if (has(me.requestsOut, otherName)) return { error: 'Request already sent.' };
  // They asked first: agreeing is the same as accepting.
  if (has(me.requestsIn, otherName)) return accept(me, meName, other, otherName);
  if (me.friends.length >= FRIEND_LIMIT) return { error: 'Your friends list is full.' };
  if (other.friends.length >= FRIEND_LIMIT) return { error: 'Their friends list is full.' };
  if (me.requestsOut.length >= REQUEST_LIMIT) return { error: 'Too many requests pending.' };
  if (other.requestsIn.length >= REQUEST_LIMIT) return { error: 'Their requests are full.' };
  me.requestsOut.push(otherName);
  other.requestsIn.push(meName);
  return { ok: true, kind: 'requested', note: `Request sent to ${otherName}.`, tell: `${meName} wants to be friends` };
}

export function accept(me, meName, other, otherName) {
  lists(me); lists(other);
  if (!has(me.requestsIn, otherName)) return { error: 'No request from that pilot.' };
  if (me.friends.length >= FRIEND_LIMIT) return { error: 'Your friends list is full.' };
  if (other.friends.length >= FRIEND_LIMIT) return { error: 'Their friends list is full.' };
  me.requestsIn = without(me.requestsIn, otherName);
  other.requestsOut = without(other.requestsOut, meName);
  if (!has(me.friends, otherName)) me.friends.push(otherName);
  if (!has(other.friends, meName)) other.friends.push(meName);
  return { ok: true, kind: 'accepted', note: `${otherName} is now a friend.`, tell: `${meName} accepted your request` };
}

// Turning down an incoming request, and cancelling one you sent, are the same clean-up.
export function reject(me, meName, other, otherName) {
  lists(me); lists(other);
  me.requestsIn = without(me.requestsIn, otherName);
  me.requestsOut = without(me.requestsOut, otherName);
  other.requestsIn = without(other.requestsIn, meName);
  other.requestsOut = without(other.requestsOut, meName);
  return { ok: true, kind: 'rejected', note: 'Request dismissed.' };
}

export function unfriend(me, meName, other, otherName) {
  lists(me); lists(other);
  if (!has(me.friends, otherName)) return { error: 'Not on your friends list.' };
  me.friends = without(me.friends, otherName);
  other.friends = without(other.friends, meName);
  return { ok: true, kind: 'removed', note: `${otherName} removed.` };
}

// Blocking is the one action that clears everything: the friendship, both requests, both ways.
export function block(me, meName, other, otherName) {
  lists(me); lists(other);
  if (same(meName, otherName)) return { error: 'That’s you.' };
  if (has(me.blocked, otherName)) return { error: 'Already blocked.' };
  if (me.blocked.length >= BLOCK_LIMIT) return { error: 'Your block list is full.' };
  me.friends = without(me.friends, otherName);
  other.friends = without(other.friends, meName);
  me.requestsIn = without(me.requestsIn, otherName);
  me.requestsOut = without(me.requestsOut, otherName);
  other.requestsIn = without(other.requestsIn, meName);
  other.requestsOut = without(other.requestsOut, meName);
  me.blocked.push(otherName);
  return { ok: true, kind: 'blocked', note: `${otherName} blocked.` };
}

export function unblock(me, meName, other, otherName) {
  lists(me);
  if (!has(me.blocked, otherName)) return { error: 'Not blocked.' };
  me.blocked = without(me.blocked, otherName);
  return { ok: true, kind: 'unblocked', note: `${otherName} unblocked.` };
}
