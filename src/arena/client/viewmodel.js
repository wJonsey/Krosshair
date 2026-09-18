// First-person weapons. Rendered in their own scene on top of the world so the
// rifle never clips through walls. All models and animation are procedural.
import * as THREE from 'three';
import { WEAPONS } from '../shared/constants.js';
import { skinMaterial } from './skins.js';

const M = (color, rough = 0.4, metal = 0.5, emissive = null) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive || '#000000', emissiveIntensity: emissive ? 1.3 : 0 });

function part(group, geometry, material, position, rotation = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tube = (r, length, seg = 10) => new THREE.CylinderGeometry(r, r, length, seg);
const ALONG = [Math.PI / 2, 0, 0];


// Open optics you actually look through: the housing frames the target and the HUD only adds the reticle.
// Both sit on a rail whose top is at `rail` and return the height of the window centre, which is what
// aiming down the sight lines up with the eye.
const LENS = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
function redDot(g, m, rail, z) {
  const r = 0.03, centre = rail + 0.016 + r;
  const shell = new THREE.MeshStandardMaterial({ color: '#1b222a', roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide });
  part(g, box(0.044, 0.016, 0.085), m.dark, [0, rail + 0.008, z]);
  part(g, new THREE.CylinderGeometry(r, r, 0.075, 20, 1, true), shell, [0, centre, z], ALONG);
  part(g, new THREE.TorusGeometry(r, 0.0045, 6, 20), m.dark, [0, centre, z - 0.0375]);
  part(g, new THREE.TorusGeometry(r, 0.0045, 6, 20), m.dark, [0, centre, z + 0.0375]);
  part(g, box(0.014, 0.012, 0.02), m.grey, [0, centre + r + 0.006, z]);
  part(g, new THREE.CircleGeometry(r - 0.002, 20), LENS, [0, centre, z - 0.03]);
  return centre;
}
function holoSight(g, m, rail, z) {
  const w = 0.058, h = 0.046, centre = rail + 0.018 + h / 2;
  part(g, box(w + 0.012, 0.018, 0.11), m.dark, [0, rail + 0.009, z]);
  part(g, box(0.006, h, 0.05), m.dark, [w / 2 + 0.003, centre, z - 0.025]);
  part(g, box(0.006, h, 0.05), m.dark, [-w / 2 - 0.003, centre, z - 0.025]);
  part(g, box(w + 0.012, 0.007, 0.06), m.dark, [0, centre + h / 2 + 0.0035, z - 0.025]);
  part(g, box(0.02, 0.014, 0.03), m.grey, [w / 2 + 0.012, rail + 0.016, z + 0.03]);
  part(g, new THREE.PlaneGeometry(w, h), LENS, [0, centre, z - 0.04]);
  return centre;
}
// Eye relief when aimed: the back of the housing ends up about a hand's width from the camera.
const OPTIC_ADS_Z = -0.055;

// Shared builder for the newer long guns: receiver, barrel, stock, grip, magazine, optic.
// o: { len, barrel, bore, guard, stock, wood, mag: [kind, h], optic, brake, bipod, suppressor, hip, ads, reach }
function longGun(g, o, m) {
  const front = 0.08 - o.len;
  part(g, box(o.width || 0.056, o.height || 0.09, o.len), m.steel, [0, 0, 0.08 - o.len / 2]);
  if (o.guard) part(g, box(0.064, 0.072, o.guard), m.dark, [0, -0.005, front + 0.02 - o.guard / 2]);
  const guardEnd = front - (o.guard ? o.guard - 0.02 : 0);
  part(g, tube(o.bore || 0.015, o.barrel), m.grey, [0, 0.01, guardEnd - o.barrel / 2], ALONG);
  let muzzle = guardEnd - o.barrel;
  if (o.brake) { part(g, box(0.05, 0.04, 0.1), m.dark, [0, 0.01, muzzle - 0.04]); muzzle -= 0.09; }
  if (o.suppressor) { part(g, tube(0.028, 0.24, 10), m.dark, [0, 0.01, muzzle - 0.1], ALONG); muzzle -= 0.22; }
  part(g, box(0.05, o.stockH || 0.1, o.stock), o.wood ? m.wood : m.dark, [0, -0.02, 0.08 + o.stock / 2]);
  part(g, box(0.04, 0.12, 0.055), m.dark, [0, -0.1, 0.0], [-0.28, 0, 0]);
  const [kind, h = 0.16] = o.mag || ['box'];
  const magZ = 0.08 - o.len * 0.62;
  let mag = null;
  let sightLine = null;
  if (kind === 'box') mag = part(g, box(0.04, h, 0.07), m.dark, [0, -0.05 - h / 2, magZ], [0.12, 0, 0]);
  if (kind === 'drum') mag = part(g, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), m.dark, [0, -0.1, magZ], [0, 0, Math.PI / 2]);
  if (kind === 'belt') { mag = part(g, box(0.1, 0.11, 0.14), m.dark, [0.02, -0.1, magZ]); part(g, box(0.02, 0.03, 0.12), m.grey, [0.045, 0.02, magZ]); }
  if (kind === 'tube') mag = part(g, tube(0.018, o.len * 0.8), m.grey, [0, -0.05, 0.08 - o.len * 0.5], ALONG);
  if (o.optic === 'scope' || o.optic === 'bigscope') {
    const r = o.optic === 'bigscope' ? 0.044 : 0.034, l = o.optic === 'bigscope' ? 0.44 : 0.32;
    part(g, tube(r, l, 12), m.dark, [0, 0.1, 0.08 - o.len * 0.45], ALONG);
    part(g, tube(r + 0.008, 0.06, 12), m.dark, [0, 0.1, 0.08 - o.len * 0.45 - l / 2], ALONG);
    part(g, box(0.03, 0.04, 0.05), m.grey, [0, 0.058, 0.08 - o.len * 0.3]);
    part(g, box(0.03, 0.04, 0.05), m.grey, [0, 0.058, 0.08 - o.len * 0.62]);
  } else if (o.optic === 'holo') {
    sightLine = holoSight(g, m, (o.height || 0.09) / 2, -0.15);
  } else if (o.optic === 'dot') {
    sightLine = redDot(g, m, (o.height || 0.09) / 2, -0.15);
  } else {
    // Iron sights: thin front post, rear notch with a gap to look through.
    part(g, box(0.004, 0.024, 0.008), m.grey, [0, 0.062, front + 0.03]);
    part(g, box(0.008, 0.024, 0.012), m.grey, [0.011, 0.062, 0.03]);
    part(g, box(0.008, 0.024, 0.012), m.grey, [-0.011, 0.062, 0.03]);
  }
  if (o.bipod) { part(g, tube(0.008, 0.26, 6), m.grey, [0.03, -0.12, guardEnd - 0.05], [0.4, 0, 0.3]); part(g, tube(0.008, 0.26, 6), m.grey, [-0.03, -0.12, guardEnd - 0.05], [0.4, 0, -0.3]); }
  part(g, box(0.006, 0.01, o.len * 0.7), m.glow, [0.031, 0, 0.08 - o.len / 2]);
  return { mag, muzzle, sightLine };
}

// Front post and rear notch on a pistol slide whose top sits at y ≈ 0.048.
function pistolSights(g, grey, dark, frontZ) {
  part(g, box(0.006, 0.012, 0.01), grey, [0, 0.054, frontZ]);
  part(g, box(0.01, 0.012, 0.01), dark, [0.011, 0.054, -0.02]);
  part(g, box(0.01, 0.012, 0.01), dark, [-0.011, 0.054, -0.02]);
}

// Kestrel Blade: a drop-point fighting knife. The blade is a real profile (belly, clip point, ground edge),
// with a fuller carrying the accent glow, jimping on the spine, a two-quillon guard, a contoured grip with
// scales and a steel pommel with a lanyard ring. Blade along -z, edge down. A finish covers blade and scales.
function buildKnife(g, m) {
  const knife = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(0, -0.019);
  profile.lineTo(0.018, -0.021);                                  // choil
  profile.bezierCurveTo(0.09, -0.024, 0.165, -0.02, 0.232, 0.009); // belly up to the point
  profile.lineTo(0.17, 0.0205);                                   // clip
  profile.lineTo(0.0, 0.0205);                                    // spine
  profile.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(profile, { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0085, bevelSegments: 1, steps: 1, curveSegments: 10 });
  bladeGeo.translate(0, 0, -0.0011);
  const blade = new THREE.Mesh(bladeGeo, m.blade);
  blade.rotation.y = Math.PI / 2;                                  // shape x runs down -z, thickness across x
  blade.position.set(0, 0, -0.05);
  knife.add(blade);
  for (const side of [-1, 1]) {
    part(knife, box(0.0012, 0.006, 0.13), m.glow, [side * 0.0034, 0.009, -0.125]);          // fuller
    part(knife, box(0.0016, 0.012, 0.03), m.grip, [side * 0.0032, -0.004, -0.068]);          // maker's panel
  }
  for (let notch = 0; notch < 6; notch += 1) part(knife, box(0.0062, 0.004, 0.0045), m.fittings, [0, 0.03, -0.06 - notch * 0.0085]);   // jimping
  // Guard: two quillons swept a little forward.
  part(knife, box(0.017, 0.03, 0.013), m.fittings, [0, 0.028, -0.046], [0.3, 0, 0]);
  part(knife, box(0.017, 0.034, 0.013), m.fittings, [0, -0.03, -0.047], [-0.35, 0, 0]);
  part(knife, box(0.02, 0.05, 0.012), m.fittings, [0, 0, -0.043]);
  // Grip: a flattened, slightly waisted handle with scales either side and rings to hold on to.
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.0155, 0.088, 4, 12), m.grip);
  core.rotation.x = Math.PI / 2; core.scale.set(0.82, 1, 1.25); core.position.set(0, -0.002, 0.014);
  knife.add(core);
  for (const side of [-1, 1]) {
    const scale = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.074, 4, 10), m.scales);
    scale.rotation.x = Math.PI / 2; scale.scale.set(0.45, 1, 1.45); scale.position.set(side * 0.0105, -0.002, 0.014);
    knife.add(scale);
    for (const z of [-0.012, 0.014, 0.04]) part(knife, tube(0.0032, 0.0035, 8), m.fittings, [side * 0.0148, -0.002, z], [0, 0, Math.PI / 2]);   // pins
  }
  for (const z of [-0.024, -0.004, 0.016, 0.036]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0178, 0.0022, 6, 14), m.grip); ring.scale.set(0.84, 1.24, 1); ring.position.set(0, -0.002, z); knife.add(ring); }
  part(knife, tube(0.0165, 0.016, 12), m.fittings, [0, -0.003, 0.076], ALONG);              // pommel
  const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.0085, 0.0022, 6, 14), m.fittings);
  lanyard.rotation.y = Math.PI / 2; lanyard.position.set(0, -0.003, 0.094);
  knife.add(lanyard);
  g.add(knife);
  return knife;
}

// finish: a gun skin id; it covers the body, furniture and dark parts, leaving bare metal and the glow strip.
export function buildWeapon(id, accent, finish = null) {
  const g = new THREE.Group();
  const skin = skinMaterial(finish);
  const steel = skin || M('#2a3038'), dark = skin || M('#14181d', 0.5, 0.3), grey = M('#56616c', 0.35, 0.7), wood = skin || M('#6e4a2b', 0.7, 0.05), glow = M(accent, 0.3, 0.2, accent);
  const data = { muzzle: new THREE.Vector3(0, 0.03, -0.9), mag: null, bolt: null, pump: null, hip: [0.19, -0.2, -0.42], ads: [0, -0.115, -0.3], adsHide: false };
  if (id === 'm44') {
    part(g, box(0.055, 0.08, 0.62), steel, [0, 0, -0.2]);
    part(g, tube(0.016, 0.72), grey, [0, 0.02, -0.82], ALONG);
    part(g, tube(0.028, 0.12, 8), dark, [0, 0.02, -1.2], ALONG);
    part(g, box(0.05, 0.11, 0.34), wood, [0, -0.03, 0.2]);
    part(g, box(0.04, 0.12, 0.06), dark, [0, -0.09, 0.0], [-0.3, 0, 0]);
    part(g, tube(0.034, 0.34, 12), dark, [0, 0.095, -0.2], ALONG);
    part(g, tube(0.042, 0.06, 12), dark, [0, 0.095, -0.39], ALONG);
    part(g, tube(0.04, 0.05, 12), dark, [0, 0.095, -0.02], ALONG);
    part(g, box(0.03, 0.035, 0.05), grey, [0, 0.055, -0.28]);
    part(g, box(0.03, 0.035, 0.05), grey, [0, 0.055, -0.1]);
    part(g, box(0.006, 0.01, 0.5), glow, [0.029, 0.0, -0.22]);
    data.mag = part(g, box(0.045, 0.08, 0.1), dark, [0, -0.075, -0.17]);
    const bolt = new THREE.Group();
    part(bolt, tube(0.012, 0.09, 6), grey, [0.045, 0, 0], [0, 0, Math.PI / 2]);
    part(bolt, new THREE.SphereGeometry(0.02, 8, 6), grey, [0.09, 0, 0]);
    bolt.position.set(0.03, 0.03, -0.03);
    g.add(bolt);
    data.bolt = bolt;
    data.muzzle.set(0, 0.02, -1.26);
    data.ads = [0, -0.095, -0.2];
    data.adsHide = true;
  } else if (id === 'recon') {
    part(g, box(0.055, 0.09, 0.5), steel, [0, 0, -0.18]);
    part(g, box(0.06, 0.06, 0.3), dark, [0, 0.0, -0.5]);
    part(g, tube(0.014, 0.3), grey, [0, 0.01, -0.78], ALONG);
    part(g, box(0.05, 0.1, 0.26), dark, [0, -0.02, 0.17]);
    part(g, box(0.04, 0.11, 0.055), dark, [0, -0.09, 0.0], [-0.3, 0, 0]);
    part(g, tube(0.028, 0.2, 10), dark, [0, 0.09, -0.2], ALONG);
    part(g, box(0.03, 0.03, 0.12), grey, [0, 0.055, -0.2]);
    part(g, box(0.006, 0.01, 0.4), glow, [0.029, 0.0, -0.25]);
    data.mag = part(g, box(0.04, 0.16, 0.07), dark, [0, -0.11, -0.2], [0.12, 0, 0]);
    data.muzzle.set(0, 0.01, -0.94);
    data.ads = [0, -0.09, -0.2];
    data.adsHide = true;
  } else if (id === 'talon') {
    part(g, box(0.058, 0.095, 0.46), steel, [0, 0, -0.16]);
    part(g, box(0.064, 0.07, 0.26), dark, [0, -0.005, -0.5]);
    part(g, tube(0.015, 0.26), grey, [0, 0.01, -0.74], ALONG);
    part(g, tube(0.024, 0.07, 8), dark, [0, 0.01, -0.9], ALONG);
    part(g, box(0.05, 0.085, 0.24), dark, [0, -0.015, 0.2]);
    part(g, box(0.04, 0.12, 0.055), dark, [0, -0.1, 0.0], [-0.28, 0, 0]);
    part(g, box(0.02, 0.012, 0.36), grey, [0, 0.055, -0.22]);
    const talonSight = redDot(g, { dark, grey }, 0.061, -0.16);
    part(g, box(0.006, 0.01, 0.34), glow, [0.031, 0.0, -0.2]);
    data.mag = part(g, box(0.04, 0.17, 0.07), dark, [0, -0.12, -0.24], [0.2, 0, 0]);
    data.muzzle.set(0, 0.01, -0.95);
    data.hip = [0.18, -0.2, -0.4];
    data.ads = [0, -talonSight, OPTIC_ADS_Z];
  } else if (id === 'wasp') {
    part(g, box(0.06, 0.1, 0.36), steel, [0, 0, -0.16]);
    part(g, tube(0.02, 0.18), dark, [0, 0.0, -0.42], ALONG);
    part(g, box(0.04, 0.12, 0.055), dark, [0, -0.1, 0.0], [-0.25, 0, 0]);
    part(g, box(0.035, 0.035, 0.22), grey, [0, 0.0, 0.12]);
    const waspSight = redDot(g, { dark, grey }, 0.05, -0.16);
    part(g, box(0.006, 0.01, 0.28), glow, [0.032, 0.02, -0.16]);
    data.mag = part(g, box(0.035, 0.2, 0.05), dark, [0, -0.14, -0.2]);
    data.muzzle.set(0, 0, -0.52);
    data.hip = [0.17, -0.19, -0.36];
    data.ads = [0, -waspSight, OPTIC_ADS_Z];
  } else if (id === 'breaker') {
    part(g, box(0.06, 0.09, 0.34), steel, [0, 0, -0.08]);
    part(g, tube(0.02, 0.6), grey, [0, 0.025, -0.52], ALONG);
    part(g, tube(0.02, 0.46), dark, [0, -0.025, -0.45], ALONG);
    part(g, box(0.05, 0.1, 0.3), wood, [0, -0.03, 0.22]);
    part(g, box(0.006, 0.01, 0.3), glow, [0.032, 0.0, -0.08]);
    data.pump = part(g, box(0.06, 0.055, 0.17), wood, [0, -0.03, -0.42]);
    part(g, new THREE.SphereGeometry(0.006, 8, 6), grey, [0, 0.05, -0.8]);
    data.muzzle.set(0, 0.025, -0.84);
    data.ads = [0, -0.056, -0.26];
  } else if (id === 'p9' || id === 'viper') {
    const heavy = id === 'viper';
    part(g, box(0.04, 0.055, heavy ? 0.3 : 0.22), heavy ? grey : steel, [0, 0.02, heavy ? -0.16 : -0.11]);
    part(g, box(0.038, 0.13, 0.055), heavy ? wood : dark, [0, -0.06, 0.0], [-0.22, 0, 0]);
    if (heavy) { part(g, tube(0.032, 0.07, 8), steel, [0, 0.015, -0.06], ALONG); part(g, box(0.012, 0.02, 0.02), glow, [0, 0.055, -0.3]); } else part(g, box(0.006, 0.008, 0.16), glow, [0.022, 0.03, -0.11]);
    data.mag = heavy ? null : part(g, box(0.03, 0.1, 0.04), dark, [0, -0.07, 0.0], [-0.22, 0, 0]);
    pistolSights(g, grey, dark, heavy ? -0.3 : -0.21);
    data.muzzle.set(0, 0.02, heavy ? -0.34 : -0.24);
    data.hip = [0.17, -0.17, -0.4];
    data.ads = [0, -0.06, -0.34];
  } else if (['vesper', 'harbinger', 'ronin', 'halcyon', 'anvil', 'hornet', 'maul'].includes(id)) {
    const m = { steel, dark, grey, wood, glow };
    const spec = {
      vesper: { len: 0.5, barrel: 0.52, optic: 'scope', stock: 0.3, wood: true, mag: ['box', 0.07], reach: -0.46, ads: [0, -0.1, -0.2], adsHide: true, bolt: true },
      harbinger: { len: 0.64, height: 0.11, width: 0.07, barrel: 0.66, bore: 0.022, brake: true, optic: 'bigscope', stock: 0.34, mag: ['box', 0.12], bipod: true, reach: -0.52, hip: [0.2, -0.22, -0.46], ads: [0, -0.11, -0.2], adsHide: true },
      ronin: { len: 0.46, guard: 0.22, barrel: 0.24, optic: 'iron', stock: 0.28, wood: true, mag: ['box', 0.2], reach: -0.46, ads: [0, -0.074, -0.4] },
      halcyon: { len: 0.4, guard: 0.2, barrel: 0.16, optic: 'holo', stock: 0.2, stockH: 0.07, mag: ['box', 0.15], reach: -0.4, ads: [0, -0.094, -0.26] },
      anvil: { len: 0.56, height: 0.11, width: 0.07, guard: 0.24, barrel: 0.3, bore: 0.018, optic: 'dot', stock: 0.28, mag: ['belt'], bipod: true, reach: -0.5, hip: [0.2, -0.22, -0.44], ads: [0, -0.094, -0.24] },
      hornet: { len: 0.34, height: 0.1, barrel: 0.1, optic: 'holo', stock: 0.16, stockH: 0.06, mag: ['box', 0.22], reach: -0.3, hip: [0.17, -0.19, -0.36], ads: [0, -0.094, -0.28] },
      maul: { len: 0.42, guard: 0.18, barrel: 0.36, bore: 0.02, optic: 'iron', stock: 0.28, mag: ['tube'], reach: -0.44, ads: [0, -0.074, -0.38] },
    }[id];
    const built = longGun(g, spec, m);
    data.mag = built.mag;
    data.muzzle.set(0, 0.01, built.muzzle);
    if (spec.hip) data.hip = spec.hip;
    data.ads = built.sightLine ? [0, -built.sightLine, OPTIC_ADS_Z] : spec.ads;
    data.adsHide = Boolean(spec.adsHide);
    data.reach = spec.reach;
    if (spec.bolt) {
      const bolt = new THREE.Group();
      part(bolt, tube(0.011, 0.08, 6), grey, [0.04, 0, 0], [0, 0, Math.PI / 2]);
      part(bolt, new THREE.SphereGeometry(0.018, 8, 6), grey, [0.08, 0, 0]);
      bolt.position.set(0.03, 0.03, -0.03);
      g.add(bolt);
      data.bolt = bolt;
    }
  } else if (id === 'pike' || id === 'wren') {
    part(g, box(0.04, 0.056, 0.22), steel, [0, 0.02, -0.11]);
    part(g, box(0.038, 0.13, 0.055), dark, [0, -0.06, 0.0], [-0.22, 0, 0]);
    part(g, box(0.006, 0.008, 0.16), glow, [0.022, 0.03, -0.11]);
    pistolSights(g, grey, dark, -0.21);
    if (id === 'pike') {
      data.mag = part(g, box(0.03, 0.2, 0.04), dark, [0, -0.12, 0.02], [-0.22, 0, 0]);
      part(g, box(0.036, 0.04, 0.08), dark, [0, -0.02, -0.19]);
      data.muzzle.set(0, 0.02, -0.26);
    } else {
      data.mag = part(g, box(0.03, 0.1, 0.04), dark, [0, -0.07, 0.0], [-0.22, 0, 0]);
      part(g, tube(0.022, 0.18, 10), dark, [0, 0.02, -0.31], ALONG);
      data.muzzle.set(0, 0.02, -0.42);
    }
    data.hip = [0.17, -0.17, -0.4];
    data.ads = [0, -0.06, -0.34];
  } else if (id === 'sawn') {
    part(g, tube(0.02, 0.3), grey, [0.021, 0.02, -0.2], ALONG);
    part(g, tube(0.02, 0.3), grey, [-0.021, 0.02, -0.2], ALONG);
    part(g, box(0.07, 0.05, 0.1), steel, [0, 0.0, -0.02]);
    part(g, box(0.05, 0.12, 0.06), wood, [0, -0.07, 0.04], [-0.35, 0, 0]);
    part(g, box(0.006, 0.01, 0.12), glow, [0.037, 0.0, -0.02]);
    part(g, new THREE.SphereGeometry(0.005, 8, 6), grey, [0, 0.045, -0.34]);
    data.muzzle.set(0, 0.02, -0.36);
    data.hip = [0.17, -0.17, -0.38];
    data.ads = [0, -0.05, -0.32];
  } else {
    buildKnife(g, { blade: skin || M('#aeb9c4', 0.22, 0.75), scales: skin || M('#1a1f25', 0.75, 0.1), fittings: grey, grip: M('#0e1114', 0.9, 0.05), glow });
    data.knife = true;
    data.hip = [0.15, -0.15, -0.47];
    data.ads = data.hip;
    data.muzzle.set(0, 0.01, -0.3);
  }
  // Forearms
  const sleeve = M('#ec6a9e', 0.7, 0.05);
  const glove = M('#171c22', 0.8, 0.05);
  const right = new THREE.Group();
  part(right, new THREE.CapsuleGeometry(0.045, 0.34, 4, 8), sleeve, [0, 0, 0.22], ALONG);
  part(right, box(0.07, 0.07, 0.09), glove, [0, 0, 0.0]);
  right.userData.arm = true;
  right.position.set(0.02, -0.09, 0.05);
  right.rotation.set(0.25, -0.25, 0);
  g.add(right);
  const left = new THREE.Group();
  left.userData.arm = true;
  part(left, new THREE.CapsuleGeometry(0.045, 0.36, 4, 8), sleeve, [0, 0, 0.24], ALONG);
  part(left, box(0.07, 0.07, 0.09), glove, [0, 0, 0.0]);
  const reach = ['knife', 'p9', 'viper', 'pike', 'wren', 'sawn'].includes(id) ? null : data.reach ?? (id === 'wasp' ? -0.3 : id === 'talon' ? -0.4 : -0.45);
  if (reach !== null) { left.position.set(-0.03, -0.06, reach); left.rotation.set(0.35, 0.75, 0); g.add(left); }
  data.sleeve = sleeve;
  data.sight = WEAPONS[id]?.sight || null;
  // Magnified optics hand over to their HUD overlay; everything else stays in view.
  data.adsHide = data.sight === 'scope' || data.sight === 'prism';
  g.userData = data;
  g.traverse((mesh) => { mesh.frustumCulled = false; });
  return g;
}

// Gun charms: a trinket on a short chain, pivoting at the top so it can swing.
function shapeGeometry(draw, depth = 0.004) {
  const shape = new THREE.Shape(); draw(shape);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.center();
  return geometry;
}
export function buildCharm(id) {
  if (!id || id === 'none') return null;
  const group = new THREE.Group();
  const chain = M('#9aa4ad', 0.3, 0.8);
  part(group, tube(0.0012, 0.03, 5), chain, [0, -0.015, 0]);
  const at = [0, -0.042, 0];
  const gold = M('#e2b646', 0.25, 0.7, '#5a3c06');
  if (id === 'tag') part(group, box(0.017, 0.026, 0.002), M('#b8c2cb', 0.3, 0.8), at);
  else if (id === 'dice') part(group, box(0.014, 0.014, 0.014), M('#f2f2ee', 0.4, 0.05), at, [0.4, 0.6, 0.2]);
  else if (id === 'bullet') { part(group, tube(0.004, 0.018, 8), gold, at); part(group, new THREE.ConeGeometry(0.004, 0.009, 8), M('#b56a3a', 0.35, 0.7), [0, -0.0285, 0], [Math.PI, 0, 0]); }
  else if (id === 'skull') { part(group, new THREE.SphereGeometry(0.008, 10, 8), M('#ece6d6', 0.6, 0.05), at); part(group, box(0.008, 0.004, 0.006), M('#ece6d6', 0.6, 0.05), [0, -0.05, 0.002]); }
  else if (id === 'star') part(group, shapeGeometry((sh) => { for (let k = 0; k < 10; k += 1) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 0.0045 : 0.01; sh[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } }), gold, at);
  else if (id === 'coin') part(group, tube(0.009, 0.0025, 20), gold, at, [Math.PI / 2, 0, 0]);
  else if (id === 'heart') part(group, shapeGeometry((sh) => { sh.moveTo(0, -0.008); sh.bezierCurveTo(-0.012, 0.0, -0.008, 0.009, 0, 0.004); sh.bezierCurveTo(0.008, 0.009, 0.012, 0.0, 0, -0.008); }), M('#ff3a5c', 0.3, 0.2, '#6a0a1a'), at);
  else if (id === 'diamond') part(group, new THREE.OctahedronGeometry(0.009), M('#8fe8ff', 0.1, 0.3, '#3fb8ff'), at);
  group.userData.charm = id;
  return group;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#cfe0f5', '#30343a', 1.4));
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
    this.current = null;
    this.currentId = null;
    this.accent = '#6ce6d1'; this.suit = '#ec6a9e'; this.skins = {}; this.charm = 'none';
    this.charmSwing = { x: 0, z: 0, vx: 0, vz: 0 };
    this.kick = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.bob = 0; this.equip = 1; this.flashTime = 0;
    this.reloadTime = 0; this.reloadDuration = 0; this.cycleTime = -1; this.cycleDuration = 0; this.slash = -1; this.landDip = 0;
    this.slashKind = 0; this.slashCount = 0; this.lastSlashAt = 0;
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
      const charm = WEAPONS[id]?.melee ? null : buildCharm(this.charm);
      // Hung under the left side, a third of the way to the muzzle: the part of the gun the camera sees at the hip.
      if (charm) { const reach = Math.min(...model.children.filter((c) => !c.userData.arm && c.isMesh).map((c) => c.position.z)); charm.position.set(-0.042, -0.028, Math.max(reach * 0.45, -0.32)); charm.scale.setScalar(2); charm.traverse((mesh) => { mesh.frustumCulled = false; }); model.add(charm); model.userData.charm = charm; } model.visible = false; this.holder.add(model); this.models.set(id, model); }
    if (this.current) this.current.visible = false;
    this.current = this.models.get(id);
    this.current.visible = true;
    this.currentId = id;
    this.equip = instant ? 1 : 0;
    this.reloadTime = 0; this.cycleTime = -1; this.slash = -1;
  }

  fire(weapon) {
    this.kick = Math.min(1.6, this.kick + weapon.recoil.kick * 0.22);
    this.kickRot = Math.min(1.4, this.kickRot + weapon.recoil.kick * 0.2);
    this.flashTime = 0.055;
    this.flash.material.rotation = Math.random() * Math.PI;
    if (weapon.action === 'bolt') { this.cycleTime = 0; this.cycleDuration = weapon.cooldown - 0.2; }
    if (weapon.action === 'pump') { this.cycleTime = 0; this.cycleDuration = 0.6; }
  }
  reload(duration) { this.reloadTime = duration; this.reloadDuration = duration; }
  cancelReload() { this.reloadTime = 0; }
  // Attacks chain: forehand slash, backhand slash, then a stab. Pause for a second and the chain starts again.
  melee() {
    const now = performance.now();
    if (now - this.lastSlashAt > 1100) this.slashCount = 0;
    this.lastSlashAt = now;
    this.slashKind = this.slashCount % 3;
    this.slashCount += 1;
    this.slash = 0;
  }
  land(force) { this.landDip = Math.min(1, force); }

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
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.equip = Math.min(1, this.equip + dt * 4.5);
    this.kick += (0 - this.kick) * Math.min(1, dt * 11);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 9);
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 8);
    this.swayX += (-state.lookX * 0.0009 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (state.lookY * 0.0009 - this.swayY) * Math.min(1, dt * 9);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.05, 0.05); this.swayY = THREE.MathUtils.clamp(this.swayY, -0.05, 0.05);
    const moving = state.onGround ? Math.min(1, state.speed / 6) : 0;
    this.bob += dt * (4 + state.speed * 1.35);
    const ads = state.scoped;
    const bobScale = moving * (1 - ads * 0.85);
    const bx = Math.cos(this.bob) * 0.011 * bobScale, by = Math.abs(Math.sin(this.bob)) * -0.014 * bobScale;
    const idle = Math.sin(performance.now() / 900) * 0.0025 * (1 - ads);
    const ease = 1 - (1 - this.equip) ** 3;
    // Dots and holos: the housing comes up to the eye and frames the HUD reticle, so it moves less once aimed.
    const open = data.sight === 'dot' || data.sight === 'holo';
    const steady = open ? 1 - ads * 0.7 : 1;
    const x = THREE.MathUtils.lerp(data.hip[0], data.ads[0], ads) + bx + this.swayX * steady;
    const y = THREE.MathUtils.lerp(data.hip[1], data.ads[1], ads) + by + this.swayY * steady + idle - (1 - ease) * 0.35 - this.landDip * 0.05 - (state.crouch ? 0.01 : 0) * (1 - ads);
    const z = THREE.MathUtils.lerp(data.hip[2], data.ads[2], ads) + this.kick * 0.085 * steady;
    // The charm hangs on a damped spring driven by sway, bob and recoil.
    if (data.charm) {
      const swing = this.charmSwing, k = Math.min(dt, 0.05);
      const driveZ = -this.swayX * 26 + bx * 40, driveX = this.swayY * 22 - this.kick * 0.9 + by * 30;
      swing.vz += ((driveZ - swing.z) * 90 - swing.vz * 5) * k; swing.z += swing.vz * k;
      swing.vx += ((driveX - swing.x) * 90 - swing.vx * 5) * k; swing.x += swing.vx * k;
      data.charm.rotation.z = THREE.MathUtils.clamp(swing.z, -1.2, 1.2);
      data.charm.rotation.x = THREE.MathUtils.clamp(swing.x, -1.2, 1.2);
    }
    model.position.set(x, y, z);
    model.rotation.set((this.kickRot * 0.13 + this.swayY * 1.5) * steady + (1 - ease) * 0.9, -0.035 * (1 - ads) + this.swayX * 2 * steady, -this.swayX * 1.4 * steady);

    // Reload: tip the weapon, drop the magazine, slap a new one in.
    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - dt);
      const k = 1 - this.reloadTime / this.reloadDuration;
      const tilt = Math.sin(Math.min(1, k * 1.15) * Math.PI);
      model.rotation.z += tilt * 0.55;
      model.rotation.x += tilt * 0.35;
      model.position.y -= tilt * 0.06;
      if (data.mag) { const out = k > 0.2 && k < 0.62; data.mag.visible = !out; }
    } else if (data.mag) data.mag.visible = true;

    // Bolt / pump cycling after a shot.
    if (this.cycleTime >= 0) {
      this.cycleTime += dt;
      const k = this.cycleTime / this.cycleDuration;
      const pull = k < 0.2 ? 0 : Math.sin(Math.min(1, (k - 0.2) / 0.8) * Math.PI);
      if (data.bolt) { data.bolt.rotation.z = Math.min(1, pull * 2.5) * 0.9; data.bolt.position.z = -0.03 + pull * 0.09; model.rotation.z += pull * 0.12; model.position.y -= pull * 0.012; }
      if (data.pump) data.pump.position.z = -0.42 + pull * 0.1;
      if (k >= 1) { this.cycleTime = -1; if (data.bolt) { data.bolt.rotation.z = 0; data.bolt.position.z = -0.03; } }
    }
    if (data.knife) {
      // Held point-forward and canted in, edge toward the target; it never sits dead still.
      const t = performance.now() / 1000;
      model.rotation.x += 0.42 + Math.sin(t * 1.3) * 0.012;
      model.rotation.y += 0.38 + Math.sin(t * 0.9 + 1) * 0.015;
      model.rotation.z += -0.32;
      // Draw: the blade comes up from below and turns over once in the hand as it arrives.
      if (this.equip < 1) { const spin = (1 - ease); model.rotation.x -= spin * Math.PI * 2; model.position.y -= spin * 0.06; model.position.x += spin * 0.05; }
    }
    if (this.slash >= 0) {
      this.slash += dt / (data.knife ? 0.36 : 0.32);
      const k = Math.min(1, this.slash);
      if (data.knife) {
        // wind: pulls back before the cut; cut: a fast, late-peaking sweep; settle: eases home.
        const wind = Math.sin(Math.min(1, k / 0.22) * Math.PI) * (k < 0.22 ? 1 : 0);
        const cutT = THREE.MathUtils.clamp((k - 0.16) / 0.34, 0, 1);
        const cut = cutT * cutT * (3 - 2 * cutT);
        const settle = 1 - THREE.MathUtils.clamp((k - 0.5) / 0.5, 0, 1) ** 2;
        const swing = (cut - wind * 0.35) * settle;
        if (this.slashKind === 2) {
          // Stab: draw back to the hip, drive straight out along the view, snap back.
          model.position.z += wind * 0.1 - cut * settle * 0.34;
          model.position.x -= cut * settle * 0.13; model.position.y += cut * settle * 0.07;
          model.rotation.y -= cut * settle * 0.5; model.rotation.x -= cut * settle * 0.18; model.rotation.z += cut * settle * 0.45;
        } else {
          // Slashes cross the screen: forehand from the right, backhand back the other way, a little lower.
          const dir = this.slashKind === 0 ? 1 : -1;
          model.position.x -= dir * swing * 0.3 - (dir < 0 ? settle * cut * 0.06 : 0);
          model.position.z -= Math.sin(cut * Math.PI) * 0.2 * settle + wind * -0.05;
          model.position.y += (dir > 0 ? 0.07 : -0.03) * Math.sin(cut * Math.PI) * settle;
          model.rotation.y += dir * swing * 0.7;
          model.rotation.z += dir * swing * 0.95;
          model.rotation.x -= Math.sin(cut * Math.PI) * 0.35 * settle;
        }
      } else {
        const arc = Math.sin(k * Math.PI);
        model.position.x -= arc * 0.28; model.position.z -= arc * 0.22; model.position.y += arc * 0.05;
        model.rotation.y += arc * 1.1; model.rotation.z += arc * 0.6;
      }
      if (k >= 1) this.slash = -1;
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
