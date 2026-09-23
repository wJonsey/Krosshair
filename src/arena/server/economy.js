// Everything coins can do outside a match. The server rolls every die and checks every balance;
// the browser only animates the answer. Each function returns { error } or a result.
import { randomInt } from 'node:crypto';
import { COSMETICS, WEAPONS } from '../shared/constants.js';
import { bundleOn, bundlePrice, inShop, itemName, itemPrice, itemSet, ownsItem } from '../shared/itemshop.js';
import { CRASH, COINFLIP, CRATES, PLINKO, crashAt, crashTime, hiloMultiplier, DAILY_CRATE, DICE, DUPLICATE_REFUND, EPIC_OR_BETTER, FINISHES, NEXT_RARITY, SCRAP, SLOTS, TRADE_UP, crateFinishes, crateOdds, STAKE, TRANSFER, diceMultiplier, finishInfo, finishPrice, finishValue, slotsMultiplier, autoCashOut } from '../shared/economy.js';

const SKINNABLE = Object.keys(WEAPONS);
const GAME_NAMES = { coinflip: 'Coin flip', dice: 'Dice', slots: 'Slots', plinko: 'Plinko', hilo: 'Higher or lower', crash: 'Crash' };
const GAME_LOG = 20;
// Every settled bet, newest first, for the Games tab.
function logGame(profiles, token, entry) {
  const profile = profiles.wallet(token);
  profile.gameLog = [{ ...entry, at: Date.now() }, ...(profile.gameLog || [])].slice(0, GAME_LOG);
}
// Settle a bet: stake and payout net out into one wallet entry.
function settleBet(profiles, token, game, stake, payout, note = '') {
  const net = payout - stake;
  if (net < 0) profiles.debit(token, -net, 'game', `${GAME_NAMES[game]} · lost`);
  else if (net > 0) profiles.credit(token, net, 'game', `${GAME_NAMES[game]} · won`);
  logGame(profiles, token, { game, stake, payout, note });
}
function weighted(items, weight) {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = randomInt(total);
  for (const item of items) { roll -= weight(item); if (roll < 0) return item; }
  return items[items.length - 1];
}
const wholeCoins = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);

// A finish is bought once and then goes on every gun.
export function buySkin(profiles, token, finish) {
  const info = finishInfo(finish);
  if (!info || info.rarity === 'dev' || info.shop === 'item') return { error: 'Not in the shop.' };
  const owned = profiles.wallet(token).finishes;
  if (owned.includes(finish)) return { error: 'Already yours.' };
  if (!finishPrice(finish)) return { error: 'Mythics only come from crates.' };
  if (!profiles.debit(token, finishPrice(finish), 'shop', info.name)) return { error: 'Not enough coins.' };
  owned.push(finish);
  return { bought: { finish } };
}

// The Item Shop. The server decides what is on sale today, not the browser: a pilot can only buy a
// piece whose set is standing in the shop on this very day, whatever their client says.
export function buyItemShop(profiles, token, setId, kind, id) {
  const set = itemSet(setId);
  if (!set || !inShop(setId)) return { error: 'That set is not in the shop today.' };
  const profile = profiles.wallet(token);
  const give = (entryKind, entryId) => {
    if (entryKind === 'finish') profile.finishes.push(entryId);
    else profile.owned.push(`${entryKind}:${entryId}`);
  };
  if (kind === 'bundle') {
    // Only the set featured today is sold whole.
    if (!bundleOn(setId)) return { error: 'That set is not sold as a bundle today.' };
    // All or nothing: owning a piece already would make the bundle a worse deal than the pieces.
    if (set.items.some(([entryKind, entryId]) => ownsItem(entryKind, entryId, profile))) return { error: 'You already own part of this set. Buy the rest piece by piece.' };
    if (!profiles.debit(token, bundlePrice(set), 'shop', `${set.name} set`)) return { error: 'Not enough coins.' };
    for (const [entryKind, entryId] of set.items) give(entryKind, entryId);
    return { bought: { set: setId, bundle: true } };
  }
  if (!set.items.some(([entryKind, entryId]) => entryKind === kind && entryId === id)) return { error: 'Not in that set.' };
  if (ownsItem(kind, id, profile)) return { error: 'Already yours.' };
  if (!profiles.debit(token, itemPrice(kind, id), 'shop', itemName(kind, id))) return { error: 'Not enough coins.' };
  give(kind, id);
  return { bought: { set: setId, kind, id } };
}

export function buyGear(profiles, token, kind, id) {
  const item = COSMETICS[kind]?.find((entry) => entry.id === id);
  if (!item?.price || item.shop === 'item') return { error: 'Not in the shop.' };
  const profile = profiles.wallet(token);
  if (profile.owned.includes(`${kind}:${id}`)) return { error: 'Already yours.' };
  if (!profiles.debit(token, item.price, 'shop', item.name)) return { error: 'Not enough coins.' };
  profile.owned.push(`${kind}:${id}`);
  return { bought: { kind, id } };
}

// A skin lands in the inventory; one already owned pays part of its price back instead.
function grant(profiles, token, finish, rarity, weapon) {
  const owned = profiles.wallet(token).finishes;
  const duplicate = owned.includes(finish);
  let refund = 0;
  if (duplicate) { refund = Math.floor(finishValue(finish) * DUPLICATE_REFUND); profiles.credit(token, refund, 'crate', 'Duplicate refund'); } else owned.push(finish);
  profiles.scheduleSave();
  // `weapon` is only what the drop is shown on: the finish itself fits every gun.
  return { weapon, finish, rarity, duplicate, refund };
}
// One drop. With a pity counter, the open that would make it `pity` in a row without an Epic or better
// can only roll Epic or better.
function rollCrate(profiles, token, crate) {
  const profile = profiles.wallet(token);
  profile.pity ||= {};
  let odds = crateOdds(crate);
  const forced = Boolean(crate.pity) && (profile.pity[crate.id] || 0) >= crate.pity - 1;
  if (forced) odds = odds.filter(([rarity]) => EPIC_OR_BETTER.includes(rarity));
  const [rarity] = weighted(odds, ([, weight]) => Math.round(weight * 100));
  if (crate.pity) profile.pity[crate.id] = EPIC_OR_BETTER.includes(rarity) ? 0 : (profile.pity[crate.id] || 0) + 1;
  const choices = crateFinishes(crate).filter((finish) => finish.rarity === rarity);
  const finish = choices[randomInt(choices.length)].id;
  return { ...grant(profiles, token, finish, rarity, SKINNABLE[randomInt(SKINNABLE.length)]), pity: forced };
}
export const dailyWait = (profile) => Math.max(0, (profile.dailyCrate || 0) + DAILY_CRATE.hours * 3600e3 - Date.now());
// count: 1 or 5. free: the daily crate, one field crate every DAILY_CRATE.hours.
export function openCrate(profiles, token, crateId = 'field', count = 1, free = false) {
  const crate = CRATES[crateId];
  if (!crate) return { error: 'No such crate.' };
  count = count === 5 ? 5 : 1;
  const profile = profiles.wallet(token);
  if (free) {
    if (crateId !== DAILY_CRATE.crate || count !== 1) return { error: 'The daily crate is one field crate.' };
    const wait = dailyWait(profile);
    if (wait > 0) return { error: `Next free crate in ${Math.ceil(wait / 3600e3)}h.` };
    profile.dailyCrate = Date.now();
    profiles.logCoins(profile, 0, 'crate', 'Daily crate');
  } else if (!profiles.debit(token, crate.cost * count, 'crate', `${crate.name}${count > 1 ? ` ×${count}` : ''}`)) return { error: 'Not enough coins.' };
  const drops = Array.from({ length: count }, () => rollCrate(profiles, token, crate));
  return { unboxed: { crate: crate.id, free, drops } };
}

// Scrap a skin for part of its price. It comes off the gun if it was on it.
export function scrapSkin(profiles, token, finish) {
  const info = finishInfo(finish);
  const profile = profiles.wallet(token);
  if (!info || !profile.finishes.includes(finish)) return { error: 'You don’t own that.' };
  if (info.shop === 'item') return { error: 'Item Shop skins can’t be scrapped.' };
  profile.finishes = profile.finishes.filter((id) => id !== finish);
  // It comes off every gun that was wearing it.
  for (const [weapon, worn] of Object.entries(profile.look?.skins || {})) if (worn === finish) delete profile.look.skins[weapon];
  const value = Math.floor(finishValue(finish) * SCRAP);
  profiles.credit(token, value, 'scrap', `Scrapped ${info.name}`);
  return { scrapped: { finish, coins: value } };
}

// Five skins of one rarity become one random skin of the next, on one of the five guns.
export function tradeUp(profiles, token, items) {
  if (!Array.isArray(items) || items.length !== TRADE_UP) return { error: `Pick ${TRADE_UP} skins.` };
  const profile = profiles.wallet(token);
  const picked = items.map((item) => String(typeof item === 'string' ? item : item?.finish || ''));
  if (new Set(picked).size !== TRADE_UP) return { error: 'Pick five different skins.' };
  if (!picked.every((finish) => profile.finishes.includes(finish))) return { error: 'You don’t own all of those.' };
  if (picked.some((finish) => finishInfo(finish)?.shop === 'item')) return { error: 'Item Shop skins can’t be traded up.' };
  const rarity = finishInfo(picked[0])?.rarity;
  if (!picked.every((finish) => finishInfo(finish)?.rarity === rarity)) return { error: 'All five must be the same rarity.' };
  const next = NEXT_RARITY[rarity];
  if (!next) return { error: 'Mythic is as high as it goes.' };
  profile.finishes = profile.finishes.filter((id) => !picked.includes(id));
  for (const [weapon, worn] of Object.entries(profile.look?.skins || {})) if (picked.includes(worn)) delete profile.look.skins[weapon];
  const choices = FINISHES.filter((finish) => finish.rarity === next && finish.shop !== 'item');
  const finish = choices[randomInt(choices.length)].id;
  profiles.logCoins(profile, 0, 'trade', `Trade-up: ${finishInfo(finish).name}`);
  return { traded: grant(profiles, token, finish, next, SKINNABLE[randomInt(SKINNABLE.length)]) };
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
  } else if (game === 'plinko') {
    const path = Array.from({ length: PLINKO.rows }, () => randomInt(2));
    const slot = path.reduce((sum, step) => sum + step, 0);
    payout = Math.floor(stake * PLINKO.multipliers[slot]);
    detail = { path, slot };
  } else if (game === 'hilo') {
    // The card on the table is kept on the profile, so it can't be re-dealt by reconnecting.
    const profile = profiles.wallet(token);
    const card = profile.hiloCard || 7;
    const pick = message.pick === 'lower' ? 'lower' : 'higher';
    const multiplier = hiloMultiplier(card, pick);
    if (!multiplier) return { error: pick === 'higher' ? 'Nothing beats a king.' : 'Nothing is lower than an ace.' };
    const next = randomInt(1, 14);
    if (pick === 'higher' ? next > card : next < card) payout = Math.floor(stake * multiplier);
    profile.hiloCard = next;
    detail = { card, next, pick };
  } else if (game === 'slots') {
    const reels = [0, 1, 2].map(() => weighted(SLOTS.symbols, (symbol) => symbol.weight).id);
    payout = Math.floor(stake * slotsMultiplier(reels));
    detail = { reels };
  } else return { error: 'No such game.' };
  settleBet(profiles, token, game, stake, payout);
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

// Crash rounds live on the server: the stake is taken at the start, the crash point is decided then, and
// the round settles itself at the crash (or at the auto cash-out) even if the player's page is gone.
// clock: seconds, the same clock the browser syncs to. notify(token, result) reports a settled round.
const crashRounds = new Map();
export function startCrash(profiles, token, message, clock, notify) {
  if (crashRounds.has(token)) return { error: 'You already have a round going.' };
  const stake = wholeCoins(message.stake, STAKE.min, STAKE.max);
  if (!stake) return { error: `Stake ${STAKE.min} to ${STAKE.max} coins.` };
  const auto = Number.isFinite(message.auto) && message.auto >= CRASH.minAuto ? Math.min(CRASH.max, Math.floor(message.auto * 100) / 100) : null;
  if (!profiles.debit(token, stake, 'game', 'Crash · stake')) return { error: 'Not enough coins.' };
  const roll = randomInt(0, 1e6) / 1e6;
  const crash = Math.min(CRASH.max, Math.max(1, Math.floor((0.95 / (1 - roll)) * 100) / 100));
  const round = { stake, crash, auto, start: clock(), clock, notify, profiles, token };
  const cashes = autoCashOut(auto, crash);
  round.timer = setTimeout(() => finishCrash(round, cashes), crashTime(cashes || crash) * 1000 + 30);
  round.timer.unref?.();
  crashRounds.set(token, round);
  return { crashStarted: { stake, auto, start: round.start } };
}
export function cashOutCrash(token) {
  const round = crashRounds.get(token);
  if (!round) return { error: 'No round going.' };
  const multiplier = crashAt(round.clock() - round.start);
  if (multiplier >= round.crash) return { error: 'Too late.' };
  return { game: finishCrash(round, round.auto ? Math.min(multiplier, round.auto) : multiplier, true) };
}
function finishCrash(round, cashed, direct = false) {
  if (crashRounds.get(round.token) !== round) return null;
  crashRounds.delete(round.token);
  clearTimeout(round.timer);
  const payout = cashed ? Math.floor(round.stake * cashed) : 0;
  // The stake left the wallet at the start; only a cash-out comes back.
  if (payout) round.profiles.credit(round.token, payout, 'game', `Crash · cashed at ×${cashed}`);
  logGame(round.profiles, round.token, { game: 'crash', stake: round.stake, payout, note: cashed ? `×${cashed}` : `crashed ×${round.crash}` });
  const result = { game: 'crash', stake: round.stake, payout, detail: { crash: round.crash, cashed } };
  if (!direct) round.notify(round.token, result);
  return result;
}
// Shutting down mid-round: hand every open stake back rather than lose it.
export function refundCrashes() {
  for (const round of crashRounds.values()) { clearTimeout(round.timer); round.profiles.credit(round.token, round.stake, 'refund', 'Crash · refunded (server restart)'); }
  crashRounds.clear();
}
