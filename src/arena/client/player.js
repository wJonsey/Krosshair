// Local pilot: input (keyboard, mouse, gamepad), predicted movement, weapon
// handling, scope sway + breath, gadgets, drone piloting, spectating, killcam.
import * as THREE from 'three';
import { BODY, FLAG, GADGETS, INTERP_DELAY, MATERIALS, WEAPONS, clamp } from '../shared/constants.js';
import { SpreadTracker, applySpread, ballisticsFor, hashString, mulberry32, spreadAngle, traceShot } from '../shared/combat.js';
import { airAccelerate, bhopSpeed, groundAccelerate, hasFooting, jumpArc, makeBody, slideEntry, slideSpeedAt, strafeAir } from '../shared/physics.js';
import { resolveWeapon } from '../shared/attachments.js';
import { bus, game, isEnemy, heldBuilds } from './state.js';
import { devState } from './devtools.js';
import { DEV_FLY_LIFT, DEV_FLY_SPEED, DEV_SPEED } from '../shared/devtools.js';
import { PAD_TAP_HOLD, WHEEL_HOLD, actionsFor, bindsFor, held, mouseCode, padBindFor, padHeld, setInputMode, wheelCode } from './input.js';
import { net } from './net.js';
import { DROP, PAD_LAUNCH } from '../shared/royale.js';
import { play, playShot, playImpact, playFootstep, startLoop, loop } from './audio.js';

const SLOTS = ['primary', 'sidearm', 'melee'];
const forward = new THREE.Vector3();
const scratchDir = new THREE.Vector3(), scratchTo = new THREE.Vector3();
// Controller aim assist. Deliberately mild: it slows the stick near a pilot and drifts the aim a little
// while you are already moving it. No snapping, no auto fire, no help through walls.
const AIM_ASSIST = { cone: 0.26, range: 110, pull: 6.5, slow: 0.62 };

export class LocalPlayer {
  constructor({ camera, arena, viewmodel, effects, operators, canvas }) {
    Object.assign(this, { camera, arena, viewmodel, effects, operators, canvas });
    this.body = makeBody();
    this.vel = { x: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.mode = 'idle'; // idle | play | dead | killcam | spectate | replay | drone
    this.alive = false;
    this.epoch = 0;
    this.keys = new Set();
    this.buttons = { fire: false, scope: false };
    this.pad = { fire: false, scope: false, prev: new Set(), active: false, aim: 0, uiWait: 0, uiHeld: false };
    this.crouchToggle = false; this.scopeToggle = false; this.sprintToggle = false;
    this.crouching = false; this.crouchAmount = 0;
    // Slide and bhop: `flow` is the speed being carried through a chain, in m/s. 0 means not flowing.
    this.slide = { since: -1, start: 0, endedAt: -1 };
    this.flow = 0;
    // Jump feel: a press just before landing still counts, and stepping off an edge leaves a moment
    // where a jump is still owed to you. Both are about the input never being silently dropped.
    this.jumpPressedAt = -1; this.leftGroundAt = -1; this.jumpHeld = false; this.jumped = false;
    this.scopeAmount = 0; this.zoomIndex = 0;
    this.viewY = 0; this.recoilPitch = 0; this.recoilYaw = 0; this.swayTime = 0;
    this.breath = 1; this.holdingBreath = false; this.winded = false;
    this.suppression = 0; this.deathTime = 0;
    this.active = 'primary'; this.nextFire = 0; this.equipUntil = 0; this.reloadEnd = 0; this.reloadSlot = null; this.reloadStage = 0;
    this.seq = 0; this.spread = { primary: new SpreadTracker(), sidearm: new SpreadTracker() };
    this.stride = 0; this.stateTimer = 0; this.lookX = 0; this.lookY = 0; this.speed = 0;
    this.spectateId = null; this.pendingKillcam = null; this.drone = null;
    this.uiBlocked = () => false;
    this.gravityScale = 1;
    this.wallCheck = 0; this.wallAmount = 0;
    this.drop = null;                 // royale: { chute } while coming down from the sky
    this.boost = { speed: 1, speedUntil: 0, jump: 1, jumpUntil: 0 }; // timed pickups, performance.now() clock
    this.bind();
  }

  // The gun as the server built it, not the stock one off the shelf. The server sends the build it is
  // actually scoring with, so the sight you fitted is the sight you look through and the feel matches
  // the numbers. Reading WEAPONS directly here was why a saved build appeared to do nothing in a match.
  get weapon() {
    const id = game.you?.weapons?.[this.active];
    if (!id) return WEAPONS.knife;
    return resolveWeapon(id, game.you?.builds?.[id]) || WEAPONS[id] || WEAPONS.knife;
  }
  get ammo() { return game.you?.ammo?.[this.active] || null; }
  get locked() { return document.pointerLockElement === this.canvas; }
  get canAct() { return this.alive && this.mode === 'play' && !this.uiBlocked(); }
  get combatOpen() { const phase = game.room?.phase; return phase === 'live' || phase === 'overtime' || phase === 'range'; }

  // A wheel notch has no release of its own, so it gets a short one. Held down the whole window, then
  // let go, which is the same shape as a very quick tap.
  pulse(code) {
    this.press(code);
    clearTimeout(this.wheelTimers?.[code]);
    this.wheelTimers = this.wheelTimers || {};
    this.wheelTimers[code] = setTimeout(() => this.keys.delete(code), WHEEL_HOLD * 1000);
  }

  // One entry point for keys and mouse buttons, so anything can be bound to anything.
  press(code) {
    this.keys.add(code);
    setInputMode('kbm');
    bus.emit('key', code);
    const actions = actionsFor(code);
    if (!this.canAct) { if (this.mode === 'killcam' && actions.includes('jump')) this.skipKillcam(); return; }
    for (const action of actions) {
      if (action === 'fire') this.fireHeld = false;
      // Only when the gun can actually come up. Pressing aim during the Anvil's 5.2 s reload used to
      // latch the toggle, so it snapped into the sight by itself the moment the reload finished.
      if (action === 'scope' && game.settings.toggleScope && !this.reloadEnd && !this.weapon.melee) this.scopeToggle = !this.scopeToggle;
      if (action === 'reload') this.reload();
      if (action === 'inspect' && this.alive && this.scopeAmount < 0.1) this.viewmodel.inspect();
      if (action === 'primary' || action === 'sidearm' || action === 'melee') this.switchTo(action);
      if (action === 'gadget1') this.useGadget(0);
      if (action === 'gadget2') this.useGadget(1);
      if (action === 'ping') this.ping();
      if (action === 'crouch' && game.settings.toggleCrouch) this.crouchToggle = !this.crouchToggle;
      if (action === 'sprint' && game.settings.toggleSprint) this.sprintToggle = !this.sprintToggle;
    }
  }
  releaseTriggers() { for (const code of [...bindsFor('fire'), ...bindsFor('scope')]) this.keys.delete(code); }

  bind() {
    addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (game.screen !== 'game') return;
      // Stop the browser acting on anything the pilot has bound (Tab, Space, Ctrl+W …).
      if (['Tab', 'Space'].includes(event.code) || (actionsFor(event.code).length && !event.metaKey) || (event.ctrlKey && actionsFor(event.code).length)) event.preventDefault();
      if (event.repeat) return;
      this.press(event.code);
    });
    addEventListener('keyup', (event) => this.keys.delete(event.code));
    addEventListener('blur', () => { this.keys.clear(); });
    addEventListener('mousedown', (event) => {
      if (game.screen !== 'game' || this.uiBlocked() || event.target !== this.canvas) return;
      if (!this.locked) { this.lock(); return; }
      if (this.mode === 'spectate') { this.cycleSpectate(event.button === 2 ? -1 : 1); return; }
      if (this.mode === 'drone') { if (event.button === 0) net.send({ type: 'drone-end' }); return; }
      if (event.button !== 0 && event.button !== 2) event.preventDefault();
      this.press(mouseCode(event));
    });
    addEventListener('mouseup', (event) => this.keys.delete(mouseCode(event)));
    addEventListener('contextmenu', (event) => { if (game.screen === 'game') event.preventDefault(); });
    addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      const scopedSens = this.scopeAmount > 0.5 ? game.settings.scopeSensitivity * (this.camera.fov / game.settings.fov) * 1.6 : 1;
      const k = 0.0021 * game.settings.sensitivity * scopedSens;
      this.look(event.movementX * k, event.movementY * k * (game.settings.invertY ? -1 : 1));
    });
    addEventListener('wheel', (event) => {
      if (!this.canAct || !this.locked) return;
      // A wheel bound to something does that instead of changing weapon, so scroll jumping is possible.
      const code = wheelCode(event);
      if (actionsFor(code).length) { this.pulse(code); return; }
      const scopes = this.weapon.scope || [];
      if (this.scopeAmount > 0.5 && scopes.length > 1) { this.zoomIndex = (this.zoomIndex + 1) % scopes.length; play('scope'); return; }
      const owned = SLOTS.filter((slot) => game.you?.weapons?.[slot]);
      const index = owned.indexOf(this.active);
      this.switchTo(owned[(index + (event.deltaY > 0 ? 1 : owned.length - 1)) % owned.length]);
    }, { passive: true });
  }

  look(dx, dy) {
    this.yaw -= dx; this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
    this.lookX += dx * 400; this.lookY += dy * 400;
  }

  lock() {
    if (game.screen !== 'game' || this.locked) return;
    const request = this.canvas.requestPointerLock?.();
    if (request?.catch) request.catch(() => {});
  }

  // ------------------------------------------------------------ server events
  onSpawn(message) {
    this.epoch = message.epoch;
    if (!message.keep || !this.everSpawned) {
      this.everSpawned = true;
      Object.assign(this.body, { x: message.x, y: message.y, z: message.z, vy: 0, onGround: true, height: BODY.height });
      this.yaw = message.yaw; this.pitch = 0;
      // High above the island: this is the royale drop. Look down and steer.
      this.drop = message.y > 60 ? { chute: false } : null;
      if (this.drop) { this.body.onGround = false; this.body.vy = -12; this.pitch = -0.9; }
      this.boost.speedUntil = 0; this.boost.jumpUntil = 0;
      this.vel.x = 0; this.vel.z = 0;
    }
    this.viewY = this.body.y;
    this.alive = true; this.mode = 'play';
    this.crouching = false; this.crouchToggle = false; this.scopeToggle = false; this.sprintToggle = false; this.crouchAmount = 0; this.scopeAmount = 0;
    this.slide = { since: -1, start: 0, endedAt: -1 }; this.flow = 0;
    this.jumpPressedAt = -1; this.leftGroundAt = -1; this.jumpHeld = false; this.jumped = false;
    this.recoilPitch = 0; this.recoilYaw = 0; this.suppression = 0; this.breath = 1;
    this.reloadEnd = 0; this.nextFire = 0;
    this.spectateId = null; this.pendingKillcam = null;
    this.operators.hidden = null; this.operators.stopReplay(); this.endPov();
    this.endDrone();
    this.active = game.you?.weapons?.primary ? 'primary' : 'sidearm';
    this.viewmodel.hidden = false;
    this.viewmodel.setWeapon(this.weapon.id, false);
    bus.emit('spawned');
  }

  onYou(previous) {
    const you = game.you;
    if (!you) return;
    if (you.active && you.active !== this.active && this.alive && !this.reloadEnd && performance.now() / 1000 > this.equipUntil + 0.4) this.active = you.active;
    if (!you.weapons[this.active]) this.active = you.weapons.primary ? 'primary' : 'sidearm';
    if (this.alive) this.viewmodel.setWeapon(this.weapon.id);
  }

  onCorrect(message) { Object.assign(this.body, { x: message.x, y: message.y, z: message.z, vy: 0 }); this.vel.x = 0; this.vel.z = 0; }

  onDeath(killcam) {
    if (!this.alive) return;
    this.alive = false;
    this.mode = 'dead';
    this.deathTime = 0;
    this.scopeAmount = 0; this.releaseTriggers();
    this.viewmodel.hidden = true;
    this.pendingKillcam = killcam || this.pendingKillcam;
    this.endDrone();
    play('death');
  }

  startDrone(message) {
    this.mode = 'drone';
    this.drone = { body: { x: message.x, y: message.y - 0.15, z: message.z, radius: 0.2, height: 0.3, vy: 0, onGround: false }, yaw: message.yaw, pitch: 0, until: message.until };
    this.savedView = { yaw: this.yaw, pitch: this.pitch };
    this.viewmodel.hidden = true;
    this.operators.pilotView = true;
    startLoop('drone-self', 'drone');
    bus.emit('drone', true);
  }
  endDrone() {
    if (!this.drone) return;
    this.drone = null;
    loop('drone-self')?.stop();
    this.operators.pilotView = false;
    if (this.savedView) { this.yaw = this.savedView.yaw; this.pitch = this.savedView.pitch; }
    if (this.alive) { this.mode = 'play'; this.viewmodel.hidden = false; }
    bus.emit('drone', false);
  }

  startKillcam(replay) {
    this.mode = 'killcam';
    this.operators.hidden = replay.killer;
    this.operators.startReplay(replay, () => this.endKillcam());
    this.beginReplayPov(replay, 0, [0.6, 0.45]);
    bus.emit('pov-card', { kind: 'killcam', replay });
  }
  skipKillcam() { if (this.mode === 'killcam') { this.operators.stopReplay(); this.endKillcam(); } }
  endKillcam() {
    this.endPov();
    this.operators.hidden = null;
    bus.emit('pov-card', null);
    this.mode = 'spectate';
    this.spectateId = null;
    this.cycleSpectate(1);
  }

  // Round over: survivors and the fallen alike watch the kill that ended it.
  startRoundReplay(replay) {
    this.endDrone();
    this.operators.stopReplay();
    this.endPov();
    this.pendingKillcam = null;
    this.mode = 'replay';
    this.scopeAmount = 0; this.releaseTriggers(); this.scopeToggle = false;
    this.operators.hidden = replay.killer;
    const from = Math.max(0, replay.duration - 3);
    this.operators.startReplay(replay, () => {
      this.endPov();
      this.operators.hidden = null;
      bus.emit('pov-card', null);
      if (this.alive) { this.mode = 'play'; this.viewmodel.hidden = false; } else { this.mode = 'spectate'; this.spectateId = null; this.cycleSpectate(1); }
    }, { from });
    this.beginReplayPov(replay, from, [0.8, 0.4]);
    bus.emit('pov-card', { kind: 'round', replay });
  }

  startFinalReplay(replay, onDone) {
    this.mode = 'replay';
    this.alive = false;
    this.viewmodel.hidden = true;
    this.operators.hidden = replay.killer;
    const from = Math.max(0, replay.duration - 2.6);
    this.operators.startReplay(replay, () => { this.endPov(); this.operators.hidden = null; bus.emit('pov-card', null); this.mode = 'idle'; onDone(); }, { from });
    this.beginReplayPov(replay, from, [1.1, 0.3]);
    bus.emit('pov-card', { kind: 'final', replay });
  }

  // First-person view of another pilot (killcams, replays, spectating): their gun in hand, scoping and firing as they did.
  beginPov(owner, weapon, extra = {}) {
    const entry = game.roster.get(owner);
    this.pov = { owner, weapon: WEAPONS[weapon] ? weapon : 'm44', scope: 0, lastYaw: null, lastPitch: null, mag: null, ...extra };
    this.viewmodel.setLook(entry?.color || game.look.color, entry?.accent || game.look.accent, entry ? entry.skins || {} : game.look.skins, entry ? entry.charm : game.look.charm, entry ? (entry.builds || {}) : heldBuilds());
    this.viewmodel.setWeapon(this.pov.weapon, true);
    this.viewmodel.hidden = false;
  }
  beginReplayPov(replay, from, slow) {
    // Older servers only sent the killing shot.
    const shots = replay.shots?.length ? replay.shots : [{ t: replay.duration, weapon: replay.weapon, melee: Boolean(WEAPONS[replay.weapon]?.melee), origin: replay.origin, ends: [replay.end], hit: true }];
    let next = shots.findIndex((shot) => shot.t >= from - 0.05);
    if (next < 0) next = shots.length;
    const weapon = WEAPONS[replay.weapon] || WEAPONS.m44;
    const before = shots[next - 1], upcoming = shots[next];
    const mag = before?.mag ?? (upcoming?.mag != null ? upcoming.mag + 1 : weapon.mag);
    this.beginPov(replay.killer, replay.weapon, { replay, shots, next, slow, mag });
  }
  endPov() {
    if (!this.pov) return;
    this.pov = null;
    this.viewmodel.hidden = !this.alive;
    this.viewmodel.setLook(game.look.color, game.look.accent, game.look.skins, game.look.charm, heldBuilds());
    if (this.alive) this.viewmodel.setWeapon(this.weapon.id, true);
    this.resetFov();
  }
  // The weapon the camera is currently holding (someone else's while watching through their eyes).
  get viewWeapon() { return (this.pov && WEAPONS[this.pov.weapon]) || this.weapon; }

  spectateTargets() {
    const team = game.roster.get(game.id)?.team;
    // Dead in your own match you follow your own side. Watching someone else's there is no side to be
    // on, and a watcher is deliberately not in the roster, so asking for their team gives nothing to
    // match and the list comes back empty.
    const everyone = Boolean(game.watching) || game.room?.royale;
    return [...game.roster.values()].filter((p) => p.id !== game.id && p.alive && (everyone || p.team === team) && this.operators.poseOf(p.id)).map((p) => p.id);
  }
  cycleSpectate(step) {
    const list = this.spectateTargets();
    if (!list.length) { this.spectateId = null; this.operators.hidden = null; bus.emit('spectate', null); return; }
    const index = list.indexOf(this.spectateId);
    this.spectateId = list[(index + step + list.length) % list.length];
    this.operators.hidden = this.spectateId;
    bus.emit('spectate', this.spectateId);
  }

  // ------------------------------------------------------------ actions
  switchTo(slot) {
    if (!slot || slot === this.active || !game.you?.weapons?.[slot] || !this.canAct) return;
    this.active = slot;
    this.reloadEnd = 0; this.viewmodel.cancelReload();
    this.scopeToggle = false; this.zoomIndex = 0;
    const now = performance.now() / 1000;
    this.equipUntil = now + this.weapon.equip;
    this.viewmodel.setWeapon(this.weapon.id);
    play('equip');
    net.send({ type: 'switch', slot });
  }

  reload() {
    const weapon = this.weapon, ammo = this.ammo;
    if (!this.canAct || weapon.melee || !ammo || this.reloadEnd || ammo.mag >= weapon.mag) return;
    if (ammo.reserve <= 0 && game.room?.mode !== 'range') return;
    const now = performance.now() / 1000;
    this.reloadEnd = now + weapon.reload; this.reloadSlot = this.active; this.reloadStage = 0;
    this.scopeToggle = false;
    this.viewmodel.reload(weapon.reload);
    play('reloadOut');
    net.send({ type: 'reload' });
    bus.emit('tutorial', 'reload');
  }

  useGadget(slot) {
    const id = game.you?.gadgets?.[slot];
    if (!id || !this.canAct || !this.combatOpen) return;
    net.send({ type: 'gadget', slot });
    bus.emit('tutorial', 'gadget');
  }

  ping() {
    if (!this.alive || game.screen !== 'game') return;
    this.camera.getWorldDirection(forward);
    const origin = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    const dir = [forward.x, forward.y, forward.z];
    const trace = traceShot(this.arena.physics, origin, dir, { ...WEAPONS.p9, pen: 0 }, this.operators.targets(), 200);
    const danger = trace.hits.length > 0;
    net.send({ type: 'ping-loc', x: trace.end[0], y: trace.end[1], z: trace.end[2], danger });
  }

  tryFire(now) {
    const weapon = this.weapon;
    if (now < this.nextFire || now < this.equipUntil || !this.combatOpen) return;
    if (weapon.melee) {
      this.nextFire = now + weapon.cooldown;
      this.viewmodel.melee();
      play('swing');
      net.send({ type: 'melee', t: net.time() - INTERP_DELAY });
      return;
    }
    if (this.reloadEnd) return;
    const ammo = this.ammo;
    if (!ammo || ammo.mag <= 0) { if (!this.fireHeld) { play('dry'); this.reload(); } this.fireHeld = true; return; }
    if (!weapon.auto && this.fireHeld) return;
    this.fireHeld = true;
    ammo.mag -= 1;
    this.nextFire = now + weapon.cooldown;
    this.seq += 1;
    this.camera.getWorldDirection(forward);
    const origin = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    const dir = [forward.x, forward.y, forward.z];
    net.send({ type: 'fire', seq: this.seq, t: net.time() - INTERP_DELAY, o: origin, d: dir });

    // Predict the visuals locally with the same seeded spread the server will use.
    const scoped = this.scopeAmount > 0.97;
    const bloom = this.spread[this.active]?.shot(weapon, now) || 0;
    const angle = spreadAngle(weapon, { scoped, speed: this.speed, airborne: !this.body.onGround, crouched: this.crouching, bloom });
    const rng = mulberry32(hashString(game.id || '') + this.seq * 7919);
    const muzzle = this.viewmodel.muzzleWorld(this.camera, this.scopeAmount);
    const tracerColor = game.look.tracer || '#ffc857';
    // A launcher fires a rocket, not a round. The server flies it and broadcasts it back, so predicting
    // a bullet here drew a tracer and punched holes in whatever was downrange, from a weapon that never
    // fired a bullet at all.
    for (let pellet = 0; pellet < (weapon.rocket ? 0 : weapon.pellets); pellet += 1) {
      const shotDir = applySpread(dir, angle, rng);
      const trace = traceShot(this.arena.physics, origin, shotDir, weapon, this.operators.targets(), 260, ballisticsFor(weapon, this.arena.map));
      this.effects.tracer([muzzle.x, muzzle.y, muzzle.z], trace.end, tracerColor, 0.012 + weapon.tracer * 0.012);
      if (weapon.trail) this.effects.trail([muzzle.x, muzzle.y, muzzle.z], trace.end);
      trace.impacts.slice(0, 3).forEach((impact) => { this.effects.impact(impact.point, impact.normal, impact.mat, impact.exit); if (!impact.exit && pellet < 2) playImpact(MATERIAL_SOUND(impact.mat), impact.point, 0.5); });
      trace.hits.forEach((hit) => { const p = [origin[0] + shotDir[0] * hit.distance, origin[1] + shotDir[1] * hit.distance, origin[2] + shotDir[2] * hit.distance]; this.effects.hitPuff(p); });
    }
    this.effects.muzzleLight(muzzle, '#ffb45e', this.arena.variantName === 'night' ? 40 : 20);
    this.viewmodel.fire(weapon);
    playShot(weapon.id);
    if (weapon.action === 'bolt') play('bolt', { delay: 0.32, volume: 0.7 });
    if (weapon.action === 'pump') play('pump', { delay: 0.28, volume: 0.8 });
    const recoil = weapon.recoil;
    this.recoilPitch += (recoil.kick * Math.PI) / 180 * (scoped ? 0.8 : 1);
    this.recoilYaw += ((Math.random() - 0.5) * 2 * recoil.side * Math.PI) / 180;
    if (weapon.action === 'bolt') this.scopeToggle = false;
    bus.emit('fired', weapon);
    bus.emit('tutorial', 'fire');
  }

  // ------------------------------------------------------------ frame update
  pollPad(dt) {
    const pad = [...(navigator.getGamepads?.() || [])].find((entry) => entry && entry.connected);
    const state = { mx: 0, mz: 0 };
    this.pad.active = false;
    if (!pad) { this.pad.fire = false; this.pad.scope = false; this.pad.prev = new Set(); return state; }
    const dead = (value) => (Math.abs(value) < 0.16 ? 0 : (value - Math.sign(value) * 0.16) / 0.84);
    state.mx = dead(pad.axes[0] || 0); state.mz = dead(pad.axes[1] || 0);
    const lx = dead(pad.axes[2] || 0), ly = dead(pad.axes[3] || 0);
    // Every button as a code, so the pad reads from its own bind table like the keyboard does.
    const down = new Set();
    pad.buttons.forEach((button, index) => { if (button.pressed || button.value > 0.4) down.add(`Pad${index}`); });
    const was = this.pad.prev;
    const tap = (action) => { const code = padBindFor(action); return Boolean(code && down.has(code) && !was.has(code)); };
    if (down.size || lx || ly || state.mx || state.mz) { this.pad.active = true; setInputMode('pad', pad); }
    // With a menu open the pad drives the menu, not the pilot. These read the raw buttons rather than the
    // bind table: a menu button has to sit where every pad puts it, whatever the pilot bound for the game.
    if (this.uiBlocked()) {
      const raw = (code) => down.has(code) && !was.has(code);
      const dx = (down.has('Pad15') ? 1 : 0) - (down.has('Pad14') ? 1 : 0) || Math.round(state.mx * 0.9) || Math.round(lx * 0.9);
      const dy = (down.has('Pad13') ? 1 : 0) - (down.has('Pad12') ? 1 : 0) || Math.round(state.mz * 0.9) || Math.round(ly * 0.9);
      // A held direction repeats: a beat before the second step, then quickly, the way a menu should feel.
      if (!dx && !dy) { this.pad.uiWait = 0; this.pad.uiHeld = false; } else if ((this.pad.uiWait -= dt) <= 0) {
        this.pad.uiWait = this.pad.uiHeld ? 0.11 : 0.36;
        this.pad.uiHeld = true;
        if (dy) bus.emit('pad-ui', dy > 0 ? 'down' : 'up');
        else bus.emit('pad-ui', dx > 0 ? 'right' : 'left');
      }
      if (raw('Pad0')) bus.emit('pad-ui', 'confirm');
      if (raw('Pad1')) bus.emit('pad-ui', 'back');
      if (raw('Pad4')) bus.emit('pad-ui', 'tabPrev');
      if (raw('Pad5')) bus.emit('pad-ui', 'tabNext');
      if (tap('menu')) bus.emit('key', 'Escape');
      this.pad.prev = down;
      state.mx = 0; state.mz = 0;
      return state;
    }
    const zoom = this.scopeAmount > 0.5 ? 0.35 : 1;
    // Aim assist eases the stick down when the crosshair is near a pilot, so a small stick move stays small.
    const slow = 1 - this.pad.aim * AIM_ASSIST.slow;
    if (lx || ly) this.look(lx * Math.abs(lx) * 3.2 * dt * game.settings.padSensitivity * zoom * slow, ly * Math.abs(ly) * 2.4 * dt * game.settings.padSensitivity * zoom * slow * (game.settings.invertY ? -1 : 1));
    this.pad.stick = Math.hypot(lx, ly);
    this.pad.fire = padHeld(down, 'fire');
    if (tap('fire')) this.fireHeld = false;
    this.pad.scope = padHeld(down, 'scope');
    this.pad.jump = padHeld(down, 'jump');
    this.pad.sprint = padHeld(down, 'sprint');
    if (this.canAct) {
      if (tap('crouch')) this.crouchToggle = !this.crouchToggle;
      if (tap('reload')) this.reload();
      if (tap('swap')) { const owned = SLOTS.filter((slot) => game.you?.weapons?.[slot]); this.switchTo(owned[(owned.indexOf(this.active) + 1) % owned.length]); }
      if (tap('gadget1')) this.useGadget(0);
      if (tap('gadget2')) this.useGadget(1);
      if (tap('ping')) this.ping();
      if (tap('melee')) this.switchTo('melee');
      // These live on the keyboard's side of the game, so the pad presses their key for them. The
      // event on its own was not enough: royale asks whether the pick up key is held, and a pad press
      // put nothing in the key set, so a controller could never pick a gun up. Hold it for a moment
      // instead, which is what anything polling the keys is waiting to see.
      for (const action of ['interact', 'armoury']) {
        if (!tap(action)) continue;
        const code = bindsFor(action)[0] || bindsFor(action)[1];
        bus.emit('key', code);
        if (!code) continue;
        this.padHold = this.padHold || {};
        clearTimeout(this.padHold[code]);
        this.keys.add(code);
        this.padHold[code] = setTimeout(() => this.keys.delete(code), PAD_TAP_HOLD * 1000);
      }
      if (tap('inspect') && this.scopeAmount < 0.1) this.viewmodel.inspect();
    } else if (this.mode === 'spectate' && tap('jump')) this.cycleSpectate(1);
    else if (this.mode === 'killcam' && tap('jump')) this.skipKillcam();
    if (tap('menu')) bus.emit('key', 'Escape');
    if (tap('scoreboard')) bus.emit('pad-scoreboard');
    this.pad.prev = down;
    return state;
  }

  // Aim assist, controller only. Two gentle helpers, both off unless a pilot is near the crosshair and in
  // the open: the stick slows down (above) and the aim drifts a little toward them. It never fires, never
  // locks on, and never moves the aim on its own when the stick is still.
  aimAssist(dt) {
    this.pad.aim = 0;
    if (!this.pad.active || !this.alive || game.settings.aimAssist === false || this.mode !== 'play') return;
    const camera = this.camera, origin = camera.position;
    const forward = scratchDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    let best = null, bestAngle = AIM_ASSIST.cone;
    for (const target of this.operators.targets()) {
      if (target.kind !== 'player') continue;
      const to = scratchTo.set(target.x - origin.x, target.y + (target.crouch ? 0.95 : 1.35) - origin.y, target.z - origin.z);
      const dist = to.length();
      if (dist < 1.2 || dist > AIM_ASSIST.range) continue;
      to.multiplyScalar(1 / dist);
      const angle = Math.acos(Math.min(1, Math.max(-1, to.dot(forward))));
      if (angle > bestAngle) continue;
      // Only for a pilot you can actually see.
      if (!this.arena.physics.lineOfSight(origin.x, origin.y, origin.z, target.x, target.y + (target.crouch ? 0.95 : 1.35), target.z)) continue;
      bestAngle = angle; best = { to: to.clone(), angle, dist };
    }
    if (!best) return;
    // Full help dead on the target, fading to nothing at the edge of the cone.
    const closeness = 1 - best.angle / AIM_ASSIST.cone;
    this.pad.aim = closeness;
    // The drift only helps while you are already moving the stick, and never more than a few degrees a second.
    const moving = Math.min(1, (this.pad.stick || 0) * 2.2);
    if (!moving) return;
    const wantYaw = Math.atan2(-best.to.x, -best.to.z);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, best.to.y)));
    const pull = AIM_ASSIST.pull * closeness * moving * dt * (this.scopeAmount > 0.5 ? 0.5 : 1);
    this.yaw += Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw)) * Math.min(1, pull);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, pull);
  }

  update(dt, wallDt = dt) {
    const now = performance.now() / 1000;
    const pad = this.pollPad(dt);
    this.lookX *= 0.6; this.lookY *= 0.6;
    this.suppression = Math.max(0, this.suppression - dt * 0.55);
    // Below 20 fps the simulation sub-steps so movement keeps its real speed instead of going slow-motion.
    if (this.mode === 'play' || this.mode === 'drone') {
      for (let remaining = Math.max(dt, wallDt); remaining > 1e-4; remaining -= 0.05) {
        const step = Math.min(0.05, remaining);
        if (this.mode === 'play') this.updatePlay(step, now, pad); else if (this.mode === 'drone') this.updateDrone(step, pad);
      }
    }
    if (this.mode === 'play') this.aimAssist(dt);
    else if (this.mode === 'dead') this.updateDead(wallDt);
    else if (this.mode === 'killcam' || this.mode === 'replay') this.updateReplayCamera(wallDt);
    else if (this.mode === 'spectate') this.updateSpectate(wallDt);
    this.sendState(wallDt);
  }

  // Derived from what the body is actually doing, so the readout can never claim one thing while the
  // physics does another.
  get moveState() {
    if (this.slide.since >= 0) return 'SLIDING';
    if (!this.body.onGround) return this.flow > BODY.runSpeed ? 'FLOWING' : 'AIRBORNE';
    if (this.crouching) return 'CROUCHING';
    if (this.speed < 0.4) return 'IDLE';
    // Slow movement is scoped or shouldering a wall now, not a walk key, so it is just moving.
    if (this.speed <= BODY.walkSpeed + 0.3) return 'MOVING';
    return this.speed > BODY.runSpeed + 0.3 ? 'SPRINTING' : 'RUNNING';
  }
  get horizontalSpeed() { return Math.hypot(this.vel.x, this.vel.z); }

  updatePlay(dt, now, pad) {
    const body = this.body, weapon = this.weapon;
    const blocked = this.uiBlocked();
    const keys = blocked ? new Set() : this.keys;
    // --- stance
    // crouchToggle is driven by the keyboard in toggle mode and always by the gamepad's B button.
    const wantCrouch = this.crouchToggle || (!game.settings.toggleCrouch && held(keys, 'crouch'));
    // Shift is the only speed key there is. Slow walking is gone: it shared a key with sprint, it was
    // a third tier nobody asked for, and the thing actually worth keeping from it was holding breath,
    // which now lives on the same key. You cannot meaningfully sprint down a scope, so Shift means
    // run when you are hipfiring and steady when you are aimed.
    // Sprint can be a toggle, like crouch and aim: some keyboards cannot see Shift, W and Space at once,
    // and a key you never hold cannot be part of that. Breath stays on the key itself either way, because
    // a toggle would leave you holding your breath for ever.
    const sprintKeyHeld = held(keys, 'sprint') || this.pad.sprint;
    const sprintHeld = game.settings.toggleSprint ? this.sprintToggle : sprintKeyHeld;
    if (wantCrouch && !this.crouching) {
      this.crouching = true; body.height = BODY.crouchHeight;
      // Crouch at a run and it is a slide, not a stoop. Land one inside bhopWindow of the last and the
      // speed carries; otherwise it opens at the standard burst.
      const rested = this.slide.endedAt < 0 || now - this.slide.endedAt >= BODY.slideCooldown;
      // Whether a crouch becomes a slide is a question of intent, not a measurement. Speed dips every
      // time you turn or brush a wall, and once the base run came down for sprint a heavy gun never
      // reached the old threshold at all, so the slide fired only sometimes and never with an LMG.
      // Running rather than walking, and actually moving, is the whole test.
      const running = this.speed >= BODY.slideMin;
      if (body.onGround && rested && (running || this.flow > 0)) {
        // Whatever is still being carried opens the slide. Flow holds through the air and only bleeds
        // once you are back on your feet, so the timing window is the decay, not a number picked here.
        this.slide = { since: now, start: slideEntry(this.flow), endedAt: -1 };
        this.flow = this.slide.start;
        play('land', { volume: 0.35 });
      }
    } else if (!wantCrouch && this.crouching) {
      if (this.arena.physics.bodyFree(body.x, body.y, body.z, body.radius, BODY.height)) { this.crouching = false; body.height = BODY.height; }
    }
    // A slide runs out on its own, or the moment you stand up.
    if (this.slide.since >= 0 && (!this.crouching || now - this.slide.since >= BODY.slideTime || !body.onGround)) {
      this.slide = { since: -1, start: 0, endedAt: now };
    }
    if (this.slide.since < 0 && this.flow > 0 && body.onGround) this.flow = Math.max(0, this.flow - BODY.flowDecay * dt);
    this.crouchAmount += ((this.crouching ? 1 : 0) - this.crouchAmount) * Math.min(1, dt * 12);
    // --- scope
    const canScope = !weapon.melee && !this.reloadEnd && now >= this.equipUntil && !blocked;
    const wantScope = canScope && ((!game.settings.toggleScope && held(keys, 'scope')) || this.pad.scope || this.scopeToggle);
    const before = this.scopeAmount;
    this.scopeAmount = clamp(this.scopeAmount + (wantScope ? dt : -dt * 1.6) / (weapon.scopeTime || 0.15), 0, 1);
    if (before === 0 && this.scopeAmount > 0) { play('scope'); bus.emit('tutorial', 'scope'); }
    if (!wantScope && before > 0 && this.scopeAmount === 0) this.zoomIndex = 0;
    // --- breath
    // Sprint is the pace a slide is meant to be entered from. Walking wins if both are held, and
    // scoping already slows you, so sprint quietly does nothing while you are looking down a scope.
    const scoped = this.scopeAmount > 0.9 && Boolean(weapon.scope?.[0] < 40);
    const sprintKey = sprintHeld && !scoped;
    this.holdingBreath = sprintKeyHeld && scoped && !this.winded;
    if (this.holdingBreath) { this.breath = Math.max(0, this.breath - dt * 0.3); if (this.breath === 0) { this.winded = true; } } else { this.breath = Math.min(1, this.breath + dt * 0.22); if (this.winded && this.breath > 0.45) this.winded = false; }
    // --- movement
    let mx = pad.mx, mz = pad.mz;
    if (held(keys, 'forward')) mz -= 1; if (held(keys, 'back')) mz += 1; if (held(keys, 'left')) mx -= 1; if (held(keys, 'right')) mx += 1;
    const length = Math.hypot(mx, mz);
    if (length > 1) { mx /= length; mz /= length; }
    let maxSpeed = (sprintKey ? BODY.sprintSpeed : BODY.runSpeed) * (weapon.speed || 1);
    if (this.crouching) maxSpeed = BODY.crouchSpeed;
    // A live slide overrides the crouch it came from, and speed carried out of one holds in the air.
    if (this.slide.since >= 0) { this.flow = slideSpeedAt(this.slide.start, now - this.slide.since); maxSpeed = Math.max(maxSpeed, this.flow); }
    else if (this.flow > 0) {
      // Holding a strafe in the air keeps the chain alive and pays a little for it.
      this.flow = strafeAir(this.flow, !body.onGround, mx !== 0 && mz !== 0, dt);
      maxSpeed = Math.max(maxSpeed, this.flow);
    }
    if (devState.speed) maxSpeed *= DEV_SPEED;
    if (devState.fly) maxSpeed = BODY.runSpeed * DEV_FLY_SPEED * (this.crouching ? 0.35 : 1);
    if (this.scopeAmount > 0.3) maxSpeed *= 0.55;
    const clock = performance.now();
    if (clock < this.boost.speedUntil) maxSpeed *= this.boost.speed;
    const jumpKey = !blocked && (held(keys, 'jump') || this.pad.jump);
    if (this.drop) {
      if (body.onGround) { this.drop = null; bus.emit('royale-landed'); }
      else {
        if (!this.drop.chute && (body.y < DROP.chuteAt || (jumpKey && body.y < DROP.height - 25))) { this.drop.chute = true; play('equip', { volume: 0.9 }); }
        maxSpeed = this.drop.chute ? DROP.chuteGlide : DROP.glide;
      }
    }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (mx * cos + mz * sin) * maxSpeed, wishZ = (-mx * sin + mz * cos) * maxSpeed;
    if (body.onGround && this.slide.since >= 0 && !this.drop) {
      // A slide is a shove, not a speed to accelerate into. Left to the ground acceleration the burst
      // was never reached: the curve had already bled below a sprint by the time the legs caught up, so
      // crouching at a run read as slowing down. The slide sets the speed and the stick only steers it.
      const carrying = Math.hypot(this.vel.x, this.vel.z);
      let dirX = carrying > 0.05 ? this.vel.x / carrying : -sin, dirZ = carrying > 0.05 ? this.vel.z / carrying : -cos;
      if (mx || mz) {
        const len = Math.hypot(wishX, wishZ) || 1;
        const turn = Math.min(1, BODY.slideSteer * dt);
        dirX += (wishX / len - dirX) * turn; dirZ += (wishZ / len - dirZ) * turn;
        const unit = Math.hypot(dirX, dirZ) || 1; dirX /= unit; dirZ /= unit;
      }
      this.vel.x = dirX * this.flow; this.vel.z = dirZ * this.flow;
    } else if (body.onGround || this.drop) {
      // On your feet, and under a parachute, you go where you point.
      const k = Math.min(1, (this.drop ? 3.5 : BODY.groundAccel) * dt);
      this.vel.x += (wishX - this.vel.x) * k; this.vel.z += (wishZ - this.vel.z) * k;
    } else if (mx || mz) {
      // Airborne with a direction asked for: add along it only, so turning into a held strafe builds
      // speed instead of washing it out. Nothing happens with no input, which is how momentum is kept.
      const len = Math.hypot(wishX, wishZ) || 1;
      airAccelerate(this.vel, wishX / len, wishZ / len, maxSpeed, dt);
    }
    // What the chain is worth now follows the real velocity, so air strafing feeds the next slide.
    if (!body.onGround && this.flow > 0) this.flow = Math.max(this.flow, Math.min(BODY.flowMax, Math.hypot(this.vel.x, this.vel.z)));
    const jump = !blocked && (held(keys, 'jump') || this.pad.jump);
    // Jumping out of a slide is the whole point of one, so crouch no longer blocks it. Leave it late
    // and there is nothing left to carry, which is what makes the timing worth learning.
    const sliding = this.slide.since >= 0;
    // Remember the press, not just the hold: a jump asked for a frame before landing is owed.
    if (jump && !this.jumpHeld) this.jumpPressedAt = now;
    this.jumpHeld = jump;
    if (body.onGround) { this.leftGroundAt = -1; this.jumped = false; } else if (this.leftGroundAt < 0) this.leftGroundAt = now;
    // Holding jump hops whenever there is ground under you, which is what every shooter does and what
    // sprinting with a thumb on the bar expects. The skill in a bhop is the slide timing, getting out
    // of one early rather than late, and that is untouched: this only decides whether you leave the
    // floor at all. The buffer covers a press made a moment before landing.
    const asked = jump || (this.jumpPressedAt >= 0 && now - this.jumpPressedAt <= BODY.jumpBuffer);
    // Walking off an edge leaves a moment where a jump is still owed, and stepping up a kerb reads as
    // airborne as well, so which way you are going does not matter.
    const footing = hasFooting(body.onGround, this.jumped, this.leftGroundAt, now);
    if (asked && footing && (!this.crouching || sliding)) {
      // Out of a slide it is a low fast arc that keeps the speed. Stand up first and you get the full
      // height instead, which is the trade when you need to reach something rather than cover ground.
      body.vy = jumpArc(sliding, this.scopeAmount > 0.3) * (clock < this.boost.jumpUntil ? this.boost.jump : 1);
      body.onGround = false;
      this.jumpPressedAt = -1; this.jumped = true;
      if (sliding) { this.flow = bhopSpeed(slideSpeedAt(this.slide.start, now - this.slide.since)); this.slide = { since: -1, start: 0, endedAt: now }; }
      play('jump'); bus.emit('tutorial', 'jump');
    }
    const gravity = this.drop || devState.fly ? 0 : BODY.gravity * this.gravityScale; // the drop sets its own fall speed
    body.vy = Math.max(-40, body.vy - gravity * dt);
    if (this.drop) { const fall = this.drop.chute ? -DROP.chuteFall : -DROP.fall; body.vy += (fall - body.vy) * Math.min(1, dt * (this.drop.chute ? 2.6 : 1.4)); }
    const fallSpeed = body.vy;
    const beforeX = body.x, beforeZ = body.z, wasGrounded = body.onGround;
    if (devState.fly) {
      const lift = ((jumpKey ? 1 : 0) - (held(keys, 'crouch') ? 1 : 0)) * DEV_FLY_LIFT;
      body.vy = 0; body.onGround = false;
      body.x += this.vel.x * dt; body.y += lift * dt; body.z += this.vel.z * dt;
    } else this.arena.physics.moveBody(body, this.vel.x * dt, body.vy * dt, this.vel.z * dt);
    const movedX = body.x - beforeX, movedZ = body.z - beforeZ;
    if (dt > 0) { if (Math.abs(movedX) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x *= 0.5; if (Math.abs(movedZ) < Math.abs(this.vel.z * dt) * 0.5) this.vel.z *= 0.5; }
    const { bounds } = this.arena.map;
    body.x = clamp(body.x, bounds.minX + 0.4, bounds.maxX - 0.4); body.z = clamp(body.z, bounds.minZ + 0.4, bounds.maxZ - 0.4);
    if (body.y < bounds.minY - 3) { body.y = 0.5; body.vy = 0; }
    // Jump pads (royale): step on one and it throws you at the nearest roof.
    if (body.onGround && this.arena.map.pads) for (const [px, pz] of this.arena.map.pads) if (Math.abs(body.x - px) < 1 && Math.abs(body.z - pz) < 1 && body.y < 0.6) { body.vy = PAD_LAUNCH; body.onGround = false; this.jumped = true; play('jump'); play('ready', { volume: 0.6 }); bus.emit('royale-pad'); break; }
    const moved = Math.hypot(movedX, movedZ);
    this.speed = dt > 0 ? moved / dt : 0;
    if (body.onGround && !wasGrounded && fallSpeed < -4) { play('land', { volume: Math.min(1, -fallSpeed / 12) }); this.viewmodel.land(-fallSpeed / 10); }
    if (body.onGround && this.speed > 3.6 && !this.crouching) {
      this.stride += moved;
      if (this.stride > 2.1) { this.stride = 0; playFootstep(this.operators.surfaceAt(body.x, body.y, body.z), null, game.you && this.ghostUntil > now ? 0.12 : 0.5); }
    }
    if (length > 0.2) bus.emit('tutorial', 'move');
    if (this.crouching) bus.emit('tutorial', 'crouch');

    // --- weapons
    if (this.reloadEnd) {
      const progress = 1 - (this.reloadEnd - now) / weapon.reload;
      if (this.reloadStage === 0 && progress > 0.55) { this.reloadStage = 1; play('reloadIn'); }
      if (now >= this.reloadEnd) {
        this.reloadEnd = 0;
        const ammo = game.you?.ammo?.[this.reloadSlot];
        if (ammo && this.reloadSlot === this.active) { const range = game.room?.mode === 'range'; const take = Math.min(weapon.mag - ammo.mag, range ? weapon.mag : ammo.reserve); ammo.mag += take; if (!range) ammo.reserve -= take; }
        play('reloadDone');
      }
    }
    const firing = (held(this.keys, 'fire') || this.pad.fire) && !blocked;
    if (firing) this.tryFire(now); else this.fireHeld = false;

    // --- camera
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, dt * weapon.recoil?.recover || dt * 6);
    this.recoilYaw += (0 - this.recoilYaw) * Math.min(1, dt * 7);
    this.swayTime += dt;
    // Sway is what a held rifle really does: a slow figure of eight from breathing, a faster small tremor
    // from the muscles, a wander that never quite repeats. It moves the gun in your hands and nothing
    // else: the head holds still, so the shot goes where the sights are rather than where sway left them.
    const st = this.swayTime;
    const breatheX = Math.sin(st * 0.95), breatheY = Math.sin(st * 1.9 + 0.6) * 0.6;
    const tremorX = Math.sin(st * 7.3) * 0.12 + Math.sin(st * 11.1 + 2) * 0.07, tremorY = Math.sin(st * 8.7 + 1) * 0.12 + Math.sin(st * 12.9) * 0.07;
    const wanderX = Math.sin(st * 0.37 + 4) * 0.5, wanderY = Math.sin(st * 0.29 + 1.7) * 0.4;
    const effort = (this.crouching ? 0.55 : 1) * (1 + Math.min(1.5, this.speed / 3)) * (1 + this.suppression * 2.2) * (this.holdingBreath ? 0.12 : 1) * (this.winded ? 2.1 : 1) * (weapon.sway || 1);
    const patternX = (breatheX + tremorX + wanderX) * effort, patternY = (breatheY + tremorY + wanderY) * effort;
    // The gun drifts in your hands; your head does not, and aiming settles the drift. The wander is
    // life at the hip; down the sights almost all of it goes, because glass magnifies the gun moving
    // into the whole picture swimming. What is left is the part holding breath calms.
    const settle = 1 - this.scopeAmount * 0.88;
    this.gunSway = [patternX * settle, patternY * settle];
    const eye = THREE.MathUtils.lerp(BODY.eye, BODY.crouchEye, this.crouchAmount);
    const dy = body.y - this.viewY;
    if (Math.abs(dy) > 0.7 || !body.onGround) this.viewY = body.y; else this.viewY += dy * Math.min(1, dt * 16);
    this.camera.position.set(body.x, this.viewY + eye, body.z);
    // The dev No sway tool takes the wobble and the kick out of the view.
    if (devState.nospread) { this.recoilPitch = 0; this.recoilYaw = 0; }
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, 0, 'YXZ');
    const baseFov = game.settings.fov;
    const zoomFov = weapon.scope ? weapon.scope[Math.min(this.zoomIndex, weapon.scope.length - 1)] : baseFov;
    const eased = this.scopeAmount * this.scopeAmount * (3 - 2 * this.scopeAmount);
    // A magnified scope does its own zooming through the glass; the view around it only tightens a little.
    const glass = weapon.sight === 'scope' || weapon.sight === 'prism';
    if (glass) this.viewmodel.scopeMag = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / Math.tan(THREE.MathUtils.degToRad(Math.min(baseFov, zoomFov)) / 2);
    // Irons, beads, dots and holos do not magnify: aiming only tightens the view a little.
    const fov = THREE.MathUtils.lerp(baseFov, glass ? baseFov * 0.8 : Math.max(Math.min(baseFov, zoomFov), baseFov * 0.8), eased);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // How far the gun would poke into whatever is in front of it (0 none → 1 muzzle fully blocked).
    this.wallCheck = (this.wallCheck + 1) % 2;
    if (this.wallCheck === 0) {
      const length = weapon.melee ? 0 : Math.min(1.25, 0.34 - (this.viewmodel.current?.userData.front ?? -0.5));
      let wall = 0;
      if (length > 0) {
        const cp = Math.cos(this.pitch), dir = [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
        const hit = this.arena.physics.raycast([this.camera.position.x, this.camera.position.y - 0.1, this.camera.position.z], dir, length, (box) => !box.deco)[0];
        if (hit) wall = 1 - Math.max(0.25, hit.t0) / length;
      }
      this.wallAmount = wall;
    }
    // Shoved right back, the sights are no use: the aim comes off until there is room again.
    const room = 1 - THREE.MathUtils.clamp((this.wallAmount - 0.25) / 0.35, 0, 1);
    this.viewmodel.update(dt, { aimSway: this.gunSway, wall: this.wallAmount, speed: this.speed, onGround: body.onGround, scoped: eased * room, lookX: this.lookX, lookY: this.lookY, crouch: this.crouching, pitch: this.pitch, strafe: (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) / 6 });
  }

  updateDrone(dt, pad) {
    const drone = this.drone;
    if (!drone) return;
    const keys = this.keys;
    // Mouse look steers the drone while piloting.
    drone.yaw = this.yaw; drone.pitch = this.pitch;
    let mx = pad.mx, mz = pad.mz, my = 0;
    if (held(keys, 'forward')) mz -= 1; if (held(keys, 'back')) mz += 1; if (held(keys, 'left')) mx -= 1; if (held(keys, 'right')) mx += 1;
    if (held(keys, 'jump')) my += 1; if (held(keys, 'crouch')) my -= 1;
    const sin = Math.sin(drone.yaw), cos = Math.cos(drone.yaw);
    const speed = 8.5;
    const body = drone.body;
    this.arena.physics.moveBody(body, (mx * cos + mz * sin) * speed * dt, 0, (-mx * sin + mz * cos) * speed * dt);
    const beforeY = body.y;
    this.arena.physics.moveAxis(body, 1, (my * 5 + Math.sin(this.pitch) * -mz * speed * 0.6) * dt);
    body.y = clamp(body.y, this.arena.map.bounds.minY + 0.2, 14);
    if (!Number.isFinite(body.y)) body.y = beforeY;
    this.camera.position.set(body.x, body.y + 0.15, body.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(performance.now() / 300) * 0.01, 'YXZ');
    if (this.camera.fov !== 92) { this.camera.fov = 92; this.camera.updateProjectionMatrix(); }
    this.viewmodel.update(dt, { speed: 0, onGround: true, scoped: 0, lookX: 0, lookY: 0, crouch: false });
  }

  updateDead(dt) {
    this.deathTime += dt;
    const k = Math.min(1, this.deathTime / 0.7);
    const ease = 1 - (1 - k) ** 2;
    this.camera.position.set(this.body.x, this.body.y + THREE.MathUtils.lerp(BODY.eye, 0.35, ease), this.body.z);
    this.camera.rotation.set(this.pitch * (1 - ease) + 0.25 * ease, this.yaw, ease * 0.9, 'YXZ');
    this.resetFov();
    if (this.deathTime > 1.5) {
      if (this.pendingKillcam) { const replay = this.pendingKillcam; this.pendingKillcam = null; this.startKillcam(replay); } else if (this.deathTime > 2.2) { this.mode = 'spectate'; this.cycleSpectate(1); }
    }
  }

  resetFov() { if (Math.abs(this.camera.fov - game.settings.fov) > 0.01) { this.camera.fov = game.settings.fov; this.camera.updateProjectionMatrix(); } }

  updateReplayCamera(dt) {
    const replay = this.operators.replay;
    const pov = this.pov;
    if (!replay || !pov?.shots) return;
    const entity = replay.entities.get(replay.data.killer);
    if (!entity) return;
    // Slow right down for the killing shot.
    const [window, slow] = pov.slow || [0.6, 0.45];
    const left = replay.data.duration - replay.time;
    replay.speed = left < window && left > -0.35 ? slow : 1;
    // Play every shot the killer took inside the window.
    while (pov.next < pov.shots.length && replay.time >= pov.shots[pov.next].t) this.povShot(pov.shots[pov.next++]);
    this.updatePovCamera(entity.state, dt, replay.speed);
  }

  updatePovCamera(s, dt, timeScale = 1) {
    const pov = this.pov;
    if (s.weapon && s.weapon !== pov.weapon && WEAPONS[s.weapon]) { pov.weapon = s.weapon; pov.mag = null; this.viewmodel.setWeapon(s.weapon); }
    const weapon = WEAPONS[pov.weapon] || this.weapon;
    // Ease the scope in and out from the networked flag, at the weapon's real ADS speed.
    const wantScope = Boolean(s.flags & FLAG.scoped) && !weapon.melee;
    const step = dt * timeScale / (weapon.scopeTime || 0.15);
    pov.scope = clamp(pov.scope + (wantScope ? step : -step * 1.6), 0, 1);
    const eased = pov.scope * pov.scope * (3 - 2 * pov.scope);
    const crouch = Boolean(s.flags & FLAG.crouch);
    this.camera.position.set(s.x, s.y + (crouch ? BODY.crouchEye : BODY.eye), s.z);
    this.camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    const baseFov = game.settings.fov;
    const zoomFov = weapon.scope ? Math.min(baseFov, weapon.scope[0]) : baseFov;
    const glass = weapon.sight === 'scope' || weapon.sight === 'prism';
    if (glass) this.viewmodel.scopeMag = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / Math.tan(THREE.MathUtils.degToRad(zoomFov) / 2);
    const fov = THREE.MathUtils.lerp(baseFov, glass ? baseFov * 0.8 : Math.max(zoomFov, baseFov * 0.8), eased);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Turn speed drives the weapon sway like mouse movement does.
    const lookX = pov.lastYaw === null ? 0 : -((s.yaw - pov.lastYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 600;
    const lookY = pov.lastPitch === null ? 0 : -(s.pitch - pov.lastPitch) * 600;
    pov.lastYaw = s.yaw; pov.lastPitch = s.pitch;
    this.viewmodel.update(dt * timeScale, { speed: s.speed || 0, onGround: Boolean(s.flags & FLAG.ground), scoped: eased, lookX, lookY, crouch });
  }

  // A shot fired by whoever we are watching. quiet: the positional sound is already playing.
  povShot(shot, { quiet = false } = {}) {
    const pov = this.pov;
    const weapon = WEAPONS[shot.weapon] || WEAPONS[pov.weapon];
    if (!weapon) return;
    if (shot.weapon && shot.weapon !== pov.weapon) { pov.weapon = shot.weapon; this.viewmodel.setWeapon(shot.weapon, true); }
    if (shot.mag != null) pov.mag = shot.mag;
    const final = pov.shots && shot === pov.shots[pov.shots.length - 1];
    if (shot.hit) bus.emit('pov-hit', final ? (pov.replay?.zone === 'head' ? 'head kill' : 'kill') : 'hit');
    if (shot.melee || weapon.melee) { this.viewmodel.melee(); if (!quiet) play('swing'); return; }
    const muzzle = this.viewmodel.muzzleWorld(this.camera, pov.scope);
    const from = [muzzle.x, muzzle.y, muzzle.z];
    const tracer = game.roster.get(pov.owner)?.tracer || '#ffc857';
    for (const end of shot.ends || []) {
      this.effects.tracer(from, end, tracer, 0.012 + weapon.tracer * 0.012);
      if (weapon.trail) this.effects.trail(from, end);
    }
    if (final) this.effects.hitPuff(pov.replay?.end || shot.ends?.[0]);
    this.effects.muzzleLight(muzzle, '#ffb45e', this.arena.variantName === 'night' ? 40 : 20);
    this.viewmodel.fire(weapon);
    if (quiet) return;
    playShot(weapon.id);
    if (weapon.action === 'bolt') play('bolt', { delay: 0.32, volume: 0.7 });
    if (weapon.action === 'pump') play('pump', { delay: 0.28, volume: 0.8 });
  }

  updateSpectate(dt) {
    const entry = this.spectateId && game.roster.get(this.spectateId);
    if (!entry || !entry.alive) this.cycleSpectate(1);
    const pose = this.spectateId && this.operators.poseOf(this.spectateId);
    if (!pose) {
      // Nobody left to watch: hold an overview above where we fell.
      this.endPov();
      this.camera.position.set(this.body.x, this.body.y + 3.2, this.body.z + 0.01);
      this.camera.rotation.set(-1.1, this.yaw, 0, 'YXZ');
      this.resetFov();
      return;
    }
    if (this.pov?.owner !== this.spectateId) { this.endPov(); this.beginPov(this.spectateId, pose.weapon); }
    this.updatePovCamera(pose, dt);
  }

  sendState(dt) {
    if (!this.alive) return;
    this.stateTimer += dt;
    if (this.stateTimer < 1 / 30) return;
    this.stateTimer = 0;
    let flags = 0;
    if (this.crouching) flags |= FLAG.crouch;
    if (this.scopeAmount > 0.05 && this.mode === 'play') flags |= FLAG.scoped;
    if (this.body.onGround) flags |= FLAG.ground;
    if (this.speed < 3.6) flags |= FLAG.walking;
    const view = this.mode === 'drone' && this.savedView ? this.savedView : this;
    const message = { type: 'state', e: this.epoch, x: round(this.body.x), y: round(this.body.y), z: round(this.body.z), yaw: round3(view.yaw), pitch: round3(view.pitch), f: flags };
    if (this.drone) message.drone = [round(this.drone.body.x), round(this.drone.body.y + 0.15), round(this.drone.body.z), round3(this.drone.yaw), round3(this.drone.pitch)];
    net.send(message);
  }

  // Bullet passing close by: whip crack + aim punch.
  nearMiss(origin, end, shooter) {
    if (!this.alive || !isEnemy(shooter)) return;
    const a = new THREE.Vector3(...origin), b = new THREE.Vector3(...end);
    const ab = b.clone().sub(a);
    const t = clamp(this.camera.position.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
    const closest = a.addScaledVector(ab, t);
    const distance = closest.distanceTo(this.camera.position);
    if (distance > 2.2 || t < 0.02) return;
    this.suppression = Math.min(1, this.suppression + 0.55);
    play('whizz', { pos: [closest.x, closest.y, closest.z], volume: 1, ref: 2 });
  }
}

const round = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;
const SOUND_OF = { asphalt: 'concrete', paving: 'concrete', gravel: 'gravel', grass: 'grass', concrete: 'concrete', wall: 'concrete', brick: 'concrete', plaster: 'concrete', stone: 'concrete', tunnel: 'concrete', metal: 'metal', rust: 'metal', teal: 'metal', wood: 'wood', crate: 'wood', cloth: 'cloth', clothAlt: 'cloth', glass: 'glass', shield: 'energy', barrier: 'energy', target: 'wood' };
// Arenas added later bring their own materials; those say what they sound like in MATERIALS.
export function MATERIAL_SOUND(mat) { return SOUND_OF[mat] || MATERIALS[mat]?.sound || 'concrete'; }
export { GADGETS };
