// Dev tools, on K. Only the developers' accounts (server/devs.js) can open this, and every tool the
// server has to agree with is checked against the account on the server every time it is switched.
// The menu brings its own styles and markup so it touches nothing else in the game.
import * as THREE from 'three';
import { DEV_ACTIONS, DEV_FLY_LIFT, DEV_TOOLS } from '../shared/devtools.js';
import { bus, game, isEnemy } from './state.js';
import { MAP_IDS } from '../shared/map.js';
import { WEAPONS } from '../shared/constants.js';
import { net } from './net.js';
import { play } from './audio.js';

// Read by client/player.js for the tools that change how you move and aim.
export const devState = { fly: false, speed: false, esp: false, aimbot: false, nospread: false, lift: 0 };

const CSS = `
.dev-panel { position: fixed; right: 18px; top: 84px; z-index: 40; width: 280px; background: rgba(8, 12, 16, .94); border: 1px solid rgba(0, 255, 198, .45); box-shadow: 0 0 30px rgba(0, 255, 198, .16); color: var(--frost); font-family: var(--mono); display: none; }
.dev-panel.on { display: block; }
.dev-panel header { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(0, 255, 198, .25); background: linear-gradient(90deg, rgba(0, 255, 198, .14), transparent); }
.dev-panel header b { font: 700 11px var(--mono); letter-spacing: .22em; color: #00ffc6; }
.dev-panel header small { color: var(--haze); font-size: 10px; letter-spacing: .1em; }
.dev-panel .dev-list { max-height: 60vh; overflow: auto; }
.dev-row { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: center; width: 100%; padding: 8px 12px; background: none; border: 0; border-bottom: 1px solid rgba(230, 237, 241, .07); color: var(--frost); text-align: left; cursor: pointer; font: inherit; }
.dev-row:hover { background: rgba(0, 255, 198, .08); }
.dev-row b { grid-column: 1; font: 500 12px var(--mono); letter-spacing: .06em; }
.dev-row small { grid-column: 1; color: var(--haze); font-size: 10px; line-height: 1.35; }
.dev-row i { grid-column: 2; grid-row: 1 / span 2; width: 34px; height: 16px; border: 1px solid rgba(230, 237, 241, .3); position: relative; font-style: normal; }
.dev-row i::after { content: ''; position: absolute; inset: 2px auto 2px 2px; width: 12px; background: var(--graphite); transition: transform .12s, background .12s; }
.dev-row.on i { border-color: #00ffc6; }
.dev-row.on i::after { background: #00ffc6; transform: translateX(16px); }
.dev-row.act i { border: 0; }
.dev-row.act i::after { content: 'RUN'; position: static; display: block; width: auto; background: none; color: #00ffc6; font: 700 10px var(--mono); letter-spacing: .12em; }
.dev-panel footer { padding: 8px 12px; color: var(--graphite); font-size: 10px; letter-spacing: .08em; border-top: 1px solid rgba(0, 255, 198, .25); }
.dev-esp { position: fixed; inset: 0; z-index: 12; pointer-events: none; }
.dev-outages { padding: 10px 12px; border-top: 1px solid rgba(0, 255, 198, .25); }
.dev-outages b { display: block; font: 700 10px var(--mono); letter-spacing: .18em; color: #ff9d3d; }
.dev-outages small { display: block; margin: 3px 0 7px; color: var(--haze); font-size: 10px; line-height: 1.4; }
.dev-outages input { width: 100%; margin-bottom: 7px; padding: 6px 8px; background: rgba(0, 0, 0, .35); border: 1px solid rgba(230, 237, 241, .2); color: var(--frost); font: 400 11px var(--body); outline: none; }
.dev-outage-list { display: flex; flex-wrap: wrap; gap: 4px; max-height: 148px; overflow-y: auto; }
.dev-outage-list p { width: 100%; margin: 4px 0 1px; color: var(--graphite); font: 500 9px var(--mono); letter-spacing: .14em; }
.dev-outage { padding: 4px 7px; background: transparent; border: 1px solid rgba(230, 237, 241, .22); color: var(--haze); font: 500 9px var(--mono); cursor: pointer; }
.dev-outage:hover { border-color: #ff9d3d; color: #ff9d3d; }
.dev-outage.on { background: #ff9d3d; border-color: #ff9d3d; color: #12161a; }
.dev-flag { position: fixed; left: 50%; transform: translateX(-50%); bottom: 152px; z-index: 12; max-width: 92vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #00ffc6; font: 700 10px var(--mono); letter-spacing: .2em; text-shadow: 0 0 8px rgba(0, 255, 198, .6); pointer-events: none; }
`;

export function initDevTools({ player, operators, camera }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const panel = document.createElement('div');
  panel.className = 'dev-panel';
  const rows = [
    ...DEV_TOOLS.map((tool) => `<button type="button" class="dev-row" data-tool="${tool.id}"><b>${tool.name}</b><i></i><small>${tool.desc}</small></button>`),
    ...DEV_ACTIONS.map((action) => `<button type="button" class="dev-row act" data-act="${action.id}"><b>${action.name}</b><i></i><small>${action.desc}</small></button>`),
  ].join('');
  panel.innerHTML = `<header><b>DEV TOOLS</b><small>K to close</small></header><div class="dev-list">${rows}</div>
    <div class="dev-outages"><b>PULL SOMETHING</b><small>Disables it for everyone, now. Say why, or leave it blank.</small>
      <input id="dev-outage-why" maxlength="140" placeholder="Reason (optional)" />
      <div class="dev-outage-list"></div></div>
    <footer>Your account only. Bots never get these.</footer>`;
  const esp = document.createElement('canvas');
  esp.className = 'dev-esp';
  const flag = document.createElement('div');
  flag.className = 'dev-flag';
  document.body.append(panel, esp, flag);
  const context = esp.getContext('2d');

  const allowed = () => Boolean(game.profile?.dev);
  // The list redraws whenever the server says something changed, so two developers never disagree.
  const why = () => panel.querySelector('#dev-outage-why');
  function drawOutages() {
    const list = panel.querySelector('.dev-outage-list');
    if (!list) return;
    const out = game.outages || {};
    const rowFor = (kind, id, name) => {
      const on = Boolean(out[kind]?.[id]);
      return `<button type="button" class="dev-outage${on ? ' on' : ''}" data-outage="${kind}:${id}" title="${on ? 'Put it back' : 'Pull it'}">${name}</button>`;
    };
    list.innerHTML = `<p>Arenas</p>${MAP_IDS.map((id) => rowFor('map', id, id)).join('')}
      <p>Weapons</p>${Object.values(WEAPONS).filter((weapon) => !weapon.melee).map((weapon) => rowFor('weapon', weapon.id, weapon.short || weapon.name)).join('')}`;
  }
  bus.on('outages', drawOutages);
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-outage]');
    if (!button || !allowed()) return;
    const [kind, id] = button.dataset.outage.split(':');
    const on = !button.classList.contains('on');
    net.send({ type: 'outage', kind, id, on, reason: on ? why()?.value || '' : '' });
    play(on ? 'deny' : 'ready');
  });
  const on = {};                      // what is switched on right now
  const serverTool = Object.fromEntries(DEV_TOOLS.map((tool) => [tool.id, Boolean(tool.server)]));

  function paint() {
    for (const button of panel.querySelectorAll('[data-tool]')) button.classList.toggle('on', Boolean(on[button.dataset.tool]));
    const live = DEV_TOOLS.filter((tool) => on[tool.id]).map((tool) => tool.name.toUpperCase());
    flag.textContent = live.length ? `DEV · ${live.join(' · ')}` : '';
  }
  function set(id, value) {
    if (!allowed()) return;
    on[id] = value;
    if (id in devState) devState[id] = value;
    if (serverTool[id]) net.send({ type: 'dev', tool: id, on: value });
    paint();
  }
  const open = () => panel.classList.contains('on');
  function toggleMenu(show = !open()) {
    if (!allowed()) return;
    panel.classList.toggle('on', show);
    if (show) document.exitPointerLock?.();
    play(show ? 'ui' : 'uiBack');
  }

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !allowed()) return;
    if (button.dataset.tool) { set(button.dataset.tool, !on[button.dataset.tool]); play('ui'); return; }
    if (button.dataset.act === 'teleport') {
      // Where you are looking, a step back from whatever it hits.
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const from = camera.position;
      const [hit] = player.arena.physics.raycast?.([from.x, from.y, from.z], [dir.x, dir.y, dir.z], 300) || [];
      const reach = hit ? Math.max(0.5, hit.t0 - 0.6) : 40;
      net.send({ type: 'dev', action: 'teleport', to: [from.x + dir.x * reach, from.y + dir.y * reach + 0.1, from.z + dir.z * reach] });
    } else net.send({ type: 'dev', action: button.dataset.act });
    play('ready');
  });
  // The server is the one that decides: whatever it says is on, is on.
  net.on('dev', (message) => {
    const tools = message.tools || {};
    for (const tool of DEV_TOOLS) if (tool.server) { on[tool.id] = Boolean(tools[tool.id]); if (tool.id in devState) devState[tool.id] = Boolean(tools[tool.id]); }
    paint();
  });
  // Capture, so the game's own key handling can't swallow it first.
  window.addEventListener('keydown', (event) => {
    const isK = event.code ? event.code === 'KeyK' : String(event.key).toLowerCase() === 'k';
    if (!isK || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (typing || !allowed()) return;
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  }, true);

  // ---- ESP: every pilot, through everything.
  const point = new THREE.Vector3();
  function drawEsp() {
    const width = Math.round(innerWidth), height = Math.round(innerHeight);
    if (esp.width !== width || esp.height !== height) { esp.width = width; esp.height = height; }
    context.clearRect(0, 0, width, height);
    const me = camera.position;
    for (const [id, entry] of game.roster) {
      if (id === game.id) continue;
      const pose = operators.poseOf(id);
      if (!pose) continue;
      const foe = isEnemy(id);
      const feet = point.set(pose.x, pose.y, pose.z).project(camera);
      const behind = feet.z > 1;
      const head = new THREE.Vector3(pose.x, pose.y + 1.85, pose.z).project(camera);
      if (behind) continue;
      const x = (feet.x * 0.5 + 0.5) * width, yFeet = (-feet.y * 0.5 + 0.5) * height, yHead = (-head.y * 0.5 + 0.5) * height;
      const boxHeight = Math.max(8, yFeet - yHead), boxWidth = boxHeight * 0.45;
      const dist = Math.round(Math.hypot(pose.x - me.x, pose.y - me.y, pose.z - me.z));
      context.strokeStyle = foe ? '#ff4d3d' : '#6ce6d1';
      context.lineWidth = 1.5;
      context.strokeRect(x - boxWidth / 2, yHead, boxWidth, boxHeight);
      context.fillStyle = 'rgba(8,12,16,.55)';
      context.fillRect(x - boxWidth / 2, yHead - 15, boxWidth, 13);
      context.fillStyle = foe ? '#ffb0a8' : '#c8fff4';
      context.font = '500 11px "Geist Mono", ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillText(`${entry.name} ${dist}m`, x, yHead - 5);
      // A line from the bottom of the screen, so you can see where they are without looking away.
      context.globalAlpha = 0.25;
      context.beginPath(); context.moveTo(width / 2, height); context.lineTo(x, yFeet); context.stroke();
      context.globalAlpha = 1;
    }
  }

  // ---- Aimbot: the nearest enemy in front of you, tracked by the head.
  const aim = new THREE.Vector3();
  function runAimbot(dt) {
    if (!player.alive || game.screen !== 'game') return;
    const me = camera.position;
    let best = null, bestScore = Infinity;
    for (const [id] of game.roster) {
      if (id === game.id || !isEnemy(id)) continue;
      const pose = operators.poseOf(id);
      if (!pose) continue;
      aim.set(pose.x - me.x, pose.y + 1.6 - me.y, pose.z - me.z);
      const dist = aim.length();
      if (dist > 220) continue;
      const wantYaw = Math.atan2(-aim.x, -aim.z);
      const off = Math.abs(Math.atan2(Math.sin(wantYaw - player.yaw), Math.cos(wantYaw - player.yaw)));
      if (off > 1.4) continue;                       // only what is roughly in front of you
      const score = off * 40 + dist * 0.2;
      if (score < bestScore) { bestScore = score; best = { yaw: wantYaw, pitch: Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) }; }
    }
    if (!best) return;
    const k = Math.min(1, dt * 18);
    player.yaw += Math.atan2(Math.sin(best.yaw - player.yaw), Math.cos(best.yaw - player.yaw)) * k;
    player.pitch += (best.pitch - player.pitch) * k;
  }

  paint();
  drawOutages();
  return {
    update(dt) {
      if (!allowed()) { if (flag.textContent) { flag.textContent = ''; } panel.classList.remove('on'); esp.style.display = 'none'; return; }
      const playing = game.screen === 'game';
      esp.style.display = devState.esp && playing ? 'block' : 'none';
      flag.style.display = playing ? 'block' : 'none';
      if (!playing) { if (open()) toggleMenu(false); return; }
      if (devState.esp) drawEsp();
      if (devState.aimbot) runAimbot(dt);
    },
  };
}
export { DEV_FLY_LIFT };
