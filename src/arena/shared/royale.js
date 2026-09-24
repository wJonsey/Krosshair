// Battle royale rules, shared so the HUD can describe what the server is doing.

export const ROYALE = {
  max: 50,            // players in one match, humans and bots
  fill: 30,           // bots top the lobby up to this many when it starts
  lobbyWait: 20,      // seconds before a lobby starts (sooner once it is full)
  pickupRange: 1.7,   // metres from a floor item for a bot to pick it up, or for anyone to collect ammo
  reach: 3.6,         // how far away a pilot can pick up what they are looking at
  viewRange: 520,     // players further away than this are left out of your snapshots
  spread: 26,         // minimum distance between two starting points
  dropTime: 14,       // seconds on the drop map, choosing where to land
  airdropFall: 14,    // seconds an airdrop takes to come down once it is called
};

// The storm. Each stage waits, then the safe circle shrinks to `radius` (a share of the island's half
// width) over `shrink` seconds. Outside it you take `damage` per second, armour or not.
export const STORM = [
  { wait: 90, shrink: 50, radius: 0.62, damage: 1 },
  { wait: 60, shrink: 45, radius: 0.36, damage: 2 },
  { wait: 45, shrink: 35, radius: 0.2, damage: 4 },
  { wait: 40, shrink: 30, radius: 0.1, damage: 7 },
  { wait: 30, shrink: 25, radius: 0.04, damage: 10 },
  { wait: 20, shrink: 20, radius: 0, damage: 15 },
];

// Floor loot. Every loot spot on the map gets one roll against these weights.
export const LOOT_TABLE = [
  { weight: 40, kind: 'weapon', pool: ['wasp', 'hornet', 'breaker', 'halcyon', 'pike', 'viper', 'sawn', 'p9', 'p9', 'wren'] },
  { weight: 22, kind: 'weapon', pool: ['talon', 'ronin', 'recon', 'maul', 'vesper'] },
  { weight: 7, kind: 'weapon', pool: ['m44', 'anvil', 'harbinger'] },
  { weight: 12, kind: 'armor', pool: ['light', 'light', 'heavy'] },
  { weight: 6, kind: 'helmet' },
  { weight: 10, kind: 'heal', amount: 50 },
  { weight: 9, kind: 'gadget', pool: ['pulse', 'shield', 'stim', 'ghost', 'decoy', 'drone'] },
  { weight: 7, kind: 'power', pool: ['jump'] },
  { weight: 9, kind: 'ammo' },
];
export const LOOT_CHANCE = 0.85;   // share of loot spots that hold something
// Everyone lands with a blade and nothing else.
export const ROYALE_LOADOUT = { primary: null, sidearm: null, melee: 'knife' };

// Airdrops: called when these storm stages begin, landing inside the next safe circle.
export const AIRDROP_STAGES = [1, 2, 3];
export const AIRDROP_LOOT = [{ kind: 'weapon', pool: ['m44', 'anvil', 'harbinger'] }, { kind: 'weapon', pool: ['talon', 'ronin', 'recon'] }, { kind: 'armor', pool: ['heavy'] }, { kind: 'helmet' }, { kind: 'heal', amount: 50 }, { kind: 'heal', amount: 50 }, { kind: 'ammo' }, { kind: 'gadget', pool: ['pulse', 'shield', 'stim', 'ghost', 'decoy'] }];
// How good a gun is, from the loot table it comes from: 0 common, 1 mid, 2 top. Bots trade up with it.
export const weaponTier = (id) => Math.max(0, LOOT_TABLE.findIndex((entry) => entry.kind === 'weapon' && entry.pool.includes(id)));

// Rarity, the thing you read off the floor before you decide whether the walk is worth it. The tier a gun
// rolls from sets it, and an airdrop upgrades whatever is in it by one. Rarity is not just a colour: a
// better gun is a better kept gun, so it holds more and reloads faster. Nothing else changes, so a
// Legendary pistol never beats a Common sniper at what the sniper is for.
export const ROYALE_RARITIES = {
  common: { id: 'common', name: 'Common', color: '#c9d3db', mag: 1, reload: 1 },
  rare: { id: 'rare', name: 'Rare', color: '#5fa8ff', mag: 1.15, reload: 0.95 },
  epic: { id: 'epic', name: 'Epic', color: '#b07cff', mag: 1.3, reload: 0.9 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffb547', mag: 1.5, reload: 0.82 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
export const weaponRarity = (id, fromAirdrop = false) => RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, weaponTier(id) + (fromAirdrop ? 1 : 0))];
// The gun as that rarity carries it. Damage and handling are untouched on purpose.
export function royaleWeapon(weapon, rarity) {
  const tier = ROYALE_RARITIES[rarity];
  if (!weapon || !tier || tier.mag === 1) return weapon;
  return { ...weapon, spread: { ...weapon.spread }, recoil: { ...weapon.recoil },
    mag: Math.max(1, Math.round(weapon.mag * tier.mag)), reload: weapon.reload * tier.reload, rarity };
}

// ------------------------------------------------------------------ deployment
// The opening of a royale: a countdown, a transport flying one line across the island, and everyone
// choosing their moment to go off the back ramp, fall, open a chute and land. Everything to tune is here.
// The server owns who is aboard, when they left and how fast they may come down; the browser draws the
// aircraft from `aircraftAt` on its own clock, so nothing about it is sent frame by frame.
export const DEPLOY = {
  countdown: 4,            // DEPLOYMENT_COUNTDOWN: seconds of 3, 2, 1 before the match goes live
  // AIRCRAFT_ALTITUDE, metres. High enough that a chute opened early reaches any corner from the line.
  altitude: 420,
  speed: 24,               // AIRCRAFT_SPEED, metres a second
  // AIRCRAFT_ROUTE: give start and end as [x, z] to fly a fixed line. Left null, each match flies a
  // random line through the island, up to `offset` from its centre, timed so the ramp opens `lead`
  // metres in from the coast (the sea is outside the world), and flying on `overhang` metres past the
  // far coast before it leaves.
  route: { start: null, end: null, lead: 22, overhang: 120, offset: 40 },
  doors: 2,                // JUMP_COOLDOWN: seconds after going live before the ramp opens
  maxTime: 45,             // MAX_DEPLOYMENT_TIME: nobody is aboard longer than this after going live
  coast: 25,               // and nobody is carried further than this inside the far coast
  exit: [0, -3, 12.6],     // where a pilot leaves the ramp, on the aircraft: right, up, back
  // FREEFALL_SPEED. Level, you drift further; nose down, you fall faster and travel less.
  freefall: { fall: 30, dive: 40, glide: 11, diveGlide: 6, accel: 1.6 },
  // PARACHUTE_SPEED. Forward dives, back brakes. `open` is how long the canopy takes to slow you.
  // At 11 across for 7 down, a chute opened near the top carries you about 600 m: the far corners too.
  parachute: { fall: 7, dive: 10, brake: 4.5, glide: 11, diveGlide: 14, brakeGlide: 4.5, open: 1.1, accel: 3.5, minFreefall: 0.8 },
  autoDeploy: 45,          // AUTO_DEPLOY_ALTITUDE: the chute opens itself this high above the ground
  landing: 0.55,           // LANDING_DURATION: touchdown and back on your feet, before control returns
  blend: 0.45,             // how long the camera takes to come back into your eyes after that
  // Nobody is flying a bot: it glides straight for its own spot, falling as fast as it can and still
  // get there, so the chute only comes out when it needs it.
  bot: { chuteAt: 24, chuteFall: 7, glide: 13 },
  // Third person, only for the deployment. Distances in metres, angles in radians, FOV in degrees added.
  camera: {
    ramp: { distance: 6.4, height: 0.6, arc: 1.2, pitchLow: -0.75, pitchHigh: 0.3, shake: 0.012 },
    freefall: { distance: 6.2, height: 1.6, fov: 10, shake: 0.02 },
    parachute: { distance: 9, height: 3.4, fov: 3, shake: 0.006 },
    follow: 7,             // how hard the camera chases its target: higher is tighter
    turn: 5,               // how fast it swings round behind a turn
  },
};

// A line across the island for the aircraft. `random` returns 0..1.
export function flightRoute(half, random = Math.random) {
  const { start, end, lead, overhang, offset } = DEPLOY.route;
  if (start && end) return { from: [...start], to: [...end] };
  const angle = random() * Math.PI * 2, side = (random() - 0.5) * 2 * offset;
  const dx = Math.cos(angle), dz = Math.sin(angle), cx = -dz * side, cz = dx * side;
  // Where the line crosses the coast, both ways: the aircraft starts far enough back to fly the countdown
  // and the doors before it reaches land.
  const cross = (c, d) => (Math.abs(d) < 1e-9 ? [-Infinity, Infinity] : [(-half - c) / d, (half - c) / d].sort((a, b) => a - b));
  const [ax, bx] = cross(cx, dx), [az, bz] = cross(cz, dz);
  const enter = Math.max(ax, az), leave = Math.min(bx, bz);
  const back = enter + lead - DEPLOY.speed * (DEPLOY.countdown + DEPLOY.doors), on = leave + overhang;
  return { from: [cx + dx * back, cz + dz * back], to: [cx + dx * on, cz + dz * on] };
}
// The whole flight, timed from `launchAt`: the countdown is flown too, so the aircraft is already on its
// way in when the doors open. `ejectAt` is when anyone still aboard is sent out, over land.
export function flightPlan(route, launchAt, half) {
  const [x0, z0] = route.from, [x1, z1] = route.to;
  const length = Math.hypot(x1 - x0, z1 - z0) || 1, dir = [(x1 - x0) / length, (z1 - z0) / length];
  const liveAt = launchAt + DEPLOY.countdown, doorsAt = liveAt + DEPLOY.doors;
  // The last stretch still over the island, minus a margin, so nobody is thrown out over the sea.
  const inside = (d) => Math.abs(x0 + dir[0] * d) < half - DEPLOY.coast && Math.abs(z0 + dir[1] * d) < half - DEPLOY.coast;
  let last = 0;
  for (let d = 0; d <= length; d += 2) if (inside(d)) last = d;
  const ejectAt = Math.max(doorsAt + 1, Math.min(launchAt + last / DEPLOY.speed, liveAt + DEPLOY.maxTime));
  return { from: [x0, z0], to: [x1, z1], dir, heading: Math.atan2(-dir[0], -dir[1]), y: DEPLOY.altitude, speed: DEPLOY.speed, launchAt, liveAt, doorsAt, ejectAt, endAt: launchAt + length / DEPLOY.speed };
}
// Where the aircraft is at time t: the same answer on the server and in every browser.
export function aircraftAt(flight, t) {
  const d = Math.max(0, t - flight.launchAt) * flight.speed;
  return { x: flight.from[0] + flight.dir[0] * d, y: flight.y, z: flight.from[1] + flight.dir[1] * d, heading: flight.heading };
}
// The ramp's edge in the world, for an aircraft where `aircraftAt` says.
export function rampAt(plane) {
  const [right, up, back] = DEPLOY.exit, sin = Math.sin(plane.heading), cos = Math.cos(plane.heading);
  // Forward is (-sin, -cos); right is (cos, -sin).
  return { x: plane.x + cos * right + sin * back, y: plane.y + up, z: plane.z - sin * right + cos * back };
}
// Pickups that change how you move for a while.
export const POWERS = {
  jump: { name: 'Spring Boots', desc: 'Jump three times as high.', seconds: 40, jump: 1.75 },
};
// Jump pads throw you this fast straight up: enough for any roof.
export const PAD_LAUNCH = 15.5;

// Whether a pilot can see a pickup well enough to take it: from the eye to the item, or just over it,
// with nothing solid in between. Reach alone let loot come through walls and up through floors. The
// browser asks the same question before it offers the pickup, so it never offers one the server refuses.
export function lootInSight(world, eye, loot) {
  return world.lineOfSight(eye[0], eye[1], eye[2], loot.x, loot.y + 0.35, loot.z) || world.lineOfSight(eye[0], eye[1], eye[2], loot.x, loot.y + 0.9, loot.z);
}

// One frame of a pilot coming down, as the browser flies it (and the tests fly it, so an honest descent is
// checked against the real thing). stage: 'freefall' or 'chute'. `forward` is the move key's -1..1 (back to
// forward); `pitch` is where the pilot looks, negative down. Returns the new vertical speed and how fast
// the pilot may travel across the ground, and whether that travel is carried forward on its own.
export function descentStep(stage, vy, forward, pitch, dt) {
  const lerp = (a, b, k) => a + (b - a) * k;
  if (stage === 'chute') {
    const p = DEPLOY.parachute, dive = Math.max(0, forward), brake = Math.max(0, -forward);
    const fall = dive ? lerp(p.fall, p.dive, dive) : lerp(p.fall, p.brake, brake);
    const glide = dive ? lerp(p.glide, p.diveGlide, dive) : lerp(p.glide, p.brakeGlide, brake);
    return { vy: vy + (-fall - vy) * Math.min(1, dt * p.accel), glide, carried: true };
  }
  const f = DEPLOY.freefall, dive = Math.max(0, Math.min(1, (-pitch - 0.35) / 0.8));
  return { vy: vy + (-lerp(f.fall, f.dive, dive) - vy) * Math.min(1, dt * f.accel), glide: lerp(f.glide, f.diveGlide, dive), carried: false };
}
