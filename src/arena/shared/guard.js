// Anti-cheat constants shared by the page and the server.
//
// Scope, on purpose: this looks for script injection — userscript managers
// (Tampermonkey, Violentmonkey, Greasemonkey), scripts pasted into the page
// and swapped-out browser built-ins. It does not look at developer tools and
// never tries to block them; opening the console is not cheating.
export const GUARD = {
  version: 1,
  heartbeat: 5,       // seconds between client heartbeats
  // A stopped heartbeat is the weakest signal there is: a hidden tab has its timers throttled, a
  // closed lid stops them dead, and a network stall loses them in flight. Nine missed beats before
  // anything happens, and going quiet is never a strike. See SILENT_IS_NOT_A_STRIKE below.
  missing: 45,        // server drops a seated player whose heartbeats stop for this long
  grace: 12,          // seconds of plain warning before the screen starts fighting back
  sabotage: 20,       // seconds of sabotage before the kick request goes out
  lockout: 30,        // seconds locked out on a first kick (doubles, capped)
  maxLockout: 300,
  strikeWindow: 1800, // strikes are forgotten after 30 minutes
};

// What tripped, as a bitmask, so the heartbeat can carry it in one number.
export const FLAG = {
  userscript: 1,
  injected: 2,
  patched: 4,
  api: 8,
  honeypot: 16,
};

export const REASONS = {
  userscript: 'a userscript manager (Tampermonkey / Violentmonkey / Greasemonkey) is running on this page',
  injected: 'a script was injected into the page after it loaded',
  patched: 'a built-in browser function has been swapped out',
  api: 'the game’s own code has been replaced',
  honeypot: 'something tried to switch on a cheat flag',
  silent: 'the anti-cheat stopped reporting from this page',
};

export function reasonText(reason) { return REASONS[reason] || 'script injection'; }

// Going quiet gets you dropped but never banked against you. Someone who deletes the guard still
// cannot play, because they are dropped every time they try. Someone whose laptop went to sleep
// just reconnects. Only something actually detected earns a strike and a lockout.
export const SILENT_IS_NOT_A_STRIKE = true;
export const isDetection = (reason) => reason !== 'silent';

export function flagNames(flags) {
  return Object.keys(FLAG).filter((name) => flags & FLAG[name]);
}

// A small non-cryptographic hash. It is a speed bump: enough that a hand-written
// stub client gets the heartbeat wrong, not enough to stop someone determined.
export function guardSignature(salt, flags = 0) {
  const text = `${salt}|${flags}|sniper-guard-v${GUARD.version}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
