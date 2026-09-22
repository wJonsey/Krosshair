// Slide hopping, after krunker: a clean chain builds speed instead of only holding it, a badly timed
// one bleeds away, and the whole thing stays under the speed the server treats as cheating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODY } from '../shared/constants.js';
import { bhopSpeed, jumpArc, slideEntry, slideSpeedAt, strafeAir } from '../shared/physics.js';

const SERVER_LIMIT = BODY.speedLimit; // what room.js onState actually rejects on

// One hop: open a slide on whatever is carried, ride it, jump out.
const hop = (carried, ridden = 0) => bhopSpeed(slideSpeedAt(slideEntry(carried), ridden));

test('a slide starts as a burst and bleeds back to a crouch', () => {
  const start = slideEntry(0);
  assert.equal(start, BODY.slideSpeed);
  assert.equal(slideSpeedAt(start, 0), start, 'fastest the moment it starts');
  assert.ok(slideSpeedAt(start, BODY.slideTime / 2) < start, 'slower halfway through');
  assert.equal(slideSpeedAt(start, BODY.slideTime), BODY.crouchSpeed, 'by the end it is just a crouch');
  assert.ok(start > BODY.runSpeed, 'sliding beats running, or nobody would do it');
});

test('a clean chain builds speed rather than only holding it', () => {
  let carried = hop(0);
  const first = slideEntry(carried);
  for (let i = 0; i < 6; i += 1) carried = hop(carried);
  const later = slideEntry(carried);
  assert.ok(later > first, `chain did not build: ${first.toFixed(2)} then ${later.toFixed(2)}`);
});

test('the chain converges on its ceiling instead of running away', () => {
  let carried = 0;
  for (let i = 0; i < 400; i += 1) carried = hop(carried);
  const top = slideEntry(carried);
  assert.ok(Math.abs(top - BODY.flowMax) < 0.05, `settled at ${top.toFixed(2)}, not the ${BODY.flowMax} ceiling`);
});

test('no chain can reach the speed the server rejects', () => {
  let carried = 0, peak = 0;
  for (let i = 0; i < 2000; i += 1) {
    const start = slideEntry(carried);
    carried = bhopSpeed(slideSpeedAt(start, 0)); // the most generous exit possible
    peak = Math.max(peak, start, carried);
  }
  assert.ok(peak <= BODY.flowMax, `reached ${peak.toFixed(2)}, over its own ceiling`);
  assert.ok(peak < SERVER_LIMIT, `reached ${peak.toFixed(2)}, which the server rejects at ${SERVER_LIMIT}`);
  assert.ok(SERVER_LIMIT > BODY.flowMax * 1.3, 'the limit leaves room for a network hitch, or good movement gets snapped back');
});

test('timing is the skill: an early exit pays, a late one does not', () => {
  const start = slideEntry(BODY.flowMax);
  const early = bhopSpeed(slideSpeedAt(start, 0.05));
  const late = bhopSpeed(slideSpeedAt(start, BODY.slideTime - 0.05));
  assert.ok(early > late, 'jumping early out of a slide is the better exit');
  assert.ok(late <= BODY.runSpeed, 'leaving it too late is worth nothing');

  // A chain of late exits collapses back to running.
  let carried = BODY.flowMax;
  for (let i = 0; i < 8; i += 1) carried = hop(carried, BODY.slideTime - 0.05);
  assert.ok(slideEntry(carried) <= BODY.slideSpeed, 'sloppy timing gives the speed back');
});

test('a slide hop is a low arc, a moon jump is the tall one', () => {
  const moon = jumpArc(false, false);
  const slideHop = jumpArc(true, false);
  const shortHop = jumpArc(false, true);
  assert.equal(moon, BODY.jumpVelocity, 'standing up first gives the full jump');
  assert.ok(slideHop < moon, 'a slide hop trades height for speed');
  assert.ok(shortHop < moon, 'scoped is the short hop, back on the ground sooner');
  assert.ok(jumpArc(true, true) < slideHop, 'scoped out of a slide is lower still');
});

// What every other test here missed: the curve and the controller were each right on their own. The
// burst was real, but on the ground the velocity only lerped toward it at groundAccel while the curve
// bled away faster than the legs could chase, so a slide crossed a sprint at about 6.9 and was under it
// again a tenth of a second later. Crouching at a run felt like slowing down. These two pin the window.
test('a slide beats a sprint for long enough to be worth doing', () => {
  const start = slideEntry(0);
  let above = 0;
  const dt = 1 / 240;
  for (let t = 0; t < BODY.slideTime; t += dt) if (slideSpeedAt(start, t) > BODY.sprintSpeed) above += dt;
  assert.ok(above > 0.25, `a slide beat a sprint for only ${above.toFixed(2)}s, which reads as slowing down`);
});

test('the burst is spent late, not in the first few frames', () => {
  const start = slideEntry(0);
  const half = slideSpeedAt(start, BODY.slideTime / 2) - BODY.crouchSpeed;
  assert.ok(half > (start - BODY.crouchSpeed) * 0.5, 'half way through, most of the burst is still there');
});

test('air strafing pays by the second, not by the frame', () => {
  const ride = (fps) => { let flow = 8; for (let i = 0; i < fps; i += 1) flow = strafeAir(flow, true, true, 1 / fps); return flow; };
  const slow = ride(30), fast = ride(240);
  assert.ok(Math.abs(slow - fast) < 0.02, `a second of strafing was worth ${slow.toFixed(2)} at 30fps and ${fast.toFixed(2)} at 240`);
  assert.ok(fast > 8 && fast < 8 * BODY.strafeBonus * 1.01, 'and a second of it is worth about the bonus, once');
});

test('air strafing pays, but only in the air and only mid chain', () => {
  const flow = 9;
  assert.ok(strafeAir(flow, true, true) > flow, 'strafing in the air mid chain is worth something');
  assert.equal(strafeAir(flow, false, true), flow, 'on the ground it is not, so nobody has to walk diagonally');
  assert.equal(strafeAir(flow, true, false), flow, 'and not without a strafe');
  assert.equal(strafeAir(0, true, true), 0, 'nothing to multiply with no chain going');
  assert.ok(strafeAir(BODY.flowMax, true, true) <= BODY.flowMax, 'it cannot push past the ceiling');
});

test('the ceiling holds whatever it is handed', () => {
  assert.ok(slideEntry(500) <= BODY.flowMax);
  assert.ok(bhopSpeed(500) <= BODY.flowMax);
  assert.ok(strafeAir(500, true, true) <= BODY.flowMax);
  assert.ok(BODY.flowMax < SERVER_LIMIT, 'the ceiling itself is under what the server allows');
});

// The bug this caught first time around: the chain window was shorter than a jump, so a bhop could
// never continue. Flow is held through the air and only bleeds on the ground, so the jump is covered.
test('speed carried out of a slide survives a full jump arc', () => {
  const air = 2 * BODY.jumpVelocity * BODY.slideArc / BODY.gravity;
  const carried = hop(BODY.flowMax, 0.05);
  assert.ok(carried > BODY.runSpeed, 'there is something to carry');
  assert.ok(Math.max(0, carried - BODY.flowDecay * air) > 0 || air < 1, `a ${air.toFixed(2)}s hop must not outlast the chain`);
  assert.equal(Math.max(0, carried - BODY.flowDecay * 1.5), 0, 'standing about for a moment ends it');
});

// Air acceleration. The old model lerped toward a wish velocity, which dragged a fast pilot back down
// to walking pace: gaining speed by strafing was arithmetically impossible. These pin the behaviour
// that replaced it.
import { airAccelerate } from '../shared/physics.js';

// Hold a strafe and sweep the mouse, which is the whole technique.
function strafeFor(startSpeed, turnRate, seconds, dt = 1 / 60) {
  const vel = { x: 0, z: startSpeed };
  let yaw = 0;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    yaw += turnRate * dt;
    const a = yaw + Math.PI / 4;
    airAccelerate(vel, Math.sin(a), Math.cos(a), BODY.runSpeed, dt);
  }
  return Math.hypot(vel.x, vel.z);
}

test('air strafing gains speed, and gains more the better it is done', () => {
  const still = strafeFor(BODY.runSpeed, 0, 1);
  const gentle = strafeFor(BODY.runSpeed, 0.8, 1);
  const sharp = strafeFor(BODY.runSpeed, 2.5, 1);
  assert.ok(Math.abs(still - BODY.runSpeed) < 0.01, 'pointing straight ahead gains nothing, as it should');
  assert.ok(gentle > still, 'turning into the strafe is what pays');
  assert.ok(sharp > gentle, `and sweeping harder pays more: ${gentle.toFixed(2)} then ${sharp.toFixed(2)}`);
});

test('momentum is never washed out by the air model', () => {
  const vel = { x: 0, z: 9 };
  for (let i = 0; i < 120; i += 1) airAccelerate(vel, 0, 1, BODY.runSpeed, 1 / 60);
  assert.ok(Math.hypot(vel.x, vel.z) >= 9 - 0.001, 'holding forward at speed must not drag you back down');
});

test('air strafing cannot climb past the ceiling however long it goes on', () => {
  for (const turn of [1, 2.5, 6, 20]) {
    const top = strafeFor(BODY.flowMax, turn, 12);
    assert.ok(top <= BODY.flowMax + 0.001, `sweep ${turn} reached ${top.toFixed(2)}, over the ceiling`);
    assert.ok(top < BODY.speedLimit, `sweep ${turn} reached ${top.toFixed(2)}, which the server rejects`);
  }
});

test('the air model gives the same speed at any frame rate', () => {
  const rates = [30, 60, 144, 360].map((fps) => strafeFor(BODY.runSpeed, 1.5, 1, 1 / fps));
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(spread < 0.25, `frame rate changed the outcome by ${spread.toFixed(3)} m/s: ${rates.map((r) => r.toFixed(2)).join(', ')}`);
});

// The speed ladder. Sprint was added by dropping the base and giving it back on the key, so the order
// of every tier matters and the top of it still has to sit under what the server will accept.
test('every speed tier is in the right order and under the limit', () => {
  const ladder = [BODY.crouchSpeed, BODY.walkSpeed, BODY.runSpeed, BODY.sprintSpeed, BODY.slideSpeed, BODY.flowMax];
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(ladder[i] > ladder[i - 1], `tier ${i} (${ladder[i]}) is not above the one below it (${ladder[i - 1]})`);
  }
  assert.ok(BODY.flowMax < BODY.speedLimit, 'the fastest a pilot can legitimately move is under the reject threshold');
});

test('sprint is the way into a slide', () => {
  assert.ok(BODY.sprintSpeed > BODY.slideMin, 'sprinting is comfortably enough to start a slide');
  assert.ok(BODY.slideSpeed > BODY.sprintSpeed, 'and a slide is still worth more than the sprint into it');
});

// Dropping the base speed would otherwise have made everyone less accurate on the move, because spread
// scales against a reference speed. It is its own constant now and must not follow the base around.
test('adding sprint did not quietly change gunplay', () => {
  assert.equal(BODY.spreadSpeed, 6.0, 'the spread reference is the speed it always was');
  assert.notEqual(BODY.spreadSpeed, BODY.runSpeed, 'and is deliberately not tied to the new base');
});

// Sliding is a question of intent, not a speed reading. Once the base run came down to make room for
// sprint, the old threshold sat 0.4 m/s under a plain run and above a heavy gun's run altogether, so
// the slide fired only sometimes and never at all with an LMG in hand.
test('a run slides, a walk does not, whatever the gun', async () => {
  const { WEAPONS } = await import('../shared/constants.js');
  const slowest = Math.min(...Object.values(WEAPONS).map((w) => w.speed).filter((n) => typeof n === 'number'));
  const canSlide = (speed, walking) => !walking && speed >= BODY.slideMin;

  assert.equal(canSlide(0, false), false, 'stood still is not a slide');
  assert.equal(canSlide(BODY.walkSpeed, true), false, 'walking on purpose is not a slide');
  assert.ok(canSlide(BODY.runSpeed, false), 'a plain run slides');
  assert.ok(canSlide(BODY.runSpeed * slowest, false), 'and so does a run carrying the heaviest gun');
  assert.ok(canSlide(BODY.runSpeed * slowest * 0.7, false), 'and it survives the dip from a hard turn');
});

test('the slide floor sits under the slowest run there is', async () => {
  const { WEAPONS } = await import('../shared/constants.js');
  const slowest = Math.min(...Object.values(WEAPONS).map((w) => w.speed).filter((n) => typeof n === 'number'));
  const worst = BODY.runSpeed * slowest;
  assert.ok(BODY.slideMin < worst * 0.8, `slideMin ${BODY.slideMin} leaves no room under the slowest run ${worst.toFixed(2)}`);
  assert.ok(BODY.slideMin > 0, 'but stood still still cannot slide');
});

// Slow walking is gone. It shared a key with sprint, it was a third speed nobody asked for, and the
// one thing worth keeping from it, holding breath, moved to the same key. Shift runs you when you are
// hipfiring and steadies you when you are aimed, so one key never does two jobs at once.
test('there is no walk action left to collide with sprint', () => {
  const input = readFileSync(new URL('../client/input.js', import.meta.url), 'utf8');
  const actions = input.slice(input.indexOf('export const ACTIONS'), input.indexOf('export const DEFAULT_BINDS'));
  assert.ok(!/'walk'/.test(actions), 'walk is not an action a key can be bound to');
  const binds = input.slice(input.indexOf('export const DEFAULT_BINDS'), input.indexOf('export const RESERVED'));
  assert.ok(!/walk:/.test(binds), 'and has no default key');
  assert.match(binds, /sprint: \['ShiftLeft', 'ShiftRight'\]/, 'Shift is sprint and nothing else');
});

test('holding breath survived the removal', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  // Breath reads the key itself, never the toggle: a toggle would hold your breath for ever.
  assert.match(player, /this\.holdingBreath = sprintKeyHeld && scoped && !this\.winded/, 'the sniper mechanic moved rather than went');
  // Aimed down a magnified optic, the same key steadies instead of sprinting, so they never fight.
  assert.match(player, /const sprintKey = sprintHeld && !scoped/, 'sprint stands down while you are aimed');
});

// Some keyboards cannot report Shift, W and Space at once, so a pilot holding sprint simply never
// jumps: the keydown never reaches the browser and no amount of game code can conjure it. A toggle
// takes the held key out of the combination entirely.
test('sprint can be a toggle, so it need not be held with anything else', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.match(player, /const sprintHeld = game\.settings\.toggleSprint \? this\.sprintToggle : sprintKeyHeld/, 'the toggle stands in for the key');
  assert.match(player, /action === 'sprint' && game\.settings\.toggleSprint/, 'and a press flips it');
  assert.ok(/this\.sprintToggle = false/.test(player), 'it clears on spawn like the others');
  const settings = readFileSync(new URL('../client/state.js', import.meta.url), 'utf8');
  assert.match(settings, /toggleSprint: false/, 'off by default, so holding Shift stays the norm');
  const profiles = readFileSync(new URL('../server/profiles.js', import.meta.url), 'utf8');
  assert.match(profiles, /toggleSprint: 'bool'/, 'and it survives a reload, or the setting is a lie');
});

// Screen shake was random jitter on the camera, added on every shot. Through a magnified scope it read
// as the whole picture juddering, which is what got reported. Nothing else ever read it.
test('nothing shakes the camera any more', () => {
  const player = readFileSync(new URL('../client/player.js', import.meta.url), 'utf8');
  assert.ok(!/this\.shake/.test(player), 'no shake state left to feed the camera');
  const camera = player.match(/this\.camera\.rotation\.set\([^;]*\);/)[0];
  assert.ok(!/shake/.test(camera), `the camera still takes a shake term: ${camera}`);
});

test('nothing still asks the player to press a key that is gone', () => {
  for (const file of ['../client/hud.js', '../client/menu.js', '../client/player.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/bindLabel\('walk'\)|one\('walk'\)|held\(keys, 'walk'\)/.test(source), `${file} still names the walk key, which would print UNBOUND`);
  }
});

test('bots still have their slow approach', async () => {
  // walkSpeed stays as data: bots close on a goal at it. Only the player's key went.
  assert.ok(BODY.walkSpeed > 0, 'the speed is still there');
  const bots = readFileSync(new URL('../server/bots.js', import.meta.url), 'utf8');
  assert.match(bots, /BODY\.walkSpeed/, 'and bots still use it');
});
