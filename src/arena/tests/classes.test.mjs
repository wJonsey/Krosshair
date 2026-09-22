// Saved classes: a shopping list walked through the ordinary armoury in the buy phase. The thing that
// matters is that a class can never hand a pilot anything they could not have bought by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { CLASS_SLOTS, classCost, cleanClass, cleanClasses, defaultClasses, shoppingList } from '../shared/classes.js';
import { ARMOR, GADGETS, GADGET_SLOTS, WEAPONS } from '../shared/constants.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const socket = () => ({ readyState: 1, send: () => {} });

async function arena() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-classes-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const room = new Room({ name: `cls-${Math.random().toString(36).slice(2, 6)}`, queue: 'casual', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  room.phase = 'buy';
  const player = room.join(socket(), { token: ProfileStore.newToken(), session: 'a', name: 'Pilot' }, look);
  room.spawn(player);
  player.alive = true;
  return { room, player, profiles };
}

test('a class holds ids, never stats, so there is one copy of a gun', () => {
  const kit = defaultClasses()[0];
  // Ids and flags only. The gadgets array holds ids too, so it is checked item by item.
  for (const [field, value] of Object.entries(kit)) {
    if (field === 'gadgets') { assert.ok(value.every((id) => typeof id === 'string'), 'gadgets are ids'); continue; }
    assert.ok(value === null || typeof value !== 'object', `${field} is a lump of data, not an id`);
  }
  assert.equal(typeof kit.primary, 'string');
  assert.ok(WEAPONS[kit.primary], 'and the id names a real gun');
  assert.equal(kit.primary.length < 20, true, 'an id, not a serialised weapon');
});

test('a crafted class cannot smuggle anything past the rules', () => {
  const kit = cleanClass({
    name: '<script>x</script>'.repeat(10),
    primary: 'p9',           // a sidearm in the primary slot
    sidearm: 'ronin',        // a primary in the sidearm slot
    armor: 'diamond',        // not a thing
    helmet: 'yes',
    gadgets: ['pulse', 'pulse', 'stim', 'ghost', 'notreal'],
  });
  assert.equal(kit.primary, null, 'a sidearm is not a primary');
  assert.equal(kit.sidearm, null, 'and a rifle is not a sidearm');
  assert.equal(kit.armor, null, 'invented armour is dropped');
  assert.ok(!/[<>]/.test(kit.name), 'the name is stripped of markup');
  assert.ok(kit.name.length <= 16, 'and kept short');
  assert.ok(kit.gadgets.length <= GADGET_SLOTS, 'no more gadgets than there are slots');
  assert.equal(new Set(kit.gadgets).size, kit.gadgets.length, 'and no duplicates');
  assert.ok(kit.gadgets.every((id) => GADGETS[id]), 'every gadget is a real one');
});

test('there are always exactly the slots the menu draws', () => {
  assert.equal(cleanClasses(null).length, CLASS_SLOTS);
  assert.equal(cleanClasses([{ name: 'One' }]).length, CLASS_SLOTS);
  assert.equal(cleanClasses(new Array(99).fill({})).length, CLASS_SLOTS);
});

test('buying a class costs what buying it by hand costs', async () => {
  const { room, player } = await arena();
  const kit = { name: 'Test', primary: 'talon', sidearm: null, armor: 'light', helmet: false, gadgets: [] };
  player.classes = [kit];
  player.credits = 9000;
  const start = player.credits;
  room.buyClass(player, 0);

  const byHand = WEAPONS.talon.cost + ARMOR.light.cost;
  assert.equal(start - player.credits, byHand, 'the class paid the ordinary price, no more and no less');
  assert.equal(player.weapons.primary, 'talon');
  assert.equal(player.armor, ARMOR.light.points);
});

test('a thin wallet still gets the gun, and is told what it missed', async () => {
  const { room, player } = await arena();
  player.classes = [{ name: 'Rich', primary: 'anvil', sidearm: 'viper', armor: 'heavy', helmet: true, gadgets: ['shield'] }];
  player.credits = WEAPONS.anvil.cost; // exactly the gun, nothing else
  room.buyClass(player, 0);
  assert.equal(player.weapons.primary, 'anvil', 'the gun comes first, because a round without one is over');
  assert.equal(player.armor, 0, 'and what could not be afforded is simply skipped');
  assert.ok(player.credits < WEAPONS.anvil.cost, 'the credits went on the gun');
});

test('a class cannot be bought outside the buy phase', async () => {
  const { room, player } = await arena();
  room.phase = 'live';
  player.classes = [{ name: 'Test', primary: 'talon', sidearm: null, armor: null, helmet: false, gadgets: [] }];
  player.credits = 9000;
  room.buyClass(player, 0);
  assert.notEqual(player.weapons.primary, 'talon', 'the armoury is shut once the round is live');
  assert.equal(player.credits, 9000, 'and nothing was charged');
});

test('buying the same class twice does not charge twice', async () => {
  const { room, player } = await arena();
  player.classes = [{ name: 'Test', primary: 'talon', sidearm: 'viper', armor: 'light', helmet: true, gadgets: ['pulse'] }];
  player.credits = 9000;
  room.buyClass(player, 0);
  const after = player.credits;
  room.buyClass(player, 0);
  assert.equal(player.credits, after, 'everything was already on the pilot, so nothing more was taken');
});

test('an empty slot buys nothing and costs nothing', async () => {
  const { room, player } = await arena();
  player.classes = [{ name: 'Empty', primary: null, sidearm: null, armor: null, helmet: false, gadgets: [] }];
  player.credits = 9000;
  room.buyClass(player, 0);
  assert.equal(player.credits, 9000);
  assert.equal(player.weapons.primary, 'm44', 'still the kit everyone spawns with');
});

test('the gun is asked for before the trinkets', () => {
  const list = shoppingList({ name: 'x', primary: 'talon', sidearm: 'viper', armor: 'heavy', helmet: true, gadgets: ['pulse'] });
  assert.equal(list[0], 'talon', 'the primary leads');
  assert.ok(list.indexOf('heavy') < list.indexOf('pulse'), 'armour beats a gadget');
  assert.ok(list.indexOf('talon') < list.indexOf('viper'), 'and the primary beats the sidearm');
});

test('classes survive a save and a reload', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-cls2-'));
  const file = path.join(dir, 'p.json');
  const profiles = new ProfileStore(file);
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  const mine = defaultClasses();
  mine[0].name = 'My Kit';
  profiles.saveClasses(token, mine);
  assert.equal(profiles.view(token).classes[0].name, 'My Kit', 'the browser is told about it');
  profiles.flush();

  const again = new ProfileStore(file);
  await again.load();
  assert.equal(again.view(token).classes[0].name, 'My Kit', 'and it is still there after a restart');
});

test('a pilot who has never touched the page still gets usable classes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-cls3-'));
  const profiles = new ProfileStore(path.join(dir, 'p.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  const classes = profiles.view(token).classes;
  assert.equal(classes.length, CLASS_SLOTS);
  assert.ok(classes[0].primary, 'the first one is ready to buy, not blank');
  assert.ok(classCost(classes[0]) > 0);
});

// The whole point: what is saved in the menu is what the armoury buys in the match. This walks the
// real chain, profile to room to pilot, rather than trusting that the middle of it works.
test('a class saved in the menu is the class the match buys', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-cls4-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');

  // Built in the menu.
  const mine = defaultClasses();
  mine[0] = { name: 'Mine', primary: 'ronin', sidearm: 'viper', armor: 'heavy', helmet: true, gadgets: ['pulse', 'stim'] };
  profiles.saveClasses(token, mine);

  // Joining a match.
  const room = new Room({ name: 'chain', queue: 'casual', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  room.phase = 'buy';
  const player = room.join({ readyState: 1, send: () => {} }, { token, session: 'a', name: 'Pilot' }, look);
  room.spawn(player);
  player.alive = true;
  player.credits = 9000;

  assert.ok(player.classes, 'the classes came into the room with the pilot');
  assert.equal(player.classes[0].name, 'Mine', 'and they are the ones that were saved');

  room.buyClass(player, 0);
  assert.equal(player.weapons.primary, 'ronin', 'the primary is the one chosen in the menu');
  assert.equal(player.weapons.sidearm, 'viper', 'and so is the sidearm');
  assert.equal(player.armor, ARMOR.heavy.points, 'the armour too');
  assert.ok(player.helmet, 'and the helmet');
  assert.deepEqual(player.gadgets.sort(), ['pulse', 'stim'], 'and both gadgets');
});

test('royale has no armoury, so it carries no classes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-cls5-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  profiles.saveClasses(token, defaultClasses());
  const { RoyaleRoom } = await import('../server/royale.js');
  const room = new RoyaleRoom({ name: 'roy', queue: 'royale', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join({ readyState: 1, send: () => {} }, { token, session: 'a', name: 'Pilot' }, look);
  assert.equal(player.classes, null, 'guns come off the floor there, so a shopping list means nothing');
});

// The menu has to actually be wired to all this, not merely look like it is.
test('the class editor saves every change as it is made', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  for (const [what, key] of [['picking a gun', 'classGun'], ['armour', 'classArmor'], ['a helmet', 'classHelmet'], ['a gadget', 'classGadget'], ['resetting', 'classReset']]) {
    const at = shop.indexOf(`d.${key}`);
    assert.ok(at > 0, `${what} has no handler`);
    const block = shop.slice(at, at + 420);
    assert.match(block, /saveClasses\(/, `${what} changes nothing that outlives the page`);
  }
  assert.match(shop, /net\.send\(\{ type: 'classes'/, 'and the save reaches the server');
});

test('the armoury offers the classes and asks the server to buy one', () => {
  const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /data-class=/, 'the armoury draws a button per class');
  assert.match(hud, /type: 'buy-class'/, 'and pressing one asks the server to buy it');
  // The client never says what it costs: the room prices it.
  const click = hud.slice(hud.indexOf("data-class]"), hud.indexOf("data-class]") + 260);
  assert.ok(!/credits\s*-=/.test(click), 'the browser does not charge anybody');
});
