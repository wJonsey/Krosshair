// The gunsmith: attachments that always cost something, a server that resolves the gun itself, a
// royale that ignores all of it, and an armoury where the better gun costs more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { Room } from '../server/room.js';
import { WEAPONS } from '../shared/constants.js';
import { damageFor } from '../shared/combat.js';
import { ATTACHMENTS, BETTER_DOWN, BETTER_UP, SLOTS, buildCost, cleanBuild, emptyBuild, fitsWeapon, partsFor, resolveWeapon, touchedKeys } from '../shared/attachments.js';

const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
const fakeSocket = () => ({ readyState: 1, send: () => {} });
async function makeRoom(extra = {}) {
  const profiles = new ProfileStore(path.join(await mkdtemp(path.join(tmpdir(), 'krosshair-smith-')), 'profiles.json'));
  const room = new Room({ name: `smith-${Math.random()}`, queue: 'custom', profiles, onEmpty: () => {}, ...extra });
  clearInterval(room.interval);
  return { room, profiles };
}

const LOWER = BETTER_DOWN;
const read = (weapon, key) => key.split('.').reduce((at, step) => (at == null ? at : at[step]), weapon);
const WATCHED = [...BETTER_UP, ...BETTER_DOWN];

test('every attachment gives something up', () => {
  const guns = Object.values(WEAPONS).filter((weapon) => !weapon.melee);
  for (const part of Object.values(ATTACHMENTS)) {
    const fitting = guns.filter((weapon) => fitsWeapon(part, weapon));
    assert.ok(fitting.length, `${part.id} fits nothing`);
    // Checked on every gun it fits, not just one: a part that is pure downside on some gun is a trap.
    for (const gun of fitting) {
    const base = WEAPONS[gun.id];
    const built = resolveWeapon(gun.id, { ...emptyBuild(), [part.slot]: part.id });
    let better = 0, worse = 0;
    for (const key of WATCHED) {
      const from = read(base, key), to = read(built, key);
      if (typeof from !== 'number' || typeof to !== 'number' || Math.abs(to - from) < 1e-9) continue;
      const improved = LOWER.has(key) ? to < from : to > from;
      if (improved) better += 1; else worse += 1;
    }
    // Iron sights are the bare rail, so they only give things up. Everything else must do both.
    if (part.id !== 'irons') assert.ok(better > 0, `${part.id} improves nothing on the ${gun.name}`);
    assert.ok(worse > 0, `${part.id} is a free upgrade on the ${gun.name}, which breaks the point of building`);
    }
  }
});

test('a part only fits where it should, and a build is cleaned of anything else', () => {
  assert.ok(!fitsWeapon(ATTACHMENTS.dot, WEAPONS.knife), 'a knife took an optic');
  assert.ok(!fitsWeapon(ATTACHMENTS.longscope, WEAPONS.breaker), 'a pump shotgun took a 4x');
  assert.ok(fitsWeapon(ATTACHMENTS.bipod, WEAPONS.anvil), 'the LMG cannot take a bipod');
  // A crafted build keeps only what belongs: right slot, right family, nothing invented.
  const dirty = { optic: 'longscope', muzzle: 'dot', barrel: 'nope', mag: 'drum', stock: null, grip: 'bipod', extra: 'dot' };
  const clean = cleanBuild('breaker', dirty);
  assert.equal(clean.optic, null, 'a 4x stayed on a shotgun');
  assert.equal(clean.muzzle, null, 'an optic sat in the muzzle slot');
  assert.equal(clean.barrel, null);
  assert.equal(clean.grip, null, 'a bipod stayed on a shotgun');
  assert.equal(clean.mag, 'drum');
  assert.ok(!('extra' in clean), 'an unknown slot survived');
  for (const slot of SLOTS) assert.ok(slot in clean);
  assert.deepEqual(cleanBuild('knife', { optic: 'dot' }), emptyBuild(), 'a knife kept an attachment');
});

test('the resolved gun costs more, and never touches the base weapon', () => {
  const build = { ...emptyBuild(), optic: 'holo', muzzle: 'suppressor', mag: 'extmag' };
  const base = WEAPONS.talon;
  const baseMag = base.mag, baseSpread = base.spread.ads, baseLoud = base.loud;
  const built = resolveWeapon('talon', build);
  assert.equal(built.cost, base.cost + buildCost(build));
  assert.ok(built.mag > baseMag, 'the extended mag did nothing');
  assert.ok(built.loud < baseLoud, 'the suppressor did nothing');
  assert.equal(built.suppressed, true);
  // The shared weapon table must come back untouched, or one pilot's build changes the gun for everyone.
  assert.equal(WEAPONS.talon.mag, baseMag);
  assert.equal(WEAPONS.talon.spread.ads, baseSpread);
  assert.equal(WEAPONS.talon.loud, baseLoud);
  assert.notEqual(built.spread, base.spread, 'the spread object is shared with the base gun');
  // Nothing bolted on means the base gun itself, so the common case allocates nothing.
  assert.equal(resolveWeapon('talon', emptyBuild()), base);
});

test('the server resolves the gun, so a lie about a build changes nothing', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  player.builds = { talon: { ...emptyBuild(), mag: 'drum' } };
  player.weapons.primary = 'talon';
  player.active = 'primary';
  const built = room.currentWeapon(player);
  assert.ok(built.mag > WEAPONS.talon.mag, 'the room ignored the build');
  // A build full of nonsense resolves to the plain gun rather than anything invented.
  player.builds = { talon: { optic: 'not-a-part', mag: 'longscope' } };
  player.kit = null; player.kitFor = null;
  assert.equal(room.currentWeapon(player).mag, WEAPONS.talon.mag);
  room.close();
});

test('the armoury charges for what is bolted on', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const build = { ...emptyBuild(), optic: 'holo', mag: 'extmag' };
  player.builds = { talon: build };
  room.phase = 'buy';
  player.alive = true;
  player.credits = 9000;
  room.buy(player, 'talon');
  assert.equal(player.weapons.primary, 'talon');
  assert.equal(player.credits, 9000 - (WEAPONS.talon.cost + buildCost(build)), 'the build was not charged for');
  assert.ok(player.ammo.primary.mag > WEAPONS.talon.mag, 'the gun was handed over without its mag');
  room.close();
});

// The price the armoury shows and the price it charges are worked out in different files, and only the
// charging end was ever tested. The menu read the base weapon straight out of WEAPONS, so a gun with
// attachments on it advertised the bare price, let you click Buy, and the server then refused it for
// not having enough credits. The gun said 1000 and cost 1700.
test('the armoury shows the price it is going to charge', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const build = { ...emptyBuild(), optic: 'longscope', mag: 'drum' };
  player.builds = { talon: build };
  room.phase = 'buy';
  player.alive = true;
  player.credits = 9000;
  // What the buy menu puts on the row, worked out the way hud.js works it out.
  const shown = resolveWeapon('talon', player.builds.talon).cost;
  const before = player.credits;
  room.buy(player, 'talon');
  assert.equal(player.weapons.primary, 'talon', 'the gun was not handed over');
  assert.equal(before - player.credits, shown, `the menu said ${shown} and the armoury took ${before - player.credits}`);
  assert.ok(shown > WEAPONS.talon.cost, 'this build must cost more than the bare gun, or the test proves nothing');
  room.close();
});

// Afford the built price and you can buy it; afford only the bare price and the row must not invite you.
test('a gun you cannot afford with its attachments is not offered at the bare price', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const build = { ...emptyBuild(), optic: 'longscope', mag: 'drum' };
  player.builds = { talon: build };
  room.phase = 'buy';
  player.alive = true;
  const shown = resolveWeapon('talon', build).cost;
  player.credits = WEAPONS.talon.cost; // exactly the bare price, which is what the menu used to advertise
  assert.ok(player.credits < shown, 'the bare price must be short of the built price for this to mean anything');
  room.buy(player, 'talon');
  assert.notEqual(player.weapons.primary, 'talon', 'the server let it through at the bare price');
  assert.equal(player.credits, WEAPONS.talon.cost, 'and took nothing');
  room.close();
});

// The wiring, since the arithmetic above passes whether or not the menu actually calls it.
test('the buy menu prices and describes a gun as it was built', () => {
  const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');
  const menu = hud.slice(hud.indexOf('  renderBuy()'), hud.indexOf('scoreboardHtml'));
  assert.match(hud, /const built = \(id\) => \(id \? resolveWeapon\(id, game\.you\?\.builds\?\.\[id\]\)/, 'the resolver reads whatever builds the server sent');
  assert.match(menu, /\.map\(\(weapon\) => built\(weapon\.id\)\)/, 'every row is priced from the built gun');
  assert.ok(!/WEAPONS\[you\.weapons\[weapon\.slot\]\]\.cost/.test(menu), 'the refund must be what you paid, attachments included');
  assert.match(menu, /inspectHtml\(built\(this\.buyFocus\)\)/, 'the stat panel shows the built gun, not the bare one');
});

test('battle royale ignores builds entirely', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  player.builds = { talon: { ...emptyBuild(), mag: 'drum' } };
  player.weapons.primary = 'talon';
  player.active = 'primary';
  room.royale = true;
  player.kit = null; player.kitFor = null;
  assert.equal(room.currentWeapon(player), WEAPONS.talon, 'a build reached the royale');
  room.close();
});

test('the Nin Launcher is the most expensive thing in the armoury, and it explodes', () => {
  const nin = WEAPONS.nin;
  assert.ok(nin, 'there is no Nin Launcher');
  const others = Object.values(WEAPONS).filter((weapon) => weapon.id !== 'nin');
  assert.ok(others.every((weapon) => weapon.cost < nin.cost), 'something costs more than the Nin');
  assert.equal(nin.mag, 1, 'more than one rocket in the tube');
  assert.ok(nin.reload >= 5, `a ${nin.reload}s reload is not a bazooka`);
  assert.ok(nin.rocket.radius > 4, 'the blast is too small to be worth 7,200 credits');
  assert.ok(nin.rocket.direct >= 100, 'a rocket in the chest should not be survivable');
  assert.ok(nin.rocket.damage > nin.rocket.minDamage, 'the blast does not fade');
  assert.ok(nin.rocket.direct > nin.rocket.damage, 'wearing the warhead should beat standing near it');
  assert.ok(nin.rocket.selfScale > 0 && nin.rocket.selfScale < 1, 'it should hurt to shoot your own feet, but less');
  assert.ok(nin.speed < 0.85, 'carrying a launcher should slow you down');
});

test('the blast fades with distance, and cover stops it', async () => {
  const { room } = await makeRoom();
  const shooter = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const victim = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's2', name: 'B' }, look);
  victim.team = shooter.team === 'A' ? 'B' : 'A';
  room.phase = 'live';
  const spec = WEAPONS.nin.rocket;
  const blast = (at, struck = null) => {
    // A kill ends the round, which respawns people, so both the round and where they stand go back
    // before each blast. Without the positions, later blasts are measured from a spawn point.
    room.phase = 'live';
    Object.assign(shooter, { x: 0, y: 40, z: 0, alive: true });
    Object.assign(victim, { x: 0, y: 40, z: 0, hp: 100, armor: 0, alive: true });
    room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, at, struck);
    return 100 - victim.hp;
  };
  // High above the map, so nothing is in the way and only the distance matters.
  Object.assign(shooter, { x: 0, y: 40, z: 0 });
  Object.assign(victim, { x: 0, y: 40, z: 0 });
  const mid = [victim.x, victim.y + 0.9, victim.z];
  // Measured from the edge inwards. A kill ends the round and respawns people, so the lethal cases go
  // last: reading a falloff curve after one is reading a fresh spawn's position.
  const edge = blast([mid[0] + spec.radius * 0.85, mid[1], mid[2]]);
  const mid2 = [mid[0] + spec.radius * 0.55, mid[1], mid[2]];
  const far = blast(mid2);
  const outside = blast([mid[0] + spec.radius + 2, mid[1], mid[2]]);
  assert.equal(outside, 0, 'the blast reached past its own radius');
  assert.ok(edge > 5 && edge < 60, `a blast at the edge did ${edge}, which is either nothing or a kill`);
  assert.ok(far > edge, `falloff is backwards: ${far} at 55% of the radius against ${edge} at 85%`);
  // Wearing it is lethal. Only one lethal case is measured here: a kill ends the round and respawns
  // people, so anything read after the first one is reading a fresh spawn rather than the blast.
  assert.ok(blast(mid, victim) > 90, 'a rocket in the chest was survivable');
  // A team mate is safe unless friendly fire is on, but the pilot who fired it never is.
  const mate = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's3', name: 'C' }, look);
  mate.team = shooter.team;
  Object.assign(mate, { x: 0, y: 40, z: 0, alive: true, hp: 100, armor: 0 });
  room.phase = 'live';
  shooter.hp = 100; shooter.armor = 0; shooter.alive = true; victim.alive = false;
  room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, mid, null);
  assert.equal(mate.hp, 100, 'a team mate took the blast with friendly fire off');
  assert.ok(shooter.hp < 100, 'you can stand in your own rocket for free');
  assert.ok(100 - shooter.hp < WEAPONS.nin.rocket.damage, 'your own rocket should hurt less than the full blast');
  room.close();
});

test('cover stops a blast', async () => {
  const { room } = await makeRoom();
  const shooter = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const victim = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's2', name: 'B' }, look);
  victim.team = shooter.team === 'A' ? 'B' : 'A';
  room.phase = 'live';
  for (const player of [shooter, victim]) { player.alive = true; player.hp = 100; player.armor = 0; }
  // Find a solid box on this map and put the blast on the far side of it.
  const wall = room.map.boxes.find((box) => box.max[1] > 1.5 && box.max[0] - box.min[0] > 2);
  assert.ok(wall, 'no cover on this map to hide behind');
  const midX = (wall.min[0] + wall.max[0]) / 2, midZ = (wall.min[2] + wall.max[2]) / 2;
  Object.assign(victim, { x: midX, y: 0, z: wall.min[2] - 1.2 });
  const at = [midX, 0.9, wall.max[2] + 1.2];
  const gap = Math.hypot(at[0] - victim.x, at[2] - victim.z);
  assert.ok(gap < WEAPONS.nin.rocket.radius, 'the test put them too far apart to prove anything');
  room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, at, 0);
  assert.equal(victim.hp, 100, 'the blast went through a wall');
});

test('within a family, the better gun costs more', () => {
  const RANGES = { sniper: [25, 50, 80], marksman: [20, 40, 65], rifle: [10, 25, 45], lmg: [10, 25, 45], smg: [5, 12, 25], shotgun: [3, 7, 14], pistol: [5, 12, 22] };
  // How fast it kills at ranges that family actually fights at, plus how well it moves and how much it holds.
  const power = (weapon) => {
    const dists = RANGES[weapon.family] || [10, 25, 45];
    let kill = 0;
    for (const distance of dists) {
      const perShot = damageFor(weapon, 'torso', distance) * weapon.pellets;
      const shots = Math.max(1, Math.ceil(100 / Math.max(1, perShot)));
      kill += 1 / Math.max(0.2, (shots - 1) * weapon.cooldown + weapon.scopeTime * 0.5 + 0.25);
    }
    return (kill / dists.length) * 2.6 + ((weapon.speed - 0.78) / 0.32) * 0.8 + Math.min(1, weapon.mag / 40) * 0.5;
  };
  const families = {};
  for (const weapon of Object.values(WEAPONS)) {
    // The free starters are the baseline everyone gets, and the launcher is in a class of one.
    if (weapon.melee || weapon.rocket || weapon.cost === 0) continue;
    (families[`${weapon.slot}:${weapon.family}`] ||= []).push(weapon);
  }
  for (const [family, list] of Object.entries(families)) {
    const sorted = [...list].sort((a, b) => power(a) - power(b));
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i].cost >= sorted[i - 1].cost,
        `${family}: ${sorted[i].name} is stronger than ${sorted[i - 1].name} but costs ${sorted[i].cost} against ${sorted[i - 1].cost}`);
    }
  }
});

test('a rocket flies before it goes off, and goes off on whatever it hits', async () => {
  const { room } = await makeRoom();
  const shooter = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  room.phase = 'live';
  shooter.alive = true;
  const booms = [];
  room.broadcast = (message) => { if (message.type === 'boom') booms.push(message.at); };
  const spec = WEAPONS.nin.rocket;
  const fly = (from, dir) => {
    booms.length = 0;
    room.rockets.length = 0;
    room.rockets.push({ id: 'r', owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin,
      x: from[0], y: from[1], z: from[2], vx: dir[0] * spec.speed, vy: dir[1] * spec.speed, vz: dir[2] * spec.speed, born: 0 });
    let ticks = 0;
    while (room.rockets.length && ticks < 300) { room.stepRockets(1 / 30, ticks / 30); ticks += 1; }
    return ticks;
  };
  // Dropped straight down from high up: it flies, then goes off on the ground rather than at the muzzle.
  const ticks = fly([0, 26, 0], [0, -1, 0]);
  assert.ok(ticks > 5, `the rocket went off after ${ticks} ticks, so it never left the tube`);
  assert.equal(booms.length, 1, 'a rocket that hit the ground did not explode');
  // Where it lands depends on the map: what matters is that it travelled before going off.
  assert.ok(booms[0][1] < 20, `the blast went off at ${booms[0][1]} m up, barely past the muzzle`);
  // Fired into the sky it leaves the map and is dropped without exploding over nothing.
  assert.ok(fly([0, 30, 0], [0, 1, 0]) < 300, 'a rocket fired at the sky never stopped');
  room.close();
});


test('every stat an attachment touches has a direction, so the menus can colour it', () => {
  const loose = touchedKeys().filter((key) => !BETTER_UP.has(key) && !BETTER_DOWN.has(key));
  assert.deepEqual(loose, [], `these stats have no better or worse: ${loose.join(', ')}`);
  // And nothing is claimed to be both ways at once.
  for (const key of BETTER_UP) assert.ok(!BETTER_DOWN.has(key), `${key} is in both direction lists`);
});

test('a pistol is not offered a stock or a foregrip', () => {
  assert.equal(partsFor(WEAPONS.p9, 'stock').length, 0, 'a pistol was offered a stock');
  assert.equal(partsFor(WEAPONS.p9, 'grip').length, 0, 'a pistol was offered a foregrip');
  assert.ok(partsFor(WEAPONS.talon, 'stock').length > 0, 'a rifle lost its stocks');
  assert.ok(partsFor(WEAPONS.p9, 'optic').length > 0, 'a pistol cannot take any optic');
  // The launcher takes nothing at all.
  for (const slot of SLOTS) assert.equal(partsFor(WEAPONS.nin, slot).length, 0, `the launcher was offered a ${slot}`);
});

test('a rocket that lands on a surface still splashes off it', async () => {
  const { room } = await makeRoom();
  const shooter = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const victim = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's2', name: 'B' }, look);
  victim.team = shooter.team === 'A' ? 'B' : 'A';
  room.phase = 'live';
  for (const player of [shooter, victim]) { player.alive = true; player.hp = 100; player.armor = 0; }
  // Standing on the ground, with the rocket going off at their feet. The blast sits on the floor it
  // hit, and a line of sight check that starts inside that floor cancels every splash: it did once.
  const spawn = room.map.spawns.A[0];
  Object.assign(shooter, { x: spawn.x + 40, y: spawn.y, z: spawn.z });
  Object.assign(victim, { x: spawn.x, y: spawn.y, z: spawn.z });
  room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, [spawn.x, spawn.y + 0.05, spawn.z], null);
  assert.ok(victim.hp < 100, 'a rocket at their feet did nothing, so the blast is being eaten by the floor');
  room.close();
});

test('your own rocket hurts you, and less than it hurts them', async () => {
  const { room } = await makeRoom();
  const shooter = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  const victim = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's2', name: 'B' }, look);
  victim.team = shooter.team === 'A' ? 'B' : 'A';
  room.phase = 'live';
  const at = [0, 60.9, 0];
  for (const player of [shooter, victim]) { player.alive = true; player.hp = 100; player.armor = 0; Object.assign(player, { x: 0, y: 60, z: 0 }); }
  room.detonate({ owner: shooter.id, team: shooter.team, weapon: WEAPONS.nin }, at, null);
  const mine = 100 - shooter.hp, theirs = 100 - victim.hp;
  assert.ok(mine > 20, `standing in your own rocket only cost ${mine}`);
  assert.ok(mine < theirs, `your own rocket hurt you ${mine} against their ${theirs}`);
  room.close();
});

test('the rocket leaves the tube in front of you, not inside your own head', async () => {
  const { room } = await makeRoom();
  const player = room.join(fakeSocket(), { token: ProfileStore.newToken(), session: 's1', name: 'A' }, look);
  room.phase = 'live';
  player.alive = true;
  player.weapons.primary = 'nin';
  player.active = 'primary';
  player.ammo.primary = { mag: 1, reserve: 3 };
  room.broadcast = () => {};
  const eye = [0, 60, 0];
  room.fire(player, eye, [0, 0, -1], 0, 1);
  assert.equal(room.rockets.length, 1, 'no rocket left the tube');
  const rocket = room.rockets[0];
  const out = Math.hypot(rocket.x - eye[0], rocket.y - eye[1], rocket.z - eye[2]);
  assert.ok(out > 0.5, `the rocket started ${out.toFixed(2)} m from the eye, which is inside the pilot`);
  assert.ok(Math.hypot(rocket.vx, rocket.vy, rocket.vz) > 20, 'the rocket is not moving');
  room.close();
});

// People lost builds because fitting a part only changed a draft, and the draft died with the page
// unless a Save button was found and pressed. Fitting is the save now.
test('fitting a part is what keeps it, with no separate save', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const fit = shop.slice(shop.indexOf('if (d.smithPart)'), shop.indexOf('if (d.smithClear)'));
  assert.match(fit, /keepBuilds\(\)/, 'fitting a part has to reach the server on its own');
  assert.ok(!/data-smith-save/.test(shop), 'and the save button is gone, not just ignored');
  assert.ok(!/smithSave/.test(shop), 'with no handler left behind for it');

  // Batched, so holding a slot open and trying five optics is one message rather than five.
  const saver = shop.slice(shop.indexOf('function keepBuilds'), shop.indexOf('const savedBuild'));
  assert.match(saver, /clearTimeout\(buildTimer\)/, 'a run of changes is debounced into one send');
  assert.match(saver, /type: 'builds'/, 'and it does send the builds');
});

test('stripping a gun is kept too, or the parts would come back', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const clear = shop.slice(shop.indexOf('if (d.smithClear)'), shop.indexOf('if (d.smithClear)') + 200);
  assert.match(clear, /keepBuilds\(\)/, 'taking everything off is a change like any other');
});

// The parts cost match credits, not coins. Showing a coin next to them read as a price in the
// currency people buy skins with, which is not what it is.
test('attachments do not claim to cost coins', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const card = shop.slice(shop.indexOf('function partCard'), shop.indexOf('function partCard') + 700);
  assert.ok(!/coins\(part\.cost\)/.test(card), 'a part must not be priced with the coin mark');
  assert.match(card, /\+\$\$\{part\.cost\}|\+\$/, 'it is a credit price, shown the way a match shows one');
});

test('nothing in the gunsmith is waiting to be saved any more', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../arena.css', import.meta.url), 'utf8');
  assert.ok(!/'\s?unsaved'/.test(shop), 'no unsaved marker is produced');
  assert.ok(!/\.unsaved\b/.test(css), 'and no style is left for one');
});

test('every gun has its own voice, so none of them sound like a pistol', () => {
  // playShot falls back to the P9 for anything it has no entry for, which is how the launcher ended up
  // firing with a pistol crack. A missing entry is silent in every other way, so it needs a test.
  const audio = readFileSync(new URL('../client/audio.js', import.meta.url), 'utf8');
  const table = audio.slice(audio.indexOf('const GUNS = {'), audio.indexOf('\n};', audio.indexOf('const GUNS = {')));
  const listed = new Set([...table.matchAll(/(\w+):\s*\[/g)].map((match) => match[1]));
  const missing = Object.values(WEAPONS).filter((weapon) => !weapon.melee && !listed.has(weapon.id)).map((weapon) => weapon.id);
  assert.deepEqual(missing, [], `these guns fall back to the pistol sound: ${missing.join(', ')}`);
});

test('a launcher never predicts a bullet on the firing client', () => {
  // The client predicts its own shot so it feels instant. For a rocket there is no bullet to predict:
  // doing it anyway drew a tracer and punched impact holes from a weapon that fired no round at all.
  const source = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.match(source, /weapon\.rocket \? 0 : weapon\.pellets/, 'the local shot prediction no longer skips rockets');
});

// The bench: one slot at a time instead of six stacked, and a part you are only considering shows
// what it would do without fitting it.
test('only the open slot draws its parts', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  assert.match(shop, /function smithSlotBody/, 'there is a single body for the open slot');
  assert.match(shop, /partsFor\(base, smithSlot_\)/, 'and it asks only for that slot');
  // The old shape rendered every slot on every draw, which is what made it scroll.
  assert.ok(!/GUN_SLOTS\.map\(\(slot, index\) => smithSlot\(/.test(shop), 'nothing maps every slot into the page any more');
});

test('the rail shows every slot and what is in it', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const rail = shop.slice(shop.indexOf('function smithRail'), shop.indexOf('function smithSlotBody'));
  assert.match(rail, /GUN_SLOTS\.filter/, 'it lists the slots the gun actually takes');
  assert.match(rail, /data-smith-slot=/, 'each one opens its slot');
  assert.match(rail, /filled/, 'and says which are filled');
});

test('considering a part changes nothing about the gun', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const hover = shop.slice(shop.indexOf('export function onShopHover'), shop.indexOf('export function onShopInput'));
  assert.ok(!/smithDrafts/.test(hover), 'hovering must never touch the build');
  assert.ok(!/keepBuilds/.test(hover), 'and must never save anything');
  assert.match(hover, /if \(same\(next, smithHover\)\) return false/, 'and only redraws when the part under the cursor changes');
});

test('the preview compares against the gun as it is, not the stock one', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  assert.match(shop, /smithRow\(peeking \? built : base, shown, row\)/, 'while considering a part the baseline is what is already fitted');
});

test('the hover listener is delegated, not one per card', () => {
  const menu = readFileSync(new URL('../client/menu.js', import.meta.url), 'utf8');
  assert.match(menu, /home\.addEventListener\('pointerover'/, 'one listener on the page');
  const count = (menu.match(/addEventListener\('pointerover'/g) || []).length;
  assert.equal(count, 1, 'and only one, however many parts there are');
});

// The bug people actually hit: a build saved, persisted and reached the server, and the server scored
// with it, but the browser drew the stock gun because it resolved the weapon from the table and never
// looked at the build. Nothing you fitted changed anything you could see or feel, so it read as the
// build never saving at all.
test('the server tells you which build it is scoring with', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-held-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  profiles.saveBuilds(token, { m44: { optic: 'dot' } });

  const room = new Room({ name: 'held', queue: 'casual', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  const player = room.join({ readyState: 1, send: () => {} }, { token, session: 'a', name: 'Pilot' }, look);
  const state = room.youState(player);
  assert.ok(state.builds, 'the you state carries the build');
  assert.equal(state.builds.m44.optic, 'dot', 'and it is the one that was saved');
  room.close();
});

test('the gun in your hands is the one you built, not the stock one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-held2-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  profiles.saveBuilds(token, { m44: { optic: 'dot' } });
  const room = new Room({ name: 'held2', queue: 'casual', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  room.rules.map = 'yard';
  const player = room.join({ readyState: 1, send: () => {} }, { token, session: 'a', name: 'Pilot' }, look);
  const state = room.youState(player);

  // Exactly what client/player.js does with what it is sent.
  const stock = WEAPONS.m44;
  const held = resolveWeapon('m44', state.builds?.m44) || stock;
  assert.notEqual(held.sight, stock.sight, 'a fitted optic changes the sight you look through');
  assert.equal(held.sight, 'dot', 'to the one that was fitted');
  room.close();
});

test('royale hands out floor guns, so no build is sent there', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-held3-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  const token = ProfileStore.newToken();
  profiles.credit(token, 10, 'seed', 'x');
  profiles.saveBuilds(token, { m44: { optic: 'dot' } });
  const { RoyaleRoom } = await import('../server/royale.js');
  const room = new RoyaleRoom({ name: 'roy2', queue: 'royale', profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const player = room.join({ readyState: 1, send: () => {} }, { token, session: 'a', name: 'Pilot' }, look);
  assert.equal(room.youState(player).builds, null, 'a build means nothing where guns come off the floor');
  room.close();
});

test('the browser never resolves a held gun from the table alone', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  const getter = player.slice(player.indexOf('get weapon()'), player.indexOf('get ammo()'));
  assert.match(getter, /resolveWeapon\(/, 'the held gun is resolved through its build');
  assert.match(getter, /game\.you\?\.builds/, 'using the build the server sent, not one the browser guessed');
  assert.match(player, /import \{ resolveWeapon \}/, 'and the import is actually there');
});

// This one has bitten twice. The saver read a variable that was not declared in it, which throws a
// ReferenceError inside a setTimeout: swallowed, silent, and nothing ever sent. Every static check
// passed and the build simply never left the browser.
test('the saver declares everything it sends', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  const fn = shop.slice(shop.indexOf('function keepBuilds'), shop.indexOf('const savedBuild'));
  assert.ok(fn.includes('const dirty = smithDirty()'), 'keepBuilds works out what is dirty itself');
  assert.ok(fn.indexOf('const dirty') < fn.indexOf('dirty.length'), 'and does so before reading it');
  assert.match(fn, /net\.send\(\{ type: 'builds'/, 'and then actually sends it');
});

test('no stray reference to a dirty list outside the saver', () => {
  const shop = readFileSync(new URL('../client/shop.js', import.meta.url), 'utf8');
  // Every mention of `dirty` has to sit in a scope that declares one. There is exactly one such scope.
  const declared = (shop.match(/const dirty = smithDirty\(\)/g) || []).length;
  assert.equal(declared, 1, 'one place works it out');
  const gunsmith = shop.slice(shop.indexOf('function gunsmithHtml'), shop.indexOf('// ------------------------------------------------------------------ games'));
  assert.ok(!/\bdirty\b/.test(gunsmith), 'and the render does not reach for one it never declared');
});

// The gun you hold is a model, and the model is built from the gun's own fittings unless the build
// says otherwise. buildSpec always knew that; it was simply never handed a build, so the first person
// gun kept whatever the weapon came with and a fitted optic never appeared on it.
test('the model builder is told what was fitted', () => {
  const view = readFileSync(new URL('../client/viewmodel.js', import.meta.url), 'utf8');
  const call = view.slice(view.indexOf('buildWeapon('), view.indexOf('buildWeapon(') + 120);
  assert.match(call, /buildWeapon\(id, this\.accent, this\.skins\[id\], this\.builds/, 'the build is the fourth thing buildWeapon takes, and it has to be given one');
});

test('a changed build drops the cached gun', () => {
  const view = readFileSync(new URL('../client/viewmodel.js', import.meta.url), 'utf8');
  const setLook = view.slice(view.indexOf('setLook('), view.indexOf('setWeapon('));
  assert.match(setLook, /JSON\.stringify\(builds\) === JSON\.stringify\(this\.builds\)/, 'a build change has to count as a change, or the old model is kept');
  assert.match(setLook, /this\.builds = \{ \.\.\.builds \}/, 'and the new one is remembered');
});

test('the build arriving mid match reaches the viewmodel', () => {
  const main = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf("net.on('you'"), main.indexOf("net.on('you'") + 700);
  assert.match(handler, /previous\?\.builds.*message\.builds/s, 'it notices when the build changed');
  assert.match(handler, /viewmodel\.setLook\(/, 'and rebuilds the gun when it did');
});

test('fitting irons takes the gun own scope off', () => {
  const guns = readFileSync(new URL('../client/guns.js', import.meta.url), 'utf8');
  const spec = guns.slice(guns.indexOf('function buildSpec'), guns.indexOf('function buildSpec') + 600);
  assert.match(spec, /build\.optic === 'irons'/, 'choosing irons is handled on its own');
  assert.match(spec, /o\.optic = spec\.optic === 'bead' \? 'bead' : 'iron'/, 'and overrides whatever the gun came with');
  // The m44 carries a scope of its own, which is the case that looked broken.
  assert.match(guns, /m44: \{[^}]*optic: 'scope'/, 'the m44 does come with a scope');
});

test('the held gun and its model agree on the build', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.match(player, /heldBuilds\(\)/, 'the model is dressed from the same place the stats come from');
  const state = readFileSync(new URL('../client/state.js', import.meta.url), 'utf8');
  assert.match(state, /game\.you\?\.builds \?\? game\.profile\?\.builds/, 'the server wins in a match, the profile outside one');
});

// Holding jump has to hop whenever there is ground under you. Taking auto bunny hop out took ordinary
// hold to jump with it, so sprinting with a thumb on the bar gave one hop and then nothing, which
// reads as the jump being swallowed.
test('holding jump hops whenever you have footing', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  const gate = player.slice(player.indexOf('const asked ='), player.indexOf('if (asked &&'));
  assert.match(gate, /const asked = jump \|\|/, 'a held jump counts on its own');
  assert.match(gate, /jumpPressedAt.*jumpBuffer/s, 'and a press made just before landing still counts');
});

test('stepping up does not swallow the jump', () => {
  // The rule itself now lives in shared/physics.js as hasFooting; what it does is in flight.test.mjs.
  const physics = readFileSync(new URL('../shared/physics.js', import.meta.url), 'utf8');
  const footing = physics.slice(physics.indexOf('export function hasFooting'), physics.indexOf('export function jumpArc'));
  assert.ok(!/vy/.test(footing), 'rising over a kerb reads as airborne, and refusing the jump there is what made rough ground feel dead');
  assert.match(footing, /if \(onGround\) return true;/, 'ground still counts first');
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.match(player, /const footing = hasFooting\(/, 'the player asks for the rule rather than keeping its own');
});

// A cheek riser raises the eye to a mounted optic. Over irons it sits on the sight line, so aiming put
// the eye inside it.
test('a heavy stock does not block iron sights', () => {
  const guns = readFileSync(new URL('../client/guns.js', import.meta.url), 'utf8');
  const heavy = guns.slice(guns.indexOf("o.stockMod === 'heavy'"), guns.indexOf("o.stockMod === 'heavy'") + 900);
  assert.match(heavy, /const raised = o\.optic !== 'iron' && o\.optic !== 'bead'/, 'the riser asks whether there is anything to rise to');
  assert.match(heavy, /if \(raised\) \{/, 'and only goes on when there is');
  // The recoil pad is the rest of the stock and stays whatever the sight.
  const pad = heavy.slice(heavy.indexOf('if (raised)'));
  assert.match(pad, /k\.box\(m\.black, w \+ 0\.008/, 'the pad is still fitted either way');
});

test('a heavy stock still does what it says to the numbers', async () => {
  const { ATTACHMENTS } = await import('../shared/attachments.js');
  const heavy = ATTACHMENTS.heavystock;
  assert.ok(heavy, 'the part exists');
  assert.ok(heavy.mods && Object.keys(heavy.mods).length, 'and still changes the gun, so hiding the riser is a model change only');
});

// A sight below 40 counts as magnified everywhere in the game: it holds breath, it sways, it draws a
// scope picture. Irons, a dot and a holo magnify nothing, but they only changed the sight and left the
// gun's own zoom in place, so a sniper wearing a red dot still behaved like one looking down glass.
test('a non magnifying optic takes the magnification with it', async () => {
  const { resolveWeapon } = await import('../shared/attachments.js');
  const { WEAPONS } = await import('../shared/constants.js');
  assert.ok(WEAPONS.m44.scope[0] < 40, 'the m44 is magnified to start with');
  for (const id of ['irons', 'dot', 'holo']) {
    const built = resolveWeapon('m44', { optic: id });
    assert.ok(built.scope[0] >= 40, `${id} must leave the gun unmagnified, got ${JSON.stringify(built.scope)}`);
  }
  for (const id of ['prism', 'longscope']) {
    const built = resolveWeapon('m44', { optic: id });
    assert.ok(built.scope[0] < 40, `${id} is glass and stays magnified`);
  }
});

test('the killcam draws the gun that shot you, as it was built', () => {
  const room = readFileSync(new URL('../server/room.js', import.meta.url), 'utf8');
  const roster = room.slice(room.indexOf('title: player.title'), room.indexOf('title: player.title') + 900);
  assert.match(roster, /builds: player\.builds \?/, 'the roster carries what is on their guns');
  assert.match(roster, /Object\.values\(player\.weapons/, 'only the ones they are holding');

  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.match(player, /entry \? \(entry\.builds \|\| \{\}\) : heldBuilds\(\)/, 'watching someone uses their build, not yours');

  const operator = readFileSync(new URL('../client/operator.js', import.meta.url), 'utf8');
  assert.match(operator, /buildWeapon\(weapon\.id, data\.accent \|\| '#ffb547', finish, build\)/, 'and their model is built with it');
});

test('a gun model is cached per build, not just per skin', () => {
  const operator = readFileSync(new URL('../client/operator.js', import.meta.url), 'utf8');
  const key = operator.slice(operator.indexOf('const key = `${weapon.id}'), operator.indexOf('const key = `${weapon.id}') + 200);
  assert.match(key, /build \?/, 'two builds of one gun are two models, or the first one drawn sticks');
  const characters = readFileSync(new URL('../client/characters.js', import.meta.url), 'utf8');
  // The look is compared field by field rather than stringified, so builds has to be one of the fields.
  assert.match(characters, /was\.builds === entry\.builds/, 'and a changed build restyles the pilot');
});

// A setting the browser can change but the server drops is set again every session and never sticks,
// which is how viewDistance went missing. Reading both lists rather than naming a few by hand means a
// setting added later cannot be forgotten, and one removed cannot leave a stale name behind.
test('every setting the browser can set is allowed through', async () => {
  const strip = (text) => text.replace(/\/\/[^\n]*/g, '');
  const block = (text, from) => text.slice(text.indexOf(from), text.indexOf('};', text.indexOf(from)));
  const rules = strip(block(readFileSync(new URL('../server/profiles.js', import.meta.url), 'utf8'), 'const SETTING_RULES'));
  const defaults = strip(block(readFileSync(new URL('../client/state.js', import.meta.url), 'utf8'), 'export const DEFAULT_SETTINGS'));
  const keys = [...defaults.matchAll(/[{,]\s*(\w+):/g)].map((match) => match[1]);
  assert.ok(keys.length > 20, `only found ${keys.length} settings, so the parse is wrong, not the code`);
  // binds and crosshair are sanitised on their own (cleanBinds, cleanCrosshair), so they are not rules.
  for (const key of keys) {
    if (key === 'binds' || key === 'crosshair') continue;
    assert.match(rules, new RegExp(`\\b${key}:`), `${key} is a setting but is not in the whitelist, so it can never be saved`);
  }
  // And nothing is whitelisted that the browser no longer has, which would be a name left behind.
  for (const [, key] of rules.matchAll(/[{,]\s*(\w+):/g)) {
    assert.ok(keys.includes(key), `${key} is whitelisted but is not a setting any more`);
  }
});
