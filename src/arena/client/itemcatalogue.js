// The Item Shop catalogue, as the server hands it over. The pieces are pushed into the same registries
// the rest of the client already reads, so every existing lookup keeps working without knowing where
// they came from. Nothing about an unreleased set is in here: the server never sends it.
import { COSMETICS } from '../shared/constants.js';
import { FINISHES } from '../shared/economy.js';
import { setCatalogue } from '../shared/itemshop.js';

export function installShopCatalogue({ sets = [], finishes = [], cosmetics = {} } = {}) {
  for (const finish of finishes) if (!FINISHES.some((entry) => entry.id === finish.id)) FINISHES.push(finish);
  for (const [kind, items] of Object.entries(cosmetics)) {
    if (!COSMETICS[kind]) continue;
    for (const item of items) if (!COSMETICS[kind].some((entry) => entry.id === item.id)) COSMETICS[kind].push(item);
  }
  setCatalogue(sets);
}
