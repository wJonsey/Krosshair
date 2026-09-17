// In-match HUD: score bar, vitals, loadout, kill feed, minimap, buy menu,
// scoreboard, banners, hit feedback, chat and radio.
import { ARMOR, FLAG, GADGETS, MASTERY_TIERS, MODIFIERS, QUICK_COMMANDS, REACTIONS, VARIANT_NAMES, WEAPONS, masteryTier } from '../shared/constants.js';
import { zoneAt } from '../shared/map.js';
import { bus, game, isEnemy, me, myTeam, nameOf } from './state.js';
import { net } from './net.js';
import { play, announce } from './audio.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const WEAPON_SHORT = { m44: 'M-44', recon: 'RC-9', talon: 'TALON', wasp: 'WASP-9', breaker: 'BREAKER', p9: 'P9', viper: 'VIPER', knife: 'BLADE' };

export class Hud {
  constructor({ player, arena, operators }) {
    Object.assign(this, { player, arena, operators });
    this.root = $('#hud');
    this.blips = new Map(); // enemy id → { x, z, until }
    this.pings = [];
    this.layers = null;
    this.chatOpen = false; this.chatTeam = false;
    this.buyOpen = false; this.scoreOpen = false; this.quickOpen = false;
    this.bannerTimer = null;
    this.lastClockSecond = -1;
    this.visionTimer = 0;
    this.dom = {
      health: $('#health'), healthMeter: $('#health-meter'), armor: $('#armor'), armorMeter: $('#armor-meter'), helmet: $('#helmet-tag'), credits: $('#credits'),
      weaponName: $('#weapon-name'), weaponTag: $('#weapon-tag'), ammo: $('#ammo'), reserve: $('#reserve'), slots: $('#weapon-slots'), gadgets: $('#gadget-slots'),
      clock: $('#clock'), phase: $('#phase-label'), round: $('#round-label'), scoreMine: $('#score-mine'), scoreTheirs: $('#score-theirs'), pipsMine: $('#pips-mine'), pipsTheirs: $('#pips-theirs'),
      labelMine: $('#label-mine'), labelTheirs: $('#label-theirs'), zone: $('#zone-name'), variant: $('#variant-name'), minimap: $('#minimap'),
      killfeed: $('#killfeed'), feed: $('#event-feed'), chatLog: $('#chat-log'), chatInput: $('#chat-input'), crosshair: $('#crosshair'), hitmarker: $('#hitmarker'), arcs: $('#damage-arcs'),
      scope: $('#scope-overlay'), scopeZoom: $('#scope-zoom'), breath: $('#breath-meter'), fxDamage: $('#fx-damage'), fxLow: $('#fx-low'), fxSuppress: $('#fx-suppress'), fxFlash: $('#fx-flash'),
      banner: $('#banner'), bannerEyebrow: $('#banner-eyebrow'), bannerTitle: $('#banner-title'), bannerSub: $('#banner-sub'), prompt: $('#prompt'),
      spectate: $('#spectate-bar'), spectateName: $('#spectate-name'), reactions: $('#reactions'), spectateWeapon: $('#spectate-weapon'),
      pov: $('#pov-card'), povLabel: $('#pov-label'), povSkip: $('#pov-skip'), povTitle: $('#pov-title'), povName: $('#pov-name'), povHp: $('#pov-hp'), povHpBar: $('#pov-hp-bar'), povTag: $('#pov-tag'), povWeapon: $('#pov-weapon'), povAmmo: $('#pov-ammo'), povMag: $('#pov-mag'), povDetail: $('#pov-detail'),
      drone: $('#drone-overlay'), droneTime: $('#drone-time'),
      buy: $('#buy-menu'), scoreboard: $('#scoreboard'), quick: $('#quick-wheel'), controls: $('#controls-hint'),
    };
    this.dom.reactions.innerHTML = REACTIONS.map((emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join('');
    this.dom.reactions.addEventListener('click', (event) => { const emoji = event.target.closest('button')?.dataset.emoji; if (emoji) net.send({ type: 'react', emoji }); });
    this.dom.buy.addEventListener('click', (event) => this.onBuyClick(event));
    this.dom.chatInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { const text = this.dom.chatInput.value.trim(); if (text) net.send({ type: 'chat', text, team: this.chatTeam }); this.closeChat(); }
      if (event.key === 'Escape') this.closeChat();
    });
    bus.on('key', (code) => this.onKey(code));
    bus.on('pad-scoreboard', () => this.toggleScoreboard(!this.scoreOpen));
    addEventListener('keyup', (event) => { if (event.code === 'Tab') this.toggleScoreboard(false); });
    bus.on('spectate', (id) => { this.dom.spectate.classList.toggle('hidden', !id); if (id) this.dom.spectateName.textContent = nameOf(id); });
    bus.on('pov-card', (card) => this.showPovCard(card));
    bus.on('pov-hit', (kind) => this.hitmarker(kind));
    bus.on('drone', (on) => this.dom.drone.classList.toggle('hidden', !on));
    bus.on('spawned', () => { this.dom.spectate.classList.add('hidden'); this.showPovCard(null); });
  }

  get blocking() { return this.buyOpen || this.chatOpen || this.quickOpen; }

  show(visible) { this.root.classList.toggle('hidden', !visible); if (!visible) { this.closeBuy(); this.toggleScoreboard(false); this.closeChat(); } }

  // ------------------------------------------------------------ keys
  onKey(code) {
    if (game.screen !== 'game') return;
    if (code === 'Tab') this.toggleScoreboard(true);
    if (code === 'KeyB') { if (this.buyOpen) this.closeBuy(true); else this.openBuy(); }
    if (code === 'Escape' && this.buyOpen) this.closeBuy();
    if (code === 'Enter' || code === 'KeyY') { this.openChat(code === 'KeyY'); }
    if (code === 'KeyX') this.toggleQuick(!this.quickOpen);
    if (this.quickOpen && code.startsWith('Digit')) {
      const command = QUICK_COMMANDS[Number(code.slice(5)) - 1];
      if (command) net.send({ type: 'quick', id: command.id });
      this.toggleQuick(false);
    }
  }

  openChat(team) {
    if (this.chatOpen) return;
    this.chatOpen = true; this.chatTeam = team;
    const input = this.dom.chatInput;
    input.classList.remove('hidden');
    input.placeholder = team ? 'Team message…' : 'Message everyone…';
    input.value = '';
    document.exitPointerLock?.();
    setTimeout(() => input.focus(), 0);
  }
  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.dom.chatInput.classList.add('hidden');
    this.dom.chatInput.blur();
    this.player.lock();
  }
  toggleQuick(open) {
    this.quickOpen = open && this.player.alive;
    this.dom.quick.classList.toggle('hidden', !this.quickOpen);
    if (this.quickOpen) this.dom.quick.innerHTML = `<span>RADIO</span>${QUICK_COMMANDS.map((command, index) => `<div><b>${index + 1}</b>${command.text}</div>`).join('')}`;
  }

  // ------------------------------------------------------------ feeds
  notice(text, tone = 'info') {
    const line = document.createElement('div');
    line.className = `tone-${tone}`;
    line.textContent = text;
    this.dom.feed.prepend(line);
    while (this.dom.feed.children.length > 5) this.dom.feed.lastChild.remove();
    setTimeout(() => line.remove(), 4200);
  }

  chat(message) {
    const line = document.createElement('div');
    const enemy = message.team !== myTeam();
    line.innerHTML = `<b class="${enemy ? 'foe' : 'friend'}">${message.scope === 'team' ? '[TEAM] ' : ''}${message.dead ? '☠ ' : ''}${escapeHtml(message.name)}</b> ${escapeHtml(message.text)}`;
    this.dom.chatLog.append(line);
    while (this.dom.chatLog.children.length > 7) this.dom.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('faded'), 9000);
    play('chat');
  }

  killFeed(event) {
    const line = document.createElement('div');
    const side = (id) => (id === game.id ? 'self' : isEnemy(id) ? 'foe' : 'friend');
    const tags = [];
    if (event.zone === 'head') tags.push('<i class="tag hs">HEADSHOT</i>');
    if (event.wallbang) tags.push('<i class="tag">WALLBANG</i>');
    if (event.backstab) tags.push('<i class="tag">BACKSTAB</i>');
    if (event.distance >= 50) tags.push(`<i class="tag">${event.distance} M</i>`);
    const killer = event.killer ? `<b class="${side(event.killer)}">${escapeHtml(nameOf(event.killer))}</b>` : '';
    const assist = event.assist ? `<small> + ${escapeHtml(nameOf(event.assist))}</small>` : '';
    line.innerHTML = `${killer}${assist}<span class="gun">${WEAPON_SHORT[event.weapon] || (event.reason === 'disconnect' ? 'LOST LINK' : '—')}</span><b class="${side(event.victim)}">${escapeHtml(nameOf(event.victim))}</b>${tags.join('')}`;
    if (event.killer === game.id || event.victim === game.id) line.classList.add('mine');
    this.dom.killfeed.prepend(line);
    while (this.dom.killfeed.children.length > 6) this.dom.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 7000);
  }

  banner(title, sub = '', eyebrow = '', tone = 'neutral', duration = 2600) {
    const { banner, bannerTitle, bannerSub, bannerEyebrow } = this.dom;
    bannerTitle.textContent = title; bannerSub.textContent = sub; bannerEyebrow.textContent = eyebrow;
    banner.className = `banner tone-${tone}`;
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => banner.classList.add('hidden'), duration);
  }

  // Who got the kill, with what, and how: shown over killcams and round / final replays.
  showPovCard(card) {
    const dom = this.dom;
    dom.pov.classList.toggle('hidden', !card);
    if (!card) return;
    const { replay, kind } = card;
    dom.pov.className = `pov-card ${kind}`;
    dom.povLabel.textContent = { killcam: 'KILLCAM', round: 'ROUND WINNING KILL', final: 'FINAL KILL' }[kind];
    dom.povSkip.classList.toggle('hidden', kind !== 'killcam');
    const killer = game.roster.get(replay.killer);
    dom.povTitle.textContent = [killer?.title, killer?.level ? `LV ${killer.level}` : ''].filter(Boolean).join(' · ');
    dom.povName.textContent = nameOf(replay.killer);
    dom.povName.className = replay.killer === game.id ? '' : isEnemy(replay.killer) ? 'foe' : 'friend';
    const hp = replay.killerHp ?? null;
    dom.povHp.parentElement.classList.toggle('hidden', hp === null);
    if (hp !== null) { dom.povHpBar.style.width = `${hp}%`; dom.povHpBar.style.background = hp < 35 ? 'var(--red)' : ''; dom.povHp.textContent = `${hp} HP${replay.killerArmor ? ` · ${replay.killerArmor} ARMOUR` : ''}`; }
    const weapon = WEAPONS[replay.weapon];
    dom.povTag.textContent = weapon?.tag || '';
    dom.povWeapon.textContent = weapon?.name || '';
    const victim = replay.victim === game.id ? 'YOU' : escapeHtml(nameOf(replay.victim));
    const tags = [replay.zone === 'head' && 'HEADSHOT', replay.wallbang && 'WALLBANG', replay.backstab && 'BACKSTAB'].filter(Boolean);
    dom.povDetail.innerHTML = `ELIMINATED <b>${victim}</b>${tags.map((tag) => ` · <b>${tag}</b>`).join('')} · ${replay.distance} M`;
  }

  prompt(text) { this.dom.prompt.textContent = text || ''; this.dom.prompt.classList.toggle('hidden', !text); }

  hitmarker(kind) {
    const marker = this.dom.hitmarker;
    marker.className = 'hitmarker';
    void marker.offsetWidth;
    marker.classList.add('show', ...kind.split(' '));
  }

  damageFrom(x, z) {
    const arc = document.createElement('i');
    arc.dataset.x = x; arc.dataset.z = z;
    this.dom.arcs.append(arc);
    arc.born = performance.now();
    setTimeout(() => arc.remove(), 1600);
    this.dom.fxDamage.classList.remove('show'); void this.dom.fxDamage.offsetWidth; this.dom.fxDamage.classList.add('show');
  }

  flash() { this.dom.fxFlash.classList.remove('show'); void this.dom.fxFlash.offsetWidth; this.dom.fxFlash.classList.add('show'); }

  blip(id, x, z, seconds = 2.5) { this.blips.set(id, { x, z, until: performance.now() + seconds * 1000 }); }
  addPing(x, z, danger) { this.pings.push({ x, z, danger, until: performance.now() + 5000 }); }

  // ------------------------------------------------------------ buy menu
  openBuy() {
    const phase = game.room?.phase;
    if (!this.player.alive || (phase !== 'buy' && phase !== 'range')) { if (phase === 'live' || phase === 'overtime') this.notice('The armoury only opens between rounds.', 'warn'); return; }
    this.buyOpen = true;
    this.renderBuy();
    this.dom.buy.classList.remove('hidden');
    document.exitPointerLock?.();
    bus.emit('tutorial', 'buy');
  }
  closeBuy(relock = true) {
    if (!this.buyOpen) return;
    this.buyOpen = false;
    this.dom.buy.classList.add('hidden');
    if (relock) this.player.lock();
  }
  onBuyClick(event) {
    const card = event.target.closest('[data-item]');
    if (event.target.closest('[data-close]')) { play('ui'); return this.closeBuy(); }
    if (!card || card.classList.contains('locked')) return;
    const item = card.dataset.item;
    net.send({ type: card.classList.contains('refundable') ? 'sell' : 'buy', item });
    play('buy');
  }
  renderBuy() {
    if (!this.buyOpen || !game.you) return;
    const you = game.you;
    const free = game.room?.mode === 'range';
    const modifier = game.room?.rules?.modifier;
    const bought = new Set(you.bought || []);
    const stat = (label, value) => `<div class="stat"><span>${label}</span><div><i style="width:${Math.round(value * 100)}%"></i></div></div>`;
    const weaponCard = (weapon) => {
      const owned = you.weapons[weapon.slot] === weapon.id;
      const refundable = owned && weapon.cost > 0 && (bought.has(`slot:${weapon.slot}`) || free);
      const locked = (!owned && !free && you.credits + (bought.has(`slot:${weapon.slot}`) ? WEAPONS[you.weapons[weapon.slot]].cost : 0) < weapon.cost) || (weapon.slot === 'primary' && modifier === 'sidearms');
      const tier = masteryTier(game.profile?.weapons?.[weapon.id]?.kills || 0);
      const dps = Math.min(1, (weapon.damage * weapon.pellets) / 130);
      const rate = Math.min(1, 0.09 / weapon.cooldown + 0.06);
      const range = weapon.falloff ? Math.min(1, weapon.falloff[1] / 90) : 1;
      return `<button type="button" class="buy-card${owned ? ' owned' : ''}${refundable ? ' refundable' : ''}${locked ? ' locked' : ''}" data-item="${weapon.id}">
        <header><strong>${weapon.name}</strong><em>${weapon.cost ? weapon.cost : 'FREE'}</em></header><small>${weapon.tag}${tier ? ` · ${MASTERY_TIERS[tier][1].toUpperCase()} MASTERY` : ''}</small>
        ${stat('DMG', dps)}${stat('RATE', rate)}${stat('RANGE', range)}${stat('PEN', weapon.pen)}
        <footer>${owned ? (refundable ? 'EQUIPPED · CLICK TO REFUND' : 'EQUIPPED') : locked ? 'LOCKED' : 'BUY'}</footer></button>`;
    };
    const gearCard = (id, name, cost, desc, owned, refundable, icon = '') => {
      const locked = !owned && !free && you.credits < cost;
      return `<button type="button" class="buy-card gear${owned ? ' owned' : ''}${refundable ? ' refundable' : ''}${locked ? ' locked' : ''}" data-item="${id}"><header><strong>${icon ? `<span class="icon">${icon}</span>` : ''}${name}</strong><em>${cost}</em></header><small>${desc}</small><footer>${owned ? (refundable ? 'OWNED · CLICK TO REFUND' : 'OWNED') : locked ? 'LOCKED' : 'BUY'}</footer></button>`;
    };
    const weapons = Object.values(WEAPONS).filter((weapon) => !weapon.melee);
    const armorOwned = (id) => (id === 'helmet' ? you.helmet : you.armor >= ARMOR[id].points && (id === 'heavy' || you.armor < ARMOR.heavy.points));
    this.dom.buy.innerHTML = `
      <div class="buy-head"><div><p class="eyebrow">Armoury${free ? ' // everything is free on the range' : ''}</p><h2>Gear up.</h2></div><div class="buy-credits"><span>CREDITS</span><b>${free ? '∞' : you.credits}</b></div><button type="button" class="secondary-button" data-close>Deploy <span>B</span></button></div>
      <div class="buy-grid">
        <section><h3>Primary</h3>${weapons.filter((w) => w.slot === 'primary').map(weaponCard).join('')}</section>
        <section><h3>Sidearm</h3>${weapons.filter((w) => w.slot === 'sidearm').map(weaponCard).join('')}<h3>Armour</h3>${['light', 'heavy', 'helmet'].map((id) => gearCard(id, ARMOR[id].name, ARMOR[id].cost, ARMOR[id].desc, armorOwned(id), bought.has(id === 'helmet' ? 'helmet' : 'armor') && armorOwned(id))).join('')}</section>
        <section class="wide"><h3>Gadgets <small>${you.gadgets.length} / 2 slots · keys Q and E</small></h3><div class="gadget-grid">${Object.values(GADGETS).map((gadget) => gearCard(gadget.id, gadget.name, gadget.cost, gadget.desc, you.gadgets.includes(gadget.id), bought.has(`gadget:${gadget.id}`) || (free && you.gadgets.includes(gadget.id)), gadget.icon)).join('')}</div></section>
      </div>
      <p class="buy-foot">Survive the round and you keep your gear. Die and you are back to the M-44 and a P9. ${modifier && modifier !== 'standard' ? `<b>${MODIFIERS[modifier].name}:</b> ${MODIFIERS[modifier].desc}` : ''}</p>`;
  }

  // ------------------------------------------------------------ scoreboard
  toggleScoreboard(open) {
    if (open === this.scoreOpen) return;
    this.scoreOpen = open && game.screen === 'game';
    this.dom.scoreboard.classList.toggle('hidden', !this.scoreOpen);
    if (this.scoreOpen) this.renderScoreboard();
  }
  renderScoreboard() {
    if (!this.scoreOpen || !game.room) return;
    const room = game.room;
    const mine = myTeam();
    const table = (team) => {
      const players = room.players.filter((p) => p.team === team).sort((a, b) => b.score - a.score);
      const friendly = team === mine;
      return `<section class="${friendly ? 'friendly' : 'rival'}"><h3>${friendly ? 'YOUR TEAM' : 'RIVALS'} <b>${room.scores[team]}</b></h3>
        <div class="score-row head"><span>PILOT</span><span>K</span><span>D</span><span>A</span><span>SCORE</span><span>${friendly ? 'CR' : ''}</span><span>MS</span></div>
        ${players.map((p) => `<div class="score-row${p.id === game.id ? ' you' : ''}${p.alive ? '' : ' dead'}"><span class="pilot"><i style="background:${p.color}"></i>${escapeHtml(p.name)}${p.bot ? ' <em>BOT</em>' : ` <em>LV ${p.level}</em>`}${p.connected ? '' : ' <em>OFFLINE</em>'}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists}</span><span>${p.score}</span><span>${friendly ? p.credits : ''}</span><span>${p.bot ? '—' : p.ping}</span></div>`).join('')}</section>`;
    };
    const rules = room.rules;
    this.dom.scoreboard.innerHTML = `<div class="scoreboard-head"><span>${escapeHtml(room.name.toUpperCase())} // ${room.queue.toUpperCase()}</span><b>FIRST TO ${rules.roundsToWin} · ${VARIANT_NAMES[room.variant] || ''} · ${MODIFIERS[rules.modifier]?.name || ''}</b></div>${table(mine)}${table(mine === 'A' ? 'B' : 'A')}`;
  }

  // ------------------------------------------------------------ minimap
  buildLayers(map) {
    const { bounds } = map;
    // Fit any map into the same corner of the screen.
    const MAP_SCALE = Math.min(150 / (bounds.maxX - bounds.minX), 210 / (bounds.maxZ - bounds.minZ));
    const width = Math.ceil((bounds.maxX - bounds.minX) * MAP_SCALE), height = Math.ceil((bounds.maxZ - bounds.minZ) * MAP_SCALE);
    const make = (under) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = under ? '#1b242b' : '#0f151b';
      context.fillRect(0, 0, width, height);
      const boxes = map.boxes.filter((box) => !box.deco && (under ? box.max[1] <= 0 && box.max[1] > -3.39 : box.max[1] > 0.4)).sort((a, b) => a.max[1] - b.max[1]);
      for (const box of boxes) {
        const x = (box.min[0] - bounds.minX) * MAP_SCALE, z = (box.min[2] - bounds.minZ) * MAP_SCALE;
        const w = Math.max(1, (box.max[0] - box.min[0]) * MAP_SCALE), h = Math.max(1, (box.max[2] - box.min[2]) * MAP_SCALE);
        if (under) context.fillStyle = box.mat === 'tunnel' && box.max[1] > -0.6 ? '#070a0d' : '#33414b';
        else if (box.glass) context.fillStyle = '#6ce6d1';
        else { const shade = Math.min(1, box.max[1] / 7); context.fillStyle = `rgb(${40 + shade * 60},${52 + shade * 62},${62 + shade * 64})`; }
        context.fillRect(x, z, w, h);
      }
      return canvas;
    };
    this.layers = { surface: make(false), under: make(true), width, height, bounds, scale: MAP_SCALE };
    this.dom.minimap.width = width; this.dom.minimap.height = height;
    this.dom.minimap.style.width = `${width}px`;
  }

  drawMinimap() {
    const map = this.arena.map;
    if (!map) return;
    if (!this.layers || this.layers.bounds !== map.bounds) this.buildLayers(map);
    const { width, height, bounds, scale: MAP_SCALE } = this.layers;
    const context = this.dom.minimap.getContext('2d');
    const camera = this.player.camera.position;
    const under = camera.y < -0.8;
    const flip = game.room?.mode !== 'range' && ((myTeam() === 'B') !== Boolean(game.room?.swapped));
    context.save();
    if (flip) { context.translate(width, height); context.rotate(Math.PI); }
    context.drawImage(under ? this.layers.under : this.layers.surface, 0, 0);
    const px = (x) => (x - bounds.minX) * MAP_SCALE, pz = (z) => (z - bounds.minZ) * MAP_SCALE;
    const nowMs = performance.now(), serverNow = net.time();
    this.pings = this.pings.filter((ping) => ping.until > nowMs);
    for (const ping of this.pings) { context.strokeStyle = ping.danger ? '#ff4d3d' : '#ffc857'; context.lineWidth = 2; context.strokeRect(px(ping.x) - 4, pz(ping.z) - 4, 8, 8); }
    for (const [id, entity] of this.operators.entities) {
      if (!entity.root.visible && this.operators.hidden !== id) continue;
      const enemy = isEnemy(id);
      const s = entity.state;
      if (enemy) {
        const mark = game.marks.get(id);
        const blip = this.blips.get(id);
        const marked = mark && mark.until > serverNow;
        if (!marked && !(blip && blip.until > nowMs)) continue;
        const x = marked ? s.x : blip.x, z = marked ? s.z : blip.z;
        context.fillStyle = '#ff4d3d'; context.globalAlpha = marked ? 1 : Math.max(0.2, (blip.until - nowMs) / 2500);
        context.beginPath(); context.arc(px(x), pz(z), 4, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1;
      } else {
        context.fillStyle = '#6ce6d1';
        context.beginPath(); context.arc(px(s.x), pz(s.z), 3.5, 0, Math.PI * 2); context.fill();
        context.strokeStyle = '#6ce6d1'; context.lineWidth = 1.5; context.beginPath(); context.moveTo(px(s.x), pz(s.z)); context.lineTo(px(s.x) - Math.sin(s.yaw) * 9, pz(s.z) - Math.cos(s.yaw) * 9); context.stroke();
      }
    }
    // Me: a wedge showing view direction.
    const yaw = this.player.mode === 'play' || this.player.mode === 'drone' ? this.player.yaw : this.player.camera.rotation.y;
    context.translate(px(camera.x), pz(camera.z));
    context.rotate(-yaw);
    context.fillStyle = 'rgba(255,200,87,.18)'; context.beginPath(); context.moveTo(0, 0); context.arc(0, 0, 34, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); context.closePath(); context.fill();
    context.fillStyle = '#ffc857'; context.beginPath(); context.moveTo(0, -7); context.lineTo(5, 5); context.lineTo(0, 2); context.lineTo(-5, 5); context.closePath(); context.fill();
    context.restore();
  }

  // Which rivals can I actually see right now? Feeds the minimap.
  updateVision(dt) {
    this.visionTimer -= dt;
    if (this.visionTimer > 0 || !this.player.alive) return;
    this.visionTimer = 0.25;
    const camera = this.player.camera.position;
    for (const [id, entity] of this.operators.entities) {
      if (!entity.root.visible || !isEnemy(id)) continue;
      const s = entity.state;
      const dx = s.x - camera.x, dz = s.z - camera.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 90) continue;
      const facing = (-Math.sin(this.player.yaw) * dx - Math.cos(this.player.yaw) * dz) / Math.max(0.01, distance);
      if (facing < 0.35) continue;
      if (this.arena.physics.lineOfSight(camera.x, camera.y, camera.z, s.x, s.y + (s.flags & FLAG.crouch ? 0.9 : 1.4), s.z)) this.blip(id, s.x, s.z, 1.2);
    }
  }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    const room = game.room, you = game.you, player = this.player, dom = this.dom;
    if (!room || game.screen !== 'game') return;
    this.root.classList.toggle('mode-range', room.mode === 'range');
    const mine = myTeam(), theirs = mine === 'A' ? 'B' : 'A';
    // Clock
    const remaining = room.phaseEnds ? Math.max(0, room.phaseEnds - net.time()) : 0;
    const seconds = Math.ceil(remaining);
    dom.clock.textContent = room.phase === 'range' ? '∞' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    dom.clock.classList.toggle('urgent', (room.phase === 'live' && seconds <= 10) || room.phase === 'overtime');
    if (seconds !== this.lastClockSecond) {
      this.lastClockSecond = seconds;
      if (room.phase === 'buy' && seconds <= 3 && seconds > 0) play('tick');
      if (room.phase === 'live' && seconds <= 5 && seconds > 0) play('tick');
    }
    dom.phase.textContent = { buy: 'BUY PHASE', live: 'LIVE', overtime: 'SUDDEN DEATH', roundEnd: 'ROUND OVER', matchEnd: 'MATCH OVER', range: 'PRACTICE RANGE', lobby: 'LOBBY' }[room.phase] || '';
    dom.round.textContent = room.mode === 'range' ? 'FREE FIRE' : `ROUND ${room.round} · FIRST TO ${room.rules.roundsToWin}`;
    dom.scoreMine.textContent = room.scores[mine]; dom.scoreTheirs.textContent = room.scores[theirs];
    dom.labelMine.textContent = mine === 'A' ? 'ALPHA' : 'BRAVO'; dom.labelTheirs.textContent = theirs === 'A' ? 'ALPHA' : 'BRAVO';
    const pips = (team) => room.players.filter((p) => p.team === team).map((p) => `<i class="${p.alive ? 'alive' : ''}"></i>`).join('');
    const mineHtml = pips(mine), theirsHtml = pips(theirs);
    if (dom.pipsMine.innerHTML !== mineHtml) dom.pipsMine.innerHTML = mineHtml;
    if (dom.pipsTheirs.innerHTML !== theirsHtml) dom.pipsTheirs.innerHTML = theirsHtml;

    // Vitals + loadout
    if (you) {
      const spectated = player.mode === 'spectate' && player.spectateId ? game.roster.get(player.spectateId) : null;
      dom.health.textContent = you.hp; dom.healthMeter.style.width = `${you.hp}%`;
      dom.healthMeter.classList.toggle('low', you.hp < 35);
      dom.armor.textContent = you.armor; dom.armorMeter.style.width = `${you.armor}%`;
      dom.helmet.classList.toggle('hidden', !you.helmet);
      dom.credits.textContent = room.mode === 'range' ? '∞' : you.credits;
      const weapon = player.weapon, ammo = player.ammo;
      dom.weaponName.textContent = spectated ? `WATCHING ${spectated.name.toUpperCase()}` : weapon.name.toUpperCase();
      dom.weaponTag.textContent = player.reloadEnd ? 'RELOADING…' : weapon.tag;
      dom.ammo.textContent = weapon.melee ? '—' : String(ammo?.mag ?? 0).padStart(2, '0');
      dom.ammo.classList.toggle('empty', !weapon.melee && (ammo?.mag ?? 0) === 0);
      dom.reserve.textContent = weapon.melee ? '' : ` / ${room.mode === 'range' ? '∞' : ammo?.reserve ?? 0}`;
      const slots = ['primary', 'sidearm', 'melee'].filter((slot) => you.weapons[slot]).map((slot, index) => `<div class="${slot === player.active ? 'active' : ''}"><b>${['primary', 'sidearm', 'melee'].indexOf(slot) + 1}</b>${WEAPON_SHORT[you.weapons[slot]]}</div>`).join('');
      if (dom.slots.innerHTML !== slots) dom.slots.innerHTML = slots;
      const gadgets = [0, 1].map((index) => { const gadget = GADGETS[you.gadgets[index]]; return `<div class="${gadget ? 'ready' : 'empty'}"><b>${index ? 'E' : 'Q'}</b><span>${gadget ? `${gadget.icon} ${gadget.name}` : 'EMPTY'}</span></div>`; }).join('');
      if (dom.gadgets.innerHTML !== gadgets) dom.gadgets.innerHTML = gadgets;
      dom.fxLow.style.opacity = player.alive && you.hp < 40 ? String((40 - you.hp) / 40) : '0';
    }

    // Aim UI
    const pov = player.pov;
    this.root.classList.toggle('watching', Boolean(pov));
    const weapon = pov ? player.viewWeapon : player.weapon;
    const optic = weapon.scope && weapon.scope[0] < 40;
    const scopedView = optic && (pov ? pov.scope > 0.82 : player.mode === 'play' && player.scopeAmount > 0.82);
    if (pov && !dom.pov.classList.contains('hidden')) {
      const melee = Boolean(weapon.melee);
      dom.povWeapon.textContent = weapon.name; dom.povTag.textContent = weapon.tag;
      dom.povAmmo.textContent = melee ? '' : String(pov.mag ?? weapon.mag).padStart(2, '0');
      dom.povMag.textContent = melee ? '' : `/ ${weapon.mag}`;
    }
    if (pov && player.mode === 'spectate') { const text = weapon.name.toUpperCase(); if (dom.spectateWeapon.textContent !== text) dom.spectateWeapon.textContent = text; }
    dom.scope.classList.toggle('hidden', !scopedView);
    if (scopedView) {
      const zoom = weapon.scope[pov ? 0 : Math.min(player.zoomIndex, weapon.scope.length - 1)];
      dom.scopeZoom.textContent = `${WEAPON_SHORT[weapon.id]} // ${Math.round(game.settings.fov / zoom * 10) / 10}X${weapon.scope.length > 1 && !pov ? ' · WHEEL TO ZOOM' : ''}`;
      dom.breath.style.width = `${player.breath * 100}%`;
      dom.breath.classList.toggle('winded', player.winded);
    }
    const showCross = (player.mode === 'play' || Boolean(pov)) && !scopedView && !this.buyOpen;
    dom.crosshair.classList.toggle('hidden', !showCross);
    if (showCross) {
      const spread = weapon.melee ? 0 : pov ? (pov.scope > 0.9 ? weapon.spread.ads : weapon.spread.hip) : (player.scopeAmount > 0.9 ? weapon.spread.ads : weapon.spread.hip) + weapon.spread.move * Math.min(1, player.speed / 6) + (player.body.onGround ? 0 : weapon.spread.air);
      dom.crosshair.style.setProperty('--gap', `${Math.round(4 + spread * 5)}px`);
      dom.crosshair.classList.toggle('dot', Boolean(weapon.melee));
    }
    dom.fxSuppress.style.opacity = String(player.suppression * 0.9);
    dom.droneTime.textContent = player.drone ? Math.max(0, player.drone.until - net.time()).toFixed(1) : '';

    // Damage direction arcs rotate with the view.
    for (const arc of dom.arcs.children) {
      const dx = Number(arc.dataset.x) - player.camera.position.x, dz = Number(arc.dataset.z) - player.camera.position.z;
      const bearing = Math.atan2(-dx, -dz);
      const relative = player.camera.rotation.y - bearing;
      arc.style.transform = `translate(-50%, -50%) rotate(${relative}rad)`;
      arc.style.opacity = String(Math.max(0, 1 - (performance.now() - arc.born) / 1500));
    }

    const position = player.camera.position;
    const zone = zoneAt(this.arena.map, position.x, position.y - 1, position.z).toUpperCase();
    if (dom.zone.textContent !== zone) dom.zone.textContent = zone;
    const variant = (VARIANT_NAMES[room.variant] || '').toUpperCase();
    if (dom.variant.textContent !== variant) dom.variant.textContent = variant;
    this.updateVision(dt);
    this.drawMinimap();
    const canReact = !player.alive && room.mode !== 'range';
    dom.reactions.classList.toggle('hidden', !canReact);
  }
}

export function roundIntroVoice(message) {
  if (message.decider) return 'Final round. Winner takes the match.';
  if (message.matchPoint) return 'Match point.';
  if (message.swapped) return 'Switching sides.';
  return `Round ${message.round}.`;
}
export { announce, me };
