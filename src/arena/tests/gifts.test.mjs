// The developers' terminal and the presents it sends: only devs can use it, everything is checked on
// the server, a gift to everyone waits for a second word, and nothing unreleased is ever named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ProfileStore } from '../server/profiles.js';
import { createDevConsole } from '../server/gifts.js';
import { ALL_SETS, installCatalogue } from '../server/itemsets.js';
import { COSMETICS, cosmeticUnlocked, dateKey, levelFromXp } from '../shared/constants.js';
import { finishInfo } from '../shared/economy.js';
import { findGift, giftAmount, tokenize } from '../shared/gifts.js';

installCatalogue();

async function setup(names = ['Nin', 'Gking09', 'Rook']) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-gifts-')), 'profiles.json'));
  const accounts = { accounts: new Map() };
  for (const name of names) {
    const account = { username: name, profileToken: ProfileStore.newToken() };
    accounts.accounts.set(name.toLowerCase(), account);
    profiles.wallet(account.profileToken).name = name;
  }
  profiles.get(accounts.accounts.get('gking09').profileToken).dev = true;
  const delivered = [];
  const online = new Set(['Nin']);
  const logged = [];
  const cli = createDevConsole({
    profiles, accounts,
    online: () => [...online],
    deliver: (token) => { delivered.push(token); return [...online].some((name) => accounts.accounts.get(name.toLowerCase()).profileToken === token); },
    log: (text) => logged.push(text),
  });
  const token = (name) => accounts.accounts.get(name.toLowerCase()).profileToken;
  const text = (lines) => lines.map((line) => line.text).join('\n');
  return { profiles, accounts, cli, token, delivered, online, logged, text };
}

test('coins, a note, and the present waiting to be opened', async () => {
  const { profiles, cli, token, delivered, text } = await setup();
  const before = profiles.coins(token('Nin'));
  const out = cli.run('Gking09', '/give nin coins 5k "Thanks for the launcher idea"');
  assert.match(text(out), /Sent 5,000 coins to Nin/);
  assert.equal(profiles.coins(token('Nin')), before + 5000, 'the coins were not given');
  const [gift] = profiles.gifts(token('Nin'));
  assert.equal(gift.from, 'Gking09');
  assert.equal(gift.message, 'Thanks for the launcher idea');
  assert.deepEqual(gift.items, [{ kind: 'coins', amount: 5000 }]);
  assert.ok(delivered.includes(token('Nin')), 'the pilot was never told');
  // Opening it takes it off the pile and gives nothing twice.
  assert.ok(profiles.openGift(token('Nin'), gift.id));
  assert.equal(profiles.gifts(token('Nin')).length, 0);
  assert.equal(profiles.coins(token('Nin')), before + 5000);
  assert.equal(profiles.openGift(token('Nin'), gift.id), false);
});

test('several things in one gift, found by name, by id, and with or without a plus', async () => {
  const { profiles, cli, token, text } = await setup();
  const out = cli.run('Gking09', '/give rook skin olivedrab + suit voidblack xp 2000 crate neon 3 nice one');
  assert.match(text(out), /Sent/, text(out));
  const profile = profiles.get(token('Rook'));
  assert.ok(profile.finishes.includes('olive'), 'skin by its name');
  assert.ok(profile.owned.includes('suit:#0b0b0e'), 'suit by its name, not its colour code');
  assert.equal(profile.xp, 2000);
  const [gift] = profile.gifts;
  assert.equal(gift.message, 'nice one');
  assert.equal(gift.items.filter((item) => item.crate === 'Neon crate').length, 3, 'three crates, three drops');
  for (const drop of gift.items.filter((item) => item.crate)) assert.ok(finishInfo(drop.id), `crate dropped ${drop.id}`);
});

test('a level-locked cosmetic that was given is unlocked', async () => {
  const { profiles, cli, token } = await setup();
  const locked = COSMETICS.suit.find((item) => item.level > 1 && !item.price && !item.dev);
  const profile = profiles.get(token('Nin'));
  assert.equal(cosmeticUnlocked('suit', locked.id, levelFromXp(profile.xp), profile.owned), false);
  cli.run('Gking09', `/give nin suit "${locked.name}"`);
  assert.equal(cosmeticUnlocked('suit', locked.id, levelFromXp(profile.xp), profile.owned), true, 'given, and still locked');
});

test('a gift to everyone waits for /confirm, and /cancel drops it', async () => {
  const { profiles, cli, token, text } = await setup();
  const before = profiles.coins(token('Rook'));
  const held = cli.run('Gking09', '/give all coins 100');
  assert.match(text(held), /3 pilots/);
  assert.match(text(held), /confirm/);
  assert.equal(profiles.coins(token('Rook')), before, 'paid before anyone confirmed');
  assert.match(text(cli.run('Gking09', '/cancel')), /Dropped/);
  assert.match(text(cli.run('Gking09', '/confirm')), /Nothing waiting/);
  assert.equal(profiles.coins(token('Rook')), before);
  cli.run('Gking09', '/give all coins 100');
  assert.match(text(cli.run('Gking09', '/confirm')), /Sent 100 coins to 3 pilots/);
  for (const name of ['Nin', 'Gking09', 'Rook']) assert.equal(profiles.gifts(token(name)).length, 1, `${name} got nothing`);
  assert.equal(profiles.coins(token('Rook')), before + 100);
  // Anything else typed in between drops the wait: a stray /confirm later must not fire it.
  cli.run('Gking09', '/give all coins 100');
  cli.run('Gking09', '/who nin');
  assert.match(text(cli.run('Gking09', '/confirm')), /Nothing waiting/);
});

test('online means everyone signed in right now, and nobody else', async () => {
  const { profiles, cli, token } = await setup();
  cli.run('Gking09', '/give online xp 50');
  cli.run('Gking09', '/confirm');
  assert.equal(profiles.get(token('Nin')).xp, 50);
  assert.equal(profiles.get(token('Rook')).xp, 0);
});

test('dev things only ever go to devs', async () => {
  const { profiles, cli, token, text } = await setup();
  assert.match(text(cli.run('Gking09', '/give nin skin devnull')), /dev only/);
  assert.ok(!profiles.get(token('Nin')).finishes.includes('devnull'));
  cli.run('Gking09', '/give all skin devnull');
  assert.match(text(cli.run('Gking09', '/confirm')), /Nothing waiting|dev only/);
  assert.match(text(cli.run('Gking09', '/give gking09 skin devnull')), /Sent/);
});

test('mistakes are answered, not guessed at', async () => {
  const { cli, text } = await setup();
  assert.match(text(cli.run('Gking09', '/give nobody coins 5')), /No account called nobody/);
  assert.match(text(cli.run('Gking09', '/give nin coins lots')), /How much/);
  assert.match(text(cli.run('Gking09', '/give nin coins 2000000')), /most in one gift/);
  assert.match(text(cli.run('Gking09', '/give nin skin zzzz')), /No skin called zzzz/);
  assert.match(text(cli.run('Gking09', '/give nin crate neon 50')), /1 to 10 crates/);
  assert.match(text(cli.run('Gking09', '/give nin')), /\/give/);
  assert.match(text(cli.run('Gking09', '/fly')), /No command fly/);
  assert.equal(giftAmount('1.5m'), 1500000);
  assert.equal(giftAmount('10,000'), 10000);
  assert.equal(giftAmount('-5'), null);
  assert.deepEqual(tokenize('give nin "two words" x').map((t) => t.text), ['give', 'nin', 'two words', 'x']);
});

test('an Item Shop set that has not landed does not exist here, even to a dev', async () => {
  const { cli, text } = await setup();
  const today = dateKey();
  const secret = ALL_SETS.find((set) => set.debut > today);
  if (!secret) return;   // every set is out: nothing left to keep
  const [kind, id] = secret.items[0];
  const giftKindOf = kind === 'finish' ? 'skin' : kind;
  const name = kind === 'finish' ? finishInfo(id).name : COSMETICS[kind].find((item) => item.id === id).name;
  assert.match(text(cli.run('Gking09', `/give nin ${giftKindOf} "${name}"`)), /No /, 'an unreleased piece was given');
  assert.ok(!text(cli.run('Gking09', `/items ${giftKindOf}`)).includes(name), 'an unreleased name was listed');
  // The shared finder still knows it, which is why the server passes its own filter.
  assert.ok(findGift(giftKindOf, id).item);
});

test('only a dev can run the terminal, and every message it sends is heard', () => {
  const server = readFileSync(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  assert.match(server, /function handleDevCommand[\s\S]{0,200}profiles\.get\(socket\.token\)\.dev/, 'the terminal no longer checks the account');
  const client = ['terminal.js', 'gift.js'].map((file) => readFileSync(new URL(`../client/${file}`, import.meta.url), 'utf8')).join('\n');
  for (const type of ['dev-cmd', 'dev-names', 'gifts']) assert.match(client, new RegExp(`net\\.on\\('${type}'`), `nothing listens for ${type}`);
});
