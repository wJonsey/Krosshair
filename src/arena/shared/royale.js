// Battle royale rules, shared so the HUD can describe what the server is doing.

export const ROYALE = {
  max: 50,            // players in one match, humans and bots
  fill: 30,           // bots top the lobby up to this many when it starts
  lobbyWait: 20,      // seconds before a lobby starts (sooner once it is full)
  pickupRange: 1.7,   // metres from a floor item for a bot to pick it up, or for anyone to collect ammo
  reach: 3.6,         // how far away a pilot can pick up what they are looking at
  viewRange: 520,     // players further away than this are left out of your snapshots
  spread: 26,         // minimum distance between two starting points
  dropTime: 14,       // seconds on the drop map, choosing where to land
  airdropFall: 14,    // seconds an airdrop takes to come down once it is called
};

// The storm. Each stage waits, then the safe circle shrinks to `radius` (a share of the island's half
// width) over `shrink` seconds. Outside it you take `damage` per second, armour or not.
export const STORM = [
  { wait: 90, shrink: 50, radius: 0.62, damage: 1 },
  { wait: 60, shrink: 45, radius: 0.36, damage: 2 },
  { wait: 45, shrink: 35, radius: 0.2, damage: 4 },
  { wait: 40, shrink: 30, radius: 0.1, damage: 7 },
  { wait: 30, shrink: 25, radius: 0.04, damage: 10 },
  { wait: 20, shrink: 20, radius: 0, damage: 15 },
];

// Floor loot. Every loot spot on the map gets one roll against these weights.
export const LOOT_TABLE = [
  { weight: 40, kind: 'weapon', pool: ['wasp', 'hornet', 'breaker', 'halcyon', 'pike', 'viper', 'sawn', 'p9', 'p9', 'wren'] },
  { weight: 22, kind: 'weapon', pool: ['talon', 'ronin', 'recon', 'maul', 'vesper'] },
  { weight: 7, kind: 'weapon', pool: ['m44', 'anvil', 'harbinger'] },
  { weight: 12, kind: 'armor', pool: ['light', 'light', 'heavy'] },
  { weight: 6, kind: 'helmet' },
  { weight: 10, kind: 'heal', amount: 50 },
  { weight: 9, kind: 'gadget', pool: ['pulse', 'shield', 'stim', 'ghost', 'decoy', 'drone'] },
  { weight: 7, kind: 'power', pool: ['jump'] },
  { weight: 9, kind: 'ammo' },
];
export const LOOT_CHANCE = 0.85;   // share of loot spots that hold something
// Everyone lands with a blade and nothing else.
export const ROYALE_LOADOUT = { primary: null, sidearm: null, melee: 'knife' };

// Airdrops: called when these storm stages begin, landing inside the next safe circle.
export const AIRDROP_STAGES = [1, 2, 3];
export const AIRDROP_LOOT = [{ kind: 'weapon', pool: ['m44', 'anvil', 'harbinger'] }, { kind: 'weapon', pool: ['talon', 'ronin', 'recon'] }, { kind: 'armor', pool: ['heavy'] }, { kind: 'helmet' }, { kind: 'heal', amount: 50 }, { kind: 'heal', amount: 50 }, { kind: 'ammo' }, { kind: 'gadget', pool: ['pulse', 'shield', 'stim', 'ghost', 'decoy'] }];
// How good a gun is, from the loot table it comes from: 0 common, 1 mid, 2 top. Bots trade up with it.
export const weaponTier = (id) => Math.max(0, LOOT_TABLE.findIndex((entry) => entry.kind === 'weapon' && entry.pool.includes(id)));

// Rarity, the thing you read off the floor before you decide whether the walk is worth it. The tier a gun
// rolls from sets it, and an airdrop upgrades whatever is in it by one. Rarity is not just a colour: a
// better gun is a better kept gun, so it holds more and reloads faster. Nothing else changes, so a
// Legendary pistol never beats a Common sniper at what the sniper is for.
export const ROYALE_RARITIES = {
  common: { id: 'common', name: 'Common', color: '#c9d3db', mag: 1, reload: 1 },
  rare: { id: 'rare', name: 'Rare', color: '#5fa8ff', mag: 1.15, reload: 0.95 },
  epic: { id: 'epic', name: 'Epic', color: '#b07cff', mag: 1.3, reload: 0.9 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffb547', mag: 1.5, reload: 0.82 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
export const weaponRarity = (id, fromAirdrop = false) => RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, weaponTier(id) + (fromAirdrop ? 1 : 0))];
// The gun as that rarity carries it. Damage and handling are untouched on purpose.
export function royaleWeapon(weapon, rarity) {
  const tier = ROYALE_RARITIES[rarity];
  if (!weapon || !tier || tier.mag === 1) return weapon;
  return { ...weapon, spread: { ...weapon.spread }, recoil: { ...weapon.recoil },
    mag: Math.max(1, Math.round(weapon.mag * tier.mag)), reload: weapon.reload * tier.reload, rarity };
}

// The drop: everyone starts this high above the spot they picked and comes down under a parachute.
// botChuteAt/botChuteFall: nobody is flying a bot, so it dives deep and pulls late instead of drifting
// down from 70m at walking pace. That halves the wait for the match to start without it looking wrong.
export const DROP = { height: 190, offset: 45, fall: 32, chuteFall: 8, chuteAt: 70, glide: 11, chuteGlide: 9, botChuteAt: 24, botChuteFall: 10 };
// Pickups that change how you move for a while.
export const POWERS = {
  jump: { name: 'Spring Boots', desc: 'Jump three times as high.', seconds: 40, jump: 1.75 },
};
// Jump pads throw you this fast straight up: enough for any roof.
export const PAD_LAUNCH = 15.5;

// Whether a pilot can see a pickup well enough to take it: from the eye to the item, or just over it,
// with nothing solid in between. Reach alone let loot come through walls and up through floors. The
// browser asks the same question before it offers the pickup, so it never offers one the server refuses.
export function lootInSight(world, eye, loot) {
  return world.lineOfSight(eye[0], eye[1], eye[2], loot.x, loot.y + 0.35, loot.z) || world.lineOfSight(eye[0], eye[1], eye[2], loot.x, loot.y + 0.9, loot.z);
}
