// Slide hopping, after krunker: a clean chain builds speed instead of only holding it, a badly timed
// one bleeds away, and the whole thing stays under the speed the server treats as cheating.
import test from 'node:test';
import assert from 'node:assert/strict';
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
