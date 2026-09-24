// Weapon levels: every gun starts at level 0 with only its stock build, earns XP by being used, and
// unlocks attachments as it levels. Everything a developer would want to tune is at the top of this file.
//
// Levels are per pilot and per gun, held in the server's memory only (ProfileStore.gunXp) and never
// written to disk: a server restart puts every gun back to level 0. The server is the only thing that
// awards XP or decides what is unlocked; the browser runs these same functions only to draw the menus.
import { WEAPONS } from './constants.js';
import { ATTACHMENTS, SLOTS, cleanBuild, fitsWeapon } from './attachments.js';

// ------------------------------------------------------------------ tuning
export const MAX_WEAPON_LEVEL = 20;
// Total XP to reach each level: XP_CURVE[0] is level 1, XP_CURVE[1] level 2, and so on. The steps grow
// by 50 a level: 100, 250, 450, 700 ... 11,500 for level 20.
export const XP_CURVE = Array.from({ length: MAX_WEAPON_LEVEL }, (_, i) => 25 * (i + 1) * (i + 4));
// What using a gun earns it. Only the server's own kill and assist events pay; the browser never can.
export const WEAPON_XP = {
  kill: 100,        // a pilot killed with it
  botKill: 40,      // a bot killed with it: worth less, as everywhere else
  headshot: 25,     // on top of the kill
  assist: 25,       // the gun you did the damage with, when someone else got the kill
};
// The level each attachment unlocks at, on every gun it fits. A gun only lists the parts that fit it,
// so a pistol has fewer unlocks than a rifle and some of its levels bring nothing new.
export const UNLOCK_LEVELS = {
  irons: 1, dot: 2, fastmag: 3, shortbarrel: 4, compensator: 5, anglegrip: 6, lightstock: 7, holo: 8,
  extmag: 9, vertgrip: 10, brake: 11, longbarrel: 12, heavystock: 13, prism: 14, suppressor: 15,
  nostock: 16, bipod: 17, heavybarrel: 18, drum: 19, longscope: 20,
};
// A different level for one part on one gun: { m44: { longscope: 6 } }. Anything not listed uses the above.
export const WEAPON_UNLOCKS = {};

// ------------------------------------------------------------------ rules
// A gun that takes parts at all. The knife and anything marked noMods have no levels.
export const levelledGun = (weaponId) => typeof weaponId === 'string' && Object.hasOwn(WEAPONS, weaponId) && !WEAPONS[weaponId].melee && !WEAPONS[weaponId].noMods;
const maxXp = () => XP_CURVE[MAX_WEAPON_LEVEL - 1];
export const clampXp = (xp) => (Number.isFinite(xp) && xp > 0 ? Math.min(Math.floor(xp), maxXp()) : 0);
export function weaponLevel(xp) {
  const clean = clampXp(xp);
  let level = 0;
  while (level < MAX_WEAPON_LEVEL && clean >= XP_CURVE[level]) level += 1;
  return level;
}
// Everything the Gunsmith header shows: the level, how far into it, and what the next one needs.
export function weaponProgress(xp) {
  const clean = clampXp(xp), level = weaponLevel(clean);
  const from = level ? XP_CURVE[level - 1] : 0, to = level < MAX_WEAPON_LEVEL ? XP_CURVE[level] : from;
  return { level, xp: clean, into: clean - from, needed: to - from, max: level >= MAX_WEAPON_LEVEL };
}
// The level a part unlocks at on this gun. A part that does not fit, or a level that is not a whole
// number in range, never unlocks: a typo in the table locks a part rather than handing it out.
export function unlockLevel(weaponId, partId) {
  if (!levelledGun(weaponId) || typeof partId !== 'string' || !Object.hasOwn(ATTACHMENTS, partId) || !fitsWeapon(ATTACHMENTS[partId], WEAPONS[weaponId])) return Infinity;
  const override = WEAPON_UNLOCKS[weaponId]?.[partId];
  const level = override ?? UNLOCK_LEVELS[partId];
  return Number.isInteger(level) && level >= 1 && level <= MAX_WEAPON_LEVEL ? level : Infinity;
}
export const partUnlocked = (weaponId, partId, level) => level >= unlockLevel(weaponId, partId);
// This gun's unlocks in order: [{ part, level }].
export function unlockTree(weaponId) {
  if (!levelledGun(weaponId)) return [];
  return Object.values(ATTACHMENTS).map((part) => ({ part, level: unlockLevel(weaponId, part.id) }))
    .filter((entry) => Number.isFinite(entry.level)).sort((a, b) => a.level - b.level || SLOTS.indexOf(a.part.slot) - SLOTS.indexOf(b.part.slot));
}
export const nextUnlock = (weaponId, level) => unlockTree(weaponId).find((entry) => entry.level > level) || null;
export const unlocksBetween = (weaponId, from, to) => unlockTree(weaponId).filter((entry) => entry.level > from && entry.level <= to).map((entry) => entry.part);
// A build with only what this gun's level allows. The stock build (nothing fitted) is always allowed.
export function usableBuild(weaponId, build, level) {
  const clean = cleanBuild(weaponId, build);
  for (const slot of SLOTS) if (clean[slot] && !partUnlocked(weaponId, clean[slot], level)) clean[slot] = null;
  return clean;
}
