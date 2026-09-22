// Gunsmith: attachments, and the rules that keep them honest.
//
// A build is `{ optic, muzzle, barrel, mag, stock, grip }`, each an attachment id or null. Buying a gun
// in the armoury hands you the build you saved for it, and the credits cost rises by what you bolted on.
//
// Two rules hold this together, and both are covered by tests:
//   1. Every attachment gives something up. No part is a straight upgrade, so there is no one right build.
//   2. The server resolves the gun. `resolveWeapon` runs on the server before a shot is traced, so a
//      client that lies about its build changes nothing.
//
// Battle royale never reads any of this: guns come off the floor there, the same for everyone.
import { WEAPONS } from './constants.js';

export const SLOTS = ['optic', 'muzzle', 'barrel', 'mag', 'stock', 'grip'];
// Stocks and foregrips need something to bolt to: a pistol has neither.
const LONG_GUNS = ['sniper', 'marksman', 'rifle', 'lmg', 'smg', 'shotgun'];
export const SLOT_NAMES = { optic: 'Optic', muzzle: 'Muzzle', barrel: 'Barrel', mag: 'Magazine', stock: 'Stock', grip: 'Grip' };

// `mods` are multipliers on a number, or a flat value for the things that are not numbers.
// `add` are flat additions. `set` replaces outright (sights, suppression).
// Families: which guns a part fits. Missing means all of them.
export const ATTACHMENTS = {
  // ---- optics. Heavier glass sees further and comes up slower.
  // These three magnify nothing, so they have to say so. A sight below 40 is treated as magnified all
  // over the game: it holds breath, it sways, it draws the scope picture. Leaving the gun's own zoom in
  // place meant a sniper with a red dot on it still behaved like a sniper looking down glass.
  irons: { id: 'irons', slot: 'optic', name: 'Iron sights', cost: 0, blurb: 'Nothing on the rail. Fastest up.',
    set: { sight: 'iron', scope: [52] }, mods: { scopeTime: 0.82 }, add: { 'spread.ads': 0.05 }, fits: null },
  dot: { id: 'dot', slot: 'optic', name: 'Red dot', cost: 200, blurb: 'A clean dot. Costs a little speed.',
    set: { sight: 'dot', scope: [48] }, mods: { scopeTime: 1.06, 'spread.ads': 0.88, 'spread.move': 0.92 } },
  holo: { id: 'holo', slot: 'optic', name: 'Holographic', cost: 300, blurb: 'Wide window, slower to settle.',
    set: { sight: 'holo', scope: [52] }, mods: { scopeTime: 1.14, 'spread.ads': 0.8, 'spread.move': 0.88, 'spread.air': 1.1 } },
  prism: { id: 'prism', slot: 'optic', name: 'Prism 2x', cost: 450, blurb: 'Magnified. Heavy on the rail.',
    set: { sight: 'prism', scope: [34] }, mods: { scopeTime: 1.3, 'spread.ads': 0.7, 'spread.move': 0.9, speed: 0.98 } },
  longscope: { id: 'longscope', slot: 'optic', name: 'Long scope 4x', cost: 700, blurb: 'Reach, at the cost of everything close.',
    set: { sight: 'scope', scope: [20] }, mods: { scopeTime: 1.55, 'spread.ads': 0.55, 'spread.move': 0.85, speed: 0.95, 'spread.hip': 1.25 },
    fits: ['sniper', 'marksman', 'rifle', 'lmg'] },

  // ---- muzzle
  suppressor: { id: 'suppressor', slot: 'muzzle', name: 'Suppressor', cost: 500, blurb: 'Quiet, and off the minimap. Softer at distance.',
    set: { suppressed: true }, mods: { loud: 0.25, 'falloff.0': 0.82, 'falloff.1': 0.82, scopeTime: 1.08, speed: 0.99 } },
  compensator: { id: 'compensator', slot: 'muzzle', name: 'Compensator', cost: 350, blurb: 'Holds the sights down. Louder, wider from the hip.',
    mods: { 'recoil.side': 0.6, 'recoil.kick': 0.88, loud: 1.2, 'spread.hip': 1.18 } },
  brake: { id: 'brake', slot: 'muzzle', name: 'Muzzle brake', cost: 300, blurb: 'Kills the climb. Everyone hears it.',
    mods: { 'recoil.kick': 0.72, loud: 1.45, 'spread.move': 1.12 } },

  // ---- barrel
  longbarrel: { id: 'longbarrel', slot: 'barrel', name: 'Long barrel', cost: 450, blurb: 'Hits hard further out. Slow to swing.',
    mods: { 'falloff.0': 1.3, 'falloff.1': 1.25, pen: 1.12, speed: 0.95, scopeTime: 1.16, equip: 1.15 } },
  shortbarrel: { id: 'shortbarrel', slot: 'barrel', name: 'Short barrel', cost: 350, blurb: 'Quick in a doorway. Nothing past it.',
    mods: { speed: 1.05, scopeTime: 0.85, equip: 0.85, 'falloff.0': 0.72, 'falloff.1': 0.75, 'spread.hip': 1.1 } },
  heavybarrel: { id: 'heavybarrel', slot: 'barrel', name: 'Heavy barrel', cost: 550, blurb: 'Punches through cover. Heavy to carry.',
    mods: { pen: 1.35, armorPen: 1.2, speed: 0.93, scopeTime: 1.2 } },

  // ---- magazine
  extmag: { id: 'extmag', slot: 'mag', name: 'Extended mag', cost: 400, blurb: 'More rounds, longer to put in.',
    mods: { mag: 1.4, reload: 1.25, speed: 0.98 } },
  drum: { id: 'drum', slot: 'mag', name: 'Drum', cost: 650, blurb: 'A lot more rounds. You will feel it.',
    mods: { mag: 1.85, reload: 1.5, speed: 0.94, scopeTime: 1.1 }, fits: ['smg', 'rifle', 'lmg', 'shotgun'] },
  fastmag: { id: 'fastmag', slot: 'mag', name: 'Fast mag', cost: 300, blurb: 'Back in the fight sooner. Carries less.',
    mods: { reload: 0.72, mag: 0.8, reserve: 0.85 } },

  // ---- stock
  heavystock: { id: 'heavystock', slot: 'stock', name: 'Heavy stock', cost: 400, blurb: 'Settles fast. Slows you down.',
    mods: { 'recoil.recover': 1.35, 'spread.bloomMax': 0.85, speed: 0.94 }, fits: LONG_GUNS },
  lightstock: { id: 'lightstock', slot: 'stock', name: 'Skeleton stock', cost: 350, blurb: 'Quick on your feet. Kicks more.',
    mods: { speed: 1.06, scopeTime: 0.9, 'recoil.kick': 1.2, 'recoil.recover': 0.85 }, fits: LONG_GUNS },
  nostock: { id: 'nostock', slot: 'stock', name: 'No stock', cost: 250, blurb: 'Fastest hands in the game. Hold it if you can.',
    mods: { speed: 1.09, equip: 0.75, scopeTime: 0.8, 'recoil.kick': 1.45, 'spread.ads': 1.5 }, fits: LONG_GUNS },

  // ---- grip
  vertgrip: { id: 'vertgrip', slot: 'grip', name: 'Vertical grip', cost: 350, blurb: 'Steady on the move. Slower to aim.',
    mods: { 'spread.move': 0.72, 'recoil.kick': 0.9, scopeTime: 1.12 }, fits: LONG_GUNS },
  anglegrip: { id: 'anglegrip', slot: 'grip', name: 'Angled grip', cost: 350, blurb: 'Up fast. Wanders under fire.',
    mods: { scopeTime: 0.82, 'spread.bloom': 1.25, 'recoil.side': 1.2 }, fits: LONG_GUNS },
  bipod: { id: 'bipod', slot: 'grip', name: 'Bipod', cost: 400, blurb: 'Rock steady still. Dead weight moving.',
    mods: { 'recoil.kick': 0.65, 'recoil.side': 0.7, 'spread.move': 1.45, speed: 0.95 }, fits: ['lmg', 'sniper', 'marksman'] },
};

// Which way is better for each stat an attachment can touch. The menus colour by this, and the tests
// check the give and take by it, so there is one answer rather than two that can drift apart.
export const BETTER_DOWN = new Set(['cooldown', 'reload', 'equip', 'scopeTime', 'loud', 'spread.hip', 'spread.ads',
  'spread.move', 'spread.air', 'spread.bloom', 'spread.bloomMax', 'recoil.kick', 'recoil.side']);
export const BETTER_UP = new Set(['damage', 'mag', 'reserve', 'speed', 'pen', 'armorPen', 'recoil.recover', 'falloff.0', 'falloff.1']);
export const STAT_KEYS = [...BETTER_UP, ...BETTER_DOWN];
export const betterWhenLower = (key) => BETTER_DOWN.has(key);
// Every key any attachment actually touches, so a new one cannot go unnoticed by the menus.
export const touchedKeys = () => [...new Set(Object.values(ATTACHMENTS).flatMap((part) => [...Object.keys(part.mods || {}), ...Object.keys(part.add || {})]))];

export const ATTACHMENT_IDS = Object.keys(ATTACHMENTS);
export const bySlot = (slot) => ATTACHMENT_IDS.map((id) => ATTACHMENTS[id]).filter((part) => part.slot === slot);
// A part fits a gun when the family is on its list, and never fits a knife.
export function fitsWeapon(part, weapon) {
  if (!part || !weapon || weapon.melee) return false;
  if (weapon.noMods) return false;
  return !part.fits || part.fits.includes(weapon.family);
}
export const partsFor = (weapon, slot) => bySlot(slot).filter((part) => fitsWeapon(part, weapon));

const path = (object, key) => key.split('.').reduce((at, step) => (at == null ? at : at[step]), object);
function setPath(object, key, value) {
  const steps = key.split('.');
  const last = steps.pop();
  const target = steps.reduce((at, step) => at[step], object);
  target[last] = value;
}

// A build with nothing on it, and the same build cleaned of anything that does not belong.
export const emptyBuild = () => Object.fromEntries(SLOTS.map((slot) => [slot, null]));
export function cleanBuild(weaponId, build) {
  const weapon = WEAPONS[weaponId];
  const out = emptyBuild();
  if (!weapon || weapon.melee || weapon.noMods || !build || typeof build !== 'object') return out;
  for (const slot of SLOTS) {
    const part = ATTACHMENTS[build[slot]];
    if (part && part.slot === slot && fitsWeapon(part, weapon)) out[slot] = part.id;
  }
  return out;
}
export const buildCost = (build) => SLOTS.reduce((sum, slot) => sum + (ATTACHMENTS[build?.[slot]]?.cost || 0), 0);
export const buildParts = (build) => SLOTS.map((slot) => ATTACHMENTS[build?.[slot]]).filter(Boolean);
export const isEmptyBuild = (build) => SLOTS.every((slot) => !build?.[slot]);

// The gun as it actually shoots. Multipliers stack, then the numbers that must stay whole are rounded.
// Nothing here reaches back into WEAPONS: the copy is the gun for this pilot, this round.
export function resolveWeapon(weaponId, build) {
  const base = WEAPONS[weaponId];
  if (!base) return null;
  const clean = cleanBuild(weaponId, build);
  if (isEmptyBuild(clean)) return base;
  const out = {
    ...base,
    spread: { ...base.spread },
    recoil: { ...base.recoil },
    falloff: base.falloff ? [...base.falloff] : null,
    scope: base.scope ? [...base.scope] : null,
    build: clean,
  };
  for (const part of buildParts(clean)) {
    for (const [key, value] of Object.entries(part.set || {})) setPath(out, key, Array.isArray(value) ? [...value] : value);
    for (const [key, factor] of Object.entries(part.mods || {})) {
      const now = path(out, key);
      if (typeof now === 'number') setPath(out, key, now * factor);
    }
    for (const [key, delta] of Object.entries(part.add || {})) {
      const now = path(out, key);
      if (typeof now === 'number') setPath(out, key, now + delta);
    }
  }
  out.mag = Math.max(1, Math.round(out.mag));
  out.reserve = Math.max(0, Math.round(out.reserve));
  out.cost = base.cost + buildCost(clean);
  // A gun that lost its magnification loses its zoom levels with it.
  if (out.sight !== 'scope' && out.sight !== 'prism' && base.scope && out.scope === base.scope) out.scope = [...base.scope];
  return out;
}

// What a pilot is allowed to bolt on. Attachments unlock with level so a new pilot is not drowned in them.
export const ATTACHMENT_LEVEL = 4;
export const attachmentsUnlocked = (level) => level >= ATTACHMENT_LEVEL;
