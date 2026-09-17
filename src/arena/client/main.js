// Entry point: boots the renderer, wires server messages to the game systems
// and runs the frame loop.
import * as THREE from 'three';
import { GADGETS, VARIANT_NAMES, WEAPONS } from '../shared/constants.js';
import { bus, game, isEnemy, nameOf, saveSettings } from './state.js';
import { net } from './net.js';
import { Arena } from './world.js';
import { Operators } from './characters.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { SoundViz } from './soundviz.js';
import { LocalPlayer, MATERIAL_SOUND } from './player.js';
import { Hud, roundIntroVoice } from './hud.js';
import { announce, play, playImpact, playShot, setAmbience, setAmbienceShelter, setListener, setVolume, stopAllLoops, unlockAudio } from './audio.js';
import { attachReport, hideEnd, lobbyChat, openSettings, refreshEnd, renderHome, renderLobby, renderPreview, renderTutorial, showEnd, showScreen, toast } from './menu.js';

const root = document.querySelector('#game-root');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
root.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(game.settings.fov, innerWidth / innerHeight, 0.06, 1500);
camera.rotation.order = 'YXZ';
const arena = new Arena(renderer);
arena.loadMap('yard');
arena.setVariant('dusk');
arena.setQuality(game.settings.quality);
arena.scene.add(camera);
const operators = new Operators(arena.scene, () => arena.physics);
const effects = new Effects(arena.scene);
const viewmodel = new ViewModel();
viewmodel.setLook(game.look.color, game.look.accent);
const player = new LocalPlayer({ camera, arena, viewmodel, effects, operators, canvas: renderer.domElement });
const hud = new Hud({ player, arena, operators });
const soundViz = new SoundViz(camera);
const pauseCard = document.querySelector('#pause-card');
const settingsCard = document.querySelector('#settings-card');
const endCard = document.querySelector('#end-card');
const visible = (element) => !element.classList.contains('hidden');
player.uiBlocked = () => hud.blocking || visible(pauseCard) || visible(settingsCard) || visible(endCard);

let afterIdentity = null;
let inviteHandled = false;
let currentVariant = null;
let pendingEnd = null;
bus.on('after-identity', (callback) => { afterIdentity = callback; });
bus.on('look', () => viewmodel.setLook(game.look.color, game.look.accent));
bus.on('settings', () => { arena.setQuality(game.settings.quality); });
arena.onThunder = (delay) => { hud.flash(); setTimeout(() => play('thunder', { volume: 0.9 }), delay * 1000); };
addEventListener('pointerdown', unlockAudio, { capture: true });
addEventListener('keydown', unlockAudio, { capture: true });

function applyVariant(variant) {
  if (variant === currentVariant) return;
  currentVariant = variant;
  arena.setVariant(variant);
  if (game.screen === 'game') setAmbience(variant);
}

function feed(text, tone) { if (game.screen === 'game') hud.notice(text, tone); else toast(text, tone); }

// ---------------------------------------------------------------- lobby / identity
net.on('identity', (message) => {
  game.profile = message.profile; game.online = message.online; game.publicRooms = message.rooms; game.dailyModifier = message.modifier;
  if (game.screen === 'home') renderHome();
  if (afterIdentity) { const callback = afterIdentity; afterIdentity = null; callback(); return; }
  const invite = new URLSearchParams(location.search).get('room');
  if (invite && !inviteHandled && game.screen === 'home') { inviteHandled = true; toast(`Joining room ${invite}…`); net.enter({ action: 'join', room: invite }); }
});
net.on('error', (message) => { toast(message.message, 'warn'); play('deny'); });
net.on('rejoin-failed', () => { toast('Your seat was released. Back to the lobby.', 'warn'); leaveToHome(); });
net.on('left', (message) => { game.profile = message.profile; game.publicRooms = message.rooms; leaveToHome(); });

function leaveToHome() {
  game.room = null; game.id = null; game.you = null; game.roster.clear(); game.marks.clear();
  operators.clear(); stopAllLoops(); setAmbience(null);
  player.mode = 'idle'; player.alive = false;
  hud.show(false); hideEnd(); pauseCard.classList.add('hidden');
  document.exitPointerLock?.();
  pendingEnd = null;
  if (arena.map.id !== 'yard') { arena.loadMap('yard'); hud.layers = null; }
  showScreen('home');
}

net.on('welcome', (message) => {
  game.id = message.id;
  net.holdRoom(message.room);
  operators.clear();
  game.marks.clear();
  arena.loadMap(message.map);
  hud.layers = null;
  arena.resetRound();
  message.broken.forEach((id) => arena.breakGlass(id));
  message.shields.forEach((shield) => arena.addShield(shield, !isEnemyTeam(shield.team)));
  arena.setBarriers(Boolean(message.barriers));
  if (message.reconnected) toast('Reconnected to your match.', 'good');
});
const isEnemyTeam = (team) => team !== (game.roster.get(game.id)?.team || 'A');

net.on('room', (message) => {
  const previousPhase = game.room?.phase;
  game.room = message;
  game.roster.clear();
  message.players.forEach((entry) => game.roster.set(entry.id, entry));
  player.gravityScale = message.rules.modifier === 'lowgrav' ? 0.34 : 1;
  applyVariant(message.variant);
  if (message.phase === 'lobby') {
    if (game.screen !== 'lobby') { hud.show(false); hideEnd(); setAmbience(null); document.exitPointerLock?.(); player.mode = 'idle'; }
    showScreen('lobby');
    return;
  }
  if (game.screen !== 'game') {
    showScreen('game');
    hud.show(true);
    setAmbience(message.variant);
    renderTutorial(message.mode === 'range');
    document.querySelector('#controls-hint').classList.toggle('hidden', false);
    if (message.mode === 'range') toast('Practice range: everything is free. Press B for the armoury.', 'info');
  }
  if (previousPhase !== message.phase && message.phase === 'buy') arena.setBarriers(true);
  hud.renderScoreboard();
  refreshEnd();
  if (!player.alive && message.phase !== 'matchEnd' && player.mode === 'idle') { player.mode = 'spectate'; player.cycleSpectate(1); }
});

net.on('you', (message) => {
  const previous = game.you;
  game.you = message;
  player.onYou(previous);
  if (hud.buyOpen) hud.renderBuy();
});

net.on('match-start', (message) => { hideEnd(); pendingEnd = null; applyVariant(message.variant); toast(`${VARIANT_NAMES[message.variant]} over Kestrel Yard.`); });

net.on('spawn', (message) => {
  hideEnd();
  pauseCard.classList.add('hidden');
  player.onSpawn(message);
  if (game.screen === 'game' && !message.keep) player.lock();
});

net.on('round', (message) => {
  arena.resetRound();
  arena.setBarriers(true);
  effects.clearRound();
  operators.clearCorpses();
  game.marks.clear();
  hud.blips.clear();
  if (game.room) { game.room.phase = 'buy'; game.room.round = message.round; game.room.scores = message.scores; }
  const title = message.decider ? 'DECIDER' : message.matchPoint ? 'MATCH POINT' : `ROUND ${message.round}`;
  hud.banner(title, message.swapped ? 'Sides switched — you now attack from the other gate.' : 'Buy phase — press B for the armoury', message.swapped ? 'SWITCHING SIDES' : 'KESTREL YARD', 'neutral', 3200);
  announce(roundIntroVoice(message), true);
  setTimeout(() => { if (game.room?.phase === 'buy' && player.alive && !player.uiBlocked()) hud.openBuy(); }, 1100);
});

net.on('phase', (message) => {
  if (!game.room) return;
  game.room.phase = message.phase; game.room.phaseEnds = message.phaseEnds;
  if (message.phase === 'live') {
    arena.setBarriers(false);
    hud.closeBuy();
    hud.prompt('');
    hud.banner('ENGAGE', 'One life. Make every shot count.', '', 'go', 1500);
    play('roundStart');
  }
  if (message.phase === 'overtime') {
    hud.banner('SUDDEN DEATH', 'Every pilot is revealed. Every hit is lethal.', 'OVERTIME', 'danger', 3200);
    play('overtime'); announce('Sudden death.', true);
  }
});

net.on('round-end', (message) => {
  if (!game.room) return;
  game.room.phase = 'roundEnd'; game.room.phaseEnds = message.phaseEnds; game.room.scores = message.scores;
  hud.closeBuy(false);
  const mine = game.roster.get(game.id)?.team;
  const won = message.winner === mine;
  const reason = { elimination: won ? 'Rival team eliminated.' : 'Your team was eliminated.', timeout: 'Time ran out — survivors and damage decided it.', draw: 'Nobody left standing. Round replayed.' }[message.reason] || '';
  const tags = message.tags.length ? message.tags.join(' · ') : '';
  const hero = message.hero ? ` — ${nameOf(message.hero)}` : '';
  if (!message.winner) hud.banner('DRAW', reason, '', 'neutral', 3800);
  else hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, tags ? `${tags}${hero}` : `${message.scores[mine]} – ${message.scores[mine === 'A' ? 'B' : 'A']}`, won ? 'win' : 'loss', 3800);
  play(won ? 'roundWin' : 'roundLoss');
  // Let the banner land, then everyone watches the kill that ended the round.
  const replay = message.replay;
  if (replay && Object.keys(replay.tracks || {}).length) setTimeout(() => { if (game.room?.phase === 'roundEnd' && game.screen === 'game') player.startRoundReplay(replay); }, 1400);
  if (message.tags.includes('ACE')) announce('Ace.'); else if (message.tags.includes('CLUTCH')) announce('Clutch.'); else if (message.tags.includes('FLAWLESS')) announce('Flawless.');
});

net.on('match-end', (message) => {
  if (game.room) { game.room.phase = 'matchEnd'; game.room.phaseEnds = message.phaseEnds; }
  hud.closeBuy(false);
  const mine = game.roster.get(game.id)?.team;
  const won = message.winner === mine;
  const finish = () => {
    document.exitPointerLock?.();
    showEnd(message);
    if (pendingEnd?.report) attachReport(pendingEnd.report);
    pendingEnd = { shown: true };
    play(message.winner ? (won ? 'matchWin' : 'matchLoss') : 'roundLoss');
    announce(message.winner ? (won ? 'Victory.' : 'Defeat.') : 'Stalemate.', true);
  };
  pendingEnd = { report: null };
  if (message.replay && Object.keys(message.replay.tracks).length) {
    let finished = false;
    const once = () => { if (finished) return; finished = true; finish(); };
    player.startFinalReplay(message.replay, once);
    setTimeout(() => { if (!finished) { operators.stopReplay(); player.endPov(); bus.emit('pov-card', null); operators.hidden = null; player.mode = 'idle'; once(); } }, 9000);
  } else finish();
});

net.on('report', (message) => {
  game.profile = message.profile;
  if (pendingEnd?.shown) attachReport(message.report); else if (pendingEnd) pendingEnd.report = message.report;
});

// ---------------------------------------------------------------- combat events
net.on('s', (message) => operators.onSnapshot(message));
net.on('gone', (message) => operators.remove(message.id));
net.on('correct', (message) => player.onCorrect(message));

net.on('shot', (message) => {
  const weapon = WEAPONS[message.w];
  const shooter = game.roster.get(message.id);
  const origin = message.o;
  const muzzle = [origin[0], origin[1] - 0.12, origin[2]];
  // Spectating the shooter: the tracer leaves the gun we are looking down.
  if (player.mode === 'spectate' && player.pov?.owner === message.id) player.povShot({ weapon: message.w, ends: message.e }, { quiet: true });
  else message.e.forEach((end) => {
    effects.tracer(muzzle, end, shooter?.tracer || '#ffc857', 0.012 + weapon.tracer * 0.012);
    if (weapon.id === 'm44') effects.trail(muzzle, end);
    player.nearMiss(origin, end, message.id);
  });
  message.i.slice(0, 6).forEach(([x, y, z, nx, ny, nz, mat, exit], index) => { effects.impact([x, y, z], [nx, ny, nz], mat, Boolean(exit)); if (!exit && index < 2) playImpact(MATERIAL_SOUND(mat), [x, y, z], 0.6); });
  effects.muzzleLight(new THREE.Vector3(...muzzle), '#ffb45e', arena.variantName === 'night' ? 46 : 22);
  playShot(weapon.id, origin);
  bus.emit('sound', { kind: 'shot', id: message.id, pos: origin });
  // Loud weapons give away the shooter on the minimap.
  const distance = Math.hypot(origin[0] - camera.position.x, origin[2] - camera.position.z);
  if (isEnemy(message.id) && distance < weapon.loud * 0.9) hud.blip(message.id, origin[0], origin[2], 2.5);
});

net.on('swing', (message) => { const pose = operators.poseOf(message.id); if (player.mode === 'spectate' && player.pov?.owner === message.id) viewmodel.melee(); if (pose) { play(message.hit ? 'stab' : 'swing', { pos: [pose.x, pose.y + 1.2, pose.z] }); bus.emit('sound', { kind: 'swing', id: message.id, pos: [pose.x, pose.y, pose.z] }); } });

net.on('hit', (message) => {
  if (message.blocked) { hud.hitmarker('blocked'); play('deny', { volume: 0.5 }); return; }
  if (message.decoy) { hud.hitmarker('blocked'); hud.notice('That was a decoy — you are marked!', 'warn'); play('decoyPop'); return; }
  hud.hitmarker(message.killed ? 'kill' : message.zone === 'head' ? 'head' : 'body');
  play(message.zone === 'head' ? 'headshot' : 'hitmarker');
  if (message.helmetBroke) play('helmet', { volume: 0.5 });
  if (message.killed) play('kill', { delay: 0.08 });
  bus.emit('tutorial', 'hit');
  if (message.zone === 'head') bus.emit('tutorial', 'headshot');
  if (message.wallbang) bus.emit('tutorial', 'wallbang');
});

net.on('hurt', (message) => {
  hud.damageFrom(message.x, message.z);
  play('hurt');
  if (message.helmetBroke) { play('helmet'); hud.notice('Helmet destroyed', 'warn'); }
});

net.on('kill', (message) => {
  hud.killFeed(message);
  const mine = message.victim === game.id;
  operators.kill(message.victim, mine ? { x: player.body.x, y: player.body.y, z: player.body.z, yaw: player.yaw } : null);
  const entry = game.roster.get(message.victim);
  if (entry) entry.alive = false;
  if (mine) player.onDeath();
  else if (message.killer === game.id && game.room?.mode !== 'range') hud.notice(`Eliminated ${nameOf(message.victim)}${message.zone === 'head' ? ' — headshot' : ''}${message.distance >= 50 ? ` — ${message.distance} m` : ''}`, 'good');
  if (player.mode === 'spectate' && message.victim === player.spectateId) player.cycleSpectate(1);
});
net.on('killcam', (message) => { player.pendingKillcam = message.replay; });
net.on('clutch', (message) => { hud.banner('LAST ONE STANDING', `1 v ${message.rivals} — they can hear your heartbeat.`, 'CLUTCH', 'danger', 2800); play('clutch'); announce('Last one standing.', true); });

net.on('glass', (message) => {
  const box = arena.breakGlass(message.id);
  if (!box) return;
  effects.shatter(box);
  bus.emit('sound', { kind: 'glass', pos: [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2] });
  play('glassBreak', { pos: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2], ref: 7 });
});
net.on('shield', (message) => { arena.addShield(message, !isEnemyTeam(message.team)); play('shield', { pos: [(message.min[0] + message.max[0]) / 2, message.min[1] + 0.8, (message.min[2] + message.max[2]) / 2] }); });
net.on('shield-hit', (message) => arena.flashShield(message.id));
net.on('shield-end', (message) => { const position = arena.removeShield(message.id); if (position) { effects.burst([position.x, position.y, position.z], '#9fe4ff', 40); play('shieldBreak', { pos: [position.x, position.y, position.z] }); } });
net.on('pulse', (message) => {
  effects.ring(message.x, message.y, message.z, message.radius, isEnemy(message.id) ? '#ff7148' : '#6ce6d1');
  play('pulse', { pos: message.id === game.id ? null : [message.x, message.y + 1, message.z], ref: 10 });
  if (message.id === game.id) hud.notice(message.found ? `Radar pulse — ${message.found} rival${message.found === 1 ? '' : 's'} revealed` : 'Radar pulse — nobody in range', message.found ? 'good' : 'info');
});
net.on('mark', (message) => {
  const fresh = !game.marks.has(message.id) || game.marks.get(message.id).until < net.time();
  game.marks.set(message.id, { until: message.until, reason: message.reason });
  if (fresh && message.reason !== 'overtime') play('marked', { volume: 0.6 });
});
net.on('gadget-used', (message) => {
  const gadget = GADGETS[message.gadget];
  const self = message.id === game.id;
  const pos = self ? null : [message.x, message.y + 1, message.z];
  if (pos && message.gadget !== 'ghost') bus.emit('sound', { kind: 'gadget', id: message.id, pos });
  if (message.gadget === 'stim') play('stim', { pos });
  if (message.gadget === 'decoy') play('decoy', { pos });
  if (message.gadget === 'ghost' && (self || !isEnemy(message.id))) play('ghost', { pos });
  if (self) { hud.notice(`${gadget.name} deployed`, 'good'); if (message.gadget === 'ghost') player.ghostUntil = performance.now() / 1000 + gadget.duration; }
});
net.on('decoy-end', (message) => { if (message.popped) { effects.burst([message.x, message.y + 1, message.z], '#6ce6d1', 50); play('decoyPop', { pos: [message.x, message.y + 1, message.z] }); } });
net.on('drone-start', (message) => player.startDrone(message));
net.on('drone-end', (message) => {
  if (message.id === game.id) { player.endDrone(); if (message.destroyed) hud.notice(`Drone destroyed by ${nameOf(message.by)}`, 'warn'); }
  if (message.destroyed) { effects.burst([message.x, message.y, message.z], '#ffb45e', 40); play('droneDown', { pos: [message.x, message.y, message.z] }); if (message.by === game.id) hud.notice('Recon drone destroyed', 'good'); }
});

// ---------------------------------------------------------------- social
net.on('ping-loc', (message) => {
  effects.ping(message.x, message.y, message.z, message.where, message.danger);
  hud.addPing(message.x, message.z, message.danger);
  hud.notice(`${nameOf(message.from)} ${message.danger ? 'spotted a rival at' : 'pinged'} ${message.where}`, message.danger ? 'warn' : 'info');
  play('ping');
});
net.on('chat', (message) => { if (game.screen === 'lobby') { lobbyChat(message); play('chat'); } else hud.chat(message); });
net.on('quick', (message) => {
  const command = { push: 'Pushing now', hold: 'Hold this angle', help: 'Need backup', spotted: 'Rival spotted', nice: 'Nice shot', sorry: 'My bad' }[message.id];
  hud.chat({ name: message.name, team: game.roster.get(game.id)?.team, text: `${command} — ${message.where}`, scope: 'team' });
  if (message.from !== game.id) announce(command);
});
net.on('react', (message) => feed(`${message.name} ${message.emoji}`, 'info'));
net.on('feed', (message) => feed(message.text, message.tone));
net.on('notice', (message) => { feed(message.text, message.tone); if (message.tone === 'warn') play('deny', { volume: 0.6 }); });

// ---------------------------------------------------------------- pause / leave
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) { pauseCard.classList.add('hidden'); return; }
  if (game.screen === 'game' && player.alive && !hud.blocking && !visible(settingsCard) && !visible(endCard)) pauseCard.classList.remove('hidden');
});
document.querySelector('#resume-button').addEventListener('click', () => { pauseCard.classList.add('hidden'); player.lock(); });
document.querySelector('#pause-settings').addEventListener('click', () => { pauseCard.classList.add('hidden'); openSettings(); });
document.querySelector('#leave-button').addEventListener('click', () => { play('uiBack'); net.leaveRoom(); });
bus.on('settings-closed', () => { if (game.screen === 'game' && player.alive) pauseCard.classList.remove('hidden'); });
bus.on('key', (code) => {
  if (code !== 'Escape' || game.screen !== 'game') return;
  // Dead pilots have no pointer lock to drop, so Escape opens the menu directly.
  if (!player.alive && !visible(endCard)) pauseCard.classList.toggle('hidden');
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
let orbit = 0;
let heartbeat = 0;
// Step graphics down automatically when a machine cannot hold a playable frame rate.
let slowTime = 0;
function watchFrameRate(rawDt) {
  if (game.screen !== 'game' || document.hidden || game.settings.quality === 'low') { slowTime = 0; return; }
  slowTime = rawDt > 1 / 38 ? slowTime + rawDt : Math.max(0, slowTime - rawDt * 2);
  if (slowTime < 4) return;
  slowTime = 0;
  game.settings.quality = game.settings.quality === 'high' ? 'medium' : 'low';
  saveSettings();
  toast(`Graphics lowered to ${game.settings.quality} to keep the frame rate up. Change it back in Settings.`, 'info');
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  watchFrameRate(rawDt);
  const dt = Math.min(rawDt, 0.05); // simulation step
  const wallDt = Math.min(rawDt, 0.3); // cinematic timers (death cam, replays) follow the wall clock even on slow machines
  if (game.screen === 'game') {
    player.update(dt, wallDt);
    if (game.room?.phase === 'buy' && player.alive && !hud.buyOpen) hud.prompt('B — OPEN ARMOURY'); else if (game.room?.phase !== 'range') hud.prompt('');
    if (player.alive && game.you && game.you.hp < 35) { heartbeat -= dt; if (heartbeat <= 0) { heartbeat = 0.9; play('heartbeat', { volume: 0.8 }); } }
  } else {
    // Slow cinematic drift over the yard behind the menus.
    orbit += dt * 0.035;
    camera.position.set(Math.sin(orbit) * 46, 15 + Math.sin(orbit * 1.7) * 4, Math.cos(orbit) * 58);
    camera.lookAt(0, 2, 0);
    const debugCam = window.__arena?.debugCam; // handy for screenshots: { pos: [x,y,z], look: [x,y,z] }
    if (debugCam) { camera.position.set(...debugCam.pos); camera.lookAt(...debugCam.look); }
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  }
  operators.update(dt, net.time(), camera, wallDt);
  effects.update(dt);
  arena.update(dt, camera);
  camera.updateMatrixWorld();
  setListener(camera);
  setAmbienceShelter(Math.max(arena.shelter, camera.position.y < -0.8 ? 1 : 0));
  hud.update(dt);
  soundViz.update();
  renderer.clear();
  renderer.render(arena.scene, camera);
  if (game.screen === 'game' && (player.mode === 'play' || player.pov) && !viewmodel.hidden) { renderer.clearDepth(); renderer.render(viewmodel.scene, viewmodel.camera); }
  renderPreview();
}

setVolume(game.settings.volume);
showScreen('home');
net.connect();
frame();
window.__arena = { game, net, player, hud, arena, operators, effects, renderer, camera, viewmodel };
