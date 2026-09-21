// Shared game rules. Imported by both the browser client and the Node server,
// so everything in here must stay free of DOM / Node specific APIs.

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const INTERP_DELAY = 0.1;
export const MAX_REWIND = 0.4;
export const MAX_PLAYERS = 8;
export const RECONNECT_GRACE = 45;

export const BODY = {
  radius: 0.36,
  height: 1.8,
  crouchHeight: 1.25,
  eye: 1.62,
  crouchEye: 1.06,
  step: 0.45,
  runSpeed: 4.8,        // on foot, not sprinting
  sprintSpeed: 6.8,     // holding sprint, and the pace a slide is meant to be entered from
  // Weapon spread is scaled against a speed, not against whatever the base happens to be. It is kept
  // at the old base on purpose: sprint is a movement change, and moving it here would quietly make
  // everyone less accurate on the move, which is a gunplay change nobody asked for.
  spreadSpeed: 6.0,
  walkSpeed: 3.1,
  crouchSpeed: 2.3,
  jumpVelocity: 5.7,
  gravity: 15,
  // Slide and bhop. Crouch at a run and you go faster for a moment instead of slower; jump out of that
  // slide and you keep most of it, so a slide, jump, slide chain holds its speed while the timing is
  // good and bleeds off when it is not. flowMax is the ceiling on the whole chain and is deliberately
  // under the 13 m/s the server rejects, so nobody gets snapped back for moving well.
  slideSpeed: 8.2,      // what a plain slide out of a run is worth, before any chaining
  slideMin: 4.4,        // you have to already be running to start one
  slideTime: 0.62,      // how long the burst lasts before it is just a crouch
  slideCooldown: 0.28,  // from the end of one slide to the start of the next
  bhopKeep: 0.93,       // share of the slide carried out of a well timed jump
  bhopGain: 0.8,        // added to each chained slide, so hops build instead of only holding
  flowMax: 11.0,        // where the chain tops out. bhopGain and bhopKeep are picked to land here
  flowDecay: 8.5,       // m/s bled each second once the slide is over and you are back on your feet
  slideArc: 0.82,       // a slide hop is a low fast arc, not a leap
  scopeArc: 0.76,       // scoped is the short hop: less height, back on the ground sooner
  strafeBonus: 1.06,    // strafing while airborne mid chain, the reason to air strafe at all
  // What the server treats as impossible. It has to clear flowMax with room to spare: a network hitch
  // bunches movement into one update, and a pilot who has earned their speed must never be snapped
  // back for it. Well above anything legitimate, still far under what a speed hack helps itself to.
  speedLimit: 15,
  // Acceleration, out of the movement code so it can be tuned in one place.
  groundAccel: 14,      // how hard you are pulled to the speed you asked for, on your feet
  airAccel: 14,         // and in the air, where it is applied along the wish direction only
  // The trick that makes air strafing a skill: in the air only this much of the wish speed counts,
  // so turning while you hold a strafe keeps opening a gap to accelerate into. Raise it and the air
  // feels like the ground; drop it to nothing and air strafing stops working at all.
  airControl: 1.5,
  coyoteTime: 0.09,     // still jumpable this long after walking off an edge
  jumpBuffer: 0.13,     // a jump pressed this soon before landing still fires on touchdown
};

// Penetration: a bullet starts with `pen` power. Every metre of material costs
// `resist` power. Damage scales with the power that is left.
export const MATERIALS = {
  asphalt: { color: '#454b52', rough: 0.95, pattern: 'noise', resist: 99, sound: 'concrete' },
  paving: { color: '#676b6e', rough: 0.9, pattern: 'tiles', resist: 99, sound: 'concrete' },
  gravel: { color: '#5d574c', rough: 1, pattern: 'noise', resist: 99, sound: 'gravel' },
  grass: { color: '#33563c', rough: 1, pattern: 'noise', resist: 99, sound: 'grass' },
  concrete: { color: '#6d7377', rough: 0.85, pattern: 'panels', resist: 6, sound: 'concrete' },
  wall: { color: '#39424a', rough: 0.8, pattern: 'panels', resist: 99, sound: 'concrete' },
  brick: { color: '#7a4a3a', rough: 0.9, pattern: 'bricks', resist: 3, sound: 'concrete' },
  plaster: { color: '#8b8678', rough: 0.9, pattern: 'noise', resist: 3, sound: 'concrete' },
  stone: { color: '#8a8d8c', rough: 0.7, pattern: 'noise', resist: 8, sound: 'concrete' },
  tunnel: { color: '#4c5357', rough: 0.9, pattern: 'panels', resist: 99, sound: 'concrete' },
  metal: { color: '#47545e', rough: 0.45, metal: 0.6, pattern: 'ribs', resist: 1.6, sound: 'metal' },
  rust: { color: '#7b4f35', rough: 0.7, metal: 0.4, pattern: 'ribs', resist: 1.6, sound: 'metal' },
  teal: { color: '#2f6c70', rough: 0.55, metal: 0.4, pattern: 'ribs', resist: 1.6, sound: 'metal' },
  wood: { color: '#80603c', rough: 0.85, pattern: 'planks', resist: 0.8, sound: 'wood' },
  crate: { color: '#9a7a48', rough: 0.85, pattern: 'planks', resist: 0.8, sound: 'wood' },
  cloth: { color: '#c0503e', rough: 1, pattern: 'stripes', resist: 0.1, sound: 'cloth' },
  clothAlt: { color: '#d8b04a', rough: 1, pattern: 'stripes', resist: 0.1, sound: 'cloth' },
  glass: { color: '#9fd8e6', rough: 0.08, resist: 0.4, sound: 'glass', seeThrough: true },
  neonCyan: { color: '#6ce6d1', rough: 0.4, emissive: 1.6, resist: 1, sound: 'metal' },
  neonOrange: { color: '#ff7148', rough: 0.4, emissive: 1.6, resist: 1, sound: 'metal' },
  neonPink: { color: '#ec6a9e', rough: 0.4, emissive: 1.6, resist: 1, sound: 'metal' },
  lamp: { color: '#ffe2b0', rough: 0.4, emissive: 2.2, resist: 1, sound: 'metal' },
  target: { color: '#d9d4c8', rough: 0.8, pattern: 'noise', resist: 0.5, sound: 'wood' },
  barrier: { color: '#6ce6d1', rough: 0.2, resist: 99, sound: 'energy', seeThrough: true },
  shield: { color: '#8fd5ff', rough: 0.2, resist: 99, sound: 'energy', seeThrough: true },
  // --- map pack: gallery, old town, arctic, desert ---
  marble: { color: '#cfcbc0', rough: 0.35, pattern: 'tiles', resist: 8, sound: 'concrete' },
  marbleDark: { color: '#3b3f45', rough: 0.3, pattern: 'tiles', resist: 8, sound: 'concrete' },
  plasterWhite: { color: '#dcd8cc', rough: 0.9, pattern: 'noise', resist: 3, sound: 'concrete' },
  ochre: { color: '#c9994f', rough: 0.95, pattern: 'noise', resist: 3, sound: 'concrete' },
  rosePlaster: { color: '#c98268', rough: 0.95, pattern: 'noise', resist: 3, sound: 'concrete' },
  terracotta: { color: '#b55f3a', rough: 0.85, pattern: 'bricks', resist: 2, sound: 'concrete' },
  cobble: { color: '#7d766a', rough: 1, pattern: 'tiles', resist: 99, sound: 'concrete' },
  water: { color: '#2a6d88', rough: 0.08, metal: 0.3, resist: 99, sound: 'grass' },
  bronze: { color: '#8a6a3a', rough: 0.4, metal: 0.8, pattern: 'noise', resist: 8, sound: 'metal' },
  hedge: { color: '#2f5a35', rough: 1, pattern: 'noise', resist: 0.15, sound: 'grass' },
  sand: { color: '#c4a66e', rough: 1, pattern: 'noise', resist: 99, sound: 'gravel' },
  sandstone: { color: '#b88a58', rough: 0.95, pattern: 'strata', resist: 99, sound: 'concrete' },
  adobe: { color: '#c59c6e', rough: 1, pattern: 'noise', resist: 3, sound: 'concrete' },
  sandbag: { color: '#9a8960', rough: 1, pattern: 'bricks', resist: 2.5, sound: 'cloth' },
  snow: { color: '#e4ecf2', rough: 0.9, pattern: 'noise', resist: 99, sound: 'gravel' },
  snowBerm: { color: '#d3dfe9', rough: 0.95, pattern: 'noise', resist: 0.6, sound: 'gravel' },
  ice: { color: '#a5d2e6', rough: 0.12, metal: 0.1, pattern: 'noise', resist: 2, sound: 'glass' },
  hull: { color: '#cfd6db', rough: 0.5, metal: 0.3, pattern: 'panels', resist: 1.6, sound: 'metal' },
  hazard: { color: '#d8762a', rough: 0.55, metal: 0.4, pattern: 'ribs', resist: 1.6, sound: 'metal' },
  darkMetal: { color: '#23292f', rough: 0.4, metal: 0.7, pattern: 'ribs', resist: 1.6, sound: 'metal' },
  rock: { color: '#6f6a62', rough: 1, pattern: 'strata', resist: 99, sound: 'concrete' },
};

export const ZONE_MULT = { head: 1, torso: 1, limb: 1 };

export const WEAPONS = {
  m44: {
    id: 'm44', sight: 'scope', slot: 'primary', family: 'sniper', short: 'M-44', action: 'bolt', trail: true, pierce: true, name: 'M-44 Long Sight', tag: 'BOLT-ACTION SNIPER', cost: 0,
    damage: 104, head: 4, limb: 0.72, armorPen: 0.55, pen: 1.0,
    mag: 5, reserve: 20, cooldown: 1.25, reload: 2.9, equip: 0.75,
    auto: false, pellets: 1, scope: [18, 9], scopeTime: 0.22,
    spread: { hip: 5.5, ads: 0, move: 3, air: 8, bloom: 0, bloomMax: 0 },
    falloff: null, recoil: { kick: 3.4, side: 0.5, recover: 5 }, speed: 0.9, loud: 95, tracer: 1,
  },
  recon: {
    id: 'recon', sight: 'prism', slot: 'primary', family: 'marksman', short: 'RC-9', sway: 0.7, name: 'RC-9 Recon', tag: 'SEMI-AUTO MARKSMAN', cost: 1500,
    damage: 45, head: 2.3, limb: 0.8, armorPen: 0.4, pen: 0.6,
    mag: 10, reserve: 30, cooldown: 0.3, reload: 2.4, equip: 0.6,
    auto: false, pellets: 1, scope: [30], scopeTime: 0.17,
    spread: { hip: 2.8, ads: 0.08, move: 1.8, air: 5, bloom: 0.4, bloomMax: 1.5 },
    falloff: null, recoil: { kick: 1.6, side: 0.35, recover: 8 }, speed: 0.94, loud: 80, tracer: 0.8,
  },
  talon: {
    id: 'talon', sight: 'dot', slot: 'primary', family: 'rifle', short: 'TALON', name: 'Talon AR', tag: 'AUTOMATIC RIFLE', cost: 2000,
    damage: 26, head: 2.6, limb: 0.8, armorPen: 0.45, pen: 0.5,
    mag: 30, reserve: 90, cooldown: 0.105, reload: 2.4, equip: 0.55,
    auto: true, pellets: 1, scope: [42], scopeTime: 0.14,
    spread: { hip: 2.4, ads: 0.3, move: 1.3, air: 4.5, bloom: 0.2, bloomMax: 2 },
    falloff: [32, 85, 0.7], recoil: { kick: 0.8, side: 0.4, recover: 9 }, speed: 0.96, loud: 75, tracer: 0.6,
  },
  wasp: {
    id: 'wasp', sight: 'dot', slot: 'primary', family: 'smg', short: 'WASP-9', name: 'Wasp-9', tag: 'SUBMACHINE GUN', cost: 1350,
    damage: 20, head: 1.8, limb: 0.85, armorPen: 0, pen: 0.25,
    mag: 30, reserve: 90, cooldown: 0.078, reload: 1.9, equip: 0.4,
    auto: true, pellets: 1, scope: [56], scopeTime: 0.1,
    spread: { hip: 1.6, ads: 0.9, move: 0.6, air: 3, bloom: 0.26, bloomMax: 3 },
    falloff: [12, 36, 0.45], recoil: { kick: 0.55, side: 0.3, recover: 10 }, speed: 1.04, loud: 60, tracer: 0.5,
  },
  breaker: {
    id: 'breaker', sight: 'bead', slot: 'primary', family: 'shotgun', short: 'BREAKER', action: 'pump', name: 'Breaker-12', tag: 'PUMP SHOTGUN', cost: 1900,
    damage: 14, head: 1.5, limb: 0.85, armorPen: 0, pen: 0.12,
    mag: 6, reserve: 18, cooldown: 0.8, reload: 2.6, equip: 0.55,
    auto: false, pellets: 9, scope: [60], scopeTime: 0.1,
    spread: { hip: 4, ads: 3.1, move: 0.4, air: 2, bloom: 0, bloomMax: 0 },
    falloff: [8, 26, 0.2], recoil: { kick: 3.0, side: 0.6, recover: 6 }, speed: 1.0, loud: 85, tracer: 0.35,
  },
  vesper: {
    id: 'vesper', sight: 'scope', slot: 'primary', family: 'sniper', short: 'VESPER', action: 'bolt', trail: true, name: 'Vesper SR', tag: 'LIGHT BOLT-ACTION', cost: 1100,
    damage: 88, head: 3.5, limb: 0.7, armorPen: 0.45, pen: 0.8,
    mag: 6, reserve: 24, cooldown: 0.95, reload: 2.4, equip: 0.55,
    auto: false, pellets: 1, scope: [24, 12], scopeTime: 0.15,
    spread: { hip: 4, ads: 0, move: 2.2, air: 7, bloom: 0, bloomMax: 0 },
    falloff: null, recoil: { kick: 2.6, side: 0.4, recover: 6 }, speed: 1.0, loud: 85, tracer: 0.9,
  },
  harbinger: {
    id: 'harbinger', sight: 'scope', slot: 'primary', family: 'sniper', short: 'HARB .50', trail: true, pierce: true, name: 'Harbinger .50', tag: 'ANTI-MATERIEL RIFLE', cost: 3400,
    damage: 150, head: 3, limb: 0.9, armorPen: 0.85, pen: 2.2,
    mag: 4, reserve: 12, cooldown: 1.5, reload: 3.6, equip: 1.0,
    auto: false, pellets: 1, scope: [14, 7], scopeTime: 0.32,
    spread: { hip: 7, ads: 0, move: 4, air: 10, bloom: 0, bloomMax: 0 },
    falloff: null, recoil: { kick: 5, side: 0.8, recover: 4 }, speed: 0.84, loud: 120, tracer: 1.3,
  },
  ronin: {
    id: 'ronin', sight: 'iron', slot: 'primary', family: 'rifle', short: 'RONIN', name: 'Ronin-47', tag: 'HEAVY ASSAULT RIFLE', cost: 2500,
    damage: 34, head: 2.5, limb: 0.8, armorPen: 0.5, pen: 0.6,
    mag: 30, reserve: 90, cooldown: 0.125, reload: 2.6, equip: 0.6,
    auto: true, pellets: 1, scope: [45], scopeTime: 0.16,
    spread: { hip: 2.8, ads: 0.45, move: 1.6, air: 5, bloom: 0.32, bloomMax: 2.8 },
    falloff: [30, 80, 0.7], recoil: { kick: 1.25, side: 0.7, recover: 7 }, speed: 0.93, loud: 85, tracer: 0.7,
  },
  halcyon: {
    id: 'halcyon', sight: 'holo', slot: 'primary', family: 'rifle', short: 'C8', name: 'Halcyon C8', tag: 'CARBINE', cost: 1700,
    damage: 22, head: 2.6, limb: 0.8, armorPen: 0.35, pen: 0.45,
    mag: 30, reserve: 120, cooldown: 0.09, reload: 2.1, equip: 0.45,
    auto: true, pellets: 1, scope: [48], scopeTime: 0.12,
    spread: { hip: 2, ads: 0.35, move: 1, air: 4, bloom: 0.18, bloomMax: 1.8 },
    falloff: [24, 70, 0.65], recoil: { kick: 0.6, side: 0.3, recover: 11 }, speed: 1.0, loud: 70, tracer: 0.55,
  },
  anvil: {
    id: 'anvil', sight: 'dot', slot: 'primary', family: 'lmg', short: 'ANVIL', name: 'Anvil LMG', tag: 'LIGHT MACHINE GUN', cost: 2900,
    damage: 28, head: 2.2, limb: 0.85, armorPen: 0.55, pen: 0.9,
    mag: 80, reserve: 160, cooldown: 0.1, reload: 5.2, equip: 1.0,
    auto: true, pellets: 1, scope: [50], scopeTime: 0.28,
    spread: { hip: 4, ads: 0.6, move: 2.6, air: 7, bloom: 0.12, bloomMax: 3 },
    falloff: [35, 90, 0.75], recoil: { kick: 0.9, side: 0.55, recover: 7 }, speed: 0.84, loud: 95, tracer: 0.7,
  },
  hornet: {
    id: 'hornet', sight: 'holo', slot: 'primary', family: 'smg', short: 'HORNET', name: 'Hornet PDW', tag: 'PERSONAL DEFENCE WEAPON', cost: 1250,
    damage: 16, head: 1.8, limb: 0.9, armorPen: 0.15, pen: 0.2,
    mag: 40, reserve: 120, cooldown: 0.062, reload: 2.2, equip: 0.35,
    auto: true, pellets: 1, scope: [58], scopeTime: 0.08,
    spread: { hip: 1.4, ads: 1, move: 0.4, air: 2.5, bloom: 0.22, bloomMax: 3.4 },
    falloff: [10, 30, 0.4], recoil: { kick: 0.45, side: 0.35, recover: 12 }, speed: 1.07, loud: 55, tracer: 0.4,
  },
  maul: {
    id: 'maul', sight: 'iron', slot: 'primary', family: 'shotgun', short: 'MAUL', name: 'Maul-S', tag: 'SEMI-AUTO SHOTGUN', cost: 1500,
    damage: 11, head: 1.4, limb: 0.85, armorPen: 0, pen: 0.1,
    mag: 7, reserve: 21, cooldown: 0.34, reload: 3.0, equip: 0.6,
    auto: false, pellets: 8, scope: [62], scopeTime: 0.12,
    spread: { hip: 4.6, ads: 3.8, move: 0.5, air: 2, bloom: 0.5, bloomMax: 1.5 },
    falloff: [6, 20, 0.2], recoil: { kick: 2.4, side: 0.7, recover: 7 }, speed: 0.97, loud: 85, tracer: 0.3,
  },
  p9: {
    id: 'p9', sight: 'iron', slot: 'sidearm', family: 'pistol', short: 'P9', name: 'P9 Service', tag: 'SIDEARM', cost: 0,
    damage: 24, head: 2.3, limb: 0.85, armorPen: 0.1, pen: 0.3,
    mag: 12, reserve: 36, cooldown: 0.16, reload: 1.5, equip: 0.3,
    auto: false, pellets: 1, scope: [62], scopeTime: 0.08,
    spread: { hip: 1.3, ads: 0.5, move: 0.8, air: 4, bloom: 0.4, bloomMax: 2.4 },
    falloff: [16, 44, 0.5], recoil: { kick: 0.9, side: 0.3, recover: 9 }, speed: 1.06, loud: 55, tracer: 0.4,
  },
  viper: {
    id: 'viper', sight: 'iron', slot: 'sidearm', family: 'pistol', short: 'VIPER', name: 'Viper .50', tag: 'HEAVY REVOLVER', cost: 800,
    damage: 55, head: 2.1, limb: 0.8, armorPen: 0.4, pen: 0.5,
    mag: 6, reserve: 18, cooldown: 0.48, reload: 2.2, equip: 0.4,
    auto: false, pellets: 1, scope: [58], scopeTime: 0.1,
    spread: { hip: 1.6, ads: 0.25, move: 1.4, air: 5, bloom: 0.9, bloomMax: 2.5 },
    falloff: [24, 60, 0.6], recoil: { kick: 2.6, side: 0.5, recover: 6 }, speed: 1.03, loud: 80, tracer: 0.6,
  },
  pike: {
    id: 'pike', sight: 'iron', slot: 'sidearm', family: 'pistol', short: 'PIKE', name: 'Pike MP', tag: 'MACHINE PISTOL', cost: 550,
    damage: 15, head: 2, limb: 0.85, armorPen: 0, pen: 0.2,
    mag: 18, reserve: 54, cooldown: 0.07, reload: 1.7, equip: 0.3,
    auto: true, pellets: 1, scope: [62], scopeTime: 0.08,
    spread: { hip: 1.8, ads: 1.2, move: 0.6, air: 3, bloom: 0.35, bloomMax: 3.5 },
    falloff: [8, 26, 0.4], recoil: { kick: 0.6, side: 0.45, recover: 11 }, speed: 1.06, loud: 55, tracer: 0.35,
  },
  wren: {
    id: 'wren', sight: 'iron', slot: 'sidearm', family: 'pistol', short: 'WREN', suppressed: true, name: 'Wren .22', tag: 'SUPPRESSED PISTOL', cost: 350,
    damage: 21, head: 2.6, limb: 0.85, armorPen: 0, pen: 0.15,
    mag: 15, reserve: 45, cooldown: 0.17, reload: 1.5, equip: 0.3,
    auto: false, pellets: 1, scope: [62], scopeTime: 0.08,
    spread: { hip: 1.2, ads: 0.4, move: 0.7, air: 4, bloom: 0.3, bloomMax: 2 },
    falloff: [14, 40, 0.5], recoil: { kick: 0.5, side: 0.2, recover: 12 }, speed: 1.08, loud: 18, tracer: 0.15,
  },
  sawn: {
    id: 'sawn', sight: 'bead', slot: 'sidearm', family: 'shotgun', short: 'SAWN-OFF', name: 'Sawn-Off', tag: 'DOUBLE-BARREL', cost: 1000,
    damage: 12, head: 1.4, limb: 0.85, armorPen: 0, pen: 0.1,
    mag: 2, reserve: 16, cooldown: 0.22, reload: 2.2, equip: 0.35,
    auto: false, pellets: 8, scope: [64], scopeTime: 0.08,
    spread: { hip: 5.2, ads: 4.6, move: 0.3, air: 1.5, bloom: 0, bloomMax: 0 },
    falloff: [4, 14, 0.15], recoil: { kick: 3.2, side: 0.9, recover: 6 }, speed: 1.04, loud: 90, tracer: 0.3,
  },
  // Nin's launcher. A pilot called Nin asked for this every day until it existed. It is the most
  // expensive thing in the armoury on purpose: one rocket, a long reload, and it has to be earned.
  // The rocket is a real projectile on the server (room.js `stepRockets`), not a hitscan.
  nin: {
    id: 'nin', sight: 'iron', slot: 'primary', family: 'launcher', short: 'NIN', name: 'Nin Launcher', tag: 'ROCKET LAUNCHER', cost: 7200,
    damage: 55, head: 1, limb: 1, armorPen: 0.5, pen: 0.2,
    mag: 1, reserve: 3, cooldown: 1.1, reload: 6.4, equip: 1.4,
    auto: false, pellets: 1, scope: [52], scopeTime: 0.34,
    spread: { hip: 2.2, ads: 0.5, move: 1.6, air: 4, bloom: 0, bloomMax: 0 },
    falloff: null, recoil: { kick: 5.2, side: 1.2, recover: 4 }, speed: 0.78, loud: 120, tracer: 0,
    // The rocket itself: how fast it flies, and what the blast does where it lands.
    rocket: { speed: 46, gravity: 2.6, radius: 6.4, damage: 118, minDamage: 26, selfScale: 0.55, armorPen: 0.55 },
    noMods: true,
  },
  knife: {
    id: 'knife', slot: 'melee', family: 'melee', short: 'BLADE', name: 'Kestrel Blade', tag: 'MELEE', cost: 0,
    damage: 55, backstab: 200, range: 2.3, cooldown: 0.62, equip: 0.25,
    melee: true, speed: 1.14, loud: 0,
  },
};
// Username + password accounts. Switched off until the game moves to its real servers:
// pilots play as guests with a callsign, and progress stays tied to their browser.
// Flip to true to bring back login and sign-up (server/accounts.js keeps working either way).
export const ACCOUNTS_ENABLED = false;
// Discord application that pilots log in through. This is the app's public Application ID (Developer
// Portal → General Information). Safe to commit, unlike the client secret or bot token, which go in .env.
export const DISCORD_CLIENT_ID = '1550238088758825050';
// Community server. Logging in with Discord adds pilots to it; this link is for everyone else.
export const DISCORD_INVITE = 'https://discord.com/invite/2K2XJQK9yd';
export const TIKTOK_URL = 'https://www.tiktok.com/@krosshair.online';

// Sight types (weapon.sight): scope = full scope overlay, prism = magnified lens, dot = red dot,
// holo = holographic window, iron = iron sights on the model, bead = shotgun bead.
// How the armoury groups weapons, in display order.
export const WEAPON_CLASSES = [
  { id: 'long', name: 'Long range', families: ['sniper', 'marksman'] },
  { id: 'rifle', name: 'Rifles', families: ['rifle', 'lmg'] },
  { id: 'heavy', name: 'Heavy', families: ['launcher'] },
  { id: 'close', name: 'Close quarters', families: ['smg', 'shotgun'] },
  { id: 'sidearm', name: 'Sidearms', slot: 'sidearm' },
];
export function weaponClass(weapon) { return WEAPON_CLASSES.find((c) => (c.slot ? weapon.slot === c.slot : weapon.slot === 'primary' && c.families.includes(weapon.family)))?.id || 'long'; }
export const DEFAULT_LOADOUT = { primary: 'm44', sidearm: 'p9', melee: 'knife' };
export const SLOT_ORDER = ['primary', 'sidearm', 'melee'];

export const ARMOR = {
  light: { id: 'light', name: 'Light Vest', cost: 400, points: 50, desc: '50 armour. Survives one M-44 body shot.' },
  heavy: { id: 'heavy', name: 'Heavy Plate', cost: 900, points: 100, desc: '100 armour. Lasts the fight.' },
  helmet: { id: 'helmet', name: 'Ballistic Helmet', cost: 350, desc: '35% less headshot damage. Breaks after one hit.' },
};
export const ARMOR_ABSORB = 0.42;
export const HELMET_FACTOR = 0.65;

export const GADGETS = {
  pulse: { id: 'pulse', name: 'Radar Pulse', cost: 300, icon: '◎', desc: 'Reveals enemies within 45 m for 3.5 s.', radius: 45, duration: 3.5 },
  drone: { id: 'drone', name: 'Recon Drone', cost: 450, icon: '✣', desc: 'Fly it for 12 s. Marks every enemy it sees.', duration: 12, range: 42, hp: 25 },
  decoy: { id: 'decoy', name: 'Decoy Hologram', cost: 200, icon: '◈', desc: 'A fake you, running ahead. Whoever shoots it gets marked.', duration: 8, markTime: 4 },
  shield: { id: 'shield', name: 'Deploy Shield', cost: 350, icon: '▮', desc: 'Bulletproof cover. 350 HP. Lasts the round.', hp: 350, width: 2.4, height: 1.55, depth: 0.25 },
  ghost: { id: 'ghost', name: 'Silent Step', cost: 250, icon: '〰', desc: '15 s of silent movement.', duration: 15 },
  stim: { id: 'stim', name: 'Field Stim', cost: 300, icon: '✚', desc: '+50 health over 5 s. Once per round.', heal: 50, duration: 5 },
};
export const GADGET_SLOTS = 2;

export const ECONOMY = {
  start: 800, max: 9000, win: 2100, loss: 1300, lossStreak: 350, lossStreakMax: 3,
  kill: 300, headshot: 100, assist: 100,
};

export const DEFAULT_RULES = {
  roundsToWin: 5,
  roundTime: 100,
  buyTime: 12,
  firstBuyTime: 16,
  overtime: 35,
  roundEndTime: 9,
  matchEndTime: 32,
  startCredits: ECONOMY.start,
  variant: 'auto',
  modifier: 'standard',
  friendlyFire: false,
  botDifficulty: 'veteran',
  swapSides: true,
};
export const MODIFIERS = {
  standard: { name: 'Standard', desc: 'Best of nine. One life. Buy between rounds.' },
  headhunter: { name: 'Headhunter', desc: 'Only headshots deal damage.' },
  instagib: { name: 'One Tap', desc: 'Every hit is lethal. No armour.' },
  lowgrav: { name: 'Low Orbit', desc: 'A third of the gravity. Rooftops are for everyone.' },
  sidearms: { name: 'Sidearms Only', desc: 'Pistols, revolvers and blades only.' },
  snipers: { name: 'Snipers Only', desc: 'Bolt-actions and marksman rifles. Nothing else.', families: ['sniper', 'marksman'] },
  closequarters: { name: 'Close Quarters', desc: 'Shotguns and submachine guns. Get in their face.', families: ['smg', 'shotgun'] },
  chamber: { name: 'One in the Chamber', desc: 'One round, one life. Every kill loads another.', fixed: true },
  gungame: { name: 'Gun Game', desc: 'Every kill moves you up the ladder. Finish it to take the round.', fixed: true },
};
// Gun Game: the ladder, easiest to hardest. Finish the last one and the round is yours.
export const GUN_LADDER = ['wasp', 'breaker', 'talon', 'hornet', 'ronin', 'halcyon', 'maul', 'anvil', 'recon', 'vesper', 'm44', 'harbinger', 'pike', 'viper', 'sawn', 'p9'];
// One in the Chamber: a revolver with a single round, and a blade for when it is gone.
export const CHAMBER = { sidearm: 'viper', mag: 1 };
export const VARIANTS = ['dusk', 'night', 'storm', 'noon'];
export const VARIANT_NAMES = { dusk: 'Dusk', night: 'Night Fog', storm: 'Storm Front', noon: 'High Noon', snow: 'Whiteout', haze: 'Dust Haze' };
// A level is a centre point, not a spec: every bot rolls its own personality around it (server/bots.js),
// so three Veterans are three different players. reaction/aimTime in seconds, error in degrees.
export const BOT_DIFFICULTY = {
  recruit: { name: 'Recruit', reaction: 1.1, aimTime: 1.15, error: 2.5, headBias: 0.04, fov: 90 },
  veteran: { name: 'Veteran', reaction: 0.75, aimTime: 0.85, error: 1.4, headBias: 0.12, fov: 105 },
  elite: { name: 'Elite', reaction: 0.48, aimTime: 0.55, error: 0.85, headBias: 0.25, fov: 118 },
};
// Bot personalities. Each one bends the bot's own traits and what it buys, so a Rusher really does
// run at you with a short gun and a Sniper really does sit on a long angle. Skill still comes from the
// difficulty; this is temperament.
// Killstreaks. Kills in a row without dying, counted across the whole match. Each one is a small help
// the moment you earn it, never a kill from nowhere: the game stays about the shot you take.
export const KILLSTREAKS = [
  { at: 3, id: 'spotter', name: 'Spotter', desc: 'Every enemy marked for 4 seconds.', reveal: 4 },
  { at: 5, id: 'resupply', name: 'Resupply', desc: 'Magazines full, armour patched.', ammo: true, armor: 50 },
  { at: 7, id: 'ghost', name: 'Silent Step', desc: '20 seconds of silent movement.', ghost: 20 },
  { at: 10, id: 'overwatch', name: 'Overwatch', desc: 'Marked enemies, full health, full ammo.', reveal: 6, ammo: true, heal: true },
];
export const streakAt = (kills) => KILLSTREAKS.find((streak) => streak.at === kills) || null;

export const BOT_TYPES = {
  allround: { id: 'allround', name: 'All-round', desc: 'Plays it straight.', weight: 26, traits: {} },
  rusher: { id: 'rusher', name: 'Rusher', desc: 'Runs at you with a short gun.', weight: 18,
    traits: { aggression: 0.92, patience: 0.12, pace: 1.12, croucher: 0.15, dancer: 0.8 }, guns: [['wasp', 0.3], ['hornet', 0.26], ['breaker', 0.2], ['talon', 0.24]] },
  sniper: { id: 'sniper', name: 'Sniper', desc: 'Holds a long angle and waits.', weight: 16,
    traits: { aggression: 0.1, patience: 0.92, pace: 0.94, croucher: 0.7, trigger: 1.35 }, guns: [['harbinger', 0.22], ['vesper', 0.34], ['recon', 0.28], ['m44', 0.16]] },
  flanker: { id: 'flanker', name: 'Flanker', desc: 'Comes the long way round.', weight: 14,
    traits: { aggression: 0.68, patience: 0.35, curiosity: 1.45, pace: 1.06, dancer: 0.6 }, guns: [['ronin', 0.3], ['talon', 0.28], ['wasp', 0.22], ['halcyon', 0.2]] },
  anchor: { id: 'anchor', name: 'Anchor', desc: 'Sits on a spot and holds it.', weight: 14,
    traits: { aggression: 0.22, patience: 0.8, croucher: 0.85, pace: 0.9 }, guns: [['anvil', 0.26], ['halcyon', 0.3], ['recon', 0.24], ['maul', 0.2]] },
  duelist: { id: 'duelist', name: 'Duelist', desc: 'Takes the fight head on and strafes.', weight: 12,
    traits: { aggression: 0.75, patience: 0.3, dancer: 0.95, croucher: 0.2, composure: 0.85 }, guns: [['talon', 0.3], ['halcyon', 0.26], ['ronin', 0.24], ['hornet', 0.2]] },
};
export const BOT_TYPE_IDS = Object.keys(BOT_TYPES);
// Matchmaking with a fixed team size. Bots fill whatever a lobby is short of.
export const TEAM_MODES = {
  '1v1': { id: '1v1', size: 1, name: 'Duel', desc: 'One on one. No hiding behind a team.' },
  '2v2': { id: '2v2', size: 2, name: 'Duos', desc: 'Two a side. One partner, one plan.' },
  '3v3': { id: '3v3', size: 3, name: 'Trios', desc: 'Three a side. Room to take an angle.' },
  '5v5': { id: '5v5', size: 5, name: 'Squads', desc: 'Five a side. Hold a site, take a site.' },
};
export const TEAM_MODE_IDS = Object.keys(TEAM_MODES);
// Ranked plays the same sizes, for a rating. Each size queues on its own so a duel never waits on a squad.
export const RANKED_SIZES = ['1v1', '2v2', '3v3', '5v5'];
export const RANKED_MODES = Object.fromEntries(RANKED_SIZES.map((size) => [`ranked-${size}`, { id: `ranked-${size}`, size: TEAM_MODES[size].size, name: TEAM_MODES[size].name, desc: TEAM_MODES[size].desc }]));
export const RANKED_IDS = Object.keys(RANKED_MODES);
// 'ranked' on its own is the old open queue, kept so a client running older code still finds a match.
export const RANKED_QUEUES = ['ranked', ...RANKED_IDS];
export const isRanked = (queue) => RANKED_QUEUES.includes(queue);
export const teamSizeOf = (queue) => TEAM_MODES[queue]?.size || RANKED_MODES[queue]?.size || 0;

// Handles in the styles real pilots pick: short words, a name with a number, an underscore or a dot, the
// odd clan tag. The lobby, the scoreboard and their chat already say these are bots, so the names never do.
// A name already taken in the room is skipped (server/bots.js).
export const BOT_NAMES = [
  'Mako', 'Juno', 'Rook', 'Sable', 'Onyx', 'Piper', 'Flint', 'Marrow', 'Quill', 'Basil',
  'Nova', 'Wren', 'Tundra', 'Echo', 'Vexx', 'Kade', 'Nyx', 'Dizzy', 'Grim', 'Pyro',
  'Wisp', 'Cobalt', 'Dash', 'Havoc', 'Moss', 'Draco', 'Bex', 'Hollow', 'Ash', 'Voss',
  'Kira', 'Dez', 'Omen', 'Riven', 'Syx', 'Bolt', 'Creed', 'Ember', 'Fitz', 'Gizmo',
  'Haze', 'Iggy', 'Jinx', 'Kelp', 'Lurk', 'Noodle', 'Opal', 'Prowl', 'Quartz', 'Rumble',
  'Slate', 'Tally', 'Umber', 'Vance', 'Wolfie', 'Yuki', 'Zen', 'Bandit', 'Cinder', 'Pixel',
  'Milo42', 'Zed07', 'Nico_9', 'Kaden99', 'jonas_7', 'ryan_21', 'sam.k', 'ryn.exe', 'jayden04', 'snipes88',
  'lil_reaper', 'lowkey', 'crispy', 'toaster', 'm1lk', 'wavy', 'sleepy_j', 'big.tuna', 'pixel_j', 'zappy',
  'TTV_Kane', 'ttv.mozz', 'FZE_Lynx', 'NRG.Skye', 'RVN_Dusty', 'xX_Rook_Xx',
  'Talon9', 'Vix', 'Drexx', 'Sunny', 'Rook_7', 'Marlow', 'Kestrel', 'Vega', 'Juniper', 'Sorrel',
  'Bram', 'Cassia', 'Dune', 'Fennec', 'Gale', 'Halo_x', 'Indigo', 'Jett', 'Koa', 'Larkin',
  'Mira', 'Norrix', 'Otter', 'Peregrine', 'Quinn', 'Rio', 'Sage_v', 'Tobin', 'Ulla', 'Vesper_k',
  'Wilder', 'Xan', 'Yarrow', 'Zephyr', 'Briar', 'Corvus', 'Delta_9', 'Espen', 'Fable', 'Gideon',
  'Hux', 'Ivo', 'Jorah', 'Kell', 'Lumen', 'Mox', 'Nero', 'Osprey', 'Pike_3', 'Quiver',
  'Rell', 'Sparrow', 'Thorne', 'Ursa', 'Vale', 'Wex', 'Yara', 'Zia', 'Aspen', 'Bodhi',
  'Cricket', 'Dov', 'Elm', 'Fox_e', 'Gully', 'Hollis', 'Ives', 'Jubi', 'Kestra', 'Lomax',
  'Mercer', 'Nash', 'Orin', 'Plover', 'Ripley', 'Sten', 'Tavi', 'Uzo', 'Vann', 'Wrenley',
  'Yates', 'Zuri', 'Ferro', 'Hatch', 'Mallow', 'Quip', 'Rusk', 'Tamsin', 'Vireo', 'Wold',
  'ace_09', 'blitz22', 'coop_14', 'dax77', 'eli.j', 'frostyK', 'gus_01', 'hexa5', 'ivyjo', 'jak_11',
  'kit90', 'loz_8', 'max.v', 'nedd', 'nim_3', 'ozzy12', 'pax_04', 'quill7', 'raf.k', 'sid_66',
  'tox9', 'uri_5', 'vik.t', 'wisp_2', 'yolo_j', 'zeke31', 'andi_7', 'bexx_9', 'cade.m', 'dune42',
  'finn_23', 'gabe.x', 'hollyK', 'ines_4', 'jonty', 'kayo_8', 'lena.r', 'moz_15', 'nori_6', 'obi_20',
  'remy.j', 'saff_3', 'toby_18', 'uma_9', 'vinnie', 'wil.k', 'yusef', 'zara_5', 'dom_44', 'esme7',
  'lazy_cat', 'sleepywolf', 'crunchy', 'fizzy', 'noodlearm', 'pocket.rocket', 'static.j', 'tinman', 'two.left.feet', 'velvet',
  'whisker', 'yolo.k', 'zigzag', 'cloudy', 'dusty_pan', 'gravy_train', 'jellyfish', 'kiwi_bird', 'lamp_post', 'mango.j',
  'neon_owl', 'oats', 'pebble', 'quiet.storm', 'rusty_nail', 'salty_fry', 'tofu', 'umbrella', 'vhs_tape', 'waffles',
  'xerox', 'yawn', 'zippy', 'blank_page', 'cardboard', 'donut.king', 'eggshell', 'flatpack', 'ghosted', 'hiccup',
  'TTV_Nyx', 'ttv.rell', 'FZE_Storm', 'NRG.Vale', 'RVN_Kite', 'xX_Nyx_Xx', 'VLT_Sage', 'AKM_Juno', 'EXO.Wren', 'SGX_Pike',
  'Dagger', 'Falcon_2', 'Ghost_9', 'Hunter_x', 'Ironsight', 'Jackal', 'Longshot_j', 'Maverick', 'Nomad_7', 'Overwatch_k',
];

export const QUICK_COMMANDS = [
  { id: 'push', text: 'Pushing now', voice: 'Pushing' },
  { id: 'hold', text: 'Hold this angle', voice: 'Holding' },
  { id: 'help', text: 'Need backup', voice: 'Need backup' },
  { id: 'spotted', text: 'Enemy spotted', voice: 'Contact' },
  { id: 'nice', text: 'Nice shot', voice: 'Nice shot' },
  { id: 'sorry', text: 'My bad', voice: 'Sorry' },
];
export const REACTIONS = ['👏', '😮', '🔥', '💀', '🎯', '😂'];

// Progression -----------------------------------------------------------
export function xpForLevel(level) { return 350 * (level - 1) * level; }
export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level += 1;
  return level;
}
// Ranked ladder. Six tiers of three divisions (Apex is one open-ended tier), cut from skill rating.
// A pilot has no rank until the placement matches are played; those move the rating twice as far.
export const PLACEMENT_MATCHES = 5;
export const RANK_TIERS = [
  { id: 'bronze', name: 'Bronze', min: 950, color: '#c7875a' },
  { id: 'silver', name: 'Silver', min: 1100, color: '#c3ced8' },
  { id: 'gold', name: 'Gold', min: 1250, color: '#f2c14e' },
  { id: 'platinum', name: 'Platinum', min: 1400, color: '#6ce6d1' },
  { id: 'diamond', name: 'Diamond', min: 1600, color: '#8fb4ff' },
  { id: 'apex', name: 'Apex', min: 1850, color: '#ff5a6e' },
];
const DIVISIONS = ['III', 'II', 'I'];
// Everything the menus need to draw a rank: tier, division, how far into it, and what comes next.
// `step` orders ranks (0 = Bronze III … 15 = Apex) so promotions and demotions can be told apart.
export function rankInfo(rating, rankedMatches = PLACEMENT_MATCHES) {
  const sr = Math.round(rating);
  if (rankedMatches < PLACEMENT_MATCHES) return { placed: false, name: 'Unranked', tier: null, color: '#7d8a96', step: -1, rating: sr, placement: { played: rankedMatches, total: PLACEMENT_MATCHES } };
  let t = 0;
  RANK_TIERS.forEach((tier, index) => { if (sr >= tier.min) t = index; });
  const tier = RANK_TIERS[t], next = RANK_TIERS[t + 1];
  if (!next) return { placed: true, name: tier.name, tier: tier.id, color: tier.color, division: null, step: t * 3, rating: sr, progress: 1, next: null };
  const width = (next.min - tier.min) / 3;
  const d = Math.max(0, Math.min(2, Math.floor((sr - tier.min) / width)));
  const floor = tier.min + d * width, ceiling = floor + width;
  const progress = sr < tier.min ? 0 : Math.min(1, (sr - floor) / width);
  return {
    placed: true, name: `${tier.name} ${DIVISIONS[d]}`, tier: tier.id, color: tier.color, division: DIVISIONS[d], step: t * 3 + d, rating: sr, progress,
    next: d < 2 ? `${tier.name} ${DIVISIONS[d + 1]}` : next.id === 'apex' ? 'Apex' : `${next.name} III`, toNext: Math.max(0, Math.ceil(ceiling - sr)),
  };
}
export function rankName(rating, rankedMatches) { return rankInfo(rating, rankedMatches).name; }
export const MASTERY_TIERS = [[0, 'Unproven'], [10, 'Bronze'], [40, 'Silver'], [120, 'Gold'], [300, 'Obsidian']];
export function masteryTier(kills) {
  let tier = 0;
  MASTERY_TIERS.forEach(([min], index) => { if (kills >= min) tier = index; });
  return tier;
}

export const COSMETICS = {
  // `level` unlocks with XP; `price` is bought once with coins; `dev` items belong to the developers'
  // accounts only and are never listed anywhere else.
  suit: [
    { id: '#ec6a9e', name: 'Coral', level: 1 }, { id: '#6ce6d1', name: 'Mint', level: 1 },
    { id: '#ffc857', name: 'Gold', level: 1 }, { id: '#8fa7ff', name: 'Blue', level: 1 },
    { id: '#f2f0ea', name: 'Bone', level: 3 }, { id: '#9d6bff', name: 'Violet', level: 5 },
    { id: '#ff4d4d', name: 'Signal Red', level: 8 }, { id: '#1d242c', name: 'Blackout', level: 12 },
    { id: '#5d6b3a', name: 'Olive', price: 300 }, { id: '#c2a36b', name: 'Sand', price: 300 },
    { id: '#2c3e66', name: 'Navy', price: 300 }, { id: '#7a1d2b', name: 'Oxblood', price: 450 },
    { id: '#ff8a1f', name: 'Blaze', price: 450 }, { id: '#39ff88', name: 'Acid', price: 600 },
    { id: '#ff4fd8', name: 'Hot Pink', price: 600 }, { id: '#ffffff', name: 'Arctic White', price: 800 },
    { id: '#0b0b0e', name: 'Void Black', price: 1200 },
    { id: '#3a3d42', name: 'Charcoal', price: 350 }, { id: '#2f4a2a', name: 'Forest', price: 400 },
    { id: '#1f8a8a', name: 'Teal', price: 400 }, { id: '#b3122e', name: 'Crimson', price: 450 },
    { id: '#b8a4e3', name: 'Lavender', price: 450 }, { id: '#d9a21f', name: 'Mustard', price: 450 },
    { id: '#7cc4ff', name: 'Sky', price: 500 }, { id: '#ff6a2a', name: 'Tangerine', price: 600 },
    { id: '#bfe8ff', name: 'Ice', price: 700 }, { id: '#e0a48f', name: 'Rose Gold', price: 900 },
    { id: '#04150f', name: 'Dev Void', dev: true }, { id: '#2b0f3a', name: 'Dev Violet', dev: true },
  ],
  visor: [
    { id: '#6ce6d1', name: 'Mint', level: 1 }, { id: '#ff7148', name: 'Orange', level: 1 },
    { id: '#ffc857', name: 'Gold', level: 1 }, { id: '#ec6a9e', name: 'Coral', level: 4 },
    { id: '#9d6bff', name: 'Violet', level: 7 }, { id: '#ffffff', name: 'Arc White', level: 10 },
    { id: '#ff2a2a', name: 'Red Alert', price: 400 }, { id: '#39ff88', name: 'Night Vision', price: 400 },
    { id: '#3fa9ff', name: 'Ice', price: 400 }, { id: '#ff4fd8', name: 'Magenta', price: 600 },
    { id: '#fff36a', name: 'Sodium', price: 600 },
    { id: '#00ffc6', name: 'Aqua', price: 450 }, { id: '#ff9a3a', name: 'Amber', price: 450 },
    { id: '#ffd1a3', name: 'Peach', price: 450 }, { id: '#b0ff3a', name: 'Lime', price: 500 },
    { id: '#ff3a8a', name: 'Rose', price: 500 }, { id: '#40ffff', name: 'Cyan', price: 500 },
    { id: '#7a5cff', name: 'Indigo', price: 600 }, { id: '#e8e8e8', name: 'Chrome', price: 700 },
    { id: '#7cffe8', name: 'Dev Glow', dev: true }, { id: '#ff2fd0', name: 'Dev Magenta', dev: true },
  ],
  tracer: [
    { id: '#ffc857', name: 'Brass', level: 1 }, { id: '#6ce6d1', name: 'Mint', level: 2 },
    { id: '#ec6a9e', name: 'Coral', level: 6 }, { id: '#9d6bff', name: 'Violet', level: 9 },
    { id: '#ffffff', name: 'Arc White', level: 14 },
    { id: '#ff2a2a', name: 'Crimson', price: 500 }, { id: '#39ff88', name: 'Toxic', price: 500 },
    { id: '#3fa9ff', name: 'Plasma', price: 700 }, { id: '#ff4fd8', name: 'Neon Pink', price: 700 },
    { id: '#ff8a1f', name: 'Ember', price: 900 },
    { id: '#00ffc6', name: 'Aqua', price: 600 }, { id: '#b0ff3a', name: 'Lime', price: 600 },
    { id: '#ffd1a3', name: 'Peach', price: 600 }, { id: '#40ffff', name: 'Cyan', price: 700 },
    { id: '#7a5cff', name: 'Indigo', price: 800 }, { id: '#ff3a8a', name: 'Rose', price: 800 },
    { id: '#ffe14d', name: 'Sunburst', price: 900 }, { id: '#c8b6ff', name: 'Lilac', price: 900 },
    { id: 'devprism', name: 'Prism Rail', dev: true },
  ],
  title: [
    { id: 'Recruit', name: 'Recruit', level: 1 }, { id: 'Marksman', name: 'Marksman', level: 2 },
    { id: 'Overwatch', name: 'Overwatch', level: 4 }, { id: 'Ghost', name: 'Ghost', level: 6 },
    { id: 'Deadeye', name: 'Deadeye', level: 9 }, { id: 'Longshot', name: 'Longshot', level: 12 },
    { id: 'Kestrel', name: 'Kestrel', level: 16 }, { id: 'Apex', name: 'Apex', level: 20 },
    { id: 'Night Owl', name: 'Night Owl', price: 500 }, { id: 'Wallbanger', name: 'Wallbanger', price: 800 },
    { id: 'Headhunter', name: 'Headhunter', price: 1200 }, { id: 'High Roller', name: 'High Roller', price: 2000 },
    { id: 'Untouchable', name: 'Untouchable', price: 3500 }, { id: 'Legend', name: 'Legend', price: 7500 },
    { id: 'Sharpshooter', name: 'Sharpshooter', level: 25 }, { id: 'Veteran', name: 'Veteran', level: 30 },
    { id: 'Phantom', name: 'Phantom', level: 40 }, { id: 'Mythic', name: 'Mythic', level: 50 },
    { id: 'Camper', name: 'Camper', price: 600 }, { id: 'Tactician', name: 'Tactician', price: 900 },
    { id: 'Menace', name: 'Menace', price: 1000 }, { id: 'Glass Cannon', name: 'Glass Cannon', price: 1200 },
    { id: 'Storm Chaser', name: 'Storm Chaser', price: 1400 }, { id: 'One Tap', name: 'One Tap', price: 1500 },
    { id: 'No Scope', name: 'No Scope', price: 1800 }, { id: 'Unboxer', name: 'Unboxer', price: 2200 },
    { id: 'Clutch King', name: 'Clutch King', price: 2500 }, { id: 'Coin Goblin', name: 'Coin Goblin', price: 3000 },
    { id: 'Warlord', name: 'Warlord', price: 5000 }, { id: 'Big Spender', name: 'Big Spender', price: 10000 },
    { id: 'Developer', name: 'Developer', dev: true }, { id: 'Founder', name: 'Founder', dev: true },
    { id: 'Architect', name: 'Architect', dev: true }, { id: 'Root', name: 'Root', dev: true },
  ],
  headgear: [
    { id: 'helmet', name: 'Combat helmet', level: 1 }, { id: 'cap', name: 'Field cap', level: 1 },
    { id: 'beanie', name: 'Beanie', level: 3 }, { id: 'bare', name: 'Bare head', level: 5 },
    { id: 'boonie', name: 'Boonie hat', price: 400 }, { id: 'bandana', name: 'Bandana', price: 400 },
    { id: 'hood', name: 'Hood', price: 600 }, { id: 'headset', name: 'Comms headset', price: 700 },
    { id: 'beret', name: 'Beret', price: 900 }, { id: 'nvg', name: 'Night vision', price: 1800 },
    { id: 'crown', name: 'Crown', price: 8000 },
    { id: 'hardhat', name: 'Hard hat', price: 600 }, { id: 'cowboy', name: 'Cowboy hat', price: 1400 },
    { id: 'mohawk', name: 'Mohawk', price: 1600 }, { id: 'tophat', name: 'Top hat', price: 2200 },
    { id: 'viking', name: 'Viking helm', price: 3500 }, { id: 'wizard', name: 'Wizard hat', price: 4500 },
    { id: 'kabuto', name: 'Kabuto', price: 6000 }, { id: 'bubble', name: 'Space helmet', price: 7000 },
    { id: 'devhalo', name: 'Dev halo', dev: true }, { id: 'devcrown', name: 'Root crown', dev: true },
  ],
  face: [
    { id: 'visor', name: 'Visor', level: 1 }, { id: 'none', name: 'Balaclava', level: 1 },
    { id: 'goggles', name: 'Goggles', level: 2 }, { id: 'shades', name: 'Shades', price: 500 },
    { id: 'scarf', name: 'Face scarf', price: 600 }, { id: 'respirator', name: 'Respirator', price: 900 },
    { id: 'gasmask', name: 'Gas mask', price: 1200 }, { id: 'skull', name: 'Skull mask', price: 2500 },
    { id: 'cyber', name: 'Cyber visor', price: 4000 },
    { id: 'bandit', name: 'Bandit mask', price: 700 }, { id: 'aviators', name: 'Aviators', price: 800 },
    { id: 'monocle', name: 'Monocle', price: 1500 }, { id: 'hockey', name: 'Hockey mask', price: 1800 },
    { id: 'oni', name: 'Oni mask', price: 5000 }, { id: 'plague', name: 'Plague mask', price: 6500 },
    { id: 'devmask', name: 'Pixel mask', dev: true }, { id: 'devscan', name: 'Scanner visor', dev: true },
  ],
  pack: [
    { id: 'radio', name: 'Radio pack', level: 1 }, { id: 'none', name: 'No pack', level: 1 },
    { id: 'rucksack', name: 'Rucksack', level: 4 }, { id: 'sling', name: 'Sling bag', price: 400 },
    { id: 'parachute', name: 'Parachute', price: 900 }, { id: 'katana', name: 'Katana', price: 2500 },
    { id: 'jetpack', name: 'Jetpack', price: 5000 },
    { id: 'scuba', name: 'Scuba tanks', price: 1200 }, { id: 'quiver', name: 'Quiver', price: 1600 },
    { id: 'riot', name: 'Riot shield', price: 2000 }, { id: 'banner', name: 'War banner', price: 2800 },
    { id: 'cape', name: 'Cape', price: 3000 }, { id: 'greatsword', name: 'Greatsword', price: 6000 },
    { id: 'devwings', name: 'Data wings', dev: true }, { id: 'devorbit', name: 'Orbit pack', dev: true },
  ],
  pattern: [
    { id: 'solid', name: 'Solid', level: 1 }, { id: 'stripes', name: 'Stripes', level: 6 },
    { id: 'woodland', name: 'Woodland', price: 500 }, { id: 'urban', name: 'Urban', price: 500 },
    { id: 'flecktarn', name: 'Flecktarn', price: 700 }, { id: 'digital', name: 'Digital', price: 800 },
    { id: 'splinter', name: 'Splinter', price: 900 }, { id: 'tiger', name: 'Tiger stripe', price: 1100 },
    { id: 'hex', name: 'Hex', price: 1500 },
    { id: 'multicam', name: 'Multicam', price: 700 }, { id: 'chevron', name: 'Chevron', price: 900 },
    { id: 'topo', name: 'Topo', price: 1100 }, { id: 'honeycomb', name: 'Honeycomb', price: 1200 },
    { id: 'dazzle', name: 'Dazzle', price: 1600 }, { id: 'scales', name: 'Scales', price: 2000 },
    { id: 'devcircuit', name: 'Dev circuit', dev: true }, { id: 'devmatrix', name: 'Dev rain', dev: true },
  ],
  // Hangs off the side of your gun on a chain. It swings with recoil, reloads and every move you make.
  // The models are in client/charms.js: every id here needs a maker there.
  charm: [
    { id: 'none', name: 'None', level: 1 }, { id: 'tag', name: 'Dog tag', level: 3 }, { id: 'bullet', name: 'Bullet', level: 6 }, { id: 'clover', name: 'Clover', level: 12 },
    { id: 'dice', name: 'Lucky dice', price: 500 }, { id: 'key', name: 'Spare key', price: 500 }, { id: 'feather', name: 'Feather', price: 500 }, { id: 'cherry', name: 'Cherries', price: 600 },
    { id: 'star', name: 'Star', price: 900 }, { id: 'skull', name: 'Skull', price: 900 }, { id: 'horseshoe', name: 'Horseshoe', price: 900 }, { id: 'mushroom', name: 'Mushroom', price: 900 },
    { id: 'anchor', name: 'Anchor', price: 1200 }, { id: 'padlock', name: 'Padlock', price: 1200 }, { id: 'eightball', name: '8 ball', price: 1200 }, { id: 'duck', name: 'Rubber duck', price: 1500 },
    { id: 'coin', name: 'Krosshair coin', price: 1500 }, { id: 'heart', name: 'Heart', price: 1500 }, { id: 'grenade', name: 'Grenade', price: 1800 }, { id: 'ghost', name: 'Ghost', price: 1800 },
    { id: 'moon', name: 'Crescent', price: 2200 }, { id: 'bolt', name: 'Lightning', price: 2200 }, { id: 'shuriken', name: 'Shuriken', price: 2500 }, { id: 'reticle', name: 'Krosshair', price: 2500 },
    { id: 'flame', name: 'Flame', price: 3000 }, { id: 'd20', name: 'D20', price: 3000 }, { id: 'planet', name: 'Ringed planet', price: 3500 }, { id: 'diamond', name: 'Diamond', price: 4000 },
    { id: 'ufo', name: 'UFO', price: 5000 }, { id: 'crown', name: 'Crown', price: 6000 },
    { id: 'donut', name: 'Donut', price: 800 }, { id: 'pizza', name: 'Pizza slice', price: 900 }, { id: 'pumpkin', name: 'Pumpkin', price: 1000 }, { id: 'snowflake', name: 'Snowflake', price: 1200 },
    { id: 'cube', name: 'Puzzle cube', price: 1500 }, { id: 'gamepad', name: 'Gamepad', price: 1600 }, { id: 'cat', name: 'Cat', price: 1800 }, { id: 'bomb', name: 'Cartoon bomb', price: 2000 },
    { id: 'rocket', name: 'Rocket', price: 2200 }, { id: 'medal', name: 'Medal', price: 2500 }, { id: 'trophy', name: 'Trophy', price: 3500 }, { id: 'emerald', name: 'Emerald', price: 4500 },
    { id: 'devcore', name: 'Dev core', dev: true }, { id: 'devkey', name: 'Root key', dev: true },
  ],
};
export const DEFAULT_LOOK = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit', headgear: 'helmet', face: 'visor', pack: 'radio', pattern: 'solid', charm: 'none', skins: {} };
// owned: the pilot's bought items as 'kind:id' strings.
export function cosmeticUnlocked(kind, id, level, owned = [], dev = false) {
  const item = COSMETICS[kind]?.find((entry) => entry.id === id);
  if (!item) return false;
  if (item.dev) return Boolean(dev);
  // Item Shop pieces have no price and no level: being there on the day is the only way in.
  if (item.shop === 'item') return owned.includes(`${kind}:${id}`);
  return item.price ? owned.includes(`${kind}:${id}`) : level >= item.level;
}
// The developers' own class. Items in it can't be bought, won or traded.
export const DEV_CLASS = { id: 'dev', name: 'Dev', color: '#00ffc6', blurb: 'Dev only. Nobody else can get this.' };

export const CONTRACTS = [
  { id: 'kills', text: 'Get {n} kills', n: 12, xp: 300 },
  { id: 'headshots', text: 'Get {n} headshot kills', n: 5, xp: 350 },
  { id: 'rounds', text: 'Win {n} rounds', n: 8, xp: 300 },
  { id: 'wins', text: 'Win {n} match{es}', n: 2, xp: 450 },
  { id: 'damage', text: 'Deal {n} damage', n: 1500, xp: 300 },
  { id: 'longshots', text: 'Get {n} kills over 50 m', n: 3, xp: 400 },
  { id: 'wallbangs', text: 'Get {n} wallbang kills', n: 2, xp: 450 },
  { id: 'knife', text: 'Get {n} blade kill{s}', n: 1, xp: 400 },
  { id: 'sidearm', text: 'Get {n} sidearm kills', n: 4, xp: 350 },
  { id: 'gadgets', text: 'Use {n} gadgets', n: 6, xp: 250 },
  { id: 'clutches', text: 'Win {n} clutch{es}', n: 1, xp: 450 },
  { id: 'matches', text: 'Finish {n} match{es}', n: 3, xp: 250 },
];
// Deterministic daily pick so every pilot sees the same board.
// Contract text: {n} is the target, {s} and {es} pluralise the word before them.
export function contractText(contract) { return contract.text.replace('{n}', contract.n).replace('{s}', contract.n === 1 ? '' : 's').replace('{es}', contract.n === 1 ? '' : 'es'); }
export function dailyContracts(dateKey) {
  let seed = 0;
  for (const char of dateKey) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const pool = [...CONTRACTS];
  const picked = [];
  while (picked.length < 3) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return picked;
}
export function dailyModifier(dateKey) {
  const options = ['headhunter', 'instagib', 'lowgrav', 'sidearms', 'snipers', 'closequarters', 'chamber', 'gungame'];
  let seed = 7;
  for (const char of dateKey) seed = (seed * 33 + char.charCodeAt(0)) >>> 0;
  return options[seed % options.length];
}
export function dateKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

// Flags packed into snapshots.
export const FLAG = { crouch: 1, scoped: 2, ground: 4, ghost: 8, reloading: 16, walking: 32, piloting: 64 };

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
