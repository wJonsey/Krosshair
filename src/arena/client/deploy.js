// The royale deployment, as the pilot sees it: the transport crossing the island, your own pilot in third
// person on its ramp, off the edge, falling, under the canopy, landing, and the camera coming back into
// your eyes. Everything else in the game is first person, and this hands the camera straight back.
//
// Stages (one at a time): null (first person) → plane → jump → freefall → chute → landing → null.
// The server decides who is aboard, when they left and whether they may fall that fast; this only draws.
// The aircraft is placed from the shared flight plan on this machine's clock, so nothing is sent per frame.
import * as THREE from 'three';
import { BODY } from '../shared/constants.js';
import { DEPLOY, aircraftAt } from '../shared/royale.js';
import { animateOperator, buildChute, buildOperator, styleOperator } from './operator.js';
import { lookOf } from './characters.js';
import { bus, game } from './state.js';
import { net } from './net.js';
import { actionsFor, bindLabel, held } from './input.js';
import { play } from './audio.js';

const JUMP_TIME = 0.7;          // ramp to free fall: a run to the edge, then off it
// On the aircraft, nose to -Z. The ramp is hinged at the floor (z 10) and let down at RAMP_TILT: the pilot
// waits at its top, out in the daylight, and runs down it to where the server puts them (DEPLOY.exit).
const RAMP_TILT = 0.32;
const rampY = (z) => -2.2 - Math.max(0, z - 10) * Math.tan(RAMP_TILT) + 0.05;
const RAMP_STAND = [0, rampY(10.4), 10.4];
const RAMP_EDGE = [0, rampY(12.6), 12.6];
const RAMP_FOCUS = [0, -1.1, 10.8];
const smooth = (k) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const CSS = `
.deploy-hud { position: fixed; inset: 0; pointer-events: none; z-index: 14; display: none; }
.deploy-hud.on { display: block; }
.deploy-count { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); text-align: center; display: none; }
.deploy-count.on { display: block; animation: deploy-in .25s ease-out; }
.deploy-count small { display: block; color: var(--haze); font: 500 12px var(--mono); letter-spacing: .3em; text-transform: uppercase; }
.deploy-count b { display: block; margin-top: 6px; color: var(--frost); font: 400 clamp(64px, 9vw, 120px)/1 var(--display); text-shadow: 0 0 30px rgba(0, 0, 0, .55); }
.deploy-count b.go { color: var(--signal); }
.deploy-prompt { position: absolute; left: 50%; bottom: 17%; transform: translateX(-50%); display: flex; gap: 18px; white-space: nowrap; padding: 9px 16px; background: var(--hud-glass); backdrop-filter: blur(8px); border: 1px solid rgba(230, 237, 241, .18); color: var(--frost); font: 500 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.deploy-prompt:empty { display: none; }
.deploy-prompt kbd { margin-right: 7px; padding: 1px 6px; border: 1px solid rgba(230, 237, 241, .45); color: var(--signal); font: inherit; }
.deploy-prompt em { color: var(--signal); font-style: normal; }
@keyframes deploy-in { from { opacity: 0; transform: translate(-50%, 8px); } }
`;

// A transport with its cargo ramp down: faceted, like everything else on the island. Nose to -Z.
function buildAircraft() {
  const plane = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#76808a', roughness: 0.7, metalness: 0.2, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#434b54', roughness: 0.8, metalness: 0.2, flatShading: true });
  const inside = new THREE.MeshStandardMaterial({ color: '#1b2026', roughness: 0.95, side: THREE.BackSide, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: '#0c1116', roughness: 0.1, metalness: 0.7 });
  const stripe = new THREE.MeshStandardMaterial({ color: '#ffb547', roughness: 0.5, emissive: '#7a4a00', emissiveIntensity: 0.3 });
  const add = (geometry, material, position, rotation = [0, 0, 0]) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); plane.add(mesh); return mesh; };
  // Body: open at the back, so the ramp and the hold behind it can be seen.
  add(new THREE.CylinderGeometry(2.3, 2.3, 22, 10, 1, true), paint, [0, 0, -1], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(2.24, 2.24, 21.9, 10, 1, true), inside, [0, 0, -1], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.7, 2.3, 4.5, 10), paint, [0, -0.2, -14.2], [-Math.PI / 2, 0, 0]);
  add(new THREE.BoxGeometry(1.9, 0.55, 1.3), glass, [0, 1.25, -13.2], [0.35, 0, 0]);
  add(new THREE.BoxGeometry(3.9, 0.12, 20.5), dark, [0, -2.18, -1.2]);
  add(new THREE.BoxGeometry(0.04, 0.35, 20), stripe, [2.28, 0.1, -1]);
  add(new THREE.BoxGeometry(0.04, 0.35, 20), stripe, [-2.28, 0.1, -1]);
  // The upswept tail over the open hold, the fin and the tailplane.
  // Kept high and slim so the lower half of the door is open: the pilot on the ramp is seen, not hidden.
  add(new THREE.CylinderGeometry(0.65, 1.2, 6.5, 10), paint, [0, 1.8, 13.2], [Math.PI / 2 + 0.12, 0, 0]);
  add(new THREE.BoxGeometry(0.3, 4.6, 3.6), paint, [0, 4.3, 15.8], [0.35, 0, 0]);
  add(new THREE.BoxGeometry(11, 0.25, 2.4), paint, [0, 2.3, 16.2]);
  // The ramp, hinged at the floor and let down.
  const ramp = add(new THREE.BoxGeometry(3.7, 0.16, 4.6), dark, [0, -2.2, 10], [RAMP_TILT, 0, 0]);
  ramp.geometry.translate(0, 0, 2.3);
  // High wing, four engines, four props.
  add(new THREE.BoxGeometry(36, 0.5, 4.4), paint, [0, 2.2, -3]);
  const props = [];
  for (const x of [-11.5, -6, 6, 11.5]) {
    add(new THREE.CylinderGeometry(0.55, 0.7, 3.6, 8), dark, [x, 1.4, -4.4], [Math.PI / 2, 0, 0]);
    const prop = new THREE.Group();
    prop.position.set(x, 1.4, -6.4);
    for (let i = 0; i < 4; i += 1) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.3, 0.06), dark); blade.rotation.z = (i * Math.PI) / 2; prop.add(blade); }
    plane.add(prop);
    props.push(prop);
  }
  // The jump light by the door: red until the ramp opens, green after.
  const light = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
  add(new THREE.BoxGeometry(0.28, 0.28, 0.12), light, [1.55, 1.1, 9.4]);
  plane.traverse((part) => { if (part.isMesh) { part.castShadow = true; part.frustumCulled = false; } });
  plane.userData = { props, light };
  return plane;
}

export function initDeploy({ arena, camera, player, viewmodel }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const hudRoot = document.createElement('div');
  hudRoot.className = 'deploy-hud';
  hudRoot.innerHTML = '<div class="deploy-count"><small>Deployment in</small><b></b></div><div class="deploy-prompt"></div>';
  document.body.append(hudRoot);
  const countBox = hudRoot.querySelector('.deploy-count'), countNumber = countBox.querySelector('b'), prompt = hudRoot.querySelector('.deploy-prompt');
  const put = (node, value) => { if (node.__html !== value) { node.__html = value; node.innerHTML = value; } };
  const key = (action) => `<kbd>${bindLabel(action)}</kbd>`;

  const plane = buildAircraft();
  plane.visible = false;
  const me = { holder: new THREE.Group(), model: buildOperator(), chute: buildChute(), styled: null, open: 0 };
  me.holder.add(me.model);
  me.holder.add(me.chute);
  me.holder.visible = false;
  me.chute.visible = false;
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 320, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  marker.visible = false;

  let flight = null, stage = null, since = 0, jumpAskedAt = -1, leapFrom = null, mark = null, markUntil = 0, lastCount = null, spoke = false;
  const camOffset = new THREE.Vector3(0, 3, 6), camLocal = new THREE.Vector3(), look = new THREE.Vector3();
  const tpPos = new THREE.Vector3(), tpQuat = new THREE.Quaternion(), fpPos = new THREE.Vector3(), fpQuat = new THREE.Quaternion();
  // Scratch vectors, one job each: `follow` fills dirV/wantV while its target (chest) is still being read.
  const helper = new THREE.Object3D(), v = new THREE.Vector3(), w = new THREE.Vector3(), chest = new THREE.Vector3(), dirV = new THREE.Vector3(), wantV = new THREE.Vector3(), up = new THREE.Vector3();
  let fov = null, lastYaw = null, bank = 0;

  net.on('royale-flight', (message) => { flight = message.flight || null; });
  // Where the ground is where you look: that becomes your mark. It moves nobody; it is there to steer by.
  bus.on('key', (code) => {
    if (!stage || stage === 'landing') return;
    if (actionsFor(code).includes('ping')) placeMark();
  });
  function placeMark() {
    camera.getWorldDirection(v);
    const hit = arena.physics.raycast([camera.position.x, camera.position.y, camera.position.z], [v.x, v.y, v.z], 900, (box) => !box.deco)[0];
    if (!hit) { play('deny'); return; }
    const at = { x: camera.position.x + v.x * hit.t0, z: camera.position.z + v.z * hit.t0 };
    mark = at; markUntil = Infinity;
    net.send({ type: 'royale-drop', x: at.x, z: at.z });
    bus.emit('royale-mark', at);
    play('ready');
  }

  // Plane-local to world, for an aircraft where it is at time t.
  function planeFrame(t) {
    const at = aircraftAt(flight, t);
    helper.position.set(at.x, at.y + Math.sin(t * 0.7) * 0.25, at.z);
    helper.rotation.set(Math.sin(t * 0.5) * 0.012, at.heading, Math.sin(t * 0.37) * 0.02, 'YXZ');
    helper.updateMatrixWorld(true);
    return helper;
  }
  const toWorld = (frame, local, out) => out.set(...local).applyMatrix4(frame.matrixWorld);

  function enter(next) {
    stage = next; since = 0;
    if (next === 'plane') { me.open = 0; bank = 0; }
    if (next === 'chute') me.open = 0;
  }
  // Out of the deployment for whatever reason: first person, nothing of ours left in the world.
  function reset() {
    stage = null; since = 0; jumpAskedAt = -1; leapFrom = null;
    me.holder.visible = false; me.chute.visible = false;
    countBox.classList.remove('on'); put(prompt, '');
    hudRoot.classList.remove('on');
  }

  function styleMe() {
    const lookKey = JSON.stringify(game.look);
    if (me.styled === lookKey) return;
    me.styled = lookKey;
    styleOperator(me.model, { ...lookOf(game.look), team: 'friend' });
    me.chute.userData.cloth.material.color.set(game.look.color || '#e6edf1');
  }

  function requestJump(t) {
    if (t < flight.doorsAt) { play('deny'); return; }
    if (jumpAskedAt > 0 && t - jumpAskedAt < 1.5) return;
    jumpAskedAt = t;
    // Face the way the aircraft flies, as the server's spawn will: the follow camera then swings out
    // behind you, away from the fuselage, instead of through it.
    player.yaw = flight.heading; player.pitch = -0.35;
    net.send({ type: 'royale-jump' });
    play('jump');
    enter('jump');
    leapFrom = null;
  }

  // The camera behind and above a target, its offset eased rather than its position, so a pilot falling
  // at 40 m/s is framed the same as one gliding. Pulled in if anything solid is in the way.
  function follow(target, spec, dt, pitchBias) {
    const p = THREE.MathUtils.clamp(player.pitch * 0.55 + pitchBias, -1.25, 0.25);
    const dir = dirV.set(-Math.sin(player.yaw) * Math.cos(p), Math.sin(p), -Math.cos(player.yaw) * Math.cos(p));
    const want = wantV.copy(dir).multiplyScalar(-spec.distance).add(up.set(0, spec.height, 0));
    camOffset.lerp(want, Math.min(1, dt * DEPLOY.camera.turn));
    let dist = camOffset.length();
    const hit = arena.physics.raycast([target.x, target.y, target.z], [camOffset.x / dist, camOffset.y / dist, camOffset.z / dist], dist, (box) => !box.deco)[0];
    if (hit) dist = Math.max(1.2, hit.t0 - 0.35);
    tpPos.copy(camOffset).setLength(dist).add(target);
    look.copy(target).addScaledVector(dir, 4);
    return tpPos;
  }
  function aim(position, at, shake, t) {
    camera.position.copy(position);
    if (shake) camera.position.add(v.set(Math.sin(t * 23.1) * shake, Math.sin(t * 19.7 + 1) * shake, Math.sin(t * 17.3 + 2) * shake));
    camera.lookAt(at);
  }
  function setFov(value) { if (Math.abs(camera.fov - value) > 0.01) { camera.fov = value; camera.updateProjectionMatrix(); } }

  return {
    get stage() { return stage; },
    get flight() { return flight; },
    get active() { return Boolean(stage); },
    // Movement waits for the landing to finish; weapons wait for the camera to be back.
    get locked() { return stage === 'landing' && since < DEPLOY.landing; },
    reset,
    update(dt) {
      const t = net.time();
      const royaleOn = Boolean(game.room?.royale) && Boolean(arena.map?.royale) && game.screen === 'game';
      if (!royaleOn || game.room.phase === 'lobby' || game.room.phase === 'matchEnd') { if (stage) reset(); plane.visible = false; marker.visible = false; if (!royaleOn) flight = null; return; }
      if (plane.parent !== arena.scene) arena.scene.add(plane);
      if (me.holder.parent !== arena.scene) arena.scene.add(me.holder);
      if (marker.parent !== arena.scene) arena.scene.add(marker);
      styleMe();

      // The aircraft, for everyone, while it is over the island or nearly.
      const flying = flight && t < flight.endAt + 4;
      plane.visible = Boolean(flying);
      const frame = flying ? planeFrame(t) : null;
      if (frame) {
        plane.position.copy(frame.position); plane.rotation.copy(frame.rotation);
        for (const prop of plane.userData.props) prop.rotation.z += dt * 38;
        plane.userData.light.color.set(t >= flight.doorsAt ? '#3dff7a' : '#ff3b30');
      }

      // Which stage we are in follows the server: aboard, then off the ramp (a spawn in the sky), then down.
      const aboard = Boolean(game.you?.inPlane) && flight && !game.watching;
      if (aboard && player.mode !== 'plane' && stage !== 'jump') player.boardPlane(flight.heading);
      if (aboard && !stage) enter('plane');
      if (stage === 'jump' && aboard && !player.drop && t - jumpAskedAt > 1.8) enter('plane');   // refused: back on the ramp
      if (player.alive && player.drop) {
        if (!stage || stage === 'plane') enter(stage === 'plane' ? 'jump' : 'freefall');
        if (stage === 'jump' && since > JUMP_TIME) enter('freefall');
        if (player.drop.chute && (stage === 'freefall' || stage === 'jump')) enter('chute');
      } else if (player.alive && (stage === 'freefall' || stage === 'chute' || (stage === 'jump' && !aboard && since > JUMP_TIME))) {
        enter('landing'); play('land', { volume: 0.9 });
      }
      if (stage && stage !== 'plane' && stage !== 'jump' && !player.alive) reset();   // killed on the way down
      if (stage === 'plane' && !aboard && !player.drop && player.mode !== 'plane') reset();
      if (stage === 'landing' && since > DEPLOY.landing + DEPLOY.blend) { reset(); viewmodel.hidden = false; viewmodel.equip = 0; }
      if (stage) since += dt;
      if (stage === 'plane' && (held(player.keys, 'jump') || player.pad?.jump) && !player.uiBlocked()) requestJump(t);

      // Your mark: a beam to steer at while you are coming down, and a while after.
      const markOn = mark && (stage || t < markUntil);
      marker.visible = Boolean(markOn);
      if (markOn) marker.position.set(mark.x, 160, mark.z);
      if (!stage) {
        hudRoot.classList.toggle('on', game.room.phase === 'drop');
        if (mark && markUntil === Infinity) markUntil = t + 20;
        return;
      }
      hudRoot.classList.add('on');
      if (stage !== 'landing') viewmodel.hidden = true;

      // ---- your pilot
      const yawRate = lastYaw === null || dt <= 0 ? 0 : wrap(player.yaw - lastYaw) / dt;
      lastYaw = player.yaw;
      bank += (THREE.MathUtils.clamp(yawRate / 3 + (player.drop ? player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw) : 0) / 14, -1, 1) - bank) * Math.min(1, dt * 4);
      const body = player.body;
      let deploy = null, speed = 0, air = true;
      if (stage === 'plane' || (stage === 'jump' && since < JUMP_TIME * 0.45)) {
        // On the ramp, facing out, holding on; then a few steps to the edge.
        const run = stage === 'jump' ? smooth(since / (JUMP_TIME * 0.45)) : 0;
        const z = RAMP_STAND[2] + (RAMP_EDGE[2] - RAMP_STAND[2]) * run, spot = [0, rampY(z), z];
        toWorld(frame || planeFrame(t), spot, me.holder.position);
        me.model.rotation.y = (flight?.heading ?? 0) + Math.PI + (stage === 'plane' ? Math.sin(t * 0.3) * 0.25 : 0);
        deploy = { ride: stage === 'plane' ? 1 : 0.3, sky: 0, chute: 0, lean: 0 };
        speed = stage === 'jump' ? 5 : 0; air = false;
        if (stage === 'jump') leapFrom = me.holder.position.clone();
      } else if (stage === 'jump') {
        // Off the edge: the aircraft flies on, the pilot drops away behind it and rolls into free fall.
        const k = (since - JUMP_TIME * 0.45) / (JUMP_TIME * 0.55);
        const from = leapFrom || me.holder.position;
        const drift = v.set(-Math.sin(flight.heading), 0, -Math.cos(flight.heading)).multiplyScalar(flight.speed * 0.35 * k * JUMP_TIME);
        const predicted = w.copy(from).add(drift).add(new THREE.Vector3(0, -4.9 * (k * JUMP_TIME) ** 2, 0));
        me.holder.position.copy(player.drop ? predicted.lerp(v.set(body.x, body.y, body.z), smooth(k)) : predicted);
        me.model.rotation.y = player.drop ? player.yaw : (flight?.heading ?? 0);
        deploy = { ride: 0, sky: smooth(k * 1.4), chute: 0, lean: 0 };
      } else {
        me.holder.position.set(body.x, body.y, body.z);
        me.model.rotation.y = player.yaw;
        if (stage === 'freefall') deploy = { ride: 0, sky: 1, chute: 0, lean: bank };
        else if (stage === 'chute') deploy = { ride: 0, sky: 0, chute: 1, lean: bank };
        else { air = false; speed = player.speed; }
      }
      me.holder.visible = true;
      animateOperator(me.model, { speed, crouch: stage === 'landing' && since < DEPLOY.landing * 0.6, pitch: 0, weapon: 'knife', dt, move: [0, 1], air, scoped: false, reloading: false, deploy });
      // The canopy: out of the pack, a hard pull, then full and breathing, leaning into the turns.
      const canopyOn = stage === 'chute' || (stage === 'landing' && since < 0.35);
      me.chute.visible = canopyOn;
      if (canopyOn) {
        me.open = stage === 'chute' ? Math.min(1, me.open + dt / DEPLOY.parachute.open) : Math.max(0, me.open - dt * 3);
        const k = 1 - (1 - me.open) ** 3, puff = 1 + Math.sin(me.open * Math.PI) * 0.15 + Math.sin(t * 2.3) * 0.02 * me.open;
        me.chute.userData.canopy.scale.set(Math.max(0.05, k * puff), Math.max(0.05, k * (stage === 'landing' ? 0.6 : 1)), Math.max(0.05, k * puff));
        me.chute.rotation.set(0, player.yaw, -bank * 0.3);
      }

      // ---- the camera
      fpPos.copy(camera.position); fpQuat.copy(camera.quaternion);   // first person, as the player placed it
      const baseFov = game.settings.fov;
      const spec = DEPLOY.camera;
      if (stage === 'plane' || stage === 'jump') {
        // Outside, behind the open ramp: never further round than `arc`, so it cannot swing into the hold.
        // While jumping the facing already belongs to the fall, so the ramp camera holds where it was.
        if (stage === 'plane') {
          const facing = flight.heading + Math.PI;
          let offset = wrap(player.yaw - facing);
          if (Math.abs(offset) > spec.ramp.arc) { offset = Math.sign(offset) * spec.ramp.arc; player.yaw = facing + offset; }
          player.pitch = THREE.MathUtils.clamp(player.pitch, spec.ramp.pitchLow, spec.ramp.pitchHigh);
          const p = -player.pitch;
          const want = v.set(RAMP_FOCUS[0] + Math.sin(-offset) * Math.cos(p) * spec.ramp.distance, RAMP_FOCUS[1] + spec.ramp.height + Math.sin(p) * spec.ramp.distance * 0.6, RAMP_FOCUS[2] + Math.cos(offset) * Math.cos(p) * spec.ramp.distance);
          if (since < dt * 1.5) camLocal.copy(want); else camLocal.lerp(want, Math.min(1, dt * spec.follow));
        }
        const f = frame || planeFrame(t);
        const rampCam = toWorld(f, camLocal.toArray(), new THREE.Vector3()), rampLook = toWorld(f, RAMP_FOCUS, new THREE.Vector3());
        if (stage === 'plane') { aim(rampCam, rampLook, spec.ramp.shake, t); setFov(baseFov); }
        else {
          // Off the ramp: the camera leaves the aircraft with you and swings in behind for the fall.
          chest.copy(me.holder.position).y += 0.9;
          follow(chest, spec.freefall, dt, -0.35);
          const k = smooth(since / JUMP_TIME);
          camera.position.copy(rampCam).lerp(tpPos, k);
          camera.lookAt(rampLook.lerp(look, k));
          setFov(baseFov + spec.freefall.fov * 0.3 * k);
        }
        camOffset.copy(camera.position).sub(chest.copy(me.holder.position).add(up.set(0, 0.9, 0)));
      } else if (stage === 'freefall' || stage === 'chute') {
        chest.copy(me.holder.position).y += 0.9;
        const s = stage === 'chute' ? spec.parachute : spec.freefall;
        const blend = stage === 'chute' ? smooth(since / 0.8) : 1;
        const mixed = { distance: spec.freefall.distance + (s.distance - spec.freefall.distance) * blend, height: spec.freefall.height + (s.height - spec.freefall.height) * blend };
        follow(chest, mixed, dt, stage === 'chute' ? -0.2 : -0.35);
        const fallSpeed = Math.max(0, -body.vy);
        aim(tpPos, look, s.shake * (0.5 + fallSpeed / 20), t);
        // Faster falls widen the view a touch; opening the chute brings it back.
        setFov(baseFov + (stage === 'chute' ? spec.parachute.fov : spec.freefall.fov * Math.min(1, fallSpeed / 40)) * (stage === 'chute' ? 1 : 1));
      } else if (stage === 'landing') {
        // Touchdown: knees take it, the pilot stands, and the camera comes down into their eyes.
        chest.copy(me.holder.position).y += 0.9;
        follow(chest, { distance: 4.2, height: 1.2 }, dt, -0.1);
        tpQuat.copy(camera.quaternion);
        helper.position.copy(tpPos); helper.lookAt(look); tpQuat.copy(helper.quaternion);
        const k = smooth((since - DEPLOY.landing * 0.35) / DEPLOY.blend);
        camera.position.copy(tpPos).lerp(fpPos, k);
        camera.quaternion.copy(tpQuat).slerp(fpQuat, k);
        setFov(camera.fov + (baseFov - camera.fov) * Math.min(1, dt * 8));
        // A pilot who landed staring at their boots looks up as they stand.
        player.pitch += (THREE.MathUtils.clamp(player.pitch, -0.35, 0.3) - player.pitch) * Math.min(1, dt * 5);
        me.holder.visible = k < 0.75;
        if (k > 0.9 && viewmodel.hidden) { viewmodel.hidden = false; viewmodel.equip = 0; }
      }

      // ---- what to press
      countBox.classList.toggle('on', game.room.phase === 'drop' || (stage === 'plane' && t < flight.liveAt + 0.8));
      if (game.room.phase === 'drop' || t < flight.liveAt + 0.8) {
        const left = Math.ceil(flight.liveAt - t);
        const text = left > 0 ? String(Math.min(left, 3)) : 'Jump';
        if (text !== lastCount) { lastCount = text; countNumber.classList.toggle('go', left <= 0); if (left <= 3) play(left > 0 ? 'ui' : 'ready'); }
        countNumber.textContent = text;
        countBox.firstChild.textContent = left > 0 ? 'Deployment in' : 'Doors open';
      }
      const markLine = mark ? `<span>Mark <em>${Math.round(Math.hypot(mark.x - body.x, mark.z - body.z))} m</em></span>` : `<span>${key('ping')}Mark ground</span>`;
      if (stage === 'plane') {
        const out = Math.ceil(flight.ejectAt - t);
        const jump = t < flight.doorsAt ? `<span>Ramp opens in <em>${Math.max(1, Math.ceil(flight.doorsAt - t))}</em></span>` : `<span>${key('jump')}Jump</span>`;
        put(prompt, `${jump}${markLine}<span>${key('map')}Map</span>${out <= 8 && t >= flight.doorsAt ? `<span>Out in <em>${out}</em></span>` : ''}`);
      } else if (stage === 'freefall' || stage === 'jump') put(prompt, `<span>${key('jump')}Open chute</span>${markLine}`);
      else if (stage === 'chute') put(prompt, `<span>${key('forward')}Dive</span><span>${key('back')}Brake</span>${markLine}`);
      else put(prompt, '');
      if (!spoke && stage === 'plane' && t >= flight.doorsAt) { spoke = true; play('roundStart'); }
      if (stage !== 'plane') spoke = false;
    },
  };
}
