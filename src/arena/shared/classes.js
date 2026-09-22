// Saved classes: a kit you build in the menu and buy in one press during the buy phase.
//
// Krosshair buys its guns each round, so a class is a shopping list, not a spawn kit. Nothing here
// grants anything: the room walks the list through the ordinary armoury, paying the ordinary prices,
// so a class can never hand you something you could not have bought yourself.
//
// A class stores ids and nothing else. What a gun is actually worth, and what is bolted to it, comes
// from the weapon table and the pilot's gunsmith builds, so there is one copy of each.
import { ARMOR, GADGETS, GADGET_SLOTS, WEAPONS } from './constants.js';

export const CLASS_SLOTS = 5;
export const NAME_MAX = 16;

export const primaryGuns = () => Object.values(WEAPONS).filter((w) => w.slot === 'primary');
export const sidearmGuns = () => Object.values(WEAPONS).filter((w) => w.slot === 'sidearm');

// What a slot is worth buying first when the wallet will not cover everything. The gun comes before
// the armour because a round without a gun is over; the trinkets come last.
export const BUY_ORDER = ['primary', 'armor', 'sidearm', 'helmet', 'gadgets'];

const nameOf = (raw, fallback) => {
  const clean = String(raw ?? '').replace(/[\u0000-\u001f<>&"'\\]/g, '').trim().slice(0, NAME_MAX);
  return clean || fallback;
};

export function emptyClass(index = 0) {
  return { name: `Class ${index + 1}`, primary: null, sidearm: null, armor: null, helmet: false, gadgets: [] };
}

// The classes a new pilot starts with: one of each shape of fight, built only from guns that exist.
export function defaultClasses() {
  const pick = (id, slot) => (WEAPONS[id] && WEAPONS[id].slot === slot ? id : null);
  const first = (family) => primaryGuns().find((w) => w.family === family)?.id || null;
  // A named gun where there is an obvious one, the cheapest of its family otherwise, so these still
  // make sense if a gun is retired or renamed.
  const cheapest = (family) => primaryGuns().filter((w) => w.family === family).sort((a, b) => a.cost - b.cost)[0]?.id || null;
  const gunFor = (id, family) => pick(id, 'primary') || cheapest(family) || first('rifle');
  const out = [
    { name: 'Assault', primary: gunFor('talon', 'rifle'), sidearm: pick('p9', 'sidearm'), armor: 'light', helmet: true, gadgets: ['pulse'] },
    { name: 'Close', primary: gunFor('wasp', 'smg'), sidearm: pick('p9', 'sidearm'), armor: 'light', helmet: false, gadgets: ['stim'] },
    { name: 'Marksman', primary: gunFor('vesper', 'sniper'), sidearm: pick('p9', 'sidearm'), armor: 'light', helmet: true, gadgets: ['decoy'] },
    { name: 'Support', primary: gunFor('anvil', 'lmg'), sidearm: pick('p9', 'sidearm'), armor: 'heavy', helmet: true, gadgets: ['shield'] },
  ];
  while (out.length < CLASS_SLOTS) out.push(emptyClass(out.length));
  return out.slice(0, CLASS_SLOTS).map((kit, index) => cleanClass(kit, index));
}

// Everything a class can hold, checked against what the game actually has. A saved class outlives the
// gun it names: a weapon that is retired, or a gadget that goes, is dropped rather than left to break
// the armoury later.
export function cleanClass(raw, index = 0) {
  const out = emptyClass(index);
  if (!raw || typeof raw !== 'object') return out;
  out.name = nameOf(raw.name, out.name);
  const gun = (id, slot) => (typeof id === 'string' && WEAPONS[id] && WEAPONS[id].slot === slot && !WEAPONS[id].melee ? id : null);
  out.primary = gun(raw.primary, 'primary');
  out.sidearm = gun(raw.sidearm, 'sidearm');
  out.armor = raw.armor === 'light' || raw.armor === 'heavy' ? raw.armor : null;
  out.helmet = Boolean(raw.helmet) && Boolean(ARMOR.helmet);
  const seen = new Set();
  out.gadgets = (Array.isArray(raw.gadgets) ? raw.gadgets : [])
    .filter((id) => typeof id === 'string' && GADGETS[id] && !seen.has(id) && seen.add(id))
    .slice(0, GADGET_SLOTS);
  return out;
}

export function cleanClasses(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: CLASS_SLOTS }, (_, index) => cleanClass(list[index], index));
}

export const isEmptyClass = (kit) => !kit || (!kit.primary && !kit.sidearm && !kit.armor && !kit.helmet && !kit.gadgets?.length);

// What the armoury will be asked for, in the order it is asked. Ids only: the room prices them.
export function shoppingList(kit) {
  const clean = cleanClass(kit);
  const out = [];
  for (const slot of BUY_ORDER) {
    if (slot === 'gadgets') { for (const id of clean.gadgets) out.push(id); continue; }
    if (slot === 'helmet') { if (clean.helmet) out.push('helmet'); continue; }
    if (clean[slot]) out.push(clean[slot]);
  }
  return out;
}

// What it costs at full price, for the menu to show. The room still charges its own way, with the
// refund for whatever is already in the slot, so this is a guide and not a promise.
export function classCost(kit, buildCost = () => 0) {
  const clean = cleanClass(kit);
  let total = 0;
  if (clean.primary) total += (WEAPONS[clean.primary]?.cost || 0) + buildCost(clean.primary);
  if (clean.sidearm) total += (WEAPONS[clean.sidearm]?.cost || 0) + buildCost(clean.sidearm);
  if (clean.armor) total += ARMOR[clean.armor]?.cost || 0;
  if (clean.helmet) total += ARMOR.helmet?.cost || 0;
  for (const id of clean.gadgets) total += GADGETS[id]?.cost || 0;
  return total;
}
