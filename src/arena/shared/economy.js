// Coins: the account currency. Earned slowly in matches, spent on gun skins, operator gear, crates and
// the minigames, sent between pilots, and staked in wager matches. Shared so the menus show the same
// prices and odds the server enforces. Coins are never bought with money.

export const COINS = {
  starter: 50,        // once, on an account's first look at its wallet
  finish: 4,          // any finished match
  win: 12,            // a win against a team with at least one human on it
  winVsBots: 3,       // a win against bots only
  topKills: 8,        // most kills in a match with two or more humans
  playerKill: 2,      // per human killed, scaled by level difference below
  botKill: 0.4,       // per bot killed
  levelStep: 0.05,    // +5% per level the victim is above you…
  levelMax: 0.5,      // …up to +50%
  levelMin: -0.3,     // and down to -30% for much lower levels
  contract: 5,        // per daily contract completed
  cap: 60,            // most one match can pay (wager pots aside)
};
// What one human kill is worth to the killer.
export function killCoins(killerLevel, victimLevel) {
  const bonus = Math.min(COINS.levelMax, Math.max(COINS.levelMin, ((victimLevel || 1) - (killerLevel || 1)) * COINS.levelStep));
  return COINS.playerKill * (1 + bonus);
}

export const RARITY = {
  common: { name: 'Common', price: 150, color: '#aab6c0' },
  rare: { name: 'Rare', price: 400, color: '#5fa8ff' },
  epic: { name: 'Epic', price: 1000, color: '#b07cff' },
  legendary: { name: 'Legendary', price: 2500, color: '#ffb547' },
  mythic: { name: 'Mythic', price: 6000, color: '#ff4fa3' },
};
// Gun finishes. The painters are in client/skins.js. Finishes with a shader there move: every legendary and
// mythic, plus Neon Grid, Circuit, Toxic and Frostbite.
export const FINISHES = [
  { id: 'olive', name: 'Olive Drab', rarity: 'common' },
  { id: 'sand', name: 'Sandstorm', rarity: 'common' },
  { id: 'slate', name: 'Slate', rarity: 'common' },
  { id: 'woodland', name: 'Woodland', rarity: 'common' },
  { id: 'midnight', name: 'Midnight', rarity: 'common' },
  { id: 'bone', name: 'Bone', rarity: 'common' },
  { id: 'rust', name: 'Rust', rarity: 'common' },
  { id: 'flecktarn', name: 'Flecktarn', rarity: 'common' },
  { id: 'digital', name: 'Urban Digital', rarity: 'rare' },
  { id: 'tiger', name: 'Tiger', rarity: 'rare' },
  { id: 'arctic', name: 'Arctic', rarity: 'rare' },
  { id: 'carbon', name: 'Carbon', rarity: 'rare' },
  { id: 'desert', name: 'Desert Digital', rarity: 'rare' },
  { id: 'splinter', name: 'Splinter', rarity: 'rare' },
  { id: 'zebra', name: 'Zebra', rarity: 'rare' },
  { id: 'leopard', name: 'Leopard', rarity: 'rare' },
  { id: 'checker', name: 'Checkered', rarity: 'rare' },
  { id: 'marble', name: 'Marble', rarity: 'rare' },
  { id: 'hazard', name: 'Hazard', rarity: 'epic' },
  { id: 'neon', name: 'Neon Grid', rarity: 'epic' },
  { id: 'damascus', name: 'Damascus', rarity: 'epic' },
  { id: 'crimson', name: 'Crimson Web', rarity: 'epic' },
  { id: 'circuit', name: 'Circuit', rarity: 'epic' },
  { id: 'sakura', name: 'Sakura', rarity: 'epic' },
  { id: 'frost', name: 'Frostbite', rarity: 'epic' },
  { id: 'toxic', name: 'Toxic', rarity: 'epic' },
  { id: 'graffiti', name: 'Graffiti', rarity: 'epic' },
  { id: 'gilded', name: 'Gilded', rarity: 'legendary' },
  { id: 'void', name: 'Void', rarity: 'legendary' },
  { id: 'lava', name: 'Magma', rarity: 'legendary' },
  { id: 'dragon', name: 'Dragon Scale', rarity: 'legendary' },
  { id: 'hexcore', name: 'Hexcore', rarity: 'legendary' },
  { id: 'aurora', name: 'Aurora', rarity: 'mythic' },
  { id: 'inferno', name: 'Inferno', rarity: 'mythic' },
  { id: 'hologram', name: 'Hologram', rarity: 'mythic' },
  { id: 'prism', name: 'Prism', rarity: 'mythic' },
];
export const finishInfo = (id) => FINISHES.find((finish) => finish.id === id) || null;
export const finishPrice = (id) => RARITY[finishInfo(id)?.rarity]?.price || 0;

// Crates: a random finish for a random gun. Weights are per rarity.
export const CRATES = {
  field: { id: 'field', name: 'Field crate', cost: 120, weights: { common: 64, rare: 26, epic: 8, legendary: 1.7, mythic: 0.3 } },
  elite: { id: 'elite', name: 'Elite crate', cost: 450, weights: { rare: 62, epic: 29, legendary: 7.5, mythic: 1.5 } },
};
export const DUPLICATE_REFUND = 0.3;

// Minigames. Every game keeps about 5% so coins drain slowly instead of multiplying.
export const STAKE = { min: 1, max: 500 };
export const COINFLIP = { payout: 1.9 };
export const DICE = { min: 5, max: 95, edge: 95 };                         // roll 1–100, win under the target
export const diceMultiplier = (target) => Math.floor((DICE.edge / (target - 1)) * 100) / 100;
export const SLOTS = {
  symbols: [
    { id: 'skull', icon: '☠', weight: 8, three: 4, two: 0.5 },
    { id: 'bullet', icon: '▲', weight: 6, three: 8, two: 0.5 },
    { id: 'star', icon: '★', weight: 4, three: 16, two: 1 },
    { id: 'diamond', icon: '◆', weight: 2, three: 40, two: 2 },
    { id: 'cross', icon: '⌖', weight: 1, three: 120, two: 4 },
  ],
};
// Payout multiplier for three reels: three of a kind beats a pair; a pair pays its symbol's `two`.
export function slotsMultiplier(reels) {
  const counts = {};
  for (const id of reels) counts[id] = (counts[id] || 0) + 1;
  let best = 0;
  for (const [id, count] of Object.entries(counts)) {
    const symbol = SLOTS.symbols.find((s) => s.id === id);
    if (count === 3) best = Math.max(best, symbol.three); else if (count === 2) best = Math.max(best, symbol.two);
  }
  return best;
}

export const WAGER = { sizes: [1, 2, 3], minStake: 10, maxStake: 5000 };
export const TRANSFER = { min: 1, max: 100000 };
