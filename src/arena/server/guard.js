// Anti-cheat, server side.
//
// The page reports what it finds and heartbeats while it is alive. This side
// keeps the strike ledger, decides the lockout and does the actual kicking, so
// deleting the client module is not a way out: the heartbeats stop and that is
// a kick on its own.
import { randomBytes } from 'node:crypto';
import { GUARD, flagNames, guardSignature } from '../shared/guard.js';

export class Guard {
  constructor(clock) {
    this.now = clock;
    this.strikes = new Map(); // key → { count, at }
  }

  // Handed out as soon as a socket connects; the heartbeat has to echo it back.
  challenge(socket) {
    socket.guardSalt = randomBytes(9).toString('base64url');
    socket.guardAt = this.now();
    socket.guardOk = false;
    return { type: 'guard-challenge', salt: socket.guardSalt };
  }

  // Returns a kick reason, or null when the heartbeat is good.
  heartbeat(socket, message) {
    const flags = Number(message.flags) || 0;
    if (!socket.guardSalt || message.sig !== guardSignature(socket.guardSalt, flags)) return 'silent';
    socket.guardAt = this.now();
    socket.guardOk = true;
    socket.guardFlags = flags;
    return null;
  }

  // A seated player whose page has stopped heartbeating has had the anti-cheat
  // pulled out of it.
  overdue(socket) {
    if (!socket.room || !socket.guardSalt) return false;
    return this.now() - socket.guardAt > GUARD.missing;
  }

  key(socket) {
    return socket.token || socket.session || socket._socket?.remoteAddress || 'anon';
  }

  strike(socket, reason) {
    const key = this.key(socket);
    const t = this.now();
    const record = this.strikes.get(key);
    const count = (record && t - record.at < GUARD.strikeWindow ? record.count : 0) + 1;
    this.strikes.set(key, { count, at: t, until: t + this.lockout(count), reason });
    if (this.strikes.size > 500) for (const [k, v] of this.strikes) if (t - v.at > GUARD.strikeWindow) this.strikes.delete(k);
    return count;
  }

  lockout(count) {
    return Math.min(GUARD.maxLockout, GUARD.lockout * 2 ** (count - 1));
  }

  // Seconds still to wait, or 0 when the socket is free to play.
  locked(socket) {
    const record = this.strikes.get(this.key(socket));
    if (!record) return 0;
    return Math.max(0, Math.ceil(record.until - this.now()));
  }

  describe(socket) {
    const flags = socket.guardFlags || 0;
    return flags ? flagNames(flags).join(', ') : 'no detail';
  }
}
