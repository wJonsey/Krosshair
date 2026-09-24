// The Item Shop catalogue, as the server hands it over. The pieces are pushed into the same registries
// the rest of the client already reads, so every existing lookup keeps working without knowing where
// they came from. Nothing about an unreleased set is in here: the server never sends it.
import { COSMETICS, dateKey } from '../shared/constants.js';
import { FINISHES } from '../shared/economy.js';
import { setCatalogue } from '../shared/itemshop.js';

// The day the catalogue was dealt for and how far this machine's clock is from the server's. A clock a
// few seconds fast used to ask for the new shop before the server's midnight, get yesterday's, and deal
// today's hand without the set that had just landed.
const clock = { day: null, skew: 0 };
export const shopNow = () => Date.now() + clock.skew;
export const shopToday = () => clock.day || dateKey(shopNow());

export function installShopCatalogue({ sets = [], finishes = [], cosmetics = {}, day, now } = {}) {
  for (const finish of finishes) if (!FINISHES.some((entry) => entry.id === finish.id)) FINISHES.push(finish);
  for (const [kind, items] of Object.entries(cosmetics)) {
    if (!COSMETICS[kind]) continue;
    for (const item of items) if (!COSMETICS[kind].some((entry) => entry.id === item.id)) COSMETICS[kind].push(item);
  }
  if (typeof day === 'string' && /^\d{4}-\d\d-\d\d$/.test(day)) clock.day = day;
  if (Number.isFinite(now)) clock.skew = now - Date.now();
  setCatalogue(sets);
}
