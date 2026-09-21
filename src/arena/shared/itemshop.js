// The Item Shop: a handful of themed sets, swapped out every day at midnight UTC.
//
// Nothing here is random at runtime. The day's line-up is dealt from the date itself, so every pilot,
// the server and the menus all work out the same shop without anyone storing a schedule. That also means
// a set's whole history can be replayed: walking the days backwards is how "last seen" is answered.
//
// A set stays secret until its debut date. Before then it is not in the shop, not in the skins wall and
// not named anywhere the client can reach, so the first time anyone sees it is the day it lands.
import { COSMETICS, dateKey } from './constants.js';
import { finishInfo } from './economy.js';

export const SHOP_SETS_PER_DAY = 4;
const shopCache = new Map();
const DAY = 86400000;
// Nothing debuts before this: it is the first day the shop ever ran.
export const SHOP_EPOCH = '2026-01-01';

// Each set: what it is called, the day it first lands, and what it holds. `finish` entries are gun
// skins from economy.js; everything else is an operator cosmetic, `kind:id` from COSMETICS.
// The catalogue is installed at boot: the server has the whole thing, a client gets only what has
// already been out. Nothing about an unreleased set is written in this file, so nothing ships in it.
export let ITEM_SETS = [];
let BY_ID = new Map();
export const ITEM_SHOP_KEYS = new Map();
export function setCatalogue(sets) {
  ITEM_SETS = Array.isArray(sets) ? sets : [];
  BY_ID = new Map(ITEM_SETS.map((set) => [set.id, set]));
  ITEM_SHOP_KEYS.clear();
  for (const set of ITEM_SETS) for (const [kind, id] of set.items) ITEM_SHOP_KEYS.set(`${kind}:${id}`, set);
  shopCache.clear();
}

// Item Shop prices. A set bought whole is a fifth off, worked out rather than written down, so a set
// can never be listed cheaper piece by piece than as a bundle.
export const ITEM_PRICES = { rare: 450, epic: 800, legendary: 1300, gear: 550 };
export function itemPrice(kind, id) {
  if (kind === 'finish') return ITEM_PRICES[finishInfo(id)?.rarity] || ITEM_PRICES.epic;
  return ITEM_PRICES.gear;
}
export const setValue = (set) => set.items.reduce((sum, [kind, id]) => sum + itemPrice(kind, id), 0);
export const bundlePrice = (set) => Math.round((setValue(set) * 0.8) / 50) * 50;
// A piece a pilot already owns, by the same keys the profile stores.
export const ownsItem = (kind, id, profile) => (kind === 'finish'
  ? (profile?.finishes || []).includes(id)
  : (profile?.owned || []).includes(`${kind}:${id}`));
export const itemName = (kind, id) => (kind === 'finish' ? finishInfo(id)?.name : COSMETICS[kind]?.find((item) => item.id === id)?.name) || id;

export const ITEM_SET_IDS = () => ITEM_SETS.map((set) => set.id);
export const itemSet = (id) => BY_ID.get(id) || null;

// Is this gun skin an Item Shop exclusive? Crates, trade-ups and the normal shop all check.
export const exclusiveFinish = (id) => ITEM_SHOP_KEYS.has(`finish:${id}`);
export const exclusiveSetOf = (kind, id) => ITEM_SHOP_KEYS.get(`${kind}:${id}`) || null;

const dayNumber = (key) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY);
const keyOfDay = (day) => dateKey(day * DAY);
export const shopDay = (key = dateKey()) => dayNumber(key);
// Seconds until the shop turns over, for the countdown.
export const untilRotation = (now = Date.now()) => Math.max(0, (Math.floor(now / DAY) + 1) * DAY - now);

// A small deterministic shuffle. The same day always deals the same hand, on every machine.
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const released = (set, key = dateKey()) => dayNumber(key) >= dayNumber(set.debut);
// Sets a pilot is allowed to know exist on this day. Anything still to come is not in here.
export const knownSets = (key = dateKey()) => ITEM_SETS.filter((set) => released(set, key));

// The line-up for one day. A set landing on its debut is always in it: a launch never misses its own day.
export function shopFor(key = dateKey()) {
  if (shopCache.has(key)) return shopCache.get(key);
  const day = dayNumber(key);
  const out = [];
  if (day >= dayNumber(SHOP_EPOCH)) {
    const debuting = ITEM_SETS.filter((set) => dayNumber(set.debut) === day);
    const rest = knownSets(key).filter((set) => !debuting.includes(set));
    const random = mulberry(day * 2654435761);
    for (let i = rest.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    out.push(...debuting, ...rest.slice(0, Math.max(0, SHOP_SETS_PER_DAY - debuting.length)));
  }
  if (shopCache.size > 800) shopCache.clear();
  shopCache.set(key, out);
  return out;
}
export const inShop = (setId, key = dateKey()) => shopFor(key).some((set) => set.id === setId);
// One bundle a day. Whichever set is featured is the only one sold whole: the rest go piece by piece,
// so the saving is worth turning up for rather than always being there.
export function bundleSet(key = dateKey()) {
  const sets = shopFor(key);
  if (!sets.length) return null;
  return sets[shopDay(key) % sets.length];
}
export const bundleOn = (setId, key = dateKey()) => bundleSet(key)?.id === setId;
// How long the shop can run before it needs new sets: the day the last one lands.
export function runway(key = dateKey()) {
  if (!ITEM_SETS.length) return { days: 0, last: null, left: 0 };
  const last = ITEM_SETS.map((set) => set.debut).sort().pop();
  const left = ITEM_SETS.filter((set) => set.debut > key).length;
  return { days: Math.max(0, dayNumber(last) - dayNumber(key)), last, left };
}

// The last day this set stood in the shop, today included. Null if it has never been out.
// Bounded by the debut, so a set that has only just landed answers in one step.
export function lastSeen(setId, key = dateKey()) {
  const set = itemSet(setId);
  if (!set) return null;
  const first = dayNumber(set.debut);
  for (let day = dayNumber(key); day >= first; day -= 1) { const on = keyOfDay(day); if (inShop(setId, on)) return on; }
  return null;
}
// How an owned piece reads in the skins wall: which set, and when it was last out.
export function seenLine(kind, id, key = dateKey()) {
  const set = exclusiveSetOf(kind, id);
  if (!set || !released(set, key)) return null;
  const seen = lastSeen(set.id, key);
  return { set: set.id, name: set.name, seen, days: seen ? dayNumber(key) - dayNumber(seen) : null };
}
// "today", "yesterday", "12 days ago": the same words everywhere it is printed.
export function seenText(days) {
  if (!Number.isFinite(days)) return 'not seen yet';
  if (days <= 0) return 'in the shop today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
