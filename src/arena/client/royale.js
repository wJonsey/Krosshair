// Battle royale on the client: floor loot in the world, the storm wall, and the royale HUD (pilots
// left, the storm clock, a radar with the safe circle, the whole island on the map key).
// Also the drop map before the match, airdrops, the way back to the safe zone, and the cards you get
// when you are knocked out or win. It brings its own styles and HUD elements.
import * as THREE from 'three';
import { ARMOR, GADGETS, WEAPONS } from '../shared/constants.js';
import { LOOT_TABLE, POWERS, ROYALE, ROYALE_RARITIES, STORM, aircraftAt, lootInSight, royaleWeapon, weaponRarity, weaponTier } from '../shared/royale.js';
import { bus, game } from './state.js';
import { net } from './net.js';
import { bindLabel, held, isBound } from './input.js';
import { play } from './audio.js';
import { buildWeapon, stripHands } from './guns.js';
import { weaponArt } from './weaponart.js';

const TOP_GUNS = new Set(LOOT_TABLE[2].pool), MID_GUNS = new Set(LOOT_TABLE[1].pool);
const LOOT_COLOURS = { common: ROYALE_RARITIES.common.color, rare: ROYALE_RARITIES.rare.color, epic: ROYALE_RARITIES.epic.color, legendary: ROYALE_RARITIES.legendary.color, mid: '#5fa8ff', top: '#ffb547', armor: '#6ce6d1', helmet: '#6ce6d1', heal: '#7dff8a', gadget: '#b07cff', ammo: '#ff9a3a', power: '#ff5fd2' };
const lootKind = (item) => (item.kind === 'weapon' ? (item.rarity || weaponRarity(item.id)) : item.kind);
const lootLabel = (item) => (item.kind === 'weapon' ? WEAPONS[item.id]?.short || item.id : item.kind === 'armor' ? ARMOR[item.id]?.name : item.kind === 'helmet' ? 'Helmet' : item.kind === 'gadget' ? GADGETS[item.id]?.name : item.kind === 'heal' ? 'Medkit' : item.kind === 'power' ? POWERS[item.id]?.name : 'Ammo');

const CSS = `
.royale-note { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60; max-width: min(460px, calc(100vw - 32px)); padding: 14px 16px 14px 18px; background: rgba(10, 14, 18, .92); border: 1px solid rgba(255, 181, 71, .45); border-left: 3px solid #ffb547; color: #e6edf1; font: 400 13px/1.5 'Geist', system-ui, sans-serif; display: none; gap: 14px; align-items: flex-start; }
.royale-note.on { display: flex; }
.royale-note b { display: block; font: 500 11px 'Geist Mono', monospace; letter-spacing: .14em; color: #ffb547; margin-bottom: 4px; }
.royale-note button { flex: none; background: none; border: 1px solid rgba(230, 237, 241, .25); color: #e6edf1; font: 500 11px 'Geist Mono', monospace; letter-spacing: .1em; padding: 6px 10px; cursor: pointer; }
body.royale-mode .scorebar, body.royale-mode .minimap-wrap, body.royale-mode #scoreboard, body.royale-mode .controls, body.royale-mode #hud .credits { display: none !important; }
.royale-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--mono); color: var(--frost); }
.royale-top { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; }
.royale-top div { padding: 7px 14px; background: var(--hud-glass); backdrop-filter: blur(8px); font: 500 11px var(--mono); letter-spacing: .14em; text-transform: uppercase; }
.royale-top b { margin-left: 8px; font: 400 18px var(--display); letter-spacing: 0; }
.royale-storm { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); padding: 6px 14px; background: rgba(60, 20, 90, .55); font: 500 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.royale-storm.closing { background: rgba(140, 40, 170, .7); }
.royale-outside { position: absolute; inset: 0; box-shadow: inset 0 0 160px 40px rgba(150, 50, 220, .55); opacity: 0; transition: opacity .3s; }
.royale-outside.on { opacity: 1; animation: storm-pulse 1.2s ease-in-out infinite; }
@keyframes storm-pulse { 50% { opacity: .6; } }
.royale-radar { position: absolute; left: 16px; top: 16px; width: 190px; height: 190px; background: rgba(10, 14, 18, .6); border: 1px solid rgba(230, 237, 241, .22); }
.royale-map { position: absolute; left: 50%; top: 50%; width: min(640px, 80vh); height: min(640px, 80vh); transform: translate(-50%, -50%); background: rgba(10, 14, 18, .88); border: 1px solid rgba(230, 237, 241, .3); display: none; }
.royale-map.on { display: block; }
/* What you are carrying. A panel down the right, the way a battle royale does it, and a bay down the
   left to throw things into. The HUD is pointer-events: none, so anything you click has to say so. */
.royale-kit { position: absolute; inset: 0; display: none; z-index: 28; pointer-events: auto; }
.royale-kit.on { display: block; }
.royale-kit .kit-panel { position: absolute; right: 0; top: 0; bottom: 0; width: min(420px, 38vw); padding: 22px 22px 18px; overflow-y: auto; background: linear-gradient(90deg, rgba(7, 9, 12, .82), rgba(7, 9, 12, .94)); backdrop-filter: blur(14px); border-left: 1px solid rgba(230, 237, 241, .2); }
.royale-kit .kit-panel::before { content: ''; position: absolute; inset: 14px 14px 14px 10px; pointer-events: none; --c: rgba(230, 237, 241, .5); --l: 11px;
  background: linear-gradient(var(--c), var(--c)) 0 0 / var(--l) 1px no-repeat, linear-gradient(var(--c), var(--c)) 0 0 / 1px var(--l) no-repeat,
    linear-gradient(var(--c), var(--c)) 100% 0 / var(--l) 1px no-repeat, linear-gradient(var(--c), var(--c)) 100% 0 / 1px var(--l) no-repeat,
    linear-gradient(var(--c), var(--c)) 0 100% / var(--l) 1px no-repeat, linear-gradient(var(--c), var(--c)) 0 100% / 1px var(--l) no-repeat,
    linear-gradient(var(--c), var(--c)) 100% 100% / var(--l) 1px no-repeat, linear-gradient(var(--c), var(--c)) 100% 100% / 1px var(--l) no-repeat; }
.royale-kit .kit-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
.royale-kit .kit-head h3 { margin: 0; font: 400 22px var(--display); letter-spacing: .08em; text-transform: uppercase; }
.royale-kit .kit-head small, .royale-kit .kit-eyebrow { color: var(--haze); font: 500 9px var(--mono); letter-spacing: .18em; text-transform: uppercase; }
.royale-kit .kit-eyebrow { display: block; margin: 0 0 8px; }
.royale-kit section { margin-bottom: 18px; }
.royale-kit .kit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
/* A tile: rarity down the side, the piece itself, what is left in it in the corner. */
.royale-kit .tile { position: relative; aspect-ratio: 1; display: grid; place-items: center; padding: 6px; background: rgba(230, 237, 241, .05); border: 1px solid rgba(230, 237, 241, .16); border-left: 3px solid var(--tier, rgba(230, 237, 241, .3)); cursor: grab; user-select: none; }
.royale-kit .tile.on { background: rgba(255, 181, 71, .14); border-color: var(--signal); }
.royale-kit .tile.empty { cursor: default; border-left-color: rgba(230, 237, 241, .12); opacity: .45; }
.royale-kit .tile img { width: 100%; height: auto; pointer-events: none; }
.royale-kit .tile i { font-style: normal; font-size: 26px; color: var(--tier, var(--frost)); }
.royale-kit .tile b { position: absolute; right: 5px; bottom: 4px; font: 500 11px var(--mono); color: var(--frost); text-shadow: 0 1px 3px #000; }
.royale-kit .tile span.slot { position: absolute; left: 6px; top: 4px; font: 500 8px var(--mono); letter-spacing: .12em; color: var(--haze); }
.royale-kit .kit-foot { margin-top: 6px; color: var(--haze); font: 500 9px var(--mono); letter-spacing: .14em; text-transform: uppercase; }
/* The card for whatever is picked, over on the left where the screen is empty. */
.royale-kit .kit-card { position: absolute; left: 34px; top: 84px; width: min(340px, 30vw); padding: 14px 16px; background: rgba(7, 9, 12, .86); backdrop-filter: blur(10px); border-left: 3px solid var(--tier, var(--frost)); }
.royale-kit .kit-card small { display: block; color: var(--tier, var(--haze)); font: 500 9px var(--mono); letter-spacing: .18em; text-transform: uppercase; }
.royale-kit .kit-card h4 { margin: 5px 0 3px; font: 400 21px/1.1 var(--display); text-transform: uppercase; }
.royale-kit .kit-card p { margin: 0 0 10px; color: var(--haze); font: 400 12px var(--body); }
.royale-kit .kit-card .stat { display: grid; grid-template-columns: 70px 1fr 48px; align-items: center; gap: 8px; margin: 5px 0; color: var(--haze); font: 500 9px var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.royale-kit .kit-card .stat i { display: block; height: 4px; background: rgba(230, 237, 241, .14); position: relative; font-style: normal; }
.royale-kit .kit-card .stat i::after { content: ''; position: absolute; inset: 0; width: var(--v); background: var(--frost); }
.royale-kit .kit-card .stat em { font-style: normal; text-align: right; color: var(--frost); }
/* Drag a tile over here to put it down. */
.royale-kit .kit-bin { position: absolute; left: 0; top: 0; bottom: 0; width: 42%; display: none; place-items: center; border-right: 1px dashed rgba(230, 237, 241, .25); }
.royale-kit.dragging .kit-bin { display: grid; }
.royale-kit .kit-bin > div { padding: 26px 34px; border: 1px dashed rgba(230, 237, 241, .35); color: var(--haze); font: 500 12px var(--mono); letter-spacing: .2em; text-transform: uppercase; text-align: center; }
.royale-kit .kit-bin.hot { background: rgba(255, 181, 71, .1); border-right-color: var(--signal); }
.royale-kit .kit-bin.hot > div { border-color: var(--signal); color: var(--signal); }
.royale-kit .kit-ghost { position: fixed; z-index: 60; width: 72px; height: 72px; display: grid; place-items: center; padding: 6px; pointer-events: none; background: rgba(7, 9, 12, .9); border: 1px solid var(--tier, var(--frost)); transform: translate(-50%, -50%); }
.royale-kit .kit-ghost img { width: 100%; }
.royale-kit .kit-ghost i { font-style: normal; font-size: 26px; color: var(--tier, var(--frost)); }
.royale-alt { position: absolute; right: 26px; top: 42%; display: none; min-width: 120px; padding: 10px 14px; background: var(--hud-glass); backdrop-filter: blur(8px); border-right: 3px solid var(--signal); text-align: right; }
.royale-alt.on { display: block; }
.royale-alt b { display: block; color: var(--frost); font: 400 30px/1 var(--display); }
.royale-alt span { display: block; margin-top: 4px; color: var(--haze); font: 500 10px var(--mono); letter-spacing: .2em; text-transform: uppercase; }
.royale-drop { position: absolute; inset: 0; display: none; grid-template-rows: auto 1fr auto; justify-items: center; gap: 12px; padding: 64px 16px 24px; background: rgba(6, 9, 12, .94); pointer-events: auto; cursor: crosshair; z-index: 30; }
.royale-drop.on { display: grid; }
.royale-drop header { text-align: center; }
.royale-drop header small { color: var(--ally); font: 500 11px var(--mono); letter-spacing: .22em; text-transform: uppercase; }
.royale-drop h2 { margin: 6px 0 0; font: 400 clamp(22px, 3.4vw, 40px)/1 var(--display); text-transform: uppercase; }
.royale-drop h2 b { color: var(--signal); font-weight: 400; }
.royale-drop canvas { height: 100%; max-height: min(74vh, 90vw); aspect-ratio: 1; border: 1px solid rgba(230, 237, 241, .3); min-height: 0; }
.royale-drop footer { color: var(--haze); font: 500 11px var(--mono); letter-spacing: .14em; text-transform: uppercase; }
.royale-drop footer b { color: var(--frost); font-weight: 500; }
`;

export function initRoyale({ arena, hud, player }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'royale-hud hidden';
  root.innerHTML = '<div class="royale-outside"></div><div class="royale-top"><div>Alive<b id="royale-alive">0</b></div><div>Kills<b id="royale-kills">0</b></div></div><div class="royale-storm" id="royale-storm"></div><div class="royale-way" id="royale-way"><i></i><span></span></div><div class="royale-swap" id="royale-swap"></div><div class="royale-alt" id="royale-alt"><b></b><span></span></div><div class="royale-powers" id="royale-powers"></div><div class="royale-card" id="royale-card"></div><canvas class="royale-radar" width="380" height="380"></canvas><canvas class="royale-map" width="1280" height="1280"></canvas><div class="royale-kit" id="royale-kit"><div class="kit-bin" id="kit-bin"><div>Drag here<br>to drop</div></div><div class="kit-card" id="kit-card"></div><aside class="kit-panel"><div class="kit-head"><h3>Carrying</h3><small id="kit-close"></small></div><div id="kit-body"></div></aside></div><div class="royale-drop" id="royale-drop"><header><small>Battle royale · Kestrel Island</small><h2>Pick your drop <b id="royale-drop-clock"></b></h2></header><canvas width="1280" height="1280"></canvas><footer id="royale-drop-foot"></footer></div>';
  document.querySelector('#hud').append(root);
  const radar = root.querySelector('.royale-radar'), bigMap = root.querySelector('.royale-map');
  const alive = root.querySelector('#royale-alive'), kills = root.querySelector('#royale-kills'), stormLabel = root.querySelector('#royale-storm'), outsideFx = root.querySelector('.royale-outside');

  const way = root.querySelector('#royale-way'), swap = root.querySelector('#royale-swap'), card = root.querySelector('#royale-card');
  const alt = root.querySelector('#royale-alt'), powersBox = root.querySelector('#royale-powers');
  const kit = root.querySelector('#royale-kit');

  // ---- what you are carrying, and putting it down
  // A panel down the right, and a bay down the left to throw things into. There is no Drop button: you
  // drag a tile out of the panel and let go on the left, which is one gesture rather than a hunt for a
  // small target. The scoreboard key opens it, royale having no scoreboard to put there.
  const bin = root.querySelector('#kit-bin'), kitCard = root.querySelector('#kit-card'), kitBody = root.querySelector('#kit-body');
  let kitOpen = false, kitPick = null, drag = null;

  // Everything carried, as one list, so the tiles and the card read from the same place.
  function carrying() {
    const you = game.you;
    if (!you) return [];
    const out = [];
    for (const [slot, label] of [['primary', 'PRI'], ['sidearm', 'SEC']]) {
      const id = you.weapons?.[slot];
      if (!id) { out.push({ key: slot, slot, label, empty: true }); continue; }
      const rarity = ROYALE_RARITIES[you.rarity?.[slot] || weaponRarity(id)] || ROYALE_RARITIES.common;
      out.push({ key: slot, slot, label, kind: 'weapon', id, rarity, weapon: royaleWeapon(WEAPONS[id], rarity.id) || WEAPONS[id], ammo: you.ammo?.[slot], drop: { slot } });
    }
    const blade = WEAPONS[you.weapons?.melee] || WEAPONS.knife;
    out.push({ key: 'melee', slot: 'melee', label: 'BLD', kind: 'weapon', id: blade.id, rarity: ROYALE_RARITIES.common, weapon: blade });
    for (const id of you.gadgets || []) out.push({ key: `g:${id}`, label: 'GDT', kind: 'gadget', id, gadget: GADGETS[id], drop: { gadget: id } });
    return out;
  }

  const tileHtml = (item) => {
    if (item.empty) return `<div class="tile empty"><span class="slot">${item.label}</span></div>`;
    const tier = item.rarity?.color || 'var(--frost)';
    const face = item.kind === 'gadget' ? `<i>${item.gadget.icon}</i>` : `<img src="${weaponArt(item.id)}" alt="" />`;
    const count = item.ammo ? `<b>${item.ammo.mag}/${item.ammo.reserve}</b>` : '';
    return `<div class="tile${kitPick === item.key ? ' on' : ''}" style="--tier:${tier}" data-kit="${item.key}" draggable="false"><span class="slot">${item.label}</span>${face}${count}</div>`;
  };

  function cardHtml(item) {
    if (!item || item.empty) return '';
    if (item.kind === 'gadget') return `<small>Gadget</small><h4>${item.gadget.name}</h4><p>${item.gadget.desc}</p>`;
    const weapon = item.weapon, tier = item.rarity?.color || 'var(--frost)';
    const bar = (value) => `<i style="--v:${Math.round(Math.max(0.04, Math.min(1, value)) * 100)}%"></i>`;
    const rows = [
      ['Damage', `${weapon.damage}${weapon.pellets > 1 ? ` × ${weapon.pellets}` : ''}`, (weapon.damage * weapon.pellets) / 130],
      ['Fire rate', `${Math.round(60 / weapon.cooldown)}`, 0.09 / weapon.cooldown + 0.04],
      ['Range', weapon.falloff ? `${weapon.falloff[0]} m` : 'Full', weapon.falloff ? weapon.falloff[1] / 90 : 1],
      ['Magazine', `${weapon.mag}`, Math.min(1, weapon.mag / 60)],
    ];
    return `<small style="--tier:${tier}">${item.rarity.name} · ${weapon.tag}</small><h4>${weapon.name}</h4>
      ${rows.map(([label, text, value]) => `<div class="stat"><span>${label}</span>${bar(value)}<em>${text}</em></div>`).join('')}`;
  }

  function drawKit() {
    const items = carrying();
    if (!items.some((item) => item.key === kitPick)) kitPick = items.find((item) => !item.empty)?.key || null;
    const pick = items.find((item) => item.key === kitPick);
    const guns = items.filter((item) => item.kind !== 'gadget');
    const gadgets = items.filter((item) => item.kind === 'gadget');
    const you = game.you || {};
    kitBody.innerHTML = `<section><span class="kit-eyebrow">Equipment</span><div class="kit-grid">${guns.map(tileHtml).join('')}</div></section>
      <section><span class="kit-eyebrow">Gadgets</span><div class="kit-grid">${gadgets.length ? gadgets.map(tileHtml).join('') : '<div class="tile empty"><span class="slot">GDT</span></div>'}</div></section>
      <section><span class="kit-eyebrow">Armour</span><div class="kit-grid">
        <div class="tile empty" style="opacity:1"><span class="slot">PLT</span><i>${you.armor > 0 ? '▣' : '▢'}</i><b>${Math.round(you.armor || 0)}</b></div>
        <div class="tile empty" style="opacity:${you.helmet ? 1 : 0.45}"><span class="slot">HLM</span><i>${you.helmet ? '⬢' : '⬡'}</i></div>
      </div></section>
      <p class="kit-foot">Drag a piece left to put it down. It keeps what is in it.</p>`;
    kitCard.innerHTML = cardHtml(pick);
    kitCard.style.setProperty('--tier', pick?.rarity?.color || 'var(--frost)');
    kitCard.style.display = pick ? 'block' : 'none';
    root.querySelector('#kit-close').textContent = `${bindLabel('scoreboard')} to close`;
  }

  function showKit(open) {
    if (open === kitOpen) return;
    kitOpen = open;
    hud.royaleKitOpen = open;
    kit.classList.toggle('on', open);
    endDrag(false);
    if (open) { drawKit(); document.exitPointerLock?.(); play('ui'); } else { play('uiBack'); player.lock(); }
  }

  // Dragging is done by hand rather than with the browser's drag and drop, which needs a data transfer
  // and fights the pointer lock this screen has just let go of.
  function endDrag(dropped) {
    if (drag?.ghost) drag.ghost.remove();
    drag = null;
    kit.classList.remove('dragging');
    bin.classList.remove('hot');
    if (dropped) play('ready');
  }
  const overBin = (event) => event.clientX < innerWidth * 0.42;

  kit.addEventListener('mousedown', (event) => {
    const tile = event.target.closest('[data-kit]');
    if (!tile) return;
    event.preventDefault();
    const item = carrying().find((entry) => entry.key === tile.dataset.kit);
    if (!item || item.empty) return;
    kitPick = item.key;
    drawKit();
    if (!item.drop) return;   // the blade stays, so there is nothing to drag it to
    const ghost = document.createElement('div');
    ghost.className = 'kit-ghost';
    ghost.style.setProperty('--tier', item.rarity?.color || 'var(--frost)');
    ghost.innerHTML = item.kind === 'gadget' ? `<i>${item.gadget.icon}</i>` : `<img src="${weaponArt(item.id)}" alt="" />`;
    ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`;
    kit.append(ghost);
    drag = { item, ghost };
    kit.classList.add('dragging');
  });
  addEventListener('mousemove', (event) => {
    if (!drag) return;
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    bin.classList.toggle('hot', overBin(event));
  });
  addEventListener('mouseup', (event) => {
    if (!drag) return;
    const item = drag.item;
    const put = overBin(event);
    endDrag(put);
    if (put) net.send({ type: 'royale-toss', ...item.drop });
  });

  bus.on('you', () => {
    if (!kitOpen) return;
    if (!game.you?.alive) { showKit(false); return; }   // nothing to carry once you are down
    drawKit();
  });
  bus.on('key', (code) => {
    if (game.screen !== 'game' || !game.room?.royale || game.watching) return;   // a watcher carries nothing
    if (isBound('scoreboard', code)) showKit(!kitOpen);
    else if (code === 'Escape' && kitOpen) showKit(false);
  });
  const dropScreen = root.querySelector('#royale-drop'), dropMap = dropScreen.querySelector('canvas'), dropClock = root.querySelector('#royale-drop-clock'), dropFoot = root.querySelector('#royale-drop-foot');
  const state = { storm: null, alive: 0, loot: new Map(), group: null, wall: null, beamsDirty: true, airdrops: new Map(), drop: null, look: null, fWas: false, powers: new Map(), pads: null, padsMap: null, cardUntil: 0, layer: null, layerMap: null };
  const active = () => Boolean(game.room?.royale) && arena.map?.royale;

  // ---- loot in the world. Up close every pickup is the real thing: the gun itself lying on its side, a plate
  // carrier, a helmet, a medkit, an ammo tin. Building and drawing those for 400 items would be slow, so a
  // model only exists while you are within NEAR metres of it. Further out, every pickup is one instance in a
  // single batch of coloured light beams: the whole island's loot in one draw call.
  const NEAR = 42, MAX_LOOT = 1200;
  const flat = (color, rough = 0.6, metal = 0.2, glow = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: glow ? color : '#000000', emissiveIntensity: glow, flatShading: true });
  const PROP = { olive: flat('#4d5a3a', 0.85, 0.05), dark: flat('#1c2228', 0.7, 0.2), steel: flat('#7a8793', 0.35, 0.7), white: flat('#e8ecef', 0.6, 0.05), red: flat('#d8343a', 0.5, 0.1, 0.35), brass: flat('#c19a3c', 0.3, 0.8), tan: flat('#9a8960', 0.9, 0), violet: flat('#b07cff', 0.4, 0.3, 0.5), pink: flat('#ff5fd2', 0.4, 0.2, 0.7), teal: flat('#6ce6d1', 0.4, 0.2, 0.6) };
  const bit = (group, geometry, material, position, rotation) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); group.add(mesh); return mesh; };
  const cube = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const PROPS = {
    armor: (item) => { const g = new THREE.Group(), heavy = item.id === 'heavy', cloth = heavy ? PROP.dark : PROP.olive; bit(g, cube(0.4, 0.46, 0.14), cloth, [0, 0.25, 0]); bit(g, cube(0.3, 0.26, 0.05), PROP.steel, [0, 0.29, -0.09]); for (const x of [-0.13, 0.13]) bit(g, cube(0.09, 0.12, 0.1), cloth, [x, 0.52, 0]); for (const x of [-0.1, 0, 0.1]) bit(g, cube(0.08, 0.12, 0.05), heavy ? PROP.olive : PROP.tan, [x, 0.1, -0.095]); g.rotation.x = -0.35; return g; },
    helmet: () => { const g = new THREE.Group(); bit(g, new THREE.SphereGeometry(0.19, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.56), PROP.olive, [0, 0.06, 0]); bit(g, cube(0.22, 0.03, 0.08), PROP.olive, [0, 0.12, -0.18], [0.3, 0, 0]); bit(g, cube(0.05, 0.03, 0.3), PROP.dark, [0, 0.245, 0]); for (const x of [-0.17, 0.17]) bit(g, cube(0.03, 0.12, 0.13), PROP.dark, [x, 0.06, 0.02]); return g; },
    heal: () => { const g = new THREE.Group(); bit(g, cube(0.42, 0.26, 0.28), PROP.white, [0, 0.13, 0]); bit(g, cube(0.44, 0.05, 0.3), PROP.red, [0, 0.2, 0]); bit(g, cube(0.16, 0.05, 0.005), PROP.red, [0, 0.1, -0.142]); bit(g, cube(0.05, 0.16, 0.005), PROP.red, [0, 0.1, -0.142]); bit(g, cube(0.14, 0.03, 0.04), PROP.dark, [0, 0.285, 0]); return g; },
    ammo: () => { const g = new THREE.Group(); bit(g, cube(0.36, 0.22, 0.2), PROP.olive, [0, 0.11, 0]); bit(g, cube(0.38, 0.04, 0.22), PROP.dark, [0, 0.235, 0]); bit(g, cube(0.12, 0.03, 0.03), PROP.steel, [0, 0.275, 0]); for (let i = 0; i < 4; i += 1) bit(g, new THREE.CylinderGeometry(0.014, 0.014, 0.1, 6), PROP.brass, [0.26 + (i % 2) * 0.04, 0.015, -0.06 + i * 0.04], [0, 0, Math.PI / 2]); return g; },
    gadget: () => { const g = new THREE.Group(); bit(g, cube(0.34, 0.12, 0.26), PROP.dark, [0, 0.06, 0]); bit(g, cube(0.3, 0.02, 0.22), PROP.steel, [0, 0.13, 0]); bit(g, cube(0.1, 0.03, 0.06), PROP.violet, [0, 0.15, 0]); bit(g, new THREE.CylinderGeometry(0.008, 0.008, 0.22, 5), PROP.steel, [0.13, 0.24, 0.09]); return g; },
    power: (item) => { const g = new THREE.Group(), glow = item.id === 'jump' ? PROP.teal : PROP.pink; if (item.id === 'jump') { for (const x of [-0.1, 0.1]) { bit(g, cube(0.13, 0.2, 0.18), PROP.dark, [x, 0.12, 0.04]); bit(g, cube(0.13, 0.09, 0.3), PROP.dark, [x, 0.045, -0.04]); bit(g, cube(0.135, 0.025, 0.31), glow, [x, 0.012, -0.04]); } } else { bit(g, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), PROP.white, [0, 0.12, 0], [0, 0, Math.PI / 2 - 0.3]); bit(g, new THREE.CylinderGeometry(0.037, 0.037, 0.18, 8), glow, [0.01, 0.123, 0], [0, 0, Math.PI / 2 - 0.3]); bit(g, new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5), PROP.steel, [0.2, 0.18, 0], [0, 0, Math.PI / 2 - 0.3]); } return g; },
  };
  // One template per kind of thing; every copy on the floor shares its geometry and materials.
  const templates = new Map();
  function modelFor(item) {
    const key = item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'power' ? `${item.kind}:${item.id}` : item.kind;
    if (!templates.has(key)) {
      let model;
      if (item.kind === 'weapon') {
        model = stripHands(buildWeapon(item.id, LOOT_COLOURS[lootKind(item)]));
        model.userData = {};
        model.traverse((node) => { node.userData = {}; node.frustumCulled = true; });
        // Lying on its side, centred on its own length.
        const box = new THREE.Box3().setFromObject(model), centre = box.getCenter(new THREE.Vector3());
        const wrap = new THREE.Group(); model.position.sub(centre); wrap.add(model); wrap.rotation.z = Math.PI / 2; wrap.position.y = 0.06;
        const outer = new THREE.Group(); outer.add(wrap); outer.scale.setScalar(1.25);
        model = outer;
      } else model = (PROPS[item.kind] || PROPS.ammo)(item);
      templates.set(key, model);
    }
    return templates.get(key).clone(true);
  }
  const ringGeometry = new THREE.RingGeometry(0.5, 0.64, 24).rotateX(-Math.PI / 2);
  const ringMaterials = {};
  const ringFor = (kind) => (ringMaterials[kind] ||= new THREE.MeshBasicMaterial({ color: LOOT_COLOURS[kind], transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  // The far batch: a thin column of light per pickup, coloured by what it is.
  const beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 6, 1, true).translate(0, 3.2, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAX_LOOT);
  beams.count = 0; beams.frustumCulled = false;
  const beamColour = new THREE.Color(), beamAt = new THREE.Matrix4();
  function rebuildBeams() {
    let index = 0;
    for (const loot of state.loot.values()) {
      if (index >= MAX_LOOT) break;
      beams.setMatrixAt(index, beamAt.makeTranslation(loot.entry.x, loot.entry.y, loot.entry.z));
      beams.setColorAt(index, beamColour.set(LOOT_COLOURS[lootKind(loot.entry.item)]));
      index += 1;
    }
    beams.count = index;
    beams.instanceMatrix.needsUpdate = true;
    if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    state.beamsDirty = false;
  }
  const labels = new Map();
  function labelSprite(text, colour) {
    const key = `${text}|${colour}`;
    if (!labels.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 56;
      const c = canvas.getContext('2d');
      c.font = '500 26px "Geist Mono", monospace';
      const width = Math.min(250, c.measureText(text).width + 24);
      c.fillStyle = 'rgba(7,9,12,.75)'; c.fillRect(128 - width / 2, 8, width, 40);
      c.fillStyle = colour; c.fillRect(128 - width / 2, 8, 3, 40);
      c.fillStyle = '#e6edf1'; c.textAlign = 'center'; c.fillText(text.toUpperCase(), 130, 37);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      labels.set(key, new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false }));
    }
    const sprite = new THREE.Sprite(labels.get(key));
    sprite.scale.set(1.3, 0.28, 1);
    sprite.renderOrder = 15;
    return sprite;
  }
  function ensureGroup() {
    if (state.group && state.group.parent === arena.scene) return state.group;
    state.group = new THREE.Group();
    state.group.add(beams);
    arena.scene.add(state.group);
    return state.group;
  }
  function addLoot(entry) {
    if (state.loot.has(entry.id)) return;
    state.loot.set(entry.id, { entry, holder: null, mesh: null, label: null, phase: Math.random() * 6 });
    state.beamsDirty = true;
  }
  // Built when you come near, thrown away when you leave.
  function showNear(loot) {
    const kind = lootKind(loot.entry.item);
    const holder = new THREE.Group();
    holder.position.set(loot.entry.x, loot.entry.y, loot.entry.z);
    const mesh = new THREE.Group(); mesh.add(modelFor(loot.entry.item)); mesh.position.y = 0.32;
    const ring = new THREE.Mesh(ringGeometry, ringFor(kind)); ring.position.y = 0.04;
    const label = labelSprite(lootLabel(loot.entry.item) || '?', LOOT_COLOURS[kind]); label.position.y = 1.15; label.visible = false;
    holder.add(mesh, ring, label);
    ensureGroup().add(holder);
    Object.assign(loot, { holder, mesh, label });
  }
  function hideNear(loot) { loot.holder?.parent?.remove(loot.holder); loot.holder = null; loot.mesh = null; loot.label = null; }
  function removeLoot(id) {
    const loot = state.loot.get(id);
    if (!loot) return;
    hideNear(loot);
    state.loot.delete(id);
    state.beamsDirty = true;
  }
  function clearLoot() { for (const id of [...state.loot.keys()]) removeLoot(id); beams.count = 0; state.beamsDirty = true; }

  // ---- the storm: a tall glowing wall at the edge of the safe circle
  function ensureWall() {
    if (state.wall && state.wall.parent === arena.scene) return state.wall;
    const material = new THREE.MeshBasicMaterial({ color: '#a040ff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false });
    state.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), material);
    state.wall.renderOrder = 5;
    arena.scene.add(state.wall);
    return state.wall;
  }
  function circleAt(t) {
    const storm = state.storm;
    if (!storm) return null;
    const k = t <= storm.shrinkStart ? 0 : t >= storm.shrinkEnd ? 1 : (t - storm.shrinkStart) / (storm.shrinkEnd - storm.shrinkStart);
    return { x: storm.from.x + (storm.to.x - storm.from.x) * k, z: storm.from.z + (storm.to.z - storm.from.z) * k, r: storm.from.r + (storm.to.r - storm.from.r) * k };
  }

  // ---- messages
  // The mark placed from the air (client/deploy.js): shown on the maps until the next match.
  bus.on('royale-mark', (at) => { state.drop = { x: at.x, z: at.z }; });
  net.on('royale-flight', (message) => { state.flight = message.flight || null; });
  net.on('royale', (message) => {
    if (message.storm) state.storm = message.storm;
    if (Number.isFinite(message.alive)) state.alive = message.alive;
  });
  net.on('loot', (message) => { clearLoot(); message.loot.forEach(addLoot); });
  net.on('loot-add', (message) => message.loot.forEach(addLoot));
  net.on('loot-take', (message) => removeLoot(message.id));
  net.on('pickup', (message) => {
    hud.notice(message.text, message.refused ? 'warn' : 'good');
    play(message.refused ? 'deny' : 'buy', { volume: 0.5 });
    const power = POWERS[message.power];
    if (!power) return;
    const until = performance.now() + message.seconds * 1000;
    if (power.speed) { player.boost.speed = power.speed; player.boost.speedUntil = until; }
    if (power.jump) { player.boost.jump = power.jump; player.boost.jumpUntil = until; }
    state.powers.set(message.power, until);
  });
  bus.on('royale-landed', () => hud.banner('BOOTS DOWN', `Find a gun. ${bindLabel('interact')} picks things up.`, 'ROYALE', 'go', 3200));

  // ---- what a pickup is worth: numbers for the card you get when you look at one
  const rpm = (weapon) => Math.round(60 / weapon.cooldown);
  const STATS = [['Damage', (w) => w.damage * (w.pellets || 1), 130], ['Fire rate', rpm, 900], ['Range', (w) => w.falloff?.[0] ?? 100, 110], ['Magazine', (w) => w.mag, 100]];
  function lootCard(item) {
    const kind = lootKind(item), colour = LOOT_COLOURS[kind];
    const mine = game.you?.weapons || {};
    let head = '', body = '', can = true, verb = 'Pick up';
    if (item.kind === 'weapon') {
      const rarity = ROYALE_RARITIES[item.rarity || weaponRarity(item.id)] || ROYALE_RARITIES.common;
      const weapon = royaleWeapon(WEAPONS[item.id], rarity.id), held = royaleWeapon(WEAPONS[mine[weapon.slot]], game.you?.rarity?.[weapon.slot]);
      head = `<small style="color:${rarity.color}">${rarity.name} · ${weapon.slot === 'primary' ? 'Primary' : 'Secondary'}</small><h4>${weapon.name}</h4><p>${weapon.tag.toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>`;
      body = STATS.map(([label, read, max]) => { const value = read(weapon), was = held && held.id !== weapon.id ? read(held) : null; const diff = was === null ? '' : value > was ? 'up' : value < was ? 'down' : ''; return `<div class="stat"><span>${label}</span><i style="--v:${Math.min(100, Math.round((value / max) * 100))}%"></i><em class="${diff}">${value}${diff === 'up' ? ' ▲' : diff === 'down' ? ' ▼' : ''}</em></div>`; }).join('');
      if (held?.id === weapon.id) verb = 'Take ammo'; else if (held) verb = `Swap · drops ${held.short}`;
    } else if (item.kind === 'armor') { head = `<small>Armour</small><h4>${ARMOR[item.id].name}</h4><p>${ARMOR[item.id].points} armour points.</p>`; can = (game.you?.armor || 0) < ARMOR[item.id].points; if (!can) verb = 'Yours is as good'; }
    else if (item.kind === 'helmet') { head = '<small>Armour</small><h4>Helmet</h4><p>Survives one headshot that would kill.</p>'; can = !game.you?.helmet; if (!can) verb = 'Already wearing one'; }
    else if (item.kind === 'heal') { head = `<small>Healing</small><h4>Medkit</h4><p>+${item.amount} health, used at once.</p>`; can = (game.you?.hp ?? 100) < 100; if (!can) verb = 'Health is full'; }
    else if (item.kind === 'gadget') { const gadget = GADGETS[item.id]; head = `<small>Gadget</small><h4>${gadget.name}</h4><p>${gadget.desc}</p>`; can = (game.you?.gadgets || []).length < 2 && !(game.you?.gadgets || []).includes(item.id); if (!can) verb = 'No free slot'; }
    else if (item.kind === 'power') { const power = POWERS[item.id]; head = `<small>Boost · ${power.seconds}s</small><h4>${power.name}</h4><p>${power.desc}</p>`; }
    else { head = '<small>Supplies</small><h4>Ammo</h4><p>Fills both guns. Picked up as you pass.</p>'; verb = 'Walk over it'; can = false; }
    return { html: `${head}${body}<div class="take${can ? '' : ' no'}"><b>${bindLabel('interact')}</b>${verb}</div>`, colour };
  }
  // Jump pads: a glowing ring over the plate so you can see them from across a street.
  function ensurePads() {
    if (state.pads && state.padsMap === arena.map && state.pads.parent === arena.scene) return;
    state.pads = new THREE.Group(); state.padsMap = arena.map;
    const ring = new THREE.RingGeometry(0.55, 0.85, 24).rotateX(-Math.PI / 2), glow = new THREE.MeshBasicMaterial({ color: '#6ce6d1', transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false });
    const column = new THREE.CylinderGeometry(0.8, 0.8, 5, 12, 1, true), haze = new THREE.MeshBasicMaterial({ color: '#6ce6d1', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    for (const [x, z] of arena.map.pads || []) { const a = new THREE.Mesh(ring, glow); a.position.set(x, 0.14, z); const b = new THREE.Mesh(column, haze); b.position.set(x, 2.6, z); state.pads.add(a, b); }
    arena.scene.add(state.pads);
  }
  net.on('airdrop', (message) => { addAirdrop(message.drop); hud.banner('AIRDROP INBOUND', 'Top gear. Marked on your map.', 'ROYALE', 'go', 3200); play('ready'); });
  net.on('airdrop-landed', (message) => { const drop = state.airdrops.get(message.id); if (drop) drop.landed = net.time(); });
  net.on('royale-out', (message) => showCard(`<small>${message.storm ? 'Lost to the storm' : message.by ? `Taken out by ${escapeHtml(message.by)}` : 'Eliminated'}</small><h2>#${message.placement} <em>of ${message.total}</em></h2><p>Esc to leave. You can keep watching.</p>`, false, 9));
  net.on('match-end', (message) => { if (message.royale && message.mvp === game.id) { showCard('<small>Last pilot standing</small><h2>Victory</h2><p>Kestrel Island is yours.</p>', true, 6); play('matchWin'); } });
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function showCard(html, win, seconds) { card.innerHTML = html; card.classList.toggle('win', win); card.classList.remove('on'); void card.offsetWidth; card.classList.add('on'); state.cardUntil = performance.now() + seconds * 1000; }

  // ---- airdrops: a crate coming down under a beam, then a marker until it has been picked clean
  const crateGeometry = new THREE.BoxGeometry(1.6, 1.1, 1.6), chuteGeometry = new THREE.ConeGeometry(2.2, 1.6, 8, 1, true);
  const crateMaterial = new THREE.MeshStandardMaterial({ color: '#c8862a', roughness: 0.6, emissive: '#5a3a08', emissiveIntensity: 0.5 });
  const chuteMaterial = new THREE.MeshStandardMaterial({ color: '#e6edf1', roughness: 0.9, side: THREE.DoubleSide });
  const dropBeam = new THREE.MeshBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  function addAirdrop(drop) {
    if (state.airdrops.has(drop.id)) return;
    const holder = new THREE.Group();
    holder.position.set(drop.x, 0, drop.z);
    const crate = new THREE.Mesh(crateGeometry, crateMaterial), chute = new THREE.Mesh(chuteGeometry, chuteMaterial);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 160, 10, 1, true), dropBeam); beam.position.y = 80;
    chute.position.y = 2.6; crate.add(chute);
    holder.add(crate, beam);
    ensureGroup().add(holder);
    state.airdrops.set(drop.id, { ...drop, holder, crate, chute, landed: 0 });
  }
  function clearAirdrops() { for (const drop of state.airdrops.values()) drop.holder.parent?.remove(drop.holder); state.airdrops.clear(); }

  // ---- the drop map: click where you want to land
  dropMap.addEventListener('click', (event) => {
    if (game.room?.phase !== 'drop') return;
    const box = dropMap.getBoundingClientRect(), half = arena.map.bounds.maxX, span = half * 2.1;
    const x = ((event.clientX - box.left) / box.width - 0.5) * span, z = ((event.clientY - box.top) / box.height - 0.5) * span;
    const limit = half - 24;
    state.drop = { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)) };
    net.send({ type: 'royale-drop', ...state.drop });
    play('ready');
  });

  // Shortcut for testing: ?royale in the address goes straight to a royale lobby once signed in.
  const wanted = new URLSearchParams(location.search).has('royale');
  let requested = false;
  // A reload mid-match rejoins the held seat on its own, so only queue when this tab wasn't in a room.
  const rejoining = (() => { try { return Boolean(sessionStorage.getItem('krosshair:room')); } catch { return false; } })();
  bus.on('signed-in', () => { if (wanted && !requested && !rejoining && !game.room) { requested = true; setTimeout(() => net.enter({ action: 'royale' }), 300); } });

  // ---- maps: the radar (around you) and the full island (map key)
  // The island itself never changes, so it is painted once: coast, roads, woods, buildings, place names.
  function islandLayer() {
    if (state.layer && state.layerMap === arena.map) return state.layer;
    const map = arena.map, half = map.bounds.maxX, size = 1280, span = half * 2.1, scale = size / span;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    const px = (v) => size / 2 + v * scale;
    c.fillStyle = '#16465a'; c.fillRect(0, 0, size, size);
    c.fillStyle = '#d9c896'; c.fillRect(px(-half), px(-half), half * 2 * scale, half * 2 * scale);
    c.fillStyle = '#4f6339'; c.fillRect(px(-half + 18), px(-half + 18), (half - 18) * 2 * scale, (half - 18) * 2 * scale);
    const paint = (test, colour) => { c.fillStyle = colour; for (const box of map.boxes) if (test(box)) c.fillRect(px(box.min[0]), px(box.min[2]), Math.max(1.5, (box.max[0] - box.min[0]) * scale), Math.max(1.5, (box.max[2] - box.min[2]) * scale)); };
    const area = (box) => (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]);
    paint((box) => box.mat === 'asphalt', '#7c7a72');
    paint((box) => box.mat === 'hedge' && box.min[1] > 2, '#2f4a26');
    paint((box) => (box.mat === 'grass' || box.mat === 'rock') && box.min[1] === 0 && box.max[1] > 0.3 && box.max[1] < 6 && area(box) > 150 && area(box) < 6000, 'rgba(190,205,140,.16)');
    paint((box) => box.mat === 'rock' && box.max[1] < 9 && area(box) > 6 && area(box) < 150, '#80857f');
    paint((box) => box.max[1] >= 2.9 && box.min[1] > 2 && area(box) > 40 && area(box) < 1500, '#d8dde0');
    c.fillStyle = 'rgba(7,9,12,.7)'; c.font = '600 19px "Geist Mono", monospace'; c.textAlign = 'center';
    for (const place of map.places || []) { const text = place.name.toUpperCase(), width = c.measureText(text).width + 14; c.fillStyle = 'rgba(7,9,12,.72)'; c.fillRect(px(place.x) - width / 2, px(place.z) - 34, width, 24); c.fillStyle = '#e6edf1'; c.fillText(text, px(place.x), px(place.z) - 16); }
    state.layer = canvas; state.layerMap = map;
    return canvas;
  }
  function drawMap(canvas, full) {
    const c = canvas.getContext('2d'), size = canvas.width;
    const map = arena.map, half = map.bounds.maxX;
    const me = player.camera.position, dropping = game.room?.phase === 'drop';
    const span = full ? half * 2.1 : 240;
    const cx = full ? 0 : me.x, cz = full ? 0 : me.z;
    const scale = size / span;
    const sx = (x) => size / 2 + (x - cx) * scale, sz = (z) => size / 2 + (z - cz) * scale;
    c.clearRect(0, 0, size, size);
    c.fillStyle = '#16465a'; c.fillRect(0, 0, size, size);
    const layer = islandLayer(), whole = half * 2.1;
    c.drawImage(layer, sx(-whole / 2), sz(-whole / 2), whole * scale, whole * scale);
    const t = net.time(), now = circleAt(t), storm = state.storm;
    if (now && !dropping) {
      c.save();
      c.beginPath(); c.rect(0, 0, size, size); c.arc(sx(now.x), sz(now.z), now.r * scale, 0, Math.PI * 2, true); c.fillStyle = 'rgba(130,40,200,.38)'; c.fill();
      c.restore();
      c.strokeStyle = 'rgba(200,120,255,.95)'; c.lineWidth = full ? 3 : 2; c.beginPath(); c.arc(sx(now.x), sz(now.z), now.r * scale, 0, Math.PI * 2); c.stroke();
      c.setLineDash([8, 6]); c.strokeStyle = '#ffffff'; c.beginPath(); c.arc(sx(storm.to.x), sz(storm.to.z), storm.to.r * scale, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    // Loot near you, on the radar only.
    if (!full) for (const loot of state.loot.values()) { const x = sx(loot.entry.x), z = sz(loot.entry.z); if (x < 0 || z < 0 || x > size || z > size) continue; c.fillStyle = LOOT_COLOURS[lootKind(loot.entry.item)]; c.fillRect(x - 2.5, z - 2.5, 5, 5); }
    for (const drop of state.airdrops.values()) { const x = sx(drop.x), z = sz(drop.z), r = full ? 13 : 9; c.fillStyle = '#ffb547'; c.strokeStyle = '#07090c'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, z - r); c.lineTo(x + r, z); c.lineTo(x, z + r); c.lineTo(x - r, z); c.closePath(); c.fill(); c.stroke(); }
    // The aircraft's line and where it is now, while anyone could still be aboard.
    const flight = state.flight;
    if (flight && t < flight.ejectAt + 2) {
      c.setLineDash([10, 8]); c.strokeStyle = 'rgba(230,237,241,.75)'; c.lineWidth = full ? 3 : 2;
      c.beginPath(); c.moveTo(sx(flight.from[0]), sz(flight.from[1])); c.lineTo(sx(flight.to[0]), sz(flight.to[1])); c.stroke(); c.setLineDash([]);
      const at = aircraftAt(flight, t);
      c.fillStyle = '#e6edf1'; c.beginPath(); c.arc(sx(at.x), sz(at.z), full ? 9 : 6, 0, Math.PI * 2); c.fill();
    }
    if (state.drop) { const x = sx(state.drop.x), z = sz(state.drop.z), r = full ? 20 : 9; c.strokeStyle = '#ffb547'; c.lineWidth = full ? 4 : 2; c.beginPath(); c.arc(x, z, r, 0, Math.PI * 2); c.moveTo(x - r * 1.6, z); c.lineTo(x + r * 1.6, z); c.moveTo(x, z - r * 1.6); c.lineTo(x, z + r * 1.6); c.stroke(); }
    if (dropping) return;
    // You: an arrow pointing where you look.
    const yaw = player.yaw ?? 0;
    c.save(); c.translate(sx(me.x), sz(me.z)); c.rotate(-yaw);
    c.fillStyle = '#ffb547'; c.strokeStyle = '#07090c'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -10 * (full ? 1.5 : 1.6)); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  function stormText(t) {
    const storm = state.storm;
    if (!storm) return '';
    const clock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
    if (t < storm.shrinkStart) return [`Storm ${storm.stage + 1}/${STORM.length} closes in ${clock(storm.shrinkStart - t)}`, false];
    if (t < storm.shrinkEnd) return [`Storm closing · ${clock(storm.shrinkEnd - t)}`, true];
    return [storm.stage + 1 >= STORM.length ? 'Final circle' : 'Storm holding', false];
  }

  // Early access note, shown each time you join a royale room.
  const note = document.createElement('div');
  note.className = 'royale-note';
  note.innerHTML = '<div><b>PLAYTEST BUILD</b>This mode is the rawest thing in the game and it is here to be broken. Expect bugs. Tell us what you find.</div><button type="button">GOT IT</button>';
  document.body.append(note);
  let noteTimer = 0, noteRoom = null;
  note.querySelector('button').addEventListener('click', () => { note.classList.remove('on'); clearTimeout(noteTimer); });
  function showNote() { note.classList.add('on'); clearTimeout(noteTimer); noteTimer = setTimeout(() => note.classList.remove('on'), 12000); }

  let lastRadar = 0, lastBigMap = 0, lastPhase = null;
  return {
    update(dt) {
      const on = active();
      // Text and markup written only when it changes: this runs every frame, and writing the same words
      // again still makes the browser re-check the page. The main HUD does the same with setText.
      const put = (node, value) => { if (node.__text !== value) { node.__text = value; node.textContent = value; } };
      const putHtml = (node, value) => { if (node.__html !== value) { node.__html = value; node.innerHTML = value; } };
      const roomName = game.room?.royale ? game.room.name || 'royale' : null;
      if (roomName !== noteRoom) { noteRoom = roomName; if (roomName) showNote(); else note.classList.remove('on'); }
      document.body.classList.toggle('royale-mode', on);
      root.classList.toggle('hidden', !on || game.screen !== 'game');
      if (!on) { if (state.loot.size || beams.count) clearLoot(); if (state.airdrops.size) clearAirdrops(); if (state.wall) state.wall.visible = false; dropScreen.classList.remove('on'); card.classList.remove('on'); return; }
      if (game.room.phase !== lastPhase) {
        if (game.room.phase === 'drop') { state.powers.clear(); state.drop = null; state.storm = null; clearLoot(); clearAirdrops(); card.classList.remove('on'); }
        lastPhase = game.room.phase;
      }
      // The countdown: everyone is aboard and the deployment (client/deploy.js) has the screen. The
      // island map still opens on its key, to plan where to go.
      dropScreen.classList.remove('on');
      if (game.room.phase === 'drop') {
        if (state.wall) state.wall.visible = false;
        const showMap = held(player.keys || new Set(), 'map');
        bigMap.classList.toggle('on', showMap);
        if (showMap && performance.now() - lastBigMap > 33) { lastBigMap = performance.now(); drawMap(bigMap, true); }
        return;
      }
      if (card.classList.contains('on') && performance.now() > state.cardUntil) card.classList.remove('on');
      const t = net.time(), me = player.camera.position;
      // Loot: models for what is near, the beam batch for the rest.
      ensureGroup();
      if (state.beamsDirty) rebuildBeams();
      for (const loot of state.loot.values()) {
        const dx = loot.entry.x - me.x, dz = loot.entry.z - me.z, near = dx * dx + dz * dz < NEAR * NEAR;
        if (near && !loot.holder) showNear(loot); else if (!near && loot.holder && dx * dx + dz * dz > (NEAR + 6) ** 2) hideNear(loot);
        if (!loot.holder) continue;
        loot.phase += dt;
        loot.mesh.rotation.y = loot.phase * 0.9;
        loot.mesh.position.y = 0.32 + Math.sin(loot.phase * 2) * 0.05;
        loot.label.visible = dx * dx + dz * dz < 18 * 18;
      }
      // Airdrops: down under the chute, then sitting there until the loot around them is gone.
      for (const drop of state.airdrops.values()) {
        const left = Math.max(0, drop.landAt - t);
        drop.crate.position.y = 0.55 + (left / ROYALE.airdropFall) * 110;
        drop.crate.rotation.y = left * 0.4;
        drop.chute.visible = left > 0;
        if (drop.landed && t - drop.landed > 75) { drop.holder.parent?.remove(drop.holder); state.airdrops.delete(drop.id); }
      }
      // What you are looking at: the nearest pickup in front of the crosshair, with a card of what it is.
      ensurePads();
      let look = null, best = 0.34;
      if (player.alive && !player.drop) {
        const pitch = player.pitch ?? 0, yaw = player.yaw ?? 0;
        const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
        for (const loot of state.loot.values()) {
          const dx = loot.entry.x - me.x, dy = loot.entry.y + 0.6 - me.y, dz = loot.entry.z - me.z;
          const flat = Math.hypot(dx, dz);
          if (flat > ROYALE.reach || Math.abs(dy) > 3.2 || !lootInSight(arena.physics, [me.x, me.y, me.z], loot.entry)) continue;
          const dist = Math.hypot(flat, dy) || 0.01;
          const off = flat < 0.9 ? 0.05 : Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / dist)));
          if (off < best) { best = off; look = loot; }
        }
      }
      if (look !== state.look) {
        state.look = look;
        if (look) { const cardInfo = lootCard(look.entry.item); swap.innerHTML = cardInfo.html; swap.style.setProperty('--tier', cardInfo.colour); }
      }
      // Whether the card shows follows what you are looking at this frame, not only the frames where it
      // changed. Taking an item sets state.look to null behind the card's back, so if the server removed
      // the loot on the very next frame the test above compared null with null, never ran, and the card
      // sat there until you happened to look at something else. Only the rebuild is worth guarding.
      swap.classList.toggle('on', Boolean(look));
      for (const loot of state.loot.values()) if (loot.mesh) loot.mesh.scale.setScalar(loot === look ? 1.25 : 1);
      const fDown = held(player.keys || new Set(), 'interact');
      if (fDown && !state.fWas && look && player.alive) { net.send({ type: 'royale-take', id: look.entry.id }); state.look = null; }
      state.fWas = fDown;
      // Coming down: how high, and what to do about it.
      alt.classList.toggle('on', Boolean(player.drop && player.alive));
      if (player.drop) { const ground = arena.physics.groundBelow(player.body.x, player.body.y + 0.2, player.body.z); put(alt.firstChild, `${Math.max(0, Math.round(player.body.y - (Number.isFinite(ground) ? ground : 0)))} M`); put(alt.lastChild, player.drop.chute ? 'Parachute' : 'Free fall'); }
      // Boosts that are still running.
      const clock = performance.now();
      for (const [id, until] of state.powers) if (clock > until) state.powers.delete(id);
      putHtml(powersBox, [...state.powers].map(([id, until]) => `<div>${POWERS[id].name} · ${Math.ceil((until - clock) / 1000)}s</div>`).join(''));
      // Storm wall and whether you're in it.
      const circle = circleAt(t);
      if (circle) {
        const wall = ensureWall();
        wall.visible = true;
        wall.position.set(circle.x, 40, circle.z);
        wall.scale.set(Math.max(1, circle.r), 140, Math.max(1, circle.r));
        const outside = Math.hypot(me.x - circle.x, me.z - circle.z) > circle.r && player.alive;
        outsideFx.classList.toggle('on', outside);
        // Outside the next circle: which way to run and how far.
        const to = state.storm.to, dx = to.x - me.x, dz = to.z - me.z, gap = Math.hypot(dx, dz) - to.r;
        const show = player.alive && gap > 0 && (outside || t > state.storm.shrinkStart - 30);
        way.classList.toggle('on', show);
        if (show) { way.style.setProperty('--turn', `${Math.atan2(dx, -dz) + (player.yaw ?? 0)}rad`); put(way.lastChild, `Safe zone ${Math.ceil(gap)} m`); }
      }
      put(alive, String(state.alive));
      put(kills, String(game.roster.get(game.id)?.kills ?? 0));
      const [text, closing] = stormText(t) || [];
      put(stormLabel, text || '');
      stormLabel.classList.toggle('closing', Boolean(closing));
      // The radar is cheap, but no need to redraw it 144 times a second.
      if (performance.now() - lastRadar > 60) { lastRadar = performance.now(); drawMap(radar, false); }
      // Not through the inventory: one screen at a time.
      const showMap = !kitOpen && held(player.keys || new Set(), 'map');
      bigMap.classList.toggle('on', showMap);
      // The whole island at 1280 px is four full passes over the canvas: plenty at 30 a second.
      if (showMap && performance.now() - lastBigMap > 33) { lastBigMap = performance.now(); drawMap(bigMap, true); }
    },
  };
}
