// Coins: earning, the shop, crates, minigames, transfers, cosmetics checks, and wager rooms end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { AccountStore } from '../server/accounts.js';
import { buyGear, buySkin, cashOutCrash, openCrate, playGame, refundCrashes, scrapSkin, sendCoins, startCrash, tradeUp } from '../server/economy.js';
import { Room } from '../server/room.js';
import { isDev } from '../server/devs.js';
import { COSMETICS, DEFAULT_LOOK, cosmeticUnlocked } from '../shared/constants.js';
import { COINS, CRASH, CRATES, EPIC_OR_BETTER, FINISHES, PLINKO, RARITY, crashAt, hiloMultiplier, SCRAP, SLOTS, crateFinishes, crateOdds, finishInfo, finishPrice, finishValue, killCoins, slotsMultiplier } from '../shared/economy.js';
import { readFileSync } from 'node:fs';

async function stores() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-coins-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const accounts = new AccountStore(path.join(dir, 'accounts.json'));
  await accounts.load();
  return { dir, profiles, accounts };
}
const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const socket = () => { const sent = []; return { readyState: 1, sent, send: (raw) => sent.push(JSON.parse(raw)) }; };

test('accounts start with a few coins; guests have none and earn none', async () => {
  const { profiles } = await stores();
  const pilot = ProfileStore.newToken(), guest = ProfileStore.newToken();
  profiles.holdGuest(guest);
  assert.equal(profiles.coins(pilot), COINS.starter);
  assert.equal(profiles.coins(guest), 0);
  assert.equal(profiles.credit(guest, 100, 'test', 'nope'), false);
  assert.equal(profiles.recordMatch(guest, { won: true, vsHumans: true, topKills: true, coinKills: 10 }).coins, null);
});

test('match coins: wins beat losses, bots are worth less than people, higher levels pay a little more', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  const pvp = profiles.recordMatch(token, { won: true, vsHumans: true, topKills: true, coinKills: killCoins(5, 5) * 4 }).coins;
  const bots = profiles.recordMatch(token, { won: true, vsHumans: false, botKills: 10 }).coins;
  const loss = profiles.recordMatch(token, { won: false, vsHumans: true }).coins;
  // Daily contracts can complete along the way, so compare lines rather than totals.
  const line = (report, label) => report.lines.find((entry) => entry.label === label)?.amount || 0;
  assert.equal(line(pvp, 'Match') + line(pvp, 'Win') + line(pvp, 'Top kills') + line(pvp, 'Kills'), COINS.finish + COINS.win + COINS.topKills + COINS.playerKill * 4);
  assert.ok(line(bots, 'Win') + line(bots, 'Kills') < (line(pvp, 'Win') + line(pvp, 'Kills')) / 2, 'a bot match pays far less');
  assert.equal(line(loss, 'Win'), 0);
  assert.equal(line(loss, 'Match'), COINS.finish);
  assert.ok(killCoins(5, 15) > killCoins(5, 5) && killCoins(5, 5) > killCoins(15, 5));
  assert.ok(killCoins(1, 60) <= COINS.playerKill * (1 + COINS.levelMax));
  // The cap holds whatever happens.
  assert.equal(profiles.recordMatch(token, { won: true, vsHumans: true, topKills: true, coinKills: 500 }).coins.total, COINS.cap);
  assert.equal(profiles.coins(token), COINS.starter + pvp.total + bots.total + loss.total + COINS.cap);
});

test('the shop sells each skin and piece of gear once, and only for coins you have', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  assert.match(buySkin(profiles, token, 'obsidian').error, /Not enough/);
  profiles.credit(token, finishPrice('obsidian') + 1000, 'test', 'top up');
  assert.deepEqual(buySkin(profiles, token, 'obsidian').bought, { finish: 'obsidian' });
  assert.match(buySkin(profiles, token, 'obsidian').error, /Already/);
  assert.match(buySkin(profiles, token, 'notafinish').error, /Not in the shop/);
  profiles.credit(token, 10 ** 6, 'test', 'rich');
  assert.match(buySkin(profiles, token, 'inferno').error, /crates/, 'Mythics are crate-only');
  assert.ok(buyGear(profiles, token, 'headgear', 'beret').bought);
  assert.match(buyGear(profiles, token, 'headgear', 'helmet').error, /Not in the shop/, 'level items are not for sale');
  // Only what you own survives in your look.
  const clean = profiles.sanitizeCosmetics(token, { ...look, headgear: 'beret', face: 'gasmask', skins: { m44: 'obsidian', talon: 'obsidian', wasp: 'void', nope: 'obsidian' } });
  assert.equal(clean.headgear, 'beret');
  assert.equal(clean.face, 'visor');
  // One finish, every gun: both guns keep it, the one that isn't owned goes.
  assert.deepEqual(clean.skins, { m44: 'obsidian', talon: 'obsidian' });
});

test('every crate charges its price, drops only from its own pool, and gives a skin or a refund', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10 ** 6, 'test', 'top up');
  let owned = 0;
  for (const crate of Object.values(CRATES)) {
    const pool = crateFinishes(crate).map((finish) => finish.id);
    for (let i = 0; i < 40; i += 1) {
      const count = i % 4 ? 1 : 5;
      const before = profiles.coins(token);
      const { drops } = openCrate(profiles, token, crate.id, count).unboxed;
      assert.equal(drops.length, count);
      assert.equal(profiles.coins(token), before - crate.cost * count + drops.reduce((sum, drop) => sum + drop.refund, 0));
      for (const drop of drops) {
        assert.ok(pool.includes(drop.finish), `${crate.id} dropped ${drop.finish}`);
        assert.equal(finishInfo(drop.finish).rarity, drop.rarity);
        if (!drop.duplicate) owned += 1;
      }
    }
  }
  assert.equal(profiles.wallet(token).finishes.length, owned);
  assert.match(openCrate(profiles, token, 'golden').error, /No such crate/);
});

test('pity: an Epic or better always lands within ten opens of a crate', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10 ** 6, 'test', 'top up');
  for (const id of ['field', 'elite']) {
    let dry = 0;
    for (let i = 0; i < 300; i += 1) {
      const [drop] = openCrate(profiles, token, id).unboxed.drops;
      dry = EPIC_OR_BETTER.includes(drop.rarity) ? 0 : dry + 1;
      assert.ok(dry < CRATES[id].pity, `${id}: ${dry} opens without an Epic`);
    }
  }
});

test('the daily crate is free once, then waits', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  const before = profiles.coins(token);
  assert.equal(openCrate(profiles, token, 'field', 1, true).unboxed.free, true);
  assert.equal(profiles.coins(token) - before, profiles.wallet(token).coinLog.filter((e) => e.kind === 'crate').reduce((sum, e) => sum + e.amount, 0), 'only duplicate refunds change the balance');
  assert.match(openCrate(profiles, token, 'field', 1, true).error, /Next free crate/);
  assert.match(openCrate(profiles, token, 'elite', 1, true).error, /daily crate/);
  profiles.wallet(token).dailyCrate = Date.now() - 21 * 3600e3;
  assert.ok(openCrate(profiles, token, 'field', 1, true).unboxed);
});

test('scrapping pays part of the price and takes the skin off every gun; trade-ups need five of one rarity', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  const profile = profiles.wallet(token);
  profile.finishes = ['olive', 'sand', 'slate', 'woodland', 'tiger', 'prism'];
  profile.look = { skins: { m44: 'olive', talon: 'olive', wasp: 'sand' } };
  const before = profiles.coins(token);
  assert.equal(scrapSkin(profiles, token, 'olive').scrapped.coins, Math.floor(finishValue('olive') * SCRAP));
  assert.equal(profiles.coins(token), before + Math.floor(finishValue('olive') * SCRAP));
  assert.ok(!profile.finishes.includes('olive'));
  // It comes off both guns that were wearing it, and leaves the others alone.
  assert.equal(profile.look.skins.m44, undefined);
  assert.equal(profile.look.skins.talon, undefined);
  assert.equal(profile.look.skins.wasp, 'sand');
  assert.match(scrapSkin(profiles, token, 'olive').error, /own/);
  const commons = ['sand', 'slate', 'woodland'];
  assert.match(tradeUp(profiles, token, commons).error, /Pick 5/);
  assert.match(tradeUp(profiles, token, [...commons, 'tiger', 'prism']).error, /same rarity/);
  assert.match(tradeUp(profiles, token, [...commons, 'sand', 'slate']).error, /different/);
  profile.finishes.push('midnight', 'bone');
  const five = ['sand', 'slate', 'woodland', 'midnight', 'bone'];
  const { traded } = tradeUp(profiles, token, five);
  assert.equal(traded.rarity, 'rare');
  assert.ok(FINISHES.find((f) => f.id === traded.finish).rarity === 'rare');
  for (const finish of five) assert.ok(!profile.finishes.includes(finish), `${finish} was not used up`);
  profile.finishes.push('aurora', 'inferno', 'hologram', 'neon');
  assert.match(tradeUp(profiles, token, ['prism', 'aurora', 'inferno', 'hologram', 'neon']).error, /Mythic/);
  // Old per-gun inventories fold into one list on the next look at the wallet.
  const legacy = ProfileStore.newToken();
  const old = profiles.get(legacy);
  old.skins = { m44: ['olive', 'sand'], talon: ['olive', 'tiger'] };
  const moved = profiles.wallet(legacy);
  assert.deepEqual([...moved.finishes].sort(), ['olive', 'sand', 'tiger']);
  assert.equal(moved.skins, undefined);
});

test('minigames: stakes are checked, balances never go negative, and the house keeps a little', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  assert.match(playGame(profiles, token, { game: 'dice', stake: 0, target: 50 }).error, /Stake/);
  assert.match(playGame(profiles, token, { game: 'dice', stake: 1.5, target: 50 }).error, /Stake/);
  assert.match(playGame(profiles, token, { game: 'dice', stake: 10, target: 99 }).error, /target/);
  assert.match(playGame(profiles, token, { game: 'coinflip', stake: 500 }).error, /Not enough/);
  assert.match(playGame(profiles, token, { game: 'roulette', stake: 5 }).error, /No such game/);
  for (let i = 0; i < 300 && profiles.coins(token) > 0; i += 1) {
    const before = profiles.coins(token);
    const { game } = playGame(profiles, token, { game: ['coinflip', 'dice', 'slots'][i % 3], stake: 1, target: 50, pick: 'heads' });
    assert.equal(profiles.coins(token), before - game.stake + game.payout);
    assert.ok(profiles.coins(token) >= 0);
  }
  // Slots pay out about 95% on average: worked out from the weights, not sampled.
  const total = SLOTS.symbols.reduce((sum, s) => sum + s.weight, 0);
  let rtp = 0;
  for (const a of SLOTS.symbols) for (const b of SLOTS.symbols) for (const c of SLOTS.symbols) rtp += (a.weight * b.weight * c.weight) / total ** 3 * slotsMultiplier([a.id, b.id, c.id]);
  assert.ok(rtp > 0.9 && rtp < 1, `slots return ${rtp}`);
});

test('coins go to another pilot by username, never to yourself or nobody', async () => {
  const { profiles, accounts } = await stores();
  const a = accounts.discordSignIn({ id: '111111111111111111', username: 'alpha' }).account;
  const b = accounts.discordSignIn({ id: '222222222222222222', username: 'bravo' }).account;
  assert.match(sendCoins(profiles, accounts, a.profileToken, 'alpha', 'alpha', 5).error, /you/);
  assert.match(sendCoins(profiles, accounts, a.profileToken, 'alpha', 'charlie', 5).error, /No pilot/);
  assert.match(sendCoins(profiles, accounts, a.profileToken, 'alpha', 'bravo', 0).error, /whole number/);
  assert.match(sendCoins(profiles, accounts, a.profileToken, 'alpha', 'bravo', 10 ** 5).error, /Not enough/);
  assert.equal(sendCoins(profiles, accounts, a.profileToken, 'alpha', 'BRAVO', 20).sent.to, 'bravo');
  assert.equal(profiles.coins(a.profileToken), COINS.starter - 20);
  assert.equal(profiles.coins(b.profileToken), COINS.starter + 20);
  assert.equal(profiles.wallet(b.profileToken).coinLog[0].note, 'From alpha');
});

function wagerRoom(profiles, size, stake) {
  const room = new Room({ name: `wager-${Math.random().toString(36).slice(2, 6)}`, queue: 'custom', profiles, onEmpty: () => {}, wager: { size, stake } });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  return room;
}
function seat(room, profiles, count) {
  return Array.from({ length: count }, (_, i) => {
    const token = ProfileStore.newToken();
    profiles.credit(token, 200, 'test', 'top up');
    const player = room.join(socket(), { token, session: `s${i}`, name: `P${i}` }, look);
    return player;
  });
}

test('a 2v2 wager: stakes are taken at the start and the winners split the pot', async () => {
  const { profiles } = await stores();
  const room = wagerRoom(profiles, 2, 100);
  const players = seat(room, profiles, 4);
  assert.equal(room.join(socket(), { token: ProfileStore.newToken(), session: 's9', name: 'Late' }, look), null, 'a full wager room turns people away');
  const [host] = players;
  room.handle(host, { type: 'addbot', team: 'A' });
  assert.equal(room.players.size, 4, 'no bots in a wager');
  room.handle(host, { type: 'start' });
  assert.equal(room.phase, 'lobby', 'nobody is ready yet');
  players.forEach((p) => room.handle(p, { type: 'ready', ready: true }));
  const start = players.map((p) => profiles.coins(p.token));
  room.handle(host, { type: 'start' });
  assert.equal(room.phase, 'buy');
  players.forEach((p, i) => assert.equal(profiles.coins(p.token), start[i] - 100));
  assert.ok(players.every((p) => profiles.get(p.token).escrow?.amount === 100));
  const winners = players.filter((p) => p.team === 'A');
  room.scores = { A: room.rules.roundsToWin, B: 1 };
  room.endMatch();
  for (const p of players) {
    const won = p.team === 'A';
    const matchPay = profiles.get(p.token).coinLog.find((entry) => entry.kind === 'match')?.amount || 0;
    assert.equal(profiles.coins(p.token), start[players.indexOf(p)] - 100 + (won ? 200 : 0) + matchPay, `${p.name} ${won ? 'won' : 'lost'}`);
    assert.equal(profiles.get(p.token).escrow, null);
  }
  assert.equal(winners.length, 2);
  room.close();
});

test('wager stakes come back on a draw, when the room closes mid-match, and after a crash', async () => {
  const { profiles } = await stores();
  const draw = wagerRoom(profiles, 1, 50);
  const duel = seat(draw, profiles, 2);
  duel.forEach((p) => draw.handle(p, { type: 'ready', ready: true }));
  draw.handle(duel[0], { type: 'start' });
  draw.scores = { A: 2, B: 2 };
  draw.endMatch();
  duel.forEach((p) => assert.equal(profiles.coins(p.token), COINS.starter + 200 + (profiles.get(p.token).coinLog.find((e) => e.kind === 'match')?.amount || 0)));

  const abandoned = wagerRoom(profiles, 1, 50);
  const pair = seat(abandoned, profiles, 2);
  pair.forEach((p) => abandoned.handle(p, { type: 'ready', ready: true }));
  abandoned.handle(pair[0], { type: 'start' });
  abandoned.close();
  pair.forEach((p) => assert.equal(profiles.coins(p.token), COINS.starter + 200));

  // A process that dies mid-match: the next boot hands the stake back.
  const crashed = wagerRoom(profiles, 1, 75);
  const lost = seat(crashed, profiles, 2);
  lost.forEach((p) => crashed.handle(p, { type: 'ready', ready: true }));
  crashed.handle(lost[0], { type: 'start' });
  clearInterval(crashed.interval);
  profiles.scheduleSave(); profiles.flush();
  const reborn = new ProfileStore(profiles.file);
  await reborn.load();
  lost.forEach((p) => assert.equal(reborn.coins(p.token), COINS.starter + 200));
  assert.ok(JSON.parse(await readFile(profiles.file, 'utf8')));
});

test('a player who cannot cover the stake cannot ready up, and nobody pays if one short', async () => {
  const { profiles } = await stores();
  const room = wagerRoom(profiles, 1, 1000);
  const [a, b] = seat(room, profiles, 2);
  room.handle(a, { type: 'ready', ready: true });
  assert.equal(a.ready, false);
  profiles.credit(a.token, 1000, 'test', 'rich');
  profiles.credit(b.token, 1000, 'test', 'rich');
  room.handle(a, { type: 'ready', ready: true }); room.handle(b, { type: 'ready', ready: true });
  profiles.debit(b.token, profiles.coins(b.token) - 10, 'test', 'spent it'); // spends it after readying
  const before = profiles.coins(a.token);
  room.handle(a, { type: 'start' });
  assert.equal(room.phase, 'lobby');
  assert.equal(profiles.coins(a.token), before, 'the one who could pay was refunded');
  room.close();
});

test('skins: buying outright costs far more than a crate, and no crate pays back more than it costs when scrapped', () => {
  for (const [id, rarity] of Object.entries(RARITY)) if (rarity.price) assert.ok(rarity.price >= CRATES.field.cost * 10, `${id} is too cheap to buy`);
  for (const crate of Object.values(CRATES)) {
    const odds = crateOdds(crate), total = odds.reduce((sum, [, w]) => sum + w, 0);
    const scrapBack = odds.reduce((sum, [rarity, w]) => sum + (w / total) * RARITY[rarity].value * SCRAP, 0);
    assert.ok(scrapBack < crate.cost * 0.6, `${crate.id}: scrapping pays ${scrapBack.toFixed(0)} of ${crate.cost}`);
    assert.ok(crateFinishes(crate).length > 0);
  }
});

test('every finish has a painter, and exactly the Mythics and the Dev class are animated', () => {
  const source = readFileSync(new URL('../client/skins.js', import.meta.url), 'utf8');
  const art = source.slice(source.indexOf('const FINISH_ART = {'), source.indexOf('\n};', source.indexOf('const FINISH_ART = {')));
  const entries = Object.fromEntries(art.split(/\n  (?=[a-z]+: \{)/).slice(1).map((chunk) => [chunk.match(/^([a-z]+):/)[1], /shader: '/.test(chunk)]));
  for (const finish of FINISHES) {
    assert.ok(finish.id in entries, `${finish.id} has no painter`);
    assert.equal(entries[finish.id], finish.rarity === 'mythic' || finish.rarity === 'dev', `${finish.id} (${finish.rarity}) ${entries[finish.id] ? 'animates' : 'does not animate'}`);
  }
});

test('plinko and higher-or-lower pay what their tables say, and every bet lands in the history', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10 ** 5, 'test', 'top up');
  for (let i = 0; i < 60; i += 1) {
    const { game } = playGame(profiles, token, { game: 'plinko', stake: 10 });
    assert.equal(game.detail.path.length, PLINKO.rows);
    assert.equal(game.detail.slot, game.detail.path.reduce((a, b) => a + b, 0));
    assert.equal(game.payout, Math.floor(10 * PLINKO.multipliers[game.detail.slot]));
  }
  for (let i = 0; i < 60; i += 1) {
    const card = profiles.wallet(token).hiloCard || 7;
    const pickId = card >= 7 ? 'lower' : 'higher';
    const { game } = playGame(profiles, token, { game: 'hilo', stake: 10, pick: pickId });
    assert.equal(game.detail.card, card);
    const won = pickId === 'higher' ? game.detail.next > card : game.detail.next < card;
    assert.equal(game.payout, won ? Math.floor(10 * hiloMultiplier(card, pickId)) : 0);
    assert.equal(profiles.wallet(token).hiloCard, game.detail.next, 'the next card stays on the table');
  }
  profiles.wallet(token).hiloCard = 13;
  assert.match(playGame(profiles, token, { game: 'hilo', stake: 10, pick: 'higher' }).error, /king/);
  assert.equal(profiles.wallet(token).gameLog.length, 20);
  const stats = profiles.wallet(token).coinStats;
  assert.ok(stats.in.game > 0 && stats.out.game > 0, 'games show up in the wallet breakdown');
});

test('crash: cash out before the crash to win, the round settles itself if nobody does, and restarts refund', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10 ** 5, 'test', 'top up');
  let clock = 0;
  const settledRounds = [];
  const notify = (who, result) => settledRounds.push(result);
  for (let i = 0; i < 40; i += 1) {
    const before = profiles.coins(token);
    assert.ok(startCrash(profiles, token, { stake: 100 }, () => clock, notify).crashStarted);
    assert.equal(profiles.coins(token), before - 100, 'the stake is taken at the start');
    assert.match(startCrash(profiles, token, { stake: 100 }, () => clock, notify).error, /already/);
    clock += 0.05; // cash out almost straight away: ×1.00 unless it crashed on the spot
    const out = cashOutCrash(token);
    if (out.game) { assert.equal(out.game.payout, Math.floor(100 * crashAt(0.05))); assert.ok(out.game.detail.crash > out.game.detail.cashed); }
    else { assert.match(out.error, /late|No round/); refundCrashes(); }
  }
  // Auto cash-out settles on the server's own timer.
  const before = profiles.coins(token);
  startCrash(profiles, token, { stake: 100, auto: 1.01 }, () => clock, notify);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const last = settledRounds.at(-1);
  if (last.detail.cashed) assert.equal(profiles.coins(token), before - 100 + Math.floor(100 * 1.01));
  else assert.equal(profiles.coins(token), before - 100, 'crashed before ×1.01');
  // A restart mid-round gives the stake back.
  clock = 0;
  const held = profiles.coins(token);
  startCrash(profiles, token, { stake: 100 }, () => clock, notify);
  refundCrashes();
  assert.equal(profiles.coins(token), held);
  assert.ok(CRASH.max >= 100);
});

// ---- the Dev class
test('only the developers\' Discord accounts are devs, never a lookalike name', () => {
  assert.ok(isDev({ discordId: '794250832064938015', discordName: 'gking09' }));
  assert.ok(isDev({ discordId: '123456789012', discordName: 'wjonsey' }));
  assert.ok(isDev({ discordId: '123456789012', discordName: 'WJonsey' }));
  assert.ok(!isDev({ discordId: '123456789012', discordName: 'wjonsey2' }));
  assert.ok(!isDev({ username: 'Gking09', discordName: null }), 'a password account with the same name');
  assert.ok(!isDev({ username: 'wjonsey' }));
  assert.ok(!isDev(null));
});

test('no two cosmetics share an id, so a dev item can never shadow a real one', () => {
  for (const [kind, items] of Object.entries(COSMETICS)) {
    const ids = items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${kind} has a repeated id`);
  }
});

test('dev items: devs wear them, nobody else can, and nothing sells, drops or trades them', async () => {
  const { profiles } = await stores();
  const dev = ProfileStore.newToken(), pilot = ProfileStore.newToken();
  profiles.setDev(dev, true);
  profiles.credit(pilot, 10 ** 6, 'test', 'top up');
  const devLook = { ...look, title: 'Developer', headgear: 'devhalo', face: 'devmask', pack: 'devwings', pattern: 'devcircuit', charm: 'devcore', tracer: 'devprism', skins: { m44: 'devsource', p9: 'singularity', knife: 'overclock' } };
  const worn = profiles.sanitizeCosmetics(dev, devLook);
  for (const key of ['title', 'headgear', 'face', 'pack', 'pattern', 'charm', 'tracer']) assert.equal(worn[key], devLook[key], `dev lost ${key}`);
  assert.deepEqual(worn.skins, devLook.skins);
  const stripped = profiles.sanitizeCosmetics(pilot, devLook);
  for (const key of ['title', 'headgear', 'face', 'pack', 'pattern', 'charm', 'tracer']) assert.equal(stripped[key], DEFAULT_LOOK[key], `a pilot kept ${key}`);
  assert.deepEqual(stripped.skins, {});
  assert.equal(profiles.view(dev).dev, true);
  assert.equal(profiles.view(pilot).dev, false);
  // Losing dev (a different account on that profile) takes it all away again.
  profiles.setDev(dev, false);
  assert.equal(profiles.sanitizeCosmetics(dev, devLook).headgear, DEFAULT_LOOK.headgear);
  // Not in the shop, not in any crate, not out of a trade-up.
  const devFinishes = FINISHES.filter((finish) => finish.rarity === 'dev');
  assert.ok(devFinishes.length >= 3, 'the dev class has its own finishes');
  for (const finish of devFinishes) assert.ok(buySkin(profiles, pilot, 'm44', finish.id).error);
  for (const [kind, items] of Object.entries(COSMETICS)) for (const item of items.filter((entry) => entry.dev)) {
    assert.ok(buyGear(profiles, pilot, kind, item.id).error, `${kind}:${item.id} was for sale`);
    assert.ok(!cosmeticUnlocked(kind, item.id, 999, [`${kind}:${item.id}`]), `${kind}:${item.id} unlocked without dev`);
  }
  for (const crate of Object.values(CRATES)) assert.ok(!crateFinishes(crate).some((finish) => finish.rarity === 'dev'), `${crate.id} can drop a dev finish`);
  for (let i = 0; i < 400; i += 1) { const { unboxed } = openCrate(profiles, pilot, 'field', 5); assert.ok(unboxed.drops.every((drop) => drop.rarity !== 'dev')); }
});

test('every crate has a model style, every charm a maker, every gear option a model', () => {
  const crates = readFileSync(new URL('../client/cratebox.js', import.meta.url), 'utf8');
  for (const id of Object.keys(CRATES)) assert.match(crates, new RegExp(`\\n  ${id}: \\{`), `${id} crate has no style`);
  const charms = readFileSync(new URL('../client/charms.js', import.meta.url), 'utf8');
  for (const item of COSMETICS.charm) if (item.id !== 'none') assert.match(charms, new RegExp(`\\n  ${item.id}: \\(`), `${item.id} charm has no maker`);
  const operator = readFileSync(new URL('../client/operator.js', import.meta.url), 'utf8');
  for (const [kind, map] of [['headgear', 'headgear'], ['face', 'faces']]) for (const item of COSMETICS[kind]) assert.ok(operator.includes(`option(${map}, '${item.id}'`), `${kind} ${item.id} has no model`);
  for (const item of COSMETICS.pack) assert.ok(operator.includes(`packGroup('${item.id}')`), `pack ${item.id} has no model`);
  const skins = readFileSync(new URL('../client/skins.js', import.meta.url), 'utf8');
  const patterns = skins.slice(skins.indexOf('const PATTERN_ART = {'), skins.indexOf('\n};', skins.indexOf('const PATTERN_ART = {')));
  for (const item of COSMETICS.pattern) if (item.id !== 'solid') assert.match(patterns, new RegExp(`\\n  ${item.id}: `), `${item.id} pattern has no painter`);
});
