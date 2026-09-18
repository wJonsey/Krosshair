// Everything coins can do outside a match. The server rolls every die and checks every balance;
// the browser only animates the answer. Each function returns { error } or a result.
import { randomInt } from 'node:crypto';
import { COSMETICS, WEAPONS } from '../shared/constants.js';
import { COINFLIP, CRATES, DICE, DUPLICATE_REFUND, FINISHES, SLOTS, STAKE, TRANSFER, diceMultiplier, finishInfo, finishPrice, slotsMultiplier } from '../shared/economy.js';

const SKINNABLE = Object.keys(WEAPONS);
const GAME_NAMES = { coinflip: 'Coin flip', dice: 'Dice', slots: 'Slots' };
function weighted(items, weight) {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = randomInt(total);
  for (const item of items) { roll -= weight(item); if (roll < 0) return item; }
  return items[items.length - 1];
}
const wholeCoins = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);

export function buySkin(profiles, token, weapon, finish) {
  const info = finishInfo(finish);
  if (!WEAPONS[weapon] || !info) return { error: 'Not in the shop.' };
  const owned = (profiles.wallet(token).skins[weapon] ||= []);
  if (owned.includes(finish)) return { error: 'Already yours.' };
  if (!profiles.debit(token, finishPrice(finish), 'shop', `${info.name} · ${WEAPONS[weapon].name}`)) return { error: 'Not enough coins.' };
  owned.push(finish);
  return { bought: { weapon, finish } };
}

export function buyGear(profiles, token, kind, id) {
  const item = COSMETICS[kind]?.find((entry) => entry.id === id);
  if (!item?.price) return { error: 'Not in the shop.' };
  const profile = profiles.wallet(token);
  if (profile.owned.includes(`${kind}:${id}`)) return { error: 'Already yours.' };
  if (!profiles.debit(token, item.price, 'shop', item.name)) return { error: 'Not enough coins.' };
  profile.owned.push(`${kind}:${id}`);
  return { bought: { kind, id } };
}

// A random finish for a random gun, rarity by the crate's weights. Duplicates pay part of their price back.
export function openCrate(profiles, token, crateId = 'field') {
  const crate = CRATES[crateId];
  if (!crate) return { error: 'No such crate.' };
  if (!profiles.debit(token, crate.cost, 'crate', crate.name)) return { error: 'Not enough coins.' };
  const rarity = weighted(Object.keys(crate.weights), (id) => Math.round(crate.weights[id] * 100));
  const pool = FINISHES.filter((finish) => finish.rarity === rarity);
  const finish = pool[randomInt(pool.length)].id;
  const weapon = SKINNABLE[randomInt(SKINNABLE.length)];
  const owned = (profiles.wallet(token).skins[weapon] ||= []);
  const duplicate = owned.includes(finish);
  let refund = 0;
  if (duplicate) { refund = Math.floor(finishPrice(finish) * DUPLICATE_REFUND); profiles.credit(token, refund, 'crate', 'Duplicate refund'); } else { owned.push(finish); profiles.scheduleSave(); }
  return { crate: { crate: crate.id, weapon, finish, rarity, duplicate, refund } };
}

// One round of a minigame. The stake and the payout net out into a single wallet entry.
export function playGame(profiles, token, message) {
  const game = message.game;
  if (!GAME_NAMES[game]) return { error: 'No such game.' };
  const stake = wholeCoins(message.stake, STAKE.min, STAKE.max);
  if (!stake) return { error: `Stake ${STAKE.min} to ${STAKE.max} coins.` };
  if (profiles.coins(token) < stake) return { error: 'Not enough coins.' };
  let payout = 0, detail;
  if (game === 'coinflip') {
    const pick = message.pick === 'tails' ? 'tails' : 'heads';
    const side = randomInt(2) ? 'heads' : 'tails';
    if (side === pick) payout = Math.floor(stake * COINFLIP.payout);
    detail = { pick, side };
  } else if (game === 'dice') {
    const target = wholeCoins(message.target, DICE.min, DICE.max);
    if (!target) return { error: `Pick a target from ${DICE.min} to ${DICE.max}.` };
    const roll = randomInt(1, 101);
    if (roll < target) payout = Math.floor(stake * diceMultiplier(target));
    detail = { target, roll };
  } else {
    const reels = [0, 1, 2].map(() => weighted(SLOTS.symbols, (symbol) => symbol.weight).id);
    payout = Math.floor(stake * slotsMultiplier(reels));
    detail = { reels };
  }
  const net = payout - stake;
  if (net < 0) profiles.debit(token, -net, 'game', `${GAME_NAMES[game]} · lost`);
  else if (net > 0) profiles.credit(token, net, 'game', `${GAME_NAMES[game]} · won`);
  return { game: { game, stake, payout, detail } };
}

// Coins to another account, by username. Both sides get a line in their wallet history.
export function sendCoins(profiles, accounts, fromToken, fromName, toName, amountValue) {
  const amount = wholeCoins(amountValue, TRANSFER.min, TRANSFER.max);
  if (!amount) return { error: 'Enter a whole number of coins.' };
  const account = accounts.accounts.get(String(toName || '').toLowerCase());
  if (!account) return { error: 'No pilot with that name.' };
  if (account.profileToken === fromToken) return { error: 'That’s you.' };
  if (!profiles.debit(fromToken, amount, 'send', `Sent to ${account.username}`)) return { error: 'Not enough coins.' };
  profiles.credit(account.profileToken, amount, 'receive', `From ${fromName}`);
  return { sent: { to: account.username, amount }, account };
}
