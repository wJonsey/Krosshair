import * as THREE from 'three';

const root = document.querySelector('#game-root');
const startCard = document.querySelector('#start-card');
const pauseCard = document.querySelector('#pause-card');
const respawnCard = document.querySelector('#respawn-card');
const respawnCount = document.querySelector('#respawn-count');
const endCard = document.querySelector('#end-card');
const startButton = document.querySelector('#start-button');
const resumeButton = document.querySelector('#resume-button');
const restartButton = document.querySelector('#restart-button');
const eliminationsLabel = document.querySelector('#eliminations');
const healthLabel = document.querySelector('#health');
const healthMeter = document.querySelector('#health-meter');
const ammoLabel = document.querySelector('#ammo');
const ammoAlert = document.querySelector('#ammo-alert');
const weaponNameLabel = document.querySelector('#weapon-name');
const roundLabel = document.querySelector('#round');
const feed = document.querySelector('#event-feed');
const roomInput = document.querySelector('#room-input');
const connectButton = document.querySelector('#connect-button');
const networkStatus = document.querySelector('#network-status');
const scopeOverlay = document.querySelector('#scope-overlay');
const crosshair = document.querySelector('.crosshair');
const scoreboard = document.querySelector('#scoreboard');
const scoreboardRows = document.querySelector('#scoreboard-rows');
const nameInput = document.querySelector('#name-input');
const settingsButton = document.querySelector('#settings-button');
const settingsCard = document.querySelector('#settings-card');
const closeSettings = document.querySelector('#close-settings');
const sensitivityInput = document.querySelector('#sensitivity-input');
const scopeSensitivityInput = document.querySelector('#scope-sensitivity-input');
const sensitivityValue = document.querySelector('#sensitivity-value');
const scopeSensitivityValue = document.querySelector('#scope-sensitivity-value');
const fovInput = document.querySelector('#fov-input');
const fovValue = document.querySelector('#fov-value');
const resolutionInput = document.querySelector('#resolution-input');
const colorSwatches = [...document.querySelectorAll('[data-color]')];
const accentSwatches = [...document.querySelectorAll('[data-accent]')];
const arenaSubtitle = document.querySelector('.arena-title small');
document.querySelector('.character-picker')?.remove();
document.querySelector('.back-link')?.remove();
startCard.classList.add('lobby-card');
arenaSubtitle.textContent = '// MATCH LOBBY';
document.querySelector('.entry-step').textContent = 'READY ROOM';
connectButton.innerHTML = 'Join lobby <span>↗</span>';
startButton.innerHTML = 'Deploy to arena <span>→</span>';
document.querySelector('.start-card h1').innerHTML = 'Choose your<br /><em>colours.</em>';
startCard.querySelector('small').textContent = 'Mouse aim enabled // lock is optional';
pauseCard.querySelector('h2').textContent = 'Capture your mouse.';
pauseCard.querySelector('p:not(.eyebrow)').textContent = 'Click Resume fight or the arena to lock your cursor and continue.';
const colorPreview = document.createElement('div');
colorPreview.className = 'color-preview';
colorPreview.innerHTML = '<span class="preview-operator"><i class="preview-helmet"></i><i class="preview-visor"></i><i class="preview-body"></i></span><span><b>LIVE LOADOUT PREVIEW</b><small>Your colours appear to other pilots</small></span>';
document.querySelector('.customize-row')?.before(colorPreview);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8db5ca');
scene.fog = new THREE.Fog('#a8b3ad', 55, 220);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .1, 260);
camera.position.set(0, 1.7, 14);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { topColor: { value: new THREE.Color('#315878') }, horizonColor: { value: new THREE.Color('#d0c5a9') } },
  vertexShader: 'varying vec3 skyDirection; void main() { skyDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
  fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 skyDirection; void main() { float height = max(normalize(skyDirection).y, 0.0); vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.78, height)); float haze = smoothstep(0.0, 0.38, height); color += vec3(.05, .06, .04) * haze; gl_FragColor = vec4(color, 1.0); }',
});
const skybox = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 32), skyMaterial);
skybox.renderOrder = -10;
scene.add(skybox);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const arenaObjects = [];
const colliders = [];
const bots = [];
const remotePlayers = new Map();
const keys = {};
const player = { health: 100, eliminations: 0, ammo: 12, reserve: 48, round: 1, active: false, paused: false, respawning: false, respawnCount: 0, velocityY: 0, onGround: true, shotCooldown: 0, networkId: null, opponentReady: false, name: localStorage.getItem('neon-arena-name') || '', character: localStorage.getItem('neon-arena-character') || 'vanguard', color: localStorage.getItem('neon-arena-color') || '#ec6a9e', accent: localStorage.getItem('neon-arena-accent') || '#6ce6d1' };
const weapons = { marksman: { name: 'M-44 // LONG SIGHT', magazine: 5, damage: 85, cooldown: .9 } };
let activeWeapon = 'marksman';
const spawnPoints = [[-12, -14], [12, -13], [-15, 4], [15, 5], [-2, -21]];
let yaw = 0;
let pitch = 0;
let networkSocket = null;
let networkStateAccumulator = 0;
let networkSlot = 1;
let scoped = false;
let networkRoster = [];
let sensitivity = Number(localStorage.getItem('neon-arena-sensitivity') || 1);
let scopeSensitivity = Number(localStorage.getItem('neon-arena-scope-sensitivity') || .6);
let baseFov = Number(localStorage.getItem('neon-arena-fov') || 72);
let resolutionPreset = localStorage.getItem('neon-arena-resolution') || '1920x1080';
const spawnPositions = [[0, 45], [0, -45], [-38, 30], [38, -30], [-40, -18], [40, 18], [-18, 42], [18, -42]];

scene.add(new THREE.HemisphereLight('#a6c8e8', '#17202b', 1.6));
const sun = new THREE.DirectionalLight('#ffe4bb', 2.6);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const accentLight = new THREE.PointLight('#ec6a9e', 16, 30);
accentLight.position.set(0, 5, -8);
scene.add(accentLight);

function material(color, roughness = .65, emissive = null) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: .12, emissive: emissive || color, emissiveIntensity: emissive ? .28 : .03 });
}
function addBox(size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options.roughness, options.emissive));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  arenaObjects.push(mesh);
  colliders.push({ type: 'box', x: mesh.position.x, z: mesh.position.z, halfX: size[0] / 2, halfZ: size[2] / 2 });
  return mesh;
}

const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#315d3e', roughness: 1, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const soilMaterial = new THREE.MeshStandardMaterial({ color: '#6a5941', roughness: 1, metalness: 0 });
const trail = new THREE.Mesh(new THREE.PlaneGeometry(8, 145), soilMaterial);
trail.rotation.x = -Math.PI / 2;
trail.position.y = .012;
trail.position.x = -1;
scene.add(trail);
for (let index = 0; index < 18; index += 1) {
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1.4 + (index % 3) * .5, 9), new THREE.MeshStandardMaterial({ color: index % 2 ? '#3a7147' : '#274f36', roughness: 1 }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(Math.sin(index * 4.2) * 38, .018, Math.cos(index * 2.7) * 42);
  scene.add(patch);
}
const grid = new THREE.GridHelper(160, 80, '#35545b', '#1c3036');
grid.position.y = .015;
grid.material.transparent = true;
grid.material.opacity = .12;
scene.add(grid);
addBox([140, 4, 1], [0, 2, -75], '#182933', { emissive: '#10242a' });
addBox([140, 4, 1], [0, 2, 75], '#182933', { emissive: '#10242a' });
addBox([1, 4, 150], [-75, 2, 0], '#182933', { emissive: '#10242a' });
addBox([1, 4, 150], [75, 2, 0], '#182933', { emissive: '#10242a' });
for (let index = -4; index <= 4; index += 1) {
  addBox([.2, 5, .2], [index * 6, 2.5, -53], '#6ce6d1', { emissive: '#6ce6d1' });
}
addBox([8, 2.8, 2], [-10, 1.4, -4], '#203b42', { emissive: '#19343a' });
addBox([7, 3.8, 2], [10, 1.9, 4], '#302a43', { emissive: '#252039' });
addBox([12, 1.4, 3], [-22, .7, -18], '#263c4b', { emissive: '#1b3040' });
addBox([12, 1.4, 3], [22, .7, 18], '#443044', { emissive: '#332038' });
addBox([3, 5, 3], [-28, 2.5, -2], '#1e3440', { emissive: '#17303a' });
addBox([3, 5, 3], [28, 2.5, 2], '#3a2841', { emissive: '#2b1d34' });
addBox([11, .7, 9], [0, .35, 0], '#243b43', { emissive: '#17343a' });
addBox([4, 2.4, 1.2], [-8, 1.2, 9], '#2d4851', { emissive: '#1d4047' });
addBox([4, 2.4, 1.2], [8, 1.2, -9], '#493443', { emissive: '#352239' });
addBox([1.2, 3.4, 4], [-7, 1.7, -11], '#304b50', { emissive: '#204047' });
addBox([1.2, 3.4, 4], [7, 1.7, 11], '#4a3544', { emissive: '#38243a' });
function addBeacon(x, z, color) {
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.18, .28, 3.8, 8), material(color, .35, color));
  beacon.position.set(x, 1.9, z);
  beacon.castShadow = true;
  scene.add(beacon);
  const light = new THREE.PointLight(color, 5, 10);
  light.position.set(x, 3.8, z);
  scene.add(light);
}
addBeacon(-4.2, -4.2, '#6ce6d1');
addBeacon(4.2, 4.2, '#ff7148');
function addTree(x, z, scale = 1) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35 * scale, .55 * scale, 3.3 * scale, 7), material('#42362e'));
  trunk.position.y = 1.65 * scale;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2 * scale, 4.2 * scale, 8), material('#244a43', .9, '#16352f'));
  crown.position.y = 4.3 * scale;
  const crownTop = new THREE.Mesh(new THREE.ConeGeometry(1.45 * scale, 3 * scale, 8), material('#32685a', .9, '#1d493f'));
  crownTop.position.y = 6.2 * scale;
  tree.add(trunk, crown, crownTop);
  tree.traverse((part) => { part.castShadow = true; part.receiveShadow = true; });
  scene.add(tree);
  colliders.push({ type: 'circle', x, z, radius: .7 * scale });
}
function addBush(x, z, scale = 1) {
  const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3 * scale, 1), material('#35624f', 1, '#1d4436'));
  bush.position.set(x, .85 * scale, z);
  bush.castShadow = true;
  scene.add(bush);
  colliders.push({ type: 'circle', x, z, radius: 1.1 * scale });
}
function addRock(x, z, scale = 1) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2 * scale, 0), material('#47515a'));
  rock.position.set(x, .8 * scale, z);
  rock.rotation.set(.2, .4, .1);
  rock.scale.y = .7;
  rock.castShadow = true;
  scene.add(rock);
  colliders.push({ type: 'circle', x, z, radius: 1.1 * scale });
}
[-46, -36, -26, -14, 14, 26, 36, 46].forEach((z, index) => addTree(index % 2 ? -47 : 47, z, .8 + (index % 3) * .14));
[[ -39, -30, 1.3 ], [ 39, 30, 1.3 ], [ -40, 14, .9 ], [ 40, -13, 1 ], [ -15, 28, .8 ], [ 15, -28, .8 ]].forEach(([x, z, scale]) => addTree(x, z, scale));
[[ -34, -12, 1.4 ], [ 35, 10, 1.2 ], [ -5, -34, 1.1 ], [ 7, 34, 1.3 ], [ -30, 27, .8 ], [ 30, -25, .9 ]].forEach(([x, z, scale]) => addBush(x, z, scale));
[[ -20, -27, 1.2 ], [ 20, 27, 1.1 ], [ -42, 0, 1.4 ], [ 42, 0, 1.4 ]].forEach(([x, z, scale]) => addRock(x, z, scale));
const grassMaterial = material('#47785c', .95, '#234735');
for (let index = 0; index < 700; index += 1) {
  const x = Math.sin(index * 19.17) * 48;
  const z = Math.cos(index * 7.31) * 48;
  const blade = new THREE.Mesh(new THREE.ConeGeometry(.04, .32 + (index % 5) * .07, 3), grassMaterial);
  blade.position.set(x, .22, z);
  blade.rotation.y = index;
  scene.add(blade);
}

const weapon = new THREE.Group();
const weaponBody = new THREE.Mesh(new THREE.BoxGeometry(.24, .2, .9), material('#252b32', .34));
weaponBody.position.set(.38, -.28, -.75);
weaponBody.rotation.set(-.08, -.18, -.05);
weapon.add(weaponBody);
const receiver = new THREE.Mesh(new THREE.BoxGeometry(.29, .23, .48), material('#171d23', .3));
receiver.position.set(.38, -.27, -.69);
weapon.add(receiver);
const handguard = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .75, 12), material('#20262d', .42));
handguard.rotation.x = Math.PI / 2;
handguard.position.set(.38, -.23, -1.02);
weapon.add(handguard);
const weaponGrip = new THREE.Mesh(new THREE.BoxGeometry(.12, .38, .18), material('#1a2028'));
weaponGrip.position.set(.32, -.47, -.58);
weaponGrip.rotation.x = -.22;
weapon.add(weaponGrip);
const weaponStock = new THREE.Mesh(new THREE.BoxGeometry(.22, .16, .35), material('#202832', .45));
weaponStock.position.set(.38, -.27, -.28);
weaponStock.rotation.y = -.12;
weapon.add(weaponStock);
const weaponMagazine = new THREE.Mesh(new THREE.BoxGeometry(.13, .3, .16), material('#202832', .45));
weaponMagazine.position.set(.38, -.43, -.65);
weaponMagazine.rotation.x = -.15;
weapon.add(weaponMagazine);
const weaponGuard = new THREE.Mesh(new THREE.TorusGeometry(.1, .025, 6, 12, Math.PI), material('#596675', .3));
weaponGuard.rotation.x = Math.PI / 2;
weaponGuard.position.set(.38, -.39, -.52);
weapon.add(weaponGuard);
const weaponBarrel = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .82, 10), material('#4f5b64', .28));
weaponBarrel.rotation.x = Math.PI / 2;
weaponBarrel.position.set(.38, -.23, -1.2);
weaponBarrel.scale.z = 1.65;
weapon.add(weaponBarrel);
const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(.09, .065, .2, 10), material('#151c23', .28));
muzzleBrake.rotation.x = Math.PI / 2;
muzzleBrake.position.set(.38, -.23, -1.9);
weapon.add(muzzleBrake);
const muzzleSlot = new THREE.Mesh(new THREE.BoxGeometry(.02, .07, .12), material('#6c7880', .25));
muzzleSlot.position.set(.38, -.16, -1.9);
weapon.add(muzzleSlot);
const weaponScope = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .42, 12), material('#151a20', .28));
weaponScope.rotation.x = Math.PI / 2;
weaponScope.position.set(.38, -.12, -.78);
weaponScope.visible = true;
weapon.add(weaponScope);
const scopeMount = new THREE.Mesh(new THREE.BoxGeometry(.18, .08, .3), material('#111820', .35));
scopeMount.position.set(.38, -.17, -.78);
weapon.add(scopeMount);
const boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .25, 8), material('#8995a1', .3));
boltHandle.rotation.z = Math.PI / 2;
boltHandle.position.set(.57, -.25, -.68);
weapon.add(boltHandle);
const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(.23, .12, .25), material('#303a45', .5));
cheekRest.position.set(.39, -.15, -.3);
weapon.add(cheekRest);
const bipodLeft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .32, 6), material('#596675', .35));
bipodLeft.position.set(.29, -.51, -1.02);
bipodLeft.rotation.z = -.35;
const bipodRight = bipodLeft.clone();
bipodRight.position.x = .48;
bipodRight.rotation.z = .35;
weapon.add(bipodLeft, bipodRight);
camera.add(weapon);
scene.add(camera);

function createBot(position) {
  const bot = new THREE.Group();
  bot.position.set(position[0], 0, position[1]);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.45, .72), material('#ec6a9e', .48, '#ec6a9e'));
  body.position.y = 1.18;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(.72, .72, .72), material('#ffc857', .52, '#ff7148'));
  head.position.y = 2.28;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.5, .16, .03), material('#0d1820', .22, '#6ce6d1'));
  visor.position.set(0, 2.3, -.37);
  bot.add(body, head, visor);
  bot.userData = { health: 100, speed: 1.25 + Math.random() * .35, cooldown: .3 + Math.random(), hitFlash: 0, live: true };
  scene.add(bot);
  bots.push(bot);
}
function createCharacterVisual(color, accent) {
  const character = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.46, .82, 5, 10), material(color, .55, color));
  torso.position.y = 1.28;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.38, 16, 12), material('#e5ad8b', .7));
  head.position.y = 2.45;
  head.userData.hitZone = 'head';
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.41, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), material('#222b35', .45, accent));
  helmet.position.y = 2.54;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.52, .15, .05), material(accent, .28, accent));
  visor.position.set(0, 2.48, -.35);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.13, .65, 4, 8), material(color, .6, color));
  arm.position.set(.62, 1.3, 0);
  arm.rotation.z = -.2;
  const otherArm = arm.clone();
  otherArm.position.x = -.62;
  otherArm.rotation.z = .2;
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .8, 4, 8), material('#202832', .75));
  leg.position.set(.24, .35, 0);
  const otherLeg = leg.clone();
  otherLeg.position.x = -.24;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(.72, .7, .48), material('#2a3540', .6, accent));
  vest.position.set(0, 1.38, -.04);
  torso.userData.suitPart = true;
  arm.userData.suitPart = true;
  otherArm.userData.suitPart = true;
  vest.userData.suitPart = true;
  helmet.userData.accentPart = true;
  visor.userData.accentPart = true;
  character.add(torso, head, helmet, visor, vest, arm, otherArm, leg, otherLeg);
  character.traverse((part) => { part.castShadow = true; part.receiveShadow = true; });
  return character;
}
function createRemotePlayer(id) {
  const remote = new THREE.Group();
  remote.add(createCharacterVisual('#6ce6d1', '#ffc857'));
  remote.userData.id = id;
  remote.userData.name = id;
  remote.userData.character = 'vanguard';
  remote.userData.hitboxes = [
    { center: new THREE.Vector3(0, 2.45, 0), radius: .68, zone: 'head' },
    { center: new THREE.Vector3(0, 1.3, 0), radius: 1.05, zone: 'body' },
  ];
  scene.add(remote);
  remote.add(createNameTag(remote.userData.name));
  remotePlayers.set(id, remote);
  return remote;
}
function applyRemoteStyle(remote, message) {
  if (!message.color && !message.accent) return;
  const visual = remote.children.find((child) => child.type === 'Group');
  if (!visual) return;
  const color = message.color || '#6ce6d1';
  const accent = message.accent || '#ffc857';
  visual.traverse((part) => {
    if (!part.isMesh) return;
    if (part.userData.suitPart) part.material.color.set(color);
    if (part.userData.accentPart) { part.material.color.set(accent); part.material.emissive.set(accent); }
  });
}
function createNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(7,9,12,.78)';
  context.fillRect(3, 3, 250, 42);
  context.fillStyle = '#f2f0ea';
  context.font = '700 22px Space Grotesk';
  context.textAlign = 'center';
  context.fillText(name, 128, 31);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.position.set(0, 3.45, 0);
  sprite.scale.set(2.4, .45, 1);
  sprite.userData.nameTag = true;
  return sprite;
}
function updateNameTag(remote, name) {
  remote.userData.name = name || remote.userData.name;
  const tag = remote.children.find((child) => child.userData.nameTag);
  if (!tag) return;
  const canvas = tag.material.map.image;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(7,9,12,.78)';
  context.fillRect(3, 3, 250, 42);
  context.fillStyle = '#f2f0ea';
  context.font = '700 22px Space Grotesk';
  context.textAlign = 'center';
  context.fillText(remote.userData.name, 128, 31);
  tag.material.map.needsUpdate = true;
}
function placePlayer(slot) {
  const spawn = spawnPositions[(Math.max(1, slot) - 1) % spawnPositions.length];
  camera.position.set(spawn[0], 1.7, spawn[1]);
  yaw = Math.atan2(-spawn[0], -spawn[1]);
}
function renderScoreboard() {
  scoreboardRows.innerHTML = networkRoster.map((pilot) => {
    const deaths = pilot.deaths || 0;
    const kills = pilot.kills || 0;
    const ratio = deaths ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const label = pilot.id === player.networkId ? `${pilot.name || player.name} (YOU)` : (pilot.name || pilot.id);
    return `<div class="score-row${pilot.id === player.networkId ? ' you' : ''}"><span class="pilot">${label}</span><span>${kills}</span><span>${deaths}</span><span class="ratio">${ratio}</span></div>`;
  }).join('');
}
function handleNetworkMessage(message) {
  if (message.type === 'welcome') {
    player.networkId = message.id;
    networkSlot = message.count;
    player.opponentReady = message.count >= 2;
    networkRoster = message.roster || [];
    placePlayer(networkSlot);
    renderScoreboard();
    networkStatus.textContent = `Room ${message.room} // ${message.count}/${message.max} pilots`;
    networkStatus.classList.add('connected');
    announce(`Connected to room ${message.room}`);
  }
  if (message.type === 'error') {
    networkStatus.textContent = message.message;
    networkStatus.classList.add('error');
  }
  if (message.type === 'player-joined') { player.opponentReady = true; networkRoster = message.roster || networkRoster; renderScoreboard(); announce('Rival pilot joined the arena'); }
  if (message.type === 'player-left') {
    const remote = remotePlayers.get(message.id);
    if (remote) scene.remove(remote);
    remotePlayers.delete(message.id);
    networkRoster = message.roster || networkRoster;
    renderScoreboard();
    announce('Rival pilot disconnected');
  }
  if (message.type === 'state') {
    const remote = remotePlayers.get(message.id) || createRemotePlayer(message.id);
    updateNameTag(remote, message.name);
    applyRemoteStyle(remote, message);
    remote.position.set(message.x, message.y - 1.7, message.z);
    remote.rotation.y = message.yaw;
  }
  if (message.type === 'hit' && message.target === player.networkId && !player.respawning) {
    player.health = Math.max(0, player.health - message.damage);
    updateHud();
    if (player.health <= 0 && !player.respawning) {
      sendNetwork({ type: 'eliminated', winner: message.attacker });
      showRespawn();
    }
  }
  if (message.type === 'eliminated' && message.winner === player.networkId) {
    player.eliminations += 1;
    networkRoster = message.roster || networkRoster;
    renderScoreboard();
    announce(`Elimination confirmed // ${player.eliminations}`);
  }
  if (message.type === 'eliminated' && message.victim === player.networkId) {
    networkRoster = message.roster || networkRoster;
    renderScoreboard();
    showRespawn();
  }
}
function connectMultiplayer() {
  const callsign = nameInput.value.trim();
  if (callsign.length < 2 || callsign.toLowerCase() === 'pilot') {
    networkStatus.textContent = 'Choose a callsign with at least 2 characters';
    networkStatus.classList.add('error');
    nameInput.focus();
    return;
  }
  player.name = callsign.slice(0, 16);
  nameInput.value = player.name;
  startButton.disabled = false;
  localStorage.setItem('neon-arena-name', player.name);
  if (networkSocket && networkSocket.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  networkStatus.textContent = 'Connecting to relay...';
  networkStatus.classList.remove('error');
  try {
    networkSocket = new WebSocket(`${protocol}://${location.host}/arena`);
    networkSocket.addEventListener('open', () => networkSocket.send(JSON.stringify({ type: 'join', room: roomInput.value.trim() || 'night-shift', name: player.name, character: player.character, color: player.color, accent: player.accent })));
    networkSocket.addEventListener('message', (event) => handleNetworkMessage(JSON.parse(event.data)));
    networkSocket.addEventListener('error', () => { networkStatus.textContent = 'Solo mode // start relay to connect'; networkStatus.classList.add('error'); });
    networkSocket.addEventListener('close', () => { networkStatus.textContent = 'Solo mode // relay offline'; networkStatus.classList.remove('connected'); });
  } catch { networkStatus.textContent = 'Solo mode // relay unavailable'; }
}
function sendNetwork(message) {
  if (networkSocket && networkSocket.readyState === WebSocket.OPEN) networkSocket.send(JSON.stringify(message));
}
function requestArenaPointerLock() {
  if (!player.active) return;
  if (document.pointerLockElement === renderer.domElement) return;
  const request = renderer.domElement.requestPointerLock();
  if (request && typeof request.catch === 'function') request.catch(() => {
    announce('Mouse lock unavailable // using free aim');
  });
}
function spawnWave() {
  roundLabel.textContent = String(player.round).padStart(2, '0');
  announce('1v1 // waiting for rival pilot');
}
function announce(message) {
  const line = document.createElement('div');
  line.textContent = message;
  feed.prepend(line);
  setTimeout(() => line.remove(), 3000);
}
function updateHud() {
  eliminationsLabel.textContent = String(player.eliminations).padStart(2, '0');
  healthLabel.textContent = player.health;
  healthMeter.style.width = `${player.health}%`;
  healthMeter.style.background = player.health < 35 ? '#ff7148' : '#6ce6d1';
  ammoLabel.textContent = String(player.ammo).padStart(2, '0');
  ammoAlert.classList.toggle('hidden', player.ammo > 0);
  weaponNameLabel.textContent = weapons[activeWeapon].name;
}
function resetMatch() {
  if (nameInput.value.trim().length < 2 || nameInput.value.trim().toLowerCase() === 'pilot') {
    networkStatus.textContent = 'Choose your callsign before entering';
    networkStatus.classList.add('error');
    nameInput.focus();
    return;
  }
  bots.splice(0).forEach((bot) => scene.remove(bot));
  player.health = 100;
  player.eliminations = 0;
  player.ammo = weapons[activeWeapon].magazine;
  player.reserve = 48;
  player.round = 1;
  player.active = true;
  player.paused = false;
  player.respawning = false;
  player.respawnCount = 0;
  setScoped(false);
  placePlayer(networkSlot);
  pitch = 0;
  endCard.classList.add('hidden');
  respawnCard.classList.add('hidden');
  pauseCard.classList.add('hidden');
  startCard.classList.add('hidden');
  arenaSubtitle.textContent = '// MULTIPLAYER ARENA';
  spawnWave();
  updateHud();
  connectMultiplayer();
  requestArenaPointerLock();
}
function showRespawn() {
  if (player.respawning) return;
  player.active = false;
  player.respawning = true;
  player.health = 0;
  updateHud();
  setScoped(false);
  document.exitPointerLock();
  respawnCard.classList.remove('hidden');
  respawnCount.textContent = 'SPACE';
}
function respawnPlayer() {
  if (!player.respawning) return;
  player.health = 100;
  player.ammo = weapons[activeWeapon].magazine;
  player.respawnCount += 1;
  const nextSlot = ((networkSlot - 1 + player.respawnCount * 2) % spawnPositions.length) + 1;
  placePlayer(nextSlot);
  player.respawning = false;
  player.active = true;
  respawnCard.classList.add('hidden');
  updateHud();
  announce('Back in the fight');
  requestArenaPointerLock();
}
function endMatch(title, copy) {
  player.active = false;
  document.exitPointerLock();
  document.querySelector('#end-title').textContent = title;
  document.querySelector('#end-copy').textContent = `${copy} Eliminations: ${player.eliminations}.`;
  endCard.classList.remove('hidden');
}
function findRemoteHit(direction) {
  let best = null;
  const worldCenter = new THREE.Vector3();
  const closest = new THREE.Vector3();
  remotePlayers.forEach((remote) => {
    remote.userData.hitboxes.forEach((hitbox) => {
      worldCenter.copy(hitbox.center);
      remote.localToWorld(worldCenter);
      const toTarget = worldCenter.clone().sub(camera.position);
      const projection = toTarget.dot(direction);
      if (projection <= 0) return;
      closest.copy(direction).multiplyScalar(projection).add(camera.position);
      const distance = closest.distanceTo(worldCenter);
      if (distance <= hitbox.radius && (!best || projection < best.distance)) best = { id: remote.userData.id, zone: hitbox.zone, distance: projection };
    });
  });
  return best;
}
function drawTracer(direction, distance, color = '#ffc857') {
  const start = camera.position.clone();
  const end = start.clone().add(direction.clone().multiplyScalar(Math.min(distance, 120)));
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .92 }));
  scene.add(line);
  setTimeout(() => { scene.remove(line); geometry.dispose(); line.material.dispose(); }, 75);
}
function showHitConfirm() {
  crosshair.classList.remove('hit');
  void crosshair.offsetWidth;
  crosshair.classList.add('hit');
  scopeOverlay.classList.remove('hit');
  void scopeOverlay.offsetWidth;
  if (scoped) scopeOverlay.classList.add('hit');
  setTimeout(() => crosshair.classList.remove('hit'), 210);
  setTimeout(() => scopeOverlay.classList.remove('hit'), 250);
}
function shoot() {
  if (!player.active || player.paused || player.shotCooldown > 0) return;
  if (player.ammo <= 0) { ammoAlert.classList.remove('hidden'); announce('Magazine empty // press R to reload'); return; }
  player.ammo -= 1;
  player.shotCooldown = weapons[activeWeapon].cooldown;
  weapon.position.z = .12;
  setTimeout(() => { weapon.position.z = 0; }, 55);
  const targets = [...bots.filter((bot) => bot.userData.live), ...remotePlayers.values()].flatMap((target) => {
    const meshes = [];
    target.traverse((part) => { if (part.isMesh) { part.userData.ownerId = target.userData.id; meshes.push(part); } });
    return meshes;
  });
  const pellets = [[0, 0]];
  pellets.forEach(([offsetX, offsetY]) => {
    raycaster.setFromCamera(new THREE.Vector2(offsetX, offsetY), camera);
    const remoteHit = findRemoteHit(raycaster.ray.direction);
    if (remoteHit) {
      drawTracer(raycaster.ray.direction, remoteHit.distance, '#ff7148');
      showHitConfirm();
      const damage = remoteHit.zone === 'head' ? Math.min(100, weapons[activeWeapon].damage + 18) : weapons[activeWeapon].damage;
      sendNetwork({ type: 'hit', target: remoteHit.id, attacker: player.networkId, damage });
      announce(`${activeWeapon} hit // ${damage} damage`);
      return;
    }
    const hit = raycaster.intersectObjects(targets, false)[0];
    drawTracer(raycaster.ray.direction, hit ? hit.distance : 120);
    if (hit) {
      const target = hit.object.parent;
      const targetId = hit.object.userData.ownerId;
      if (targetId) {
        const damage = hit.object.userData.hitZone === 'head' ? Math.min(100, weapons[activeWeapon].damage + 18) : weapons[activeWeapon].damage;
        sendNetwork({ type: 'hit', target: targetId, attacker: player.networkId, damage });
        announce(`${activeWeapon} hit // ${damage} damage`);
        showHitConfirm();
      } else {
        target.userData.health -= hit.object.userData.hitZone === 'head' ? 55 : 34;
        target.userData.hitFlash = .08;
        if (target.userData.health <= 0) {
          target.userData.live = false;
          player.eliminations += 1;
          announce(`Elimination confirmed // ${player.eliminations}`);
          scene.remove(target);
        }
      }
    }
  });
  sendNetwork({ type: 'shot', x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw, pitch });
  updateHud();
}
function reload() {
  if (player.ammo === weapons[activeWeapon].magazine || player.reserve <= 0 || !player.active) return;
  const needed = weapons[activeWeapon].magazine - player.ammo;
  const loaded = Math.min(needed, player.reserve);
  player.ammo += loaded;
  player.reserve -= loaded;
  announce(`Reloaded ${weapons[activeWeapon].name} // ${player.ammo}/${weapons[activeWeapon].magazine}`);
  updateHud();
}
function setScoped(value) {
  scoped = value && activeWeapon === 'marksman';
  scopeOverlay.classList.toggle('hidden', !scoped);
  crosshair.classList.toggle('hidden', scoped);
  camera.fov = scoped ? 34 : baseFov;
  camera.updateProjectionMatrix();
  weapon.visible = !scoped;
}
function updateSettings() {
  sensitivity = Number(sensitivityInput.value);
  scopeSensitivity = Number(scopeSensitivityInput.value);
  sensitivityValue.value = sensitivity.toFixed(1);
  scopeSensitivityValue.value = scopeSensitivity.toFixed(1);
  baseFov = Number(fovInput.value);
  resolutionPreset = resolutionInput.value;
  fovValue.value = `${baseFov}°`;
  localStorage.setItem('neon-arena-sensitivity', sensitivity);
  localStorage.setItem('neon-arena-scope-sensitivity', scopeSensitivity);
  localStorage.setItem('neon-arena-fov', baseFov);
  localStorage.setItem('neon-arena-resolution', resolutionPreset);
  camera.fov = scoped ? 34 : baseFov;
  camera.updateProjectionMatrix();
  applyResolution();
}
function applyResolution() {
  const [width, height] = resolutionPreset.split('x').map(Number);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
}
function canOccupy(x, z) {
  const radius = .55;
  return colliders.every((collider) => {
    if (collider.type === 'circle') {
      const distanceX = x - collider.x;
      const distanceZ = z - collider.z;
      return distanceX * distanceX + distanceZ * distanceZ > (collider.radius + radius) ** 2;
    }
    const closestX = Math.max(collider.x - collider.halfX, Math.min(x, collider.x + collider.halfX));
    const closestZ = Math.max(collider.z - collider.halfZ, Math.min(z, collider.z + collider.halfZ));
    const distanceX = x - closestX;
    const distanceZ = z - closestZ;
    return distanceX * distanceX + distanceZ * distanceZ > radius * radius;
  });
}
function movePlayer(delta) {
  const direction = new THREE.Vector3();
  if (keys.KeyW) direction.z -= 1;
  if (keys.KeyS) direction.z += 1;
  if (keys.KeyA) direction.x -= 1;
  if (keys.KeyD) direction.x += 1;
  if (direction.lengthSq() > 0) direction.normalize();
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const nextX = camera.position.x + direction.x * delta * 8;
  const nextZ = camera.position.z + direction.z * delta * 8;
  if (canOccupy(nextX, camera.position.z)) camera.position.x = nextX;
  if (canOccupy(camera.position.x, nextZ)) camera.position.z = nextZ;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -70, 70);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -70, 70);
  if (keys.Space && player.onGround) { player.velocityY = 5.6; player.onGround = false; }
  player.velocityY -= 14 * delta;
  camera.position.y += player.velocityY * delta;
  if (camera.position.y <= 1.7) { camera.position.y = 1.7; player.velocityY = 0; player.onGround = true; }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
function updateBots(delta) {
  bots.forEach((bot) => {
    if (!bot.userData.live) return;
    bot.lookAt(camera.position.x, bot.position.y + 1, camera.position.z);
    const distance = bot.position.distanceTo(camera.position);
    if (distance > 5) bot.translateZ(-bot.userData.speed * delta);
    else if (bot.userData.cooldown <= 0) {
      player.health = Math.max(0, player.health - 4);
      bot.userData.cooldown = 1.1;
      updateHud();
      announce('Incoming fire // move or take cover');
      if (player.health <= 0) endMatch('Arena lost.', 'The drones breached your shield.');
    }
    bot.userData.cooldown -= delta;
  });
}
function update(delta) {
  if (!player.active || player.paused) return;
  skybox.position.copy(camera.position);
  player.shotCooldown = Math.max(0, player.shotCooldown - delta);
  movePlayer(delta);
  updateBots(delta);
  networkStateAccumulator += delta;
  if (networkStateAccumulator > .06) {
    networkStateAccumulator = 0;
    sendNetwork({ type: 'state', name: player.name, character: player.character, color: player.color, accent: player.accent, x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw, pitch });
  }
  updateHud();
}
function frame() { requestAnimationFrame(frame); const delta = Math.min(clock.getDelta(), .05); update(delta); renderer.render(scene, camera); }

startButton.addEventListener('click', resetMatch);
connectButton.addEventListener('click', connectMultiplayer);
restartButton.addEventListener('click', resetMatch);
resumeButton.addEventListener('click', () => { player.paused = false; pauseCard.classList.add('hidden'); requestArenaPointerLock(); });
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && player.respawning) { event.preventDefault(); respawnPlayer(); return; }
  keys[event.code] = true;
  if (event.code === 'KeyR') reload();
  if (event.code === 'Tab') { event.preventDefault(); scoreboard.classList.remove('hidden'); }
});
window.addEventListener('keyup', (event) => { keys[event.code] = false; if (event.code === 'Tab') scoreboard.classList.add('hidden'); });
window.addEventListener('mousedown', (event) => { if (player.active && document.pointerLockElement !== renderer.domElement) { requestArenaPointerLock(); return; } if (event.button === 0) shoot(); if (event.button === 2) setScoped(true); });
window.addEventListener('mouseup', (event) => { if (event.button === 2) setScoped(false); });
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('mousemove', (event) => { if (!player.active) return; if (document.pointerLockElement !== renderer.domElement && event.target !== renderer.domElement) return; const multiplier = sensitivity * (scoped ? scopeSensitivity : 1); yaw -= event.movementX * .0022 * multiplier; pitch -= event.movementY * .0022 * multiplier; pitch = THREE.MathUtils.clamp(pitch, -1.35, 1.35); });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyResolution(); });
renderer.domElement.addEventListener('click', () => { if (player.active) requestArenaPointerLock(); });
document.addEventListener('pointerlockerror', () => { if (player.active) announce('Mouse lock unavailable // using free aim'); });
document.addEventListener('pointerlockchange', () => { if (player.active && document.pointerLockElement === renderer.domElement) announce('Mouse locked // click to release'); });
settingsButton.addEventListener('click', () => { settingsCard.classList.remove('hidden'); document.exitPointerLock(); });
closeSettings.addEventListener('click', () => settingsCard.classList.add('hidden'));
sensitivityInput.value = sensitivity;
scopeSensitivityInput.value = scopeSensitivity;
fovInput.value = baseFov;
resolutionInput.value = resolutionPreset;
sensitivityInput.addEventListener('input', updateSettings);
scopeSensitivityInput.addEventListener('input', updateSettings);
fovInput.addEventListener('input', updateSettings);
resolutionInput.addEventListener('change', updateSettings);
nameInput.value = player.name;
startButton.disabled = false;
function selectCustomization(collection, selected, attribute) {
  collection.forEach((option) => {
    const isSelected = option === selected;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-pressed', String(isSelected));
  });
}
function updateColorPreview() {
  colorPreview.style.setProperty('--suit-color', player.color);
  colorPreview.style.setProperty('--visor-color', player.accent);
}
colorSwatches.forEach((option) => option.addEventListener('click', () => {
  player.color = option.dataset.color;
  localStorage.setItem('neon-arena-color', player.color);
  selectCustomization(colorSwatches, option);
  updateColorPreview();
}));
accentSwatches.forEach((option) => option.addEventListener('click', () => {
  player.accent = option.dataset.accent;
  localStorage.setItem('neon-arena-accent', player.accent);
  selectCustomization(accentSwatches, option);
  updateColorPreview();
}));
updateColorPreview();
nameInput.addEventListener('input', () => {
  const valid = nameInput.value.trim().length >= 2 && nameInput.value.trim().toLowerCase() !== 'pilot';
  startButton.disabled = !valid;
  if (valid) networkStatus.textContent = 'Ready to connect // profile incomplete until confirmed';
});
updateSettings();
updateHud();
frame();
