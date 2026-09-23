// Coins: the account currency. Earned slowly in matches, spent on gun skins, operator gear, crates and
// the minigames, sent between pilots, and staked in wager matches. Shared so the menus show the same
// prices and odds the server enforces. Coins are never bought with money.

// Roughly a cheap crate every couple of good matches. Matches take minutes, so paying 12 coins for a
// hard-fought loss made the crates feel out of reach and the dailies not worth reading.
export const COINS = {
  starter: 250,       // once, on an account's first look at its wallet: two crates, so the first one is now
  finish: 10,         // any finished match
  win: 25,            // a win against a team with at least one human on it
  winVsBots: 6,       // a win against bots only, still clearly the lesser prize
  topKills: 16,       // most kills in a match with two or more humans
  playerKill: 4,      // per human killed, scaled by level difference below
  botKill: 0.8,       // per bot killed
  levelStep: 0.05,    // +5% per level the victim is above you…
  levelMax: 0.5,      // …up to +50%
  levelMin: -0.3,     // and down to -30% for much lower levels
  contract: 15,       // per daily contract completed
  cap: 140,           // most one match can pay (wager pots aside): a strong match and its dailies both fit
};
// What one human kill is worth to the killer.
export function killCoins(killerLevel, victimLevel) {
  const bonus = Math.min(COINS.levelMax, Math.max(COINS.levelMin, ((victimLevel || 1) - (killerLevel || 1)) * COINS.levelStep));
  return COINS.playerKill * (1 + bonus);
}

// price: buying one skin outright in the Skins tab, deliberately steep so crates are the better deal
// (Mythics can't be bought at all). value: what a skin is worth back as scrap or a duplicate refund,
// kept low enough that opening crates to scrap them always loses coins.
export const RARITY = {
  common: { name: 'Common', price: 1500, value: 40, color: '#aab6c0' },
  rare: { name: 'Rare', price: 4000, value: 120, color: '#5fa8ff' },
  epic: { name: 'Epic', price: 10000, value: 400, color: '#b07cff' },
  legendary: { name: 'Legendary', price: 25000, value: 1500, color: '#ffb547' },
  mythic: { name: 'Mythic', price: null, value: 5000, color: '#ff4fa3' },
  // The developers' secret class: never sold, dropped, traded or scrapped, and hidden from everyone else.
  dev: { name: 'Dev', price: null, value: 0, color: '#00ffc6', secret: true },
};
// Rarities anyone can own. The dev class is left out of every public list.
export const PUBLIC_RARITIES = Object.keys(RARITY).filter((id) => !RARITY[id].secret);
// Gun finishes. The painters are in client/skins.js. Only Mythics move, and every Mythic does.
export const FINISHES = [
  { id: 'olive', name: 'Olive Drab', rarity: 'common' },
  { id: 'sand', name: 'Sandstorm', rarity: 'common' },
  { id: 'slate', name: 'Slate', rarity: 'common' },
  { id: 'woodland', name: 'Woodland', rarity: 'common' },
  { id: 'midnight', name: 'Midnight', rarity: 'common' },
  { id: 'bone', name: 'Bone', rarity: 'common' },
  { id: 'rust', name: 'Rust', rarity: 'common' },
  { id: 'flecktarn', name: 'Flecktarn', rarity: 'common' },
  { id: 'gunmetal', name: 'Gunmetal', rarity: 'common' },
  { id: 'coyote', name: 'Coyote Brown', rarity: 'common' },
  { id: 'navy', name: 'Navy', rarity: 'common' },
  { id: 'brick', name: 'Brick', rarity: 'common' },
  { id: 'multicam', name: 'Multicam', rarity: 'common' },
  { id: 'snowcamo', name: 'Snow Camo', rarity: 'common' },
  { id: 'nightcamo', name: 'Night Camo', rarity: 'common' },
  { id: 'walnut', name: 'Walnut', rarity: 'common' },
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
  { id: 'topo', name: 'Topographic', rarity: 'rare' },
  { id: 'python', name: 'Python', rarity: 'rare' },
  { id: 'kevlar', name: 'Kevlar', rarity: 'rare' },
  { id: 'racing', name: 'Racing Stripe', rarity: 'rare' },
  { id: 'giraffe', name: 'Giraffe', rarity: 'rare' },
  { id: 'denim', name: 'Denim', rarity: 'rare' },
  { id: 'honeycomb', name: 'Honeycomb', rarity: 'rare' },
  { id: 'ducttape', name: 'Duct Tape', rarity: 'rare' },
  { id: 'hazard', name: 'Hazard', rarity: 'epic' },
  { id: 'damascus', name: 'Damascus', rarity: 'epic' },
  { id: 'crimson', name: 'Crimson Web', rarity: 'epic' },
  { id: 'sakura', name: 'Sakura', rarity: 'epic' },
  { id: 'graffiti', name: 'Graffiti', rarity: 'epic' },
  { id: 'bubblegum', name: 'Bubblegum Camo', rarity: 'epic' },
  { id: 'tide', name: 'Tide', rarity: 'epic' },
  { id: 'vaporwave', name: 'Vaporwave', rarity: 'epic' },
  { id: 'stained', name: 'Stained Glass', rarity: 'epic' },
  { id: 'comic', name: 'Comic', rarity: 'epic' },
  { id: 'pixel', name: '8-Bit', rarity: 'epic' },
  { id: 'patina', name: 'Patina', rarity: 'epic' },
  { id: 'terrazzo', name: 'Terrazzo', rarity: 'epic' },
  { id: 'glacier', name: 'Glacier', rarity: 'epic' },
  { id: 'obsidian', name: 'Obsidian', rarity: 'legendary' },
  { id: 'royal', name: 'Royal Filigree', rarity: 'legendary' },
  { id: 'jade', name: 'Imperial Jade', rarity: 'legendary' },
  { id: 'redline', name: 'Redline', rarity: 'legendary' },
  { id: 'koi', name: 'Koi', rarity: 'legendary' },
  { id: 'blueprint', name: 'Blueprint', rarity: 'legendary' },
  { id: 'meteorite', name: 'Meteorite', rarity: 'legendary' },
  { id: 'pearl', name: 'Mother of Pearl', rarity: 'legendary' },
  { id: 'lacquer', name: 'Red Lacquer', rarity: 'legendary' },
  { id: 'scrimshaw', name: 'Scrimshaw', rarity: 'legendary' },
  { id: 'abyss', name: 'Abyss', rarity: 'legendary' },
  { id: 'neon', name: 'Neon Grid', rarity: 'mythic' },
  { id: 'circuit', name: 'Circuit', rarity: 'mythic' },
  { id: 'toxic', name: 'Toxic', rarity: 'mythic' },
  { id: 'frost', name: 'Frostbite', rarity: 'mythic' },
  { id: 'gilded', name: 'Gilded', rarity: 'mythic' },
  { id: 'void', name: 'Void', rarity: 'mythic' },
  { id: 'lava', name: 'Magma', rarity: 'mythic' },
  { id: 'dragon', name: 'Dragon Scale', rarity: 'mythic' },
  { id: 'hexcore', name: 'Hexcore', rarity: 'mythic' },
  { id: 'aurora', name: 'Aurora', rarity: 'mythic' },
  { id: 'inferno', name: 'Inferno', rarity: 'mythic' },
  { id: 'hologram', name: 'Hologram', rarity: 'mythic' },
  { id: 'prism', name: 'Prism', rarity: 'mythic' },
  { id: 'plasma', name: 'Plasma', rarity: 'mythic' },
  { id: 'glitch', name: 'Glitch', rarity: 'mythic' },
  { id: 'quicksilver', name: 'Quicksilver', rarity: 'mythic' },
  { id: 'nebula', name: 'Nebula', rarity: 'mythic' },
  { id: 'spectre', name: 'Spectre', rarity: 'mythic' },
  { id: 'synthwave', name: 'Synthwave', rarity: 'mythic' },
  // Dev class: the developers' accounts wear these on every gun. Nobody else ever sees them in a list.
  { id: 'devsource', name: 'Source Code', rarity: 'dev' },
  { id: 'singularity', name: 'Singularity', rarity: 'dev' },
  { id: 'overclock', name: 'Overclock', rarity: 'dev' },
  { id: 'devnull', name: 'Null Texture', rarity: 'dev' },
  { id: 'compile', name: 'Compile', rarity: 'dev' },
  // Item Shop exclusives are added at boot from server/itemsets.js, so nothing unreleased ships to a
  // browser. `shop: 'item'` is what every check reads once they are in.
];
export const finishInfo = (id) => FINISHES.find((finish) => finish.id === id) || null;
export const finishPrice = (id) => RARITY[finishInfo(id)?.rarity]?.price || 0;   // 0: not for sale
export const devFinish = (id) => finishInfo(id)?.rarity === 'dev';
export const PUBLIC_FINISHES = FINISHES.filter((finish) => !RARITY[finish.rarity].secret);
// Sold only in the Item Shop, so the crates, the trade-up and the normal shelf all leave them alone.
export const shopOnly = (id) => finishInfo(id)?.shop === 'item';
export const finishValue = (id) => RARITY[finishInfo(id)?.rarity]?.value || 0;

// Crates: a random finish for a random gun. `weights` are per rarity; `pool` limits the finishes a crate
// can drop (rarities with nothing in the pool are skipped). `pity`: an Epic or better is guaranteed within
// that many opens of the same crate.
export const CRATES = {
  field: { id: 'field', name: 'Field crate', cost: 100, color: '#8fa0ad', blurb: 'Anything can drop.', pity: 10, weights: { common: 64, rare: 26, epic: 8, legendary: 1.7, mythic: 0.3 } },
  camo: { id: 'camo', name: 'Camo crate', cost: 75, color: '#7d8a4c', blurb: 'Patterns only. Cheap.', weights: { common: 68, rare: 29, epic: 3 },
    pool: ['olive', 'sand', 'slate', 'woodland', 'midnight', 'flecktarn', 'coyote', 'multicam', 'snowcamo', 'nightcamo', 'digital', 'desert', 'splinter', 'tiger', 'arctic', 'zebra', 'leopard', 'topo', 'bubblegum'] },
  elite: { id: 'elite', name: 'Elite crate', cost: 360, color: '#b07cff', blurb: 'No commons.', pity: 10, weights: { rare: 62, epic: 29, legendary: 7.5, mythic: 1.5 } },
  neon: { id: 'neon', name: 'Neon crate', cost: 600, color: '#3ff2ff', blurb: 'Loud colours. Best Mythic odds.', weights: { epic: 78, legendary: 17, mythic: 5 },
    pool: ['hazard', 'graffiti', 'bubblegum', 'tide', 'sakura', 'vaporwave', 'comic', 'pixel', 'koi', 'blueprint', 'royal', 'redline', 'neon', 'circuit', 'toxic', 'frost', 'gilded', 'void', 'lava', 'dragon', 'hexcore', 'aurora', 'inferno', 'hologram', 'prism', 'glitch', 'synthwave', 'plasma'] },
  wild: { id: 'wild', name: 'Wild crate', cost: 125, color: '#d9822b', blurb: 'Stripes, spots and scales.', weights: { common: 58, rare: 32, epic: 8, legendary: 1.7, mythic: 0.3 },
    pool: ['woodland', 'multicam', 'walnut', 'tiger', 'zebra', 'leopard', 'python', 'giraffe', 'sakura', 'crimson', 'koi', 'scrimshaw', 'dragon'] },
  street: { id: 'street', name: 'Street crate', cost: 150, color: '#ff3d7f', blurb: 'Loud paint from the city.', pity: 12, weights: { common: 60, rare: 28, epic: 10, legendary: 1.6, mythic: 0.4 },
    pool: ['brick', 'navy', 'denim', 'racing', 'checker', 'ducttape', 'digital', 'graffiti', 'comic', 'pixel', 'vaporwave', 'terrazzo', 'bubblegum', 'redline', 'blueprint', 'neon', 'glitch', 'synthwave'] },
  winter: { id: 'winter', name: 'Winter crate', cost: 165, color: '#9fd0ea', blurb: 'Cold colours. Frostbite inside.', weights: { common: 55, rare: 33, epic: 9, legendary: 2.3, mythic: 0.7 },
    pool: ['snowcamo', 'slate', 'bone', 'arctic', 'marble', 'glacier', 'tide', 'pearl', 'abyss', 'frost', 'aurora', 'spectre'] },
  forge: { id: 'forge', name: 'Forge crate', cost: 340, color: '#ff7a2a', blurb: 'Metal and fire. No commons.', pity: 10, weights: { rare: 60, epic: 30, legendary: 8, mythic: 2 },
    pool: ['gunmetal', 'carbon', 'kevlar', 'honeycomb', 'damascus', 'patina', 'hazard', 'obsidian', 'meteorite', 'royal', 'gilded', 'lava', 'inferno', 'quicksilver', 'plasma'] },
  cosmic: { id: 'cosmic', name: 'Cosmic crate', cost: 950, color: '#8a5cff', blurb: 'Epic or better. Best Mythic odds.', weights: { epic: 70, legendary: 22, mythic: 8 },
    pool: ['stained', 'vaporwave', 'tide', 'abyss', 'pearl', 'blueprint', 'void', 'nebula', 'aurora', 'prism', 'hologram', 'plasma', 'synthwave', 'glitch'] },
};
export const crateFinishes = (crate) => FINISHES.filter((finish) => !shopOnly(finish.id) && (!crate.pool || crate.pool.includes(finish.id)) && crate.weights[finish.rarity]);
// Rarities that can actually drop, with their weights.
export function crateOdds(crate) {
  const present = new Set(crateFinishes(crate).map((finish) => finish.rarity));
  return Object.entries(crate.weights).filter(([rarity]) => present.has(rarity));
}
export const DAILY_CRATE = { crate: 'field', hours: 20 };
export const DUPLICATE_REFUND = 0.3;
export const SCRAP = 0.4;                 // scrapping pays back this share of a skin's value
export const TRADE_UP = 5;                // this many skins of one rarity make one of the next
export const NEXT_RARITY = { common: 'rare', rare: 'epic', epic: 'legendary', legendary: 'mythic' };
export const EPIC_OR_BETTER = ['epic', 'legendary', 'mythic'];

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

// Plinko: 12 rows of pegs, each bounce left or right. The slot is the number of rights; ~95% back.
export const PLINKO = { rows: 12, multipliers: [26, 6, 2.4, 1.4, 1.1, 0.8, 0.45, 0.8, 1.1, 1.4, 2.4, 6, 26] };
// Higher or lower: cards 1 (ace) to 13 (king), drawn with replacement. A tie loses.
export const CARD_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export function hiloOdds(card, pick) { return pick === 'higher' ? (13 - card) / 13 : (card - 1) / 13; }
export function hiloMultiplier(card, pick) { const odds = hiloOdds(card, pick); return odds > 0 ? Math.floor((0.95 / odds) * 100) / 100 : 0; }
// Crash: the multiplier climbs as e^(rate·t) until the crash point; cash out before it. P(crash ≥ m) = 0.95 / m.
export const CRASH = { rate: 0.12, max: 100, minAuto: 1.01 };
export const crashAt = (seconds) => Math.floor(Math.exp(CRASH.rate * Math.max(0, seconds)) * 100) / 100;
export const crashTime = (multiplier) => Math.log(multiplier) / CRASH.rate;
// An auto cash-out pays when the multiplier gets to it, and crashing exactly there still got there. It
// used to need the crash to be strictly past it, so auto at x5 and a crash at x5 lost the whole stake
// with x5.00 on the screen.
export const autoCashOut = (auto, crash) => (auto && auto <= crash ? auto : null);

export const WAGER = { sizes: [1, 2, 3], minStake: 10, maxStake: 5000 };
export const TRANSFER = { min: 1, max: 100000 };
