// The Shop page: gun skins, crates, the minigames and the wallet (history and sending coins).
// The menu redraws often, so every animation runs off a start time: a redraw mid-spin picks up where
// it was instead of starting again. Results arrive with the new balance, which is held back until the
// animation lands so the coin counter never gives the answer away.
import { COSMETICS, WEAPONS, WEAPON_CLASSES, dateKey, weaponClass } from '../shared/constants.js';
import * as THREE from 'three';
import { COINFLIP, CRATES, DAILY_CRATE, DICE, DUPLICATE_REFUND, EPIC_OR_BETTER, FINISHES, NEXT_RARITY, RARITY, finishValue, CARD_NAMES, CRASH, PLINKO, crashAt, hiloMultiplier, hiloOdds, SCRAP, SLOTS, STAKE, TRADE_UP, crateFinishes, crateOdds, diceMultiplier, finishInfo, finishPrice } from '../shared/economy.js';
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';
import { animatedFinish, finishSwatch, patternSwatch } from './skins.js';
import { buildCharm, buildWeapon } from './viewmodel.js';
import { animateOperator, buildOperator, lookOf, styleOperator } from './characters.js';
import { skinArt } from './weaponart.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const COIN = '<svg class="coin-icon" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><polygon points="10,1 18,5.5 18,14.5 10,19 2,14.5 2,5.5" fill="#ffb547"/><polygon points="10,4 15.4,7 15.4,13 10,16 4.6,13 4.6,7" fill="none" stroke="#7a4a00" stroke-width="1.2"/><path d="M8.3 6.8v6.4M8.3 10l3.6-3.2M9.6 9l2.5 4.2" stroke="#7a4a00" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>';
export const coins = (n) => `<span class="coins">${COIN}${Number(n).toLocaleString('en')}</span>`;
const TABS = [['crates', 'Crates'], ['skins', 'Skins'], ['gear', 'Gear'], ['charms', 'Charms'], ['inventory', 'Inventory'], ['games', 'Games'], ['wallet', 'Wallet']];
const REEL_ITEM = 128, REEL_LENGTH = 34, REEL_WIN = 29, CRATE_SPIN = 4.6;
const SLOT_ROW = 64, SLOT_TIMES = [1.1, 1.5, 1.9];
const now = () => performance.now() / 1000;
const skinnable = Object.values(WEAPONS);

let ctx = null;
let tab = 'crates';
let weaponId = 'm44';
let preview = null;          // finish being looked at (null = what is equipped)
let armed = null;            // a buy or send waiting for its confirm click
let busy = false;
let held = null;             // profile held back until an animation lands
let crate = null;            // the reel: { strip, at, offset }
let reveal = null;           // what the reel (or a trade-up) gave: { drops, index, source, crateId, count }
let drops = [];              // server-wide recent big drops
let dropsAsked = false;
let inventoryPick = null;    // { weapon, finish } shown on the inventory stage
let trade = [];              // skins picked for a trade-up
let tradeMode = false;
let flip = null, dice = null, slots = null, plinko = null, hilo = null; // { result, at }
let crashGame = null;        // { phase: 'running' | 'done', stake, auto, start, result }
let crashAuto = '';
let gearKind = 'headgear';
let tryOn = null;            // a gear item being tried on, not yet equipped
let charmTry = null;
let charmWeapon = 'talon';
let friends = null;          // [{ name, avatar, level, title, online }] once fetched
let friendName = '';
let stake = 10, target = 50, pick = 'heads';
let crateId = 'field';
let rarityFilter = 'all';
let wallet = { to: '', amount: '', pilot: null, looking: false };

export function initShop(context) { ctx = context; }
const loggedIn = () => Boolean(game.username && game.profile);
function redraw() { if (ctx?.onShop()) ctx.rerender(); }
const RARITY_RANK = Object.fromEntries(Object.keys(RARITY).map((id, index) => [id, index]));
// The reel has landed (or was skipped): show the reveal and let the coin counter catch up.
let landTimer = null;
function landAfter(seconds) {
  clearTimeout(landTimer);
  landTimer = setTimeout(land, seconds * 1000);
}
function land() {
  if (!reveal || reveal.landed) return;
  clearTimeout(landTimer);
  reveal.landed = true; reveal.at = now();
  if (held) { game.profile = held; held = null; }
  const top = reveal.drops[reveal.index];
  play(RARITY_RANK[top.rarity] >= RARITY_RANK.legendary ? 'xp' : top.rarity === 'epic' ? 'ready' : 'buy');
  ctx.refreshCoins();
  redraw();
}
function release(after) {
  setTimeout(() => { if (held) { game.profile = held; held = null; } ctx.refreshCoins(); redraw(); }, after * 1000);
}
function request(message) { if (busy) return; busy = true; net.send(message); }

net.on('coins-result', (message) => {
  busy = false;
  armed = null;
  if (message.unboxed) {
    // The reel lands on the best drop; the reveal then shows all of them.
    const got = message.unboxed.drops;
    const best = got.reduce((top, drop) => (RARITY_RANK[drop.rarity] > RARITY_RANK[top.rarity] ? drop : top), got[0]);
    const pool = crateFinishes(CRATES[message.unboxed.crate]);
    const strip = Array.from({ length: REEL_LENGTH }, (_, i) => (i === REEL_WIN ? best : { weapon: skinnable[Math.floor(Math.random() * skinnable.length)].id, finish: pool[Math.floor(Math.random() * pool.length)].id }));
    crate = { strip, at: now(), offset: Math.random() * 80 - 40 };
    reveal = { drops: got, index: got.indexOf(best), source: 'crate', crateId: message.unboxed.crate, count: got.length, free: message.unboxed.free, landed: false };
    held = message.profile;
    landAfter(CRATE_SPIN);
    redraw();
  } else if (message.crashStarted) {
    busy = false;
    game.profile = message.profile;
    crashGame = { phase: 'running', ...message.crashStarted };
    play('ready');
    ctx.refreshCoins();
    redraw();
    startGameFrame();
  } else if (message.traded) {
    held = null;
    game.profile = message.profile;
    trade = []; tradeMode = false;
    reveal = { drops: [message.traded], index: 0, source: 'trade', landed: true, at: now() };
    crate = null;
    tab = 'crates';
    play(RARITY_RANK[message.traded.rarity] >= RARITY_RANK.legendary ? 'xp' : 'buy');
    ctx.refreshCoins();
    redraw();
  } else if (message.scrapped) {
    game.profile = message.profile;
    if (game.look.skins?.[message.scrapped.weapon] === message.scrapped.finish) equip(message.scrapped.weapon, null);
    if (inventoryPick?.weapon === message.scrapped.weapon && inventoryPick?.finish === message.scrapped.finish) inventoryPick = null;
    ctx.toast(`Scrapped for ${message.scrapped.coins} coins.`, 'good');
    play('buy');
    ctx.refreshCoins();
    redraw();
  } else if (message.game) {
    const result = message.game;
    const state = { result, at: now() };
    if (result.game === 'crash') {
      // Settled by a cash-out or by the crash itself; there is nothing left to animate.
      crashGame = { ...(crashGame || {}), phase: 'done', result };
      game.profile = message.profile;
      play(result.payout > result.stake ? 'buy' : 'deny');
      ctx.refreshCoins();
      redraw();
      return;
    }
    const duration = GAME_TIME[result.game];
    ({ coinflip: () => { flip = state; }, dice: () => { dice = state; }, slots: () => { slots = state; }, plinko: () => { plinko = state; }, hilo: () => { hilo = state; } })[result.game]();
    if (result.game === 'plinko') setTimeout(startGameFrame, 0);
    held = message.profile; release(duration);
    setTimeout(() => play(result.payout > result.stake ? 'buy' : 'deny'), duration * 1000);
    redraw();
  } else {
    if (message.profile) game.profile = message.profile;
    if (message.bought?.finish) { equip(message.bought.weapon, message.bought.finish); ctx.toast(`${finishInfo(message.bought.finish).name} equipped.`, 'good'); }
    if (message.bought?.kind) ctx.onGearBought(message.bought);
    if (message.sent) { ctx.toast(`Sent ${message.sent.amount} coins to ${message.sent.to}.`, 'good'); wallet = { to: '', amount: '', pilot: null, looking: false }; for (const id of ['#send-to', '#send-amount']) { const box = document.querySelector(id); if (box) box.value = ''; } }
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
net.on('friends-result', (message) => {
  busy = false;
  friends = message.friends || [];
  if (message.profile) game.profile = message.profile;
  // The redraw keeps whatever is typed in a box, so clear the box itself too.
  if (message.error) { ctx.toast(message.error, 'warn'); play('deny'); } else { friendName = ''; const box = document.querySelector('#friend-name'); if (box) box.value = ''; }
  redraw();
});
net.on('drops', (message) => { drops = message.drops || []; redraw(); });
net.on('drop', (message) => {
  drops = [message.drop, ...drops].slice(0, 12);
  const info = finishInfo(message.drop.finish);
  if (message.drop.name !== game.username) ctx?.toast(`${message.drop.name} unboxed ${info.name} (${RARITY[message.drop.rarity].name})`, 'good');
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
// subject: { kind: 'gun', weapon, finish, charm? } or { kind: 'operator', look }. Rebuilt only when it changes.
function showOnStage(subject) {
  const s = ensureStage(), key = JSON.stringify(subject);
  if (s.key === key) return;
  s.key = key;
  for (const child of [...s.pivot.children]) { s.pivot.remove(child); child.traverse((mesh) => mesh.geometry?.dispose()); }
  s.charm = null; s.operator = null;
  if (subject.kind === 'operator') {
    const model = buildOperator(subject.look.color, subject.look.accent);
    styleOperator(model, { ...lookOf(subject.look), team: 'friend' });
    s.pivot.add(model);
    s.operator = model;
    s.camera.position.set(0, 1.0, 6.6);
    s.camera.lookAt(0, 0.88, 0);
    return;
  }
  const model = buildWeapon(subject.weapon, '#ffb547', subject.finish);
  model.children.filter((child) => child.userData.arm).forEach((arm) => model.remove(arm));
  if (subject.charm) {
    // Hung where it hangs in hand, a little larger so it reads on the turntable.
    const charm = buildCharm(subject.charm);
    if (charm) { const reach = Math.min(...model.children.filter((c) => c.isMesh).map((c) => c.position.z)); charm.position.set(-0.042, -0.028, Math.max(reach * 0.45, -0.32)); charm.scale.setScalar(4); model.add(charm); s.charm = charm; }
  }
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.position.sub(box.getCenter(new THREE.Vector3()));
  s.pivot.add(model);
  const length = Math.max(size.z, size.y * 2.4, 0.35);
  s.camera.position.set(length * (subject.charm ? 1.2 : 1.45), length * 0.28, 0);
  s.camera.lookAt(0, subject.charm ? -0.04 : 0, 0);
}
function spin() {
  const s = stage;
  if (!s.canvas.isConnected) { s.running = false; return; }
  const t = performance.now() / 1000;
  if (s.operator) {
    s.pivot.rotation.set(0, Math.PI + Math.sin(t * 0.4) * 0.9, 0);
    animateOperator(s.operator, { speed: 0, crouch: false, pitch: Math.sin(t / 1.7) * 0.08, weapon: 'm44', dt: 1 / 60 });
  } else {
    s.pivot.rotation.y = Math.sin(t * 0.45) * 0.65 - 0.15;
    s.pivot.rotation.x = Math.sin(t * 0.3) * 0.06;
  }
  // A charm swings as the gun turns.
  if (s.charm) { s.charm.rotation.z = Math.sin(t * 2.4) * 0.5 + Math.cos(t * 0.45) * 0.3; s.charm.rotation.x = Math.sin(t * 1.7) * 0.3; }
  s.renderer.render(s.scene, s.camera);
  requestAnimationFrame(spin);
}
function stageSubject() {
  if (tab === 'crates' && reveal?.landed) { const drop = reveal.drops[reveal.index]; return { kind: 'gun', weapon: drop.weapon, finish: drop.finish }; }
  if (tab === 'inventory' && inventoryPick) return { kind: 'gun', ...inventoryPick };
  if (tab === 'gear') return { kind: 'operator', look: tryLook() };
  if (tab === 'charms') return { kind: 'gun', weapon: charmWeapon, finish: game.look.skins?.[charmWeapon] || null, charm: charmTry ?? game.look.charm };
  return { kind: 'gun', weapon: weaponId, finish: showingFinish() };
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
  showOnStage(stageSubject());
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
      : !rarity.price ? '<em class="state crates-only">Crates only</em>'
      : `<button type="button" class="mini buy${armed === key ? ' armed' : ''}" data-buy-skin="${finish.id}">${armed === key ? 'Confirm' : 'Buy'} ${coins(rarity.price)}</button>`;
    return `<div class="finish-card rarity-${info.rarity}${animatedFinish(finish.id) ? ' fx' : ''}${showing === finish.id ? ' showing' : ''}${on ? ' on' : ''}" style="--rarity:${rarity.color}"><button type="button" class="finish-look" data-preview="${finish.id}"><img src="${finishSwatch(finish.id)}" alt="" /><b>${info.name}</b><small>${rarity.name}</small></button>${action}</div>`;
  };
  const stock = `<div class="finish-card${!showing ? ' showing' : ''}${!equipped ? ' on' : ''}"><button type="button" class="finish-look" data-preview=""><i class="finish-plain"></i><b>Factory</b><small>Default</small></button>${equipped ? '<button type="button" class="mini" data-equip="">Equip</button>' : '<em class="state on">Equipped</em>'}</div>`;
  const info = showing && finishInfo(showing);
  return `<div class="shop-skins">
    <nav class="shop-weapons" aria-label="Weapons">${weapons}</nav>
    <div class="shop-stage">
      <div class="panel skin-preview${info ? ` rarity-${info.rarity}` : ''}"><div id="skin-stage" class="skin-stage"></div><div><small>${WEAPONS[weaponId].tag}</small><h3>${WEAPONS[weaponId].name}</h3><span>${info ? `<b style="color:${RARITY[info.rarity].color}">${info.name}</b> · ${RARITY[info.rarity].name}${animatedFinish(info.id) ? ' · animated' : ''}` : 'Factory finish'}</span>${info ? `<p class="skin-price">${owned.includes(info.id) ? 'Owned' : RARITY[info.rarity].price ? coins(RARITY[info.rarity].price) : 'Crates only'}</p>` : ''}</div></div>
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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dropName = (drop) => `${finishInfo(drop.finish).name} · ${WEAPONS[drop.weapon].name}`;
function crateBox(c) { return `<i class="crate-box" style="--crate:${c.color}"><b></b></i>`; }
function cratesHtml() {
  const profile = game.profile;
  const chosen = CRATES[crateId];
  const odds = crateOdds(chosen);
  const total = odds.reduce((sum, [, weight]) => sum + weight, 0);
  const oddsHtml = odds.map(([id, weight]) => `<li style="--rarity:${RARITY[id].color}"><b>${RARITY[id].name}</b><span>${((weight / total) * 100).toFixed(weight / total < 0.05 ? 1 : 0)}%</span></li>`).join('');
  const since = profile.pity?.[chosen.id] || 0;
  const pity = chosen.pity ? `Epic or better within ${plural(chosen.pity - since, 'open')}.` : odds.every(([id]) => EPIC_OR_BETTER.includes(id)) ? 'Every drop is Epic or better.' : '';
  const dailyWait = Math.max(0, (profile.dailyCrate || 0) + DAILY_CRATE.hours * 3600e3 - Date.now());
  const spinning = Boolean(crate) && !reveal?.landed;
  const picker = `<div class="crate-pick">${Object.values(CRATES).map((c) => `<button type="button" class="crate-card${crateId === c.id ? ' active' : ''}" data-crate="${c.id}" style="--crate:${c.color}">${crateBox(c)}<b>${c.name}</b><span>${coins(c.cost)}</span><small>${c.blurb}</small></button>`).join('')}</div>`;
  const daily = `<button type="button" class="daily-crate${dailyWait ? ' waiting' : ''}" data-daily="1" ${dailyWait || busy || spinning ? 'disabled' : ''}>${crateBox(CRATES[DAILY_CRATE.crate])}<span><b>Daily crate</b><small>${dailyWait ? `Next one in ${Math.ceil(dailyWait / 3600e3)}h` : 'Free. One field crate a day.'}</small></span></button>`;
  let stageHtml;
  if (reveal?.landed) {
    const shown = reveal.drops[reveal.index], info = finishInfo(shown.finish), rarity = RARITY[shown.rarity];
    const equipped = game.look.skins?.[shown.weapon] === shown.finish;
    const again = reveal.source === 'crate' && !reveal.free ? `<button type="button" data-open-crate="${reveal.crateId}" data-count="${reveal.count}" ${busy ? 'disabled' : ''}>Open again ${coins(CRATES[reveal.crateId].cost * reveal.count)}</button>` : '';
    stageHtml = `<div class="reveal rarity-${shown.rarity}" style="--rarity:${rarity.color}"><i class="reveal-burst"></i>
      <div id="skin-stage" class="skin-stage"></div>
      <div class="reveal-info"><small>${reveal.source === 'trade' ? 'Trade-up' : rarity.name}${shown.pity ? ' · pity drop' : ''}</small><h3>${info.name}</h3><span>${WEAPONS[shown.weapon].name} · ${rarity.name}${animatedFinish(shown.finish) ? ' · animated' : ''}</span>
        ${shown.duplicate ? `<p class="muted">Duplicate. ${coins(shown.refund)} back.</p>` : equipped ? '<p class="good">Equipped.</p>' : `<button type="button" class="mini" data-equip-drop="${reveal.index}">Equip</button>`}</div>
      ${reveal.drops.length > 1 ? `<div class="reveal-row">${reveal.drops.map((drop, i) => `<button type="button" class="reveal-card rarity-${drop.rarity}${i === reveal.index ? ' active' : ''}" style="--rarity:${RARITY[drop.rarity].color};animation-delay:${i * 0.12}s" data-reveal="${i}"><img src="${finishSwatch(drop.finish)}" alt="" /><b>${finishInfo(drop.finish).name}</b><small>${WEAPONS[drop.weapon].short}${drop.duplicate ? ' · dupe' : ''}</small></button>`).join('')}</div>` : ''}
      <div class="button-row">${again}<button type="button" class="ghost-button" data-close-reveal="1">Done</button></div></div>`;
  } else {
    let reel = '<div class="reel-idle">Random finish. Random gun.</div>';
    if (crate) {
      const elapsed = Math.min(CRATE_SPIN, now() - crate.at);
      const end = -(REEL_WIN * REEL_ITEM + REEL_ITEM / 2 + crate.offset);
      reel = `<div class="reel-strip" style="--end:${end}px;animation-delay:-${elapsed}s;animation-duration:${CRATE_SPIN}s">${crate.strip.map((item) => { const info = finishInfo(item.finish); return `<div class="reel-item rarity-${info.rarity}" style="--rarity:${RARITY[info.rarity].color}"><img src="${finishSwatch(item.finish)}" alt="" /><small>${WEAPONS[item.weapon].short}</small></div>`; }).join('')}</div><i class="reel-mark"></i><small class="reel-skip">Click to skip</small>`;
    }
    stageHtml = `${spinning ? '<button type="button" class="reel spinning" data-skip="1" aria-label="Skip">' : '<div class="reel">'}${reel}${spinning ? '</button>' : '</div>'}
      <div class="button-row"><button type="button" data-open-crate="${chosen.id}" data-count="1" ${busy || spinning ? 'disabled' : ''}>Open ${coins(chosen.cost)}</button><button type="button" class="secondary-button" data-open-crate="${chosen.id}" data-count="5" ${busy || spinning ? 'disabled' : ''}>Open ×5 ${coins(chosen.cost * 5)}</button>${pity ? `<span class="muted">${pity}</span>` : ''}</div>`;
  }
  const contents = Object.keys(RARITY).map((rarity) => { const list = crateFinishes(chosen).filter((finish) => finish.rarity === rarity); return list.length ? `<div class="contents-row" style="--rarity:${RARITY[rarity].color}"><small>${RARITY[rarity].name}</small><div>${list.map((finish) => `<img src="${finishSwatch(finish.id)}" alt="${finish.name}" title="${finish.name}" />`).join('')}</div></div>` : ''; }).join('');
  const feed = drops.length ? drops.map((drop) => `<div class="drop-row" style="--rarity:${RARITY[drop.rarity].color}"><img src="${finishSwatch(drop.finish)}" alt="" /><span><b>${escapeHtml(drop.name)}</b> ${dropName(drop)}</span><small>${WHEN(drop.at)}</small></div>`).join('') : '<p class="muted">No big drops yet.</p>';
  return `<div class="shop-crates">
    <div class="crate-main">${picker}${daily}<div class="panel crate-panel">${stageHtml}</div></div>
    <div class="crate-side">
      <div class="panel"><p class="eyebrow">Odds <small>${chosen.name}</small></p><ul class="odds">${oddsHtml}</ul><small class="muted">Duplicates pay back ${Math.round(DUPLICATE_REFUND * 100)}% of the skin’s price.</small></div>
      <div class="panel"><p class="eyebrow">Inside</p>${contents}</div>
      <div class="panel"><p class="eyebrow">Big drops</p><div class="drop-feed">${feed}</div></div>
    </div></div>`;
}

// ------------------------------------------------------------------ inventory
function ownedSkins() {
  const list = [];
  for (const [weapon, finishes] of Object.entries(game.profile.skins || {})) for (const finish of finishes) if (WEAPONS[weapon] && finishInfo(finish)) list.push({ weapon, finish, rarity: finishInfo(finish).rarity });
  return list.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || finishInfo(a.finish).name.localeCompare(finishInfo(b.finish).name));
}
const skinKey = (item) => `${item.weapon}:${item.finish}`;
function inventoryHtml() {
  const items = ownedSkins();
  if (!items.length) return '<div class="panel"><p class="muted">No skins yet. Open a crate or buy one.</p></div>';
  const pick = inventoryPick && items.find((item) => skinKey(item) === skinKey(inventoryPick)) || items[0];
  inventoryPick = { weapon: pick.weapon, finish: pick.finish };
  const info = finishInfo(pick.finish), rarity = RARITY[pick.rarity];
  const equipped = game.look.skins?.[pick.weapon] === pick.finish;
  const scrapValue = Math.floor(finishValue(pick.finish) * SCRAP);
  const scrapKey = `scrap:${skinKey(pick)}`;
  const tradeRarity = trade.length ? finishInfo(trade[0].finish).rarity : null;
  const shown = items.filter((item) => rarityFilter === 'all' || item.rarity === rarityFilter);
  const card = (item) => {
    const key = skinKey(item), picked = trade.some((t) => skinKey(t) === key);
    const blocked = tradeMode && !picked && (item.rarity === 'mythic' || (tradeRarity && item.rarity !== tradeRarity) || trade.length >= TRADE_UP);
    return `<button type="button" class="inv-card rarity-${item.rarity}${key === skinKey(pick) && !tradeMode ? ' active' : ''}${picked ? ' picked' : ''}${blocked ? ' blocked' : ''}${game.look.skins?.[item.weapon] === item.finish ? ' on' : ''}" style="--rarity:${RARITY[item.rarity].color}" data-inv="${key}"><img src="${skinArt(item.weapon, item.finish)}" alt="" /><b>${finishInfo(item.finish).name}</b><small>${WEAPONS[item.weapon].name}</small></button>`;
  };
  const slots = Array.from({ length: TRADE_UP }, (_, i) => trade[i] ? `<img src="${finishSwatch(trade[i].finish)}" alt="" title="${dropName(trade[i])}" />` : '<i></i>').join('');
  const counts = Object.keys(RARITY).map((id) => [id, items.filter((item) => item.rarity === id).length]).filter(([, n]) => n);
  return `<div class="shop-inventory">
    <div class="inv-top">
      <div class="panel skin-preview rarity-${pick.rarity}"><div id="skin-stage" class="skin-stage"></div><div><small>${WEAPONS[pick.weapon].tag}</small><h3>${info.name}</h3><span>${WEAPONS[pick.weapon].name} · <b style="color:${rarity.color}">${rarity.name}</b></span>
        <div class="button-row">${equipped ? '<em class="state on">Equipped</em>' : `<button type="button" class="mini" data-inv-equip="1">Equip</button>`}<button type="button" class="mini${armed === scrapKey ? ' armed' : ''}" data-scrap="1">${armed === scrapKey ? 'Confirm scrap' : 'Scrap'} ${coins(scrapValue)}</button></div></div></div>
      <div class="panel trade-panel"><p class="eyebrow">Trade-up</p><p class="muted">${TRADE_UP} skins of one rarity for 1 random skin of the next.</p><div class="trade-slots">${slots}</div>
        <div class="button-row">${tradeMode ? `<button type="button" data-trade-go="1" ${trade.length === TRADE_UP && !busy ? '' : 'disabled'}>Trade up${tradeRarity ? ` to ${RARITY[NEXT_RARITY[tradeRarity]].name}` : ''}</button><button type="button" class="ghost-button" data-trade-cancel="1">Cancel</button>` : '<button type="button" class="secondary-button" data-trade-start="1">Pick skins</button>'}</div></div>
    </div>
    <div class="inv-head"><div class="segmented rarity-filter">${['all', ...RARITY_ORDER].map((id) => `<button type="button" data-rarity="${id}" class="${rarityFilter === id ? 'active' : ''}"${id === 'all' ? '' : ` style="--rarity:${RARITY[id].color}"`}>${id === 'all' ? `All ${items.length}` : `${RARITY[id].name} ${counts.find(([r]) => r === id)?.[1] || 0}`}</button>`).join('')}</div>${tradeMode ? `<span class="muted">Picking ${trade.length}/${TRADE_UP}</span>` : ''}</div>
    <div class="inv-grid">${shown.map(card).join('') || '<p class="muted">None of that rarity.</p>'}</div></div>`;
}

// ------------------------------------------------------------------ gear
// Every operator item in one place. Clicking one tries it on the model; it only sticks once equipped.
const GEAR_KINDS = [['headgear', 'Headgear'], ['face', 'Face'], ['pack', 'Pack'], ['pattern', 'Pattern'], ['suit', 'Suit colour'], ['visor', 'Visor'], ['tracer', 'Tracer'], ['title', 'Title']];
const LOOK_KEY = { suit: 'color', visor: 'accent' };
const lookKey = (kind) => LOOK_KEY[kind] || kind;
function tryLook() { return tryOn ? { ...game.look, [lookKey(gearKind)]: tryOn } : { ...game.look }; }
function gearStatus(kind, item) {
  const owned = (game.profile.owned || []).includes(`${kind}:${item.id}`);
  const unlocked = item.price ? owned : (game.profile.level || 1) >= item.level;
  return { owned, unlocked, equipped: game.look[lookKey(kind)] === item.id };
}
function gearAction(kind, item, state) {
  const key = `gear:${kind}:${item.id}`;
  if (state.equipped) return '<em class="state on">Equipped</em>';
  if (state.unlocked) return `<button type="button" class="mini" data-gear-equip="${item.id}">Equip</button>`;
  if (!item.price) return `<em class="state">Level ${item.level}</em>`;
  return `<button type="button" class="mini buy${armed === key ? ' armed' : ''}" data-gear-buy="${item.id}">${armed === key ? 'Confirm' : 'Buy'} ${coins(item.price)}</button>`;
}
function gearVisual(kind, item) {
  if (kind === 'suit' || kind === 'visor' || kind === 'tracer') return `<i class="gear-swatch" style="background:${item.id}"></i>`;
  if (kind === 'pattern') return `<i class="gear-swatch" style="background-color:${game.look.color};${item.id === 'solid' ? '' : `background-image:url(${patternSwatch(item.id)})`}"></i>`;
  if (kind === 'title') return `<i class="gear-title">${escapeHtml(item.name)}</i>`;
  return '';
}
function gearHtml() {
  const look = tryLook();
  const current = COSMETICS[gearKind].find((item) => item.id === look[lookKey(gearKind)]);
  const cards = COSMETICS[gearKind].map((item) => {
    const state = gearStatus(gearKind, item);
    return `<div class="gear-card${state.equipped ? ' on' : ''}${tryOn === item.id ? ' showing' : ''}${state.unlocked ? '' : ' locked'}"><button type="button" class="gear-look" data-try="${item.id}">${gearVisual(gearKind, item)}<b>${escapeHtml(item.name)}</b><small>${item.price ? (state.owned ? 'Owned' : 'Coins') : `Level ${item.level}`}</small></button>${gearAction(gearKind, item, state)}</div>`;
  }).join('');
  return `<div class="shop-gear">
    <div class="panel operator-try"><div id="skin-stage" class="skin-stage tall"></div>
      <div class="try-tag"><small>${escapeHtml(look.title)}</small><b>${escapeHtml(game.profile.name)}</b>${tryOn ? `<span>Trying on: ${escapeHtml(current?.name || '')}</span><button type="button" class="ghost-button" data-try-reset="1">Back to mine</button>` : '<span>Click anything to try it on.</span>'}</div>
      ${gearKind === 'tracer' ? `<i class="tracer-demo" style="--tracer:${look.tracer}"></i>` : ''}</div>
    <div class="gear-side"><div class="segmented gear-kinds">${GEAR_KINDS.map(([id, label]) => `<button type="button" data-gear-kind="${id}" class="${gearKind === id ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="gear-grid">${cards}</div></div></div>`;
}

// ------------------------------------------------------------------ charms
const CHARM_GUNS = ['talon', 'm44', 'wasp', 'breaker', 'p9'];
function charmsHtml() {
  const showing = charmTry ?? game.look.charm;
  const cards = COSMETICS.charm.map((item) => {
    const state = gearStatus('charm', item);
    return `<div class="gear-card${state.equipped ? ' on' : ''}${showing === item.id ? ' showing' : ''}${state.unlocked ? '' : ' locked'}"><button type="button" class="gear-look" data-charm-try="${item.id}"><i class="charm-icon charm-${item.id}"></i><b>${escapeHtml(item.name)}</b><small>${item.price ? (state.owned ? 'Owned' : 'Coins') : `Level ${item.level}`}</small></button>${gearAction('charm', item, state).replace('data-gear-equip', 'data-charm-equip').replace('data-gear-buy', 'data-charm-buy')}</div>`;
  }).join('');
  const item = COSMETICS.charm.find((entry) => entry.id === showing);
  return `<div class="shop-charms">
    <div class="panel skin-preview"><div id="skin-stage" class="skin-stage"></div><div><small>Gun charm</small><h3>${escapeHtml(item?.name || 'None')}</h3><span>Hangs off your gun and swings as you move.</span>
      <div class="segmented charm-guns">${CHARM_GUNS.map((id) => `<button type="button" data-charm-gun="${id}" class="${charmWeapon === id ? 'active' : ''}">${WEAPONS[id].short}</button>`).join('')}</div></div></div>
    <div class="gear-grid">${cards}</div></div>`;
}

// ------------------------------------------------------------------ games
const GAME_TIME = { coinflip: 1.6, dice: 1.3, slots: SLOT_TIMES[2], plinko: PLINKO.rows * 0.16 + 0.35, hilo: 0.9 };
function stakeHtml() {
  return `<label class="stake">Stake<span class="stake-row"><input id="game-stake" type="number" min="${STAKE.min}" max="${STAKE.max}" step="1" value="${stake}" />${[10, 50, 100].map((n) => `<button type="button" class="mini" data-stake="${n}">${n}</button>`).join('')}<button type="button" class="mini" data-stake="max">Max</button></span></label>`;
}
const settled = (state) => state && now() - state.at >= GAME_TIME[state.result.game];
const outcome = (state) => {
  if (!settled(state)) return '<p class="game-result">&nbsp;</p>';
  const diff = state.result.payout - state.result.stake;
  return `<p class="game-result ${diff > 0 ? 'good' : diff < 0 ? 'bad' : ''}">${diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : 'Even'}</p>`;
};
const running = (state) => state && !settled(state);
const playButton = (id, label, state) => `<button type="button" data-play-game="${id}" ${busy || running(state) ? 'disabled' : ''}>${label}</button>`;
function crashPanel() {
  const round = crashGame;
  const live = round?.phase === 'running';
  const result = round?.phase === 'done' ? round.result : null;
  const mult = live ? crashAt(net.time() - round.start) : result ? (result.detail.cashed || result.detail.crash) : 1;
  const state = live ? 'live' : result ? (result.detail.cashed ? 'cashed' : 'crashed') : '';
  const label = live ? `Cash out ${coins(Math.floor(round.stake * mult))}` : 'Bet';
  const note = result ? (result.detail.cashed ? `Cashed at ×${result.detail.cashed}. Crashed at ×${result.detail.crash}.` : `Crashed at ×${result.detail.crash}.`) : 'Cash out before it crashes.';
  return `<div class="panel game crash-game"><p class="eyebrow">Crash <small>×${CRASH.max} max</small></p>
    <div class="crash-screen ${state}"><svg viewBox="0 0 300 140" preserveAspectRatio="none"><path id="crash-line" d="M0 140" /></svg><b id="crash-mult">×${mult.toFixed(2)}</b></div>
    <label class="crash-auto">Auto cash-out <input id="crash-auto" type="number" min="1.01" max="${CRASH.max}" step="0.1" placeholder="Off" value="${escapeHtml(crashAuto)}" ${live ? 'disabled' : ''} /></label>
    <button type="button" ${live ? 'data-crash-out="1" class="cash-out"' : 'data-crash-start="1"'} ${busy && !live ? 'disabled' : ''}>${label}</button>
    <p class="game-result ${result ? (result.payout > result.stake ? 'good' : 'bad') : ''}">${result ? (result.payout ? `+${result.payout - result.stake}` : `-${result.stake}`) : '&nbsp;'}</p><small class="muted">${note}</small></div>`;
}
function plinkoPanel() {
  const rows = PLINKO.rows, gap = 22, top = 16, rowH = 18, width = gap * (rows + 2), mid = width / 2;
  const pegs = [];
  for (let r = 0; r < rows; r += 1) for (let i = 0; i <= r + 1; i += 1) pegs.push(`<circle cx="${mid + (i - (r + 1) / 2) * gap}" cy="${top + r * rowH}" r="2.2" />`);
  const slotY = top + rows * rowH + 6;
  const landed = settled(plinko) ? plinko.result.detail.slot : -1;
  const slotsSvg = PLINKO.multipliers.map((m, k) => `<g class="plinko-slot${k === landed ? ' hit' : ''}${m >= 2 ? ' hot' : m < 1 ? ' cold' : ''}"><rect x="${mid + (k - rows / 2) * gap - gap / 2 + 1}" y="${slotY}" width="${gap - 2}" height="16" rx="2" /><text x="${mid + (k - rows / 2) * gap}" y="${slotY + 11}">${m}</text></g>`).join('');
  return `<div class="panel game plinko-game"><p class="eyebrow">Plinko</p>
    <svg class="plinko-board" viewBox="0 0 ${width} ${slotY + 20}">${pegs.join('')}${slotsSvg}<circle id="plinko-ball" cx="${mid}" cy="${top - 10}" r="5" class="${plinko && !settled(plinko) ? '' : 'hidden'}" /></svg>
    ${playButton('plinko', 'Drop', plinko)}${outcome(plinko)}</div>`;
}
function hiloPanel() {
  const card = hilo && !settled(hilo) ? hilo.result.detail.card : game.profile.hiloCard || 7;
  const shownNext = hilo && settled(hilo) ? hilo.result.detail.next : null;
  const odds = (pickId) => { const m = hiloMultiplier(card, pickId); return m ? `×${m} · ${Math.round(hiloOdds(card, pickId) * 100)}%` : 'no chance'; };
  const face = (value, extra = '') => `<div class="playing-card${extra}"><b>${CARD_NAMES[value]}</b></div>`;
  return `<div class="panel game hilo-game"><p class="eyebrow">Higher or lower</p>
    <div class="card-row">${face(hilo && settled(hilo) ? hilo.result.detail.card : card)}${hilo ? (settled(hilo) ? face(shownNext, ' flip') : '<div class="playing-card back"></div>') : ''}</div>
    <div class="hilo-picks"><button type="button" data-hilo="higher" ${busy || running(hilo) || !hiloMultiplier(card, 'higher') ? 'disabled' : ''}>Higher <small>${odds('higher')}</small></button><button type="button" data-hilo="lower" ${busy || running(hilo) || !hiloMultiplier(card, 'lower') ? 'disabled' : ''}>Lower <small>${odds('lower')}</small></button></div>
    ${outcome(hilo)}<small class="muted">A tie loses. The next card stays on the table.</small></div>`;
}
function gamesHtml() {
  const spinning = (state, length) => state && now() - state.at < length;
  const flipEnd = flip ? (flip.result.detail.side === 'heads' ? 1800 : 1980) : 0;
  const coin = `<div class="flip-coin${flip ? ' flipping' : ''}" style="${flip ? `--end:${flipEnd}deg;animation-delay:-${Math.min(1.6, now() - flip.at)}s` : ''}"><span class="face heads">H</span><span class="face tails">T</span></div>`;
  const chance = target - 1;
  const roll = dice && !spinning(dice, 1.3) ? dice.result.detail.roll : null;
  const reels = [0, 1, 2].map((index) => {
    const final = slots?.result.detail.reels[index];
    if (!final) return `<div class="slot-reel"><div class="slot-strip"><span>${SLOTS.symbols[index + 1].icon}</span></div></div>`;
    const strip = [...Array.from({ length: 14 }, (_, i) => SLOTS.symbols[(i * 7 + index * 3) % SLOTS.symbols.length].icon), SLOTS.symbols.find((sym) => sym.id === final).icon];
    return `<div class="slot-reel"><div class="slot-strip spinning" style="--end:${-(strip.length - 1) * SLOT_ROW}px;animation-duration:${SLOT_TIMES[index]}s;animation-delay:-${Math.min(SLOT_TIMES[index], now() - slots.at)}s">${strip.map((icon) => `<span>${icon}</span>`).join('')}</div></div>`;
  }).join('');
  const table = SLOTS.symbols.slice().reverse().map((sym) => `<li><b>${sym.icon}${sym.icon}${sym.icon}</b><span>×${sym.three}</span><b>${sym.icon}${sym.icon}</b><span>×${sym.two}</span></li>`).join('');
  const names = { coinflip: 'Coin flip', dice: 'Dice', slots: 'Slots', plinko: 'Plinko', hilo: 'Higher or lower', crash: 'Crash' };
  const log = (game.profile.gameLog || []).map((entry) => { const diff = entry.payout - entry.stake; return `<div class="bet-row"><span>${names[entry.game] || entry.game}</span><small>${escapeHtml(entry.note || '')}</small><em>${entry.stake}</em><b class="${diff > 0 ? 'good' : diff < 0 ? 'bad' : ''}">${diff > 0 ? '+' : ''}${diff}</b><small>${WHEN(entry.at)}</small></div>`; }).join('') || '<p class="muted">No bets yet.</p>';
  const played = game.profile.gameLog || [];
  const total = played.reduce((sum, entry) => sum + entry.payout - entry.stake, 0);
  return `<div class="shop-games">
    <div class="panel game-stake">${stakeHtml()}<small class="muted">Every game keeps about 5%. Play for fun.</small></div>
    <div class="game-grid">
      ${crashPanel()}${plinkoPanel()}${hiloPanel()}
      <div class="panel game"><p class="eyebrow">Coin flip <small>pays ×${COINFLIP.payout}</small></p>${coin}
        <div class="segmented">${['heads', 'tails'].map((side) => `<button type="button" data-pick="${side}" class="${pick === side ? 'active' : ''}">${side === 'heads' ? 'Heads' : 'Tails'}</button>`).join('')}</div>
        ${playButton('coinflip', 'Flip', flip)}${outcome(flip)}</div>
      <div class="panel game"><p class="eyebrow">Dice <small>roll under ${target}</small></p><div class="dice-face" id="dice-roll" data-rolling="${dice && spinning(dice, 1.3) ? 1 : ''}">${roll ?? (dice ? '..' : '--')}</div>
        <label class="dice-target">Target <output>${target}</output><input type="range" id="dice-target" min="${DICE.min}" max="${DICE.max}" step="1" value="${target}" /></label>
        <p class="dice-odds"><span>${chance}% chance</span><b>×${diceMultiplier(target)}</b></p>
        ${playButton('dice', 'Roll', dice)}${outcome(dice)}</div>
      <div class="panel game"><p class="eyebrow">Slots</p><div class="slot-window">${reels}</div><ul class="slot-table">${table}</ul>
        ${playButton('slots', 'Spin', slots)}${outcome(slots)}</div>
    </div>
    <div class="panel bet-history"><p class="eyebrow">Your last ${played.length} bets <small class="${total > 0 ? 'good' : total < 0 ? 'bad' : ''}">${total > 0 ? '+' : ''}${total}</small></p>${log}</div></div>`;
}
// The dice face flickers through numbers until the roll lands.
setInterval(() => { const face = document.querySelector('#dice-roll[data-rolling="1"]'); if (face) face.textContent = String(1 + Math.floor(Math.random() * 100)).padStart(2, '0'); }, 60);
// Crash and Plinko move every frame; the page itself only redraws when something settles.
let framing = false;
function startGameFrame() { if (!framing) { framing = true; requestAnimationFrame(gameFrame); } }
function gameFrame() {
  const board = document.querySelector('.shop-games');
  const active = crashGame?.phase === 'running' || running(plinko);
  if (!board || !active) { framing = false; if (board && plinko && settled(plinko) && !plinko.shown) { plinko.shown = true; redraw(); } return; }
  if (crashGame?.phase === 'running') {
    const t = net.time() - crashGame.start, m = crashAt(t);
    const label = document.querySelector('#crash-mult'); if (label) label.textContent = `×${m.toFixed(2)}`;
    const button = document.querySelector('[data-crash-out]'); if (button) button.innerHTML = `Cash out ${coins(Math.floor(crashGame.stake * m))}`;
    const line = document.querySelector('#crash-line');
    if (line) { const span = Math.max(6, t), top = Math.max(2, m); const points = Array.from({ length: 40 }, (_, i) => { const at = (t * i) / 39; return `${((at / span) * 300).toFixed(1)} ${(140 - ((crashAt(at) - 1) / (top - 1)) * 130).toFixed(1)}`; }); line.setAttribute('d', `M${points.join(' L')}`); }
  }
  if (running(plinko)) {
    const ball = document.querySelector('#plinko-ball');
    if (ball) {
      const { path } = plinko.result.detail, gap = 22, top = 16, rowH = 18, mid = (gap * (PLINKO.rows + 2)) / 2;
      const step = Math.min(PLINKO.rows, (now() - plinko.at) / 0.16);
      const row = Math.floor(step), frac = step - row;
      const rightsAt = (r) => path.slice(0, r).reduce((sum, v) => sum + v, 0);
      const x0 = mid + (rightsAt(row) - row / 2) * gap, x1 = mid + (rightsAt(Math.min(PLINKO.rows, row + 1)) - (row + 1) / 2) * gap;
      ball.setAttribute('cx', (x0 + (x1 - x0) * frac).toFixed(1));
      ball.setAttribute('cy', (top - 8 + (row + frac) * rowH - Math.sin(frac * Math.PI) * 5).toFixed(1));
      ball.classList.remove('hidden');
    }
  }
  requestAnimationFrame(gameFrame);
}

// ------------------------------------------------------------------ wallet
const WHEN = (at) => { const s = (Date.now() - at) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const SOURCE_NAMES = { match: 'Matches', wager: 'Wagers', crate: 'Crates', scrap: 'Scrap', game: 'Games', receive: 'Received', send: 'Sent', refund: 'Refunds', starter: 'Starter', shop: 'Shop', trade: 'Trade-ups' };
function barList(entries) {
  const top = Math.max(1, ...entries.map(([, n]) => n));
  return entries.length ? entries.map(([kind, n]) => `<div class="bar-row"><span>${SOURCE_NAMES[kind] || kind}</span><i style="width:${Math.max(2, (n / top) * 100)}%"></i><b>${n.toLocaleString('en')}</b></div>`).join('') : '<p class="muted">Nothing yet.</p>';
}
function walletHtml() {
  const profile = game.profile;
  const pilot = wallet.pilot;
  const amount = Number(wallet.amount);
  const sendKey = pilot ? `send:${pilot.name}:${amount}` : 'none';
  const isFriend = pilot && (profile.friends || []).some((name) => name.toLowerCase() === pilot.name.toLowerCase());
  const card = wallet.looking ? '<p class="muted">Looking…</p>' : wallet.to.trim().length >= 2 && pilot === null ? '<p class="muted">No pilot with that name.</p>'
    : pilot ? `<div class="pilot-card">${avatarHtml(pilot, 44)}<div><b>${escapeHtml(pilot.name)}</b><small>${escapeHtml(pilot.title)} · LV ${pilot.level}</small></div>${pilot.you || isFriend ? '' : `<button type="button" class="mini" data-friend-add="${escapeHtml(pilot.name)}">Add friend</button>`}</div>` : '';
  const canSend = pilot && !pilot.you && Number.isInteger(amount) && amount >= 1 && amount <= profile.coins;
  const log = (profile.coinLog || []).map((entry) => `<div class="coin-row"><b class="${entry.amount > 0 ? 'good' : entry.amount < 0 ? 'bad' : ''}">${entry.amount > 0 ? '+' : ''}${entry.amount.toLocaleString('en')}</b><span>${escapeHtml(entry.note)}</span><small>${WHEN(entry.at)}</small></div>`).join('') || '<p class="muted">Nothing yet.</p>';
  // Last 14 days, oldest first.
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 86400e3); const key = dateKey(d); return { key, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), ...(profile.coinDays?.[key] || { in: 0, out: 0 }) }; });
  const peak = Math.max(1, ...days.map((d) => Math.max(d.in, d.out)));
  const today = days[13], week = days.slice(7).reduce((sum, d) => sum + d.in - d.out, 0);
  const chart = days.map((d) => `<div class="day" title="${d.key}: +${d.in} / -${d.out}"><i class="in" style="height:${(d.in / peak) * 100}%"></i><i class="out" style="height:${(d.out / peak) * 100}%"></i><small>${d.label}</small></div>`).join('');
  const stats = profile.coinStats || { in: {}, out: {} };
  const sorted = (side) => Object.entries(side).sort((a, b) => b[1] - a[1]);
  const friendRows = friends === null ? '<p class="muted">Loading…</p>' : friends.length ? friends.map((f) => `<div class="friend-row">${avatarHtml(f, 32)}<span><b>${escapeHtml(f.name)}</b><small>${escapeHtml(f.title)} · LV ${f.level}</small></span><i class="live-dot${f.online ? '' : ' off'}" title="${f.online ? 'Online' : 'Offline'}"></i><button type="button" class="mini" data-friend-send="${escapeHtml(f.name)}">Send</button><button type="button" class="mini ghost" data-friend-remove="${escapeHtml(f.name)}" aria-label="Remove ${escapeHtml(f.name)}">✕</button></div>`).join('') : '<p class="muted">No friends yet. Add one by name, or from a pilot you just played.</p>';
  const recent = (profile.recent || []).filter((name) => !(profile.friends || []).some((f) => f.toLowerCase() === name.toLowerCase())).slice(0, 6);
  return `<div class="shop-wallet">
    <div class="wallet-tiles"><div class="panel tile"><small>Balance</small><b>${coins(profile.coins)}</b></div><div class="panel tile"><small>Today</small><b><span class="good">+${today.in.toLocaleString('en')}</span> <span class="bad">-${today.out.toLocaleString('en')}</span></b></div><div class="panel tile"><small>Last 7 days</small><b class="${week >= 0 ? 'good' : 'bad'}">${week >= 0 ? '+' : ''}${week.toLocaleString('en')}</b></div></div>
    <div class="panel wallet-chart"><p class="eyebrow">14 days <small><i class="key in"></i>in <i class="key out"></i>out</small></p><div class="days">${chart}</div></div>
    <div class="panel"><p class="eyebrow">Where coins came from</p>${barList(sorted(stats.in))}<p class="eyebrow sub">Where they went</p>${barList(sorted(stats.out))}</div>
    <div class="panel"><p class="eyebrow">Friends <small>${(friends || []).filter((f) => f.online).length} online</small></p>${friendRows}
      <div class="room-row-input friend-add"><input id="friend-name" maxlength="32" placeholder="Add by username" value="${escapeHtml(friendName)}" autocomplete="off" spellcheck="false" /><button type="button" data-friend-add-input="1">Add</button></div>
      ${recent.length ? `<p class="recent-pilots"><small>Played with</small>${recent.map((name) => `<button type="button" class="mini" data-friend-add="${escapeHtml(name)}">+ ${escapeHtml(name)}</button>`).join('')}</p>` : ''}</div>
    <div class="panel"><p class="eyebrow">Send coins</p>
      <label class="field">Username<input id="send-to" maxlength="32" autocomplete="off" spellcheck="false" value="${escapeHtml(wallet.to)}" placeholder="Their Krosshair name" /></label>
      ${card}
      <label class="field">Amount<input id="send-amount" type="number" min="1" step="1" value="${escapeHtml(wallet.amount)}" /></label>
      ${pilot?.you ? '<p class="muted">That’s you.</p>' : ''}
      <div class="button-row"><button type="button" data-send="1" class="${armed === sendKey ? 'armed' : ''}" ${canSend && !busy ? '' : 'disabled'}>${armed === sendKey ? `Confirm: ${amount} to ${escapeHtml(pilot.name)}` : 'Send'}</button></div></div>
    <div class="panel"><p class="eyebrow">History</p><div class="coin-log">${log}</div></div></div>`;
}
const avatarHtml = (who, size) => (who.avatar ? `<img class="avatar" src="${escapeHtml(who.avatar)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" />` : `<i class="avatar blank" style="width:${size}px;height:${size}px">${escapeHtml(who.name.slice(0, 1).toUpperCase())}</i>`);

// ------------------------------------------------------------------ page
function earnHtml() {
  return '<ul class="earn-list"><li><b>Win</b> 12 · vs bots 3</li><li><b>Top kills</b> 8</li><li><b>Player kill</b> 2, more for higher levels</li><li><b>Bot kill</b> 0.4</li><li><b>Contract</b> 5</li></ul>';
}
export function shopPageHtml() {
  if (!loggedIn()) return `<section class="page-wide shop-page"><p class="eyebrow">Shop</p><h1 class="page-title">Spend your <em>coins.</em></h1><div class="panel shop-locked"><p>Coins need a Discord login.</p><a class="discord-button" href="/auth/discord">Log in with Discord</a></div></section>`;
  // The shop opens on crates, so the big-drops list is fetched the first time it is drawn, not only on a tab click.
  if (tab === 'crates' && !dropsAsked && net.connected) { dropsAsked = true; net.send({ type: 'drops' }); }
  const body = tab === 'crates' ? cratesHtml() : tab === 'inventory' ? inventoryHtml() : tab === 'gear' ? gearHtml() : tab === 'charms' ? charmsHtml() : tab === 'games' ? gamesHtml() : tab === 'wallet' ? walletHtml() : skinsHtml();
  return `<section class="page-wide shop-page"><div class="shop-head"><div><p class="eyebrow">Shop</p><h1 class="page-title">Spend your <em>coins.</em></h1></div>
      <div class="panel balance"><small>Balance</small><b>${coins(game.profile.coins)}</b><details><summary>How to earn</summary>${earnHtml()}</details></div></div>
    <div class="segmented shop-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" data-shop-tab="${id}" class="${id === tab ? 'active' : ''}" aria-selected="${id === tab}">${label}</button>`).join('')}</div>
    ${body}</section>`;
}
// What typed input looks like before a redraw, put back after it.
export function keepShopInput() { return { to: document.querySelector('#send-to')?.value, amount: document.querySelector('#send-amount')?.value, stake: document.querySelector('#game-stake')?.value, auto: document.querySelector('#crash-auto')?.value, friend: document.querySelector('#friend-name')?.value }; }

export function onShopClick(button) {
  const d = button.dataset;
  if (d.shopTab) {
    tab = d.shopTab; armed = null; tryOn = null; charmTry = null;
    if (tab === 'crates') net.send({ type: 'drops' });
    if (tab === 'wallet') net.send({ type: 'friends', action: 'list' });
    if (tab === 'games' && (crashGame?.phase === 'running' || running(plinko))) setTimeout(startGameFrame, 0);
    play('ui');
    return true;
  }
  // Gear and charms: try on, equip, buy (twice to confirm).
  if (d.gearKind && !d.gear) { gearKind = d.gearKind; tryOn = null; armed = null; play('ui'); return true; }
  if (d.try) { tryOn = d.try === game.look[lookKey(gearKind)] ? null : d.try; play('ui'); return true; }
  if (d.tryReset) { tryOn = null; play('uiBack'); return true; }
  if (d.gearEquip || d.charmEquip) {
    const kind = d.charmEquip ? 'charm' : gearKind;
    game.look[lookKey(kind)] = d.gearEquip || d.charmEquip;
    tryOn = null; charmTry = null;
    ctx.saveLook(); play('ready');
    return true;
  }
  if (d.gearBuy || d.charmBuy) {
    const kind = d.charmBuy ? 'charm' : gearKind, id = d.gearBuy || d.charmBuy;
    const item = COSMETICS[kind].find((entry) => entry.id === id);
    if (game.profile.coins < item.price) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; }
    const key = `gear:${kind}:${id}`;
    if (d.charmBuy) charmTry = id; else tryOn = id;
    if (armed !== key) { armed = key; play('ui'); return true; }
    request({ type: 'shop', action: 'gear', kind, id });
    return true;
  }
  if (d.charmTry) { charmTry = d.charmTry === game.look.charm ? null : d.charmTry; play('ui'); return true; }
  if (d.charmGun) { charmWeapon = d.charmGun; play('ui'); return true; }
  // Games.
  if (d.crashStart) {
    if (!(stake >= STAKE.min && stake <= STAKE.max && Number.isInteger(stake))) { ctx.toast(`Stake ${STAKE.min} to ${STAKE.max}.`, 'warn'); play('deny'); return true; }
    if (stake > game.profile.coins) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; }
    const auto = Number(crashAuto);
    request({ type: 'crash', action: 'start', stake, auto: auto >= CRASH.minAuto ? auto : null });
    return true;
  }
  if (d.crashOut) { net.send({ type: 'crash', action: 'out' }); play('ui'); return true; }
  if (d.hilo) {
    if (!(stake >= STAKE.min && stake <= STAKE.max && Number.isInteger(stake)) || stake > game.profile.coins) { ctx.toast(stake > game.profile.coins ? 'Not enough coins.' : `Stake ${STAKE.min} to ${STAKE.max}.`, 'warn'); play('deny'); return true; }
    request({ type: 'game', game: 'hilo', stake, pick: d.hilo });
    play('ready');
    return true;
  }
  // Friends.
  if (d.friendAdd || d.friendAddInput) {
    const name = d.friendAdd || document.querySelector('#friend-name')?.value.trim();
    if (!name) return true;
    net.send({ type: 'friends', action: 'add', name });
    play('ui');
    return true;
  }
  if (d.friendRemove) { net.send({ type: 'friends', action: 'remove', name: d.friendRemove }); play('uiBack'); return true; }
  if (d.friendSend) { const box = document.querySelector('#send-to'); if (box) box.value = d.friendSend; wallet = { to: d.friendSend, amount: wallet.amount, pilot: undefined, looking: true }; net.send({ type: 'lookup', name: d.friendSend }); play('ui'); setTimeout(() => document.querySelector('#send-amount')?.focus(), 50); return true; }
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
  if (d.crate) { crateId = d.crate; reveal = null; crate = null; play('ui'); return true; }
  if (d.rarity) { rarityFilter = d.rarity; play('ui'); return true; }
  if (d.openCrate) {
    const chosen = CRATES[d.openCrate], count = Number(d.count) === 5 ? 5 : 1;
    if (game.profile.coins < chosen.cost * count) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return true; }
    crateId = chosen.id; crate = null; reveal = null;
    request({ type: 'shop', action: 'crate', crate: chosen.id, count });
    play('ready');
    return true;
  }
  if (d.daily) { crateId = DAILY_CRATE.crate; crate = null; reveal = null; request({ type: 'shop', action: 'crate', crate: DAILY_CRATE.crate, count: 1, free: true }); play('ready'); return true; }
  if (d.skip) { land(); return true; }
  if (d.reveal !== undefined && reveal) { reveal.index = Number(d.reveal); play('ui'); return true; }
  if (d.equipDrop !== undefined && reveal) { const drop = reveal.drops[Number(d.equipDrop)]; equip(drop.weapon, drop.finish); play('ready'); return true; }
  if (d.closeReveal) { reveal = null; crate = null; play('uiBack'); return true; }
  if (d.inv) {
    const [weapon, finish] = d.inv.split(':');
    if (!tradeMode) { inventoryPick = { weapon, finish }; armed = null; play('ui'); return true; }
    const index = trade.findIndex((item) => item.weapon === weapon && item.finish === finish);
    const rarity = finishInfo(finish).rarity;
    if (index >= 0) trade.splice(index, 1);
    else if (rarity === 'mythic') { ctx.toast('Mythic is as high as it goes.', 'warn'); play('deny'); return true; }
    else if (trade.length && finishInfo(trade[0].finish).rarity !== rarity) { ctx.toast('All five must be the same rarity.', 'warn'); play('deny'); return true; }
    else if (trade.length < TRADE_UP) trade.push({ weapon, finish });
    play('ui');
    return true;
  }
  if (d.invEquip && inventoryPick) { equip(inventoryPick.weapon, inventoryPick.finish); play('ready'); return true; }
  if (d.scrap && inventoryPick) {
    const key = `scrap:${skinKey(inventoryPick)}`;
    if (armed !== key) { armed = key; play('ui'); return true; }
    request({ type: 'shop', action: 'scrap', ...inventoryPick });
    return true;
  }
  if (d.tradeStart) { tradeMode = true; trade = []; play('ui'); return true; }
  if (d.tradeCancel) { tradeMode = false; trade = []; play('uiBack'); return true; }
  if (d.tradeGo && trade.length === TRADE_UP) { request({ type: 'shop', action: 'tradeup', items: trade }); play('ready'); return true; }
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
  if (input.id === 'crash-auto') { crashAuto = input.value; return false; }
  if (input.id === 'friend-name') { friendName = input.value; return false; }
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
  const auto = document.querySelector('#crash-auto'), friend = document.querySelector('#friend-name');
  if (auto && kept.auto !== undefined) auto.value = kept.auto;
  if (friend && kept.friend !== undefined) friend.value = kept.friend;
  if (tab === 'games' && (crashGame?.phase === 'running' || running(plinko))) startGameFrame();
}
