// The Shop page: gun skins, crates, the minigames and the wallet (history and sending coins).
// The menu redraws often, so every animation runs off a start time: a redraw mid-spin picks up where
// it was instead of starting again. Results arrive with the new balance, which is held back until the
// animation lands so the coin counter never gives the answer away.
import { WEAPONS, WEAPON_CLASSES, weaponClass } from '../shared/constants.js';
import * as THREE from 'three';
import { COINFLIP, CRATES, DICE, DUPLICATE_REFUND, FINISHES, RARITY, SLOTS, STAKE, diceMultiplier, finishInfo, finishPrice } from '../shared/economy.js';
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';
import { animatedFinish, finishSwatch } from './skins.js';
import { buildWeapon } from './viewmodel.js';
import { skinArt } from './weaponart.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const COIN = '<svg class="coin-icon" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><polygon points="10,1 18,5.5 18,14.5 10,19 2,14.5 2,5.5" fill="#ffb547"/><polygon points="10,4 15.4,7 15.4,13 10,16 4.6,13 4.6,7" fill="none" stroke="#7a4a00" stroke-width="1.2"/><path d="M8.3 6.8v6.4M8.3 10l3.6-3.2M9.6 9l2.5 4.2" stroke="#7a4a00" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>';
export const coins = (n) => `<span class="coins">${COIN}${Number(n).toLocaleString('en')}</span>`;
const TABS = [['skins', 'Skins'], ['crates', 'Crates'], ['games', 'Games'], ['wallet', 'Wallet']];
const REEL_ITEM = 128, REEL_LENGTH = 34, REEL_WIN = 29, CRATE_SPIN = 4.6;
const SLOT_ROW = 64, SLOT_TIMES = [1.1, 1.5, 1.9];
const now = () => performance.now() / 1000;
const skinnable = Object.values(WEAPONS);

let ctx = null;
let tab = 'skins';
let weaponId = 'm44';
let preview = null;          // finish being looked at (null = what is equipped)
let armed = null;            // a buy or send waiting for its confirm click
let busy = false;
let held = null;             // profile held back until an animation lands
let crate = null;            // { strip, result, at }
let flip = null, dice = null, slots = null; // { ..., at, result }
let stake = 10, target = 50, pick = 'heads';
let crateId = 'field';
let rarityFilter = 'all';
let wallet = { to: '', amount: '', pilot: null, looking: false };

export function initShop(context) { ctx = context; }
const loggedIn = () => Boolean(game.username && game.profile);
function redraw() { if (ctx?.onShop()) ctx.rerender(); }
function release(after) {
  setTimeout(() => { if (held) { game.profile = held; held = null; } ctx.refreshCoins(); redraw(); }, after * 1000);
}
function request(message) { if (busy) return; busy = true; net.send(message); }

net.on('coins-result', (message) => {
  busy = false;
  armed = null;
  if (message.crate) {
    const strip = Array.from({ length: REEL_LENGTH }, (_, i) => (i === REEL_WIN ? message.crate : { weapon: skinnable[Math.floor(Math.random() * skinnable.length)].id, finish: FINISHES[Math.floor(Math.random() * FINISHES.length)].id }));
    crate = { strip, result: message.crate, at: now(), offset: Math.random() * 80 - 40 };
    held = message.profile; release(CRATE_SPIN + 0.2);
    setTimeout(() => play(message.crate.rarity === 'legendary' || message.crate.rarity === 'epic' ? 'xp' : 'buy'), CRATE_SPIN * 1000);
    redraw();
  } else if (message.game) {
    const result = message.game;
    const state = { result, at: now() };
    const duration = result.game === 'slots' ? SLOT_TIMES[2] : result.game === 'coinflip' ? 1.6 : 1.3;
    if (result.game === 'coinflip') flip = state; else if (result.game === 'dice') dice = state; else slots = state;
    held = message.profile; release(duration);
    setTimeout(() => play(result.payout > result.stake ? 'buy' : 'deny'), duration * 1000);
    redraw();
  } else {
    if (message.profile) game.profile = message.profile;
    if (message.bought?.finish) { equip(message.bought.weapon, message.bought.finish); ctx.toast(`${finishInfo(message.bought.finish).name} equipped.`, 'good'); }
    if (message.bought?.kind) ctx.onGearBought(message.bought);
    if (message.sent) { ctx.toast(`Sent ${message.sent.amount} coins to ${message.sent.to}.`, 'good'); wallet = { to: '', amount: '', pilot: null, looking: false }; }
    play('buy');
    ctx.refreshCoins();
    redraw();
  }
});
net.on('coins-error', (message) => {
  busy = false;
  armed = null;
  if (message.profile) game.profile = message.profile;
  ctx.toast(message.error, 'warn');
  play('deny');
  ctx.refreshCoins();
  redraw();
});
net.on('lookup-result', (message) => {
  if (message.query.toLowerCase() !== wallet.to.trim().toLowerCase()) return;
  wallet.pilot = message.pilot; wallet.looking = false;
  redraw();
});
net.on('profile', (message) => { game.profile = message.profile; ctx?.refreshCoins(); redraw(); });

function equip(weapon, finish) {
  const skins = { ...(game.look.skins || {}) };
  if (finish) skins[weapon] = finish; else delete skins[weapon];
  game.look.skins = skins;
  ctx.saveLook();
}

// ------------------------------------------------------------------ live preview
// One renderer for the shop's turntable. The page redraws often, so the canvas lives outside it and is
// moved into #skin-stage after each draw. Shader finishes animate here just as they do in hand.
let stage = null;
function ensureStage() {
  if (stage) return stage;
  const canvas = document.createElement('canvas');
  canvas.className = 'skin-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dbe7ef', '#10161b', 1.5));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(3, 4, 2); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffb547', 1.4); rim.position.set(-3, 1, -4); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(22, 2.4, 0.05, 50);
  const pivot = new THREE.Group(); scene.add(pivot);
  stage = { canvas, renderer, scene, camera, pivot, key: '', running: false };
  return stage;
}
function showOnStage(weapon, finish) {
  const s = ensureStage(), key = `${weapon}:${finish}`;
  if (s.key === key) return;
  s.key = key;
  for (const child of [...s.pivot.children]) { s.pivot.remove(child); child.traverse((mesh) => mesh.geometry?.dispose()); }
  const model = buildWeapon(weapon, '#ffb547', finish);
  model.children.filter((child) => child.userData.arm).forEach((arm) => model.remove(arm));
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.position.sub(box.getCenter(new THREE.Vector3()));
  s.pivot.add(model);
  const length = Math.max(size.z, size.y * 2.4, 0.35);
  s.camera.position.set(length * 1.45, length * 0.28, 0);
  s.camera.lookAt(0, 0, 0);
}
function spin() {
  const s = stage;
  if (!s.canvas.isConnected) { s.running = false; return; }
  const t = performance.now() / 1000;
  s.pivot.rotation.y = Math.sin(t * 0.45) * 0.65 - 0.15;
  s.pivot.rotation.x = Math.sin(t * 0.3) * 0.06;
  s.renderer.render(s.scene, s.camera);
  requestAnimationFrame(spin);
}
// Called by the menu after every redraw.
export function mountShop() {
  const slot = document.querySelector('#skin-stage');
  if (!slot) return;
  const s = ensureStage();
  slot.append(s.canvas);
  const width = slot.clientWidth || 600, height = slot.clientHeight || 260;
  s.renderer.setSize(width, height, false);
  s.camera.aspect = width / height; s.camera.updateProjectionMatrix();
  showOnStage(weaponId, showingFinish());
  if (!s.running) { s.running = true; requestAnimationFrame(spin); }
}
function showingFinish() { const equipped = game.look.skins?.[weaponId] || null; return preview === undefined ? null : preview ?? equipped; }

// ------------------------------------------------------------------ skins
const RARITY_ORDER = Object.keys(RARITY);
function skinsHtml() {
  const profile = game.profile;
  const owned = profile.skins?.[weaponId] || [];
  const equipped = game.look.skins?.[weaponId] || null;
  const showing = showingFinish();
  const weapons = WEAPON_CLASSES.map((c) => `<p class="shop-class">${c.name}</p>${skinnable.filter((w) => !w.melee && weaponClass(w) === c.id).map(weaponButton).join('')}`).join('') + `<p class="shop-class">Melee</p>${weaponButton(WEAPONS.knife)}`;
  const card = (finish) => {
    const info = finishInfo(finish.id), rarity = RARITY[info.rarity];
    const mine = owned.includes(finish.id), on = equipped === finish.id;
    const key = `skin:${weaponId}:${finish.id}`;
    const action = on ? '<em class="state on">Equipped</em>' : mine ? `<button type="button" class="mini" data-equip="${finish.id}">Equip</button>`
      : `<button type="button" class="mini buy${armed === key ? ' armed' : ''}" data-buy-skin="${finish.id}">${armed === key ? 'Confirm' : 'Buy'} ${coins(rarity.price)}</button>`;
    return `<div class="finish-card rarity-${info.rarity}${animatedFinish(finish.id) ? ' fx' : ''}${showing === finish.id ? ' showing' : ''}${on ? ' on' : ''}" style="--rarity:${rarity.color}"><button type="button" class="finish-look" data-preview="${finish.id}"><img src="${finishSwatch(finish.id)}" alt="" /><b>${info.name}</b><small>${rarity.name}</small></button>${action}</div>`;
  };
  const stock = `<div class="finish-card${!showing ? ' showing' : ''}${!equipped ? ' on' : ''}"><button type="button" class="finish-look" data-preview=""><i class="finish-plain"></i><b>Factory</b><small>Default</small></button>${equipped ? '<button type="button" class="mini" data-equip="">Equip</button>' : '<em class="state on">Equipped</em>'}</div>`;
  const info = showing && finishInfo(showing);
  return `<div class="shop-skins">
    <nav class="shop-weapons" aria-label="Weapons">${weapons}</nav>
    <div class="shop-stage">
      <div class="panel skin-preview${info ? ` rarity-${info.rarity}` : ''}"><div id="skin-stage" class="skin-stage"></div><div><small>${WEAPONS[weaponId].tag}</small><h3>${WEAPONS[weaponId].name}</h3><span>${info ? `<b style="color:${RARITY[info.rarity].color}">${info.name}</b> · ${RARITY[info.rarity].name}${animatedFinish(info.id) ? ' · animated' : ''}` : 'Factory finish'}</span>${info ? `<p class="skin-price">${owned.includes(info.id) ? 'Owned' : coins(RARITY[info.rarity].price)}</p>` : ''}</div></div>
      <div class="segmented rarity-filter">${['all', ...RARITY_ORDER].map((id) => `<button type="button" data-rarity="${id}" class="${rarityFilter === id ? 'active' : ''}"${id === 'all' ? '' : ` style="--rarity:${RARITY[id].color}"`}>${id === 'all' ? 'All' : RARITY[id].name}</button>`).join('')}</div>
      <div class="finish-grid">${rarityFilter === 'all' ? stock : ''}${FINISHES.filter((finish) => rarityFilter === 'all' || finish.rarity === rarityFilter).map(card).join('')}</div>
    </div></div>`;
}
function weaponButton(weapon) {
  const finish = game.look.skins?.[weapon.id];
  const count = game.profile.skins?.[weapon.id]?.length || 0;
  return `<button type="button" class="shop-weapon${weapon.id === weaponId ? ' active' : ''}" data-weapon="${weapon.id}"><span>${weapon.name}</span>${finish ? `<img src="${finishSwatch(finish)}" alt="" />` : ''}<small>${count ? `${count}/${FINISHES.length}` : ''}</small></button>`;
}

// ------------------------------------------------------------------ crates
function cratesHtml() {
  const chosen = CRATES[crateId];
  const total = Object.values(chosen.weights).reduce((sum, w) => sum + w, 0);
  const odds = Object.entries(chosen.weights).map(([id, w]) => `<li style="--rarity:${RARITY[id].color}"><b>${RARITY[id].name}</b><span>${((w / total) * 100).toFixed(w / total < 0.05 ? 1 : 0)}%</span></li>`).join('');
  const spinning = crate && now() - crate.at < CRATE_SPIN;
  let reel = '<div class="reel-idle">Random finish. Random gun.</div>';
  if (crate) {
    const elapsed = Math.min(CRATE_SPIN, now() - crate.at);
    const end = -(REEL_WIN * REEL_ITEM + REEL_ITEM / 2 + crate.offset);
    reel = `<div class="reel-strip" style="--end:${end}px;animation-delay:-${elapsed}s;animation-duration:${CRATE_SPIN}s">${crate.strip.map((item) => { const info = finishInfo(item.finish); return `<div class="reel-item rarity-${info.rarity}" style="--rarity:${RARITY[info.rarity].color}"><img src="${finishSwatch(item.finish)}" alt="" /><small>${WEAPONS[item.weapon].short}</small></div>`; }).join('')}</div><i class="reel-mark"></i>`;
  }
  const result = crate && !spinning ? crate.result : null;
  const resultInfo = result && finishInfo(result.finish);
  const crateCard = (c) => `<button type="button" class="crate-card crate-${c.id}${crateId === c.id ? ' active' : ''}" data-crate="${c.id}"><b>${c.name}</b><span>${coins(c.cost)}</span><small>${c.id === 'elite' ? 'No commons' : 'Anything goes'}</small></button>`;
  return `<div class="shop-crates">
    <div class="panel crate-panel"><div class="crate-pick">${Object.values(CRATES).map(crateCard).join('')}</div><div class="reel">${reel}</div>
      ${result ? `<div class="crate-result rarity-${result.rarity}" style="--rarity:${RARITY[result.rarity].color}"><img src="${skinArt(result.weapon, result.finish)}" alt="" /><div><small>${RARITY[result.rarity].name}</small><h3>${resultInfo.name}</h3><span>${WEAPONS[result.weapon].name}</span>${result.duplicate ? `<p class="muted">Duplicate. ${coins(result.refund)} back.</p>` : game.look.skins?.[result.weapon] === result.finish ? '<p class="good">Equipped.</p>' : `<button type="button" class="mini" data-equip-crate="1">Equip</button>`}</div></div>` : ''}
      <div class="button-row"><button type="button" data-open-crate="${chosen.id}" ${busy || spinning ? 'disabled' : ''}>Open ${chosen.name.toLowerCase()} ${coins(chosen.cost)}</button></div></div>
    <div class="panel"><p class="eyebrow">Odds <small>${chosen.name}</small></p><ul class="odds">${odds}</ul><small class="muted">Duplicates pay back ${Math.round(DUPLICATE_REFUND * 100)}% of the skin’s price.</small></div></div>`;
}

// ------------------------------------------------------------------ games
function stakeHtml() {
  return `<label class="stake">Stake<span class="stake-row"><input id="game-stake" type="number" min="${STAKE.min}" max="${STAKE.max}" step="1" value="${stake}" />${[10, 50, 100].map((n) => `<button type="button" class="mini" data-stake="${n}">${n}</button>`).join('')}<button type="button" class="mini" data-stake="max">Max</button></span></label>`;
}
const outcome = (state) => {
  if (!state || now() - state.at < ({ coinflip: 1.6, dice: 1.3, slots: SLOT_TIMES[2] }[state.result.game])) return '<p class="game-result">&nbsp;</p>';
  const diff = state.result.payout - state.result.stake;
  return `<p class="game-result ${diff > 0 ? 'good' : diff < 0 ? 'bad' : ''}">${diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : 'Even'}</p>`;
};
function gamesHtml() {
  const spinning = (state, length) => state && now() - state.at < length;
  const flipEnd = flip ? (flip.result.detail.side === 'heads' ? 1800 : 1980) : 0;
  const coin = `<div class="flip-coin${flip ? ' flipping' : ''}" style="${flip ? `--end:${flipEnd}deg;animation-delay:-${Math.min(1.6, now() - flip.at)}s` : ''}"><span class="face heads">H</span><span class="face tails">T</span></div>`;
  const chance = target - 1;
  const roll = dice && !spinning(dice, 1.3) ? dice.result.detail.roll : null;
  const reels = [0, 1, 2].map((index) => {
    const final = slots?.result.detail.reels[index];
    if (!final) return `<div class="slot-reel"><div class="slot-strip"><span>${SLOTS.symbols[index + 1].icon}</span></div></div>`;
    const strip = [...Array.from({ length: 14 }, (_, i) => SLOTS.symbols[(i * 7 + index * 3) % SLOTS.symbols.length].icon), SLOTS.symbols.find((s) => s.id === final).icon];
    return `<div class="slot-reel"><div class="slot-strip spinning" style="--end:${-(strip.length - 1) * SLOT_ROW}px;animation-duration:${SLOT_TIMES[index]}s;animation-delay:-${Math.min(SLOT_TIMES[index], now() - slots.at)}s">${strip.map((icon) => `<span>${icon}</span>`).join('')}</div></div>`;
  }).join('');
  const table = SLOTS.symbols.slice().reverse().map((s) => `<li><b>${s.icon}${s.icon}${s.icon}</b><span>×${s.three}</span><b>${s.icon}${s.icon}</b><span>×${s.two}</span></li>`).join('');
  return `<div class="shop-games">
    <div class="panel game-stake">${stakeHtml()}<small class="muted">Every game keeps a small cut. Play for fun.</small></div>
    <div class="game-grid">
      <div class="panel game"><p class="eyebrow">Coin flip <small>pays ×${COINFLIP.payout}</small></p>${coin}
        <div class="segmented">${['heads', 'tails'].map((side) => `<button type="button" data-pick="${side}" class="${pick === side ? 'active' : ''}">${side === 'heads' ? 'Heads' : 'Tails'}</button>`).join('')}</div>
        <button type="button" data-play-game="coinflip" ${busy || spinning(flip, 1.6) ? 'disabled' : ''}>Flip</button>${outcome(flip)}</div>
      <div class="panel game"><p class="eyebrow">Dice <small>roll under ${target}</small></p><div class="dice-face" id="dice-roll" data-rolling="${dice && spinning(dice, 1.3) ? 1 : ''}">${roll ?? (dice ? '..' : '--')}</div>
        <label class="dice-target">Target <output>${target}</output><input type="range" id="dice-target" min="${DICE.min}" max="${DICE.max}" step="1" value="${target}" /></label>
        <p class="dice-odds"><span>${chance}% chance</span><b>×${diceMultiplier(target)}</b></p>
        <button type="button" data-play-game="dice" ${busy || spinning(dice, 1.3) ? 'disabled' : ''}>Roll</button>${outcome(dice)}</div>
      <div class="panel game"><p class="eyebrow">Slots</p><div class="slot-window">${reels}</div><ul class="slot-table">${table}</ul>
        <button type="button" data-play-game="slots" ${busy || spinning(slots, SLOT_TIMES[2]) ? 'disabled' : ''}>Spin</button>${outcome(slots)}</div>
    </div></div>`;
}
// The dice face flickers through numbers until the roll lands.
setInterval(() => { const face = document.querySelector('#dice-roll[data-rolling="1"]'); if (face) face.textContent = String(1 + Math.floor(Math.random() * 100)).padStart(2, '0'); }, 60);

// ------------------------------------------------------------------ wallet
const WHEN = (at) => { const s = (Date.now() - at) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
function walletHtml() {
  const profile = game.profile;
  const pilot = wallet.pilot;
  const amount = Number(wallet.amount);
  const sendKey = pilot ? `send:${pilot.name}:${amount}` : 'none';
  const card = wallet.looking ? '<p class="muted">Looking…</p>' : wallet.to.trim().length >= 2 && pilot === null ? '<p class="muted">No pilot with that name.</p>'
    : pilot ? `<div class="pilot-card">${pilot.avatar ? `<img class="avatar" src="${escapeHtml(pilot.avatar)}" alt="" width="44" height="44" referrerpolicy="no-referrer" />` : `<i class="avatar blank">${escapeHtml(pilot.name.slice(0, 1).toUpperCase())}</i>`}<div><b>${escapeHtml(pilot.name)}</b><small>${escapeHtml(pilot.title)} · LV ${pilot.level}</small></div></div>` : '';
  const canSend = pilot && !pilot.you && Number.isInteger(amount) && amount >= 1 && amount <= profile.coins;
  const log = (profile.coinLog || []).map((entry) => `<div class="coin-row"><b class="${entry.amount >= 0 ? 'good' : 'bad'}">${entry.amount >= 0 ? '+' : ''}${entry.amount.toLocaleString('en')}</b><span>${escapeHtml(entry.note)}</span><small>${WHEN(entry.at)}</small></div>`).join('') || '<p class="muted">Nothing yet.</p>';
  return `<div class="shop-wallet">
    <div class="panel"><p class="eyebrow">Send coins</p>
      <label class="field">Username<input id="send-to" maxlength="32" autocomplete="off" spellcheck="false" value="${escapeHtml(wallet.to)}" placeholder="Their Krosshair name" /></label>
      ${card}
      <label class="field">Amount<input id="send-amount" type="number" min="1" step="1" value="${escapeHtml(wallet.amount)}" /></label>
      ${pilot?.you ? '<p class="muted">That’s you.</p>' : ''}
      <div class="button-row"><button type="button" data-send="1" class="${armed === sendKey ? 'armed' : ''}" ${canSend && !busy ? '' : 'disabled'}>${armed === sendKey ? `Confirm: ${amount} to ${escapeHtml(pilot.name)}` : 'Send'}</button></div></div>
    <div class="panel"><p class="eyebrow">History</p><div class="coin-log">${log}</div></div></div>`;
}

// ------------------------------------------------------------------ page
function earnHtml() {
  return '<ul class="earn-list"><li><b>Win</b> 12 · vs bots 3</li><li><b>Top kills</b> 8</li><li><b>Player kill</b> 2, more for higher levels</li><li><b>Bot kill</b> 0.4</li><li><b>Contract</b> 5</li></ul>';
}
export function shopPageHtml() {
  if (!loggedIn()) return `<section class="page-wide shop-page"><p class="eyebrow">Shop</p><h1 class="page-title">Spend your <em>coins.</em></h1><div class="panel shop-locked"><p>Coins need a Discord login.</p><a class="discord-button" href="/auth/discord">Log in with Discord</a></div></section>`;
  const body = tab === 'crates' ? cratesHtml() : tab === 'games' ? gamesHtml() : tab === 'wallet' ? walletHtml() : skinsHtml();
  return `<section class="page-wide shop-page"><div class="shop-head"><div><p class="eyebrow">Shop</p><h1 class="page-title">Spend your <em>coins.</em></h1></div>
      <div class="panel balance"><small>Balance</small><b>${coins(game.profile.coins)}</b><details><summary>How to earn</summary>${earnHtml()}</details></div></div>
    <div class="segmented shop-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" data-shop-tab="${id}" class="${id === tab ? 'active' : ''}" aria-selected="${id === tab}">${label}</button>`).join('')}</div>
    ${body}</section>`;
}
// What typed input looks like before a redraw, put back after it.
export function keepShopInput() { return { to: document.querySelector('#send-to')?.value, amount: document.querySelector('#send-amount')?.value, stake: document.querySelector('#game-stake')?.value }; }

export function onShopClick(button) {
  const d = button.dataset;
  if (d.shopTab) { tab = d.shopTab; armed = null; play('ui'); return true; }
  if (d.weapon) { weaponId = d.weapon; preview = null; armed = null; play('ui'); return true; }
  if (d.preview !== undefined) { preview = d.preview || undefined; play('ui'); return true; }
  if (d.equip !== undefined) { equip(weaponId, d.equip || null); preview = null; play('ready'); return true; }
  if (d.buySkin) {
    const key = `skin:${weaponId}:${d.buySkin}`;
    preview = d.buySkin;
    if (game.profile.coins < finishPrice(d.buySkin)) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; }
    if (armed !== key) { armed = key; play('ui'); return true; }
    request({ type: 'shop', action: 'skin', weapon: weaponId, finish: d.buySkin });
    return true;
  }
  if (d.crate) { crateId = d.crate; play('ui'); return true; }
  if (d.rarity) { rarityFilter = d.rarity; play('ui'); return true; }
  if (d.openCrate) { const chosen = CRATES[d.openCrate]; if (game.profile.coins < chosen.cost) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; } crate = null; request({ type: 'shop', action: 'crate', crate: chosen.id }); play('ready'); return true; }
  if (d.equipCrate && crate?.result) { equip(crate.result.weapon, crate.result.finish); play('ready'); return true; }
  if (d.stake) { stake = d.stake === 'max' ? Math.max(STAKE.min, Math.min(STAKE.max, game.profile.coins)) : Number(d.stake); play('ui'); return true; }
  if (d.pick) { pick = d.pick; play('ui'); return true; }
  if (d.playGame) {
    if (!(stake >= STAKE.min && stake <= STAKE.max && Number.isInteger(stake))) { ctx.toast(`Stake ${STAKE.min} to ${STAKE.max}.`, 'warn'); play('deny'); return true; }
    if (stake > game.profile.coins) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; }
    request({ type: 'game', game: d.playGame, stake, pick, target });
    play('ready');
    return true;
  }
  if (d.send && wallet.pilot) {
    const amount = Number(wallet.amount), key = `send:${wallet.pilot.name}:${amount}`;
    if (armed !== key) { armed = key; play('ui'); return true; }
    request({ type: 'send-coins', to: wallet.pilot.name, amount });
    return true;
  }
  return false;
}
let lookupTimer = null;
export function onShopInput(input) {
  if (input.id === 'game-stake') { stake = Math.floor(Number(input.value) || 0); return false; }
  if (input.id === 'dice-target') {
    // Updated in place: redrawing would drop the slider mid-drag.
    target = Number(input.value);
    const panel = input.closest('.game');
    panel.querySelector('output').textContent = target;
    panel.querySelector('.eyebrow small').textContent = `roll under ${target}`;
    panel.querySelector('.dice-odds').innerHTML = `<span>${target - 1}% chance</span><b>×${diceMultiplier(target)}</b>`;
    return false;
  }
  if (input.id === 'send-amount') { wallet.amount = input.value; armed = null; return 'soft'; }
  if (input.id === 'send-to') {
    wallet.to = input.value; wallet.pilot = undefined; armed = null;
    clearTimeout(lookupTimer);
    const name = input.value.trim();
    if (name.length >= 2) { wallet.looking = true; lookupTimer = setTimeout(() => net.send({ type: 'lookup', name }), 300); } else wallet.looking = false;
    return 'soft';
  }
  return false;
}
export function restoreShopInput(kept) {
  const to = document.querySelector('#send-to'), amount = document.querySelector('#send-amount'), stakeInput = document.querySelector('#game-stake');
  if (to && kept.to !== undefined) to.value = kept.to;
  if (amount && kept.amount !== undefined) amount.value = kept.amount;
  if (stakeInput && kept.stake !== undefined) stakeInput.value = kept.stake;
}
