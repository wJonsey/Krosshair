// Everything outside the match: home screen, career, lobby, settings,
// end-of-match report, share card, tutorial checklist, toasts.
import * as THREE from 'three';
import { BOT_DIFFICULTY, COSMETICS, MASTERY_TIERS, MODIFIERS, VARIANT_NAMES, WEAPONS, levelFromXp, masteryTier, rankName, xpForLevel } from '../shared/constants.js';
import { bus, game, graphics, migrateSettings, saveSettings, store, DEFAULT_SETTINGS } from './state.js';
import { ACCOUNTS_ENABLED, DISCORD_INVITE } from '../shared/constants.js';
import { net } from './net.js';
import { ACTIONS, RESERVED, bindLabel, bindsFor, codeLabel, resetBinds, setBind } from './input.js';
import { CROSSHAIR_COLORS, CROSSHAIR_PRESETS, cleanCrosshair, crosshairCode, crosshairFromCode, crosshairHtml, currentCrosshair } from './crosshair.js';
import { play, setVolume, unlockAudio } from './audio.js';
import { buildOperator, styleOperator, animateOperator } from './characters.js';
import { mapRuleOptions, mapRuleSummary, renderMapVote, stopMapVote } from './mapvote.js';

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const home = $('#home'), lobby = $('#lobby'), endCard = $('#end-card'), settingsCard = $('#settings-card'), toasts = $('#toasts'), netBanner = $('#net-banner');
let preview = null;
let lobbyTimer = null;
let endState = null;
let lobbyLines = [];
let lobbyRoom = null;
let lobbyTab = 'rules';

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

// ------------------------------------------------------------------ account
let authMode = 'login';
let authPending = null;
let applyingPrefs = false;
let prefsTimer = null;

let pendingPlay = null;
const DISCORD_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.6 5.2A17 17 0 0 0 15.4 4l-.5 1a15.700 15.700 0 0 0-5.800 0L8.600 4a17 17 0 0 0-4.200 1.200C1.700 9.200 1 13.100 1.300 17a17.100 17.100 0 0 0 5.200 2.600l1.100-1.800a11 11 0 0 1-1.700-.8l.4-.3a12.200 12.200 0 0 0 11.400 0l.4.3c-.5.300-1.100.600-1.700.8l1.100 1.800a17 17 0 0 0 5.200-2.600c.4-4.500-.7-8.400-3.100-11.800ZM8.700 14.600c-1 0-1.900-.9-1.900-2.100s.8-2.100 1.900-2.100 1.900.9 1.900 2.100-.8 2.100-1.900 2.100Zm6.600 0c-1 0-1.900-.9-1.900-2.100s.8-2.100 1.900-2.100 1.900.9 1.900 2.100-.8 2.100-1.900 2.100Z"/></svg>';
function accountRowHtml() {
  const avatar = game.avatar ? `<img class="avatar" src="${escapeHtml(game.avatar)}" alt="" width="36" height="36" referrerpolicy="no-referrer" />` : '';
  return `<div class="account-row">${avatar}<div><span class="field-label">${game.avatar || !ACCOUNTS_ENABLED ? 'Signed in with Discord' : 'Signed in as'}</span><b>${escapeHtml(game.username)}</b></div><button type="button" id="logout-button" class="ghost-button">Log out</button></div>`;
}
// Sign-up and login are the same button. When the server requires a login there is no guest callsign at all.
function discordHtml() {
  const required = game.loginRequired && !ACCOUNTS_ENABLED;
  // The button is always there. On a server with no Discord application yet it opens the setup steps.
  const login = net.sameOrigin ? `<a class="discord-button" href="/auth/discord">${DISCORD_MARK}<span>Log in / sign up with Discord</span></a><small class="hint">${required ? 'You need a Discord login to play. ' : ''}No email or password. Your level, stats, unlocks, settings, key binds and crosshair are saved to your account and follow you to any device. You’re also added to the Krosshair Discord — Discord asks you to approve that first.${game.discord.enabled || !net.connected ? '' : ' <b class="warn">Discord login is temporarily unavailable. Try again shortly.</b>'}</small>` : '<p class="muted">Discord login is not available from this address. Play at krosshair.online.</p>';
  return `<div class="discord-block${required ? ' required' : ''}">${login}<a class="discord-link" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">Join the Krosshair Discord →</a></div>`;
}
function authHtml() {
  if (game.username) return accountRowHtml();
  if (!net.connected && !game.discord.enabled) return '<p class="muted">Connecting to the relay…</p>';
  if (game.loginRequired && !ACCOUNTS_ENABLED) return discordHtml();
  if (!ACCOUNTS_ENABLED) return `<label class="callsign-field">Callsign<input id="name-input" maxlength="16" placeholder="Enter a callsign" autocomplete="nickname" value="${escapeHtml(game.name)}" /></label>${discordHtml()}`;
  const signup = authMode === 'signup';
  return `<form class="auth" id="auth-form" novalidate>
    <div class="segmented" role="tablist" aria-label="Account">${[['login', 'Log in'], ['signup', 'Sign up']].map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === authMode}" class="${id === authMode ? 'active' : ''}" data-auth-mode="${id}">${label}</button>`).join('')}</div>
    <label class="field">Username<input id="auth-username" autocomplete="username" maxlength="16" spellcheck="false" autocapitalize="off" /></label>
    <label class="field">Password<input id="auth-password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="128" /></label>
    ${signup ? '<label class="field">Confirm password<input id="auth-confirm" type="password" autocomplete="new-password" maxlength="128" /></label><p class="auth-hint">No email needed. Your username is your callsign in matches. Passwords can’t be reset, so keep yours safe.</p>' : ''}
    <div class="auth-actions"><button type="submit" id="auth-submit" ${authPending ? 'disabled' : ''}>${signup ? 'Create account' : 'Log in'}</button><p id="auth-status" class="feedback-status" role="status"></p></div>
  </form>`;
}
function setAuthStatus(text, tone = '') { const status = $('#auth-status'); if (status) { status.textContent = text; status.className = `feedback-status ${tone}`; } }

// Look, settings and tutorial progress live on the account; this browser mirrors them.
export function applyAccountPrefs(profile) {
  if (!profile) return;
  applyingPrefs = true;
  if (profile.look) { game.look = { ...game.look, ...profile.look }; store('look', game.look); bus.emit('look'); refreshPreviewLook(); }
  if (profile.settings) { Object.assign(game.settings, migrateSettings({ settingsVersion: 1, ...profile.settings })); saveSettings(); setVolume(game.settings.volume); }
  if (profile.tutorialDone) { game.tutorialDone = true; store('tutorialDone', true); }
  applyingPrefs = false;
  // A brand-new account starts from whatever this browser already had.
  // …and an account saved before a default changed is brought up to date once.
  if (!profile.settings || (profile.settings.settingsVersion || 1) < DEFAULT_SETTINGS.settingsVersion || (game.tutorialDone && !profile.tutorialDone)) uploadPrefs(0);
}
function uploadPrefs(delay = 800) {
  if (applyingPrefs || !net.identified) return;
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => net.send({ type: 'prefs', look: game.look, settings: game.settings, tutorialDone: game.tutorialDone }), delay);
}
bus.on('settings', () => uploadPrefs());

net.on('auth-error', (message) => {
  authPending = null;
  const submit = $('#auth-submit');
  if (submit) submit.disabled = false;
  setAuthStatus(message.message, 'warn');
  play('deny');
});
net.on('auth-required', (message) => {
  if (message.expired) toast('Your login expired. Log in again to keep playing.', 'warn');
  if (game.screen === 'home') renderHome();
});
net.on('logged-out', () => { toast('Logged out.'); bus.emit('logged-out'); if (game.screen === 'home') renderHome(); });

// ------------------------------------------------------------------ operator preview
function ensurePreview(canvas) {
  if (preview?.canvas === canvas) return;
  preview?.renderer.dispose();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 200, canvas.clientHeight || 260, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#cfe0f5', '#3a4048', 2.4));
  const fill = new THREE.DirectionalLight('#ffffff', 1.2); fill.position.set(1.5, 1.2, 3); scene.add(fill);
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
  if (!profile) return `<div class="panel"><p class="eyebrow">Career</p><p class="muted">${net.connected ? (ACCOUNTS_ENABLED ? 'Log in or sign up to load your career, contracts and unlocks.' : (game.loginRequired ? 'Log in with Discord to load your career, contracts and unlocks.' : 'Enter a callsign to load your career, contracts and unlocks.')) : 'Connecting to the relay…'}</p></div>`;
  const level = profile.level, base = xpForLevel(level), next = xpForLevel(level + 1);
  const progress = Math.round(((profile.xp - base) / (next - base)) * 100);
  const s = profile.stats;
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  // Kills from before accounts tracked the split count as player kills.
  const botKills = s.botKills || 0, playerKills = s.playerKills || Math.max(0, s.kills - botKills);
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
  const history = profile.history.length ? profile.history.slice(0, 8).map((h) => `<div class="history-row ${h.result}"><b>${h.result.toUpperCase()}</b><span>${h.score}</span><span title="${h.botKills ? `${h.playerKills} player, ${h.botKills} bot kills` : ''}">${h.playerKills ?? h.kills}${h.botKills ? `+${h.botKills}` : ''}/${h.deaths}/${h.assists}</span><span>${(h.mode || '').toUpperCase()}${h.mvp ? ' · MVP' : ''}</span><small>${h.rating === null ? '' : `${h.rating >= 0 ? '+' : ''}${h.rating} SR · `}${new Date(h.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`).join('') : '<p class="muted">No matches yet. Your last 25 results land here.</p>';
  const recent = profile.recent.length ? `<p class="recent"><span>RECENT PILOTS</span> ${profile.recent.map(escapeHtml).join(' · ')}</p>` : '';
  return `
    <div class="career-col"><div class="panel career"><p class="eyebrow">Service record</p>
      <div class="level-row"><b class="level">${level}</b><div><strong>${escapeHtml(game.look.title)} ${escapeHtml(profile.name)}</strong><div class="meter"><i style="width:${progress}%"></i></div><small>${profile.xp - base} / ${next - base} XP to level ${level + 1}</small></div><div class="rank"><span>${rankName(profile.rating, ranked).toUpperCase()}</span><b>${ranked ? profile.rating : '—'}</b><small>SKILL RATING</small></div></div>
      <div class="stat-grid"><div><b>${s.matches}</b><span>MATCHES</span></div><div><b>${winRate}%</b><span>WIN RATE</span></div><div><b>${kd}</b><span>K / D</span></div><div><b>${accuracy}%</b><span>ACCURACY</span></div><div><b>${playerKills}</b><span>PLAYER KILLS</span></div><div><b>${botKills}</b><span>BOT KILLS</span></div><div><b>${s.headshots}</b><span>HEADSHOTS</span></div><div><b>${s.longest} M</b><span>LONGEST KILL</span></div><div><b>${s.assists}</b><span>ASSISTS</span></div><div><b>${s.clutches}</b><span>CLUTCHES</span></div><div><b>${s.mvps}</b><span>MVPS</span></div><div><b>${s.wallbangs || 0}</b><span>WALLBANGS</span></div></div>
    </div>
    <div class="panel"><p class="eyebrow">Daily contracts <small>reset at 00:00 UTC</small></p>${contracts}</div></div>
    <div class="career-col"><div class="panel tabs"><div class="tab-head"><button type="button" class="tab active" data-tab="history">Match history</button><button type="button" class="tab" data-tab="mastery">Weapon mastery</button></div><div class="tab-body" data-body="history">${history}${recent}</div><div class="tab-body hidden" data-body="mastery">${mastery}</div></div></div>`;
}

// Compact pilot card for the Play page: who you are, how far to the next level, today's contracts.
function pilotHtml() {
  const profile = game.profile;
  if (!profile) return `<p class="muted">${net.connected ? (ACCOUNTS_ENABLED ? 'Log in or sign up to load your career, contracts and unlocks.' : (game.loginRequired ? 'Log in with Discord to load your career, contracts and unlocks.' : 'Enter a callsign to load your career, contracts and unlocks.')) : 'Connecting to the relay…'}</p>`;
  const level = profile.level, base = xpForLevel(level), next = xpForLevel(level + 1);
  const progress = Math.round(((profile.xp - base) / (next - base)) * 100);
  const ranked = profile.rankedMatches > 0;
  const contracts = profile.contracts.map((c) => `<div class="contract${c.done ? ' done' : ''}"><div><span>${escapeHtml(c.text)}</span><em>+${c.xp} XP</em></div><div class="meter"><i style="width:${Math.round((c.progress / c.n) * 100)}%"></i></div></div>`).join('');
  return `<div class="level-row"><b class="level">${level}</b><div><strong>${escapeHtml(game.look.title)} ${escapeHtml(profile.name)}</strong><div class="meter"><i style="width:${progress}%"></i></div><small>${profile.xp - base} / ${next - base} XP · ${rankName(profile.rating, ranked).toUpperCase()}</small></div></div>
    <p class="eyebrow pilot-sub">Today’s contracts</p>${contracts}`;
}

// The menu is split into pages; the hash keeps the page across refreshes and makes Back work.
const HOME_PAGES = [['play', 'Play'], ['operator', 'Operator'], ['career', 'Career'], ['leaderboard', 'Leaderboard'], ['rooms', 'Rooms']];
const TOOL_PAGES = [['settings', 'Settings'], ['controls', 'Controls'], ['feedback', 'Feedback']];
const pageFromHash = () => ([...HOME_PAGES, ...TOOL_PAGES].some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'play');
let homePage = pageFromHash();
let pageEntering = true;
let roomDraft = { code: null, isPublic: false };
function setHomePage(page) {
  if (page === homePage) return;
  homePage = page;
  pageEntering = true;
  if (pageFromHash() !== page) history.pushState(null, '', `${location.pathname}${location.search}#${page}`);
  renderHome();
}
addEventListener('popstate', () => { const page = pageFromHash(); if (page !== homePage) { homePage = page; pageEntering = true; if (game.screen === 'home') renderHome(); } });
addEventListener('hashchange', () => { const page = pageFromHash(); if (page !== homePage) { homePage = page; pageEntering = true; if (game.screen === 'home') renderHome(); } });

// ------------------------------------------------------------------ leaderboard
let boards = null;
let boardTab = 'rating';
let boardsAskedAt = -Infinity;
const BOARD_ORDER = ['rating', 'level', 'kills', 'wins', 'headshots', 'longest'];
const boardValue = (id, row) => (id === 'rating' ? `${row.value} SR` : id === 'level' ? `${row.value.toLocaleString()} XP` : id === 'longest' ? `${row.value} M` : row.value.toLocaleString());
// Standings refresh every 30 s while they are on screen. Until the first answer arrives the request is
// repeated every few seconds, so a message lost around connect or login never leaves the page on "Loading…".
function askBoards() {
  if (!net.connected) return;
  const since = performance.now() - boardsAskedAt;
  if (since < (boards ? 30000 : 3000)) return;
  boardsAskedAt = performance.now();
  net.send({ type: 'leaderboard' });
}
net.on('leaderboard', (message) => { boards = message.boards; if (game.screen === 'home' && (homePage === 'leaderboard' || homePage === 'play')) renderHome(); });
setInterval(() => { if (game.screen === 'home' && (homePage === 'leaderboard' || homePage === 'play') && !document.hidden) askBoards(); }, 2000);
const pilotFace = (row) => (row.avatar ? `<img class="avatar" src="${escapeHtml(row.avatar)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer" />` : `<i class="avatar blank">${escapeHtml(row.name.slice(0, 1).toUpperCase())}</i>`);
const boardRow = (id, row) => `<div class="board-row${row.you ? ' you' : ''}"><b class="place">${row.rank}</b>${pilotFace(row)}<span class="who"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.title)} · LV ${row.level}</small></span><em>${boardValue(id, row)}</em></div>`;

function leaderboardPageHtml() {
  askBoards();
  const board = boards?.[boardTab];
  const tabs = `<div class="segmented board-tabs" role="tablist">${BOARD_ORDER.map((id) => `<button type="button" role="tab" data-board="${id}" class="${id === boardTab ? 'active' : ''}" aria-selected="${id === boardTab}">${boards?.[id]?.label || id}</button>`).join('')}</div>`;
  if (!board) return `<section class="page-wide"><p class="eyebrow">Leaderboard</p><h1 class="page-title">Top <em>guns.</em></h1>${tabs}<div class="panel"><p class="muted">${net.connected ? 'Loading the standings…' : 'Connecting to the relay…'}</p></div></section>`;
  const podium = board.top.slice(0, 3);
  const rest = board.top.slice(3);
  const empty = boardTab === 'rating' ? 'Nobody is ranked yet. Win a ranked match and the top spot is yours.' : 'Nobody is on this board yet. Play a match to be the first.';
  const mine = board.you ? `You are <b>#${board.you.rank}</b> of ${board.total.toLocaleString()}` : game.username ? (boardTab === 'rating' ? 'Play a ranked match to get on this board.' : 'Play a match to get on this board.') : 'Log in to see where you stand.';
  return `<section class="page-wide"><p class="eyebrow">Leaderboard <small>${board.total.toLocaleString()} pilot${board.total === 1 ? '' : 's'} · updates every 30 s</small></p><h1 class="page-title">Top <em>guns.</em></h1>
    <div class="board-head">${tabs}<p class="board-mine">${mine}</p></div>
    ${board.top.length ? `<div class="podium">${podium.map((row) => `<div class="panel podium-card place-${row.rank}${row.you ? ' you' : ''}"><span class="medal">${row.rank}</span>${pilotFace(row)}<strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.title)} · LV ${row.level}</small><em>${boardValue(boardTab, row)}</em></div>`).join('')}</div>
    ${rest.length ? `<div class="panel board-list">${rest.map((row) => boardRow(boardTab, row)).join('')}</div>` : ''}
    ${board.you && board.you.rank > 50 ? `<div class="panel board-list"><div class="board-row you"><b class="place">${board.you.rank}</b><i class="avatar blank">★</i><span class="who"><strong>${escapeHtml(game.username || 'You')}</strong><small>Your position</small></span><em>${boardValue(boardTab, board.you)}</em></div></div>` : ''}` : `<div class="panel"><p class="muted">${empty}</p></div>`}</section>`;
}
// Play page: the top five by skill rating, or by level while nobody is ranked.
function boardTeaserHtml() {
  askBoards();
  const id = boards?.rating?.top.length ? 'rating' : 'level';
  const top = boards?.[id]?.top.slice(0, 5) || [];
  return `<div class="panel board-teaser"><p class="eyebrow">Leaderboard <small>${id === 'rating' ? 'skill rating' : 'level'}</small></p>${top.length ? top.map((row) => boardRow(id, row)).join('') : `<p class="muted">${boards ? 'No pilots on the board yet — be the first.' : 'Loading…'}</p>`}<div class="link-row"><button type="button" class="ghost-button" data-page="leaderboard">Full standings →</button></div></div>`;
}

function playPageHtml() {
  const modifier = MODIFIERS[game.dailyModifier] || MODIFIERS.headhunter;
  return `
    <section class="page-main">
      <p class="eyebrow">Tactical sniper duels · one life</p>
      <h1 class="page-title">Pick your <em>fight.</em></h1>
      <button type="button" class="play-card primary" data-play="casual"><small>01 // QUICK PLAY</small><strong>Find a match</strong><span>Casual queue. Bots fill empty seats so you never wait.</span><i class="go">Deploy →</i></button>
      <div class="mode-grid">
        <button type="button" class="play-card" data-play="ranked"><small>02 // RANKED</small><strong>Climb the ladder</strong><span>Real rivals only. Skill rating on the line.</span></button>
        <button type="button" class="play-card" data-play="arcade"><small>03 // ARCADE · TODAY</small><strong>${modifier.name}</strong><span>${modifier.desc}</span></button>
        <div class="play-card split"><small>04 // BOT MATCH</small><strong>3v3 vs bots</strong><div class="difficulty">${Object.entries(BOT_DIFFICULTY).map(([id, d]) => `<button type="button" data-bots="${id}">${d.name}</button>`).join('')}</div></div>
        <button type="button" class="play-card" data-play="range"><small>05 // PRACTICE RANGE</small><strong>${game.tutorialDone ? 'Warm up' : 'Learn the ropes'}</strong><span>Free gear, moving targets, guided drills.</span></button>
      </div>
    </section>
    <aside class="page-side">
      <div class="panel pilot"><p class="eyebrow">Pilot</p>${authHtml()}<div class="pilot-body">${pilotHtml()}</div>
        <div class="link-row"><button type="button" class="ghost-button" data-page="operator">Customise operator</button><button type="button" class="ghost-button" data-page="career">Full career →</button></div>
      </div>
    </aside>
    <aside class="page-side page-third">
      ${boardTeaserHtml()}
      <button type="button" class="panel room-teaser" data-page="rooms"><p class="eyebrow">Rooms</p><strong>${game.publicRooms.length ? `${game.publicRooms.length} live room${game.publicRooms.length === 1 ? '' : 's'}` : 'Play with friends'}</strong><span>Private rooms, custom rules and an invite link.</span></button>
    </aside>`;
}

function operatorPageHtml(level) {
  const nameOfLook = (kind, key) => COSMETICS[kind].find((item) => item.id === game.look[key])?.name || '';
  const group = (label, kind, key) => `<div class="panel look-group"><p class="eyebrow">${label} <small>${escapeHtml(nameOfLook(kind, key))}</small></p><div class="swatches">${swatchRow(kind, key, level)}</div></div>`;
  return `
    <section class="page-main operator-stage">
      <p class="eyebrow">Operator</p>
      <h1 class="page-title">Your <em>silhouette.</em></h1>
      <div class="stage"><canvas id="operator-preview" width="360" height="460"></canvas><div class="stage-tag"><small>${escapeHtml(game.look.title)}</small><b>${escapeHtml(game.profile?.name || game.name || 'Unnamed pilot')}</b><span>LEVEL ${level}</span></div></div>
    </section>
    <aside class="page-side">
      ${group('Suit', 'suit', 'color')}${group('Visor', 'visor', 'accent')}${group('Tracer', 'tracer', 'tracer')}
      <div class="panel look-group"><p class="eyebrow">Title</p><select id="title-select">${COSMETICS.title.map((t) => `<option value="${t.id}" ${game.look.title === t.id ? 'selected' : ''} ${level < t.level ? 'disabled' : ''}>${t.name}${level < t.level ? ` — level ${t.level}` : ''}</option>`).join('')}</select><small class="muted">Colours and titles unlock as you level up. Numbers on a swatch show the level it needs.</small></div>
    </aside>`;
}

function roomsPageHtml() {
  const inviteRoom = new URLSearchParams(location.search).get('room') || '';
  const rooms = game.publicRooms.length ? game.publicRooms.map((room) => `<button type="button" class="room-row" data-join="${escapeHtml(room.name)}"><b>${escapeHtml(room.name)}</b><span>${room.queue.toUpperCase()}</span><span>${room.players + room.bots}/${room.max}</span><small>${room.phase === 'lobby' ? 'IN LOBBY' : `LIVE ${room.scores.A}–${room.scores.B}`}</small></button>`).join('') : '<p class="muted">No public rooms right now. Start one, or warm up against bots.</p>';
  return `
    <section class="page-main">
      <p class="eyebrow">Rooms</p>
      <h1 class="page-title">Bring your <em>own rivals.</em></h1>
      <div class="panel private"><p class="eyebrow">Private room</p><div class="room-row-input"><input id="room-input" maxlength="24" placeholder="room-code" value="${escapeHtml(roomDraft.code ?? inviteRoom)}" /><button type="button" id="join-room">Create / join <span>↗</span></button></div><label class="check"><input type="checkbox" id="room-public" ${roomDraft.isPublic ? 'checked' : ''} /> List this room publicly</label>
        <ul class="feature-list"><li>Type any code — if the room doesn’t exist, it’s created and you host it.</li><li>Hosts set the arena, format, round time, credits, weather and modifier.</li><li>Pick teams, add bots, and share the invite link from the ready room.</li></ul></div>
    </section>
    <aside class="page-side"><div class="panel"><p class="eyebrow">Live rooms <small>${game.publicRooms.length}</small></p><div id="room-list">${rooms}</div></div></aside>`;
}

export function renderHome() {
  const level = game.profile?.level || 1;
  // Re-renders happen whenever the profile or look changes; keep whatever the pilot has typed.
  if ($('#room-input')) roomDraft = { code: $('#room-input').value, isPublic: $('#room-public').checked };
  const keep = { name: $('#name-input')?.value, username: $('#auth-username')?.value, password: $('#auth-password')?.value, confirm: $('#auth-confirm')?.value, status: $('#auth-status')?.outerHTML, focus: document.activeElement?.id, tab: home.querySelector('.tab.active')?.dataset.tab };
  const feedbackDraft = readFeedbackDraft();
  if (homePage === 'controls') settingsTab = 'binds'; else if (homePage === 'settings' && settingsTab === 'binds') settingsTab = 'aim';
  if (homePage !== 'settings' && homePage !== 'controls') listening = null;
  const pageHtml = homePage === 'leaderboard' ? leaderboardPageHtml() : homePage === 'settings' ? settingsPageHtml() : homePage === 'controls' ? controlsPageHtml() : homePage === 'feedback' ? feedbackPageHtml() : homePage === 'operator' ? operatorPageHtml(level) : homePage === 'career' ? `<section class="page-wide"><p class="eyebrow">Career</p><h1 class="page-title">Your <em>record.</em></h1><div class="career-grid">${careerHtml()}</div></section>` : homePage === 'rooms' ? roomsPageHtml() : playPageHtml();
  home.innerHTML = `
    <div class="menu-shell">
      <header class="menu-bar">
        <button type="button" class="brand" data-page="play" aria-label="Krosshair — play"><img class="brand-mark" src="brand/krosshair-logo.svg" alt="" width="40" height="40" /><b>Kross<em>hair</em></b></button>
        <nav class="menu-nav" aria-label="Menu">${HOME_PAGES.map(([id, label], index) => `<button type="button" data-page="${id}" class="${id === homePage ? 'active' : ''}" ${id === homePage ? 'aria-current="page"' : ''}><small>0${index + 1}</small>${label}${id === 'rooms' && game.publicRooms.length ? `<i class="badge">${game.publicRooms.length}</i>` : ''}</button>`).join('')}</nav>
        <div class="menu-tools"><span id="online-count"><i class="live-dot"></i>${onlineLabel()}</span>${TOOL_PAGES.map(([id, label]) => `<button type="button" data-page="${id}" class="ghost-button${id === homePage ? ' active' : ''}" ${id === homePage ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</div>
      </header>
      <main class="menu-page page-${homePage}${pageEntering ? ' entering' : ''}">${pageHtml}</main>
    </div>`;
  pageEntering = false;
  if (keep.name !== undefined && $('#name-input')) $('#name-input').value = keep.name;
  if (keep.username !== undefined && $('#auth-username')) {
    $('#auth-username').value = keep.username; $('#auth-password').value = keep.password || '';
    if ($('#auth-confirm')) $('#auth-confirm').value = keep.confirm || '';
    if (keep.status) $('#auth-status').outerHTML = keep.status;
  }
  if (keep.tab === 'mastery' && home.querySelector('.tab')) {
    home.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'mastery'));
    home.querySelectorAll('.tab-body').forEach((body) => body.classList.toggle('hidden', body.dataset.body !== 'mastery'));
  }
  if (keep.focus && home.querySelector(`#${keep.focus}`)) { const field = home.querySelector(`#${keep.focus}`); field.focus(); if (field.setSelectionRange && field.type === 'text') field.setSelectionRange(field.value.length, field.value.length); }
  if ($('#operator-preview')) { ensurePreview($('#operator-preview')); refreshPreviewLook(); }
  if (feedbackDraft && home.querySelector('#feedback-form')) writeFeedbackDraft(feedbackDraft);
}

function saveLook() { store('look', game.look); refreshPreviewLook(); net.send({ type: 'look', look: game.look }); bus.emit('look'); uploadPrefs(); }

function play_(payload) {
  unlockAudio();
  if (!net.connected) { toast('Still connecting to the relay… give it a moment.', 'warn'); return; }
  if (game.loginRequired && !ACCOUNTS_ENABLED) {
    if (!net.identified) { toast('Log in with Discord to play.', 'warn'); setHomePage('play'); document.querySelector('.discord-button')?.focus(); play('deny'); return; }
  } else if (!ACCOUNTS_ENABLED) {
    const input = $('#name-input');
    if (input) game.name = input.value.trim().slice(0, 16);
    if (game.name.length < 2) { toast('Choose a callsign with at least 2 characters first.', 'warn'); setHomePage('play'); $('#name-input')?.focus(); play('deny'); return; }
    store('name', game.name);
    if (!net.identified || game.profile?.name !== game.name) { pendingPlay = payload; play('ready'); net.identify(); return; }
  } else if (!net.identified) { toast('Log in or sign up to play.', 'warn'); setHomePage('play'); $('#auth-username')?.focus(); play('deny'); return; }
  play('ready');
  net.enter(payload);
}

home.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.closest('#feedback-form')) { if (target.dataset.kind) switchFeedbackKind(target.dataset.kind); return; }
  if (onSettingsClick(event)) return;
  if (target.dataset.board) { boardTab = target.dataset.board; play('ui'); renderHome(); return; }
  if (target.dataset.kind) {
    if (target.classList.contains('locked')) { toast(target.title, 'warn'); return; }
    game.look[target.dataset.kind] = target.dataset.value;
    saveLook(); play('ui'); renderHome();
  } else if (target.dataset.page) { play('ui'); setHomePage(target.dataset.page); }
  else if (target.dataset.play) play_(target.dataset.play === 'range' ? { action: 'range' } : { action: 'quick', queue: target.dataset.play });
  else if (target.dataset.bots) play_({ action: 'bots', difficulty: target.dataset.bots });
  else if (target.dataset.join) play_({ action: 'join', room: target.dataset.join });
  else if (target.id === 'join-room') {
    const code = $('#room-input').value.trim() || `room-${Math.random().toString(36).slice(2, 6)}`;
    play_({ action: 'join', room: code, isPublic: $('#room-public').checked });
  } else if (target.dataset.authMode) { authMode = target.dataset.authMode; setAuthStatus(''); renderHome(); $('#auth-username')?.focus(); play('ui'); }
  else if (target.id === 'logout-button') { play('uiBack'); net.auth('logout'); }
  else if (target.dataset.tab) {
    home.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === target));
    home.querySelectorAll('.tab-body').forEach((body) => body.classList.toggle('hidden', body.dataset.body !== target.dataset.tab));
    play('ui');
  }
});
home.addEventListener('change', (event) => {
  if (event.target.id === 'title-select') { game.look.title = event.target.value; saveLook(); }
  if (event.target.id === 'name-input') { game.name = event.target.value.trim().slice(0, 16); store('name', game.name); if (game.name.length >= 2 && net.connected) net.identify(); }
});
home.addEventListener('submit', (event) => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  if (authPending) return;
  const username = $('#auth-username').value.trim(), password = $('#auth-password').value;
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(username)) { setAuthStatus('Usernames are 3–16 letters, numbers, - or _.', 'warn'); return $('#auth-username').focus(); }
  if (password.length < 8) { setAuthStatus('Passwords need at least 8 characters.', 'warn'); return $('#auth-password').focus(); }
  if (authMode === 'signup' && $('#auth-confirm').value !== password) { setAuthStatus('Those passwords don’t match.', 'warn'); return $('#auth-confirm').focus(); }
  if (!net.connected) return setAuthStatus('Not connected to the server yet. Try again in a moment.', 'warn');
  authPending = authMode;
  $('#auth-submit').disabled = true;
  setAuthStatus(authMode === 'signup' ? 'Creating your account…' : 'Logging in…');
  net.auth(authMode, { username, password, legacyToken: authMode === 'signup' ? game.token : undefined });
});
function showDiscordPrompt() {
  document.querySelector('#discord-prompt')?.remove();
  const card = document.createElement('div');
  card.id = 'discord-prompt';
  card.className = 'pause-card discord-prompt';
  card.setAttribute('role', 'dialog');
  card.innerHTML = `<p class="eyebrow">One more thing</p><h2>Join the squad.</h2><p>Find teammates, hear about updates first and report bugs straight to us in the Krosshair Discord.</p><div class="button-row"><a class="discord-button" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">${DISCORD_MARK}<span>Join the Discord</span></a><button type="button" class="ghost-button">Not now</button></div>`;
  card.addEventListener('click', (event) => { if (event.target.closest('a, button')) { card.remove(); play('ui'); } });
  document.querySelector('#arena-shell').append(card);
}
bus.on('config', () => { if (game.screen === 'home') renderHome(); });
bus.on('signed-in', () => {
  // Set by the Discord callback page on its way back to the menu.
  let viaDiscord = null;
  try { viaDiscord = sessionStorage.getItem('krosshair:discord'); sessionStorage.removeItem('krosshair:discord'); } catch { /* private mode */ }
  if (viaDiscord && game.username) toast(viaDiscord === 'joined' ? `Signed in as ${game.username}. You’re in the Krosshair Discord too.` : `Signed in as ${game.username}.`, 'good');
  // The server could not add them itself (no bot token, or Discord refused): ask once, one click to the invite.
  if (viaDiscord === 'in' && game.username) showDiscordPrompt();
  if (pendingPlay) { const payload = pendingPlay; pendingPlay = null; net.enter(payload); }
  if (authPending === 'signup') { toast(`Welcome, ${game.username}. Your progress now saves to your account.`, 'good'); game.token = null; store('token', null); }
  else if (authPending === 'login') toast(`Welcome back, ${game.username}.`, 'good');
  authPending = null;
});
home.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.id === 'room-input') $('#join-room').click(); });

// ------------------------------------------------------------------ lobby
export function renderLobby() {
  const room = game.room;
  if (!room) return;
  clearInterval(lobbyTimer);
  stopMapVote();
  if (room.phase === 'mapvote') { renderMapVote(lobby, room); return; }
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
      <label>Arena${select('map', mapRuleOptions(), rules.map)}</label>
      <label>Format${select('roundsToWin', [[3, 'Best of 5'], [5, 'Best of 9'], [7, 'Best of 13']], rules.roundsToWin)}</label>
      <label>Round time${select('roundTime', [[60, '60 s'], [100, '100 s'], [140, '140 s']], rules.roundTime)}</label>
      <label>Starting credits${select('startCredits', [[400, '400'], [800, '800'], [2000, '2000'], [9000, '9000 (rich)']], rules.startCredits)}</label>
      <label>Conditions${select('variant', [['auto', 'Rotating'], ...Object.entries(VARIANT_NAMES)], rules.variant)}</label>
      <label>Modifier${select('modifier', Object.entries(MODIFIERS).map(([id, m]) => [id, m.name]), rules.modifier)}</label>
      <label>Bot skill${select('botDifficulty', Object.entries(BOT_DIFFICULTY).map(([id, d]) => [id, d.name]), rules.botDifficulty)}</label>
      <label>Friendly fire${select('friendlyFire', [['false', 'Off'], ['true', 'On']], rules.friendlyFire)}</label>
      <label>Sudden death${select('overtimeOn', [['true', 'On'], ['false', 'Off']], rules.overtime > 0)}</label>
    </div><small class="muted">${mapRuleSummary(rules.map)}<br />${MODIFIERS[rules.modifier].desc}</small></div>` : `<div class="panel rules"><p class="eyebrow">${room.queue.toUpperCase()} queue</p><p class="muted">${room.queue === 'ranked' ? 'Ranked starts as soon as a second pilot connects. Skill rating moves only when humans face humans.' : room.queue === 'arcade' ? `Today: <b>${MODIFIERS[rules.modifier].name}</b> — ${MODIFIERS[rules.modifier].desc}` : 'Bots take the empty seats, and hand them over when more pilots arrive.'}</p></div>`;
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.name)}`;
  const humans = room.players.filter((p) => !p.bot).length;
  const canStart = room.players.some((p) => p.team === 'A') && room.players.some((p) => p.team === 'B');
  if (!custom || (lobbyTab !== 'rules' && lobbyTab !== 'invite')) lobbyTab = 'rules';
  const readyCount = room.players.filter((p) => !p.bot && p.ready).length;
  const inviteHtml = `<div class="panel invite"><p class="eyebrow">Invite link</p><div class="room-row-input"><input readonly value="${escapeHtml(link)}" id="invite-link" /><button type="button" id="copy-invite">Copy</button></div><small class="muted">Anyone with this link lands straight in this room. Room code: <b>${escapeHtml(room.name)}</b></small></div>`;
  lobby.innerHTML = `
    <div class="menu-shell lobby-shell">
      <header class="menu-bar">
        <div class="brand"><img class="brand-mark" src="brand/krosshair-logo.svg" alt="Krosshair" width="40" height="40" /><b>Kross<em>hair</em></b></div>
        <div class="lobby-crumb"><small>${custom ? 'PRIVATE ROOM' : `${room.queue.toUpperCase()} QUEUE`}</small><b>${escapeHtml(room.name)}</b></div>
        <div class="menu-tools"><span><i class="live-dot"></i>${humans} PILOT${humans === 1 ? '' : 'S'}${custom ? ` · ${readyCount} READY` : ''}</span><button type="button" class="ghost-button" id="leave-lobby">← Leave</button></div>
      </header>
      <main class="menu-page lobby-grid">
        <section class="page-main">
          <p class="eyebrow">${custom ? 'Ready room' : 'Matchmaking'}</p>
          <h1 class="page-title" id="lobby-title">${custom ? 'Ready <em>room.</em>' : 'Finding <em>rivals.</em>'}</h1>
          <p id="lobby-status" class="lobby-status"></p>
          <div class="teams">${teamColumn('A', 'Alpha')}<div class="versus"><i></i>VS<i></i></div>${teamColumn('B', 'Bravo')}</div>
          <div class="lobby-actions">${custom ? `<button type="button" id="ready-toggle" class="${mine?.ready ? 'secondary-button' : ''}">${mine?.ready ? 'Unready' : 'Ready up'}</button>${host ? `<button type="button" id="start-match" ${canStart ? '' : 'disabled'}>Start match <span>→</span></button>` : '<span class="muted">Waiting for the host to start…</span>'}` : ''}</div>
        </section>
        <aside class="page-side">
          ${custom ? `<div class="side-tabs"><button type="button" class="tab${lobbyTab === 'rules' ? ' active' : ''}" data-lobby-tab="rules">Match rules</button><button type="button" class="tab${lobbyTab === 'invite' ? ' active' : ''}" data-lobby-tab="invite">Invite</button></div>` : ''}
          ${lobbyTab === 'invite' ? inviteHtml : rulesHtml}
          <div class="panel lobby-chat"><p class="eyebrow">Room comms</p><div id="lobby-chat-log">${lobbyLines.join('') || '<span class="muted">No messages yet.</span>'}</div><input id="lobby-chat-input" maxlength="140" placeholder="Say something to the room…" /></div>
        </aside>
      </main>
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
  if (target.dataset.lobbyTab) { lobbyTab = target.dataset.lobbyTab; renderLobby(); }
  else if (target.id === 'leave-lobby') net.leaveRoom();
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
const SETTINGS_TABS = [['aim', 'Aim'], ['graphics', 'Graphics'], ['audio', 'Audio & HUD'], ['crosshair', 'Crosshair'], ['binds', 'Key binds']];
let settingsTab = 'aim';
let listening = null; // { action, slot } while a bind button waits for a key
const FORMATS = { x2: (v) => Number(v).toFixed(2), x1: (v) => Number(v).toFixed(1), deg: (v) => `${v}°`, pct: (v) => `${Math.round(v * 100)}%`, px: (v) => `${v} px`, int: (v) => String(v) };
const GRAPHICS_KEYS = ['renderScale', 'shadows', 'streetLights'];

function settingsBodyHtml(tab) {
  const s = game.settings, g = graphics();
  const slider = (key, label, min, max, step, format, value = s[key], hint = '') => `<label>${label} <output>${FORMATS[format](value)}</output><input type="range" data-setting="${key}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${value}" />${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
  const toggle = (key, label, hint = '', value = s[key]) => `<label class="check"><input type="checkbox" data-setting="${key}" ${value ? 'checked' : ''} /> <span>${label}${hint ? `<small class="hint">${hint}</small>` : ''}</span></label>`;
  const select = (key, label, options, value = s[key], hint = '') => `<label>${label}<select data-setting="${key}">${options.map(([v, text]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select>${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;

  if (tab === 'graphics') {
    const presets = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']];
    return `<div class="settings-cols">
      <div class="panel"><p class="eyebrow">Preset</p><div class="segmented preset-row">${presets.map(([id, label]) => `<button type="button" data-preset="${id}" class="${s.quality === id ? 'active' : ''}" ${id === 'custom' ? 'disabled' : ''}>${label}</button>`).join('')}</div><small class="hint">Pick a preset, or change anything under Detail and it becomes Custom.</small>
        <p class="eyebrow sub">Detail</p>
        ${slider('renderScale', 'Render scale', 0.5, 2, 0.05, 'pct', g.renderScale, 'Share of your screen’s resolution. The biggest lever on frame rate; above 100% supersamples for cleaner edges.')}
        ${select('shadows', 'Shadows', [['off', 'Off — fastest'], ['low', 'Low — 1K map'], ['high', 'High — 2K map'], ['ultra', 'Ultra — 4K map']], g.shadows)}
        ${toggle('streetLights', 'Street and interior lights', 'Extra light sources around the arena.', g.streetLights)}</div>
      <div class="panel"><p class="eyebrow">View</p>
        ${slider('fov', 'Field of view', 60, 105, 1, 'deg')}
        ${slider('brightness', 'Brightness', 0.6, 1.6, 0.05, 'pct', s.brightness, 'Lifts dark corners on Night Fog and Storm Front without washing out the sky.')}
        <p class="eyebrow sub">Performance</p>
        ${select('fpsCap', 'Frame rate cap', [[0, 'Unlimited (screen refresh)'], [30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS'], [144, '144 FPS'], [240, '240 FPS']], s.fpsCap, 'A cap saves battery and heat on laptops.')}
        ${toggle('showFps', 'Show FPS counter', 'Frame rate, slowest frame and ping in the top-right corner.')}
        ${toggle('autoQuality', 'Lower graphics automatically', 'Steps the preset down if the frame rate stays under 38 for a few seconds.')}</div></div>`;
  }
  if (tab === 'audio') {
    return `<div class="settings-cols"><div class="panel"><p class="eyebrow">Audio</p>${slider('volume', 'Master volume', 0, 1, 0.05, 'pct')}${slider('ambience', 'Weather volume', 0, 1, 0.05, 'pct', s.ambience, 'Rain, wind and the night hum. Footsteps and gunfire are not affected.')}${slider('music', 'Music volume', 0, 1, 0.05, 'pct', s.music, 'Plays in the menus and between rounds.')}${toggle('musicInMatch', 'Keep music during rounds', 'Turn it off to hear nothing but the match while a round is live.')}${toggle('announcer', 'Announcer voice', 'Uses your browser’s speech voice, so it sounds different per system.')}</div>
      <div class="panel"><p class="eyebrow">HUD</p>${toggle('visualizeSound', 'Visualize sound effects', 'Draws footsteps and gunfire as on-screen markers.')}${toggle('showFps', 'Show FPS counter')}</div></div>`;
  }
  if (tab === 'crosshair') {
    const c = currentCrosshair();
    const xh = (path, label, min, max, step, format) => { const [group, field] = path.split('.'); return `<label>${label} <output>${FORMATS[format](c[group][field])}</output><input type="range" data-xh="${path}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${c[group][field]}" /></label>`; };
    const xhToggle = (path, label) => { const [group, field] = path.split('.'); const value = field ? c[group][field] : c[group]; return `<label class="check"><input type="checkbox" data-xh="${path}" ${value ? 'checked' : ''} /> <span>${label}</span></label>`; };
    const lines = (group, title) => `<div class="panel"><p class="eyebrow">${title}</p>${xhToggle(`${group}.on`, 'Show')}${xh(`${group}.opacity`, 'Opacity', 0, 1, 0.05, 'pct')}${xh(`${group}.length`, 'Length', 0, 30, 1, 'px')}${xh(`${group}.thickness`, 'Thickness', 1, 10, 1, 'px')}${xh(`${group}.offset`, 'Offset', 0, 40, 1, 'px')}</div>`;
    return `<div class="xh-editor">
      <div class="xh-side"><div class="xh-preview" id="xh-preview">${['sky', 'wall', 'dark'].map((bg) => `<div class="xh-bg xh-${bg}"><div class="crosshair">${crosshairHtml(c)}</div></div>`).join('')}</div>
        <div class="panel"><p class="eyebrow">Presets</p><div class="xh-presets">${CROSSHAIR_PRESETS.map(([name, preset], index) => `<button type="button" data-xh-preset="${index}" title="${name}"><span class="crosshair">${crosshairHtml(preset)}</span><small>${name}</small></button>`).join('')}</div></div>
        <div class="panel"><p class="eyebrow">Share code</p><div class="room-row-input"><input id="xh-code" value="${escapeHtml(crosshairCode(c))}" spellcheck="false" autocomplete="off" /><button type="button" id="xh-copy">Copy</button><button type="button" id="xh-import" class="secondary-button">Import</button></div><small class="hint">Paste a friend’s code and press Import.</small></div></div>
      <div class="xh-controls">
        <div class="panel"><p class="eyebrow">Colour</p><div class="swatches xh-colors">${CROSSHAIR_COLORS.map((color) => `<button type="button" class="swatch${c.color === color ? ' selected' : ''}" data-xh-color="${color}" style="--swatch:${color}" aria-label="${color}"></button>`).join('')}<input type="color" data-xh="color" value="${c.color}" aria-label="Custom colour" /></div>
          ${xhToggle('outline.on', 'Outline')}${xh('outline.opacity', 'Outline opacity', 0, 1, 0.05, 'pct')}${xh('outline.thickness', 'Outline thickness', 1, 6, 1, 'px')}</div>
        <div class="panel"><p class="eyebrow">Centre dot</p>${xhToggle('dot.on', 'Show')}${xh('dot.size', 'Size', 1, 12, 1, 'px')}${xh('dot.opacity', 'Opacity', 0, 1, 0.05, 'pct')}
          <p class="eyebrow sub">Behaviour</p>${xhToggle('dynamic', 'Open up with movement and recoil')}${xhToggle('tee', 'T-shape (no top line)')}</div>
        ${lines('inner', 'Inner lines')}${lines('outer', 'Outer lines')}
      </div></div>`;
  }
  if (tab === 'binds') {
    const groups = [...new Set(ACTIONS.map((action) => action.group))];
    const slot = (action, index) => { const waiting = listening?.action === action.id && listening.slot === index; return `<button type="button" class="bind${waiting ? ' waiting' : ''}" data-bind="${action.id}" data-slot="${index}">${waiting ? 'PRESS A KEY…' : codeLabel(bindsFor(action.id)[index])}</button>`; };
    return `<div class="bind-cols">${groups.map((group) => `<div class="panel"><p class="eyebrow">${group}</p>${ACTIONS.filter((action) => action.group === group).map((action) => `<div class="bind-row"><span>${action.label}</span>${slot(action, 0)}${slot(action, 1)}</div>`).join('')}</div>`).join('')}</div>
      <p class="hint bind-help">Click a slot, then press a key or mouse button. <b>Esc</b> cancels, <b>Backspace</b> clears the slot. A key can only do one thing, so binding it here takes it off whatever had it. The mouse wheel always zooms scopes and switches weapons.</p>
      <div class="panel"><p class="eyebrow">Gamepad</p><div class="controls-list"><div><b>GAMEPAD</b><span>Sticks move/aim · RT fire · LT scope · X reload · Y swap · B crouch · LB/RB gadgets</span></div></div></div>`;
  }
  return `<div class="settings-cols"><div class="panel"><p class="eyebrow">Sensitivity</p>${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, 'x2')}${slider('scopeSensitivity', 'Scoped sensitivity', 0.2, 1.5, 0.05, 'x2', s.scopeSensitivity, 'Multiplier while aiming down a sight or scope.')}${slider('padSensitivity', 'Controller sensitivity', 0.4, 2.5, 0.1, 'x1')}</div>
    <div class="panel"><p class="eyebrow">Behaviour</p>${toggle('invertY', 'Invert Y axis')}${toggle('toggleScope', 'Toggle scope', 'Press once to aim, again to lower — instead of holding.')}${toggle('toggleCrouch', 'Toggle crouch')}</div></div>`;
}
function settingsShellHtml(tab) {
  const resets = { binds: ['reset-binds', 'Reset key binds'], crosshair: ['reset-crosshair', 'Reset crosshair'] }[tab] || ['reset-settings', 'Reset settings'];
  return `<div class="settings-shell"><nav class="settings-tabs" aria-label="Settings sections">${SETTINGS_TABS.map(([id, label]) => `<button type="button" data-settings-tab="${id}" class="${id === tab ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <div class="settings-body">${settingsBodyHtml(tab)}</div>
    <div class="button-row"><button type="button" id="${resets[0]}" class="ghost-button">${resets[1]}</button><span class="muted">Changes save as you make them.</span></div></div>`;
}
// On the menu, Controls is simply Settings opened on the key binds.
function settingsPageHtml(tab = settingsTab) {
  const titles = { aim: 'Fine <em>tune.</em>', graphics: 'Looks and <em>frames.</em>', audio: 'Sound and <em>HUD.</em>', crosshair: 'Your <em>crosshair.</em>', binds: 'Your <em>keys.</em>' };
  return `<section class="page-wide settings-page"><p class="eyebrow">${tab === 'binds' ? 'Controls' : 'Settings'}</p><h1 class="page-title">${titles[tab]}</h1>${settingsShellHtml(tab)}</section>`;
}
const controlsPageHtml = () => settingsPageHtml('binds');

export function openSettings(controlsOnly = false) {
  if (controlsOnly) settingsTab = 'binds';
  settingsCard.innerHTML = `<p class="eyebrow">Settings</p><h2>${SETTINGS_TABS.find(([id]) => id === settingsTab)[1]}.</h2><div class="settings-page">${settingsShellHtml(settingsTab)}</div><div class="button-row"><button type="button" id="close-settings">Done</button></div>`;
  settingsCard.classList.remove('hidden');
  document.exitPointerLock?.();
}
const settingsOverlayOpen = () => !settingsCard.classList.contains('hidden');
function refreshSettings() { if (settingsOverlayOpen()) openSettings(); else if (game.screen === 'home') renderHome(); }

function applySetting(event) {
  const input = event.target;
  const output = input.closest('label')?.querySelector('output');
  if (input.dataset.xh) {
    const crosshair = currentCrosshair();
    const [group, field] = input.dataset.xh.split('.');
    const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    if (field) crosshair[group][field] = value; else crosshair[group] = value;
    game.settings.crosshair = crosshair;
    if (output) output.textContent = FORMATS[input.dataset.format](value);
    document.querySelectorAll('#xh-preview .crosshair').forEach((node) => { node.innerHTML = crosshairHtml(crosshair); });
    if ($('#xh-code')) $('#xh-code').value = crosshairCode(crosshair);
    saveSettings();
    return;
  }
  const key = input.dataset.setting;
  if (!key) return;
  let value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
  if (key === 'fpsCap') value = Number(value);
  // Fine graphics controls start from whatever the preset was showing, then the preset becomes Custom.
  if (GRAPHICS_KEYS.includes(key) && game.settings.quality !== 'custom') { const g = graphics(); GRAPHICS_KEYS.forEach((k) => { game.settings[k] = g[k]; }); game.settings.quality = 'custom'; }
  game.settings[key] = value;
  if (output) output.textContent = FORMATS[input.dataset.format || 'x2'](value);
  if (key === 'volume') setVolume(value);
  saveSettings();
}
// Things that change what else is on screen redraw once the control is released.
function onSettingsChange(event) { if (GRAPHICS_KEYS.includes(event.target.dataset.setting)) refreshSettings(); }
function onSettingsClick(event) {
  const target = event.target.closest('button');
  if (!target) return false;
  if (target.dataset.settingsTab) {
    listening = null; settingsTab = target.dataset.settingsTab; play('ui');
    if (settingsOverlayOpen()) openSettings(); else { pageEntering = true; setHomePage(settingsTab === 'binds' ? 'controls' : 'settings'); renderHome(); }
  } else if (target.dataset.preset) { game.settings.quality = target.dataset.preset; saveSettings(); play('ui'); refreshSettings(); }
  else if (target.dataset.bind) { listening = { action: target.dataset.bind, slot: Number(target.dataset.slot) }; play('ui'); refreshSettings(); }
  else if (target.dataset.xhPreset) { game.settings.crosshair = cleanCrosshair(CROSSHAIR_PRESETS[Number(target.dataset.xhPreset)][1]); saveSettings(); play('ui'); refreshSettings(); }
  else if (target.dataset.xhColor) { game.settings.crosshair = { ...currentCrosshair(), color: target.dataset.xhColor }; saveSettings(); play('ui'); refreshSettings(); }
  else if (target.id === 'xh-copy') navigator.clipboard?.writeText($('#xh-code').value).then(() => toast('Crosshair code copied.', 'good'), () => toast('Select the code and copy it manually.', 'warn'));
  else if (target.id === 'xh-import') {
    const parsed = crosshairFromCode($('#xh-code').value);
    if (!parsed) { toast('That is not a Krosshair crosshair code — they start with K1;', 'warn'); play('deny'); return true; }
    game.settings.crosshair = parsed; saveSettings(); play('buy'); toast('Crosshair imported.', 'good'); refreshSettings();
  } else if (target.id === 'reset-settings') { const keep = { binds: game.settings.binds, crosshair: game.settings.crosshair }; Object.assign(game.settings, DEFAULT_SETTINGS, keep); saveSettings(); setVolume(game.settings.volume); play('uiBack'); refreshSettings(); }
  else if (target.id === 'reset-binds') { resetBinds(); play('uiBack'); refreshSettings(); }
  else if (target.id === 'reset-crosshair') { game.settings.crosshair = null; saveSettings(); play('uiBack'); refreshSettings(); }
  else return false;
  return true;
}
// While a bind slot is waiting, the next key or mouse button goes to it and nowhere else.
function captureBind(event) {
  if (!listening) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  const code = event.type === 'keydown' ? event.code : `Mouse${event.button}`;
  const { action, slot } = listening;
  if (code === 'Escape') { listening = null; play('uiBack'); return refreshSettings(); }
  if (RESERVED.includes(code)) { toast(`${codeLabel(code)} is reserved by the game or the browser.`, 'warn'); play('deny'); return; }
  listening = null;
  const displaced = setBind(action, slot, code === 'Backspace' || code === 'Delete' ? null : code);
  if (displaced) toast(`${codeLabel(code)} was taken off “${displaced}”.`, 'info');
  play('ready');
  // The click that follows this mouse press must not land on whatever is under the cursor.
  if (event.type === 'mousedown') addEventListener('click', (click) => { click.preventDefault(); click.stopPropagation(); }, { capture: true, once: true });
  refreshSettings();
}
addEventListener('keydown', captureBind, true);
addEventListener('mousedown', captureBind, true);
home.addEventListener('input', applySetting);
home.addEventListener('change', onSettingsChange);
settingsCard.addEventListener('input', applySetting);
settingsCard.addEventListener('change', onSettingsChange);
settingsCard.addEventListener('click', (event) => {
  if (event.target.id === 'close-settings') { listening = null; settingsCard.classList.add('hidden'); play('uiBack'); bus.emit('settings-closed'); return; }
  onSettingsClick(event);
});

// ------------------------------------------------------------------ feedback
const feedbackCard = $('#feedback');
const FEEDBACK_COPY = {
  bug: { title: 'Scope stays zoomed in after I die', details: 'What happened, what you expected instead, and the steps to make it happen again.', send: 'Send bug report' },
  suggestion: { title: 'Add a burst-fire rifle', details: 'What you would add or change, and how it would make matches better.', send: 'Send suggestion' },
};
let feedbackKind = 'bug';
let feedbackPending = false;
function sentReports() { try { return JSON.parse(localStorage.getItem('krosshair:feedback') || '[]'); } catch { return []; } }

function feedbackFormHtml() {
  const copy = FEEDBACK_COPY[feedbackKind];
  return `<form id="feedback-form" novalidate>
        <div class="segmented" role="radiogroup" aria-label="Type">${Object.entries({ bug: 'Bug', suggestion: 'Suggestion' }).map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === feedbackKind}" class="${id === feedbackKind ? 'active' : ''}" data-kind="${id}">${label}</button>`).join('')}</div>
        <label class="field">Title<input name="title" maxlength="90" required placeholder="${copy.title}" autocomplete="off" /></label>
        <label class="field">Details<textarea name="details" maxlength="3000" rows="7" required placeholder="${copy.details}"></textarea><small class="counter"><span id="feedback-count">0</span> / 3000</small></label>
        <label class="check"><input type="checkbox" name="device" checked /> Include browser, screen size and graphics settings</label>
        <div class="feedback-actions"><button type="submit" id="feedback-send">${copy.send}</button><p id="feedback-status" class="feedback-status" role="status"></p></div>
      </form>`;
}
function feedbackSentHtml() {
  const sent = sentReports();
  return sent.length ? `<section class="feedback-sent"><h3>Sent from this browser</h3>${sent.slice(0, 5).map((r) => `<div><span class="kind ${r.kind}">${r.kind === 'bug' ? 'Bug' : 'Idea'}</span><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.ref)} · ${new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`).join('')}</section>` : '';
}
function feedbackPageHtml() {
  return `<section class="page-main feedback-page"><p class="eyebrow">Feedback</p><h1 class="page-title">Tell us what <em>broke.</em></h1><div class="panel">${feedbackFormHtml()}</div></section>
    <aside class="page-side"><div class="panel"><p class="eyebrow">What helps most</p><ul class="feature-list plain"><li>One report per problem — it’s easier to track.</li><li>For bugs: what you did, what happened, what you expected.</li><li>The arena, mode and weapon if it happened in a match.</li></ul></div>${feedbackSentHtml() ? `<div class="panel">${feedbackSentHtml()}</div>` : ''}</aside>`;
}
// What is typed survives re-renders (the menu redraws whenever the profile or room list changes) and type switches.
function readFeedbackDraft() { const form = $('#feedback-form'); return form ? { title: form.title.value, details: form.details.value, device: form.device.checked, status: $('#feedback-status')?.outerHTML, focus: document.activeElement?.name } : null; }
function writeFeedbackDraft(draft) {
  const form = $('#feedback-form');
  if (!form || !draft) return;
  form.title.value = draft.title; form.details.value = draft.details; form.device.checked = draft.device;
  $('#feedback-count').textContent = draft.details.length;
  if (draft.status) $('#feedback-status').outerHTML = draft.status;
}
const feedbackOnPage = () => Boolean(home.querySelector('#feedback-form'));
function switchFeedbackKind(kind) {
  if (!FEEDBACK_COPY[kind] || kind === feedbackKind) return;
  const draft = readFeedbackDraft();
  feedbackKind = kind;
  if (feedbackOnPage()) renderHome(); else openFeedback(kind);
  writeFeedbackDraft({ ...draft, status: null });
  play('ui');
}

export function openFeedback(kind = feedbackKind) {
  feedbackKind = kind;
  feedbackCard.innerHTML = `
    <div class="feedback-card">
      <header class="feedback-head">
        <div><p class="eyebrow">Feedback</p><h2 id="feedback-title">Report a bug or suggest an idea</h2></div>
        <button type="button" class="ghost-button" data-feedback-close>Close <kbd>Esc</kbd></button>
      </header>
      ${feedbackFormHtml()}
      ${feedbackSentHtml()}
    </div>`;
  feedbackCard.classList.remove('hidden');
  document.exitPointerLock?.();
  $('#feedback-form input[name="title"]').focus();
}
export function closeFeedback() {
  if (feedbackCard.classList.contains('hidden')) return;
  feedbackCard.classList.add('hidden');
  bus.emit('feedback-closed');
}
function setFeedbackStatus(text, tone = '') { const status = $('#feedback-status'); if (status) { status.textContent = text; status.className = `feedback-status ${tone}`; } }

feedbackCard.addEventListener('click', (event) => {
  if (event.target === feedbackCard || event.target.closest('[data-feedback-close]')) { play('uiBack'); return closeFeedback(); }
  const kind = event.target.closest('[data-kind]')?.dataset.kind;
  if (kind) switchFeedbackKind(kind);
});
const countFeedback = (event) => { if (event.target.name === 'details' && $('#feedback-count')) $('#feedback-count').textContent = event.target.value.length; };
feedbackCard.addEventListener('input', countFeedback);
home.addEventListener('input', countFeedback);
feedbackCard.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Escape') closeFeedback(); });
function submitFeedback(event) {
  if (event.target.id !== 'feedback-form') return;
  event.preventDefault();
  if (feedbackPending) return;
  const form = event.target;
  const title = form.title.value.trim(), details = form.details.value.trim();
  if (title.length < 4) { setFeedbackStatus('Give it a title of at least 4 characters.', 'warn'); return form.title.focus(); }
  if (details.length < 10) { setFeedbackStatus('Add a few more words of detail.', 'warn'); return form.details.focus(); }
  if (!net.connected) return setFeedbackStatus('Not connected to the server. Your report is still here; send it once you reconnect.', 'warn');
  const device = form.device.checked ? {
    browser: navigator.userAgent, screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`, quality: game.settings.quality, fov: game.settings.fov,
    screenName: game.screen, room: game.room?.name || '', mode: game.room?.mode || '', phase: game.room?.phase || '',
  } : null;
  feedbackPending = { kind: feedbackKind, title };
  $('#feedback-send').disabled = true;
  setFeedbackStatus('Sending…');
  net.send({ type: 'feedback', kind: feedbackKind, title, details, device });
  setTimeout(() => { if (feedbackPending && feedbackPending.title === title) { feedbackPending = false; const send = $('#feedback-send'); if (send) send.disabled = false; setFeedbackStatus('No answer from the server. Try sending again.', 'warn'); } }, 8000);
}
feedbackCard.addEventListener('submit', submitFeedback);
home.addEventListener('submit', submitFeedback);
net.on('feedback-result', (message) => {
  const pending = feedbackPending;
  feedbackPending = false;
  const send = $('#feedback-send');
  if (send) send.disabled = false;
  if (!message.ok || !pending) return setFeedbackStatus(message.message || 'That did not send. Try again.', 'warn');
  const sent = [{ ...pending, ref: message.ref, at: Date.now() }, ...sentReports()].slice(0, 20);
  try { localStorage.setItem('krosshair:feedback', JSON.stringify(sent)); } catch { /* private mode */ }
  play('buy');
  if (feedbackOnPage()) { home.querySelector('#feedback-form').reset(); renderHome(); } else openFeedback(feedbackKind);
  setFeedbackStatus(`Sent — thanks. Reference ${message.ref}.`, 'good');
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
  const rows = (side) => message.table.filter((row) => row.team === side).map((row) => `<div class="score-row${row.id === game.id ? ' you' : ''}"><span class="pilot"><i style="background:${row.color}"></i>${escapeHtml(row.name)}${row.mvp ? ' <em class="mvp">MVP</em>' : ''}${row.bot ? ' <em>BOT</em>' : ''}</span><span>${row.playerKills ?? row.kills}</span><span>${row.botKills ?? 0}</span><span>${row.deaths}</span><span>${row.assists}</span><span>${row.damage}</span><span>${row.headshots}</span><span>${row.accuracy}%</span><span>${row.score}</span></div>`).join('');
  const head = '<div class="score-row head"><span>PILOT</span><span title="Player kills">K</span><span title="Bot kills">BOT</span><span>D</span><span>A</span><span>DMG</span><span>HS</span><span>ACC</span><span>SCORE</span></div>';
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
  if (target.id === 'share-download') { const link = document.createElement('a'); link.download = 'krosshair-match.png'; link.href = $('#share-canvas').toDataURL('image/png'); link.click(); }
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
  gradient.addColorStop(0, '#0a0e12'); gradient.addColorStop(1, '#141c24');
  c.fillStyle = gradient; c.fillRect(0, 0, 1200, 630);
  c.fillStyle = 'rgba(230,237,241,.025)';
  for (let y = 0; y < 630; y += 6) c.fillRect(0, y, 1200, 1);
  c.fillStyle = accent; c.fillRect(0, 0, 14, 630);
  c.fillStyle = '#ffb547'; c.font = '700 22px "Geist", sans-serif'; c.fillText('KROSSHAIR  //  KESTREL YARD  //  ' + (VARIANT_NAMES[message.variant] || '').toUpperCase(), 70, 84);
  c.fillStyle = '#e6edf1'; c.font = '400 170px "Michroma", sans-serif'; c.fillText(result, 62, 250);
  c.fillStyle = accent; c.font = '400 120px "Michroma", sans-serif';
  c.textAlign = 'right'; c.fillText(`${message.scores[row.team]} – ${message.scores[row.team === 'A' ? 'B' : 'A']}`, 1130, 240); c.textAlign = 'left';
  c.fillStyle = '#8c99a4'; c.font = '600 30px "Geist", sans-serif'; c.fillText(`${game.look.title.toUpperCase()}  ${row.name.toUpperCase()}${row.mvp ? '   ★ MVP' : ''}`, 70, 320);
  const stats = [['KILLS', row.kills], ['DEATHS', row.deaths], ['ASSISTS', row.assists], ['HEADSHOTS', row.headshots], ['ACCURACY', `${row.accuracy}%`], ['LONGEST', `${row.longest} M`]];
  stats.forEach(([label, value], index) => {
    const x = 70 + index * 182;
    c.fillStyle = 'rgba(242,240,234,.06)'; c.fillRect(x, 370, 166, 150);
    c.fillStyle = accent; c.fillRect(x, 370, 4, 150);
    c.fillStyle = '#e6edf1'; c.font = '400 66px "Michroma", sans-serif'; c.fillText(String(value), x + 22, 450);
    c.fillStyle = '#56626c'; c.font = '600 17px "Geist", sans-serif'; c.fillText(label, x + 22, 492);
  });
  c.fillStyle = '#56626c'; c.font = '500 20px "Geist", sans-serif';
  c.fillText(`${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}  ·  ${(MODIFIERS[message.modifier]?.name || 'Standard').toUpperCase()}  ·  LEVEL ${game.profile?.level || levelFromXp(0)}`, 70, 580);
}

// ------------------------------------------------------------------ range tutorial
const drills = () => [['move', `Move with ${['forward', 'left', 'back', 'right'].map((id) => codeLabel(bindsFor(id)[0])).join(' ')}`], ['crouch', `Crouch with ${bindLabel('crouch')} — crouched steps are silent`], ['scope', `${game.settings.toggleScope ? 'Press' : 'Hold'} ${bindLabel('scope')} to scope in`], ['fire', `Fire with ${bindLabel('fire')}`], ['hit', 'Hit a target'], ['headshot', 'Land a headshot'], ['reload', `Reload with ${bindLabel('reload')}`], ['wallbang', 'Shoot a target through the wooden wall'], ['buy', `Open the armoury with ${bindLabel('armoury')}`], ['gadget', `Use a gadget with ${codeLabel(bindsFor('gadget1')[0])} or ${codeLabel(bindsFor('gadget2')[0])}`]];
const drillsDone = new Set();
export function renderTutorial(show) {
  const panel = $('#tutorial');
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  panel.innerHTML = `<p class="eyebrow">Range drills <small>${drillsDone.size}/${drills().length}</small></p>${drills().map(([id, text]) => `<div class="drill${drillsDone.has(id) ? ' done' : ''}"><i></i>${text}</div>`).join('')}<small class="muted">Scoped: hold SHIFT to steady your breath, scroll to change zoom. ESC → Leave when you are ready for a real match.</small>`;
}
bus.on('tutorial', (id) => {
  if (game.room?.mode !== 'range' || drillsDone.has(id)) return;
  drillsDone.add(id);
  play('ready');
  renderTutorial(true);
  if (drillsDone.size === drills().length && !game.tutorialDone) { game.tutorialDone = true; store('tutorialDone', true); uploadPrefs(0); toast('Drills complete. You are cleared for live matches.', 'good'); }
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
// Live menu: the online count changes in place; the room list redraws only when it actually changed.
let shownRooms = '';
bus.on('menu', () => {
  const label = $('#online-count');
  if (label) label.innerHTML = `<i class="live-dot"></i>${onlineLabel()}`;
  const rooms = JSON.stringify(game.publicRooms);
  if (rooms === shownRooms) return;
  shownRooms = rooms;
  if (game.screen === 'home' && (homePage === 'rooms' || homePage === 'play')) renderHome();
});
bus.on('net-status', ({ state, rejoining }) => {
  if (state === 'updating') { toast('New version of Krosshair — updating…', 'good'); return; }
  const label = $('#online-count');
  if (label) label.innerHTML = `<i class="live-dot"></i>${onlineLabel(state)}`;
  if (state === 'open' && game.screen === 'home' && !game.profile) renderHome();
  netBanner.classList.toggle('hidden', state === 'open' || game.screen === 'home');
  netBanner.textContent = rejoining ? 'Connection lost — rejoining your match…' : 'Connection lost — reconnecting…';
});
