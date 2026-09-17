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
  runSpeed: 6.0,
  walkSpeed: 3.1,
  crouchSpeed: 2.3,
  jumpVelocity: 5.7,
  gravity: 15,
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
    id: 'recon', sight: 'prism', slot: 'primary', family: 'marksman', short: 'RC-9', sway: 0.7, name: 'RC-9 Recon', tag: 'SEMI-AUTO MARKSMAN', cost: 1700,
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
    id: 'wasp', sight: 'dot', slot: 'primary', family: 'smg', short: 'WASP-9', name: 'Wasp-9', tag: 'SUBMACHINE GUN', cost: 1250,
    damage: 20, head: 1.8, limb: 0.85, armorPen: 0, pen: 0.25,
    mag: 30, reserve: 90, cooldown: 0.078, reload: 1.9, equip: 0.4,
    auto: true, pellets: 1, scope: [56], scopeTime: 0.1,
    spread: { hip: 1.6, ads: 0.9, move: 0.6, air: 3, bloom: 0.26, bloomMax: 3 },
    falloff: [12, 36, 0.45], recoil: { kick: 0.55, side: 0.3, recover: 10 }, speed: 1.04, loud: 60, tracer: 0.5,
  },
  breaker: {
    id: 'breaker', sight: 'bead', slot: 'primary', family: 'shotgun', short: 'BREAKER', action: 'pump', name: 'Breaker-12', tag: 'PUMP SHOTGUN', cost: 1100,
    damage: 14, head: 1.5, limb: 0.85, armorPen: 0, pen: 0.12,
    mag: 6, reserve: 18, cooldown: 0.8, reload: 2.6, equip: 0.55,
    auto: false, pellets: 9, scope: [60], scopeTime: 0.1,
    spread: { hip: 4, ads: 3.1, move: 0.4, air: 2, bloom: 0, bloomMax: 0 },
    falloff: [8, 26, 0.2], recoil: { kick: 3.0, side: 0.6, recover: 6 }, speed: 1.0, loud: 85, tracer: 0.35,
  },
  vesper: {
    id: 'vesper', sight: 'scope', slot: 'primary', family: 'sniper', short: 'VESPER', action: 'bolt', trail: true, name: 'Vesper SR', tag: 'LIGHT BOLT-ACTION', cost: 1400,
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
    id: 'hornet', sight: 'holo', slot: 'primary', family: 'smg', short: 'HORNET', name: 'Hornet PDW', tag: 'PERSONAL DEFENCE WEAPON', cost: 1000,
    damage: 16, head: 1.8, limb: 0.9, armorPen: 0.15, pen: 0.2,
    mag: 40, reserve: 120, cooldown: 0.062, reload: 2.2, equip: 0.35,
    auto: true, pellets: 1, scope: [58], scopeTime: 0.08,
    spread: { hip: 1.4, ads: 1, move: 0.4, air: 2.5, bloom: 0.22, bloomMax: 3.4 },
    falloff: [10, 30, 0.4], recoil: { kick: 0.45, side: 0.35, recover: 12 }, speed: 1.07, loud: 55, tracer: 0.4,
  },
  maul: {
    id: 'maul', sight: 'iron', slot: 'primary', family: 'shotgun', short: 'MAUL', name: 'Maul-S', tag: 'SEMI-AUTO SHOTGUN', cost: 1800,
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
    id: 'sawn', sight: 'bead', slot: 'sidearm', family: 'shotgun', short: 'SAWN-OFF', name: 'Sawn-Off', tag: 'DOUBLE-BARREL', cost: 700,
    damage: 12, head: 1.4, limb: 0.85, armorPen: 0, pen: 0.1,
    mag: 2, reserve: 16, cooldown: 0.22, reload: 2.2, equip: 0.35,
    auto: false, pellets: 8, scope: [64], scopeTime: 0.08,
    spread: { hip: 5.2, ads: 4.6, move: 0.3, air: 1.5, bloom: 0, bloomMax: 0 },
    falloff: [4, 14, 0.15], recoil: { kick: 3.2, side: 0.9, recover: 6 }, speed: 1.04, loud: 90, tracer: 0.3,
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
// Portal → General Information) — safe to commit, unlike the client secret or bot token, which go in .env.
export const DISCORD_CLIENT_ID = '1550238088758825050';
// Community server. Logging in with Discord adds pilots to it; this link is for everyone else.
export const DISCORD_INVITE = 'https://discord.gg/uFVygVtKzt';

// Sight types (weapon.sight): scope = full scope overlay, prism = magnified lens, dot = red dot,
// holo = holographic window, iron = iron sights on the model, bead = shotgun bead.
// How the armoury groups weapons, in display order.
export const WEAPON_CLASSES = [
  { id: 'long', name: 'Long range', families: ['sniper', 'marksman'] },
  { id: 'rifle', name: 'Rifles', families: ['rifle', 'lmg'] },
  { id: 'close', name: 'Close quarters', families: ['smg', 'shotgun'] },
  { id: 'sidearm', name: 'Sidearms', slot: 'sidearm' },
];
export function weaponClass(weapon) { return WEAPON_CLASSES.find((c) => (c.slot ? weapon.slot === c.slot : weapon.slot === 'primary' && c.families.includes(weapon.family)))?.id || 'long'; }
export const DEFAULT_LOADOUT = { primary: 'm44', sidearm: 'p9', melee: 'knife' };
export const SLOT_ORDER = ['primary', 'sidearm', 'melee'];

export const ARMOR = {
  light: { id: 'light', name: 'Light Vest', cost: 400, points: 50, desc: '50 armour. Enough to survive one M-44 body shot.' },
  heavy: { id: 'heavy', name: 'Heavy Plate', cost: 900, points: 100, desc: '100 armour. Soaks a body shot and keeps absorbing through a long fight.' },
  helmet: { id: 'helmet', name: 'Ballistic Helmet', cost: 350, desc: 'Cuts headshot damage by 35%. Breaks after one hit.' },
};
export const ARMOR_ABSORB = 0.42;
export const HELMET_FACTOR = 0.65;

export const GADGETS = {
  pulse: { id: 'pulse', name: 'Radar Pulse', cost: 300, icon: '◎', desc: 'Reveals every rival within 45 m to your team for 3.5 s.', radius: 45, duration: 3.5 },
  drone: { id: 'drone', name: 'Recon Drone', cost: 450, icon: '✣', desc: 'Pilot a drone for 12 s. Rivals it sees are marked for your team.', duration: 12, range: 42, hp: 25 },
  decoy: { id: 'decoy', name: 'Decoy Hologram', cost: 200, icon: '◈', desc: 'Sends a running copy of you forward. Whoever shoots it is marked.', duration: 8, markTime: 4 },
  shield: { id: 'shield', name: 'Deploy Shield', cost: 350, icon: '▮', desc: 'Drops a bulletproof barrier. 350 HP, lasts the round.', hp: 350, width: 2.4, height: 1.55, depth: 0.25 },
  ghost: { id: 'ghost', name: 'Silent Step', cost: 250, icon: '〰', desc: '15 s of soundless movement. No footsteps, no radar noise.', duration: 15 },
  stim: { id: 'stim', name: 'Field Stim', cost: 300, icon: '✚', desc: 'Restores 50 health over 5 s. One per round.', heal: 50, duration: 5 },
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
  standard: { name: 'Standard', desc: 'Best-of-nine. One life. Buy between rounds.' },
  headhunter: { name: 'Headhunter', desc: 'Only headshots deal damage.' },
  instagib: { name: 'One Tap', desc: 'Every hit is lethal. No armour.' },
  lowgrav: { name: 'Low Orbit', desc: 'A third of the gravity. Rooftops are for everyone.' },
  sidearms: { name: 'Sidearms Only', desc: 'No primaries. Pistols, revolvers and knives.' },
};
export const VARIANTS = ['dusk', 'night', 'storm', 'noon'];
export const VARIANT_NAMES = { dusk: 'Dusk', night: 'Night Fog', storm: 'Storm Front', noon: 'High Noon', snow: 'Whiteout', haze: 'Dust Haze' };
export const BOT_DIFFICULTY = {
  recruit: { name: 'Recruit', reaction: 0.95, aimTime: 1.0, error: 2.1, headBias: 0.08, fov: 95 },
  veteran: { name: 'Veteran', reaction: 0.6, aimTime: 0.7, error: 1.0, headBias: 0.2, fov: 110 },
  elite: { name: 'Elite', reaction: 0.36, aimTime: 0.45, error: 0.6, headBias: 0.38, fov: 125 },
};
export const BOT_NAMES = ['Halcyon', 'Mako', 'Juno', 'Rook', 'Sable', 'Vesper', 'Onyx', 'Tundra', 'Piper', 'Echo', 'Marrow', 'Quill', 'Basil', 'Nova', 'Flint', 'Wren'];

export const QUICK_COMMANDS = [
  { id: 'push', text: 'Pushing now', voice: 'Pushing' },
  { id: 'hold', text: 'Hold this angle', voice: 'Holding' },
  { id: 'help', text: 'Need backup', voice: 'Need backup' },
  { id: 'spotted', text: 'Rival spotted', voice: 'Contact' },
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
export const RANKS = [
  [0, 'Unranked'], [1, 'Bronze'], [1100, 'Silver'], [1250, 'Gold'], [1400, 'Platinum'], [1600, 'Diamond'], [1850, 'Apex'],
];
export function rankName(rating, ranked) {
  if (!ranked) return 'Unranked';
  let name = 'Bronze';
  for (const [min, label] of RANKS) if (rating >= min && min > 0) name = label;
  return name;
}
export const MASTERY_TIERS = [[0, 'Unproven'], [10, 'Bronze'], [40, 'Silver'], [120, 'Gold'], [300, 'Obsidian']];
export function masteryTier(kills) {
  let tier = 0;
  MASTERY_TIERS.forEach(([min], index) => { if (kills >= min) tier = index; });
  return tier;
}

export const COSMETICS = {
  suit: [
    { id: '#ec6a9e', name: 'Coral', level: 1 }, { id: '#6ce6d1', name: 'Mint', level: 1 },
    { id: '#ffc857', name: 'Gold', level: 1 }, { id: '#8fa7ff', name: 'Blue', level: 1 },
    { id: '#f2f0ea', name: 'Bone', level: 3 }, { id: '#9d6bff', name: 'Violet', level: 5 },
    { id: '#ff4d4d', name: 'Signal Red', level: 8 }, { id: '#1d242c', name: 'Blackout', level: 12 },
  ],
  visor: [
    { id: '#6ce6d1', name: 'Mint', level: 1 }, { id: '#ff7148', name: 'Orange', level: 1 },
    { id: '#ffc857', name: 'Gold', level: 1 }, { id: '#ec6a9e', name: 'Coral', level: 4 },
    { id: '#9d6bff', name: 'Violet', level: 7 }, { id: '#ffffff', name: 'Arc White', level: 10 },
  ],
  tracer: [
    { id: '#ffc857', name: 'Brass', level: 1 }, { id: '#6ce6d1', name: 'Mint', level: 2 },
    { id: '#ec6a9e', name: 'Coral', level: 6 }, { id: '#9d6bff', name: 'Violet', level: 9 },
    { id: '#ffffff', name: 'Arc White', level: 14 },
  ],
  title: [
    { id: 'Recruit', name: 'Recruit', level: 1 }, { id: 'Marksman', name: 'Marksman', level: 2 },
    { id: 'Overwatch', name: 'Overwatch', level: 4 }, { id: 'Ghost', name: 'Ghost', level: 6 },
    { id: 'Deadeye', name: 'Deadeye', level: 9 }, { id: 'Longshot', name: 'Longshot', level: 12 },
    { id: 'Kestrel', name: 'Kestrel', level: 16 }, { id: 'Apex', name: 'Apex', level: 20 },
  ],
};
export function cosmeticUnlocked(kind, id, level) {
  const item = COSMETICS[kind]?.find((entry) => entry.id === id);
  return Boolean(item) && level >= item.level;
}

export const CONTRACTS = [
  { id: 'kills', text: 'Eliminate {n} rivals', n: 12, xp: 300 },
  { id: 'headshots', text: 'Land {n} headshot kills', n: 5, xp: 350 },
  { id: 'rounds', text: 'Win {n} rounds', n: 8, xp: 300 },
  { id: 'wins', text: 'Win {n} matches', n: 2, xp: 450 },
  { id: 'damage', text: 'Deal {n} damage', n: 1500, xp: 300 },
  { id: 'longshots', text: 'Get {n} kills from beyond 50 m', n: 3, xp: 400 },
  { id: 'wallbangs', text: 'Get {n} kills through cover', n: 2, xp: 450 },
  { id: 'knife', text: 'Get {n} blade kills', n: 1, xp: 400 },
  { id: 'sidearm', text: 'Get {n} sidearm kills', n: 4, xp: 350 },
  { id: 'gadgets', text: 'Use {n} gadgets', n: 6, xp: 250 },
  { id: 'clutches', text: 'Win {n} rounds as the last one standing', n: 1, xp: 450 },
  { id: 'matches', text: 'Finish {n} matches', n: 3, xp: 250 },
];
// Deterministic daily pick so every pilot sees the same board.
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
  const options = ['headhunter', 'instagib', 'lowgrav', 'sidearms'];
  let seed = 7;
  for (const char of dateKey) seed = (seed * 33 + char.charCodeAt(0)) >>> 0;
  return options[seed % options.length];
}
export function dateKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

// Flags packed into snapshots.
export const FLAG = { crouch: 1, scoped: 2, ground: 4, ghost: 8, reloading: 16, walking: 32, piloting: 64 };

export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
