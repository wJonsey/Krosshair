// The Item Shop: the same four sets for everyone on a given day, nothing sold off-day, nothing
// unreleased leaked, and no other route to an exclusive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ProfileStore } from '../server/profiles.js';
import { buyItemShop, buySkin, scrapSkin, tradeUp } from '../server/economy.js';
import { CRATES, FINISHES, crateFinishes, finishInfo } from '../shared/economy.js';
import { COSMETICS, cosmeticUnlocked } from '../shared/constants.js';
import { ALL_SETS as ITEM_SETS, EXCLUSIVE_COSMETICS, EXCLUSIVE_FINISHES, installCatalogue, publicCatalogue } from '../server/itemsets.js';
import { SHOP_SETS_PER_DAY, knownSets, bundleOn, bundlePrice, bundleSet, inShop, itemPrice, lastSeen, released, runway, seenLine, setValue, shopFor } from '../shared/itemshop.js';

// The catalogue lives server side now, so a test installs it the way the server does at boot.
installCatalogue();

const store = async () => new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-items-')), 'profiles.json'));
const dayAfter = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

test('every day deals the same four sets to everyone, and only released ones', () => {
  for (let i = 0; i < 120; i += 1) {
    const key = dayAfter('2026-03-01', i * 3);
    const sets = shopFor(key);
    assert.deepEqual(sets.map((set) => set.id), shopFor(key).map((set) => set.id), `${key} is not stable`);
    assert.ok(sets.length <= SHOP_SETS_PER_DAY, `${key} put out ${sets.length} sets`);
    for (const set of sets) assert.ok(released(set, key), `${key} sold ${set.name} before its debut`);
    assert.equal(new Set(sets.map((s) => s.id)).size, sets.length, `${key} listed a set twice`);
  }
});

test('a set is always in the shop on its own debut day, and gets back round in a season', () => {
  for (const set of ITEM_SETS) assert.ok(inShop(set.id, set.debut), `${set.name} missed its own launch`);
  // Over a long enough run every released set comes back, so nothing is stranded forever.
  const year = dayAfter('2026-08-04', 200);
  for (const set of ITEM_SETS.filter((s) => released(s, '2026-08-04'))) {
    assert.ok(lastSeen(set.id, year), `${set.name} never came back`);
  }
});

// A day part way through the run, so some sets are out and some are still to come.
const midSeason = () => { const days = ITEM_SETS.map((set) => set.debut).sort(); return days[Math.floor(days.length / 2)]; };

test('nothing unreleased leaves the server, in the catalogue a client is sent', () => {
  const key = midSeason();
  const out = publicCatalogue(key);
  const secret = ITEM_SETS.filter((set) => set.debut > key);
  assert.ok(secret.length >= 3, 'no secret sets left to test');
  const wire = JSON.stringify(out);
  for (const set of secret) {
    assert.ok(!out.sets.some((s) => s.id === set.id), `${set.name} was sent to the client`);
    assert.ok(!wire.includes(set.name), `${set.name} is named in the client payload`);
    for (const [kind, id] of set.items) assert.ok(!wire.includes(`"${id}"`), `${kind}:${id} is in the client payload`);
  }
  // And a released set is sent, with the pieces the wall needs to draw it.
  const shown = out.sets[0];
  assert.ok(shown && out.finishes.length, 'nothing public was sent');
  for (const [kind, id] of shown.items) assert.ok(wire.includes(id), `${kind}:${id} missing from the payload`);
});

test('nothing unreleased is named anywhere a pilot can look', () => {
  const key = midSeason();
  const future = ITEM_SETS.filter((set) => !released(set, key));
  assert.ok(future.length >= 3, 'no secret sets left to test');
  for (const set of future) {
    assert.ok(!inShop(set.id, key));
    assert.equal(lastSeen(set.id, key), null, `${set.name} has a last seen date before it launched`);
    for (const [kind, id] of set.items) assert.equal(seenLine(kind, id, key), null, `${kind}:${id} leaked`);
  }
  // And a released one does answer, so the skins wall can grey it out and say when.
  const out = ITEM_SETS.find((set) => released(set, key));
  for (const [kind, id] of out.items) assert.ok(seenLine(kind, id, key), `${kind}:${id} should be public`);
});

test('a bundle always beats buying the set piece by piece', () => {
  for (const set of ITEM_SETS) {
    assert.ok(bundlePrice(set) < setValue(set), `${set.name} bundle is not a saving`);
    for (const [kind, id] of set.items) assert.ok(itemPrice(kind, id) > 0, `${kind}:${id} has no price`);
  }
});

test('exclusives have no other way in: no crate, no trade-up, no shelf, no scrap', async () => {
  const exclusive = FINISHES.filter((finish) => finish.shop === 'item');
  assert.ok(exclusive.length >= 20, `only ${exclusive.length} exclusives`);
  for (const crate of Object.values(CRATES)) {
    assert.equal(crateFinishes(crate).filter((finish) => finish.shop === 'item').length, 0, 'a crate can drop an exclusive');
  }
  const profiles = await store();
  const token = ProfileStore.newToken();
  const profile = profiles.wallet(token);
  profiles.credit(token, 999999, 'test', 'test');
  // The normal shelf refuses one.
  assert.ok(buySkin(profiles, token, exclusive[0].id).error, 'the normal shop sold an exclusive');
  // Owning one, it cannot be scrapped or fed to a trade-up.
  profile.finishes.push(exclusive[0].id);
  assert.ok(scrapSkin(profiles, token, exclusive[0].id).error, 'an exclusive was scrapped');
  const five = exclusive.filter((finish) => finish.rarity === exclusive[0].rarity).slice(0, 5).map((finish) => finish.id);
  for (const id of five) if (!profile.finishes.includes(id)) profile.finishes.push(id);
  if (five.length === 5) assert.ok(tradeUp(profiles, token, five).error, 'an exclusive was traded up');
});

test('the shop sells only what is out today, and only one bundle a day', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  profiles.credit(token, 999999, 'test', 'test');
  // The shop is empty until the first set lands, so this runs on a day it is open.
  const day = ITEM_SETS.map((set) => set.debut).sort()[0];
  const sets = shopFor(day);
  assert.ok(sets.length, 'the shop never opens');
  // Exactly one set is sold whole on any given day.
  for (let i = 0; i < 60; i += 1) {
    const key = dayAfter(day, i * 5);
    const open = shopFor(key);
    if (!open.length) continue;
    assert.equal(open.filter((set) => bundleOn(set.id, key)).length, 1, `${key} sold ${open.filter((set) => bundleOn(set.id, key)).length} bundles`);
    assert.ok(open.some((set) => set.id === bundleSet(key).id), `${key} featured a set that is not out`);
  }
  const shut = ITEM_SETS.find((set) => !inShop(set.id));
  if (shut) assert.ok(buyItemShop(profiles, token, shut.id, ...shut.items[0]).error, 'sold a set that is not out today');
});

test('the runway says how long the shop can run before it needs more sets', () => {
  const now = runway('2026-09-20');
  assert.equal(now.left, ITEM_SETS.length, 'some sets have already landed');
  assert.equal(now.last, ITEM_SETS.map((set) => set.debut).sort().pop());
  assert.equal(now.days, Math.round((Date.parse(now.last) - Date.parse('2026-09-20')) / 86400000), 'the runway is not the days to the last debut');
  // Past the last debut there is nothing new left to land.
  assert.equal(runway(dayAfter(now.last, 10)).days, 0);
  assert.equal(runway(dayAfter(now.last, 10)).left, 0);
});

test('nothing is in the shop until the first set lands', () => {
  const first = ITEM_SETS.map((set) => set.debut).sort()[0];
  assert.equal(shopFor(dayAfter(first, -1)).length, 0, 'the shop was open before its first set');
  assert.ok(shopFor(first).length, 'the first set did not open the shop');
});

test('an item shop cosmetic is worn only by owning it, never by levelling', () => {
  const exclusive = Object.entries(COSMETICS).flatMap(([kind, list]) => list.filter((item) => item.shop === 'item').map((item) => [kind, item]));
  assert.ok(exclusive.length >= 15, `only ${exclusive.length} exclusive cosmetics`);
  for (const [kind, item] of exclusive) {
    assert.ok(!item.price, `${kind}:${item.id} has a shelf price`);
    assert.equal(cosmeticUnlocked(kind, item.id, 99, [], false), false, `${kind}:${item.id} unlocked by level`);
    assert.equal(cosmeticUnlocked(kind, item.id, 1, [`${kind}:${item.id}`], false), true, `${kind}:${item.id} cannot be worn when owned`);
  }
});

test('finish ids are unique, so an exclusive never shadows a shelf skin', () => {
  const ids = FINISHES.map((finish) => finish.id);
  assert.equal(new Set(ids).size, ids.length, 'two finishes share an id');
  for (const set of ITEM_SETS) for (const [kind, id] of set.items) {
    if (kind === 'finish') assert.equal(finishInfo(id)?.shop, 'item', `${id} is in a set but not flagged`);
    else assert.ok(COSMETICS[kind]?.some((item) => item.id === id && item.shop === 'item'), `${kind}:${id} is in a set but not flagged`);
  }
});

// The exclusives left the shared bundle, so the coverage that used to run over FINISHES no longer sees
// them. It runs here instead, where the catalogue is installed.
test('every exclusive has its art, and none of them animate', () => {
  const read = (file) => readFileSync(new URL(`../client/${file}`, import.meta.url), 'utf8');
  const skins = read('skins.js');
  const art = skins.slice(skins.indexOf('const FINISH_ART = {'), skins.indexOf('\n};', skins.indexOf('const FINISH_ART = {')));
  const entries = Object.fromEntries(art.split(/\n {2}(?=[a-z]+: \{)/).slice(1).map((chunk) => [chunk.match(/^([a-z]+):/)[1], /shader: '/.test(chunk)]));
  for (const finish of EXCLUSIVE_FINISHES) {
    assert.ok(finish.id in entries, `${finish.id} has no painter`);
    assert.equal(entries[finish.id], false, `${finish.id} animates, but only Mythics and the Dev class do`);
  }
  const operator = read('operator.js'), charms = read('charms.js');
  for (const [kind, items] of Object.entries(EXCLUSIVE_COSMETICS)) {
    for (const item of items) {
      if (kind === 'charm') assert.match(charms, new RegExp(`\\n  ${item.id}: \\(`), `charm ${item.id} has no maker`);
      else if (kind === 'headgear' || kind === 'face') assert.ok(operator.includes(`'${item.id}'`), `${kind} ${item.id} has no model`);
      else if (kind === 'pack') assert.ok(operator.includes(`packGroup('${item.id}')`), `pack ${item.id} has no model`);
      else if (kind === 'pattern') assert.ok(read('skins.js').includes(`${item.id}:`), `pattern ${item.id} has no painter`);
    }
  }
});

// The shop turns over at midnight, but the page only ever worked out what to show when it was drawn and
// the countdown was written once and then left. Left open, it sat on yesterday's four sets with a frozen
// clock; the only way to a new day's shop was a reload.
test('the shop deals a different hand once there is more than one set to deal', () => {
  // Far enough in that plenty have landed. Early on there is only one set out and the shop shows it
  // every day: that is the release schedule doing its job, not the rotation failing.
  const from = '2027-03-01';
  assert.ok(knownSets(from).length > SHOP_SETS_PER_DAY, `only ${knownSets(from).length} sets out by ${from}, so nothing could rotate`);
  const first = shopFor(from).map((set) => set.id).join(',');
  let moved = false;
  for (let i = 1; i <= 14 && !moved; i += 1) moved = shopFor(dayAfter(from, i)).map((set) => set.id).join(',') !== first;
  assert.ok(moved, 'a fortnight of days all dealt the same sets');
});

// With one set out the shop can only show that set, and for three months after launch there was only
// one: the next debut was in December, so the shop looked broken every day. It launches a week of sets
// one a day, then keeps the gaps short.
test('one set released means one set in the shop, until the next lands', () => {
  const [only, next] = ITEM_SETS.map((set) => set.debut).sort();
  assert.equal(knownSets(only).length, 1, 'the first day should have exactly the first set');
  for (let key = only; key < next; key = dayAfter(key, 1)) assert.equal(shopFor(key).length, 1, `${key} showed a set that had not landed`);
  assert.equal(shopFor(next).length, 2, 'the second set did not join the first');
});

test('the schedule never leaves the shop stuck on the same few sets', () => {
  const days = ITEM_SETS.map((set) => set.debut).sort();
  for (let i = 1; i < days.length; i += 1) {
    const gap = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000;
    assert.ok(gap >= 1, `two sets debut on ${days[i]}, so that day holds more than one launch`);
    assert.ok(gap <= 14, `${gap} days with nothing new between ${days[i - 1]} and ${days[i]}`);
  }
  // Once enough are out to fill the shelf and more, the hand changes: never the same three days running.
  const full = days[SHOP_SETS_PER_DAY];
  const hand = (key) => shopFor(key).map((set) => set.id).sort().join();
  for (let i = 0; i < 120; i += 1) {
    const key = dayAfter(full, i);
    assert.ok(!(hand(key) === hand(dayAfter(key, 1)) && hand(key) === hand(dayAfter(key, 2))), `the shop sat still from ${key}`);
  }
});

test('the page notices midnight instead of waiting to be reloaded', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const ticker = shop.slice(shop.indexOf('let askedAt = 0;'), shop.indexOf("bus.on('itemshop'"));
  assert.match(ticker, /setInterval/, 'nothing runs, so the clock cannot tick');
  assert.match(ticker, /#item-clock[\s\S]*textContent = clock\(untilRotation\(shopNow\(\)\)\)/, 'the countdown is never rewritten, or runs on this machine\'s clock');
  assert.match(ticker, /dateKey\(shopNow\(\)\) === shopToday\(\)/, 'the day is never compared with the one the catalogue was dealt for');
  assert.match(ticker, /Date\.now\(\) - askedAt < 5000/, 'a reply that is still yesterday\'s is never asked for again, or it is asked every second');
  assert.match(ticker, /net\.send\(\{ type: 'itemshop' \}\)/, 'a set debuting today is only in the catalogue the server has');
  assert.match(shop, /bus\.on\('itemshop', redraw\)/, 'nothing redraws, so the new hand is never shown');
});

// A page whose clock is off deals a hand for its own day. The catalogue carries the server's day, and
// everything the page works out about the shop uses that.
test('the page deals the shop for the server\'s day, not its own', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const calls = shop.match(/\b(shopFor|bundleOn|lastSeen|seenLine|untilRotation)\(([^)]*)\)/g).filter((call) => !call.startsWith('untilRotation(shopNow'));
  assert.ok(calls.length >= 6, 'the shop calls moved: this test no longer sees them');
  for (const call of calls) assert.match(call, /shopToday\(\)|, day|\(day\)/, `${call} is worked out for this machine's day`);
  const catalogue = readFileSync(new URL('../client/itemcatalogue.js', import.meta.url), 'utf8');
  assert.match(catalogue, /clock\.day = day/, 'the server\'s day is never kept');
  assert.match(catalogue, /clock\.skew = now - Date\.now\(\)/, 'the server\'s clock is never kept');
});

// The reply has to be its own message: config carries the login and would re-run it.
test('asking for the new shop does not re-run the login', () => {
  const server = readFileSync(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  const route = server.slice(server.indexOf("message.type === 'itemshop'"), server.indexOf("message.type === 'dev-online'"));
  assert.match(route, /type: 'itemshop', itemShop: shopCatalogue\(\)/, 'it must answer with today, on its own message');
  assert.ok(!/type: 'config'/.test(route), 'a config reply would reset loginRequired and resume the session again');
  const stamp = server.slice(server.indexOf('const shopCatalogue = '), server.indexOf('\n', server.indexOf('const shopCatalogue = ')));
  assert.match(stamp, /publicCatalogue\(dateKey\(at\)\), day: dateKey\(at\), now: at/, 'the catalogue is not stamped with the day it was dealt for');
});

// The lesson from the party invite that sent perfectly and was dropped on arrival.
test('the client actually handles the reply', () => {
  const net = readFileSync(new URL('../client/net.js', import.meta.url), 'utf8');
  assert.match(net, /message\.type === 'itemshop'/, 'the server would answer into a void');
  assert.match(net, /installShopCatalogue\(message\.itemShop\)/, 'the new catalogue is never installed');
  assert.match(net, /bus\.emit\('itemshop'\)/, 'and nothing tells the page to draw it');
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  assert.match(shop, /bus\.on\('itemshop', redraw\)/, 'the page never listens for it');
});

test('the server only ever hands over sets that have already landed', () => {
  const today = publicCatalogue('2026-08-10');
  for (const set of today.sets) assert.ok(set.debut <= '2026-08-10', `${set.name} is not out yet`);
  const later = publicCatalogue('2027-08-10');
  assert.ok(later.sets.length >= today.sets.length, 'the catalogue only ever grows');
});

// Bought in the Item Shop, then nowhere to put it on: the Locker kept its own copy of the unlock rule,
// knew only prices and levels, and read every exclusive as "Level undefined".
test('a piece bought in the Item Shop can be worn, and one not bought cannot', async () => {
  const set = ITEM_SETS.find((entry) => entry.items.some(([kind]) => kind !== 'finish'));
  const realNow = Date.now;
  Date.now = () => Date.parse(`${set.debut}T12:00:00Z`);
  try {
    const profiles = await store();
    const buyer = ProfileStore.newToken(), other = ProfileStore.newToken();
    profiles.credit(buyer, 999999, 'test', 'test');
    profiles.credit(other, 999999, 'test', 'test');
    for (const [kind, id] of set.items) assert.ok(buyItemShop(profiles, buyer, set.id, kind, id).bought, `${kind}:${id} did not sell on its debut`);
    const look = { skins: {} };
    for (const [kind, id] of set.items) if (kind === 'finish') look.skins.m44 = id; else look[kind === 'suit' ? 'color' : kind === 'visor' ? 'accent' : kind] = id;
    const worn = profiles.sanitizeCosmetics(buyer, look), refused = profiles.sanitizeCosmetics(other, look);
    for (const [key, value] of Object.entries(look)) {
      if (key === 'skins') continue;
      assert.equal(worn[key], value, `${key} ${value} was bought but taken off`);
      assert.notEqual(refused[key], value, `${key} ${value} was worn without buying it`);
    }
    assert.equal(worn.skins.m44, look.skins.m44, 'a bought skin was taken off');
    assert.equal(refused.skins.m44, undefined, 'a skin was worn without buying it');
  } finally { Date.now = realNow; }
});

test('the Locker asks the same unlock rule the server wears you by', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const status = shop.slice(shop.indexOf('function gearStatus('), shop.indexOf('function gearVisual('));
  assert.match(status, /cosmeticUnlocked\(kind, item\.id,/, 'the Locker has its own idea of what is unlocked');
  assert.ok(!/Level \$\{item\.level\}`\) : ''/.test(status) && !/>= item\.level/.test(status), 'a price-or-level shortcut is back');
  const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
  const picker = menu.slice(menu.indexOf('function chooseGear('), menu.indexOf('const LOOK_KEY'));
  assert.match(picker, /cosmeticUnlocked\(/, 'the Operator page can equip what the server will refuse');
});

// The Item Shop answers { kind: 'finish', id } for a skin. That went down the gear path, which looked the
// skin up in COSMETICS and threw, so the page never redrew after the purchase.
test('buying an Item Shop skin does not go down the gear path', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const reply = shop.slice(shop.indexOf('const bought = message.bought;'), shop.indexOf('if (message.sent)'));
  assert.match(reply, /bought\?\.kind === 'finish' \? bought\.id/, 'an Item Shop skin is not treated as a skin');
  assert.match(reply, /else if \(bought\?\.kind && COSMETICS\[bought\.kind\]\) ctx\.onGearBought/, 'a skin can still reach onGearBought');
});

// The shelf list was taken once, when the module loaded, before the catalogue had put the exclusives
// into FINISHES, so the skins wall never showed an Item Shop skin to anyone but a developer.
test('the skins wall lists the Item Shop skins that have been out', async () => {
  const { publicFinishes } = await import('../shared/economy.js');
  const released = EXCLUSIVE_FINISHES[0];
  assert.ok(publicFinishes().some((finish) => finish.id === released.id), 'an installed exclusive is missing from the public list');
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  assert.ok(!/PUBLIC_FINISHES/.test(shop), 'the skins wall still reads a list taken at load');
  // Nor is an exclusive offered for scrap: the server refuses it, so the button only ever failed.
  const inventory = shop.slice(shop.indexOf('function inventoryHtml('), shop.indexOf('// ------------------------------------------------------------------ gear'));
  assert.match(inventory, /info\.shop === 'item' \? '' : `<button type="button" class="mini\$\{armed === scrapKey/, 'Scrap is offered on an Item Shop skin');
});

test('a refused callsign does not leave a Play waiting to go off by itself', () => {
  const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
  assert.match(menu, /net\.on\('error', \(\) => \{ pendingPlay = null; \}\)/, 'a refused identify keeps the queued Play');
});
