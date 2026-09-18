// Arena selection UI: the lobby's map picker and the pre-match vote screen.
// Thumbnails are drawn straight from each map's collision boxes, so they are always accurate.
import { VARIANT_NAMES } from '../shared/constants.js';
import { MAP_INFO, getMap } from '../shared/map.js';
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const thumbs = new Map();
const PALETTES = {
  yard: ['#11171d', '#3c4a57', '#93a7b8'], atrium: ['#15181c', '#57595c', '#e6e2d6'], campanile: ['#1c1712', '#7a5a3c', '#e0b57e'],
  frostbite: ['#9fb0bf', '#5f7486', '#ffffff'], dustline: ['#7d633d', '#a27f4f', '#f0d39c'],
  foundry: ['#1b1614', '#5a3a2a', '#d8762a'], breakwater: ['#1d2329', '#2f6c70', '#cfd6db'], saffron: ['#5a5348', '#b0714f', '#f0c98a'],
  timberline: ['#24402c', '#5d5a4c', '#c9b48a'], line9: ['#15191d', '#3f474d', '#cfd6db'], terrace: ['#2a2f35', '#4a565f', '#9fd8e6'], ravelin: ['#a88c5c', '#8a6f48', '#f2ddb0'],
};

export function mapInfo(id) { return MAP_INFO.find((info) => info.id === id) || MAP_INFO[0]; }

// Top-down plan: ground, sunken routes, then structures shaded by height.
export function mapThumb(id, size = 220) {
  const key = `${id}:${size}`;
  if (thumbs.has(key)) return thumbs.get(key);
  const map = getMap(id);
  const { bounds } = map;
  const spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
  const scale = size / Math.max(spanX, spanZ);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d');
  const [ground, low, high] = PALETTES[id] || PALETTES.yard;
  const mix = (a, b, k) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
  context.fillStyle = 'rgba(0,0,0,0)';
  context.clearRect(0, 0, size, size);
  const ox = (size - spanX * scale) / 2, oz = (size - spanZ * scale) / 2;
  context.fillStyle = ground;
  context.fillRect(ox, oz, spanX * scale, spanZ * scale);
  const solid = map.boxes.filter((box) => !box.deco && box.min[0] >= bounds.minX - 1 && box.max[0] <= bounds.maxX + 1).sort((a, b) => a.max[1] - b.max[1]);
  for (const box of solid) {
    const top = box.max[1];
    if (top > -0.2 && top < 0.35) continue; // plain ground
    if (top > 8.5) continue;                 // perimeter
    const x = ox + (Math.max(box.min[0], bounds.minX) - bounds.minX) * scale, z = oz + (Math.max(box.min[2], bounds.minZ) - bounds.minZ) * scale;
    const w = Math.max(1, (Math.min(box.max[0], bounds.maxX) - Math.max(box.min[0], bounds.minX)) * scale), h = Math.max(1, (Math.min(box.max[2], bounds.maxZ) - Math.max(box.min[2], bounds.minZ)) * scale);
    if (top < -1.5) context.fillStyle = mix(ground, '#05080b', 0.55);
    else if (top <= -0.2) continue;
    else if (box.glass) context.fillStyle = '#6ce6d1';
    else context.fillStyle = mix(low, high, Math.min(1, top / 7));
    context.fillRect(x, z, w, h);
  }
  // Spawn ends.
  for (const [team, color] of [['A', '#6ce6d1'], ['B', '#ff7148']]) {
    const zone = map.spawnZones?.[team];
    if (!zone) continue;
    context.fillStyle = color; context.globalAlpha = 0.85;
    const z = team === 'A' ? oz + (bounds.maxZ - bounds.minZ) * scale - 3 : oz;
    context.fillRect(ox, z, spanX * scale, 3);
    context.globalAlpha = 1;
  }
  const url = canvas.toDataURL('image/png');
  thumbs.set(key, url);
  return url;
}

// <option> list for the lobby rules grid.
export function mapRuleOptions() {
  return [['vote', 'Lobby vote'], ['random', 'Random each match'], ...MAP_INFO.map((info) => [info.id, `${info.title} (${info.size})`])];
}

// One-line summary shown under the rules.
export function mapRuleSummary(rule) {
  if (rule === 'vote') return `Lobby votes from all ${MAP_INFO.length} arenas.`;
  if (rule === 'random') return 'Random arena. Never the same twice.';
  const info = mapInfo(rule);
  return `${info.title} (${info.size.toLowerCase()}, ${info.players}). ${info.blurb}`;
}

let voteTimer = null;
export function stopMapVote() { clearInterval(voteTimer); voteTimer = null; }

export function renderMapVote(container, room) {
  stopMapVote();
  const mine = room.mapVotes?.[game.id];
  const humans = room.players.filter((p) => !p.bot && p.connected).length;
  const cast = Object.keys(room.mapVotes || {}).length;
  const card = (id) => {
    const random = id === 'random';
    const info = random ? { title: 'Surprise me', size: 'Any size', players: '', style: 'Any arena', blurb: 'Let the dice decide.' } : mapInfo(id);
    const votes = room.mapTally?.[id] || 0;
    const variants = random ? '' : getMap(id).env.variants.map((v) => VARIANT_NAMES[v]).join(' · ');
    return `<button type="button" class="vote-card${mine === id ? ' chosen' : ''}${random ? ' random' : ''}" data-map-vote="${id}" aria-pressed="${mine === id}">
      <span class="vote-thumb"${random ? '' : ` style="background-image:url(${mapThumb(id, 160)})"`}>${random ? '?' : ''}</span>
      <span class="vote-body"><small>${escapeHtml(info.size)}${info.players ? ` · ${escapeHtml(info.players)}` : ''}</small><strong>${escapeHtml(info.title)}</strong><em>${escapeHtml(info.style)}</em><span>${escapeHtml(info.blurb)}</span>${variants ? `<i>${escapeHtml(variants)}</i>` : ''}</span>
      <span class="vote-count"><b>${votes}</b>${votes === 1 ? 'vote' : 'votes'}</span>
      <span class="vote-bar"><i style="width:${humans ? Math.round((votes / humans) * 100) : 0}%"></i></span>
    </button>`;
  };
  container.innerHTML = `<div class="lobby-card vote-screen vote-all">
      <div class="lobby-head"><div><p class="eyebrow">Arena vote // ${escapeHtml(room.name)}</p><h2>Pick the ground.</h2></div><div class="vote-clock"><b id="vote-seconds">–</b><small>SECONDS</small></div></div>
      <p class="lobby-status ok" id="vote-status">${cast}/${humans} voted.${mine ? ' You can still switch.' : ' Ties go random.'}</p>
      <div class="vote-grid">${(room.mapChoices || []).map(card).join('')}${card('random')}</div>
    </div>`;
  const label = container.querySelector('#vote-seconds');
  const tick = () => { if (label) label.textContent = String(Math.max(0, Math.ceil(room.phaseEnds - net.time()))); };
  tick();
  voteTimer = setInterval(() => { if (game.room?.phase !== 'mapvote') return stopMapVote(); tick(); }, 250);
  if (!container.dataset.voteBound) {
    container.dataset.voteBound = '1';
    container.addEventListener('click', (event) => {
      const id = event.target.closest('[data-map-vote]')?.dataset.mapVote;
      if (!id || game.room?.phase !== 'mapvote') return;
      net.send({ type: 'map-vote', id });
      play('ready');
    });
  }
}
