// Battle royale: a headless match on the island, driven tick by tick on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

let clock = performance.now();
performance.now = () => clock;
const { RoyaleRoom } = await import('../server/royale.js');
const { AIRDROP_LOOT, DEPLOY, LOOT_TABLE, POWERS, ROYALE, ROYALE_LOADOUT, aircraftAt } = await import('../shared/royale.js');
const { MAP_IDS } = await import('../shared/map.js');
const { WEAPONS, GADGETS } = await import('../shared/constants.js');
const { ProfileStore } = await import('../server/profiles.js');
const { mkdtemp } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const nodePath = await import('node:path');
const { readFileSync } = await import('node:fs');

const profiles = { get: () => ({ xp: 0, rating: 1000, rankedMatches: 0 }), view: () => ({ level: 1, rating: 1000, rankedMatches: 0 }), recordMatch: () => ({}), coins: () => 0, sanitizeCosmetics: (type, list) => list };
const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
function fakeSocket() { const sent = []; return { readyState: 1, sent, send: (raw) => { const message = JSON.parse(raw); if (message.type !== 's') sent.push(message); } }; }
function makeRoom() {
  const room = new RoyaleRoom({ name: `royale-${Math.random()}`, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  return room;
}
const step = (room, seconds) => { for (let i = 0; i < seconds * 30 && room.phase === 'live'; i += 1) { clock += 1000 / 30; room.tick(); } };
// Straight off the ramp and on the ground, for tests about what happens after the deployment.
const offRamp = (room, player) => { room.exit(player); player.inDrop = false; player.dropping = false; };

test('the island never shows up in the map vote', () => {
  assert.ok(!MAP_IDS.includes('island'));
});

test('a royale starts free for all: everyone on their own team, pistol only, loot on the floor', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000001', session: 's1', name: 'Solo' }, look);
  assert.equal(room.phase, 'lobby');
  room.startMatch(); room.deploy();
  assert.equal(room.phase, 'live');
  assert.equal(room.players.size, ROYALE.fill);
  const teams = new Set([...room.players.values()].map((p) => p.team));
  assert.equal(teams.size, room.players.size);
  assert.equal(me.weapons.primary, null);
  assert.equal(me.weapons.sidearm, ROYALE_LOADOUT.sidearm);
  assert.ok(room.loot.size > 100, `only ${room.loot.size} items on the floor`);
  assert.ok(socket.sent.some((m) => m.type === 'loot' && m.loot.length === room.loot.size));
  assert.ok(socket.sent.some((m) => m.type === 'royale' && m.storm));
  room.close();
});

test('a pilot picks up what they choose: look, press, and the old gun is left behind', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000002', session: 's1', name: 'Looter' }, look);
  room.startMatch(); room.deploy();
  assert.equal(me.active, 'melee');
  assert.ok(me.y > 150, 'pilots start in the sky');
  offRamp(room, me);
  me.y = 0;
  const gun = room.addLoot(me.x, me.y, me.z, { kind: 'weapon', id: 'recon' });
  step(room, 0.5);
  assert.equal(me.weapons.primary, null, 'walking over a gun does nothing');
  room.handle(me, { type: 'royale-take', id: gun.id });
  assert.equal(me.weapons.primary, 'recon');
  assert.equal(me.active, 'primary');
  assert.ok(!room.loot.has(gun.id));
  assert.ok(socket.sent.some((m) => m.type === 'loot-take' && m.id === gun.id));
  assert.ok(socket.sent.some((m) => m.type === 'pickup'));
  const better = room.addLoot(me.x, me.y, me.z, { kind: 'weapon', id: 'm44' });
  room.handle(me, { type: 'royale-take', id: better.id });
  assert.equal(me.weapons.primary, 'm44');
  assert.ok([...room.loot.values()].some((l) => l.item.id === 'recon' && l.dropper === me.id), 'the old gun is on the floor');
  const far = room.addLoot(me.x + 30, me.y, me.z, { kind: 'helmet' });
  room.handle(me, { type: 'royale-take', id: far.id });
  assert.ok(!me.helmet, 'out of reach');
  room.close();
});

test('the storm hurts pilots outside the circle and can kill them', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000003', session: 's1', name: 'Stormed' }, look);
  room.startMatch(); room.deploy();
  // Close the circle to nothing, far from the pilot.
  Object.assign(room.storm, { from: { x: 250, z: 250, r: 1 }, to: { x: 250, z: 250, r: 1 }, shrinkStart: 0, shrinkEnd: 0, damage: 40, nextAt: Infinity });
  offRamp(room, me);
  me.x = -200; me.z = -200;
  const hp = me.hp;
  step(room, 1);
  assert.ok(me.hp < hp || !me.alive);
  step(room, 5);
  assert.equal(me.alive, false);
  assert.ok(socket.sent.some((m) => m.type === 'kill' && m.reason === 'storm'));
  room.close();
});

test('a full match of bots ends with one winner and a placement for everyone', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000004', session: 's1', name: 'Watcher' }, look);
  room.startMatch(); room.deploy();
  me.alive = false;   // sit out so the bots play it through
  step(room, 900);
  assert.notEqual(room.phase, 'live', 'the match never ended');
  const end = socket.sent.find((m) => m.type === 'match-end');
  assert.ok(end?.royale);
  assert.equal(end.table.length, room.players.size);
  assert.equal(end.table[0].placement, 1);
  room.close();
});

test('the deployment: everyone boards, the countdown runs, and each pilot leaves the ramp when they choose', () => {
  const room = makeRoom();
  const socket = fakeSocket();
  const me = room.join(socket, { token: 'tok-royale-000000009', session: 's9', name: 'Dropper' }, look);
  room.startMatch();
  assert.equal(room.phase, 'drop');
  assert.ok(me.alive && me.inPlane, 'not aboard the aircraft');
  assert.ok(socket.sent.some((m) => m.type === 'royale-flight' && m.flight.speed === DEPLOY.speed), 'the flight plan was never sent');
  assert.ok(socket.sent.some((m) => m.type === 'you' && m.inPlane), 'the pilot was never told they are aboard');
  // A marker is navigation only: it moves nobody.
  const at = { x: me.x, z: me.z };
  room.handle(me, { type: 'royale-drop', x: 100, z: -120 });
  assert.deepEqual(room.drops.get(me.id), { x: 100, z: -120 });
  assert.deepEqual({ x: me.x, z: me.z }, at);
  // Nobody jumps during the countdown, or before the ramp is open.
  room.handle(me, { type: 'royale-jump' });
  assert.ok(me.inPlane, 'jumped during the countdown');
  clock += (DEPLOY.countdown + 0.1) * 1000; room.tick();
  assert.equal(room.phase, 'live');
  room.handle(me, { type: 'royale-jump' });
  assert.ok(me.inPlane, 'jumped before the ramp opened');
  // Aboard, the aircraft decides where you are: a rider's own position is not taken.
  room.onState(me, { e: me.epoch, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: 4 });
  assert.ok(me.y > 150, 'a rider moved themselves out of the aircraft');
  // Nobody can see, shoot or storm a rider.
  assert.ok(!room.enemiesOf([...room.players.values()].find((p) => p.bot)).includes(me), 'a rider can be targeted');
  clock = room.flight.doorsAt * 1000 + 50; room.tick();
  const plane = aircraftAt(room.flight, clock / 1000);
  room.handle(me, { type: 'royale-jump' });
  assert.ok(!me.inPlane && me.alive && me.inDrop, 'the jump was refused with the ramp open');
  assert.ok(Math.hypot(me.x - plane.x, me.z - plane.z) < 15 && me.y > DEPLOY.altitude - 5, 'left from somewhere other than the ramp');
  assert.ok(socket.sent.some((m) => m.type === 'spawn' && m.y > 150), 'the pilot was not told where they left from');
  const epoch = me.epoch;
  room.handle(me, { type: 'royale-jump' });
  assert.equal(me.epoch, epoch, 'a second jump put them back in the air');
  // Bots go near where the line passes their spot; anyone left aboard goes at the far coast, over land.
  step(room, room.flight.ejectAt - clock / 1000 + 0.2);
  const aboard = [...room.players.values()].filter((p) => p.inPlane);
  assert.equal(aboard.length, 0, `${aboard.length} still aboard after the far coast`);
  const half = room.map.bounds.maxX;
  const eject = aircraftAt(room.flight, room.flight.ejectAt);
  assert.ok(Math.abs(eject.x) < half && Math.abs(eject.z) < half, 'the last pilots were thrown out over the sea');
  room.close?.();
});

test('bots gear up and airdrops land', () => {
  const room = makeRoom();
  room.join(fakeSocket(), { token: 'tok-royale-000000010', session: 's10', name: 'Watcher' }, look);
  room.startMatch(); room.deploy();
  // The first seconds are spent under a parachute, and everyone lands with a blade only.
  step(room, 100);
  const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
  const armed = bots.filter((p) => p.weapons.primary || p.weapons.sidearm).length;
  assert.ok(armed >= bots.length * 0.5, `only ${armed} of ${bots.length} bots found a gun in 100 s`);
  room.callAirdrop(clock / 1000);
  const before = room.loot.size;
  assert.equal(room.airdrops.length, 1);
  step(room, ROYALE.airdropFall + 1);
  assert.equal(room.airdrops.length, 0);
  assert.ok(room.loot.size > before - 40);
  room.close?.();
});

test('every pickup on the island is a real thing, and Adrenaline is gone', () => {
  // A power with no entry showed as "?" on the floor and threw on pickup, so the pools are checked
  // against what actually exists rather than trusted.
  for (const entry of [...LOOT_TABLE, ...AIRDROP_LOOT]) {
    for (const id of entry.pool || []) {
      if (entry.kind === 'power') assert.ok(POWERS[id], `the loot table drops a power called ${id}, which does not exist`);
      if (entry.kind === 'weapon') assert.ok(WEAPONS[id], `the loot table drops a weapon called ${id}, which does not exist`);
    }
  }
  assert.ok(!POWERS.speed, 'the speed boost is back on the island');
  assert.ok(Object.keys(POWERS).length > 0, 'there are no powers left at all');
});


// Most kills in one royale: a record like the longest kill, not a running total, so a good match stands
// and a bad one does not take it away.
test('the best royale a pilot has had is kept, and only royales count', async () => {
  const store = new ProfileStore(nodePath.join(await mkdtemp(nodePath.join(tmpdir(), 'krosshair-royale-')), 'profiles.json'));
  const token = ProfileStore.newToken();
  const played = (mode, kills) => store.recordMatch(token, { mode, kills, playerKills: kills, botKills: 0, deaths: 1, won: false, weaponKills: {} });

  played('royale', 6);
  assert.equal(store.get(token).stats.royaleKills, 6, 'a royale was not recorded');
  played('royale', 3);
  assert.equal(store.get(token).stats.royaleKills, 6, 'a worse royale took the record away');
  played('royale', 11);
  assert.equal(store.get(token).stats.royaleKills, 11, 'a better royale did not take the record');
  played('match', 30);
  assert.equal(store.get(token).stats.royaleKills, 11, 'an ordinary match counted towards the royale record');
});

test('a profile from before the board still works', async () => {
  const store = new ProfileStore(nodePath.join(await mkdtemp(nodePath.join(tmpdir(), 'krosshair-royale-old-')), 'profiles.json'));
  const token = ProfileStore.newToken();
  const profile = store.get(token);
  delete profile.stats.royaleKills; // what everyone who has already played looks like
  store.recordMatch(token, { mode: 'royale', kills: 4, playerKills: 4, botKills: 0, deaths: 0, won: false, weaponKills: {} });
  assert.equal(store.get(token).stats.royaleKills, 4, 'a pilot who played before the board can never get on it');
});

test('the board is wired from the stat all the way to the page', () => {
  const server = readFileSync(new URL('../multiplayer-server.mjs', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
  const boards = server.slice(server.indexOf('const BOARDS = {'), server.indexOf('\n};', server.indexOf('const BOARDS = {')));
  assert.match(boards, /royale: \{ label: 'Royale kills'/, 'the server does not offer the board');
  assert.match(boards, /p\.stats\?\.royaleKills/, 'and it reads the stat that is actually kept');
  assert.match(menu, /const BOARD_ORDER = \[[^\]]*'royale'/, 'the page never shows it, so nobody can see it');
});

// Bots used to stand still and let the storm take them. Not because they were slow or set off late, but
// because a third of the routes they asked for during a storm come back empty (the island's walk graph
// does not always join up), and the answer to no route was to wait a second and ask again, for ever.
// Measured over eight headless matches, the storm took 12.5% of bots before this and 6.0% after.
test('a bot with nowhere to walk still heads for the circle', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000020', session: 's20', name: 'W' }, look);
  room.startMatch(); room.deploy();
  me.alive = false;
  // Every route request fails, which is the case that used to leave them standing.
  room.nav.path = () => null;
  step(room, 120);
  // Pick a bot and stand it in the open well outside the circle, rather than taking whichever happens to
  // be fleeing: one boxed in by scenery has every hop blocked, which is correct and made this flaky.
  const bot = [...room.players.values()].find((p) => p.bot && p.alive);
  assert.ok(bot, 'no bots alive to test with');
  // A spot far out with a clear run towards the circle, which is the case being tested. One boxed in by
  // scenery has every hop blocked, and holding there is right, so it is not what this is about.
  const to = room.storm.to;
  const clearTowards = (node) => {
    const dx = to.x - node.x, dz = to.z - node.z, far = Math.hypot(dx, dz) || 1;
    for (let k = 1; k <= 12; k += 1) {
      const x = node.x + (dx / far) * k * 2, z = node.z + (dz / far) * k * 2;
      if (!room.world.bodyFree(x, node.y, z) || room.world.groundBelow(x, node.y + 0.05, z) < node.y - 0.3) return false;
    }
    return true;
  };
  const open = room.nav.nodes.filter((node) => node.y < 0.2 && room.world.bodyFree(node.x, node.y, node.z));
  const far = open.map((node) => ({ node, gap: Math.hypot(node.x - to.x, node.z - to.z) })).sort((a, b) => b.gap - a.gap).find(({ node }) => clearTowards(node));
  assert.ok(far, 'nowhere on the island has a clear run towards the circle');
  Object.assign(bot, { x: far.node.x, y: far.node.y, z: far.node.z });
  bot.ai.path = null; bot.ai.repathAt = 0; bot.ai.holdUntil = 0;
  bot.hp = 1e9;   // another bot's lucky shot in the next two seconds is not what this is about either
  assert.ok(room.botMustMove(bot, performance.now() / 1000), 'the bot should be out in the storm where it was put');
  step(room, 2);
  assert.ok(bot.ai.path, 'a fleeing bot with no route got no path at all, so it will stand still');
  assert.equal(bot.ai.path.length, 2, 'the fallback is a short hop, re-asked for a real route each time');
  const goal = bot.ai.goal;
  const before = Math.hypot(bot.x - goal.x, bot.z - goal.z);
  const step2 = bot.ai.path[1];
  assert.ok(Math.hypot(step2.x - goal.x, step2.z - goal.z) < before, 'the hop must be towards the circle, not away from it');
  room.close();
});

test('the fallback only applies to bots running from the storm', () => {
  const bots = readFileSync(new URL('../server/bots.js', import.meta.url), 'utf8');
  const repath = bots.slice(bots.indexOf('} else if (!ai.path && t >= ai.repathAt'), bots.indexOf('} else if (ai.path) {'));
  assert.match(repath, /else if \(fleeing && ai\.goal\)/, 'walking at a goal with no route must be for the storm only');
  assert.match(repath, /Math\.min\(25, far\)/, 'and in short hops, so a real path is picked up as soon as there is one');
  assert.match(repath, /else \{ ai\.lastKnown = null; ai\.holdUntil = t \+ 1; \}/, 'everything else still holds and re-asks');
});

// Dropping a gun and picking it straight back up used to hand it over full, magazine and reserve, as
// many times as you liked: a free reload and an endless resupply for nothing. A gun now comes as it
// lies, and the one you put down keeps what was in it.
test('a gun you put down keeps its ammo, and picking it back up is not a reload', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000030', session: 's30', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;

  room.take(me, { kind: 'weapon', id: 'talon' }, true);
  const full = { ...me.ammo.primary };
  assert.ok(full.mag > 0 && full.reserve > 0, 'a gun off the floor comes loaded');

  // Fire it most of the way down.
  me.ammo.primary.mag = 2; me.ammo.primary.reserve = 5;
  const spent = { ...me.ammo.primary };

  // Swap to something else: the talon goes on the floor with what was in it.
  room.take(me, { kind: 'weapon', id: 'wasp' }, true);
  // The island is already strewn with loot, so find the one this pilot put down, not a floor talon.
  const onFloor = [...room.loot.values()].find((entry) => entry.dropper === me.id && entry.item.id === 'talon');
  assert.ok(onFloor, 'the gun was not dropped');
  assert.equal(onFloor.item.mag, spent.mag, 'the dropped gun forgot what was in its magazine');
  assert.equal(onFloor.item.reserve, spent.reserve, 'and forgot its reserve');

  // Take it back: exactly what it had, not a fresh one.
  room.take(me, onFloor.item, true);
  assert.equal(me.ammo.primary.mag, spent.mag, 'picking it back up reloaded it');
  assert.equal(me.ammo.primary.reserve, spent.reserve, 'picking it back up refilled the reserve');
  assert.ok(me.ammo.primary.reserve < full.reserve, 'and it must be short of a fresh one, or nothing was proved');
  room.close();
});

test('an empty gun of the kind you hold is not worth walking over', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000031', session: 's31', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;
  room.take(me, { kind: 'weapon', id: 'talon' }, true);
  me.ammo.primary.reserve = 10;
  // An empty one somebody dropped adds nothing, so it must not read as ammo.
  assert.equal(room.take(me, { kind: 'weapon', id: 'talon', mag: 0, reserve: 0 }, true), null, 'an empty gun topped the reserve up');
  assert.equal(me.ammo.primary.reserve, 10, 'and it must not have moved');
  // One off the floor still resupplies, up to the brim and no further.
  const before = me.ammo.primary.reserve;
  assert.ok(room.take(me, { kind: 'weapon', id: 'talon' }, true), 'a loaded one off the floor is worth taking');
  assert.ok(me.ammo.primary.reserve > before, 'it should have given something');
  assert.ok(me.ammo.primary.reserve <= WEAPONS.talon.reserve, 'and never more than the gun can hold');
  room.close();
});

// The inventory: putting something down on purpose. The ammo rule is the same as a swap, so this cannot
// be used to launder rounds, and the blade never goes because a pilot with nothing would just stand there.
test('dropping a gun puts it on the floor with what was in it', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000040', session: 's40', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;
  room.take(me, { kind: 'weapon', id: 'talon' }, true);
  me.ammo.primary.mag = 3; me.ammo.primary.reserve = 7;

  room.handle(me, { type: 'royale-toss', slot: 'primary' });
  assert.ok(!me.weapons.primary, 'the gun is still in hand');
  assert.equal(me.ammo.primary, null, 'its ammo stayed behind');
  const put = [...room.loot.values()].find((entry) => entry.dropper === me.id && entry.item.id === 'talon');
  assert.ok(put, 'nothing was put on the floor');
  assert.equal(put.item.mag, 3, 'the magazine did not go with it');
  assert.equal(put.item.reserve, 7, 'nor the reserve');
  assert.notEqual(me.active, 'primary', 'still holding the slot it just dropped');
  room.close();
});

test('dropping and taking back is not a reload, through the inventory either', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000041', session: 's41', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;
  room.take(me, { kind: 'weapon', id: 'talon' }, true);
  me.ammo.primary.mag = 1; me.ammo.primary.reserve = 2;
  room.handle(me, { type: 'royale-toss', slot: 'primary' });
  const put = [...room.loot.values()].find((entry) => entry.dropper === me.id && entry.item.id === 'talon');
  room.take(me, put.item, true);
  assert.equal(me.ammo.primary.mag, 1, 'the round trip reloaded it');
  assert.equal(me.ammo.primary.reserve, 2, 'the round trip refilled the reserve');
  room.close();
});

test('the blade cannot be dropped, and nor can anything you are not carrying', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000042', session: 's42', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;
  const blade = me.weapons.melee;
  room.handle(me, { type: 'royale-toss', slot: 'melee' });
  assert.equal(me.weapons.melee, blade, 'the blade went');
  const before = room.loot.size;
  room.handle(me, { type: 'royale-toss', slot: 'sidearm' });        // empty slot
  room.handle(me, { type: 'royale-toss', gadget: 'not-a-gadget' }); // never held
  room.handle(me, { type: 'royale-toss', slot: 'nonsense' });
  assert.equal(room.loot.size, before, 'something was conjured onto the floor');
  room.close();
});

test('a gadget can be put down, and only once', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000043', session: 's43', name: 'Solo' }, look);
  room.startMatch(); room.deploy();
  me.alive = true;
  const id = Object.keys(GADGETS)[0];
  me.gadgets = [id];
  room.handle(me, { type: 'royale-toss', gadget: id });
  assert.deepEqual(me.gadgets, [], 'still carrying it');
  const put = [...room.loot.values()].filter((entry) => entry.dropper === me.id && entry.item.id === id);
  assert.equal(put.length, 1, 'it should be on the floor exactly once');
  room.handle(me, { type: 'royale-toss', gadget: id });
  assert.equal([...room.loot.values()].filter((entry) => entry.dropper === me.id && entry.item.id === id).length, 1, 'dropped twice');
  room.close();
});

test('the dead and the not-yet-landed cannot drop anything', () => {
  const room = makeRoom();
  const me = room.join(fakeSocket(), { token: 'tok-royale-000000044', session: 's44', name: 'Solo' }, look);
  room.startMatch();
  me.alive = true;
  assert.equal(room.phase, 'drop');
  room.handle(me, { type: 'royale-toss', slot: 'melee' });
  room.deploy();
  room.take(me, { kind: 'weapon', id: 'talon' }, true);
  me.alive = false;
  const before = room.loot.size;
  room.handle(me, { type: 'royale-toss', slot: 'primary' });
  assert.equal(room.loot.size, before, 'a dead pilot dropped their gun');
  assert.equal(me.weapons.primary, 'talon', 'and lost it');
  room.close();
});

// Tab is the key, and the screen has to stop the game reading the same presses.
test('the inventory is wired to the free key and blocks play while it is open', () => {
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');
  assert.match(royale, /isBound\('scoreboard', code\)\) showKit\(!kitOpen\)/, 'nothing opens it');
  assert.match(royale, /code === 'Escape' && kitOpen\) showKit\(false\)/, 'Escape must close it');
  assert.match(royale, /hud\.royaleKitOpen = open/, 'the rest of the game is never told it is open');
  assert.match(hud, /get blocking\(\)[^}]*this\.royaleKitOpen/, 'firing through an open inventory');
  assert.match(royale, /document\.exitPointerLock/, 'a screen you click needs the pointer back');
  assert.match(royale, /!kitOpen && held\(player\.keys[^)]*\), 'map'\)/, 'the map shows through the inventory');
});

// The whole royale HUD is pointer-events: none so it never eats a shot. Anything meant to be clicked has
// to turn that back on for itself, and the first inventory did not: the Drop button could not be pressed.
test('the inventory takes clicks, unlike the rest of the HUD', () => {
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  assert.match(royale, /\.royale-hud \{[^}]*pointer-events: none/, 'the HUD should still ignore the mouse');
  assert.match(royale, /\.royale-kit \{[^}]*pointer-events: auto/, 'so the inventory has to ask for it back');
});

// Dragging by hand rather than the browser's drag and drop, which wants a data transfer and fights the
// pointer lock this screen has just released.
test('a piece is put down by dragging it left, not by a button', () => {
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  assert.match(royale, /kit\.addEventListener\('mousedown'/, 'nothing starts a drag');
  assert.match(royale, /const overBin = \(event\) => event\.clientX < innerWidth \* 0\.4\d/, 'the bay has to be the left of the screen');
  assert.match(royale, /if \(put\) net\.send\(\{ type: 'royale-toss', \.\.\.item\.drop \}\)/, 'letting go in the bay must put it down');
  assert.ok(!/<button[^>]*Drop<\/button>/.test(royale), 'the Drop button is meant to be gone');
  // The blade carries no drop, so there is nothing to drag it into the bay with.
  assert.match(royale, /if \(!item\.drop\) return;/, 'anything that cannot be dropped must not start a drag');
  assert.match(royale, /out\.push\(\{ key: 'melee'[^}]*\}\);/, 'the blade is listed');
  const blade = royale.match(/out\.push\(\{ key: 'melee'[^}]*\}\);/)[0];
  assert.ok(!/drop:/.test(blade), 'the blade must not be droppable');
});
