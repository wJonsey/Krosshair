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
  root.userData = { charm: id, chain, trinket, body, spin: extra.spin || null, rate: extra.rate || 0, axis: extra.axis || 'y', flicker: extra.flicker || null, physics: new CharmPhysics() };
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
  if (step <= 0) return;
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
}
