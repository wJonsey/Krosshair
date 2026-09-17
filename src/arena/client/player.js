// Local pilot: input (keyboard, mouse, gamepad), predicted movement, weapon
// handling, scope sway + breath, gadgets, drone piloting, spectating, killcam.
import * as THREE from 'three';
import { BODY, FLAG, GADGETS, INTERP_DELAY, WEAPONS, clamp } from '../shared/constants.js';
import { SpreadTracker, applySpread, hashString, mulberry32, spreadAngle, traceShot } from '../shared/combat.js';
import { makeBody } from '../shared/physics.js';
import { bus, game, isEnemy } from './state.js';
import { actionsFor, bindsFor, held, mouseCode } from './input.js';
import { net } from './net.js';
import { play, playShot, playImpact, playFootstep, startLoop, loop } from './audio.js';

const SLOTS = ['primary', 'sidearm', 'melee'];
const forward = new THREE.Vector3();

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
    this.pad = { fire: false, scope: false, prev: [] };
    this.crouchToggle = false; this.scopeToggle = false;
    this.crouching = false; this.crouchAmount = 0;
    this.scopeAmount = 0; this.zoomIndex = 0;
    this.viewY = 0; this.recoilPitch = 0; this.recoilYaw = 0; this.swayX = 0; this.swayY = 0; this.swayTime = 0;
    this.breath = 1; this.holdingBreath = false; this.winded = false;
    this.suppression = 0; this.shake = 0; this.deathTime = 0;
    this.active = 'primary'; this.nextFire = 0; this.equipUntil = 0; this.reloadEnd = 0; this.reloadSlot = null; this.reloadStage = 0;
    this.seq = 0; this.spread = { primary: new SpreadTracker(), sidearm: new SpreadTracker() };
    this.stride = 0; this.stateTimer = 0; this.lookX = 0; this.lookY = 0; this.speed = 0;
    this.spectateId = null; this.pendingKillcam = null; this.drone = null;
    this.uiBlocked = () => false;
    this.gravityScale = 1;
    this.bind();
  }

  get weapon() { return WEAPONS[game.you?.weapons?.[this.active]] || WEAPONS.knife; }
  get ammo() { return game.you?.ammo?.[this.active] || null; }
  get locked() { return document.pointerLockElement === this.canvas; }
  get canAct() { return this.alive && this.mode === 'play' && !this.uiBlocked(); }
  get combatOpen() { const phase = game.room?.phase; return phase === 'live' || phase === 'overtime' || phase === 'range'; }

  // One entry point for keys and mouse buttons, so anything can be bound to anything.
  press(code) {
    this.keys.add(code);
    bus.emit('key', code);
    const actions = actionsFor(code);
    if (!this.canAct) { if (this.mode === 'killcam' && actions.includes('jump')) this.skipKillcam(); return; }
    for (const action of actions) {
      if (action === 'fire') this.fireHeld = false;
      if (action === 'scope' && game.settings.toggleScope) this.scopeToggle = !this.scopeToggle;
      if (action === 'reload') this.reload();
      if (action === 'primary' || action === 'sidearm' || action === 'melee') this.switchTo(action);
      if (action === 'gadget1') this.useGadget(0);
      if (action === 'gadget2') this.useGadget(1);
      if (action === 'ping') this.ping();
      if (action === 'crouch' && game.settings.toggleCrouch) this.crouchToggle = !this.crouchToggle;
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
      this.vel.x = 0; this.vel.z = 0;
    }
    this.viewY = this.body.y;
    this.alive = true; this.mode = 'play';
    this.crouching = false; this.crouchToggle = false; this.scopeToggle = false; this.crouchAmount = 0; this.scopeAmount = 0;
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
    if (previous && you.hp < previous.hp) this.shake = Math.min(1, this.shake + (previous.hp - you.hp) / 60);
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
    this.viewmodel.setLook(entry?.color || game.look.color, entry?.accent || game.look.accent);
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
    this.viewmodel.setLook(game.look.color, game.look.accent);
    if (this.alive) this.viewmodel.setWeapon(this.weapon.id, true);
    this.resetFov();
  }
  // The weapon the camera is currently holding (someone else's while watching through their eyes).
  get viewWeapon() { return (this.pov && WEAPONS[this.pov.weapon]) || this.weapon; }

  spectateTargets() {
    const team = game.roster.get(game.id)?.team;
    return [...game.roster.values()].filter((p) => p.id !== game.id && p.alive && p.team === team && this.operators.poseOf(p.id)).map((p) => p.id);
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
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      const shotDir = applySpread(dir, angle, rng);
      const trace = traceShot(this.arena.physics, origin, shotDir, weapon, this.operators.targets());
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
    this.shake = Math.min(1, this.shake + recoil.kick * 0.08);
    if (weapon.action === 'bolt') this.scopeToggle = false;
    bus.emit('fired', weapon);
    bus.emit('tutorial', 'fire');
  }

  // ------------------------------------------------------------ frame update
  pollPad(dt) {
    const pad = [...(navigator.getGamepads?.() || [])].find((entry) => entry && entry.connected);
    const state = { mx: 0, mz: 0 };
    if (!pad) { this.pad.fire = false; this.pad.scope = false; return state; }
    const dead = (value) => (Math.abs(value) < 0.16 ? 0 : (value - Math.sign(value) * 0.16) / 0.84);
    state.mx = dead(pad.axes[0] || 0); state.mz = dead(pad.axes[1] || 0);
    const lx = dead(pad.axes[2] || 0), ly = dead(pad.axes[3] || 0);
    const zoom = this.scopeAmount > 0.5 ? 0.35 : 1;
    if (lx || ly) this.look(lx * Math.abs(lx) * 3.2 * dt * game.settings.padSensitivity * zoom, ly * Math.abs(ly) * 2.4 * dt * game.settings.padSensitivity * zoom * (game.settings.invertY ? -1 : 1));
    const pressed = pad.buttons.map((button) => button.pressed || button.value > 0.4);
    const tapped = (index) => pressed[index] && !this.pad.prev[index];
    this.pad.fire = Boolean(pressed[7]);
    if (tapped(7)) this.fireHeld = false;
    this.pad.scope = Boolean(pressed[6]);
    this.pad.jump = Boolean(pressed[0]);
    this.pad.walk = Boolean(pressed[10]);
    if (this.canAct) {
      if (tapped(1)) this.crouchToggle = !this.crouchToggle;
      if (tapped(2)) this.reload();
      if (tapped(3)) { const owned = SLOTS.filter((slot) => game.you?.weapons?.[slot]); this.switchTo(owned[(owned.indexOf(this.active) + 1) % owned.length]); }
      if (tapped(4)) this.useGadget(0);
      if (tapped(5)) this.useGadget(1);
      if (tapped(12)) this.ping();
      if (tapped(11)) this.switchTo('melee');
    } else if (this.mode === 'spectate' && tapped(0)) this.cycleSpectate(1);
    else if (this.mode === 'killcam' && tapped(0)) this.skipKillcam();
    if (tapped(9)) bus.emit('key', 'Escape');
    if (tapped(8)) bus.emit('pad-scoreboard');
    this.pad.prev = pressed;
    return state;
  }

  update(dt, wallDt = dt) {
    const now = performance.now() / 1000;
    const pad = this.pollPad(dt);
    this.lookX *= 0.6; this.lookY *= 0.6;
    this.suppression = Math.max(0, this.suppression - dt * 0.55);
    this.shake = Math.max(0, this.shake - dt * 3.2);
    // Below 20 fps the simulation sub-steps so movement keeps its real speed instead of going slow-motion.
    if (this.mode === 'play' || this.mode === 'drone') {
      for (let remaining = Math.max(dt, wallDt); remaining > 1e-4; remaining -= 0.05) {
        const step = Math.min(0.05, remaining);
        if (this.mode === 'play') this.updatePlay(step, now, pad); else if (this.mode === 'drone') this.updateDrone(step, pad);
      }
    }
    else if (this.mode === 'dead') this.updateDead(wallDt);
    else if (this.mode === 'killcam' || this.mode === 'replay') this.updateReplayCamera(wallDt);
    else if (this.mode === 'spectate') this.updateSpectate(wallDt);
    this.sendState(wallDt);
  }

  updatePlay(dt, now, pad) {
    const body = this.body, weapon = this.weapon;
    const blocked = this.uiBlocked();
    const keys = blocked ? new Set() : this.keys;
    // --- stance
    // crouchToggle is driven by the keyboard in toggle mode and always by the gamepad's B button.
    const wantCrouch = this.crouchToggle || (!game.settings.toggleCrouch && held(keys, 'crouch'));
    if (wantCrouch && !this.crouching) { this.crouching = true; body.height = BODY.crouchHeight; } else if (!wantCrouch && this.crouching) {
      if (this.arena.physics.bodyFree(body.x, body.y, body.z, body.radius, BODY.height)) { this.crouching = false; body.height = BODY.height; }
    }
    this.crouchAmount += ((this.crouching ? 1 : 0) - this.crouchAmount) * Math.min(1, dt * 12);
    // --- scope
    const canScope = !weapon.melee && !this.reloadEnd && now >= this.equipUntil && !blocked;
    const wantScope = canScope && ((!game.settings.toggleScope && held(keys, 'scope')) || this.pad.scope || this.scopeToggle);
    const before = this.scopeAmount;
    this.scopeAmount = clamp(this.scopeAmount + (wantScope ? dt : -dt * 1.6) / (weapon.scopeTime || 0.15), 0, 1);
    if (before === 0 && this.scopeAmount > 0) { play('scope'); bus.emit('tutorial', 'scope'); }
    if (!wantScope && before > 0 && this.scopeAmount === 0) this.zoomIndex = 0;
    // --- breath
    const walkKey = held(keys, 'walk') || this.pad.walk;
    this.holdingBreath = walkKey && this.scopeAmount > 0.9 && Boolean(weapon.scope?.[0] < 40) && !this.winded;
    if (this.holdingBreath) { this.breath = Math.max(0, this.breath - dt * 0.3); if (this.breath === 0) { this.winded = true; } } else { this.breath = Math.min(1, this.breath + dt * 0.22); if (this.winded && this.breath > 0.45) this.winded = false; }
    // --- movement
    let mx = pad.mx, mz = pad.mz;
    if (held(keys, 'forward')) mz -= 1; if (held(keys, 'back')) mz += 1; if (held(keys, 'left')) mx -= 1; if (held(keys, 'right')) mx += 1;
    const length = Math.hypot(mx, mz);
    if (length > 1) { mx /= length; mz /= length; }
    let maxSpeed = BODY.runSpeed * (weapon.speed || 1);
    if (this.crouching) maxSpeed = BODY.crouchSpeed; else if (walkKey) maxSpeed = BODY.walkSpeed;
    if (this.scopeAmount > 0.3) maxSpeed *= 0.55;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (mx * cos + mz * sin) * maxSpeed, wishZ = (-mx * sin + mz * cos) * maxSpeed;
    const accel = body.onGround ? 14 : 2.5;
    const k = Math.min(1, accel * dt);
    this.vel.x += (wishX - this.vel.x) * k; this.vel.z += (wishZ - this.vel.z) * k;
    const jump = !blocked && (held(keys, 'jump') || this.pad.jump);
    if (jump && body.onGround && !this.crouching) { body.vy = BODY.jumpVelocity; body.onGround = false; play('jump'); bus.emit('tutorial', 'jump'); }
    const gravity = BODY.gravity * this.gravityScale;
    body.vy = Math.max(-40, body.vy - gravity * dt);
    const fallSpeed = body.vy;
    const beforeX = body.x, beforeZ = body.z, wasGrounded = body.onGround;
    this.arena.physics.moveBody(body, this.vel.x * dt, body.vy * dt, this.vel.z * dt);
    const movedX = body.x - beforeX, movedZ = body.z - beforeZ;
    if (dt > 0) { if (Math.abs(movedX) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x *= 0.5; if (Math.abs(movedZ) < Math.abs(this.vel.z * dt) * 0.5) this.vel.z *= 0.5; }
    const { bounds } = this.arena.map;
    body.x = clamp(body.x, bounds.minX + 0.4, bounds.maxX - 0.4); body.z = clamp(body.z, bounds.minZ + 0.4, bounds.maxZ - 0.4);
    if (body.y < bounds.minY - 3) { body.y = 0.5; body.vy = 0; }
    const moved = Math.hypot(movedX, movedZ);
    this.speed = dt > 0 ? moved / dt : 0;
    if (body.onGround && !wasGrounded && fallSpeed < -4) { play('land', { volume: Math.min(1, -fallSpeed / 12) }); this.viewmodel.land(-fallSpeed / 10); this.shake = Math.min(1, this.shake + -fallSpeed / 30); }
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
    const scopedOptic = weapon.scope && weapon.scope[0] < 40;
    this.swayTime += dt;
    let swayScale = scopedOptic ? this.scopeAmount * 0.0042 : 0;
    swayScale *= (this.crouching ? 0.55 : 1) * (1 + Math.min(1.5, this.speed / 3)) * (1 + this.suppression * 2.2) * (this.holdingBreath ? 0.1 : 1) * (this.winded ? 2.1 : 1) * (weapon.sway || 1);
    this.swayX = Math.sin(this.swayTime * 1.13) * swayScale + Math.sin(this.swayTime * 2.71) * swayScale * 0.35;
    this.swayY = Math.sin(this.swayTime * 1.7 + 1.3) * swayScale * 0.8 + Math.cos(this.swayTime * 0.83) * swayScale * 0.3;
    const eye = THREE.MathUtils.lerp(BODY.eye, BODY.crouchEye, this.crouchAmount);
    const dy = body.y - this.viewY;
    if (Math.abs(dy) > 0.7 || !body.onGround) this.viewY = body.y; else this.viewY += dy * Math.min(1, dt * 16);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.012, shakeY = (Math.random() - 0.5) * this.shake * 0.012;
    this.camera.position.set(body.x, this.viewY + eye, body.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch + this.swayY + shakeY, this.yaw + this.recoilYaw + this.swayX + shakeX, 0, 'YXZ');
    const baseFov = game.settings.fov;
    const zoomFov = weapon.scope ? weapon.scope[Math.min(this.zoomIndex, weapon.scope.length - 1)] : baseFov;
    const eased = this.scopeAmount * this.scopeAmount * (3 - 2 * this.scopeAmount);
    const fov = THREE.MathUtils.lerp(baseFov, Math.min(baseFov, zoomFov), eased);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.viewmodel.update(dt, { speed: this.speed, onGround: body.onGround, scoped: eased, lookX: this.lookX, lookY: this.lookY, crouch: this.crouching });
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
    const fov = THREE.MathUtils.lerp(baseFov, zoomFov, eased);
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
export function MATERIAL_SOUND(mat) { return SOUND_OF[mat] || 'concrete'; }
export { GADGETS };
