// Parties live in memory, like rooms: a party is a group of logged-in pilots who queue together.
// Members are usernames (lower case as the key, as typed for display). Nothing here touches disk.
//
// A pilot is always in exactly one party, their own party of one to start with, so the client never
// has to special-case "no party".

export const PARTY_LIMIT = 5; // the largest team size the game has (5v5)
const INVITE_LIFE = 2 * 60 * 1000;

export class PartyBook {
  constructor(limit = PARTY_LIMIT) {
    this.limit = limit;
    this.parties = new Map(); // id → party
    this.byMember = new Map(); // lower-case username → party id
    this.counter = 1;
  }

  get(id) { return this.parties.get(id) || null; }
  of(name) { return this.parties.get(this.byMember.get(String(name).toLowerCase())) || null; }
  // Every pilot has a party; make theirs the moment it is asked for.
  ensure(name) { return this.of(name) || this.create(name); }

  create(name) {
    const party = { id: `party-${this.counter++}`, leader: name, members: [name], invites: new Map(), queued: null, ready: new Set() };
    this.parties.set(party.id, party);
    this.byMember.set(String(name).toLowerCase(), party.id);
    return party;
  }

  isLeader(party, name) { return Boolean(party) && String(party.leader).toLowerCase() === String(name).toLowerCase(); }
  has(party, name) { return Boolean(party) && party.members.some((member) => String(member).toLowerCase() === String(name).toLowerCase()); }

  // Ask someone to join. The invite is remembered on the party so accepting cannot be forged.
  invite(party, name) {
    if (!party) return { error: 'You are not in a party.' };
    if (this.has(party, name)) return { error: 'Already in your party.' };
    if (party.members.length >= this.limit) return { error: 'Your party is full.' };
    this.sweep(party);
    party.invites.set(String(name).toLowerCase(), Date.now() + INVITE_LIFE);
    return { ok: true, kind: 'invited' };
  }

  invited(party, name) {
    if (!party) return false;
    this.sweep(party);
    return party.invites.has(String(name).toLowerCase());
  }
  sweep(party) {
    const now = Date.now();
    for (const [key, expires] of party.invites) if (expires < now) party.invites.delete(key);
  }

  // Joining always leaves whatever party you were in, so the two can never disagree.
  join(party, name) {
    if (!party) return { error: 'That party has gone.' };
    if (this.has(party, name)) return { error: 'Already in your party.' };
    if (party.members.length >= this.limit) return { error: 'That party is full.' };
    if (party.queued) return { error: 'That party is already in a match.' };
    const previous = this.of(name);
    if (previous) this.leave(previous, name);
    party.invites.delete(String(name).toLowerCase());
    party.members.push(name);
    this.byMember.set(String(name).toLowerCase(), party.id);
    return { ok: true, kind: 'joined', party };
  }

  // Returns the party that was left, so the caller can tell whoever is still in it.
  leave(party, name) {
    if (!party || !this.has(party, name)) return null;
    party.members = party.members.filter((member) => String(member).toLowerCase() !== String(name).toLowerCase());
    party.ready.delete(String(name).toLowerCase());
    this.byMember.delete(String(name).toLowerCase());
    if (!party.members.length) { this.parties.delete(party.id); return party; }
    if (this.isLeader(party, name)) party.leader = party.members[0];
    return party;
  }

  kick(party, leaderName, name) {
    if (!this.isLeader(party, leaderName)) return { error: 'Only the party leader can do that.' };
    if (String(leaderName).toLowerCase() === String(name).toLowerCase()) return { error: 'Leave the party instead.' };
    if (!this.has(party, name)) return { error: 'They are not in your party.' };
    this.leave(party, name);
    return { ok: true, kind: 'kicked' };
  }

  promote(party, leaderName, name) {
    if (!this.isLeader(party, leaderName)) return { error: 'Only the party leader can do that.' };
    if (!this.has(party, name)) return { error: 'They are not in your party.' };
    party.leader = party.members.find((member) => String(member).toLowerCase() === String(name).toLowerCase());
    return { ok: true, kind: 'promoted' };
  }

  setReady(party, name, ready) {
    if (!this.has(party, name)) return;
    if (ready) party.ready.add(String(name).toLowerCase()); else party.ready.delete(String(name).toLowerCase());
  }
  // The leader is counted as ready: they are the one pressing Play.
  allReady(party) {
    return party.members.every((member) => this.isLeader(party, member) || party.ready.has(String(member).toLowerCase()));
  }

  // The party is in a match. Cleared when the last member leaves the room.
  setQueued(party, room) { if (party) party.queued = room || null; }
}
