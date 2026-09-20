// First-person weapons. Rendered in their own scene on top of the world so the
// rifle never clips through walls. All models and animation are procedural.
import * as THREE from 'three';
import { WEAPONS } from '../shared/constants.js';
import { EYE_RELIEF, buildWeapon, stripHands } from './guns.js';
import { buildCharm, updateCharm } from './charms.js';
import { play } from './audio.js';

// Gun charms live in charms.js; re-exported here because the shop builds them alongside the guns.
export { buildCharm, buildWeapon, stripHands };

// The eyepiece of a magnified scope, modelled on how a real one behaves.
//  · The picture is fixed to the glass and fills it: the scope's field stop is the edge of the lens.
//  · The light leaves as a narrow beam, the exit pupil (objective / magnification, so it shrinks as you zoom).
//    Put your eye in it, at the eye relief, and you see the whole picture. Too far back and the picture
//    closes in from the edges; off to one side and a black crescent (scope shadow) slides in from that side.
//  · The reticle sits in the second focal plane, so it stays the same size whatever the zoom.
// The eye box is worked out per point of the picture: a point at field position q (edge of glass = 1) leaves
// the eyepiece as a beam that crosses the axis at the eye relief and has drifted uSpread * q metres off it by
// the time it reaches the eye. If that is further from the eye (uEye, metres off the axis) than the beam and
// the pupil are wide (uBeam), the point is dark. At the hip that is everything: you see coated glass. As the
// scope comes up a small bright disc appears off to one side, slides to the middle and opens to the full view.
function scopeGlass(texture) {
  return new THREE.ShaderMaterial({
    uniforms: { uView: { value: texture }, uSpread: { value: 0.05 }, uEye: { value: new THREE.Vector2() }, uBeam: { value: 0.01 }, uPrism: { value: 0 }, uAccent: { value: new THREE.Color('#ff4030') } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D uView; uniform float uSpread; uniform vec2 uEye; uniform float uBeam; uniform float uPrism; uniform vec3 uAccent; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        // A touch of barrel distortion and colour fringing toward the edge, as cheap glass has.
        vec2 bent = p * (1.0 - 0.05 * r * r);
        float fringe = 0.006 * r * r;
        vec3 view = vec3(texture2D(uView, bent * (1.0 + fringe) * 0.5 + 0.5).r, texture2D(uView, bent * 0.5 + 0.5).g, texture2D(uView, bent * (1.0 - fringe) * 0.5 + 0.5).b);
        view *= 1.0 - 0.3 * r * r;
        // Reticle: fine crosshair with a gap, heavy outer posts, mil dots. The prism gets a ring and dot.
        if (uPrism < 0.5) {
          float fine = max((1.0 - smoothstep(0.003, 0.006, abs(p.y))) * step(0.035, abs(p.x)), (1.0 - smoothstep(0.003, 0.006, abs(p.x))) * step(0.035, abs(p.y)));
          float post = max((1.0 - smoothstep(0.012, 0.017, abs(p.y))) * step(0.5, abs(p.x)), (1.0 - smoothstep(0.012, 0.017, abs(p.x))) * step(0.5, p.y * -1.0));
          float dots = 0.0;
          for (int i = 1; i < 5; i++) { float at = float(i) * 0.1; dots = max(dots, 1.0 - smoothstep(0.009, 0.014, length(vec2(abs(p.x) - at, p.y)))); dots = max(dots, 1.0 - smoothstep(0.009, 0.014, length(vec2(p.x, p.y + at)))); }
          view = mix(view, vec3(0.015), max(max(fine, post), dots) * 0.95);
        } else {
          float ring = 1.0 - smoothstep(0.006, 0.012, abs(r - 0.15));
          float dot = 1.0 - smoothstep(0.012, 0.02, r);
          float ticks = (1.0 - smoothstep(0.004, 0.008, abs(p.x))) * step(0.15, -p.y) * step(-p.y, 0.4);
          view = mix(view, uAccent * 1.7, max(max(ring, dot), ticks) * 0.9);
        }
        // Scope shadow: the part of the field the eye can reach is a soft-edged disc that slides and shrinks.
        float seen = (1.0 - smoothstep(uBeam * 0.62, uBeam, length(p * uSpread - uEye))) * (1.0 - smoothstep(0.97, 1.0, r));
        vec3 dark = vec3(0.004, 0.006, 0.008);
        vec3 color = mix(dark, view, seen);
        // The glass itself: a faint coated sheen that shows where there is no picture.
        color += (vec3(0.07, 0.04, 0.11) * pow(max(0.0, 1.0 - length(p - vec2(-0.35, 0.4))), 2.0) + vec3(0.02, 0.05, 0.04) * pow(max(0.0, 1.0 - length(p - vec2(0.3, -0.35)) * 1.4), 2.0)) * (1.0 - seen * 0.9);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#dbe8f7', '#4a4f57', 1.9));
    const fill = new THREE.DirectionalLight('#bcd4ff', 1.1); fill.position.set(1.5, 0.6, 1.2); this.scene.add(fill);
    this.key = new THREE.DirectionalLight('#ffe2bb', 2.2);
    this.key.position.set(-1, 2, 1.5);
    this.scene.add(this.key);
    this.flashLight = new THREE.PointLight('#ffb45e', 0, 3);
    this.scene.add(this.flashLight);
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = flashCanvas.height = 128;
    const context = flashCanvas.getContext('2d');
    context.translate(64, 64);
    for (let i = 0; i < 9; i += 1) { context.rotate((Math.PI * 2) / 9 + i); const length = 30 + ((i * 37) % 30); const gradient = context.createLinearGradient(0, 0, length, 0); gradient.addColorStop(0, 'rgba(255,240,200,1)'); gradient.addColorStop(1, 'rgba(255,150,40,0)'); context.fillStyle = gradient; context.beginPath(); context.moveTo(0, -7); context.lineTo(length, 0); context.lineTo(0, 7); context.fill(); }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(flashCanvas), blending: THREE.AdditiveBlending, transparent: true, depthTest: false }));
    this.flash.visible = false;
    this.scene.add(this.flash);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.models = new Map();
    this.scopeTarget = new THREE.WebGLRenderTarget(768, 768, { depthBuffer: true, type: THREE.HalfFloatType });
    this.scopeMaterial = scopeGlass(this.scopeTarget.texture);
    this.scopeMag = 4; this.lensFraction = 0.2; this.scopeAim = new THREE.Quaternion(); this.scopeSkip = 0; this.lensAt = new THREE.Vector3(); this.lensAxis = new THREE.Vector3();
    this.wall = 0; this.wallVel = 0; this.wallSide = 0;
    // Red dots and holos: the reticle is collimated, so it sits at infinity along the gun's axis and is only
    // there at all while the eye is somewhere behind the window. One sprite each, drawn over the gun.
    const reticle = (draw) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const c = canvas.getContext('2d'); c.translate(64, 64); draw(c); const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); sprite.renderOrder = 50; sprite.visible = false; sprite.layers.set(1); this.scene.add(sprite); return sprite; };
    this.reticles = {
      dot: reticle((c) => { const glow = c.createRadialGradient(0, 0, 0, 0, 0, 26); glow.addColorStop(0, 'rgba(255,60,40,1)'); glow.addColorStop(0.3, 'rgba(255,40,30,.9)'); glow.addColorStop(1, 'rgba(255,30,20,0)'); c.fillStyle = glow; c.beginPath(); c.arc(0, 0, 26, 0, Math.PI * 2); c.fill(); }),
      holo: reticle((c) => { c.strokeStyle = 'rgba(255,50,35,.95)'; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, 50, 0, Math.PI * 2); c.stroke(); for (let k = 0; k < 4; k += 1) { c.rotate(Math.PI / 2); c.fillStyle = 'rgba(255,50,35,.95)'; c.fillRect(-2.5, 50, 5, 12); } c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill(); }),
    };
    this.eyeLocal = new THREE.Vector3(); this.inverse = new THREE.Matrix4();
    this.current = null;
    this.currentId = null;
    this.accent = '#6ce6d1'; this.suit = '#ec6a9e'; this.skins = {}; this.charm = 'none';
    this.charmGravity = new THREE.Vector3(0, -1, 0); this.charmJolt = new THREE.Vector3();
    this.kick = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.bob = 0; this.equip = 1; this.flashTime = 0;
    this.reloadTime = 0; this.reloadDuration = 0; this.cycleTime = -1; this.cycleDuration = 0; this.slash = -1; this.landDip = 0;
    this.slashKind = 0; this.slashCount = 0; this.lastSlashAt = 0;
    this.kickRoll = 0; this.kickYaw = 0; this.slideKick = 0; this.cylinderTurn = 0; this.inspectTime = -1;
    this.ads = 0; this.strafe = 0; this.air = 0; this.crouchLean = 0; this.run = 0; this.scratch = new THREE.Vector3();
    this.hidden = false;
  }

  setLook(suit, accent, skins = {}, charm = 'none') {
    if (suit === this.suit && accent === this.accent && charm === this.charm && JSON.stringify(skins) === JSON.stringify(this.skins)) return;
    this.suit = suit; this.accent = accent; this.skins = { ...skins }; this.charm = charm || 'none';
    this.models.forEach((model) => this.holder.remove(model));
    this.models.clear();
    if (this.currentId) { const id = this.currentId; this.currentId = null; this.setWeapon(id, true); }
  }

  setWeapon(id, instant = false) {
    if (id === this.currentId) return;
    if (!this.models.has(id)) { const model = buildWeapon(id, this.accent, this.skins[id]); model.userData.sleeve.color.set(this.suit);
      // Layer 1 is what stays sharp while the gun is blurred: the scope's picture and the projected reticles.
      if (model.userData.lens) { model.userData.lens.material = this.scopeMaterial; model.userData.lens.layers.set(1); }
      const charm = WEAPONS[id]?.melee ? null : buildCharm(this.charm);
      // Hung from the gun's own sling stud (each model says where that is), sized to the gun.
      if (charm && model.userData.charmAt) { charm.position.set(...model.userData.charmAt); charm.scale.setScalar(model.userData.charmScale); charm.traverse((mesh) => { mesh.frustumCulled = false; }); model.add(charm); model.userData.charm = charm; } model.visible = false; this.holder.add(model); this.models.set(id, model); }
    if (this.current) this.current.visible = false;
    this.current = this.models.get(id);
    this.current.visible = true;
    this.currentId = id;
    this.equip = instant ? 1 : 0;
    this.reloadTime = 0; this.cycleTime = -1; this.slash = -1; this.inspectTime = -1;
  }

  fire(weapon) {
    this.kick = Math.min(1.6, this.kick + weapon.recoil.kick * 0.22);
    this.kickRot = Math.min(1.4, this.kickRot + weapon.recoil.kick * 0.2);
    this.kickRoll = (Math.random() - 0.5) * Math.min(1, weapon.recoil.kick) * 0.09;
    this.kickYaw = (Math.random() - 0.5) * Math.min(1, weapon.recoil.kick) * 0.05;
    this.slideKick = 1;
    this.cylinderTurn += Math.PI / 3;
    this.inspectTime = -1;
    this.flashTime = 0.055;
    this.flash.material.rotation = Math.random() * Math.PI;
    if (weapon.action === 'bolt') { this.cycleTime = 0; this.cycleDuration = weapon.cooldown - 0.2; }
    if (weapon.action === 'pump') { this.cycleTime = 0; this.cycleDuration = 0.6; }
  }
  reload(duration) { this.reloadTime = duration; this.reloadDuration = duration; this.inspectTime = -1; }
  cancelReload() { this.reloadTime = 0; }
  // Turn the weapon over in the hands for a look at it (and its finish). Anything else you do ends it.
  inspect() { if (this.reloadTime <= 0 && this.slash < 0 && this.inspectTime < 0) this.inspectTime = 0; }
  // Attacks chain: forehand slash, backhand slash, then a stab. Pause for a second and the chain starts again.
  melee() {
    const now = performance.now();
    if (now - this.lastSlashAt > 1100) this.slashCount = 0;
    this.lastSlashAt = now;
    this.slashKind = this.slashCount % 3;
    this.slashCount += 1;
    this.slash = 0;
    this.inspectTime = -1;
  }
  land(force) { this.landDip = Math.min(1, force); }
  // Does the scope picture need drawing this frame? Every frame while aiming, every third at the hip.
  scopeWanted() {
    if (!this.current?.userData.lens || this.hidden) return false;
    if (this.ads > 0.03) return true;
    this.scopeSkip = (this.scopeSkip + 1) % 3;
    return this.scopeSkip === 0;
  }

  // Where the muzzle is in world space, so tracers start at the barrel.
  muzzleWorld(camera, scoped) {
    if (!this.current || scoped > 0.8) return camera.position.clone().add(new THREE.Vector3(0, -0.06, -0.4).applyQuaternion(camera.quaternion));
    const local = this.current.userData.muzzle.clone().applyMatrix4(this.current.matrixWorld);
    return local.applyQuaternion(camera.quaternion).add(camera.position);
  }

  update(dt, state) {
    const model = this.current;
    if (!model) return;
    const data = model.userData;
    const { clamp, lerp, smoothstep } = THREE.MathUtils;
    const span = (k, from, to) => clamp((k - from) / (to - from), 0, 1);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    // Long guns take longer to bring up than a pistol or the blade.
    this.equip = Math.min(1, this.equip + dt * (data.kind === 'long' ? 3.4 : 5));
    this.kick += (0 - this.kick) * Math.min(1, dt * 11);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 9);
    this.kickRoll += (0 - this.kickRoll) * Math.min(1, dt * 7);
    this.kickYaw += (0 - this.kickYaw) * Math.min(1, dt * 8);
    this.slideKick += (0 - this.slideKick) * Math.min(1, dt * 22);
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 8);
    this.swayX += (-state.lookX * 0.0009 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (state.lookY * 0.0009 - this.swayY) * Math.min(1, dt * 9);
    this.swayX = clamp(this.swayX, -0.05, 0.05); this.swayY = clamp(this.swayY, -0.05, 0.05);
    this.strafe += (clamp(state.strafe || 0, -1, 1) - this.strafe) * Math.min(1, dt * 7);
    this.air += ((state.onGround ? 0 : 1) - this.air) * Math.min(1, dt * (state.onGround ? 12 : 5));
    this.crouchLean += ((state.crouch ? 1 : 0) - this.crouchLean) * Math.min(1, dt * 9);
    const moving = state.onGround ? Math.min(1, state.speed / 6) : 0;
    this.run += ((moving > 0.85 ? 1 : 0) - this.run) * Math.min(1, dt * 5);
    this.bob += dt * (4 + state.speed * 1.35);
    const ads = state.scoped;
    const hipOnly = 1 - ads;
    const bobScale = moving * (1 - ads * 0.85);
    // A figure of eight: across once per stride, down twice.
    const bx = Math.cos(this.bob) * 0.012 * bobScale, by = (Math.abs(Math.sin(this.bob)) * -0.015 + Math.sin(this.bob * 2) * 0.003) * bobScale;
    const now = performance.now() / 1000;
    const idleY = Math.sin(now * 1.15) * 0.0028 * hipOnly, idleX = Math.sin(now * 0.7 + 1) * 0.0016 * hipOnly;
    const ease = 1 - (1 - this.equip) ** 3;
    // Dots and holos: the housing comes up to the eye and frames the HUD reticle, so it moves less once aimed.
    const open = data.sight === 'dot' || data.sight === 'holo';
    const steady = open ? 1 - ads * 0.7 : 1;
    // Aimed, the gun floats a few millimetres around the line of sight: a scope's shadow breathes with it.
    const floatX = (state.aimSway?.[0] || 0) * 0.0016, floatY = (state.aimSway?.[1] || 0) * 0.0016;
    const x = lerp(data.hip[0], data.ads[0], ads) + floatX + bx + idleX + this.swayX * steady - this.strafe * 0.008 * hipOnly;
    const y = lerp(data.hip[1], data.ads[1], ads) + floatY + by + this.swayY * steady + idleY - this.landDip * 0.05 + this.air * 0.012 * hipOnly - this.crouchLean * 0.012 * hipOnly - this.run * 0.012 * hipOnly;
    const z = lerp(data.hip[2], data.ads[2], ads) + this.kick * 0.085 * steady + this.run * 0.015 * hipOnly;
    model.position.set(x, y, z);
    model.rotation.set(
      (this.kickRot * 0.13 + this.swayY * 1.5) * steady - this.air * 0.05 * hipOnly - this.run * 0.05 * hipOnly,
      0.06 * hipOnly + this.swayX * 2 * steady + this.kickYaw * steady + this.run * 0.1 * hipOnly,
      -this.swayX * 1.4 * steady + this.kickRoll * steady - this.strafe * 0.05 * hipOnly + this.crouchLean * 0.06 * hipOnly + Math.sin(this.bob) * 0.012 * bobScale,
    );
    // Drawing it: long guns swing up from low on the right and roll level; pistols snap up and settle.
    if (this.equip < 1 && !data.knife) {
      const left = 1 - ease;
      if (data.kind === 'long') { model.position.y -= left * 0.3; model.position.x += left * 0.12; model.rotation.x += left * 0.7; model.rotation.z -= left * 0.9; model.rotation.y -= left * 0.5; }
      else { const over = Math.sin(this.equip * Math.PI) * 0.12; model.position.y -= left * 0.28; model.rotation.x += left * 1.1 - over; model.rotation.z += left * 0.4; }
    }

    // Moving parts that answer every shot.
    if (data.slide) data.slide.position.z = data.slide.userData.rest.z + this.slideKick * data.slideTravel;
    if (data.cylinder) data.cylinder.rotation.z += (this.cylinderTurn - data.cylinder.rotation.z) * Math.min(1, dt * 18);

    // Reload, by the kind of weapon. k runs 0 → 1 over the reload.
    const leftHand = data.leftHand, magRest = data.mag?.userData.rest;
    if (leftHand && !data.pumpHand) leftHand.position.copy(data.leftRest);
    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - dt);
      const k = 1 - this.reloadTime / this.reloadDuration;
      const tilt = smoothstep(k, 0, 0.14) * (1 - smoothstep(k, 0.86, 1));
      if (data.kind === 'break') {
        // Thumb the lever, the barrels drop, two shells in, snap it shut.
        const openK = smoothstep(k, 0.1, 0.28) * (1 - smoothstep(k, 0.74, 0.86));
        data.hinge.rotation.x = -openK * 0.62;
        model.rotation.x += tilt * 0.35 - Math.sin(span(k, 0.74, 0.9) * Math.PI) * 0.12; model.rotation.z += tilt * 0.3; model.position.y -= tilt * 0.04;
        model.position.y += (Math.sin(span(k, 0.34, 0.5) * Math.PI) + Math.sin(span(k, 0.52, 0.68) * Math.PI)) * -0.012;
      } else if (data.kind === 'revolver') {
        // Cylinder out to the left, a spin, a speed-loader, flick it shut.
        const outK = smoothstep(k, 0.12, 0.26) * (1 - smoothstep(k, 0.78, 0.88));
        data.cylinder.position.x = data.cylinder.userData.rest.x - outK * 0.042; data.cylinder.position.y = data.cylinder.userData.rest.y - outK * 0.012;
        this.cylinderTurn += dt * outK * 9;
        model.rotation.x += tilt * 0.55; model.rotation.z += tilt * 0.35 - Math.sin(span(k, 0.78, 0.92) * Math.PI) * 0.3; model.position.y -= tilt * 0.03;
      } else if (!data.mag) {
        // Tube-fed: rolled over, shells thumbed in one after another.
        const shells = Math.max(2, Math.round(this.reloadDuration / 0.55));
        const push = Math.abs(Math.sin(span(k, 0.12, 0.88) * Math.PI * shells));
        model.rotation.z += tilt * 0.75; model.rotation.x += tilt * 0.22; model.position.y -= tilt * 0.035 - push * tilt * 0.012; model.position.z += push * tilt * 0.01;
      } else {
        // Magazine out and down, a fresh one up with a slap, then the bolt or the slide.
        const outK = smoothstep(k, 0.14, 0.3), inK = smoothstep(k, 0.46, 0.62);
        const drop = outK * (1 - inK);
        data.mag.position.set(magRest.x, magRest.y - drop * 0.34, magRest.z + drop * 0.05);
        data.mag.rotation.x = -drop * 0.5;
        data.mag.visible = drop < 0.93;
        const slap = Math.sin(span(k, 0.6, 0.7) * Math.PI);
        model.rotation.z += tilt * (data.kind === 'pistol' ? 0.4 : 0.55); model.rotation.x += tilt * 0.3 - slap * 0.05; model.position.y -= tilt * 0.05 - slap * 0.012;
        if (leftHand) { const follow = smoothstep(k, 0.06, 0.18) * (1 - smoothstep(k, 0.66, 0.78)); leftHand.position.lerpVectors(data.leftRest, this.scratch.set(magRest.x, magRest.y - 0.12 - drop * 0.3, magRest.z + 0.02 + drop * 0.05), follow); }
        const rack = Math.sin(span(k, 0.76, 0.92) * Math.PI);
        if (data.slide) data.slide.position.z = data.slide.userData.rest.z + Math.max(this.slideKick, rack) * data.slideTravel;
        if (data.bolt) { data.bolt.rotation.z = Math.min(1, rack * 2.5) * 0.9; data.bolt.position.z = data.bolt.userData.rest.z + rack * 0.08; }
        model.position.z += rack * 0.012;
      }
    } else {
      if (data.mag) { data.mag.visible = true; data.mag.position.copy(magRest); data.mag.rotation.x = 0; }
      if (data.hinge) data.hinge.rotation.x = 0;
      if (data.cylinder) data.cylinder.position.copy(data.cylinder.userData.rest);
    }

    // Bolt / pump cycling after a shot.
    if (this.cycleTime >= 0) {
      this.cycleTime += dt;
      const k = this.cycleTime / this.cycleDuration;
      const pull = k < 0.2 ? 0 : Math.sin(Math.min(1, (k - 0.2) / 0.8) * Math.PI);
      if (data.bolt) { data.bolt.rotation.z = Math.min(1, pull * 2.5) * 0.9; data.bolt.position.z = data.bolt.userData.rest.z + pull * 0.09; model.rotation.z += pull * 0.12; model.position.y -= pull * 0.012; }
      if (data.pump) { data.pump.position.z = data.pump.userData.rest.z + pull * 0.1; model.rotation.x += pull * 0.04; }
      if (k >= 1) { this.cycleTime = -1; if (data.bolt) { data.bolt.rotation.z = 0; data.bolt.position.copy(data.bolt.userData.rest); } if (data.pump) data.pump.position.copy(data.pump.userData.rest); }
    }

    // A wall in the way: the gun cannot go through it, so it is shoved back and its muzzle rides up and across.
    // A damped spring, so walking into a wall bumps the gun and backing off lets it swing back down.
    const blocked = clamp(state.wall || 0, 0, 1);
    this.wallVel += ((blocked - this.wall) * 140 - this.wallVel * 17) * dt;
    this.wall = clamp(this.wall + this.wallVel * dt, -0.08, 1.05);
    if (Math.abs(this.wall) > 0.001 && !data.knife) {
      const w = this.wall, long = data.kind === 'long' ? 1 : 0.55;
      model.position.z += w * 0.2 * long; model.position.y -= w * 0.05; model.position.x += w * 0.03;
      model.rotation.x += w * 0.95 * long; model.rotation.y += w * 0.5 * long; model.rotation.z -= w * 0.35;
    }

    // Inspect: roll it one way, then the other, and bring it back.
    if (this.inspectTime >= 0) {
      if (ads > 0.2) this.inspectTime = -1;
      else {
        this.inspectTime += dt / 3.2;
        const k = this.inspectTime;
        const inOut = smoothstep(k, 0, 0.16) * (1 - smoothstep(k, 0.84, 1));
        const turn = Math.sin(span(k, 0.1, 0.9) * Math.PI * 2);
        model.position.x -= inOut * 0.07; model.position.y += inOut * 0.05; model.position.z += inOut * 0.06;
        model.rotation.y += inOut * (0.55 + turn * 0.75); model.rotation.z += inOut * (0.35 - turn * 0.5); model.rotation.x += inOut * 0.18;
        if (k >= 1) this.inspectTime = -1;
      }
    }

    if (data.knife) {
      // Hammer grip: fist low on the right, blade up and tipped forward, edge toward the target. Never dead still.
      model.rotation.x += 0.95 + Math.sin(now * 1.3) * 0.015;
      model.rotation.y += 0.3 + Math.sin(now * 0.9 + 1) * 0.02;
      model.rotation.z += -0.18 + Math.sin(now * 0.75) * 0.012;
      // Draw: up from below with one turn in the hand.
      if (this.equip < 1) { const spin = 1 - ease; model.rotation.x -= spin * Math.PI * 2; model.position.y -= spin * 0.16; model.position.x += spin * 0.05; }
    }
    if (this.slash >= 0) {
      this.slash += dt / (data.knife ? 0.42 : 0.32);
      const k = Math.min(1, this.slash);
      if (data.knife) {
        // wind: a short pull back; cut: fast and late-peaking; home: eases back to the ready.
        const wind = Math.sin(span(k, 0, 0.2) * Math.PI);
        const cut = smoothstep(k, 0.14, 0.42);
        const home = 1 - smoothstep(k, 0.55, 1);
        if (this.slashKind === 2) {
          // Stab: the point comes down level, drives out along the view, snaps back.
          const drive = cut * home;
          model.rotation.x -= (wind * 0.2 + drive) * 0.85; model.rotation.y -= drive * 0.2; model.rotation.z += drive * 0.25;
          model.position.z += wind * 0.09 - drive * 0.3; model.position.x -= drive * 0.1; model.position.y += drive * 0.09;
        } else {
          // Slashes cross the view: forehand right to left and down, backhand back the other way and up.
          const dir = this.slashKind === 0 ? 1 : -1;
          const sweep = (cut - wind * 0.3) * home, arc = Math.sin(cut * Math.PI) * home;
          model.position.x -= dir * sweep * 0.3 + (dir < 0 ? wind * 0.1 : 0);
          model.position.y += arc * 0.07 + dir * (wind * 0.03 - sweep * 0.025);
          model.position.z -= arc * 0.18 - wind * 0.04;
          model.rotation.x -= arc * 0.3 + sweep * 0.12;
          model.rotation.y += dir * sweep * 0.9;
          model.rotation.z += dir * sweep * 1.1;
        }
      } else {
        // A gun butt: the weapon whips across and back.
        const arc = Math.sin(k * Math.PI);
        model.position.x -= arc * 0.28; model.position.z -= arc * 0.22; model.position.y += arc * 0.05;
        model.rotation.y += arc * 1.1; model.rotation.z += arc * 0.6;
      }
      if (k >= 1) this.slash = -1;
    }

    // The charm last, once the gun is where this frame's recoil, reload, bolt work and sway have put it.
    if (data.charm) {
      const pitch = state.pitch || 0;
      this.charmGravity.set(0, -Math.cos(pitch), Math.sin(pitch));
      // A fast turn of the view leaves the charm behind for a moment.
      this.charmJolt.set(THREE.MathUtils.clamp(-state.lookX * 1.1, -45, 45), THREE.MathUtils.clamp(state.lookY * 0.8, -35, 35), 0);
      updateCharm(data.charm, dt, { gravity: this.charmGravity, jolt: this.charmJolt, onClink: (strength) => { if (!this.hidden) play('charm', { volume: 0.25 + strength * 0.6 }); } });
    }

    // The eyepiece: how open the exit pupil is and which way it has slid, from where the lens sits to the eye.
    this.ads = ads;
    if (data.lens) {
      model.updateMatrixWorld();
      const at = this.lensAt.set(0, data.lensAt.y, data.lensAt.z).applyMatrix4(model.matrixWorld);
      const axis = this.lensAxis.set(0, 0, 1).applyQuaternion(model.quaternion);   // from the eyepiece back toward the shooter
      // Where the eye (the origin) is relative to the eyepiece: how far back along the axis, how far off it.
      const back = -at.dot(axis);
      const offX = -(at.x + axis.x * back), offY = -(at.y + axis.y * back);
      // Exit pupil: a 40 mm objective over the magnification. The "eye" is a game camera, so its pupil is generous.
      const uniforms = this.scopeMaterial.uniforms;
      uniforms.uBeam.value = 0.02 / Math.max(1, this.scopeMag) + 0.011;
      // Beams from the edge of an 11° apparent field drift this far off the axis by the time they reach the eye.
      uniforms.uSpread.value = (back - EYE_RELIEF) * 0.2;
      uniforms.uEye.value.set(offX, offY);
      // How much of the screen's half-height the glass covers, for the magnification; and where the scope points.
      this.lensFraction = (data.lensAt.r / Math.max(0.04, -at.z)) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      this.scopeAim.copy(model.quaternion);
      uniforms.uPrism.value = data.prism ? 1 : 0;
    }
    for (const sprite of Object.values(this.reticles)) sprite.visible = false;
    if (data.window && !this.hidden) {
      // Where the eye is in the gun's own space: inside the window's outline means the reticle can be seen.
      model.updateMatrixWorld();
      const eye = this.eyeLocal.set(0, 0, 0).applyMatrix4(this.inverse.copy(model.matrixWorld).invert());
      const win = data.window, dy = eye.y - win.y;
      const edge = win.kind === 'dot' ? 1 - Math.hypot(eye.x, dy) / win.r : Math.min(1 - Math.abs(eye.x) / win.w, 1 - Math.abs(dy) / win.h);
      if (edge > 0) {
        const sprite = this.reticles[win.kind];
        sprite.visible = true;
        sprite.position.set(0, 0, -3).applyQuaternion(model.quaternion);
        sprite.scale.setScalar(win.kind === 'dot' ? 0.045 : 0.2);
        sprite.material.opacity = Math.min(1, edge * 6);
      }
    }
    const hide = this.hidden || (data.adsHide && ads > 0.7);
    this.holder.visible = !hide;
    this.flashTime = Math.max(0, this.flashTime - dt);
    const flashing = this.flashTime > 0 && !hide;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? 6 : 0;
    if (flashing) {
      model.updateMatrixWorld();
      this.flash.position.copy(data.muzzle).applyMatrix4(model.matrixWorld);
      this.flash.position.z -= 0.04;
      this.flashLight.position.copy(this.flash.position);
      const size = 0.16 + Math.random() * 0.12;
      this.flash.scale.set(size, size, 1);
    }
  }
}
