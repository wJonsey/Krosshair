// Everything outside the match: home screen, career, lobby, settings,
// end-of-match report, share card, tutorial checklist, toasts.
import { initPadMenu } from './padmenu.js';
import * as THREE from 'three';
import { BOT_DIFFICULTY, BOT_TYPES, COSMETICS, MASTERY_TIERS, MODIFIERS, RANKED_SIZES, RANK_TIERS, TEAM_MODES, TEAM_MODE_IDS, isRanked, VARIANT_NAMES, WEAPONS, levelFromXp, masteryTier, rankInfo, xpForLevel } from '../shared/constants.js';
import { bus, game, graphics, migrateSettings, saveSettings, store, tabStore, DEFAULT_SETTINGS } from './state.js';
import { ACCOUNTS_ENABLED, DISCORD_INVITE, TIKTOK_URL } from '../shared/constants.js';
import { rankBadge, rankChip } from './ranks.js';
import { net } from './net.js';
import { ACTIONS, PAD_ACTIONS, PAD_LAYOUTS, PAD_LAYOUT_IDS, RESERVED, bindLabel, bindsFor, codeLabel, input, padBindFor, padLayout, padName, resetBinds, resetPadBinds, setBind, setPadBind } from './input.js';
import { CROSSHAIR_COLORS, CROSSHAIR_PRESETS, cleanCrosshair, crosshairCode, crosshairFromCode, crosshairHtml, currentCrosshair } from './crosshair.js';
import { play, setVolume, unlockAudio } from './audio.js';
import { buildOperator, styleOperator, animateOperator, lookOf } from './characters.js';
import { COIN, SHOP_PAGES, coins, initShop, keepShopInput, mountShop, onShopClick, onShopInput, restoreShopInput, shopPageHtml } from './shop.js';
import { patternSwatch } from './skins.js';
import { WAGER } from '../shared/economy.js';
import { ROYALE } from '../shared/royale.js';
import { mapRuleOptions, mapRuleSummary, renderMapVote, stopMapVote } from './mapvote.js';
import { outageReason } from '../shared/outage.js';
import { initSocial, socialButtonHtml, toggleSocial } from './social.js';

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
  if (state !== 'open') return 'OFFLINE';
  return net.identified ? `${game.online} ONLINE` : 'ONLINE';
}

// Who is on the server, for the developers only. The server refuses the question from anyone else.
const onlineCard = document.createElement('div');
onlineCard.className = 'online-card hidden';
document.body.append(onlineCard);
onlineCard.addEventListener('click', (event) => { if (event.target.closest('[data-dev-online-close]') || event.target === onlineCard) { play('uiBack'); closeOnline(); } });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && !onlineCard.classList.contains('hidden')) closeOnline(); });
let onlineTimer = null;
function closeOnline() { clearInterval(onlineTimer); onlineTimer = null; onlineCard.classList.add('hidden'); }
function openOnline() {
  onlineCard.classList.remove('hidden');
  onlineCard.innerHTML = '<div class="panel"><p class="eyebrow">Who is playing</p><p class="muted">Asking the server…</p></div>';
  net.send({ type: 'dev-online' });
  clearInterval(onlineTimer);
  onlineTimer = setInterval(() => net.send({ type: 'dev-online' }), 4000);
}
net.on('dev-online', (message) => {
  if (onlineCard.classList.contains('hidden')) return;
  const accounts = message.players.filter((player) => player.account), guests = message.players.filter((player) => !player.account);
  const row = (player) => `<div class="online-row${player.you ? ' you' : ''}"><b>${escapeHtml(player.name)}</b><small>${player.account ? `LV ${player.level}` : 'guest'}</small><span>${player.room ? `${escapeHtml(player.room)} · ${(player.phase || '').toUpperCase()}` : 'in the menus'}</span>${player.ping ? `<em>${player.ping} ms</em>` : '<em></em>'}</div>`;
  const list = (title, rows) => `<p class="eyebrow sub">${title} <small>${rows.length}</small></p>${rows.length ? rows.map(row).join('') : '<p class="muted">Nobody.</p>'}`;
  onlineCard.innerHTML = `<div class="panel online-panel"><p class="eyebrow">Who is playing <small>${message.players.length} online · ${message.bots} bots</small></p>
    ${list('Accounts', accounts)}${list('Guests', guests)}
    <p class="eyebrow sub">Rooms <small>${message.rooms.length}</small></p>
    ${message.rooms.length ? message.rooms.map((room) => `<div class="online-row"><b>${escapeHtml(room.name)}</b><small>${room.queue}</small><span>${(room.phase || '').toUpperCase()}</span><em>${room.humans} + ${room.bots} bots</em></div>`).join('') : '<p class="muted">No rooms.</p>'}
    <div class="button-row"><button type="button" class="ghost-button" data-dev-online-close="1">Close</button></div></div>`;
});

// ------------------------------------------------------------------ account
let authMode = 'login';
let authPending = null;
let applyingPrefs = false;
let prefsTimer = null;

let pendingPlay = null;
const DISCORD_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.6 5.2A17 17 0 0 0 15.4 4l-.5 1a15.700 15.700 0 0 0-5.800 0L8.600 4a17 17 0 0 0-4.200 1.200C1.700 9.200 1 13.100 1.300 17a17.100 17.100 0 0 0 5.200 2.600l1.100-1.800a11 11 0 0 1-1.700-.8l.4-.3a12.200 12.200 0 0 0 11.400 0l.4.3c-.5.300-1.100.600-1.700.8l1.100 1.800a17 17 0 0 0 5.200-2.600c.4-4.500-.7-8.400-3.100-11.800ZM8.700 14.600c-1 0-1.900-.9-1.900-2.100s.8-2.100 1.900-2.100 1.900.9 1.900 2.100-.8 2.100-1.900 2.100Zm6.600 0c-1 0-1.900-.9-1.900-2.100s.8-2.100 1.900-2.100 1.900.9 1.900 2.100-.8 2.100-1.900 2.100Z"/></svg>';
const GEAR_MARK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.400 1a7.500 7.500 0 0 0-1.700-1L15 3.500h-4l-.4 2.500a7.500 7.500 0 0 0-1.700 1l-2.400-1-2 3.400L6.600 11a7.600 7.600 0 0 0 0 2l-2 1.600 2 3.400 2.400-1c.5.4 1.100.7 1.700 1l.4 2.500h4l.4-2.500c.6-.3 1.200-.6 1.700-1l2.400 1 2-3.400-2-1.600ZM13 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7Z"/></svg>';
const TIKTOK_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z"/></svg>';
const socialHtml = () => `<a class="social-link discord" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer" title="Krosshair on Discord" aria-label="Krosshair on Discord">${DISCORD_MARK}</a><a class="social-link tiktok" href="${TIKTOK_URL}" target="_blank" rel="noopener noreferrer" title="Krosshair on TikTok" aria-label="Krosshair on TikTok">${TIKTOK_MARK}</a>`;
function accountRowHtml() {
  const avatar = game.avatar ? `<img class="avatar" src="${escapeHtml(game.avatar)}" alt="" width="36" height="36" referrerpolicy="no-referrer" />` : '';
  return `<div class="account-row">${avatar}<div><span class="field-label">${game.avatar || !ACCOUNTS_ENABLED ? 'Signed in with Discord' : 'Signed in as'}</span><b>${escapeHtml(game.username)}</b></div><button type="button" id="logout-button" class="ghost-button">Log out</button></div>`;
}
// Sign-up and login are the same button. When the server requires a login there is no guest callsign at all.
function discordHtml() {
  const required = game.loginRequired && !ACCOUNTS_ENABLED;
  // The button is always there. On a server with no Discord application yet it opens the setup steps.
  const login = net.sameOrigin ? `<a class="discord-button" href="/auth/discord">${DISCORD_MARK}<span>Log in / sign up with Discord</span></a><small class="hint">${required ? 'Login required. ' : ''}Keeps your progress and rank on any device. Adds you to the Krosshair Discord.${game.discord.enabled || !net.connected ? '' : ' <b class="warn">Discord login is down. Try again shortly.</b>'}</small>` : '<p class="muted">Discord login only works on krosshair.online.</p>';
  return `<div class="discord-block${required ? ' required' : ''}">${login}<a class="discord-link" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">Join the Discord →</a></div>`;
}
function authHtml({ guestOption = true } = {}) {
  if (game.username) return accountRowHtml();
  if (!net.connected && !game.discord.enabled) return '<p class="muted">Connecting…</p>';
  if (game.loginRequired && !ACCOUNTS_ENABLED) return discordHtml();
  if (!ACCOUNTS_ENABLED) return guestOption ? `${discordHtml()}<div class="or-rule"><span>or play as a guest</span></div><label class="callsign-field">Callsign<input id="name-input" maxlength="16" placeholder="Enter a callsign" autocomplete="nickname" value="${escapeHtml(game.name)}" /></label><small class="hint guest-note">Guest progress is gone when you close the tab. No ranked.${game.profile?.xp ? ' Sign up with Discord to keep it.' : ''}</small>` : discordHtml();
  const signup = authMode === 'signup';
  return `<form class="auth" id="auth-form" novalidate>
    <div class="segmented" role="tablist" aria-label="Account">${[['login', 'Log in'], ['signup', 'Sign up']].map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === authMode}" class="${id === authMode ? 'active' : ''}" data-auth-mode="${id}">${label}</button>`).join('')}</div>
    <label class="field">Username<input id="auth-username" autocomplete="username" maxlength="16" spellcheck="false" autocapitalize="off" /></label>
    <label class="field">Password<input id="auth-password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="128" /></label>
    ${signup ? '<label class="field">Confirm password<input id="auth-confirm" type="password" autocomplete="new-password" maxlength="128" /></label><p class="auth-hint">Your username is your callsign. Passwords can’t be reset.</p>' : ''}
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
  if (message.expired) toast('Session expired. Log in again.', 'warn');
  if (game.screen === 'home') renderHome();
});
net.on('logged-out', () => { toast('Logged out.'); bus.emit('logged-out'); if (game.screen === 'home') renderHome(); });

// ------------------------------------------------------------------ operator preview
// One canvas and one WebGL context for the whole session: the page is redrawn on every click, and a new
// renderer per redraw used up the browser's contexts until it killed the game's own (a white screen).
// Each redraw leaves a placeholder canvas that the real one is swapped into.
function ensurePreview(placeholder) {
  if (preview) {
    if (placeholder !== preview.canvas) placeholder.replaceWith(preview.canvas);
    return;
  }
  const canvas = placeholder;
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
// Fills the panel with the pilot, measured off the model rather than a fixed distance: the stage is
// much taller than it is wide, and the name card sits over the bottom of it, so the fit is to the band
// above the card. Without this the pilot floated in the top corner with dead space under them.
function framePreview(width, height) {
  const box = new THREE.Box3().setFromObject(preview.model);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const half = Math.tan((preview.camera.fov * Math.PI / 180) / 2);
  const card = preview.canvas.parentElement?.querySelector('.play-stage-info');
  // Only the solid part of the card covers anything: above that it fades to nothing.
  const covered = card ? Math.min(height * 0.45, card.offsetHeight * 0.6) : 0;
  const band = Math.max(120, height - covered);
  // The pilot turns on the spot, so fit whichever of the two horizontal sizes is wider.
  const tall = (size.y * 1.06) / 2 / half * (height / band);
  const wide = (Math.max(size.x, size.z) * 1.12) / 2 / half / preview.camera.aspect;
  const dist = Math.min(Math.max(tall, wide), tall * 1.35);
  // Drop the camera by half the covered strip so the pilot sits centred in the band, not the panel.
  const lift = (covered / 2 / height) * (2 * dist * half);
  preview.camera.position.set(0, mid.y - lift, dist);
  preview.camera.lookAt(0, mid.y - lift, 0);
}
export function renderPreview() {
  if (!preview || home.classList.contains('hidden') || !preview.canvas.isConnected) return;
  const now = performance.now();
  const width = preview.canvas.clientWidth, height = preview.canvas.clientHeight;
  if (width && height && (width !== preview.width || height !== preview.height)) {
    preview.width = width; preview.height = height;
    preview.renderer.setSize(width, height, false);
    preview.camera.aspect = width / height;
    framePreview(width, height);
    preview.camera.updateProjectionMatrix();
  }
  const dt = Math.min(0.05, (now - preview.last) / 1000);
  preview.last = now;
  preview.model.rotation.y = Math.PI + Math.sin(now / 2600) * 0.9;
  animateOperator(preview.model, { speed: 0, crouch: false, pitch: Math.sin(now / 1700) * 0.08, weapon: 'm44', dt });
  preview.renderer.render(preview.scene, preview.camera);
}
function refreshPreviewLook() { if (preview) styleOperator(preview.model, lookOf(game.look)); }

// A pilot's title. The developers' title gets the Dev class look everywhere it shows.
const DEV_TITLES = new Set(COSMETICS.title.filter((item) => item.dev).map((item) => item.id));
const titleHtml = (title) => (DEV_TITLES.has(title) ? `<span class="dev-title">${escapeHtml(title)}</span>` : escapeHtml(title || ''));

// ------------------------------------------------------------------ home
// Colour swatches: level ones show the level they need, coin ones show a coin until bought.
function swatchRow(kind, key, level) {
  const owned = game.profile?.owned || [];
  return COSMETICS[kind].filter((item) => !item.dev).map((item) => {
    const forSale = item.price && !owned.includes(`${kind}:${item.id}`);
    const locked = forSale || (!item.price && level < item.level);
    const selected = game.look[key] === item.id;
    const armed = armedGear === `gear:${kind}:${item.id}`;
    const label = forSale ? `${item.name} · ${item.price.toLocaleString('en')} coins` : `${item.name}${locked ? ` · level ${item.level}` : ''}`;
    return `<button type="button" class="swatch${selected ? ' selected' : ''}${locked ? ' locked' : ''}${forSale ? ' for-sale' : ''}${armed ? ' armed' : ''}" data-gear-kind="${kind}" data-gear="${item.id}" data-look-key="${key}" style="--swatch:${item.id}" title="${label}" aria-pressed="${selected}">${forSale ? (armed ? '<small>BUY?</small>' : COIN) : locked ? `<small>${item.level}</small>` : ''}</button>`;
  }).join('');
}

function careerHtml() {
  const profile = game.profile;
  if (!profile) return `<div class="panel"><p class="eyebrow">Career</p><p class="muted">${net.connected ? (game.loginRequired ? 'Log in with Discord to play.' : 'Pick a callsign or log in.') : 'Connecting…'}</p></div>`;
  const level = profile.level, base = xpForLevel(level), next = xpForLevel(level + 1);
  const progress = Math.round(((profile.xp - base) / (next - base)) * 100);
  const s = profile.stats;
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  // Kills from before accounts tracked the split count as player kills.
  const botKills = s.botKills || 0, playerKills = s.playerKills || Math.max(0, s.kills - botKills);
  const accuracy = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  const contracts = profile.contracts.map((c) => `<div class="contract${c.done ? ' done' : ''}"><div><span>${escapeHtml(c.text)}</span><em>+${c.xp} XP</em></div><div class="meter"><i style="width:${Math.round((c.progress / c.n) * 100)}%"></i></div><small>${c.done ? 'COMPLETE' : `${c.progress} / ${c.n}`}</small></div>`).join('');
  const mastery = Object.values(WEAPONS).map((weapon) => {
    const kills = profile.weapons[weapon.id]?.kills || 0;
    const tier = masteryTier(kills);
    const nextTier = MASTERY_TIERS[tier + 1];
    return `<div class="mastery tier-${tier}"><span>${weapon.name}</span><b>${MASTERY_TIERS[tier][1]}</b><small>${kills} kills${nextTier ? ` · ${nextTier[0] - kills} to ${nextTier[1]}` : ' · maxed'}</small></div>`;
  }).join('');
  const history = profile.history.length ? profile.history.slice(0, 8).map((h) => `<div class="history-row ${h.result}"><b>${h.result.toUpperCase()}</b><span>${h.score}</span><span title="${h.botKills ? `${h.playerKills} player, ${h.botKills} bot kills` : ''}">${h.playerKills ?? h.kills}${h.botKills ? `+${h.botKills}` : ''}/${h.deaths}/${h.assists}</span><span>${(h.mode || '').toUpperCase()}${h.mvp ? ' · MVP' : ''}</span><small>${h.rating === null ? '' : `${h.rating >= 0 ? '+' : ''}${h.rating} SR · `}${new Date(h.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`).join('') : '<p class="muted">No matches yet.</p>';
  const recent = profile.recent.length ? `<p class="recent"><span>RECENT PILOTS</span> ${profile.recent.map(escapeHtml).join(' · ')}</p>` : '';
  return `
    <div class="career-col"><div class="panel career"><p class="eyebrow">Service record</p>
      <div class="level-row"><b class="level">${level}</b><div><strong>${titleHtml(game.look.title)} ${escapeHtml(profile.name)}</strong><div class="meter"><i style="width:${progress}%"></i></div><small>${profile.xp - base} / ${next - base} XP to level ${level + 1}</small></div><div class="rank"><span>SKILL RATING</span><b>${profile.rankedMatches ? profile.rating : '-'}</b></div></div>
      ${rankPanelHtml(profile)}
      <div class="stat-grid"><div><b>${s.matches}</b><span>MATCHES</span></div><div><b>${winRate}%</b><span>WIN RATE</span></div><div><b>${kd}</b><span>K / D</span></div><div><b>${accuracy}%</b><span>ACCURACY</span></div><div><b>${playerKills}</b><span>PLAYER KILLS</span></div><div><b>${botKills}</b><span>BOT KILLS</span></div><div><b>${s.headshots}</b><span>HEADSHOTS</span></div><div><b>${s.longest} M</b><span>LONGEST KILL</span></div><div><b>${s.assists}</b><span>ASSISTS</span></div><div><b>${s.clutches}</b><span>CLUTCHES</span></div><div><b>${s.mvps}</b><span>MVPS</span></div><div><b>${s.wallbangs || 0}</b><span>WALLBANGS</span></div></div>
    </div>
    <div class="panel"><p class="eyebrow">Daily contracts <small>reset at 00:00 UTC</small></p>${contracts}</div></div>
    <div class="career-col"><div class="panel tabs"><div class="tab-head"><button type="button" class="tab active" data-tab="history">Match history</button><button type="button" class="tab" data-tab="mastery">Weapon mastery</button></div><div class="tab-body" data-body="history">${history}${recent}</div><div class="tab-body hidden" data-body="mastery">${mastery}</div></div></div>`;
}

// The ranked ladder as the pilot sees it: emblem, division, and the distance to the next one.
function rankPanelHtml(profile) {
  if (!game.username) return '<div class="rank-panel guest"><p class="muted">Log in with Discord to play ranked.</p></div>';
  const info = rankInfo(profile.rating, profile.rankedMatches);
  const detail = !info.placed ? `Placements ${info.placement.played} / ${info.placement.total}`
    : info.next ? `${info.toNext} SR to ${info.next}` : 'Top of the ladder.';
  const bar = info.placed ? info.progress : info.placement.played / info.placement.total;
  return `<div class="rank-panel" style="--rank:${info.color}">${rankBadge(info, 56)}<div><span class="field-label">Ranked</span><strong>${info.name}</strong><div class="meter rank-meter"><i style="width:${Math.round(bar * 100)}%"></i></div><small>${detail}</small></div></div>`;
}

// The menu is split into pages; the hash keeps the page across refreshes and makes Back work.
// Top-level entries own a group of pages: the first is where the nav button goes, the rest are its tabs.
const NAV = [
  ['Play', [['play', 'Matchmaking'], ['ranked', 'Ranked'], ['rooms', 'Rooms']]],
  ['Locker', [['locker', 'Locker']]],
  ['Shop', [['shop', 'Shop']]],
  ['Games', [['games', 'Games']]],
  ['Profile', [['career', 'Career'], ['wallet', 'Wallet']]],
  ['Leaderboard', [['leaderboard', 'Leaderboard']]],
  // Developers only. It is filtered out of the bar for everyone else, and the server refuses the
  // messages anyway, so this is only about not drawing a door nobody can open.
  ['Service', [['service', 'Service']]],
];
const navFor = () => NAV.filter(([label]) => label !== 'Service' || game.profile?.dev);
const TOOL_PAGES = [['settings', 'Settings'], ['controls', 'Controls'], ['feedback', 'Feedback']];
const PAGE_ALIAS = { operator: 'locker' }; // old links
// A guest gets the game and the settings. Everything that belongs to an account stays shut until there
// is an account to hang it on: a locker with nothing saved in it is worse than no locker at all.
// Rooms is open to guests: a callsign is enough to browse the public list, join a code, or start a
// custom room. Ranked stays out, because a guest profile never reaches disk and a rating that vanishes
// with the tab would drag real ones around with it. The wager panel says its own piece to a guest.
const GUEST_PAGES = new Set(['play', 'rooms', 'settings', 'controls', 'feedback']);
const guestLocked = (page) => !game.username && !GUEST_PAGES.has(page);
const ALL_PAGES = [...NAV.flatMap(([, pages]) => pages), ...TOOL_PAGES].map(([id]) => id);
const pageFromHash = () => { const id = PAGE_ALIAS[location.hash.slice(1)] || location.hash.slice(1); return ALL_PAGES.includes(id) ? id : 'play'; };
const groupOf = (page) => NAV.find(([, pages]) => pages.some(([id]) => id === page));
// Tabs for a group with more than one page, drawn above the page title.
function groupTabsHtml(page) {
  const pages = groupOf(page)?.[1] || [];
  if (pages.length < 2) return '';
  return `<div class="segmented group-tabs" role="tablist">${pages.map(([id, label]) => `<button type="button" role="tab" data-page="${id}" class="${id === page ? 'active' : ''}${guestLocked(id) ? ' shut' : ''}" aria-selected="${id === page}">${label}${id === 'rooms' && game.publicRooms.length ? ` <i class="badge">${game.publicRooms.length}</i>` : ''}</button>`).join('')}</div>`;
}
let homePage = pageFromHash();
let pageEntering = true;
let roomDraft = { code: null, isPublic: false };
let wagerDraft = { size: 1, stake: 50, isPublic: false };
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
const BOARD_PAGES = ['leaderboard', 'play', 'ranked'];
net.on('leaderboard', (message) => { boards = message.boards; if (game.screen === 'home' && BOARD_PAGES.includes(homePage)) renderHome(); });
setInterval(() => { if (game.screen === 'home' && BOARD_PAGES.includes(homePage) && !document.hidden) askBoards(); }, 2000);
const pilotFace = (row) => (row.avatar ? `<img class="avatar" src="${escapeHtml(row.avatar)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer" />` : `<i class="avatar blank">${escapeHtml(row.name.slice(0, 1).toUpperCase())}</i>`);
const boardRank = (id, row) => (id === 'rating' ? rankBadge(rankInfo(row.value), 22) : '');
const boardRow = (id, row) => `<div class="board-row${row.you ? ' you' : ''}"><b class="place">${row.rank}</b>${pilotFace(row)}<span class="who"><strong>${escapeHtml(row.name)}</strong><small>${titleHtml(row.title)} · LV ${row.level}${id === 'rating' ? ` · ${rankInfo(row.value).name}` : ''}</small></span><em>${boardRank(id, row)}${boardValue(id, row)}</em></div>`;

function leaderboardPageHtml() {
  askBoards();
  const board = boards?.[boardTab];
  const tabs = `<div class="segmented board-tabs" role="tablist">${BOARD_ORDER.map((id) => `<button type="button" role="tab" data-board="${id}" class="${id === boardTab ? 'active' : ''}" aria-selected="${id === boardTab}">${boards?.[id]?.label || id}</button>`).join('')}</div>`;
  if (!board) return `<section class="page-wide"><p class="eyebrow">Leaderboard</p><h1 class="page-title">Top <em>guns.</em></h1>${tabs}<div class="panel"><p class="muted">${net.connected ? 'Loading…' : 'Connecting…'}</p></div></section>`;
  const podium = board.top.slice(0, 3);
  const rest = board.top.slice(3);
  const empty = boardTab === 'rating' ? 'Nobody’s ranked yet.' : 'Nobody here yet.';
  const mine = board.you ? `You are <b>#${board.you.rank}</b> of ${board.total.toLocaleString()}` : game.username ? (boardTab === 'rating' ? 'Finish placements to get on the board.' : 'Play a match to get on the board.') : 'Log in to see where you stand.';
  return `<section class="page-wide"><p class="eyebrow">Leaderboard <small>${board.total.toLocaleString()} pilot${board.total === 1 ? '' : 's'}</small></p><h1 class="page-title">Top <em>guns.</em></h1>
    <div class="board-head">${tabs}<p class="board-mine">${mine}</p></div>
    ${board.top.length ? `<div class="podium">${podium.map((row) => `<div class="panel podium-card place-${row.rank}${row.you ? ' you' : ''}"><span class="medal">${row.rank}</span>${pilotFace(row)}<strong>${escapeHtml(row.name)}</strong><small>${titleHtml(row.title)} · LV ${row.level}${boardTab === 'rating' ? ` · ${rankInfo(row.value).name}` : ''}</small><em>${boardRank(boardTab, row)}${boardValue(boardTab, row)}</em></div>`).join('')}</div>
    ${rest.length ? `<div class="panel board-list">${rest.map((row) => boardRow(boardTab, row)).join('')}</div>` : ''}
    ${board.you && board.you.rank > 50 ? `<div class="panel board-list"><div class="board-row you"><b class="place">${board.you.rank}</b><i class="avatar blank">★</i><span class="who"><strong>${escapeHtml(game.username || 'You')}</strong><small>Your position</small></span><em>${boardValue(boardTab, board.you)}</em></div></div>` : ''}` : `<div class="panel"><p class="muted">${empty}</p></div>`}</section>`;
}
// Play page: the top five by skill rating, or by level while nobody is ranked.
function boardTeaserHtml() {
  askBoards();
  const id = boards?.rating?.top.length ? 'rating' : 'level';
  const top = boards?.[id]?.top.slice(0, 5) || [];
  return `<div class="panel board-teaser"><p class="eyebrow">Leaderboard <small>${id === 'rating' ? 'skill rating' : 'level'}</small></p>${top.length ? top.map((row) => boardRow(id, row)).join('') : `<p class="muted">${boards ? 'Nobody here yet.' : 'Loading…'}</p>`}<div class="link-row"><button type="button" class="ghost-button" data-page="leaderboard">Full standings →</button></div></div>`;
}

function rankedCardHtml() {
  const profile = game.profile;
  const info = profile && game.username ? rankInfo(profile.rating, profile.rankedMatches) : null;
  const line = !game.username ? 'Humans only. Needs a Discord login.' : !info ? 'Humans only.'
    : info.placed ? `${info.name} · ${info.rating} SR` : `Placement ${info.placement.played} / ${info.placement.total}`;
  // One rating, four sizes. Each size queues on its own, so you pick the fight you want.
  return `<section class="mode-block ranked-block${game.username ? '' : ' locked'}"${info ? ` style="--rank:${info.color}"` : ''}>
    <header class="block-head"><small>03 // COMPETITIVE</small><b>Ranked</b><span>${line}</span>${info ? `<button type="button" class="rank-link" data-page="ranked" title="The ladder">${rankBadge(info, 34)}</button>` : ''}</header>
    <div class="size-row">${RANKED_SIZES.map(sizeChip('ranked-')).join('')}</div>
  </section>`;
}
// One button per team size, the same shape in ranked and in the unranked queues.
const sizeChip = (prefix) => (id) => `<button type="button" class="size-chip" data-play="${prefix}${id}"><b>${id.toUpperCase()}</b><span>${TEAM_MODES[id].name}</span></button>`;

// ------------------------------------------------------------------ ranked
// The history keeps each ranked match's rating swing, so walking it backwards from the current rating
// rebuilds the whole SR line: the peak, the streak and every result since placements came out of it.
function rankedSeason() {
  const played = (game.profile?.history || []).filter((row) => typeof row.rating === 'number');
  const now = Math.round(game.profile?.rating ?? 1000);
  let sr = now, peak = now;
  const games = played.map((row) => {
    const after = sr;
    sr -= row.rating;
    peak = Math.max(peak, after);
    return { result: row.result, delta: row.rating, mode: row.mode, after };
  });
  const count = (result) => played.filter((row) => row.result === result).length;
  let streak = 0;
  for (const row of played) { if (row.result !== played[0].result) break; streak += 1; }
  return { games, played: played.length, wins: count('win'), losses: count('loss'), draws: count('draw'), peak, streak, last: played[0]?.result || null };
}

function rankedPageHtml() {
  askBoards();
  const profile = game.profile;
  if (!game.username || !profile) {
    return `<section class="page-wide ranked-page">${groupTabsHtml('ranked')}<p class="eyebrow">Competitive</p><h1 class="page-title"><em>Ranked.</em></h1>
      <div class="panel ranked-gate"><p>Ranked is humans only, so it needs a Discord login. Your rating, your peak and every match are kept to your account.</p>${authHtml()}</div></section>`;
  }
  const info = rankInfo(profile.rating, profile.rankedMatches);
  const season = rankedSeason();
  const decided = season.wins + season.losses;
  const winRate = decided ? Math.round((season.wins / decided) * 100) : 0;

  // The ladder, bottom to top, with the tier you are standing in lit up.
  const ladder = [...RANK_TIERS].reverse().map((tier) => {
    const here = info.tier === tier.id;
    const reached = info.placed && info.rating >= tier.min;
    return `<div class="ladder-step${here ? ' here' : ''}${reached ? ' reached' : ''}" style="--rank:${tier.color}">
      ${rankBadge({ placed: true, color: tier.color, division: tier.id === 'apex' ? null : 'I' }, 26)}
      <b>${tier.name}</b><small>${tier.min} SR</small>${here ? '<em>You</em>' : ''}</div>`;
  }).join('');

  // Placements hide the rating until they are done, so the hero shows the count instead of a bar.
  const meter = info.placed
    ? `<div class="sr-meter"><i style="width:${Math.round(info.progress * 100)}%"></i></div>
       <small>${info.next ? `${info.toNext} SR to ${info.next}` : 'Top of the ladder. Hold it.'}</small>`
    : `<div class="sr-meter"><i style="width:${Math.round((info.placement.played / info.placement.total) * 100)}%"></i></div>
       <small>${info.placement.total - info.placement.played} placement match${info.placement.total - info.placement.played === 1 ? '' : 'es'} to go. They move your rating twice as far.</small>`;

  const form = season.games.slice(0, 10).map((game_) => `<i class="pip ${game_.result}" title="${game_.delta > 0 ? '+' : ''}${game_.delta} SR">${game_.result === 'win' ? 'W' : game_.result === 'loss' ? 'L' : 'D'}</i>`).join('')
    || '<span class="muted">No ranked matches yet.</span>';

  const stat = (label, value, tone = '') => `<div class="rank-stat${tone ? ` ${tone}` : ''}"><b>${value}</b><small>${label}</small></div>`;
  const streakLine = season.streak > 1 && season.last ? `${season.streak} ${season.last === 'win' ? 'wins' : season.last === 'loss' ? 'losses' : 'draws'} in a row` : 'No run going';
  const top = boards?.rating?.top?.slice(0, 5) || [];

  return `<section class="page-wide ranked-page" style="--rank:${info.color}">
    ${groupTabsHtml('ranked')}
    <p class="eyebrow">Competitive · ${RANKED_SIZES.length} queues</p>
    <h1 class="page-title"><em>Ranked.</em></h1>
    <div class="ranked-hero">
      <div class="panel rank-now">
        <div class="rank-emblem">${rankBadge(info, 108)}</div>
        <div class="rank-read">
          <p class="eyebrow">${info.placed ? 'Current rank' : 'Placements'}</p>
          <h2>${info.name}</h2>
          <b class="sr">${info.placed ? `${info.rating} SR` : `${info.placement.played} / ${info.placement.total}`}</b>
          ${meter}
        </div>
      </div>
      <div class="panel rank-ladder"><p class="eyebrow">The climb <small>6 tiers · 3 divisions</small></p><div class="ladder">${ladder}</div></div>
    </div>
    <div class="ranked-grid">
      <div class="panel">
        <p class="eyebrow">This season</p>
        <div class="rank-stats">${stat('Played', season.played)}${stat('Won', season.wins, 'good')}${stat('Lost', season.losses, 'bad')}${stat('Win rate', `${winRate}%`)}${stat('Peak', `${season.peak}`)}</div>
        <p class="muted rank-streak">${streakLine}</p>
      </div>
      <div class="panel">
        <p class="eyebrow">Recent form <small>newest first</small></p>
        <div class="form-row">${form}</div>
        <div class="sr-track">${season.games.slice(0, 10).reverse().map((game_) => `<span class="${game_.delta >= 0 ? 'up' : 'down'}">${game_.delta > 0 ? '+' : ''}${game_.delta}</span>`).join('') || ''}</div>
      </div>
      <div class="panel">
        <p class="eyebrow">Top of the ladder</p>
        ${top.length ? top.map((row) => boardRow('rating', row)).join('') : `<p class="muted">${boards ? 'Nobody placed yet.' : 'Loading…'}</p>`}
        <div class="link-row"><button type="button" class="ghost-button" data-page="leaderboard">Full standings →</button></div>
      </div>
    </div>
    <section class="mode-block ranked-block">
      <header class="block-head"><small>QUEUE</small><b>Pick your size</b><span>One rating across all four. Each queues on its own.</span></header>
      <div class="size-row">${RANKED_SIZES.map(sizeChip('ranked-')).join('')}</div>
    </section>
  </section>`;
}

function lockedPageHtml(page) {
  const label = (NAV.flatMap(([, pages]) => pages).find(([id]) => id === page) || [, 'That page'])[1];
  return `<section class="page-wide locked-page">
    <p class="eyebrow">Account needed</p><h1 class="page-title">${escapeHtml(label)} is <em>locked.</em></h1>
    <div class="panel locked-gate">
      <p>Your locker, your coins and your record all hang off an account. Guests get the game itself: jump in, play, come back and sign in when you want to keep anything.</p>
      ${authHtml({ guestOption: false })}
      <div class="link-row"><button type="button" class="ghost-button" data-page="play">Back to play</button></div>
    </div>
  </section>`;
}

// What a developer has pulled, as a panel. Empty when nothing is pulled, so it costs nothing to include.
const MAP_ID_LIST = mapRuleOptions().filter(([id]) => id !== 'vote' && id !== 'random').map(([id]) => id);
const mapTitle = (id) => (mapRuleOptions().find(([value]) => value === id)?.[1] || id).replace(/ \(.*\)$/, '');
export function outagesHtml() {
  const out = game.outages || {};
  const rows = [];
  for (const [id, entry] of Object.entries(out.map || {})) rows.push([mapTitle(id), 'Arena', entry]);
  for (const [id, entry] of Object.entries(out.weapon || {})) rows.push([WEAPONS[id]?.name || id, 'Weapon', entry]);
  if (!rows.length) return '';
  return `<div class="panel outage-panel"><p class="eyebrow">Temporarily disabled <small>${rows.length}</small></p>
    ${rows.map(([name, kind, entry]) => `<div class="outage-row"><b>${escapeHtml(name)}</b><small>${kind}</small><span>${escapeHtml(outageReason(entry))}</span></div>`).join('')}</div>`;
}


// ------------------------------------------------------------------ service (devs only)
// Pull something that is breaking the game, and put it back when it is fixed. Two lists on purpose:
// what is live, and what is out. A thing only moves between them when the server says it has, so what
// is on screen is what everyone else is getting, not what this page hoped would happen.
let serviceReason = '';
let serviceBusy = null;      // `kind:id` waiting on the server, so a double click cannot fire twice
function servicePageHtml() {
  if (!game.profile?.dev) return `<section class="page-wide"><p class="eyebrow">Service</p><h1 class="page-title">Not <em>yours.</em></h1><div class="panel"><p class="muted">This page belongs to the developers.</p></div></section>`;
  const out = game.outages || { map: {}, weapon: {} };
  const pulledMaps = Object.entries(out.map || {});
  const pulledGuns = Object.entries(out.weapon || {});
  const pulled = [...pulledMaps.map(([id, entry]) => ['map', id, mapTitle(id), entry]), ...pulledGuns.map(([id, entry]) => ['weapon', id, WEAPONS[id]?.name || id, entry])];
  const chip = (kind, id, name) => {
    const busy = serviceBusy === `${kind}:${id}`;
    return `<button type="button" class="service-chip${busy ? ' busy' : ''}" data-pull="${kind}:${id}"${busy ? ' disabled' : ''}>${escapeHtml(name)}</button>`;
  };
  const liveMaps = MAP_ID_LIST.filter((id) => !out.map?.[id]);
  const liveGuns = Object.values(WEAPONS).filter((weapon) => !weapon.melee && !out.weapon?.[weapon.id]);
  return `<section class="page-wide service-page">
    <p class="eyebrow">Service · developers</p>
    <h1 class="page-title">Pull <em>something.</em></h1>
    <div class="service-grid">
      <div class="panel service-out">
        <p class="eyebrow">Currently pulled <small>${pulled.length}</small></p>
        ${pulled.length ? pulled.map(([kind, id, name, entry]) => `<div class="service-row">
            <div><b>${escapeHtml(name)}</b><small>${kind === 'map' ? 'Arena' : 'Weapon'} · pulled by ${escapeHtml(entry.by || 'a dev')}</small>
            <span>${escapeHtml(outageReason(entry))}</span></div>
            <button type="button" class="service-back${serviceBusy === `${kind}:${id}` ? ' busy' : ''}" data-restore="${kind}:${id}"${serviceBusy === `${kind}:${id}` ? ' disabled' : ''}>Put it back</button>
          </div>`).join('') : '<p class="muted">Nothing is pulled. The whole game is live.</p>'}
      </div>
      <div class="panel">
        <p class="eyebrow">Pull something out</p>
        <label class="service-why">Why<input id="service-reason" maxlength="140" placeholder="Leave blank for the default" value="${escapeHtml(serviceReason)}" /></label>
        <p class="service-sub">Arenas <small>${liveMaps.length} live</small></p>
        <div class="service-chips">${liveMaps.map((id) => chip('map', id, mapTitle(id))).join('')}</div>
        <p class="service-sub">Weapons <small>${liveGuns.length} live</small></p>
        <div class="service-chips">${liveGuns.map((weapon) => chip('weapon', weapon.id, weapon.short || weapon.name)).join('')}</div>
        <p class="muted service-note">Everyone is told the moment you click, in the lobby and mid round. A pulled gun leaves the hands of anyone holding it and their credits go back.</p>
      </div>
    </div>
  </section>`;
}

function playPageHtml() {
  const modifier = MODIFIERS[game.dailyModifier] || MODIFIERS.headhunter;
  const profile = game.profile;
  const level = profile?.level || 1, base = xpForLevel(level), next = xpForLevel(level + 1);
  const progress = profile ? Math.round(((profile.xp - base) / (next - base)) * 100) : 0;
  const contracts = profile ? profile.contracts.map((c) => `<div class="contract${c.done ? ' done' : ''}"><div><span>${escapeHtml(c.text)}</span><em>+${c.xp} XP</em></div><div class="meter"><i style="width:${Math.round((c.progress / c.n) * 100)}%"></i></div></div>`).join('') : '';
  return `
    <section class="page-main play-modes">
      ${groupTabsHtml('play')}
      <p class="eyebrow">Tactical sniper duels · one life</p>
      <h1 class="page-title">Pick your <em>fight.</em></h1>
      <div class="hero-row">
        <button type="button" class="play-card primary" data-play="casual"><small>01 // CASUAL</small><strong>Quick play</strong><span>Straight into a match. Bots fill empty seats.</span><i class="go">Deploy →</i></button>
        <button type="button" class="play-card royale-card-play" data-play="royale"><small>02 // ISLAND</small><strong>Battle royale</strong><span>${ROYALE.fill} pilots. One island. Last one standing.</span><i class="soon-tag">New</i></button>
      </div>
      <div class="mode-blocks">
        ${rankedCardHtml()}
        <section class="mode-block">
          <header class="block-head"><small>04 // UNRANKED</small><b>Team modes</b><span>Fixed sides, no rating on the line.</span></header>
          <div class="size-row">${TEAM_MODE_IDS.map(sizeChip('')).join('')}</div>
        </section>
      </div>
      <div class="mode-grid">
        <button type="button" class="play-card" data-play="arcade"><small>05 // ARCADE</small><strong>${modifier.name}</strong><span>${modifier.desc}</span></button>
        <div class="play-card split"><small>06 // OFFLINE</small><strong>Bot match</strong><span>3v3. Pick how hard they play.</span><div class="difficulty">${Object.entries(BOT_DIFFICULTY).map(([id, d]) => `<button type="button" data-bots="${id}">${d.name}</button>`).join('')}</div></div>
        <button type="button" class="play-card" data-play="range"><small>07 // TRAINING</small><strong>Practice range</strong><span>${game.tutorialDone ? 'Free gear. Moving targets.' : 'Learn the ropes. Free gear, moving targets.'}</span></button>
      </div>
    </section>
    <section class="panel play-stage">
      <canvas id="operator-preview" width="420" height="640"></canvas>
      <div class="play-stage-info">
        ${game.username ? '' : authHtml()}
        ${profile ? `<div class="level-row"><b class="level">${level}</b><div><strong>${titleHtml(game.look.title)} ${escapeHtml(profile.name)}</strong><div class="meter"><i style="width:${progress}%"></i></div><small>${profile.xp - base} / ${next - base} XP · ${game.username ? rankInfo(profile.rating, profile.rankedMatches).name.toUpperCase() : 'GUEST'}</small></div></div>` : net.connected ? '' : '<p class="muted">Connecting…</p>'}
        <div class="link-row"><button type="button" class="ghost-button" data-page="locker">Locker</button><button type="button" class="ghost-button" data-page="career">Profile →</button></div>
      </div>
    </section>
    <aside class="page-side play-side">
      ${profile ? `<div class="panel"><p class="eyebrow">Today’s contracts <small>reset 00:00 UTC</small></p>${contracts}</div>` : ''}
      ${boardTeaserHtml()}
      <button type="button" class="panel room-teaser" data-page="rooms"><p class="eyebrow">Rooms</p><strong>${game.publicRooms.length ? `${game.publicRooms.length} live room${game.publicRooms.length === 1 ? '' : 's'}` : 'Play with friends'}</strong><span>Private rooms. Your rules.</span></button>
    </aside>`;
}

let armedGear = null;
function operatorPageHtml(level) {
  const nameOfLook = (kind, key) => COSMETICS[kind].find((item) => item.id === game.look[key])?.name || '';
  const group = (label, kind, key) => `<div class="panel look-group"><p class="eyebrow">${label} <small>${escapeHtml(nameOfLook(kind, key))}</small></p><div class="swatches">${swatchRow(kind, key, level)}</div></div>`;
  // Gear: level items unlock with XP, priced ones are bought once with coins (click twice to confirm).
  const owned = game.profile?.owned || [];
  const gear = (label, kind) => `<div class="panel look-group"><p class="eyebrow">${label} <small>${escapeHtml(nameOfLook(kind, kind))}</small></p><div class="gear-options">${COSMETICS[kind].filter((item) => !item.dev).map((item) => {
    const bought = owned.includes(`${kind}:${item.id}`), key = `gear:${kind}:${item.id}`;
    const locked = item.price ? !bought : level < item.level;
    const tag = item.price && !bought ? `${armedGear === key ? 'Confirm ' : ''}${coins(item.price)}` : locked ? `LV ${item.level}` : '';
    const swatch = kind === 'pattern' ? `<i class="pattern-swatch" style="background-color:${game.look.color};${item.id === 'solid' ? '' : `background-image:url(${patternSwatch(item.id)})`}"></i>` : '';
    return `<button type="button" class="gear-option${game.look[kind] === item.id ? ' selected' : ''}${locked ? ' locked' : ''}${armedGear === key ? ' armed' : ''}" data-gear-kind="${kind}" data-gear="${item.id}">${swatch}<span>${item.name}</span>${tag ? `<small>${tag}</small>` : ''}</button>`;
  }).join('')}</div></div>`;
  return `
    <section class="page-main operator-stage">
      <p class="eyebrow">Operator</p>
      <h1 class="page-title">Your <em>silhouette.</em></h1>
      <div class="stage"><canvas id="operator-preview" width="360" height="460"></canvas><div class="stage-tag"><small>${titleHtml(game.look.title)}</small><b>${escapeHtml(game.profile?.name || game.name || 'Unnamed pilot')}</b><span>LEVEL ${level}</span></div></div>
    </section>
    <aside class="page-side">
      ${group('Suit', 'suit', 'color')}${gear('Pattern', 'pattern')}${gear('Headgear', 'headgear')}${gear('Face', 'face')}${gear('Pack', 'pack')}${group('Visor', 'visor', 'accent')}${group('Tracer', 'tracer', 'tracer')}
      ${gear('Title', 'title')}${gear('Gun charm', 'charm')}
    </aside>`;
}

// Wager rooms: everyone stakes the same, the winning side splits the pot.
function wagerPanelHtml() {
  if (!game.username) return '<div class="panel wager-panel"><p class="eyebrow">Wager match</p><p class="muted">Wagers need a Discord login.</p></div>';
  const stake = Math.floor(Number(wagerDraft.stake)) || 0;
  return `<div class="panel wager-panel"><p class="eyebrow">Wager match <small>you have ${coins(game.profile?.coins || 0)}</small></p>
    <div class="segmented">${WAGER.sizes.map((n) => `<button type="button" data-wager-size="${n}" class="${wagerDraft.size === n ? 'active' : ''}">${n}v${n}</button>`).join('')}</div>
    <label class="field">Stake each<input id="wager-stake" type="number" min="${WAGER.minStake}" max="${WAGER.maxStake}" step="1" value="${escapeHtml(wagerDraft.stake)}" /></label>
    <p class="wager-pot">Pot <b>${coins(stake * wagerDraft.size * 2)}</b></p>
    <label class="check"><input type="checkbox" id="wager-public" ${wagerDraft.isPublic ? 'checked' : ''} /> List publicly</label>
    <div class="button-row"><button type="button" id="create-wager">Create wager room</button></div>
    <small class="muted">Winners split the pot. A draw refunds everyone.</small></div>`;
}

function roomsPageHtml() {
  const inviteRoom = new URLSearchParams(location.search).get('room') || '';
  const rooms = game.publicRooms.length ? game.publicRooms.map((room) => `<button type="button" class="room-row" data-join="${escapeHtml(room.name)}"><b>${escapeHtml(room.name)}</b><span>${room.wager ? `${room.wager.size}V${room.wager.size} ${coins(room.wager.stake)}` : room.queue.toUpperCase()}</span><span>${room.players + room.bots}/${room.max}</span><small>${room.phase === 'lobby' ? 'IN LOBBY' : `LIVE ${room.scores.A}–${room.scores.B}`}</small></button>`).join('') : '<p class="muted">No public rooms. Start one.</p>';
  return `
    <section class="page-main">
      ${groupTabsHtml('rooms')}
      <p class="eyebrow">Rooms</p>
      <h1 class="page-title">Your <em>rules.</em></h1>
      <div class="room-make"><div class="panel private"><p class="eyebrow">Private room</p><div class="room-row-input"><input id="room-input" maxlength="24" placeholder="room-code" value="${escapeHtml(roomDraft.code ?? inviteRoom)}" /><button type="button" id="join-room">Create / join <span>↗</span></button></div><label class="check"><input type="checkbox" id="room-public" ${roomDraft.isPublic ? 'checked' : ''} /> List publicly</label>
        <small class="muted">New code, new room. You host.</small></div>
      ${wagerPanelHtml()}</div>
    </section>
    <aside class="page-side"><div class="panel"><p class="eyebrow">Live rooms <small>${game.publicRooms.length}</small></p><div id="room-list">${rooms}</div></div></aside>`;
}

initSocial(() => { if (game.screen === 'home') renderHome(); });

export function renderHome() {
  const level = game.profile?.level || 1;
  // Re-renders happen whenever the profile or look changes; keep whatever the pilot has typed.
  if ($('#room-input')) roomDraft = { code: $('#room-input').value, isPublic: $('#room-public').checked };
  const kept = keepShopInput();
  if ($('#wager-stake')) wagerDraft = { ...wagerDraft, stake: $('#wager-stake').value, isPublic: $('#wager-public').checked };
  const keep = { name: $('#name-input')?.value, username: $('#auth-username')?.value, password: $('#auth-password')?.value, confirm: $('#auth-confirm')?.value, status: $('#auth-status')?.outerHTML, focus: document.activeElement?.id, tab: home.querySelector('.tab.active')?.dataset.tab };
  const feedbackDraft = readFeedbackDraft();
  if (homePage === 'controls') settingsTab = 'binds'; else if (homePage === 'settings' && settingsTab === 'binds') settingsTab = 'aim';
  if (homePage !== 'settings' && homePage !== 'controls') { listening = null; padListening = null; }
  const pageHtml = guestLocked(homePage) ? lockedPageHtml(homePage) : SHOP_PAGES.includes(homePage) ? (homePage === 'locker' && !game.username ? operatorPageHtml(level) : shopPageHtml(homePage, groupTabsHtml(homePage))) : homePage === 'leaderboard' ? leaderboardPageHtml() : homePage === 'ranked' ? rankedPageHtml() : homePage === 'service' ? servicePageHtml() : homePage === 'settings' ? settingsPageHtml() : homePage === 'controls' ? controlsPageHtml() : homePage === 'feedback' ? feedbackPageHtml() : homePage === 'career' ? `<section class="page-wide">${groupTabsHtml('career')}<p class="eyebrow">Career</p><h1 class="page-title">Your <em>record.</em></h1>${game.username ? `<div class="panel account-panel">${accountRowHtml()}</div>` : ''}<div class="career-grid">${careerHtml()}</div></section>` : homePage === 'rooms' ? roomsPageHtml() : playPageHtml();
  const toolPage = TOOL_PAGES.some(([id]) => id === homePage);
  home.innerHTML = `
    <div class="menu-shell">
      <header class="menu-bar">
        <button type="button" class="brand" data-page="play" aria-label="Krosshair: play"><img class="brand-mark" src="brand/krosshair-logo.svg" alt="" width="40" height="40" /><b>Kross<em>hair</em></b></button>
        <nav class="menu-nav" aria-label="Menu">${navFor().map(([label, pages], index) => { const on = pages.some(([id]) => id === homePage); const shut = guestLocked(pages[0][0]); return `<button type="button" data-page="${pages[0][0]}" class="${on ? 'active' : ''}${shut ? ' shut' : ''}" ${on ? 'aria-current="page"' : ''}${shut ? ' title="Needs an account"' : ''}><small>0${index + 1}</small>${label}${label === 'Play' && game.publicRooms.length ? `<i class="badge">${game.publicRooms.length}</i>` : ''}</button>`; }).join('')}</nav>
        <div class="menu-tools">${game.profile?.dev ? `<button type="button" id="online-count" class="online-chip" data-dev-online="1" title="Who is playing"><i class="live-dot"></i>${onlineLabel()}</button>` : `<span id="online-count"><i class="live-dot"></i>${onlineLabel()}</span>`}${socialButtonHtml()}${game.username && game.profile ? `<button type="button" class="coin-chip" data-page="wallet" title="Wallet">${coins(game.profile.coins)}</button><button type="button" class="pilot-chip${groupOf(homePage)?.[0] === 'Profile' ? ' active' : ''}" data-page="career" title="Profile">${game.avatar ? `<img class="avatar" src="${escapeHtml(game.avatar)}" alt="" width="24" height="24" referrerpolicy="no-referrer" />` : ''}<b>${escapeHtml(game.username)}</b></button>` : ''}<button type="button" data-page="settings" class="ghost-button gear-button${toolPage ? ' active' : ''}" ${toolPage ? 'aria-current="page"' : ''} title="Settings" aria-label="Settings">${GEAR_MARK}</button></div>
      </header>
      <main class="menu-page page-${homePage}${pageEntering ? ' entering' : ''}">${pageHtml}</main>
      <footer class="menu-foot"><div class="socials">${socialHtml()}</div><nav aria-label="Help">${TOOL_PAGES.map(([id, label]) => `<button type="button" data-page="${id}" class="${id === homePage ? 'active' : ''}">${label}</button>`).join('')}</nav></footer>
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
  restoreShopInput(kept);
  mountShop();
}

// kind: the COSMETICS list; key: the look field it sets (the same, except colours: suit → color, visor → accent).
function chooseGear(kind, id, key = kind) {
  const item = COSMETICS[kind]?.find((entry) => entry.id === id);
  if (!item || (item.dev && !game.profile?.dev)) return;
  const armKey = `gear:${kind}:${id}`;
  if (item.price && !(game.profile?.owned || []).includes(`${kind}:${id}`)) {
    if (!game.username) { toast('Coins need a Discord login.', 'warn'); play('deny'); return; }
    if ((game.profile?.coins || 0) < item.price) { toast('Not enough coins.', 'warn'); play('deny'); return; }
    if (armedGear !== armKey) { armedGear = armKey; play('ui'); renderHome(); return; }
    armedGear = null;
    net.send({ type: 'shop', action: 'gear', kind, id });
    return;
  }
  if (!item.price && (game.profile?.level || 1) < item.level) { toast(`Unlocks at level ${item.level}.`, 'warn'); play('deny'); return; }
  armedGear = null;
  game.look[key] = id; saveLook(); play('ui'); renderHome();
}
const LOOK_KEY = { suit: 'color', visor: 'accent' };
function refreshCoins() { const chip = $('.coin-chip'); if (chip && game.profile) chip.innerHTML = coins(game.profile.coins); }
initShop({
  rerender: () => renderHome(), onShop: () => game.screen === 'home' && SHOP_PAGES.includes(homePage), goto: (page) => { if (game.screen === 'home') setHomePage(page); }, toast, saveLook, refreshCoins,
  onGearBought: ({ kind, id }) => { game.look[LOOK_KEY[kind] || kind] = id; saveLook(); toast(`${COSMETICS[kind].find((item) => item.id === id).name} unlocked.`, 'good'); if (game.screen === 'home') renderHome(); },
});
home.addEventListener('input', (event) => { if (!SHOP_PAGES.includes(homePage)) return; const redraw = onShopInput(event.target); if (redraw) renderHome(); });

function saveLook() { store('look', game.look); refreshPreviewLook(); net.send({ type: 'look', look: game.look }); bus.emit('look'); uploadPrefs(); }

// The royale is the roughest thing in the build, so nobody walks into it by accident. Asked once a
// session: the in-match note reminds you after that.
let royaleWarned = false;
function play_(payload) {
  unlockAudio();
  if (!net.connected) { toast('Still connecting…', 'warn'); return; }
  if (payload.action === 'royale' && !royaleWarned) {
    showNotice({
      tag: 'Playtest only', tone: 'hot',
      title: 'Battle royale is the roughest mode in the game.',
      body: '<p>This one is barely held together. It is the rawest, buggiest thing we have, and it is only open so people can play it and tell us what falls over.</p><p><b>Expect to get stuck, fall through things and lose matches to bugs.</b> Nothing here counts towards your rating.</p><p>Go in wanting to break it, then report what broke.</p>',
      accept: 'I understand, drop me in', cancel: 'Not now',
      onAccept: () => { royaleWarned = true; play_(payload); },
    });
    return;
  }
  if (isRanked(payload.queue) && !game.username) { toast('Ranked needs a Discord login.', 'warn'); setHomePage('play'); document.querySelector('.discord-button')?.focus(); play('deny'); return; }
  if (game.username) { /* signed in: straight in */ } else if (game.loginRequired && !ACCOUNTS_ENABLED) {
    if (!net.identified) { toast('Log in with Discord to play.', 'warn'); setHomePage('play'); document.querySelector('.discord-button')?.focus(); play('deny'); return; }
  } else if (!ACCOUNTS_ENABLED) {
    const input = $('#name-input');
    if (input) game.name = input.value.trim().slice(0, 16);
    if (game.name.length < 2) { toast('Callsign needs 2+ characters.', 'warn'); setHomePage('play'); $('#name-input')?.focus(); play('deny'); return; }
    tabStore('name', game.name);
    if (!net.identified || game.profile?.name !== game.name) { pendingPlay = payload; play('ready'); net.identify(); return; }
  } else if (!net.identified) { toast('Log in or sign up to play.', 'warn'); setHomePage('play'); $('#auth-username')?.focus(); play('deny'); return; }
  play('ready');
  // The island is a big world to build, so say what is happening instead of looking frozen.
  const where = payload.action === 'royale' ? 'Kestrel Island' : payload.action === 'range' ? 'the practice range' : isRanked(payload.queue) ? `a ranked ${String(payload.queue).replace('ranked-', '').replace('ranked', 'match')}` : TEAM_MODES[payload.queue] ? `a ${payload.queue}` : 'a match';
  showLoading(`Dropping into ${where}`, payload.action === 'royale' ? 'Building the island' : 'Finding a room');
  net.enter(payload);
}

// A plain overlay while a room is found and its map is built. Anything that takes us out of the wait
// clears it, and it never outstays 25 seconds even if a message goes missing.
let loadingTimer = null;
const loadingCard = document.createElement('div');
loadingCard.className = 'loading-card hidden';
loadingCard.innerHTML = '<div><p class="eyebrow" id="loading-sub">Loading</p><h2 id="loading-title">Dropping in</h2><div class="loading-bar"><i></i></div></div>';
document.body.append(loadingCard);
export function showLoading(title, sub = 'Loading') {
  document.querySelector('#loading-title').textContent = title;
  document.querySelector('#loading-sub').textContent = sub;
  loadingCard.classList.remove('hidden');
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(hideLoading, 25000);
}
export function hideLoading() {
  clearTimeout(loadingTimer);
  loadingCard.classList.add('hidden');
}

// ------------------------------------------------------------------ warnings
// One card for anything the pilot has to read before carrying on. It takes the keyboard so Enter or
// Escape answers it, and it hands back whether they went ahead.
const noticeCard = document.createElement('div');
noticeCard.className = 'notice-card hidden';
document.body.append(noticeCard);
let noticeGo = null;
function showNotice({ tag, title, body, accept = 'Got it', cancel = null, tone = '', onAccept = null }) {
  noticeGo = onAccept;
  noticeCard.className = `notice-card${tone ? ` ${tone}` : ''}`;
  noticeCard.innerHTML = `<div class="notice-panel" role="alertdialog" aria-modal="true">
    <p class="eyebrow">${tag}</p><h2>${title}</h2><div class="notice-body">${body}</div>
    <div class="notice-buttons">${cancel ? `<button type="button" class="ghost-button" data-notice="no">${cancel}</button>` : ''}<button type="button" class="notice-go" data-notice="yes">${accept}</button></div>
  </div>`;
  play('ui');
  setTimeout(() => noticeCard.querySelector('.notice-go')?.focus(), 0);
}
function closeNotice(accepted) {
  if (noticeCard.classList.contains('hidden')) return;
  const go = noticeGo;
  noticeGo = null;
  noticeCard.classList.add('hidden');
  noticeCard.innerHTML = '';
  if (accepted && go) go();
}
noticeCard.addEventListener('click', (event) => {
  const button = event.target.closest('[data-notice]');
  if (!button) return;
  play(button.dataset.notice === 'yes' ? 'ready' : 'uiBack');
  closeNotice(button.dataset.notice === 'yes');
});
addEventListener('keydown', (event) => {
  if (noticeCard.classList.contains('hidden')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeNotice(false); }
}, true);

// The whole game is a work in progress, and the first thing a pilot sees should say so.
addEventListener('krosshair:entered', () => showNotice({
  tag: 'Heads up',
  title: 'Krosshair is still in development.',
  body: '<p>This is a live build, not a finished game. Things break, maps change, and your stats can move around while we work.</p><p>If something looks wrong, tell us. Bug reports are the fastest way to get it fixed.</p>',
  accept: 'Understood',
}));

home.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.closest('#feedback-form')) { if (target.dataset.kind) switchFeedbackKind(target.dataset.kind); return; }
  if (onSettingsClick(event)) return;
  if (SHOP_PAGES.includes(homePage) && onShopClick(target)) { renderHome(); return; }
  if (target.id === 'social-button') { toggleSocial(); renderHome(); return; }
  if (target.dataset.gear) { chooseGear(target.dataset.gearKind, target.dataset.gear, target.dataset.lookKey); return; }
  if (target.dataset.wagerSize) { wagerDraft.size = Number(target.dataset.wagerSize); play('ui'); renderHome(); return; }
  if (target.id === 'create-wager') { const stake = Math.floor(Number($('#wager-stake').value)); play_({ action: 'wager', size: wagerDraft.size, stake, isPublic: $('#wager-public').checked }); return; }
  if (target.dataset.board) { boardTab = target.dataset.board; play('ui'); renderHome(); return; }
  // Pull or restore. Nothing changes on screen until the server sends the new list back, so what is
  // shown is always what everyone else is getting.
  if (target.dataset.pull || target.dataset.restore) {
    const on = Boolean(target.dataset.pull);
    const [kind, id] = (target.dataset.pull || target.dataset.restore).split(':');
    serviceReason = document.querySelector('#service-reason')?.value || '';
    serviceBusy = `${kind}:${id}`;
    net.send({ type: 'outage', kind, id, on, reason: on ? serviceReason : '' });
    play(on ? 'deny' : 'ready');
    renderHome();
    return;
  }
  if (target.dataset.kind) {
    if (target.classList.contains('locked')) { toast(target.title, 'warn'); return; }
    game.look[target.dataset.kind] = target.dataset.value;
    saveLook(); play('ui'); renderHome();
  } else if (target.dataset.devOnline) { play('ui'); openOnline(); }
  else if (target.dataset.page) { play('ui'); setHomePage(target.dataset.page); }
  else if (target.dataset.play) play_(target.dataset.play === 'range' ? { action: 'range' } : target.dataset.play === 'royale' ? { action: 'royale' } : { action: 'quick', queue: target.dataset.play });
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
  if (event.target.id === 'name-input') { game.name = event.target.value.trim().slice(0, 16); tabStore('name', game.name); if (game.name.length >= 2 && net.connected) net.identify(); }
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
  card.innerHTML = `<p class="eyebrow">One more thing</p><h2>Join the squad.</h2><p>Teammates, updates and bug reports.</p><div class="button-row"><a class="discord-button" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">${DISCORD_MARK}<span>Join the Discord</span></a><button type="button" class="ghost-button">Not now</button></div>`;
  card.addEventListener('click', (event) => { if (event.target.closest('a, button')) { card.remove(); play('ui'); } });
  document.querySelector('#arena-shell').append(card);
}
bus.on('config', () => { if (game.screen === 'home') renderHome(); });
// The answer landed, so the page stops waiting on it.
bus.on('outage-done', () => { serviceBusy = null; if (game.screen === 'home') renderHome(); });
initPadMenu();
bus.on('signed-in', () => {
  // Set by the Discord callback page on its way back to the menu.
  let viaDiscord = null;
  try { viaDiscord = sessionStorage.getItem('krosshair:discord'); sessionStorage.removeItem('krosshair:discord'); } catch { /* private mode */ }
  if (viaDiscord && game.username) toast(viaDiscord === 'joined' ? `Signed in as ${game.username}. You’re in the Discord too.` : `Signed in as ${game.username}.`, 'good');
  // The server could not add them itself (no bot token, or Discord refused): ask once, one click to the invite.
  if (viaDiscord === 'in' && game.username) showDiscordPrompt();
  // A logged-in tab has no guest progress any more: a new account adopted it, an existing one ignores it.
  if (game.username && (game.token || game.legacyToken)) { game.token = null; game.legacyToken = null; tabStore('guest', null); store('token', null); }
  if (pendingPlay) { const payload = pendingPlay; pendingPlay = null; net.enter(payload); }
  if (authPending === 'signup') { toast(`Welcome, ${game.username}.`, 'good'); game.token = null; store('token', null); }
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
  if (room.royale) { renderRoyaleLobby(room); return; }
  if (lobbyRoom !== room.name) { lobbyRoom = room.name; lobbyLines = []; }
  const draft = $('#lobby-chat-input')?.value || '';
  const chatFocused = document.activeElement?.id === 'lobby-chat-input';
  const mine = room.players.find((p) => p.id === game.id);
  const host = Boolean(mine?.host);
  const custom = room.queue === 'custom';
  const wager = room.wager;
  const seats = wager ? wager.size : 4;
  const slot = (p) => `<div class="lobby-player${p.id === game.id ? ' you' : ''}"><i style="background:${p.color}"></i><div><b>${escapeHtml(p.name)}${p.host ? ' <em>HOST</em>' : ''}</b><small>${p.bot ? `BOT · ${(BOT_DIFFICULTY[p.difficulty]?.name || '').toUpperCase()}${p.botType && BOT_TYPES[p.botType] ? ` · ${BOT_TYPES[p.botType].name.toUpperCase()}` : ''}` : `${titleHtml(p.title)} · LV ${p.level}${isRanked(room.queue) ? ` · ${rankChip(p.rating, p.rankedMatches ?? 0, 14)}` : ''}`}</small></div>${p.bot ? (host ? `<button type="button" class="mini" data-removebot="${p.id}">✕</button>` : '') : `<span class="ready-tag${p.ready ? ' on' : ''}">${p.ready ? 'READY' : 'NOT READY'}</span>`}</div>`;
  const teamColumn = (team, label) => {
    const players = room.players.filter((p) => p.team === team);
    const open = Math.max(0, seats - players.length);
    return `<section class="team-column team-${team}"><h3>${label} <small>${players.length}/${seats}</small></h3>${players.map(slot).join('')}${Array.from({ length: open }, () => '<div class="lobby-player open"><small>OPEN SEAT</small></div>').join('')}
      ${custom ? `<div class="team-actions">${mine?.team !== team && players.length < seats ? `<button type="button" class="mini" data-team="${team}">Join ${label}</button>` : ''}${host && !wager ? `<button type="button" class="mini" data-addbot="${team}">+ Bot</button>` : ''}</div>` : ''}</section>`;
  };
  const rules = room.rules;
  const select = (key, options, value) => `<select data-rule="${key}" ${host ? '' : 'disabled'}>${options.map(([v, label]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const wagerHtml = wager ? `<div class="panel wager-terms"><p class="eyebrow">Wager <small>you have ${coins(game.profile?.coins || 0)}</small></p><div class="wager-line"><div><small>STAKE</small><b>${coins(wager.stake)}</b></div><div><small>POT</small><b>${coins(wager.stake * wager.size * 2)}</b></div><div><small>FORMAT</small><b>${wager.size}v${wager.size}</b></div></div><small class="muted">Stakes are taken when the match starts. Winners split the pot. A draw refunds everyone.</small></div>` : '';
  const rulesHtml = custom ? `${wagerHtml}<div class="panel rules"><p class="eyebrow">Match rules ${host ? '' : '<small>host only</small>'}</p><div class="rule-grid">
      <label>Arena${select('map', mapRuleOptions(), rules.map)}</label>
      <label>Format${select('roundsToWin', [[3, 'Best of 5'], [5, 'Best of 9'], [7, 'Best of 13']], rules.roundsToWin)}</label>
      <label>Round time${select('roundTime', [[60, '60 s'], [100, '100 s'], [140, '140 s']], rules.roundTime)}</label>
      <label>Starting credits${select('startCredits', [[400, '400'], [800, '800'], [2000, '2000'], [9000, '9000 (rich)']], rules.startCredits)}</label>
      <label>Conditions${select('variant', [['auto', 'Rotating'], ...Object.entries(VARIANT_NAMES)], rules.variant)}</label>
      <label>Modifier${select('modifier', Object.entries(MODIFIERS).map(([id, m]) => [id, m.name]), rules.modifier)}</label>
      ${wager ? '' : `<label>Bot skill${select('botDifficulty', Object.entries(BOT_DIFFICULTY).map(([id, d]) => [id, d.name]), rules.botDifficulty)}</label>`}
      <label>Friendly fire${select('friendlyFire', [['false', 'Off'], ['true', 'On']], rules.friendlyFire)}</label>
      <label>Sudden death${select('overtimeOn', [['true', 'On'], ['false', 'Off']], rules.overtime > 0)}</label>
    </div><small class="muted">${mapRuleSummary(rules.map)}<br />${MODIFIERS[rules.modifier].desc}</small></div>` : `<div class="panel rules"><p class="eyebrow">${room.queue.toUpperCase()} queue</p><p class="muted">${isRanked(room.queue) ? 'Starts when a second pilot joins.' : room.queue === 'arcade' ? `<b>${MODIFIERS[rules.modifier].name}.</b> ${MODIFIERS[rules.modifier].desc}` : 'Bots hold empty seats until pilots join.'}</p></div>`;
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.name)}`;
  const humans = room.players.filter((p) => !p.bot).length;
  const canStart = wager ? ['A', 'B'].every((team) => room.players.filter((p) => p.team === team && !p.bot).length === wager.size) && room.players.every((p) => p.bot || p.ready)
    : room.players.some((p) => p.team === 'A') && room.players.some((p) => p.team === 'B');
  if (!custom || (lobbyTab !== 'rules' && lobbyTab !== 'invite')) lobbyTab = 'rules';
  const readyCount = room.players.filter((p) => !p.bot && p.ready).length;
  const inviteHtml = `<div class="panel invite"><p class="eyebrow">Invite link</p><div class="room-row-input"><input readonly value="${escapeHtml(link)}" id="invite-link" /><button type="button" id="copy-invite">Copy</button></div><small class="muted">Room code: <b>${escapeHtml(room.name)}</b></small></div>`;
  lobby.innerHTML = `
    <div class="menu-shell lobby-shell">
      <header class="menu-bar">
        <div class="brand"><img class="brand-mark" src="brand/krosshair-logo.svg" alt="Krosshair" width="40" height="40" /><b>Kross<em>hair</em></b></div>
        <div class="lobby-crumb"><small>${wager ? 'WAGER ROOM' : custom ? 'PRIVATE ROOM' : `${room.queue.toUpperCase()} QUEUE`}</small><b>${escapeHtml(room.name)}</b></div>
        <div class="menu-tools"><span><i class="live-dot"></i>${humans} PILOT${humans === 1 ? '' : 'S'}${custom ? ` · ${readyCount} READY` : ''}</span><button type="button" class="ghost-button" id="leave-lobby">← Leave</button></div>
      </header>
      <main class="menu-page lobby-grid">
        <section class="page-main">
          <p class="eyebrow">${custom ? 'Ready room' : 'Matchmaking'}</p>
          <h1 class="page-title" id="lobby-title">${custom ? 'Ready <em>room.</em>' : 'Finding a <em>match.</em>'}</h1>
          <p id="lobby-status" class="lobby-status"></p>
          ${outagesHtml()}
          <div class="teams">${teamColumn('A', 'Alpha')}<div class="versus"><i></i>VS<i></i></div>${teamColumn('B', 'Bravo')}</div>
          <div class="lobby-actions">${custom ? `<button type="button" id="ready-toggle" class="${mine?.ready ? 'secondary-button' : ''}">${mine?.ready ? 'Unready' : wager ? `Ready · stake ${wager.stake}` : 'Ready up'}</button>${host ? `<button type="button" id="start-match" ${canStart ? '' : 'disabled'}>Start match <span>→</span></button>` : '<span class="muted">Waiting for host…</span>'}` : ''}</div>
        </section>
        <aside class="page-side">
          ${custom ? `<div class="side-tabs"><button type="button" class="tab${lobbyTab === 'rules' ? ' active' : ''}" data-lobby-tab="rules">Match rules</button><button type="button" class="tab${lobbyTab === 'invite' ? ' active' : ''}" data-lobby-tab="invite">Invite</button></div>` : ''}
          ${lobbyTab === 'invite' ? inviteHtml : rulesHtml}
          <div class="panel lobby-chat"><p class="eyebrow">Room comms</p><div id="lobby-chat-log">${lobbyLines.join('') || '<span class="muted">No messages.</span>'}</div><input id="lobby-chat-input" maxlength="140" placeholder="Message…" /></div>
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
      status.textContent = wager ? (humans < wager.size * 2 ? `Waiting for ${wager.size * 2 - humans} more. Needs a full ${wager.size}v${wager.size}.` : `${ready}/${humans} ready`) : !canStart ? 'Each team needs a pilot or a bot.' : `${ready}/${humans} ready`;
      status.classList.toggle('ok', canStart);
    } else if (room.autoStartAt) {
      const seconds = Math.max(0, Math.ceil(room.autoStartAt - net.time()));
      status.textContent = `Deploying in ${seconds}s`;
      status.classList.add('ok');
    } else { status.textContent = isRanked(room.queue) ? 'Searching for an opponent…' : 'Waiting for pilots…'; status.classList.remove('ok'); }
  };
  tick();
  lobbyTimer = setInterval(tick, 250);
}
// Battle royale lobby: one list of pilots, a countdown, bots make up the numbers.
function renderRoyaleLobby(room) {
  const draft = $('#lobby-chat-input')?.value || '';
  const chatFocused = document.activeElement?.id === 'lobby-chat-input';
  const humans = room.players.filter((p) => !p.bot);
  const pilots = humans.map((p) => `<div class="lobby-player${p.id === game.id ? ' you' : ''}"><i style="background:${p.color}"></i><div><b>${escapeHtml(p.name)}</b><small>${titleHtml(p.title)} · LV ${p.level}</small></div></div>`).join('');
  lobby.innerHTML = `
    <div class="menu-shell lobby-shell">
      <header class="menu-bar">
        <div class="brand"><img class="brand-mark" src="brand/krosshair-logo.svg" alt="Krosshair" width="40" height="40" /><b>Kross<em>hair</em></b></div>
        <div class="lobby-crumb"><small>BATTLE ROYALE</small><b>Kestrel Island</b></div>
        <div class="menu-tools"><span><i class="live-dot"></i>${humans.length} / ${ROYALE.max} PILOTS</span><button type="button" class="ghost-button" id="leave-lobby">← Leave</button></div>
      </header>
      <main class="menu-page lobby-grid">
        <section class="page-main">
          <p class="eyebrow">Battle royale</p>
          <h1 class="page-title">Last pilot <em>standing.</em></h1>
          <p id="lobby-status" class="lobby-status ok"></p>
          <div class="royale-steps"><div><b>01</b><strong>Drop</strong><span>Pick a spot. Parachute in.</span></div><div><b>02</b><strong>Loot</strong><span>You land with a blade.</span></div><div><b>03</b><strong>Move</strong><span>The storm closes in.</span></div><div><b>04</b><strong>Win</strong><span>One life. No teams.</span></div></div>
          <div class="panel"><p class="eyebrow">Pilots <small>bots fill up to ${ROYALE.fill}</small></p><div class="royale-pilots">${pilots}</div></div>
        </section>
        <aside class="page-side">
          <div class="panel lobby-chat"><p class="eyebrow">Room comms</p><div id="lobby-chat-log">${lobbyLines.join('') || '<span class="muted">No messages.</span>'}</div><input id="lobby-chat-input" maxlength="140" placeholder="Message…" /></div>
        </aside>
      </main>
    </div>`;
  const chatInput = $('#lobby-chat-input');
  chatInput.value = draft;
  if (chatFocused) chatInput.focus();
  const status = $('#lobby-status');
  const tick = () => { if (!game.room || game.room.phase !== 'lobby') return; status.textContent = room.autoStartAt ? `Dropping in ${Math.max(0, Math.ceil(room.autoStartAt - net.time()))}s` : 'Waiting for pilots…'; };
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
  else if (target.id === 'copy-invite') { navigator.clipboard?.writeText($('#invite-link').value).then(() => toast('Link copied.', 'good'), () => toast('Copy blocked. Select the link and copy it.', 'warn')); }
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
let padListening = null; // the action waiting for a controller button
let padWatch = 0;
const FORMATS = { x2: (v) => Number(v).toFixed(2), x1: (v) => Number(v).toFixed(1), deg: (v) => `${v}°`, pct: (v) => `${Math.round(v * 100)}%`, px: (v) => `${v} px`, int: (v) => String(v) };
const GRAPHICS_KEYS = ['renderScale', 'shadows', 'streetLights', 'viewDistance'];

function settingsBodyHtml(tab) {
  const s = game.settings, g = graphics();
  const slider = (key, label, min, max, step, format, value = s[key], hint = '') => `<label>${label} <output>${FORMATS[format](value)}</output><input type="range" data-setting="${key}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${value}" />${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
  const toggle = (key, label, hint = '', value = s[key]) => `<label class="check"><input type="checkbox" data-setting="${key}" ${value ? 'checked' : ''} /> <span>${label}${hint ? `<small class="hint">${hint}</small>` : ''}</span></label>`;
  const select = (key, label, options, value = s[key], hint = '') => `<label>${label}<select data-setting="${key}">${options.map(([v, text]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select>${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;

  if (tab === 'graphics') {
    const presets = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']];
    return `<div class="settings-cols">
      <div class="panel"><p class="eyebrow">Preset</p><div class="segmented preset-row">${presets.map(([id, label]) => `<button type="button" data-preset="${id}" class="${s.quality === id ? 'active' : ''}" ${id === 'custom' ? 'disabled' : ''}>${label}</button>`).join('')}</div>
        <p class="eyebrow sub">Detail</p>
        ${slider('renderScale', 'Render scale', 0.5, 2, 0.05, 'pct', g.renderScale, 'Biggest effect on frame rate.')}
        ${select('shadows', 'Shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], g.shadows)}
        ${select('viewDistance', 'View distance', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], g.viewDistance, 'Battle royale. Ultra shows the whole island.')}
        ${toggle('streetLights', 'Street and interior lights', '', g.streetLights)}</div>
      <div class="panel"><p class="eyebrow">View</p>
        ${slider('fov', 'Field of view', 60, 105, 1, 'deg')}
        ${slider('brightness', 'Brightness', 0.6, 1.6, 0.05, 'pct', s.brightness, 'Helps on night maps.')}
        <p class="eyebrow sub">Performance</p>
        ${select('fpsCap', 'Frame rate cap', [[0, 'Unlimited'], [30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS'], [144, '144 FPS'], [240, '240 FPS']], s.fpsCap, 'Saves battery.')}
        ${toggle('aimBlur', 'Blur the gun when aiming', 'Your eye focuses on the target, not the sight.')}
        ${toggle('showFps', 'Show FPS counter')}
        ${toggle('autoQuality', 'Lower graphics automatically', 'Drops the preset if FPS stays under 38.')}</div></div>`;
  }
  if (tab === 'audio') {
    return `<div class="settings-cols"><div class="panel"><p class="eyebrow">Audio</p>${slider('volume', 'Master volume', 0, 1, 0.05, 'pct')}${slider('ambience', 'Weather volume', 0, 1, 0.05, 'pct', s.ambience, 'Rain and wind.')}${slider('music', 'Music volume', 0, 1, 0.05, 'pct', s.music)}${toggle('musicInMatch', 'Music during rounds')}${toggle('announcer', 'Announcer voice', 'Uses your browser’s voice.')}</div>
      <div class="panel"><p class="eyebrow">HUD</p>${toggle('visualizeSound', 'Show sounds on screen', 'Footsteps and gunfire.')}${toggle('showFps', 'Show FPS counter')}</div></div>`;
  }
  if (tab === 'crosshair') {
    const c = currentCrosshair();
    const xh = (path, label, min, max, step, format) => { const [group, field] = path.split('.'); return `<label>${label} <output>${FORMATS[format](c[group][field])}</output><input type="range" data-xh="${path}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${c[group][field]}" /></label>`; };
    const xhToggle = (path, label) => { const [group, field] = path.split('.'); const value = field ? c[group][field] : c[group]; return `<label class="check"><input type="checkbox" data-xh="${path}" ${value ? 'checked' : ''} /> <span>${label}</span></label>`; };
    const lines = (group, title) => `<div class="panel"><p class="eyebrow">${title}</p>${xhToggle(`${group}.on`, 'Show')}${xh(`${group}.opacity`, 'Opacity', 0, 1, 0.05, 'pct')}${xh(`${group}.length`, 'Length', 0, 30, 1, 'px')}${xh(`${group}.thickness`, 'Thickness', 1, 10, 1, 'px')}${xh(`${group}.offset`, 'Offset', 0, 40, 1, 'px')}</div>`;
    return `<div class="xh-editor">
      <div class="xh-side"><div class="xh-preview" id="xh-preview">${['sky', 'wall', 'dark'].map((bg) => `<div class="xh-bg xh-${bg}"><div class="crosshair">${crosshairHtml(c)}</div></div>`).join('')}</div>
        <div class="panel"><p class="eyebrow">Presets</p><div class="xh-presets">${CROSSHAIR_PRESETS.map(([name, preset], index) => `<button type="button" data-xh-preset="${index}" title="${name}"><span class="crosshair">${crosshairHtml(preset)}</span><small>${name}</small></button>`).join('')}</div></div>
        <div class="panel"><p class="eyebrow">Share code</p><div class="room-row-input"><input id="xh-code" value="${escapeHtml(crosshairCode(c))}" spellcheck="false" autocomplete="off" /><button type="button" id="xh-copy">Copy</button><button type="button" id="xh-import" class="secondary-button">Import</button></div><small class="hint">Paste a code, then Import.</small></div></div>
      <div class="xh-controls">
        <div class="panel"><p class="eyebrow">Colour</p><div class="swatches xh-colors">${CROSSHAIR_COLORS.map((color) => `<button type="button" class="swatch${c.color === color ? ' selected' : ''}" data-xh-color="${color}" style="--swatch:${color}" aria-label="${color}"></button>`).join('')}<input type="color" data-xh="color" value="${c.color}" aria-label="Custom colour" /></div>
          ${xhToggle('outline.on', 'Outline')}${xh('outline.opacity', 'Outline opacity', 0, 1, 0.05, 'pct')}${xh('outline.thickness', 'Outline thickness', 1, 6, 1, 'px')}</div>
        <div class="panel"><p class="eyebrow">Centre dot</p>${xhToggle('dot.on', 'Show')}${xh('dot.size', 'Size', 1, 12, 1, 'px')}${xh('dot.opacity', 'Opacity', 0, 1, 0.05, 'pct')}
          <p class="eyebrow sub">Behaviour</p>${xhToggle('dynamic', 'Spread with movement and recoil')}${xhToggle('tee', 'T-shape (no top line)')}</div>
        ${lines('inner', 'Inner lines')}${lines('outer', 'Outer lines')}
      </div></div>`;
  }
  if (tab === 'binds') {
    const groups = [...new Set(ACTIONS.map((action) => action.group))];
    const slot = (action, index) => { const waiting = listening?.action === action.id && listening.slot === index; return `<button type="button" class="bind${waiting ? ' waiting' : ''}" data-bind="${action.id}" data-slot="${index}">${waiting ? 'PRESS ANYTHING…' : codeLabel(bindsFor(action.id)[index])}</button>`; };
    return `<div class="bind-cols">${groups.map((group) => `<div class="panel"><p class="eyebrow">${group}</p>${ACTIONS.filter((action) => action.group === group).map((action) => `<div class="bind-row"><span>${action.label}</span>${slot(action, 0)}${slot(action, 1)}</div>`).join('')}</div>`).join('')}</div>
      <p class="hint bind-help">Click a slot, press a key. <b>Esc</b> cancels, <b>Backspace</b> clears. The mouse wheel always zooms and switches weapons.</p>
      <div class="panel pad-panel"><p class="eyebrow">Controller <small>${input.padName ? escapeHtml(input.padName.slice(0, 40)) : 'none connected'}</small></p>
        <p class="hint">Sticks move and aim. Click a button, then press it on the pad.</p>
        ${select('padLayout', 'Button names', [['', `Match the pad (${PAD_LAYOUTS[input.layout].name})`], ...PAD_LAYOUT_IDS.map((id) => [id, PAD_LAYOUTS[id].name])], game.settings.padLayout || '')}
        <div class="bind-grid">${PAD_ACTIONS.map((action) => { const waiting = padListening === action.id; return `<div class="bind-row"><span>${action.label}</span><button type="button" class="bind${waiting ? ' waiting' : ''}" data-pad-bind="${action.id}">${waiting ? 'PRESS A BUTTON…' : (padBindFor(action.id) ? padName(padBindFor(action.id)) : '-')}</button></div>`; }).join('')}</div>
        ${toggle('aimAssist', 'Aim assist', 'Controller only. Slows your aim near a pilot and helps it along a little.')}
        <div class="button-row"><button type="button" id="reset-pad-binds" class="ghost-button">Reset controller</button></div></div>`;
  }
  return `<div class="settings-cols"><div class="panel"><p class="eyebrow">Sensitivity</p>${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, 'x2')}${slider('scopeSensitivity', 'Scoped sensitivity', 0.2, 1.5, 0.05, 'x2', s.scopeSensitivity, 'While aiming.')}${slider('padSensitivity', 'Controller sensitivity', 0.4, 2.5, 0.1, 'x1')}</div>
    <div class="panel"><p class="eyebrow">Behaviour</p>${toggle('invertY', 'Invert Y axis')}${toggle('toggleScope', 'Toggle scope', 'Press to aim, press again to lower.')}${toggle('toggleCrouch', 'Toggle crouch')}${toggle('speedFov', 'Speed field of view', 'The view opens a little as you get quicker.')}${toggle('moveDebug', 'Movement readout', 'Speed, state and velocity while you play. F3 also toggles it.')}</div></div>`;
}
// The same rail sits on Settings, Controls and Feedback. In a match (the overlay) Feedback is left out.
function settingsNavButtons(tab) {
  const overlay = settingsOverlayOpen() || game.screen !== 'home';
  return `${SETTINGS_TABS.map(([id, label]) => `<button type="button" data-settings-tab="${id}" class="${id === tab ? 'active' : ''}">${label}</button>`).join('')}${overlay ? '' : `<button type="button" data-page="feedback" class="${tab === 'feedback' ? 'active' : ''}">Feedback</button>`}`;
}
function settingsShellHtml(tab) {
  const resets = { binds: ['reset-binds', 'Reset key binds'], crosshair: ['reset-crosshair', 'Reset crosshair'] }[tab] || ['reset-settings', 'Reset settings'];
  return `<div class="settings-shell"><nav class="settings-tabs" aria-label="Settings sections">${settingsNavButtons(tab)}</nav>
    <div class="settings-body">${settingsBodyHtml(tab)}</div>
    <div class="button-row"><button type="button" id="${resets[0]}" class="ghost-button">${resets[1]}</button><span class="muted">Saves automatically.</span></div></div>`;
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
  else if (target.dataset.bind) { listening = { action: target.dataset.bind, slot: Number(target.dataset.slot) }; padListening = null; play('ui'); refreshSettings(); }
  else if (target.dataset.padBind) { padListening = target.dataset.padBind; listening = null; play('ui'); watchPad(); refreshSettings(); }
  else if (target.id === 'reset-pad-binds') { resetPadBinds(); play('uiBack'); refreshSettings(); }
  else if (target.dataset.xhPreset) { game.settings.crosshair = cleanCrosshair(CROSSHAIR_PRESETS[Number(target.dataset.xhPreset)][1]); saveSettings(); play('ui'); refreshSettings(); }
  else if (target.dataset.xhColor) { game.settings.crosshair = { ...currentCrosshair(), color: target.dataset.xhColor }; saveSettings(); play('ui'); refreshSettings(); }
  else if (target.id === 'xh-copy') navigator.clipboard?.writeText($('#xh-code').value).then(() => toast('Copied.', 'good'), () => toast('Copy blocked. Select the code and copy it.', 'warn'));
  else if (target.id === 'xh-import') {
    const parsed = crosshairFromCode($('#xh-code').value);
    if (!parsed) { toast('Invalid code. Codes start with K1;', 'warn'); play('deny'); return true; }
    game.settings.crosshair = parsed; saveSettings(); play('buy'); toast('Crosshair imported.', 'good'); refreshSettings();
  } else if (target.id === 'reset-settings') { const keep = { binds: game.settings.binds, crosshair: game.settings.crosshair }; Object.assign(game.settings, DEFAULT_SETTINGS, keep); saveSettings(); setVolume(game.settings.volume); play('uiBack'); refreshSettings(); }
  else if (target.id === 'reset-binds') { resetBinds(); play('uiBack'); refreshSettings(); }
  else if (target.id === 'reset-crosshair') { game.settings.crosshair = null; saveSettings(); play('uiBack'); refreshSettings(); }
  else return false;
  return true;
}
// A controller bind waits for the next button on the pad itself.
function watchPad() {
  cancelAnimationFrame(padWatch);
  const was = new Set();
  const tick = () => {
    if (!padListening) return;
    const pad = [...(navigator.getGamepads?.() || [])].find((entry) => entry && entry.connected);
    if (pad) {
      pad.buttons.forEach((button, index) => {
        const code = `Pad${index}`;
        const down = button.pressed || button.value > 0.4;
        if (down && !was.has(code) && padListening) {
          const action = padListening;
          padListening = null;
          const displaced = setPadBind(action, code);
          if (displaced) toast(`${padName(code)} removed from ${displaced}.`, 'info');
          play('ready');
          refreshSettings();
        }
        if (down) was.add(code); else was.delete(code);
      });
    }
    padWatch = requestAnimationFrame(tick);
  };
  padWatch = requestAnimationFrame(tick);
}

// While a bind slot is waiting, the next key, mouse button or wheel notch goes to it and nowhere else.
function captureBind(event) {
  if (!listening) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  const code = event.type === 'keydown' ? event.code : event.type === 'wheel' ? (event.deltaY < 0 ? 'WheelUp' : 'WheelDown') : `Mouse${event.button}`;
  const { action, slot } = listening;
  if (code === 'Escape') { listening = null; padListening = null; play('uiBack'); return refreshSettings(); }
  if (RESERVED.includes(code)) { toast(`${codeLabel(code)} is reserved.`, 'warn'); play('deny'); return; }
  listening = null;
  const displaced = setBind(action, slot, code === 'Backspace' || code === 'Delete' ? null : code);
  if (displaced) toast(`${codeLabel(code)} removed from ${displaced}.`, 'info');
  play('ready');
  // The click that follows this mouse press must not land on whatever is under the cursor.
  if (event.type === 'mousedown') addEventListener('click', (click) => { click.preventDefault(); click.stopPropagation(); }, { capture: true, once: true });
  refreshSettings();
}
addEventListener('keydown', captureBind, true);
addEventListener('mousedown', captureBind, true);
// Not passive: a wheel offered to a waiting bind slot must not also scroll the settings page.
addEventListener('wheel', captureBind, { capture: true, passive: false });
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
  bug: { title: 'Scope stays zoomed in after I die', details: 'What happened? What did you expect? How do we make it happen again?', send: 'Send bug report' },
  suggestion: { title: 'Add a burst-fire rifle', details: 'What would you change?', send: 'Send suggestion' },
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
        <label class="check"><input type="checkbox" name="device" checked /> Include device info</label>
        <div class="feedback-actions"><button type="submit" id="feedback-send">${copy.send}</button><p id="feedback-status" class="feedback-status" role="status"></p></div>
      </form>`;
}
function feedbackSentHtml() {
  const sent = sentReports();
  return sent.length ? `<section class="feedback-sent"><h3>Sent from this browser</h3>${sent.slice(0, 5).map((r) => `<div><span class="kind ${r.kind}">${r.kind === 'bug' ? 'Bug' : 'Idea'}</span><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.ref)} · ${new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>`).join('')}</section>` : '';
}
function feedbackPageHtml() {
  return `<section class="page-wide settings-page"><p class="eyebrow">Feedback</p><h1 class="page-title">Tell us what <em>broke.</em></h1>
    <nav class="settings-tabs" aria-label="Settings sections">${settingsNavButtons('feedback')}</nav>
    <div class="feedback-grid"><div class="panel feedback-page">${feedbackFormHtml()}</div>
      <aside class="page-side"><div class="panel"><p class="eyebrow">Tips</p><ul class="feature-list plain"><li>One report per problem.</li><li>Name the arena, mode and weapon.</li></ul></div>${feedbackSentHtml() ? `<div class="panel">${feedbackSentHtml()}</div>` : ''}</aside></div></section>`;
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
        <div><p class="eyebrow">Feedback</p><h2 id="feedback-title">Bug or idea?</h2></div>
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
  if (title.length < 4) { setFeedbackStatus('Title needs 4+ characters.', 'warn'); return form.title.focus(); }
  if (details.length < 10) { setFeedbackStatus('Add a bit more detail.', 'warn'); return form.details.focus(); }
  if (!net.connected) return setFeedbackStatus('Offline. Send it once you reconnect.', 'warn');
  const device = form.device.checked ? {
    browser: navigator.userAgent, screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`, quality: game.settings.quality, fov: game.settings.fov,
    screenName: game.screen, room: game.room?.name || '', mode: game.room?.mode || '', phase: game.room?.phase || '',
  } : null;
  feedbackPending = { kind: feedbackKind, title };
  $('#feedback-send').disabled = true;
  setFeedbackStatus('Sending…');
  net.send({ type: 'feedback', kind: feedbackKind, title, details, device });
  setTimeout(() => { if (feedbackPending && feedbackPending.title === title) { feedbackPending = false; const send = $('#feedback-send'); if (send) send.disabled = false; setFeedbackStatus('No response. Try again.', 'warn'); } }, 8000);
}
feedbackCard.addEventListener('submit', submitFeedback);
home.addEventListener('submit', submitFeedback);
net.on('feedback-result', (message) => {
  const pending = feedbackPending;
  feedbackPending = false;
  const send = $('#feedback-send');
  if (send) send.disabled = false;
  if (!message.ok || !pending) return setFeedbackStatus(message.message || 'Didn’t send. Try again.', 'warn');
  const sent = [{ ...pending, ref: message.ref, at: Date.now() }, ...sentReports()].slice(0, 20);
  try { localStorage.setItem('krosshair:feedback', JSON.stringify(sent)); } catch { /* private mode */ }
  play('buy');
  if (feedbackOnPage()) { home.querySelector('#feedback-form').reset(); renderHome(); } else openFeedback(feedbackKind);
  setFeedbackStatus(`Sent. Thanks. Ref ${message.ref}.`, 'good');
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

// What a ranked match did to the pilot's rank.
function rankReportHtml(rank) {
  if (!rank) return '';
  const before = rankInfo(rank.before, rank.matchesBefore), after = rankInfo(rank.after, rank.matchesAfter);
  const [label, tone] = !after.placed ? [`PLACEMENT ${after.placement.played} / ${after.placement.total}`, '']
    : !before.placed ? [`PLACED · ${after.name.toUpperCase()}`, 'good']
    : after.step > before.step ? [`PROMOTED · ${after.name.toUpperCase()}`, 'good']
    : after.step < before.step ? [`DEMOTED · ${after.name.toUpperCase()}`, 'bad'] : [after.name.toUpperCase(), ''];
  const detail = !after.placed ? `${after.placement.total - after.placement.played} to go` : after.next ? `${after.rating} SR · ${after.toNext} to ${after.next}` : `${after.rating} SR`;
  const bar = after.placed ? after.progress : after.placement.played / after.placement.total;
  return `<div class="rank-report ${tone}" style="--rank:${after.color}">${rankBadge(after, 44)}<div><b>${label}</b><div class="meter rank-meter"><i style="width:${Math.round(bar * 100)}%"></i></div><small>${detail}</small></div></div>`;
}

function renderEnd() {
  const { message, report } = endState;
  if (message.royale) return renderRoyaleEnd(message, report);
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
    progress = `<div class="panel xp"><div class="xp-head"><b>+${report.xp} XP</b>${report.ratingDelta ? `<b class="${report.ratingDelta > 0 ? 'good' : 'bad'}">${report.ratingDelta > 0 ? '+' : ''}${report.ratingDelta} SR</b>` : ''}${report.coins?.total ? `<b class="coin-gain">+${report.coins.total} ${COIN}</b>` : ''}<span>LEVEL ${level}${report.levelAfter > report.levelBefore ? ' · LEVEL UP' : ''}</span></div><div class="meter"><i style="width:${percent}%"></i></div>
      ${report.coins?.lines?.length ? `<p class="coin-lines">${report.coins.lines.map((line) => `${line.label} +${line.amount}`).join(' · ')}</p>` : ''}
      ${report.wager ? `<p class="unlock ${report.wager.payout > report.wager.stake ? '' : 'bad'}">WAGER · ${report.wager.payout > report.wager.stake ? `WON THE POT +${report.wager.payout}` : report.wager.payout === report.wager.stake ? 'STAKE REFUNDED' : `LOST THE STAKE -${report.wager.stake}`}</p>` : ''}
      ${rankReportHtml(report.rank)}
      ${report.completed.map((c) => `<p class="unlock">CONTRACT COMPLETE · ${escapeHtml(c.text)} <em>+${c.xp} XP</em></p>`).join('')}${report.unlocks.map((u) => `<p class="unlock">UNLOCKED · ${escapeHtml(u.name)} ${u.kind}</p>`).join('')}</div>`;
  }
  endCard.innerHTML = `<div class="end-inner result-${result}">
      <p class="eyebrow">Match report // ${(VARIANT_NAMES[message.variant] || '').toUpperCase()} // ${(MODIFIERS[message.modifier]?.name || '').toUpperCase()}</p>
      <div class="end-head"><h2>${title}</h2><div class="end-score"><b>${mine}</b><span>–</span><b>${theirs}</b></div></div>
      ${progress}
      <div class="end-tables"><section class="friendly"><h3>YOUR TEAM</h3>${head}${rows(team)}</section><section class="rival"><h3>ENEMY TEAM</h3>${head}${rows(team === 'A' ? 'B' : 'A')}</section></div>
      <div class="button-row"><button type="button" id="rematch-button" ${voted ? 'disabled' : ''}>${voted ? `Waiting… ${votes}/${humans}` : `Rematch <span>${votes}/${humans}</span>`}</button><button type="button" id="share-button" class="secondary-button">Share card</button><button type="button" id="end-leave" class="ghost-button">Leave</button><span class="muted" id="end-timer"></span></div>
      <div id="share-wrap" class="share-wrap hidden"></div>
    </div>`;
}
// Battle royale: one table, in finishing order.
function renderRoyaleEnd(message, report) {
  const mine = message.table.find((row) => row.id === game.id);
  const place = mine?.placement || message.table.length, won = place === 1;
  const winner = message.table[0];
  const rows = message.table.slice(0, 12).map((row) => `<div class="score-row royale-row${row.id === game.id ? ' you' : ''}"><span>#${row.placement}</span><span class="pilot"><i style="background:${row.color}"></i>${escapeHtml(row.name)}${row.bot ? ' <em>BOT</em>' : ''}</span><span>${row.kills}</span><span>${row.damage}</span><span>${row.headshots}</span><span>${row.accuracy}%</span></div>`).join('');
  const myRow = mine && place > 12 ? `<div class="score-row royale-row you"><span>#${place}</span><span class="pilot"><i style="background:${mine.color}"></i>${escapeHtml(mine.name)}</span><span>${mine.kills}</span><span>${mine.damage}</span><span>${mine.headshots}</span><span>${mine.accuracy}%</span></div>` : '';
  const votes = game.room?.rematch?.length || 0;
  const humans = game.room?.players.filter((p) => !p.bot && p.connected).length || 1;
  const voted = game.room?.rematch?.includes(game.id);
  let progress = '';
  if (report) {
    const level = report.levelAfter, profile = game.profile, base = xpForLevel(level), next = xpForLevel(level + 1);
    const percent = profile ? Math.round(((profile.xp - base) / (next - base)) * 100) : 0;
    progress = `<div class="panel xp"><div class="xp-head"><b>+${report.xp || 0} XP</b>${report.coins?.total ? `<b class="coin-gain">+${report.coins.total} ${COIN}</b>` : ''}<span>LEVEL ${level}${report.levelAfter > report.levelBefore ? ' · LEVEL UP' : ''}</span></div><div class="meter"><i style="width:${percent}%"></i></div>
      ${report.coins?.lines?.length ? `<p class="coin-lines">${report.coins.lines.map((line) => `${line.label} +${line.amount}`).join(' · ')}</p>` : ''}
      ${(report.completed || []).map((c) => `<p class="unlock">CONTRACT COMPLETE · ${escapeHtml(c.text)} <em>+${c.xp} XP</em></p>`).join('')}${(report.unlocks || []).map((u) => `<p class="unlock">UNLOCKED · ${escapeHtml(u.name)} ${u.kind}</p>`).join('')}</div>`;
  }
  endCard.innerHTML = `<div class="end-inner result-${won ? 'win' : 'loss'}">
      <p class="eyebrow">Battle royale // Kestrel Island // ${(VARIANT_NAMES[message.variant] || '').toUpperCase()}</p>
      <div class="end-head"><h2>${won ? 'Victory.' : `#${place}`}</h2><div class="end-score"><span>${won ? 'Last pilot standing' : `of ${message.table.length} · ${winner ? `${escapeHtml(winner.name)} won` : 'no winner'}`}</span></div></div>
      ${progress}
      <div class="end-tables royale-table"><section><div class="score-row royale-row head"><span>#</span><span>PILOT</span><span>K</span><span>DMG</span><span>HS</span><span>ACC</span></div>${rows}${myRow}</section></div>
      <div class="button-row"><button type="button" id="rematch-button" ${voted ? 'disabled' : ''}>${voted ? `Waiting… ${votes}/${humans}` : `Drop again <span>${votes}/${humans}</span>`}</button><button type="button" id="end-leave" class="ghost-button">Leave</button><span class="muted" id="end-timer"></span></div>
    </div>`;
}
endCard.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'rematch-button') { net.send({ type: 'rematch' }); play('ready'); }
  if (target.id === 'end-leave') { play('uiBack'); net.leaveRoom(); }
  if (target.id === 'share-button') { play('ui'); buildShareCard(); }
  if (target.id === 'share-download') { const link = document.createElement('a'); link.download = 'krosshair-match.png'; link.href = $('#share-canvas').toDataURL('image/png'); link.click(); }
  if (target.id === 'share-copy') $('#share-canvas').toBlob((blob) => { navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).then(() => toast('Copied.', 'good'), () => toast('Copy blocked. Download it instead.', 'warn')); });
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
const drills = () => [['move', `Move with ${['forward', 'left', 'back', 'right'].map((id) => codeLabel(bindsFor(id)[0])).join(' ')}`], ['crouch', `Crouch with ${bindLabel('crouch')} (silent)`], ['scope', `${game.settings.toggleScope ? 'Press' : 'Hold'} ${bindLabel('scope')} to scope in`], ['fire', `Fire with ${bindLabel('fire')}`], ['hit', 'Hit a target'], ['headshot', 'Land a headshot'], ['reload', `Reload with ${bindLabel('reload')}`], ['wallbang', 'Shoot a target through wood'], ['buy', `Open the armoury with ${bindLabel('armoury')}`], ['gadget', `Use a gadget with ${codeLabel(bindsFor('gadget1')[0])} or ${codeLabel(bindsFor('gadget2')[0])}`]];
const drillsDone = new Set();
export function renderTutorial(show) {
  const panel = $('#tutorial');
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  panel.innerHTML = `<p class="eyebrow">Range drills <small>${drillsDone.size}/${drills().length}</small></p>${drills().map(([id, text]) => `<div class="drill${drillsDone.has(id) ? ' done' : ''}"><i></i>${text}</div>`).join('')}<small class="muted">Scoped: ${bindLabel('walk')} holds breath, scroll zooms. Esc to leave.</small>`;
}
bus.on('tutorial', (id) => {
  if (game.room?.mode !== 'range' || drillsDone.has(id)) return;
  drillsDone.add(id);
  play('ready');
  renderTutorial(true);
  if (drillsDone.size === drills().length && !game.tutorialDone) { game.tutorialDone = true; store('tutorialDone', true); uploadPrefs(0); toast('Drills done. You’re cleared.', 'good'); }
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
  if (state === 'updating') { toast('Updating…', 'good'); return; }
  const label = $('#online-count');
  if (label) label.innerHTML = `<i class="live-dot"></i>${onlineLabel(state)}`;
  if (state === 'open' && game.screen === 'home' && !game.profile) renderHome();
  netBanner.classList.toggle('hidden', state === 'open' || game.screen === 'home');
  netBanner.textContent = rejoining ? 'Connection lost. Rejoining…' : 'Connection lost. Reconnecting…';
});
