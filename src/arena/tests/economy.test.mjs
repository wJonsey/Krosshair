// Coins: earning, the shop, crates, minigames, transfers, cosmetics checks, and wager rooms end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { AccountStore } from '../server/accounts.js';
import { buyGear, buySkin, openCrate, playGame, sendCoins } from '../server/economy.js';
import { Room } from '../server/room.js';
import { COINS, CRATES, SLOTS, finishInfo, finishPrice, killCoins, slotsMultiplier } from '../shared/economy.js';

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
  assert.equal(line(pvp, 'Match') + line(pvp, 'Win') + line(pvp, 'Top kills') + line(pvp, 'Kills'), COINS.finish + COINS.win + COINS.topKills + 8);
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
  assert.match(buySkin(profiles, token, 'm44', 'gilded').error, /Not enough/);
  profiles.credit(token, finishPrice('gilded') + 1000, 'test', 'top up');
  assert.deepEqual(buySkin(profiles, token, 'm44', 'gilded').bought, { weapon: 'm44', finish: 'gilded' });
  assert.match(buySkin(profiles, token, 'm44', 'gilded').error, /Already/);
  assert.match(buySkin(profiles, token, 'raygun', 'gilded').error, /Not in the shop/);
  assert.ok(buyGear(profiles, token, 'headgear', 'beret').bought);
  assert.match(buyGear(profiles, token, 'headgear', 'helmet').error, /Not in the shop/, 'level items are not for sale');
  // Only what you own survives in your look.
  const clean = profiles.sanitizeCosmetics(token, { ...look, headgear: 'beret', face: 'gasmask', skins: { m44: 'gilded', talon: 'void', nope: 'gilded' } });
  assert.equal(clean.headgear, 'beret');
  assert.equal(clean.face, 'visor');
  assert.deepEqual(clean.skins, { m44: 'gilded' });
});

test('crates always cost the same and always give a skin or a refund; elite crates never give commons', async () => {
  const { profiles } = await stores();
  const token = ProfileStore.newToken();
  profiles.credit(token, (CRATES.field.cost + CRATES.elite.cost) * 60, 'test', 'top up');
  let owned = 0;
  for (let i = 0; i < 120; i += 1) {
    const crate = i % 2 ? CRATES.elite : CRATES.field;
    const before = profiles.coins(token);
    const result = openCrate(profiles, token, crate.id).crate;
    assert.equal(profiles.coins(token), before - crate.cost + result.refund);
    assert.equal(finishInfo(result.finish).rarity, result.rarity);
    if (crate.id === 'elite') assert.notEqual(result.rarity, 'common');
    if (!result.duplicate) owned += 1;
  }
  assert.match(openCrate(profiles, token, 'golden').error, /No such crate/);
  const skins = Object.values(profiles.wallet(token).skins).reduce((sum, list) => sum + list.length, 0);
  assert.equal(skins, owned);
  assert.match(openCrate(profiles, token).error || 'ok', /Not enough|ok/);
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
