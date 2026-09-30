// What a pilot may actually wear. The server runs every look through this before it is saved or shown to
// anyone, and the browser runs its remembered look through the same rule when it signs in. The browser
// keeps the last look it wore, so after a fresh server or a scrapped skin it can be wearing things the
// account no longer has: worn but missing from the locker, so it can never be put back on.
import { DEFAULT_LOOK, WEAPONS, cosmeticUnlocked } from './constants.js';
import { devFinish, finishInfo } from './economy.js';

// Look keys and the cosmetics list that validates each.
export const LOOK_KINDS = { color: 'suit', accent: 'visor', tracer: 'tracer', title: 'title', headgear: 'headgear', face: 'face', pack: 'pack', pattern: 'pattern', charm: 'charm' };

// The second argument is what the account has, as the profile view carries it. Dev items and dev finishes
// belong to dev accounts and are never taken off them.
export function cleanLook(look, { level = 1, owned = [], finishes = [], dev = false } = {}) {
  const wish = look && typeof look === 'object' ? look : {};
  const clean = {};
  for (const [key, kind] of Object.entries(LOOK_KINDS)) clean[key] = cosmeticUnlocked(kind, wish[key], level, owned, dev) ? wish[key] : DEFAULT_LOOK[key];
  clean.skins = {};
  if (wish.skins && typeof wish.skins === 'object') {
    // A finish you own goes on any gun. Dev finishes need the account.
    for (const [weapon, finish] of Object.entries(wish.skins).slice(0, 40)) if (Object.hasOwn(WEAPONS, weapon) && finishInfo(finish) && (devFinish(finish) ? dev : finishes.includes(finish))) clean.skins[weapon] = finish;
  }
  return clean;
}
