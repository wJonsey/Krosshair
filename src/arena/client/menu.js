// Everything outside the match: home screen, career, lobby, settings,
// end-of-match report, share card, tutorial checklist, toasts.
import * as THREE from 'three';
import { BOT_DIFFICULTY, COSMETICS, MASTERY_TIERS, MODIFIERS, VARIANT_NAMES, WEAPONS, levelFromXp, masteryTier, rankName, xpForLevel } from '../shared/constants.js';
import { bus, game, saveSettings, store, DEFAULT_SETTINGS } from './state.js';
import { net } from './net.js';
import { play, setVolume, unlockAudio } from './audio.js';
import { buildOperator, styleOperator, animateOperator } from './characters.js';

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const home = $('#home'), lobby = $('#lobby'), endCard = $('#end-card'), settingsCard = $('#settings-card'), toasts = $('#toasts'), netBanner = $('#net-banner');
let preview = null;
let lobbyTimer = null;
let endState = null;
let lobbyLines = [];
let lobbyRoom = null;

export function toast(text, tone = 'info') {
  const line = document.createElement('div');
  line.className = `toast tone-${tone}`;
  line.textContent = text;
  toasts.append(line);
  setTimeout(() => line.classList.add('out'), 3600);
  setTimeout(() => line.remove(), 4200);
}

function onlineLabel(state = net.connected ? 'open' : 'closed') {
  if (state === 'connecting') return 'CONNECTING…';
  if (state !== 'open') return 'RELAY OFFLINE';
  return net.identified ? `${game.online} ONLINE` : 'RELAY ONLINE';
}

function validName() { return game.name.trim().length >= 2; }

// ------------------------------------------------------------------ operator preview
function ensurePreview(canvas) {
  if (preview?.canvas === canvas) return;
  preview?.renderer.dispose();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 200, canvas.clientHeight || 260, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#bcd3f0', '#1b1f26', 1.3));
  const key = new THREE.DirectionalLight('#ffd2a1', 2.4); key.position.set(-2, 3, 2); scene.add(key);
  const rim = new THREE.DirectionalLight('#6ce6d1', 1.8); rim.position.set(2, 1.5, -2.5); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, (canvas.clientWidth || 200) / (canvas.clientHeight || 260), 0.1, 20);
  camera.position.set(0, 1.25, 3.7);
  camera.lookAt(0, 0.98, 0);
  const model = buildOperator(game.look.color, game.look.accent);
  styleOperator(model, { team: 'friend' });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.05, 40), new THREE.MeshStandardMaterial({ color: '#141a20', roughness: 0.4, metalness: 0.6 }));
  disc.position.y = -0.03;
  scene.add(model, disc);
  preview = { canvas, renderer, scene, camera, model, last: performance.now() };
}
export function renderPreview() {
  if (!preview || home.classList.contains('hidden') || !preview.canvas.isConnected) return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - preview.last) / 1000);
  preview.last = now;
  preview.model.rotation.y = Math.PI + Math.sin(now / 2600) * 0.9;
  animateOperator(preview.model, { speed: 0, crouch: false, pitch: Math.sin(now / 1700) * 0.08, weapon: 'm44', dt });
  preview.renderer.render(preview.scene, preview.camera);
}
function refreshPreviewLook() { if (preview) styleOperator(preview.model, { color: game.look.color, accent: game.look.accent }); }

// ------------------------------------------------------------------ home
function swatchRow(kind, key, level) {
  return COSMETICS[kind].map((item) => {
    const locked = level < item.level;
    const selected = game.look[key] === item.id;
    return `<button type="button" class="swatch${selected ? ' selected' : ''}${locked ? ' locked' : ''}" data-kind="${key}" data-value="${item.id}" style="--swatch:${item.id}" title="${item.name}${locked ? ` — unlocks at level ${item.level}` : ''}" aria-pressed="${selected}" ${locked ? 'aria-disabled="true"' : ''}>${locked ? `<small>${item.level}</small>` : ''}</button>`;
  }).join('');
}

function careerHtml() {
  const profile = game.profile;
  if (!profile) return `<div class="panel"><p class="eyebrow">Career</p><p class="muted">${net.connected ? 'Enter a callsign to load your career, contracts and unlocks.' : 'Connecting to the relay…'}</p></div>`;
  const level = profile.level, base = xpForLevel(level), next = xpForLevel(level + 1);
  const progress = Math.round(((profile.xp - base) / (next - base)) * 100);
  const s = profile.stats;
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  const accuracy = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  const ranked = profile.rankedMatches > 0;
  const contracts = profile.contracts.map((c) => `<div class="contract${c.done ? ' done' : ''}"><div><span>${escapeHtml(c.text)}</span><em>+${c.xp} XP</em></div><div class="meter"><i style="width:${Math.round((c.progress / c.n) * 100)}%"></i></div><small>${c.done ? 'COMPLETE' : `${c.progress} / ${c.n}`}</small></div>`).join('');
  const mastery = Object.values(WEAPONS).map((weapon) => {
    const kills = profile.weapons[weapon.id]?.kills || 0;
    const tier = masteryTier(kills);
    const nextTier = MASTERY_TIERS[tier + 1];
    return `<div class="mastery tier-${tier}"><span>${weapon.name}</span><b>${MASTERY_TIERS[tier][1]}</b><small>${kills} kills${nextTier ? ` · ${nextTier[0] - kills} to ${nextTier[1]}` : ' · maxed'}</small></div>`;
  }).join('');
  const history = profile.history.length ? profile.history.slice(0, 8).map((h) => `<div class="history-row ${h.result}"><b>${h.result.toUpperCase()}</b><span>${h.score}</span><span>${h.kills}/${h.deaths}/${h.assists}</span><span>${(h.mode || '').toUpperCase()}${h.mvp ? ' · MVP' : ''}</span><small>${h.rating === null ? '' : `${h.rating >= 0 ? '+' : ''}${h.rating} SR · `}${new Date(h.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`).join('') : '<p class="muted">No matches yet. Your last 25 results land here.</p>';
  const recent = profile.recent.length ? `<p class="recent"><span>RECENT PILOTS</span> ${profile.recent.map(escapeHtml).join(' · ')}</p>` : '';
  return `
    <div class="panel career"><p class="eyebrow">Career</p>
      <div class="level-row"><b class="level">${level}</b><div><strong>${escapeHtml(game.look.title)} ${escapeHtml(profile.name)}</strong><div class="meter"><i style="width:${progress}%"></i></div><small>${profile.xp - base} / ${next - base} XP to level ${level + 1}</small></div><div class="rank"><span>${rankName(profile.rating, ranked).toUpperCase()}</span><b>${ranked ? profile.rating : '—'}</b><small>SKILL RATING</small></div></div>
      <div class="stat-grid"><div><b>${s.matches}</b><span>MATCHES</span></div><div><b>${winRate}%</b><span>WIN RATE</span></div><div><b>${kd}</b><span>K / D</span></div><div><b>${accuracy}%</b><span>ACCURACY</span></div><div><b>${s.headshots}</b><span>HEADSHOTS</span></div><div><b>${s.longest} M</b><span>LONGEST KILL</span></div><div><b>${s.clutches}</b><span>CLUTCHES</span></div><div><b>${s.mvps}</b><span>MVPS</span></div></div>
    </div>
    <div class="panel"><p class="eyebrow">Daily contracts <small>reset at 00:00 UTC</small></p>${contracts}</div>
    <div class="panel tabs"><div class="tab-head"><button type="button" class="tab active" data-tab="history">Match history</button><button type="button" class="tab" data-tab="mastery">Weapon mastery</button></div><div class="tab-body" data-body="history">${history}${recent}</div><div class="tab-body hidden" data-body="mastery">${mastery}</div></div>`;
}

export function renderHome() {
  const level = game.profile?.level || 1;
  const modifier = MODIFIERS[game.dailyModifier] || MODIFIERS.headhunter;
  const rooms = game.publicRooms.length ? game.publicRooms.map((room) => `<button type="button" class="room-row" data-join="${escapeHtml(room.name)}"><b>${escapeHtml(room.name)}</b><span>${room.queue.toUpperCase()}</span><span>${room.players + room.bots}/${room.max}</span><small>${room.phase === 'lobby' ? 'IN LOBBY' : `LIVE ${room.scores.A}–${room.scores.B}`}</small></button>`).join('') : '<p class="muted">No public rooms right now. Start one, or warm up against bots.</p>';
  const inviteRoom = new URLSearchParams(location.search).get('room') || '';
  // Re-renders happen whenever the profile or look changes; keep whatever the pilot has typed.
  const keep = { room: $('#room-input')?.value, isPublic: $('#room-public')?.checked, name: $('#name-input')?.value, focus: document.activeElement?.id, tab: home.querySelector('.tab.active')?.dataset.tab };
  home.innerHTML = `
    <div class="home-grid">
      <section class="home-left">
        <p class="eyebrow">Tactical sniper duels // best of nine // one life</p>
        <h1>Sniper<br /><em>Shootout.</em></h1>
        <label class="callsign-field">Callsign<input id="name-input" maxlength="16" placeholder="Enter a callsign" autocomplete="nickname" value="${escapeHtml(game.name)}" /></label>
        <div class="operator-panel">
          <canvas id="operator-preview" width="200" height="260"></canvas>
          <div class="operator-options">
            <span class="field-label">Suit</span><div class="swatches">${swatchRow('suit', 'color', level)}</div>
            <span class="field-label">Visor</span><div class="swatches">${swatchRow('visor', 'accent', level)}</div>
            <span class="field-label">Tracer</span><div class="swatches">${swatchRow('tracer', 'tracer', level)}</div>
            <span class="field-label">Title</span><select id="title-select">${COSMETICS.title.map((t) => `<option value="${t.id}" ${game.look.title === t.id ? 'selected' : ''} ${level < t.level ? 'disabled' : ''}>${t.name}${level < t.level ? ` — level ${t.level}` : ''}</option>`).join('')}</select>
          </div>
        </div>
        <div class="home-foot"><span id="online-count"><i class="live-dot"></i>${onlineLabel()}</span><button type="button" id="open-settings" class="ghost-button">Settings</button><button type="button" id="open-controls" class="ghost-button">Controls</button></div>
      </section>
      <section class="home-mid">
        <button type="button" class="play-card primary" data-play="casual"><small>QUICK PLAY</small><strong>Find a match</strong><span>Casual queue. Bots fill empty seats so you never wait.</span></button>
        <div class="play-row">
          <button type="button" class="play-card" data-play="ranked"><small>RANKED</small><strong>Climb the ladder</strong><span>Real rivals only. Skill rating on the line.</span></button>
          <button type="button" class="play-card" data-play="arcade"><small>ARCADE // TODAY</small><strong>${modifier.name}</strong><span>${modifier.desc}</span></button>
        </div>
        <div class="play-row">
          <div class="play-card split"><small>BOT MATCH</small><strong>3v3 vs bots</strong><div class="difficulty">${Object.entries(BOT_DIFFICULTY).map(([id, d]) => `<button type="button" data-bots="${id}">${d.name}</button>`).join('')}</div></div>
          <button type="button" class="play-card" data-play="range"><small>PRACTICE RANGE</small><strong>${game.tutorialDone ? 'Warm up' : 'Learn the ropes'}</strong><span>Free gear, moving targets, guided drills.</span></button>
        </div>
        <div class="panel private"><p class="eyebrow">Private room</p><div class="room-row-input"><input id="room-input" maxlength="24" placeholder="room-code" value="${escapeHtml(inviteRoom)}" /><button type="button" id="join-room">Create / join <span>↗</span></button></div><label class="check"><input type="checkbox" id="room-public" /> List this room publicly</label><small class="muted">Custom rules, team select, bots and a shareable invite link.</small></div>
        <div class="panel"><p class="eyebrow">Live rooms</p><div id="room-list">${rooms}</div></div>
      </section>
      <section class="home-right">${careerHtml()}</section>
    </div>`;
  if (keep.room !== undefined) $('#room-input').value = keep.room;
  if (keep.isPublic) $('#room-public').checked = true;
  if (keep.name !== undefined) $('#name-input').value = keep.name;
  if (keep.tab === 'mastery') {
    home.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'mastery'));
    home.querySelectorAll('.tab-body').forEach((body) => body.classList.toggle('hidden', body.dataset.body !== 'mastery'));
  }
  if (keep.focus && home.querySelector(`#${keep.focus}`)) { const field = home.querySelector(`#${keep.focus}`); field.focus(); if (field.setSelectionRange && field.type === 'text') field.setSelectionRange(field.value.length, field.value.length); }
  ensurePreview($('#operator-preview'));
  refreshPreviewLook();
}

function saveLook() { store('look', game.look); refreshPreviewLook(); net.send({ type: 'look', look: game.look }); bus.emit('look'); }

function play_(payload) {
  unlockAudio();
  const input = $('#name-input');
  if (input) game.name = input.value.trim().slice(0, 16);
  if (!validName()) { toast('Choose a callsign with at least 2 characters first.', 'warn'); input?.focus(); play('deny'); return; }
  if (!net.connected) { toast('Still connecting to the relay… start the server with npm run arena.', 'warn'); return; }
  store('name', game.name);
  play('ready');
  const go = () => net.enter(payload);
  if (!net.identified || game.profile?.name !== game.name) { bus.emit('after-identity', go); net.identify(); } else go();
}

home.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.kind) {
    if (target.classList.contains('locked')) { toast(target.title, 'warn'); return; }
    game.look[target.dataset.kind] = target.dataset.value;
    saveLook(); play('ui'); renderHome();
  } else if (target.dataset.play) play_(target.dataset.play === 'range' ? { action: 'range' } : { action: 'quick', queue: target.dataset.play });
  else if (target.dataset.bots) play_({ action: 'bots', difficulty: target.dataset.bots });
  else if (target.dataset.join) play_({ action: 'join', room: target.dataset.join });
  else if (target.id === 'join-room') {
    const code = $('#room-input').value.trim() || `room-${Math.random().toString(36).slice(2, 6)}`;
    play_({ action: 'join', room: code, isPublic: $('#room-public').checked });
  } else if (target.id === 'open-settings') openSettings();
  else if (target.id === 'open-controls') openSettings(true);
  else if (target.dataset.tab) {
    home.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === target));
    home.querySelectorAll('.tab-body').forEach((body) => body.classList.toggle('hidden', body.dataset.body !== target.dataset.tab));
    play('ui');
  }
});
home.addEventListener('change', (event) => {
  if (event.target.id === 'title-select') { game.look.title = event.target.value; saveLook(); }
  if (event.target.id === 'name-input') { game.name = event.target.value.trim().slice(0, 16); store('name', game.name); if (validName() && net.connected) net.identify(); }
});
home.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.id === 'room-input') $('#join-room').click(); });

// ------------------------------------------------------------------ lobby
export function renderLobby() {
  const room = game.room;
  if (!room) return;
  clearInterval(lobbyTimer);
  if (lobbyRoom !== room.name) { lobbyRoom = room.name; lobbyLines = []; }
  const draft = $('#lobby-chat-input')?.value || '';
  const chatFocused = document.activeElement?.id === 'lobby-chat-input';
  const mine = room.players.find((p) => p.id === game.id);
  const host = Boolean(mine?.host);
  const custom = room.queue === 'custom';
  const slot = (p) => `<div class="lobby-player${p.id === game.id ? ' you' : ''}"><i style="background:${p.color}"></i><div><b>${escapeHtml(p.name)}${p.host ? ' <em>HOST</em>' : ''}</b><small>${p.bot ? `BOT · ${(BOT_DIFFICULTY[p.difficulty]?.name || '').toUpperCase()}` : `${escapeHtml(p.title || '')} · LV ${p.level}${room.queue === 'ranked' ? ` · ${p.rating} SR` : ''}`}</small></div>${p.bot ? (host ? `<button type="button" class="mini" data-removebot="${p.id}">✕</button>` : '') : `<span class="ready-tag${p.ready ? ' on' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span>`}</div>`;
  const teamColumn = (team, label) => {
    const players = room.players.filter((p) => p.team === team);
    const open = Math.max(0, 4 - players.length);
    return `<section class="team-column team-${team}"><h3>${label} <small>${players.length}/4</small></h3>${players.map(slot).join('')}${Array.from({ length: open }, () => '<div class="lobby-player open"><small>OPEN SEAT</small></div>').join('')}
      ${custom ? `<div class="team-actions">${mine?.team !== team ? `<button type="button" class="mini" data-team="${team}">Join ${label}</button>` : ''}${host ? `<button type="button" class="mini" data-addbot="${team}">+ Bot</button>` : ''}</div>` : ''}</section>`;
  };
  const rules = room.rules;
  const select = (key, options, value) => `<select data-rule="${key}" ${host ? '' : 'disabled'}>${options.map(([v, label]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const rulesHtml = custom ? `<div class="panel rules"><p class="eyebrow">Match rules ${host ? '' : '<small>host only</small>'}</p><div class="rule-grid">
      <label>Format${select('roundsToWin', [[3, 'Best of 5'], [5, 'Best of 9'], [7, 'Best of 13']], rules.roundsToWin)}</label>
      <label>Round time${select('roundTime', [[60, '60 s'], [100, '100 s'], [140, '140 s']], rules.roundTime)}</label>
      <label>Starting credits${select('startCredits', [[400, '400'], [800, '800'], [2000, '2000'], [9000, '9000 (rich)']], rules.startCredits)}</label>
      <label>Conditions${select('variant', [['auto', 'Rotating'], ...Object.entries(VARIANT_NAMES)], rules.variant)}</label>
      <label>Modifier${select('modifier', Object.entries(MODIFIERS).map(([id, m]) => [id, m.name]), rules.modifier)}</label>
      <label>Bot skill${select('botDifficulty', Object.entries(BOT_DIFFICULTY).map(([id, d]) => [id, d.name]), rules.botDifficulty)}</label>
      <label>Friendly fire${select('friendlyFire', [['false', 'Off'], ['true', 'On']], rules.friendlyFire)}</label>
      <label>Sudden death${select('overtimeOn', [['true', 'On'], ['false', 'Off']], rules.overtime > 0)}</label>
    </div><small class="muted">${MODIFIERS[rules.modifier].desc}</small></div>` : `<div class="panel rules"><p class="eyebrow">${room.queue.toUpperCase()} queue</p><p class="muted">${room.queue === 'ranked' ? 'Ranked starts as soon as a second pilot connects. Skill rating moves only when humans face humans.' : room.queue === 'arcade' ? `Today: <b>${MODIFIERS[rules.modifier].name}</b> — ${MODIFIERS[rules.modifier].desc}` : 'Bots take the empty seats, and hand them over when more pilots arrive.'}</p></div>`;
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.name)}`;
  const humans = room.players.filter((p) => !p.bot).length;
  const canStart = room.players.some((p) => p.team === 'A') && room.players.some((p) => p.team === 'B');
  lobby.innerHTML = `
    <div class="lobby-card">
      <div class="lobby-head"><div><p class="eyebrow">${custom ? 'Private room' : 'Matchmaking'} // ${escapeHtml(room.name)}</p><h2 id="lobby-title">${custom ? 'Ready room.' : 'Finding rivals.'}</h2></div><button type="button" class="ghost-button" id="leave-lobby">← Leave</button></div>
      <p id="lobby-status" class="lobby-status"></p>
      <div class="teams">${teamColumn('A', 'Alpha')}<div class="versus">VS</div>${teamColumn('B', 'Bravo')}</div>
      ${rulesHtml}
      ${custom ? `<div class="panel invite"><p class="eyebrow">Invite link</p><div class="room-row-input"><input readonly value="${escapeHtml(link)}" id="invite-link" /><button type="button" id="copy-invite">Copy</button></div></div>` : ''}
      <div class="lobby-actions">${custom ? `<button type="button" id="ready-toggle" class="${mine?.ready ? 'secondary-button' : ''}">${mine?.ready ? 'Unready' : 'Ready up'}</button>${host ? `<button type="button" id="start-match" ${canStart ? '' : 'disabled'}>Start match <span>→</span></button>` : '<span class="muted">Waiting for the host to start…</span>'}` : ''}</div>
      <div class="lobby-chat"><div id="lobby-chat-log">${lobbyLines.join('')}</div><input id="lobby-chat-input" maxlength="140" placeholder="Say something to the room…" /></div>
    </div>`;
  const chatInput = $('#lobby-chat-input');
  chatInput.value = draft;
  if (chatFocused) chatInput.focus();
  const chatLog = $('#lobby-chat-log');
  chatLog.scrollTop = chatLog.scrollHeight;
  const status = $('#lobby-status');
  const tick = () => {
    if (!game.room || game.room.phase !== 'lobby') return;
    if (custom) {
      const ready = room.players.filter((p) => !p.bot && p.ready).length;
      status.textContent = !canStart ? 'Both teams need at least one pilot — invite a rival or add a bot.' : `${ready}/${humans} pilots ready${host ? ' — you can start whenever you like.' : ''}`;
      status.classList.toggle('ok', canStart);
    } else if (room.autoStartAt) {
      const seconds = Math.max(0, Math.ceil(room.autoStartAt - net.time()));
      status.textContent = `${humans} pilot${humans === 1 ? '' : 's'} connected — deploying in ${seconds}s`;
      status.classList.add('ok');
    } else { status.textContent = room.queue === 'ranked' ? 'Searching for a rival… ranked needs a second human pilot.' : 'Waiting for pilots…'; status.classList.remove('ok'); }
  };
  tick();
  lobbyTimer = setInterval(tick, 250);
}
export function lobbyChat(message) {
  lobbyLines.push(`<div><b>${escapeHtml(message.name)}</b> ${escapeHtml(message.text)}</div>`);
  lobbyLines = lobbyLines.slice(-40);
  const log = $('#lobby-chat-log');
  if (!log) return;
  log.innerHTML = lobbyLines.join('');
  log.scrollTop = log.scrollHeight;
}
lobby.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  play('ui');
  if (target.id === 'leave-lobby') net.leaveRoom();
  else if (target.id === 'ready-toggle') net.send({ type: 'ready', ready: !game.room.players.find((p) => p.id === game.id)?.ready });
  else if (target.id === 'start-match') net.send({ type: 'start' });
  else if (target.id === 'copy-invite') { navigator.clipboard?.writeText($('#invite-link').value).then(() => toast('Invite link copied.', 'good'), () => toast('Select the link and copy it manually.', 'warn')); }
  else if (target.dataset.team) net.send({ type: 'team', team: target.dataset.team });
  else if (target.dataset.addbot) net.send({ type: 'addbot', team: target.dataset.addbot, difficulty: game.room.rules.botDifficulty });
  else if (target.dataset.removebot) net.send({ type: 'removebot', id: target.dataset.removebot });
});
lobby.addEventListener('change', (event) => {
  const key = event.target.dataset.rule;
  if (!key) return;
  let value = event.target.value;
  if (['roundsToWin', 'roundTime', 'startCredits'].includes(key)) value = Number(value);
  if (['friendlyFire', 'overtimeOn'].includes(key)) value = value === 'true';
  net.send({ type: 'rules', rules: { [key]: value } });
});
lobby.addEventListener('keydown', (event) => {
  if (event.target.id !== 'lobby-chat-input' || event.key !== 'Enter') return;
  const text = event.target.value.trim();
  if (text) net.send({ type: 'chat', text });
  event.target.value = '';
});

// ------------------------------------------------------------------ settings
export function openSettings(controlsOnly = false) {
  const s = game.settings;
  const slider = (key, label, min, max, step, format) => `<label>${label} <output>${format(s[key])}</output><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" /></label>`;
  const toggle = (key, label) => `<label class="check"><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''} /> ${label}</label>`;
  const controls = [['W A S D', 'Move'], ['SHIFT', 'Walk quietly · hold breath when scoped'], ['CTRL / C', 'Crouch (silent)'], ['SPACE', 'Jump'], ['LMB / RMB', 'Fire / scope'], ['WHEEL', 'Scope zoom · switch weapon'], ['1 2 3', 'Primary · sidearm · blade'], ['R', 'Reload'], ['Q / E', 'Gadgets'], ['B', 'Armoury (buy phase)'], ['Z / MMB', 'Ping location'], ['X', 'Radio commands'], ['ENTER / Y', 'Chat all / team'], ['TAB', 'Scoreboard'], ['GAMEPAD', 'Sticks move/aim · RT fire · LT scope · X reload · Y swap · B crouch · LB/RB gadgets']];
  settingsCard.innerHTML = `<p class="eyebrow">${controlsOnly ? 'Field manual' : 'Combat settings'}</p><h2>${controlsOnly ? 'Controls.' : 'Fine tune.'}</h2>
    ${controlsOnly ? '' : `${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => Number(v).toFixed(2))}${slider('scopeSensitivity', 'Scoped sensitivity', 0.2, 1.5, 0.05, (v) => Number(v).toFixed(2))}${slider('padSensitivity', 'Controller sensitivity', 0.4, 2.5, 0.1, (v) => Number(v).toFixed(1))}${slider('fov', 'Field of view', 60, 105, 1, (v) => `${v}°`)}${slider('volume', 'Master volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
    <label>Graphics quality<select data-setting="quality"><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High — 4K shadows, full resolution</option><option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>Medium — balanced</option><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low — no shadows, fastest</option></select></label>
    <div class="check-grid">${toggle('announcer', 'Announcer voice')}${toggle('invertY', 'Invert Y axis')}${toggle('toggleScope', 'Toggle scope')}${toggle('toggleCrouch', 'Toggle crouch')}</div>`}
    <div class="controls-list${controlsOnly ? '' : ' compact'}">${controls.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')}</div>
    <div class="button-row"><button type="button" id="close-settings">Done</button>${controlsOnly ? '' : '<button type="button" id="reset-settings" class="ghost-button">Reset</button>'}</div>`;
  settingsCard.classList.remove('hidden');
  document.exitPointerLock?.();
}
settingsCard.addEventListener('input', (event) => {
  const key = event.target.dataset.setting;
  if (!key) return;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'range' ? Number(event.target.value) : event.target.value;
  game.settings[key] = value;
  const output = event.target.closest('label')?.querySelector('output');
  if (output) output.textContent = key === 'fov' ? `${value}°` : key === 'volume' ? `${Math.round(value * 100)}%` : Number(value).toFixed(key === 'padSensitivity' ? 1 : 2);
  if (key === 'volume') setVolume(value);
  saveSettings();
});
settingsCard.addEventListener('click', (event) => {
  if (event.target.id === 'close-settings') { settingsCard.classList.add('hidden'); play('uiBack'); bus.emit('settings-closed'); }
  if (event.target.id === 'reset-settings') { Object.assign(game.settings, DEFAULT_SETTINGS); saveSettings(); setVolume(game.settings.volume); openSettings(); }
});

// ------------------------------------------------------------------ end of match
export function showEnd(message) {
  endState = { message, report: null };
  renderEnd();
  endCard.classList.remove('hidden');
}
export function attachReport(report) { if (endState) { endState.report = report; renderEnd(); if (report.levelAfter > report.levelBefore) play('xp'); } }
export function hideEnd() { endCard.classList.add('hidden'); endState = null; }
export function refreshEnd() { if (endState && !endCard.classList.contains('hidden')) renderEnd(); }

function renderEnd() {
  const { message, report } = endState;
  const myRow = message.table.find((row) => row.id === game.id);
  const team = myRow?.team || 'A';
  const result = !message.winner ? 'draw' : message.winner === team ? 'win' : 'loss';
  const title = { win: 'Victory.', loss: 'Defeat.', draw: 'Stalemate.' }[result];
  const mine = message.scores[team], theirs = message.scores[team === 'A' ? 'B' : 'A'];
  const rows = (side) => message.table.filter((row) => row.team === side).map((row) => `<div class="score-row${row.id === game.id ? ' you' : ''}"><span class="pilot"><i style="background:${row.color}"></i>${escapeHtml(row.name)}${row.mvp ? ' <em class="mvp">MVP</em>' : ''}${row.bot ? ' <em>BOT</em>' : ''}</span><span>${row.kills}</span><span>${row.deaths}</span><span>${row.assists}</span><span>${row.damage}</span><span>${row.headshots}</span><span>${row.accuracy}%</span><span>${row.score}</span></div>`).join('');
  const head = '<div class="score-row head"><span>PILOT</span><span>K</span><span>D</span><span>A</span><span>DMG</span><span>HS</span><span>ACC</span><span>SCORE</span></div>';
  const votes = game.room?.rematch?.length || 0;
  const humans = game.room?.players.filter((p) => !p.bot && p.connected).length || 1;
  const voted = game.room?.rematch?.includes(game.id);
  let progress = '';
  if (report) {
    const level = report.levelAfter;
    const profile = game.profile;
    const base = xpForLevel(level), next = xpForLevel(level + 1);
    const percent = profile ? Math.round(((profile.xp - base) / (next - base)) * 100) : 0;
    progress = `<div class="panel xp"><div class="xp-head"><b>+${report.xp} XP</b>${report.ratingDelta ? `<b class="${report.ratingDelta > 0 ? 'good' : 'bad'}">${report.ratingDelta > 0 ? '+' : ''}${report.ratingDelta} SR</b>` : ''}<span>LEVEL ${level}${report.levelAfter > report.levelBefore ? ' — LEVEL UP' : ''}</span></div><div class="meter"><i style="width:${percent}%"></i></div>
      ${report.completed.map((c) => `<p class="unlock">CONTRACT COMPLETE — ${escapeHtml(c.text)} <em>+${c.xp} XP</em></p>`).join('')}${report.unlocks.map((u) => `<p class="unlock">UNLOCKED — ${escapeHtml(u.name)} ${u.kind}</p>`).join('')}</div>`;
  }
  endCard.innerHTML = `<div class="end-inner result-${result}">
      <p class="eyebrow">Match report // ${(VARIANT_NAMES[message.variant] || '').toUpperCase()} // ${(MODIFIERS[message.modifier]?.name || '').toUpperCase()}</p>
      <div class="end-head"><h2>${title}</h2><div class="end-score"><b>${mine}</b><span>–</span><b>${theirs}</b></div></div>
      ${progress}
      <div class="end-tables"><section class="friendly"><h3>YOUR TEAM</h3>${head}${rows(team)}</section><section class="rival"><h3>RIVALS</h3>${head}${rows(team === 'A' ? 'B' : 'A')}</section></div>
      <div class="button-row"><button type="button" id="rematch-button" ${voted ? 'disabled' : ''}>${voted ? `Waiting… ${votes}/${humans}` : `Rematch <span>${votes}/${humans}</span>`}</button><button type="button" id="share-button" class="secondary-button">Share card</button><button type="button" id="end-leave" class="ghost-button">Leave</button><span class="muted" id="end-timer"></span></div>
      <div id="share-wrap" class="share-wrap hidden"></div>
    </div>`;
}
endCard.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'rematch-button') { net.send({ type: 'rematch' }); play('ready'); }
  if (target.id === 'end-leave') { play('uiBack'); net.leaveRoom(); }
  if (target.id === 'share-button') { play('ui'); buildShareCard(); }
  if (target.id === 'share-download') { const link = document.createElement('a'); link.download = 'sniper-shootout-match.png'; link.href = $('#share-canvas').toDataURL('image/png'); link.click(); }
  if (target.id === 'share-copy') $('#share-canvas').toBlob((blob) => { navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).then(() => toast('Card copied — paste it anywhere.', 'good'), () => toast('Copy is blocked here. Use download instead.', 'warn')); });
});
setInterval(() => { const label = $('#end-timer'); if (label && game.room?.phase === 'matchEnd') label.textContent = `Back to lobby in ${Math.max(0, Math.ceil(game.room.phaseEnds - net.time()))}s`; }, 500);

function buildShareCard() {
  const wrap = $('#share-wrap');
  const { message } = endState;
  const row = message.table.find((entry) => entry.id === game.id);
  if (!row) return;
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<canvas id="share-canvas" width="1200" height="630"></canvas><div class="button-row"><button type="button" id="share-download">Download PNG</button><button type="button" id="share-copy" class="secondary-button">Copy image</button></div>';
  const canvas = $('#share-canvas');
  const c = canvas.getContext('2d');
  const result = !message.winner ? 'STALEMATE' : message.winner === row.team ? 'VICTORY' : 'DEFEAT';
  const accent = result === 'VICTORY' ? '#6ce6d1' : result === 'DEFEAT' ? '#ec6a9e' : '#ffc857';
  const gradient = c.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, '#07090c'); gradient.addColorStop(1, '#141c24');
  c.fillStyle = gradient; c.fillRect(0, 0, 1200, 630);
  c.fillStyle = 'rgba(108,230,209,.05)';
  for (let y = 0; y < 630; y += 6) c.fillRect(0, y, 1200, 1);
  c.fillStyle = accent; c.fillRect(0, 0, 14, 630);
  c.fillStyle = '#ff7148'; c.font = '700 22px "Space Grotesk", sans-serif'; c.fillText('SNIPER SHOOTOUT  //  KESTREL YARD  //  ' + (VARIANT_NAMES[message.variant] || '').toUpperCase(), 70, 84);
  c.fillStyle = '#f2f0ea'; c.font = '800 170px "Barlow Condensed", sans-serif'; c.fillText(result, 62, 250);
  c.fillStyle = accent; c.font = '800 120px "Barlow Condensed", sans-serif';
  c.textAlign = 'right'; c.fillText(`${message.scores[row.team]} – ${message.scores[row.team === 'A' ? 'B' : 'A']}`, 1130, 240); c.textAlign = 'left';
  c.fillStyle = '#9ba4ae'; c.font = '600 30px "Space Grotesk", sans-serif'; c.fillText(`${game.look.title.toUpperCase()}  ${row.name.toUpperCase()}${row.mvp ? '   ★ MVP' : ''}`, 70, 320);
  const stats = [['KILLS', row.kills], ['DEATHS', row.deaths], ['ASSISTS', row.assists], ['HEADSHOTS', row.headshots], ['ACCURACY', `${row.accuracy}%`], ['LONGEST', `${row.longest} M`]];
  stats.forEach(([label, value], index) => {
    const x = 70 + index * 182;
    c.fillStyle = 'rgba(242,240,234,.06)'; c.fillRect(x, 370, 166, 150);
    c.fillStyle = accent; c.fillRect(x, 370, 4, 150);
    c.fillStyle = '#f2f0ea'; c.font = '700 66px "Barlow Condensed", sans-serif'; c.fillText(String(value), x + 22, 450);
    c.fillStyle = '#5b6672'; c.font = '600 17px "Space Grotesk", sans-serif'; c.fillText(label, x + 22, 492);
  });
  c.fillStyle = '#5b6672'; c.font = '500 20px "Space Grotesk", sans-serif';
  c.fillText(`${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}  ·  ${(MODIFIERS[message.modifier]?.name || 'Standard').toUpperCase()}  ·  LEVEL ${game.profile?.level || levelFromXp(0)}`, 70, 580);
}

// ------------------------------------------------------------------ range tutorial
const DRILLS = [['move', 'Move with W A S D'], ['crouch', 'Crouch with CTRL or C — crouched steps are silent'], ['scope', 'Hold RIGHT MOUSE to scope in'], ['fire', 'Fire with LEFT MOUSE'], ['hit', 'Hit a target'], ['headshot', 'Land a headshot'], ['reload', 'Reload with R'], ['wallbang', 'Shoot a target through the wooden wall'], ['buy', 'Open the armoury with B'], ['gadget', 'Use a gadget with Q or E']];
const drillsDone = new Set();
export function renderTutorial(show) {
  const panel = $('#tutorial');
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  panel.innerHTML = `<p class="eyebrow">Range drills <small>${drillsDone.size}/${DRILLS.length}</small></p>${DRILLS.map(([id, text]) => `<div class="drill${drillsDone.has(id) ? ' done' : ''}"><i></i>${text}</div>`).join('')}<small class="muted">Scoped: hold SHIFT to steady your breath, scroll to change zoom. ESC → Leave when you are ready for a real match.</small>`;
}
bus.on('tutorial', (id) => {
  if (game.room?.mode !== 'range' || drillsDone.has(id)) return;
  drillsDone.add(id);
  play('ready');
  renderTutorial(true);
  if (drillsDone.size === DRILLS.length && !game.tutorialDone) { game.tutorialDone = true; store('tutorialDone', true); toast('Drills complete. You are cleared for live matches.', 'good'); }
});

// ------------------------------------------------------------------ screens + connection banner
export function showScreen(name) {
  game.screen = name;
  home.classList.toggle('hidden', name !== 'home');
  lobby.classList.toggle('hidden', name !== 'lobby');
  if (name !== 'lobby') clearInterval(lobbyTimer);
  if (name === 'home') renderHome();
  if (name === 'lobby') renderLobby();
  document.body.dataset.screen = name;
}
bus.on('net-status', ({ state, rejoining }) => {
  const label = $('#online-count');
  if (label) label.innerHTML = `<i class="live-dot"></i>${onlineLabel(state)}`;
  if (state === 'open' && game.screen === 'home' && !game.profile) renderHome();
  netBanner.classList.toggle('hidden', state === 'open' || game.screen === 'home');
  netBanner.textContent = rejoining ? 'Connection lost — rejoining your match…' : 'Connection lost — reconnecting…';
});
