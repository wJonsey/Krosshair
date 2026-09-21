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
