// Gun charms: a trinket on a split ring and three chain links, hung off the left side of the gun.
// The chain and the trinket are two pendulums in the gun's own space, driven by what the gun actually
// does: recoil, the bolt or pump being worked, a reload tipping it over, aiming, sprinting, landing, a fast
// flick of the mouse. Gravity follows the view, so look straight down and the charm hangs toward the muzzle.
// It cannot swing through the gun: it taps the receiver and bounces, with a clink when it hits hard.
import * as THREE from 'three';

const M = (color, rough = 0.4, metal = 0.5, emissive = null, glow = 1.2) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive || '#000000', emissiveIntensity: emissive ? glow : 0 });
const steel = () => M('#aab4bd', 0.3, 0.8);
const gold = () => M('#e2b646', 0.25, 0.75, '#5a3c06', 0.6);
function add(group, geometry, material, position = [0, 0, 0], rotation = null, scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  group.add(mesh);
  return mesh;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h);
const rod = (r, l, seg = 10) => new THREE.CylinderGeometry(r, r, l, seg);
const cone = (r, l, seg = 10) => new THREE.ConeGeometry(r, l, seg);
const ring = (r, t, seg = 16) => new THREE.TorusGeometry(r, t, 6, seg);
function flat(draw, depth = 0.003, bevel = 0.0006) {
  const shape = new THREE.Shape(); draw(shape);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
  geometry.center();
  return geometry;
}
const star = (points, outer, inner) => (sh) => { for (let k = 0; k < points * 2; k += 1) { const a = (k / (points * 2)) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? inner : outer; sh[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } sh.closePath(); };

// Each maker hangs its trinket below y = 0 (the bottom chain link) inside `t`. Roughly 2 to 3 cm tall.
// It may return { spin, rate, axis } to turn a part, { flicker: material } for a fire's glow, and
// { update(seconds) } for anything else that moves; they combine.
const MAKERS = {
  tag: (t) => { const plate = add(t, flat((sh) => { sh.moveTo(-0.008, -0.026); sh.lineTo(0.008, -0.026); sh.quadraticCurveTo(0.0095, -0.026, 0.0095, -0.0245); sh.lineTo(0.0095, -0.004); sh.quadraticCurveTo(0.0095, 0, 0.006, 0); sh.lineTo(-0.006, 0); sh.quadraticCurveTo(-0.0095, 0, -0.0095, -0.004); sh.lineTo(-0.0095, -0.0245); sh.quadraticCurveTo(-0.0095, -0.026, -0.008, -0.026); }, 0.0012), steel(), [0, -0.016, 0]); for (const y of [-0.012, -0.017, -0.022]) add(t, box(0.011, 0.0012, 0.0016), M('#6c757d', 0.5, 0.6), [0, y, 0]); return plate; },
  dice: (t) => { const white = M('#f4f2ea', 0.35, 0.05), pip = M('#15171a', 0.5, 0.1); const cube = new THREE.Group(); add(cube, box(0.015, 0.015, 0.015), white); const spots = [[0, 0, 1], [-1, -1, 1], [1, 1, 1]]; for (const [x, y] of spots) add(cube, ball(0.0014, 8, 6), pip, [x * 0.0042, y * 0.0042, 0.0076]); for (const [x, y] of [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, 0]]) add(cube, ball(0.0014, 8, 6), pip, [0.0076, y * 0.0042, x * 0.0042]); for (const x of [-1, 1]) add(cube, ball(0.0014, 8, 6), pip, [x * 0.0036, 0.0076, x * 0.0036]); cube.position.y = -0.016; cube.rotation.set(0.6, 0.7, 0.3); t.add(cube); },
  bullet: (t) => { add(t, rod(0.0045, 0.02, 12), gold(), [0, -0.014, 0]); add(t, rod(0.005, 0.002, 12), gold(), [0, -0.004, 0]); const tip = add(t, cone(0.0045, 0.011, 12), M('#b56a3a', 0.3, 0.75), [0, -0.0295, 0], [Math.PI, 0, 0]); return tip; },
  skull: (t) => { const bone = M('#ece6d6', 0.6, 0.05), dark = M('#14100c', 0.9, 0); add(t, ball(0.0095, 14, 12), bone, [0, -0.013, 0], null, [1, 1.05, 1.05]); add(t, box(0.011, 0.007, 0.011), bone, [0, -0.0235, 0.0015]); for (const x of [-1, 1]) add(t, ball(0.0029, 8, 8), dark, [x * 0.0037, -0.0145, 0.0078]); add(t, cone(0.0013, 0.003, 4), dark, [0, -0.0192, 0.0092], [0.2, 0, 0]); for (const x of [-0.003, 0, 0.003]) add(t, box(0.0004, 0.0045, 0.0005), dark, [x, -0.0245, 0.0071]); },
  star: (t) => { add(t, flat(star(5, 0.0125, 0.0055), 0.0035), gold(), [0, -0.0135, 0]); },
  coin: (t) => { const g = gold(); add(t, rod(0.011, 0.0026, 24), g, [0, -0.0125, 0], [Math.PI / 2, 0, 0]); add(t, ring(0.0098, 0.0009, 24), M('#b38a22', 0.3, 0.7), [0, -0.0125, 0.0014]); const dark = M('#7d5e12', 0.4, 0.6); add(t, ring(0.0052, 0.0007, 16), dark, [0, -0.0125, 0.0016]); for (const a of [0, 1, 2, 3]) add(t, box(0.0008, 0.0045, 0.0006), dark, [Math.cos(a * Math.PI / 2) * 0.0062, -0.0125 + Math.sin(a * Math.PI / 2) * 0.0062, 0.0016], [0, 0, a * Math.PI / 2 + Math.PI / 2]); },
  heart: (t) => { add(t, flat((sh) => { sh.moveTo(0, -0.011); sh.bezierCurveTo(-0.016, 0.0, -0.011, 0.012, 0, 0.0055); sh.bezierCurveTo(0.011, 0.012, 0.016, 0.0, 0, -0.011); }, 0.005, 0.0015), M('#ff3a5c', 0.25, 0.25, '#6a0a1a', 0.8), [0, -0.0135, 0]); },
  diamond: (t) => { const gem = M('#9beaff', 0.05, 0.2, '#3fb8ff', 0.9); const stone = new THREE.Group(); add(stone, cone(0.0095, 0.012, 8), gem, [0, -0.006, 0], [Math.PI, 0, 0]); add(stone, new THREE.CylinderGeometry(0.0055, 0.0095, 0.0045, 8), gem, [0, 0.00225, 0]); stone.position.y = -0.0125; t.add(stone); return { spin: stone, rate: 1.4 }; },
  grenade: (t) => { const green = M('#4c5a2c', 0.75, 0.1); add(t, ball(0.0095, 12, 10), green, [0, -0.0175, 0], null, [1, 1.2, 1]); for (const y of [-0.0125, -0.0175, -0.0225]) add(t, ring(0.0094, 0.0007, 14), M('#38431f', 0.8, 0.1), [0, y, 0], [Math.PI / 2, 0, 0]); add(t, rod(0.0035, 0.005, 10), steel(), [0, -0.0045, 0]); add(t, box(0.002, 0.014, 0.0045), steel(), [0.0062, -0.0115, 0], [0, 0, 0.22]); add(t, ring(0.0034, 0.0006, 12), steel(), [-0.006, -0.0045, 0], [0, Math.PI / 2, 0]); },
  bolt: (t) => { add(t, flat((sh) => { sh.moveTo(0.003, 0.014); sh.lineTo(-0.007, -0.002); sh.lineTo(-0.001, -0.002); sh.lineTo(-0.004, -0.015); sh.lineTo(0.007, 0.002); sh.lineTo(0.001, 0.002); sh.closePath(); }, 0.003), M('#ffe14d', 0.3, 0.2, '#ffd21f', 1.6), [0, -0.0155, 0]); },
  crown: (t) => { const g = gold(); add(t, new THREE.CylinderGeometry(0.0085, 0.0075, 0.007, 14, 1, true), g, [0, -0.02, 0]).material.side = THREE.DoubleSide; for (let k = 0; k < 5; k += 1) { const a = (k / 5) * Math.PI * 2; add(t, cone(0.0028, 0.008, 4), g, [Math.cos(a) * 0.008, -0.0125, Math.sin(a) * 0.008]); add(t, ball(0.0014, 8, 6), M('#ff3a5c', 0.2, 0.2, '#7a0a1a', 1), [Math.cos(a) * 0.008, -0.0082, Math.sin(a) * 0.008]); } add(t, ring(0.0078, 0.0009, 16), M('#b38a22', 0.3, 0.7), [0, -0.0232, 0], [Math.PI / 2, 0, 0]); },
  anchor: (t) => { const iron = M('#5d6973', 0.45, 0.7); add(t, ring(0.0032, 0.0009, 12), iron, [0, -0.0035, 0]); add(t, box(0.0022, 0.021, 0.0022), iron, [0, -0.017, 0]); add(t, box(0.012, 0.0022, 0.0022), iron, [0, -0.0095, 0]); const arc = add(t, new THREE.TorusGeometry(0.0085, 0.0013, 6, 14, Math.PI), iron, [0, -0.0225, 0], [0, 0, Math.PI]); for (const x of [-1, 1]) add(t, cone(0.0024, 0.005, 4), iron, [x * 0.0085, -0.0215, 0], [0, 0, x * -0.5]); return arc; },
  duck: (t) => { const yellow = M('#ffd23f', 0.45, 0.05); add(t, ball(0.0095, 14, 10), yellow, [0, -0.021, 0], null, [1, 0.8, 1.25]); add(t, ball(0.0062, 12, 10), yellow, [0, -0.0115, 0.0055]); add(t, cone(0.0028, 0.0055, 8), M('#ff8a1f', 0.5, 0.05), [0, -0.0122, 0.0125], [Math.PI / 2, 0, 0], [1.5, 1, 0.7]); for (const x of [-1, 1]) add(t, ball(0.0011, 6, 6), M('#15171a', 0.4, 0), [x * 0.003, -0.0098, 0.0104]); add(t, cone(0.004, 0.006, 6), yellow, [0, -0.0185, -0.0115], [-1.0, 0, 0]); },
  eightball: (t) => { add(t, ball(0.0105, 18, 14), M('#0e0f12', 0.12, 0.2), [0, -0.0145, 0]); add(t, rod(0.0045, 0.0005, 18), M('#f4f2ea', 0.3, 0), [0, -0.0145, 0.0104], [Math.PI / 2, 0, 0]); for (const y of [0.0013, -0.0013]) add(t, ring(0.0013, 0.00045, 10), M('#0e0f12', 0.3, 0), [0, -0.0145 + y, 0.0108]); },
  horseshoe: (t) => { const iron = M('#8e98a1', 0.4, 0.8); add(t, new THREE.TorusGeometry(0.0088, 0.0021, 6, 18, Math.PI * 1.45), iron, [0, -0.0145, 0], [0, 0, Math.PI * 0.775 + Math.PI]); for (let k = 0; k < 5; k += 1) { const a = Math.PI * 0.775 + Math.PI + (k + 0.5) * (Math.PI * 1.45 / 5); add(t, rod(0.0007, 0.0046, 6), M('#2b3138', 0.5, 0.5), [Math.cos(a) * 0.0088, -0.0145 + Math.sin(a) * 0.0088, 0], [Math.PI / 2, 0, 0]); } },
  key: (t) => { const brass = M('#c9a14a', 0.3, 0.75); add(t, ring(0.0052, 0.0014, 14), brass, [0, -0.0075, 0]); add(t, rod(0.0012, 0.019, 8), brass, [0, -0.022, 0]); add(t, box(0.0055, 0.0022, 0.0014), brass, [0.0032, -0.0285, 0]); add(t, box(0.004, 0.0022, 0.0014), brass, [0.0026, -0.0245, 0]); },
  padlock: (t) => { add(t, new THREE.TorusGeometry(0.0055, 0.0015, 6, 14, Math.PI), steel(), [0, -0.0095, 0]); for (const x of [-1, 1]) add(t, rod(0.0015, 0.004, 8), steel(), [x * 0.0055, -0.0115, 0]); add(t, box(0.0165, 0.013, 0.0065), M('#d8a630', 0.35, 0.7), [0, -0.02, 0]); add(t, rod(0.0017, 0.0007, 10), M('#1a1d21', 0.5, 0.3), [0, -0.0185, 0.0034], [Math.PI / 2, 0, 0]); add(t, box(0.0012, 0.0042, 0.0007), M('#1a1d21', 0.5, 0.3), [0, -0.0215, 0.0034]); },
  reticle: (t) => { const amber = M('#ffb547', 0.3, 0.4, '#ff9a1a', 1.1), frost = M('#e6edf1', 0.3, 0.6); add(t, ring(0.0105, 0.001, 24), M('#6ce6d1', 0.3, 0.4, '#2fd6b8', 1), [0, -0.0145, 0]); for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2; add(t, box(0.0011, 0.0045, 0.0011), frost, [Math.cos(a) * 0.0105, -0.0145 + Math.sin(a) * 0.0105, 0], [0, 0, a + Math.PI / 2]); } add(t, box(0.002, 0.0115, 0.0016), amber, [-0.0028, -0.0145, 0]); add(t, box(0.002, 0.0078, 0.0016), amber, [0.0012, -0.0117, 0], [0, 0, -0.78]); add(t, box(0.002, 0.0078, 0.0016), amber, [0.0012, -0.0173, 0], [0, 0, 0.78]); },
  feather: (t) => { add(t, flat((sh) => { sh.moveTo(0, 0.014); sh.bezierCurveTo(0.009, 0.006, 0.007, -0.01, 0.0005, -0.016); sh.bezierCurveTo(-0.007, -0.01, -0.009, 0.006, 0, 0.014); }, 0.0009, 0), M('#f1f4f7', 0.7, 0), [0, -0.0175, 0], [0, 0, 0.18]); add(t, rod(0.0005, 0.033, 5), M('#c7ced4', 0.5, 0.1), [0.0012, -0.0185, 0.0006], [0, 0, 0.18]); add(t, ball(0.002, 8, 6), M('#3fb8ff', 0.3, 0.2, '#1f7fd1', 0.8), [-0.0005, -0.004, 0]); },
  flame: (t) => { const fire = add(t, flat((sh) => { sh.moveTo(0, -0.015); sh.bezierCurveTo(-0.012, -0.013, -0.011, 0.001, -0.004, 0.006); sh.bezierCurveTo(-0.004, 0.001, 0.0, 0.002, 0.001, 0.015); sh.bezierCurveTo(0.009, 0.006, 0.013, -0.011, 0, -0.015); }, 0.004, 0.001), M('#ff6a1f', 0.4, 0.1, '#ff4a0a', 1.8), [0, -0.0175, 0]); add(t, flat((sh) => { sh.moveTo(0, -0.008); sh.bezierCurveTo(-0.006, -0.007, -0.005, 0.0, 0, 0.006); sh.bezierCurveTo(0.005, 0.0, 0.006, -0.007, 0, -0.008); }, 0.0046, 0), M('#ffe27a', 0.4, 0, '#ffd84a', 2.2), [0, -0.0215, 0]); return { flicker: fire.material }; },
  moon: (t) => { add(t, flat((sh) => { sh.absarc(0, 0, 0.0115, 0.963, Math.PI * 2 - 0.963, false); sh.absarc(0.0055, 0, 0.0095, -1.458, -Math.PI * 2 + 1.458, true); }, 0.0035, 0.0008), M('#f3e9b8', 0.4, 0.2, '#e8d677', 1.1), [0, -0.0145, 0]); add(t, flat(star(4, 0.0032, 0.0012), 0.0016, 0), M('#ffffff', 0.3, 0.2, '#ffffff', 1.6), [0.0062, -0.0105, 0]); },
  planet: (t) => { const world = new THREE.Group(); add(world, ball(0.0082, 16, 12), M('#d98a4a', 0.6, 0.05)); add(world, ball(0.00825, 16, 12), M('#b56a2e', 0.7, 0.05), [0, 0.001, 0], null, [1, 0.35, 1]); const band = add(world, ring(0.0135, 0.0009, 28), M('#e9d9b0', 0.5, 0.2), [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.25]); world.rotation.z = 0.42; world.position.y = -0.0155; t.add(world); return { spin: world, rate: 0.7, keep: band }; },
  ghost: (t) => { const sheet = M('#f4f7fb', 0.5, 0, '#9fd8ff', 0.5); add(t, ball(0.0085, 14, 10), sheet, [0, -0.012, 0]); add(t, rod(0.0085, 0.0095, 14), sheet, [0, -0.0168, 0]); for (let k = 0; k < 5; k += 1) { const a = (k / 5) * Math.PI * 2; add(t, cone(0.0034, 0.0055, 6), sheet, [Math.cos(a) * 0.0054, -0.0238, Math.sin(a) * 0.0054], [Math.PI, 0, 0]); } for (const x of [-1, 1]) add(t, ball(0.0017, 8, 6), M('#15171a', 0.4, 0), [x * 0.0032, -0.0115, 0.0076], null, [1, 1.4, 1]); add(t, ball(0.0014, 8, 6), M('#15171a', 0.4, 0), [0, -0.0155, 0.0082], null, [1, 1.3, 1]); },
  shuriken: (t) => { const blade = new THREE.Group(); add(blade, flat(star(4, 0.0135, 0.0042), 0.0016, 0.0005), M('#b9c4ce', 0.2, 0.85)); add(blade, ring(0.0022, 0.0008, 12), M('#2b3138', 0.4, 0.6)); blade.position.y = -0.0165; t.add(blade); return { spin: blade, rate: 0.9, axis: 'z' }; },
  mushroom: (t) => { add(t, new THREE.SphereGeometry(0.0105, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#e4322b', 0.45, 0.05), [0, -0.0155, 0]); add(t, rod(0.0098, 0.0012, 16), M('#f4ead7', 0.7, 0), [0, -0.0158, 0]); add(t, new THREE.CylinderGeometry(0.0036, 0.0046, 0.011, 10), M('#f4ead7', 0.7, 0), [0, -0.0215, 0]); for (const [x, y, z] of [[0.004, 0.0072, 0.0058], [-0.0052, 0.0062, 0.003], [0, 0.0098, -0.002], [0.0028, 0.005, -0.0078], [-0.003, 0.004, -0.0074]]) add(t, ball(0.0019, 8, 6), M('#ffffff', 0.5, 0), [x, -0.0155 + y, z], null, [1, 0.5, 1]); },
  cherry: (t) => { const red = M('#d81a3a', 0.2, 0.15, '#4a0612', 0.6), stem = M('#4f7a2a', 0.7, 0); for (const x of [-1, 1]) { add(t, ball(0.0062, 14, 10), red, [x * 0.0058, -0.0225 + (x > 0 ? 0.002 : 0), 0]); add(t, rod(0.00055, 0.0165, 5), stem, [x * 0.003, -0.0105, 0], [0, 0, x * 0.36]); } add(t, flat((sh) => { sh.moveTo(0, 0); sh.bezierCurveTo(0.004, 0.004, 0.009, 0.002, 0.011, -0.002); sh.bezierCurveTo(0.006, -0.003, 0.003, -0.002, 0, 0); }, 0.0008, 0), stem, [0.0052, -0.0035, 0]); },
  d20: (t) => { const die = new THREE.Group(); add(die, new THREE.IcosahedronGeometry(0.0108, 0), M('#7b3ff2', 0.25, 0.3, '#2a0f6a', 0.7)); add(die, new THREE.IcosahedronGeometry(0.01095, 0), new THREE.MeshBasicMaterial({ color: '#e7dcff', wireframe: true })); die.position.y = -0.0155; die.rotation.set(0.4, 0.3, 0.2); t.add(die); return { spin: die, rate: 0.5 }; },
  ufo: (t) => { const craft = new THREE.Group(); add(craft, ball(0.0125, 20, 10), M('#aab4bd', 0.25, 0.8), [0, 0, 0], null, [1, 0.26, 1]); add(craft, new THREE.SphereGeometry(0.0062, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#8dffd0', 0.1, 0.1, '#3fffb0', 1.1), [0, 0.0018, 0]); for (let k = 0; k < 6; k += 1) { const a = (k / 6) * Math.PI * 2; add(craft, ball(0.0012, 6, 6), M('#ffe14d', 0.3, 0, '#ffd21f', 2), [Math.cos(a) * 0.0098, -0.0012, Math.sin(a) * 0.0098]); } craft.position.y = -0.013; t.add(craft); return { spin: craft, rate: 1.1 }; },
  clover: (t) => { const green = M('#2fa84f', 0.45, 0.05, '#0c4a1c', 0.5); for (let k = 0; k < 4; k += 1) { const a = (k * Math.PI) / 2 + Math.PI / 4; add(t, flat((sh) => { sh.moveTo(0, -0.0045); sh.bezierCurveTo(-0.0065, 0.0, -0.0045, 0.0055, 0, 0.0025); sh.bezierCurveTo(0.0045, 0.0055, 0.0065, 0.0, 0, -0.0045); }, 0.002, 0.0005), green, [Math.cos(a) * 0.0052, -0.0135 + Math.sin(a) * 0.0052, 0], [0, 0, a - Math.PI / 2]); } add(t, rod(0.0007, 0.009, 5), M('#1f7a38', 0.6, 0), [0.0012, -0.0235, 0], [0, 0, 0.25]); },
  donut: (t) => { const sprinkle = ['#ffffff', '#ffd23f', '#3fb8ff', '#6ce6d1', '#9a5cff', '#ff5a36'].map((c) => M(c, 0.4, 0.05)); add(t, new THREE.TorusGeometry(0.0072, 0.0038, 10, 24), M('#d99a55', 0.75, 0.05), [0, -0.0125, 0]); add(t, new THREE.TorusGeometry(0.0072, 0.004, 10, 24), M('#ff86bd', 0.3, 0.05), [0, -0.0125, 0.0017], null, [1, 1, 0.6]); for (let k = 0; k < 18; k += 1) { const a = k * 2.4, d = ((k % 3) - 1) * 0.0017; add(t, rod(0.00035, 0.0018, 5), sprinkle[(k * 5) % 6], [Math.cos(a) * (0.0072 + d), -0.0125 + Math.sin(a) * (0.0072 + d), d ? 0.0038 : 0.0041], [0, 0, k * 1.7]); } },
  pizza: (t) => { const slice = (sh) => { sh.moveTo(0, -0.0115); sh.lineTo(0.0088, 0.0095); sh.quadraticCurveTo(0, 0.0112, -0.0088, 0.0095); sh.closePath(); }; add(t, flat(slice, 0.0012, 0.0004), M('#e0a860', 0.8, 0), [0, -0.0145, -0.0012]); add(t, flat(slice, 0.0016, 0.0005), M('#ffcc3f', 0.5, 0.05, '#5a3a00', 0.25), [0, -0.0145, 0.0004], null, [0.94, 0.97, 1]); add(t, rod(0.0021, 0.0205, 12), M('#c9853a', 0.75, 0), [0, -0.0045, -0.0003], [0, 0, Math.PI / 2]); const pep = M('#b8321f', 0.55, 0.05); for (const [x, y, s] of [[-0.0033, -0.0105, 1], [0.0034, -0.0098, 1], [0.0002, -0.0172, 0.85]]) add(t, rod(0.0021 * s, 0.0008, 14), pep, [x, y, 0.0019], [Math.PI / 2, 0, 0]); },
  pumpkin: (t) => { const skin = M('#f07a1a', 0.55, 0.05), carve = M('#ffd24a', 0.5, 0, '#ff9a1a', 1.6); add(t, ball(0.0078, 14, 10), M('#d9620f', 0.6, 0.05), [0, -0.0145, 0], null, [1, 0.9, 1]); for (let k = 0; k < 8; k += 1) { const a = (k / 8) * Math.PI * 2; add(t, ball(0.0066, 12, 10), skin, [Math.cos(a) * 0.005, -0.0145, Math.sin(a) * 0.005], null, [0.7, 1.15, 0.7]); } add(t, new THREE.CylinderGeometry(0.0011, 0.0016, 0.0048, 6), M('#5b6b2a', 0.8, 0), [0.0004, -0.0052, 0], [0, 0, -0.2]); const eye = flat((sh) => { sh.moveTo(-0.0017, -0.0011); sh.lineTo(0.0017, -0.0011); sh.lineTo(0, 0.0015); sh.closePath(); }, 0.0016, 0); for (const x of [-1, 1]) add(t, eye, carve, [x * 0.0033, -0.0115, 0.0078], [0, x * 0.45, 0]); add(t, flat((sh) => { sh.moveTo(-0.0009, 0.0006); sh.lineTo(0.0009, 0.0006); sh.lineTo(0, -0.0007); sh.closePath(); }, 0.0012, 0), carve, [0, -0.0141, 0.0093]); add(t, flat((sh) => { sh.moveTo(-0.0045, 0.001); sh.quadraticCurveTo(0, -0.004, 0.0045, 0.001); sh.lineTo(0.002, 0); sh.lineTo(0.0015, -0.0006); sh.lineTo(0.001, 0); sh.lineTo(-0.001, 0); sh.lineTo(-0.0015, -0.0006); sh.lineTo(-0.002, 0); sh.closePath(); }, 0.002, 0), carve, [0, -0.018, 0.0081]); return { flicker: carve }; },
  snowflake: (t) => { const ice = M('#d8f3ff', 0.12, 0.35, '#7fd4ff', 0.55), flake = new THREE.Group(); add(flake, rod(0.0024, 0.0014, 6), ice, [0, 0, 0], [Math.PI / 2, 0, 0]); for (let k = 0; k < 6; k += 1) { const a = (k / 6) * Math.PI * 2 + Math.PI / 2, c = Math.cos(a), s = Math.sin(a); add(flake, box(0.0013, 0.0108, 0.001), ice, [c * 0.0054, s * 0.0054, 0], [0, 0, a - Math.PI / 2]); for (const [at, len] of [[0.0038, 0.0036], [0.0068, 0.0026]]) for (const side of [-1, 1]) { const b = a + side * 0.95; add(flake, box(0.0009, len, 0.0008), ice, [c * at + Math.cos(b) * len / 2, s * at + Math.sin(b) * len / 2, 0], [0, 0, b - Math.PI / 2]); } add(flake, ball(0.0009, 6, 4), ice, [c * 0.0112, s * 0.0112, 0]); } flake.position.y = -0.0135; t.add(flake); return { spin: flake, rate: 0.4, axis: 'z' }; },
  cube: (t) => { const cube = new THREE.Group(), faces = ['#f4f4f4', '#ffd500', '#c41e3a', '#ff5800', '#0051ba', '#009e60'].map((c) => M(c, 0.3, 0.05)), mix = [0, 3, 0, 1, 0, 0, 5, 0, 2]; add(cube, box(0.0152, 0.0152, 0.0152), M('#15171a', 0.5, 0.1)); const tile = [0, 1, 2].map((ax) => box(ax === 0 ? 0.0006 : 0.0042, ax === 1 ? 0.0006 : 0.0042, ax === 2 ? 0.0006 : 0.0042)); for (let f = 0; f < 6; f += 1) { const ax = f >> 1, sign = f % 2 ? -1 : 1; for (let k = 0; k < 9; k += 1) { const p = [0, 0, 0]; p[ax] = sign * 0.0077; p[(ax + 1) % 3] = ((k % 3) - 1) * 0.005; p[(ax + 2) % 3] = (Math.floor(k / 3) - 1) * 0.005; add(cube, tile[ax], faces[(f + (k === 4 ? 0 : mix[(k + f * 2) % 9])) % 6], p); } } cube.position.y = -0.016; cube.rotation.set(0.55, 0.75, 0.1); t.add(cube); },
  gamepad: (t) => { const pad = new THREE.Group(), ink = M('#15171a', 0.5, 0.2); add(pad, flat((sh) => { sh.moveTo(-0.006, 0.0055); sh.lineTo(0.006, 0.0055); sh.bezierCurveTo(0.0105, 0.0055, 0.012, 0.002, 0.0115, -0.003); sh.bezierCurveTo(0.011, -0.0075, 0.0075, -0.0085, 0.006, -0.0045); sh.lineTo(0.0035, -0.002); sh.lineTo(-0.0035, -0.002); sh.lineTo(-0.006, -0.0045); sh.bezierCurveTo(-0.0075, -0.0085, -0.011, -0.0075, -0.0115, -0.003); sh.bezierCurveTo(-0.012, 0.002, -0.0105, 0.0055, -0.006, 0.0055); }, 0.004, 0.001), M('#2e343b', 0.45, 0.2)); for (const x of [-1, 1]) add(pad, box(0.0045, 0.0013, 0.0034), ink, [x * 0.0078, 0.0071, 0]); add(pad, box(0.0046, 0.0015, 0.0009), ink, [-0.0065, 0.002, 0.0032]); add(pad, box(0.0015, 0.0046, 0.0009), ink, [-0.0065, 0.002, 0.0032]); for (const [x, y, c] of [[0, 0.0017, '#ffd23f'], [0.0017, 0, '#ff3a5c'], [0, -0.0017, '#2fa84f'], [-0.0017, 0, '#3fb8ff']]) add(pad, rod(0.0009, 0.0009, 10), M(c, 0.3, 0.1, c, 0.35), [0.0065 + x, 0.002 + y, 0.0032], [Math.PI / 2, 0, 0]); for (const x of [-1, 1]) { add(pad, box(0.0014, 0.0006, 0.0005), M('#6c757d', 0.5, 0.3), [x * 0.0014, 0.0032, 0.0031]); add(pad, rod(0.0012, 0.0012, 12), ink, [x * 0.0028, 0.0004, 0.0034], [Math.PI / 2, 0, 0]); } add(pad, ball(0.0007, 8, 6), M('#6ce6d1', 0.3, 0.2, '#2fd6b8', 1.4), [0, 0.0012, 0.0031]); pad.position.y = -0.0085; t.add(pad); },
  cat: (t) => { const fur = M('#f29a3f', 0.7, 0.05), pale = M('#fde6c8', 0.7, 0.05), pink = M('#ff8fb0', 0.5, 0.05), dark = M('#1a1d21', 0.3, 0.1), y = -0.0135; add(t, ball(0.0095, 16, 12), fur, [0, y, 0], null, [1.1, 0.92, 0.9]); for (const x of [-1, 1]) { add(t, cone(0.0034, 0.0065, 8), fur, [x * 0.0058, y + 0.0072, 0.0004], [0, 0, -x * 0.38], [1, 1, 0.55]); add(t, cone(0.0021, 0.0042, 8), pink, [x * 0.0057, y + 0.0068, 0.0019], [0, 0, -x * 0.38], [1, 1, 0.35]); add(t, ball(0.0017, 10, 8), dark, [x * 0.0035, y + 0.001, 0.0077], null, [1, 1.25, 0.55]); add(t, ball(0.0005, 6, 4), M('#ffffff', 0.3, 0, '#ffffff', 0.8), [x * 0.0035 + 0.0005, y + 0.0018, 0.0086]); add(t, ball(0.0026, 10, 8), pale, [x * 0.0016, y - 0.0028, 0.0072], null, [1, 0.8, 0.55]); for (const g of [-0.22, 0, 0.22]) add(t, rod(0.00022, 0.009, 4), dark, [x * (0.0028 + 0.0045 * Math.cos(g)), y - 0.0026 + 0.0045 * Math.sin(g), 0.0068], [0, x * 0.3, Math.PI / 2 + g * x]); } add(t, flat((sh) => { sh.moveTo(-0.0012, 0.0006); sh.lineTo(0.0012, 0.0006); sh.lineTo(0, -0.0007); sh.closePath(); }, 0.0008, 0.0003), pink, [0, y - 0.0011, 0.0088]); for (const x of [-0.0018, 0, 0.0018]) add(t, box(0.0008, 0.0028 - Math.abs(x) * 0.3, 0.0006), M('#c8661f', 0.7, 0.05), [x, y + 0.0056, 0.0064], [-0.6, 0, 0]); },
  bomb: (t) => { const y = -0.0145, fuse = [[0.0065, 0.0086, 0], [0.0086, 0.0104, 0.0005], [0.0084, 0.0122, 0.001], [0.0104, 0.0132, 0.001]].map(([x, h, z]) => new THREE.Vector3(x, y + h, z)); add(t, ball(0.0092, 18, 14), M('#1d2026', 0.25, 0.35), [0, y, 0]); add(t, ball(0.0024, 10, 8), M('#ffffff', 0.2, 0, '#ffffff', 0.5), [-0.0036, y + 0.0036, 0.0074], [0, 0, 0.7], [1, 0.5, 0.3]); add(t, rod(0.0026, 0.0034, 12), M('#4a5058', 0.35, 0.7), [0.0057, y + 0.0075, 0], [0, 0, -0.65]); add(t, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fuse), 12, 0.00065, 5), M('#c9a66b', 0.8, 0)); const spark = M('#ffe27a', 0.4, 0, '#ffb21f', 2); for (const r of [0, Math.PI / 2]) add(t, flat(star(8, 0.0027, 0.0009), 0.0005, 0), spark, [0.0106, y + 0.0134, 0.001], [0, r, 0.3]); add(t, ball(0.0009, 8, 6), M('#ffffff', 0.3, 0, '#fff4c2', 2.4), [0.0106, y + 0.0134, 0.001]); return { flicker: spark }; },
  rocket: (t) => { const white = M('#f1f4f7', 0.35, 0.2), red = M('#e63a3a', 0.35, 0.2); add(t, cone(0.0045, 0.0075, 16), red, [0, -0.00525, 0]); add(t, rod(0.0045, 0.012, 16), white, [0, -0.015, 0]); add(t, ring(0.0046, 0.0006, 20), red, [0, -0.0195, 0], [Math.PI / 2, 0, 0]); add(t, ring(0.0019, 0.00055, 14), steel(), [0, -0.0125, 0.0043]); add(t, ball(0.0017, 10, 8), M('#6fd3ff', 0.1, 0.2, '#2f9fff', 0.9), [0, -0.0125, 0.0041], null, [1, 1, 0.5]); const fin = flat((sh) => { sh.moveTo(0, 0.005); sh.lineTo(0.0045, -0.002); sh.lineTo(0.0045, -0.0045); sh.lineTo(0, -0.0022); sh.closePath(); }, 0.0008, 0.0003); for (let k = 0; k < 3; k += 1) { const a = -Math.PI / 2 + (k * Math.PI * 2) / 3; add(t, fin, red, [Math.cos(a) * 0.0063, -0.0192, Math.sin(a) * 0.0063], [0, -a, 0]); } add(t, new THREE.CylinderGeometry(0.0026, 0.0034, 0.0024, 12), M('#3a3f46', 0.4, 0.7), [0, -0.0222, 0]); const flame = new THREE.Group(), fire = M('#ff6a1f', 0.4, 0.1, '#ff4a0a', 1.8); add(flame, cone(0.0027, 0.0068, 10), fire, [0, -0.0034, 0], [Math.PI, 0, 0]); add(flame, cone(0.0015, 0.0044, 8), M('#ffe27a', 0.4, 0, '#ffd84a', 2.2), [0, -0.0022, 0], [Math.PI, 0, 0]); flame.position.y = -0.0234; t.add(flame); return { flicker: fire, update: (s) => { const k = Math.sin(s * 31) * 0.14 + Math.sin(s * 53) * 0.08; flame.scale.set(1 - k * 0.4, 1 + k, 1 - k * 0.4); } }; },
  medal: (t) => { ['#2b5fd9', '#f4f2ea', '#d8263a', '#f4f2ea', '#2b5fd9'].forEach((c, i) => add(t, box(0.0018, 0.0086, 0.0008), M(c, 0.85, 0), [(i - 2) * 0.0018, -0.0053, 0])); const g = gold(); add(t, box(0.0102, 0.0016, 0.0018), g, [0, -0.0096, 0]); add(t, rod(0.0074, 0.0022, 28), g, [0, -0.0176, 0], [Math.PI / 2, 0, 0]); add(t, ring(0.0062, 0.0006, 24), M('#b38a22', 0.3, 0.7), [0, -0.0176, 0.0012]); add(t, flat(star(5, 0.0043, 0.0018), 0.0008, 0.0003), M('#f5d06a', 0.2, 0.8, '#6a4a08', 0.6), [0, -0.0176, 0.0014]); },
  trophy: (t) => { const g = gold(); add(t, new THREE.SphereGeometry(0.0068, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), g, [0, -0.0035, 0], null, [1, 1.25, 1]).material.side = THREE.DoubleSide; add(t, ring(0.0068, 0.0006, 24), g, [0, -0.0035, 0], [Math.PI / 2, 0, 0]); for (const x of [-1, 1]) add(t, new THREE.TorusGeometry(0.0024, 0.0007, 6, 12, Math.PI), g, [x * 0.0058, -0.0062, 0], [0, 0, -x * Math.PI / 2]); add(t, rod(0.0011, 0.0042, 8), g, [0, -0.0139, 0]); add(t, new THREE.CylinderGeometry(0.003, 0.0042, 0.0014, 16), g, [0, -0.0166, 0]); add(t, box(0.0105, 0.0055, 0.0105), M('#2a1e16', 0.6, 0.1), [0, -0.0201, 0]); add(t, box(0.0052, 0.0022, 0.0004), M('#e2b646', 0.3, 0.75), [0, -0.0201, 0.0054]); add(t, flat(star(5, 0.0022, 0.0009), 0.0006, 0), M('#fff2c2', 0.3, 0.3, '#ffd96a', 0.8), [0, -0.0078, 0.0062], [0.5, 0, 0]); },
  emerald: (t) => { const gem = M('#1fbf5c', 0.08, 0.25, '#0b7a34', 0.9), stone = new THREE.Group(); gem.flatShading = true; for (const [front, back, h, z] of [[0.0058, 0.0066, 0.0009, 0.00045], [0.0044, 0.0058, 0.0013, 0.00155], [0.0066, 0.0048, 0.0018, -0.0009], [0.0048, 0.0022, 0.0026, -0.0031]]) add(stone, new THREE.CylinderGeometry(front, back, h, 8), gem, [0, 0, z], [Math.PI / 2, Math.PI / 8, 0]); stone.scale.set(1, 1.35, 1); stone.position.y = -0.0135; t.add(stone); add(t, ring(0.0017, 0.00055, 10), gold(), [0, -0.0033, 0], [0, Math.PI / 2, 0]); const glint = add(t, flat(star(4, 0.0026, 0.0006), 0.0005, 0), M('#ffffff', 0.2, 0, '#eafff2', 2.2), [0.0036, -0.0082, 0.0042]); return { spin: stone, rate: 0.6, update: (s) => { glint.scale.setScalar(0.25 + 0.75 * Math.max(0, Math.sin(s * 1.9)) ** 6); glint.rotation.z = s * 0.7; } }; },
  // Developer only. The key to the box: a toothed blade, a round bow, and a mint stone set in it that beats.
  devkey: (t) => {
    const edge = M('#00ffc6', 0.25, 0.3, '#00ffc6', 1.5), shaft = M('#0f3a33', 0.3, 0.6, '#00ffc6', 0.45), stone = M('#eafff6', 0.1, 0.1, '#00ffc6', 2.4);
    const key = new THREE.Group();
    add(key, ring(0.006, 0.0015, 18), edge, [0, 0, 0]);
    add(key, box(0.0034, 0.0022, 0.0018), edge, [0, -0.0078, 0]);                 // collar under the bow
    add(key, box(0.0026, 0.0175, 0.0016), shaft, [0, -0.0168, 0]);                // blade
    for (const [y, w] of [[-0.0185, 0.0048], [-0.0215, 0.0034], [-0.0245, 0.0052]]) add(key, box(w, 0.0022, 0.0016), edge, [0.0013 + w / 2, y, 0]);
    add(key, cone(0.0016, 0.0035, 4), shaft, [0, -0.0272, 0], [Math.PI, 0, 0]);   // the tip that goes in first
    const gem = add(key, new THREE.IcosahedronGeometry(0.0028, 0), stone, [0, 0, 0]);
    key.position.y = -0.0085;
    t.add(key);
    return { spin: key, rate: 0.8, update: (s) => { const beat = Math.sin(s * 2.6); stone.emissiveIntensity = 2.2 + beat * 0.9; gem.scale.setScalar(1 + beat * 0.12); gem.rotation.set(s * 0.6, s * 0.9, 0); } };
  },
  // Developer only. A tesseract: a mint edge cube and a solid core turning against each other, their
  // corners strung together, the whole thing drifting mint to cyan to violet and back.
  // Item Shop charms. Static: nothing here animates, so an unparented one can never be driven.
  dogtag: (t) => { const edge = M('#98a2ab', 0.35, 0.8), stamp = M('#5c646c', 0.55, 0.5); const plate = flat((sh) => { sh.moveTo(-0.0068, -0.0195); sh.lineTo(0.0068, -0.0195); sh.quadraticCurveTo(0.0082, -0.0195, 0.0082, -0.0182); sh.lineTo(0.0082, -0.0032); sh.quadraticCurveTo(0.0082, 0, 0.005, 0); sh.lineTo(-0.005, 0); sh.quadraticCurveTo(-0.0082, 0, -0.0082, -0.0032); sh.lineTo(-0.0082, -0.0182); sh.quadraticCurveTo(-0.0082, -0.0195, -0.0068, -0.0195); }, 0.0011); for (let k = 0; k < 4; k += 1) add(t, ball(0.0009, 6, 5), edge, [0, -0.0013 - k * 0.0019, 0]); for (const [y, z, face] of [[-0.0192, 0.0021, -1], [-0.0158, -0.0019, 1]]) { add(t, plate, edge, [0, y, z]); for (const k of [0, 1, 2]) add(t, box(0.0092 - k * 0.0018, 0.0009, 0.0012), stamp, [0, y + 0.0052 - k * 0.0042, z + face * 0.0008]); } add(t, ring(0.009, 0.0013, 18), M('#23262a', 0.9, 0), [0, -0.0158, -0.0019], null, [0.95, 1.12, 1]); },
  boltring: (t) => { const iron = M('#6f7982', 0.4, 0.8), bright = M('#b9c4ce', 0.25, 0.9); add(t, ring(0.0072, 0.0016, 18), bright, [0, -0.0062, 0], [0.28, 0, 0]); add(t, rod(0.008, 0.0055, 6), iron, [0, -0.0135, 0]); add(t, rod(0.0068, 0.0015, 6), iron, [0, -0.017, 0]); add(t, rod(0.0032, 0.013, 10), iron, [0, -0.0235, 0]); for (const y of [-0.0188, -0.0263, -0.0283]) add(t, ring(0.0033, 0.0007, 10), iron, [0, y, 0], [Math.PI / 2, 0, 0]); add(t, rod(0.0058, 0.0038, 6), bright, [0, -0.0225, 0]); add(t, rod(0.0066, 0.0011, 14), bright, [0, -0.0247, 0]); },
  talisman: (t) => { const stone = M('#4b5158', 0.9, 0.05), cut = M('#e0cf94', 0.45, 0.15, '#7d5c16', 0.8), cord = M('#4a3826', 0.95, 0); for (const x of [-1, 1]) add(t, rod(0.0008, 0.011, 5), cord, [x * 0.0026, -0.0068, 0], [0, 0, x * 0.24]); add(t, rod(0.0112, 0.0038, 14), stone, [0, -0.0165, 0], [Math.PI / 2, 0, 0]); add(t, ring(0.0104, 0.0011, 18), M('#3a3f45', 0.9, 0.05), [0, -0.0165, 0]); add(t, ring(0.0024, 0.0008, 10), cord, [0, -0.0074, 0]); add(t, box(0.0013, 0.0118, 0.0014), cut, [0, -0.0165, 0.0021]); add(t, box(0.0013, 0.0062, 0.0014), cut, [0.0022, -0.0136, 0.0021], [0, 0, -0.75]); add(t, box(0.0013, 0.0062, 0.0014), cut, [0.0022, -0.0194, 0.0021], [0, 0, 0.75]); add(t, box(0.0013, 0.0052, 0.0014), cut, [-0.002, -0.0168, 0.0021], [0, 0, 0.78]); },
  keyring: (t) => { const brass = M('#c9a14a', 0.3, 0.75), nickel = M('#b6c0c9', 0.3, 0.8), worn = M('#6b737b', 0.55, 0.6); add(t, ring(0.0068, 0.0016, 18), nickel, [0, -0.0068, 0], [0.3, 0, 0]); for (const [tilt, metal, len, bit] of [[-0.52, brass, 0.0115, 0.0044], [-0.02, nickel, 0.0135, 0.0034], [0.46, worn, 0.0105, 0.0048]]) { const key = new THREE.Group(); key.position.y = -0.0068; key.rotation.z = tilt; t.add(key); add(key, ring(0.0028, 0.0009, 12), metal, [0, -0.0068, 0]); const end = -0.0096 - len; add(key, rod(0.0011, len, 8), metal, [0, -0.0096 - len / 2, 0]); add(key, box(bit, 0.0018, 0.0012), metal, [bit / 2 + 0.0007, end + 0.0021, 0]); add(key, box(bit * 0.65, 0.0018, 0.0012), metal, [bit * 0.325 + 0.0007, end + 0.0058, 0]); } },
  devcore: (t) => {
    const core = new THREE.Group(), outer = new THREE.Group(), inner = new THREE.Group(), H = 0.0074, h = 0.0033, corners = [], v = new THREE.Vector3(), tint = new THREE.Color();
    const edge = M('#00ffc6', 0.3, 0.2, '#00ffc6', 1.6), node = M('#ffffff', 0.2, 0.1, '#00ffc6', 2.4), heart = M('#00ffc6', 0.15, 0.1, '#00ffc6', 2);
    for (let a = 0; a < 3; a += 1) for (const [u, w] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { const size = [0.0007, 0.0007, 0.0007], p = [0, 0, 0]; size[a] = H * 2; p[(a + 1) % 3] = u * H; p[(a + 2) % 3] = w * H; add(outer, box(...size), edge, p); }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) { corners.push(new THREE.Vector3(x, y, z)); add(outer, ball(0.001, 8, 6), node, [x * H, y * H, z * H]); }
    add(inner, box(h * 2, h * 2, h * 2), heart);
    const halo = add(core, ball(0.0062, 16, 12), new THREE.MeshBasicMaterial({ color: '#00ffc6', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    const links = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(48), 3)), new THREE.LineBasicMaterial({ color: '#00ffc6', transparent: true, opacity: 0.6 }));
    core.add(outer, inner, links); core.position.y = -0.0155; t.add(core);
    const hue = (s, lag) => { const k = 0.5 - Math.cos(s * 0.5 - lag) * 0.5; return tint.setHSL((166 + 97 * k) / 360, 1, 0.5 + 0.18 * k, THREE.SRGBColorSpace); };
    const update = (s) => {
      outer.rotation.set(0.6 + s * 0.45, 0.8 + s * 0.6, 0);
      inner.rotation.set(0.3 - s * 0.9, -0.5 - s * 1.1, s * 0.35);
      inner.scale.setScalar(1 + Math.sin(s * 2.4) * 0.07);
      const at = links.geometry.attributes.position;
      corners.forEach((c, k) => { v.copy(c).multiplyScalar(H).applyEuler(outer.rotation); at.setXYZ(k * 2, v.x, v.y, v.z); v.copy(c).multiplyScalar(h * inner.scale.x).applyEuler(inner.rotation); at.setXYZ(k * 2 + 1, v.x, v.y, v.z); });
      at.needsUpdate = true;
      hue(s, 0); edge.color.copy(tint); edge.emissive.copy(tint); node.emissive.copy(tint); links.material.color.copy(tint); halo.material.color.copy(tint);
      hue(s, 1.3); heart.color.copy(tint); heart.emissive.copy(tint); heart.emissiveIntensity = 1.8 + Math.sin(s * 3) * 0.5;
    };
    update(0);
    return { update };
  },
};
export const CHARM_IDS = Object.keys(MAKERS);

const DOWN = new THREE.Vector3(0, -1, 0);
const CHAIN = 0.026; // ring plus three links

// root (fixed to the gun) → chain (first pendulum) → trinket (second pendulum, pivoting at the chain's end)
export function buildCharm(id) {
  if (!id || id === 'none' || !MAKERS[id]) return null;
  const root = new THREE.Group();
  const metal = steel();
  add(root, ring(0.0034, 0.0007, 12), metal, [0, 0.001, 0], [0, Math.PI / 2, 0]);           // split ring on the gun
  const chain = new THREE.Group();
  for (let link = 0; link < 3; link += 1) add(chain, ring(0.0026, 0.00065, 10), metal, [0, -0.0055 - link * 0.0068, 0], [0, link % 2 ? 0 : Math.PI / 2, 0], [1, 1.35, 1]);
  const trinket = new THREE.Group();
  trinket.position.y = -CHAIN;
  add(trinket, ring(0.0022, 0.0006, 10), metal, [0, -0.0012, 0]);                           // jump ring the trinket hangs from
  const body = new THREE.Group();
  body.position.y = -0.0022;
  const extra = MAKERS[id](body) || {};
  trinket.add(body);
  chain.add(trinket);
  root.add(chain);
  root.traverse((mesh) => { mesh.frustumCulled = false; });
  root.userData = { charm: id, chain, trinket, body, spin: extra.spin || null, rate: extra.rate || 0, axis: extra.axis || 'y', flicker: extra.flicker || null, update: extra.update || null, physics: new CharmPhysics() };
  return root;
}

const scratch = { force: new THREE.Vector3(), quat: new THREE.Quaternion(), inv: new THREE.Quaternion(), tangent: new THREE.Vector3(), point: new THREE.Vector3(), accel: new THREE.Vector3(), tip: new THREE.Vector3() };
class CharmPhysics {
  constructor() {
    this.d1 = DOWN.clone(); this.v1 = new THREE.Vector3(); this.d2 = DOWN.clone(); this.v2 = new THREE.Vector3();
    this.p1 = null; this.p2 = null; this.twist = 0; this.twistVel = 0; this.lastClink = 0;
  }
  reset() { this.p1 = null; this.p2 = null; }
}
// One pendulum step in the gun's local space. `towardGun` is the local direction of the receiver; the
// pendulum may lean that way only as far as `limit` before it touches metal.
function swing(dir, vel, force, length, damping, dt, limit, onHit) {
  const tangent = scratch.tangent.copy(force).addScaledVector(dir, -force.dot(dir));
  vel.addScaledVector(tangent, dt / length);
  vel.multiplyScalar(Math.exp(-damping * dt));
  dir.addScaledVector(vel, dt).normalize();
  vel.addScaledVector(dir, -vel.dot(dir));
  if (dir.x > limit) {                                  // the gun is on the +x side of where the charm hangs
    const hit = vel.x;
    dir.x = limit; dir.normalize();
    if (hit > 0) { vel.x = -hit * 0.4; vel.multiplyScalar(0.8); onHit?.(hit); }
  }
  if (dir.y > 0.3) { dir.y = 0.3; dir.normalize(); if (vel.y > 0) vel.y *= -0.3; }       // it can kick up past level, never over the top
}

// Call once a frame, after the gun has been posed.
//   charm: from buildCharm, a child of the gun model · gravity: unit vector for "down" in the space the gun lives in
//   jolt: extra acceleration in that space (mouse flicks), m/s² · onClink(strength 0..1): it struck the gun
export function updateCharm(charm, dt, { gravity = DOWN, jolt = null, onClink = null, scale = 1 } = {}) {
  const data = charm.userData, body = data.physics;
  const step = Math.min(dt, 0.05);
  if (step <= 0 || !charm.parent) return;                 // nothing to hang from, nothing to swing

  // How the attachment point is accelerating, from where it has been the last three frames.
  charm.updateWorldMatrix(true, false);
  const point = scratch.point.setFromMatrixPosition(charm.matrixWorld);
  const accel = scratch.accel.set(0, 0, 0);
  if (body.p1 && body.p2 && point.distanceToSquared(body.p1) < 0.09) accel.copy(point).addScaledVector(body.p1, -2).add(body.p2).multiplyScalar(1 / (step * step * scale));
  if (!body.p1 || point.distanceToSquared(body.p1) >= 0.09) { body.p1 = point.clone(); body.p2 = point.clone(); } else { body.p2.copy(body.p1); body.p1.copy(point); }
  // A sniper's recoil is violent at the muzzle; the charm gets a share of it, not all of it.
  accel.multiplyScalar(0.5);
  if (accel.lengthSq() > 38 * 38) accel.setLength(38);
  // Everything the charm feels, in the gun's own axes: gravity, minus how the gun is being thrown about.
  const force = scratch.force.copy(gravity).multiplyScalar(9.81).sub(accel);
  if (jolt) force.sub(jolt);
  charm.parent.getWorldQuaternion(scratch.quat);
  force.applyQuaternion(scratch.inv.copy(scratch.quat).invert());
  const clink = (speed) => { const t = performance.now(); if (speed > 1.6 && t - body.lastClink > 140) { body.lastClink = t; onClink?.(Math.min(1, speed / 7)); } };
  for (let sub = 0; sub < 2; sub += 1) {
    const h = step / 2;
    const before = scratch.tip.copy(body.v1);
    swing(body.d1, body.v1, force, CHAIN * 1.6, 3.4, h, 0.32, clink);
    // The trinket also feels the end of the chain whipping about underneath it.
    const whip = before.sub(body.v1).multiplyScalar(CHAIN / h * 0.5);
    swing(body.d2, body.v2, scratch.tangent.copy(force).add(whip), 0.02, 4.2, h, 0.45, clink);
  }
  data.chain.quaternion.setFromUnitVectors(DOWN, body.d1);
  data.trinket.quaternion.copy(scratch.inv.copy(data.chain.quaternion).invert()).multiply(scratch.quat.setFromUnitVectors(DOWN, body.d2));
  // Sideways swinging winds the trinket round on its ring, and it unwinds again.
  body.twistVel += (body.v2.z * 9 - body.twist * 14 - body.twistVel * 2.2) * step;
  body.twist += body.twistVel * step;
  data.body.rotation.y = body.twist;
  if (data.spin) data.spin.rotation[data.axis] += data.rate * step;
  if (data.flicker) data.flicker.emissiveIntensity = 1.5 + Math.sin(performance.now() / 70) * 0.35 + Math.sin(performance.now() / 23) * 0.2;
  if (data.update) data.update(performance.now() / 1000);
}
