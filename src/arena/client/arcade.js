// The Games page: eight coin games, one table at a time. The stake and the button that plays are on the
// left, the game is in the middle, your last bets are on the right. Every outcome is decided on the
// server (server/economy.js); this draws what it was told, and never shows a result before the
// animation that leads up to it has finished.
import { CARD_NAMES, COINFLIP, CRASH, DICE, MINES, PLINKO, SLOTS, STAKE, WHEEL, crashAt, diceMultiplier, hiloMultiplier, hiloOdds, minesMultiplier } from '../shared/economy.js';
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const whole = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const now = () => performance.now() / 1000;
const SLOT_ROW = 84, SLOT_TIMES = [1.1, 1.5, 1.9], WHEEL_TIME = 4.4, PLINKO_STEP = 0.16;
const GAME_TIME = { coinflip: 1.6, dice: 1.3, slots: SLOT_TIMES[2], plinko: PLINKO.rows * PLINKO_STEP + 0.35, hilo: 0.9, wheel: WHEEL_TIME };
const GAMES = [
  { id: 'crash', name: 'Crash', top: `×${CRASH.max}`, blurb: 'It climbs until it crashes. Cash out first.', go: 'Bet' },
  { id: 'mines', name: 'Mines', top: `×${MINES.max}`, blurb: 'Every safe tile pays more. One mine takes the lot.', go: 'Lay the field' },
  { id: 'plinko', name: 'Plinko', top: `×${Math.max(...PLINKO.multipliers)}`, blurb: 'Drop it and see where it lands.', go: 'Drop' },
  { id: 'wheel', name: 'Wheel', top: `×${Math.max(...WHEEL.segments)}`, blurb: 'Forty segments. One spin.', go: 'Spin' },
  { id: 'hilo', name: 'Higher or lower', short: 'Hi-Lo', top: '×12', blurb: 'Call the next card. A tie loses.', go: '' },
  { id: 'dice', name: 'Dice', top: `×${diceMultiplier(DICE.min)}`, blurb: 'Roll under your target. You set the odds.', go: 'Roll' },
  { id: 'slots', name: 'Slots', top: `×${Math.max(...SLOTS.symbols.map((symbol) => symbol.three))}`, blurb: 'Three reels. Pairs pay too.', go: 'Spin' },
  { id: 'coinflip', name: 'Coin flip', short: 'Coin', top: `×${COINFLIP.payout}`, blurb: 'Heads or tails.', go: 'Flip' },
];
const NAMES = Object.fromEntries(GAMES.map((entry) => [entry.id, entry.name]));
// A glyph a tile, drawn in the page's own line style.
const ICONS = {
  crash: '<path d="M3 20 C9 19 13 14 16 4" /><path d="M16 4l-5 1M16 4l1 5" />',
  mines: '<circle cx="12" cy="13" r="6" /><path d="M12 7V3M17 8l2.5-2.5M7 8 4.5 5.5" />',
  plinko: '<circle cx="12" cy="4" r="1.6" /><circle cx="8" cy="10" r="1.2" /><circle cx="16" cy="10" r="1.2" /><circle cx="4" cy="16" r="1.2" /><circle cx="12" cy="16" r="1.2" /><circle cx="20" cy="16" r="1.2" /><path d="M2 21h20" />',
  wheel: '<circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />',
  hilo: '<rect x="5" y="3" width="14" height="18" rx="2" /><path d="M12 8l3 4h-6zM12 17l-3-3h6z" />',
  dice: '<rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="15" r="1" /><circle cx="15" cy="9" r="1" /><circle cx="9" cy="15" r="1" />',
  slots: '<rect x="3" y="5" width="18" height="14" rx="1" /><path d="M9 5v14M15 5v14M6 12h.01M12 12h.01M18 12h.01" />',
  coinflip: '<ellipse cx="12" cy="12" rx="9" ry="9" /><ellipse cx="12" cy="12" rx="4" ry="9" />',
};
const icon = (id) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[id]}</svg>`;
const WHEEL_TONE = { 0: '#1d262f', 1.5: '#1f6f66', 2: '#2d5fa8', 3: '#7a4fc9', 10: '#ffb547' };

let ctx = null;              // { redraw, refreshCoins, toast, coins, onPage }
let pick = 'crash';          // the game on the table
let stake = 10;
let busy = false;            // one request at a time
let side = 'heads', target = 50, mineCount = 3, crashAuto = '';
let flip = null, dice = null, slots = null, plinko = null, hilo = null, wheel = null;   // { result, at }
let wheelRest = 0;           // where the wheel stopped, so the next spin starts from there
let crashGame = null;        // { phase: 'running' | 'done', stake, auto, start, result }
let mines = null;            // a field in play: { stake, count, picked, multiplier, next }
let minesOver = null;        // the last field, shown until the next one: the server's result
let minesAsked = false;
let framing = false;

const coins = (n) => ctx.coins(n);
const settled = (state) => state && now() - state.at >= GAME_TIME[state.result.game];
const running = (state) => Boolean(state) && !settled(state);
const stateOf = (id) => ({ coinflip: flip, dice, slots, plinko, hilo, wheel })[id] || null;
const anyRunning = () => running(flip) || running(dice) || running(slots) || running(plinko) || running(hilo) || running(wheel);
const stakeOk = () => {
  if (!(stake >= STAKE.min && stake <= STAKE.max && Number.isInteger(stake))) { ctx.toast(`Stake ${STAKE.min} to ${STAKE.max}.`, 'warn'); play('deny'); return false; }
  if (stake > game.profile.coins) { ctx.toast('Not enough coins.', 'warn'); play('deny'); return false; }
  return true;
};
function request(message) { if (busy) return; busy = true; net.send(message); }

// ---------------------------------------------------------------- the tables
function crashTable() {
  const round = crashGame;
  const live = round?.phase === 'running';
  const result = round?.phase === 'done' ? round.result : null;
  const mult = live ? crashAt(net.time() - round.start) : result ? (result.detail.cashed || result.detail.crash) : 1;
  const state = live ? 'live' : result ? (result.detail.cashed ? 'cashed' : 'crashed') : '';
  const line = result ? (result.detail.cashed ? `Cashed at ×${result.detail.cashed}. It crashed at ×${result.detail.crash}.` : `Crashed at ×${result.detail.crash}.`) : live ? 'Climbing.' : 'Place a bet to launch.';
  return `<div class="arc-crash ${state}"><svg viewBox="0 0 300 140" preserveAspectRatio="none"><path id="crash-line" d="M0 140" /></svg>
    <div class="arc-crash-read"><b id="crash-mult">×${mult.toFixed(2)}</b><small>${line}</small></div></div>`;
}
function minesTable() {
  const over = minesOver, live = mines;
  const count = live?.count || over?.detail.count || mineCount;
  const picked = new Set(live ? live.picked : over ? over.detail.picked : []);
  const bombs = new Set(over ? over.detail.mines : []);
  const cells = Array.from({ length: MINES.cells }, (_, cell) => {
    const state = over && cell === over.detail.hit ? 'boom' : picked.has(cell) ? 'safe' : bombs.has(cell) ? 'mine' : '';
    return `<button type="button" class="arc-cell ${state}" data-mine-cell="${cell}" ${live && !state && !busy ? '' : 'disabled'} aria-label="Tile ${cell + 1}"><i></i></button>`;
  }).join('');
  const mult = live ? live.multiplier : over ? (over.detail.cashed || 0) : 1;
  const head = live
    ? `<span><small>Now</small><b>×${mult.toFixed(2)}</b></span><span><small>Next tile</small><b class="up">×${live.next.toFixed(2)}</b></span><span><small>Safe left</small><b>${MINES.cells - count - live.picked.length}</b></span>`
    : over ? `<span><small>${over.detail.cashed ? 'Cashed at' : 'Hit a mine'}</small><b class="${over.detail.cashed ? 'up' : 'down'}">${over.detail.cashed ? `×${over.detail.cashed.toFixed(2)}` : 'Lost'}</b></span><span><small>Mines</small><b>${count}</b></span>`
      : `<span><small>Mines</small><b>${count}</b></span><span><small>First tile</small><b class="up">×${minesMultiplier(count, 1).toFixed(2)}</b></span><span><small>Five tiles</small><b class="up">×${minesMultiplier(count, 5).toFixed(2)}</b></span>`;
  return `<div class="arc-mines"><div class="arc-mines-head">${head}</div><div class="arc-field${live ? ' live' : ''}">${cells}</div></div>`;
}
function plinkoTable() {
  const rows = PLINKO.rows, gap = 22, top = 16, rowH = 18, width = gap * (rows + 2), mid = width / 2;
  const pegs = [];
  for (let r = 0; r < rows; r += 1) for (let i = 0; i <= r + 1; i += 1) pegs.push(`<circle cx="${mid + (i - (r + 1) / 2) * gap}" cy="${top + r * rowH}" r="2.2" />`);
  const slotY = top + rows * rowH + 6;
  const landed = settled(plinko) ? plinko.result.detail.slot : -1;
  const pockets = PLINKO.multipliers.map((m, k) => `<g class="plinko-slot${k === landed ? ' hit' : ''}${m >= 2 ? ' hot' : m < 1 ? ' cold' : ''}"><rect x="${mid + (k - rows / 2) * gap - gap / 2 + 1}" y="${slotY}" width="${gap - 2}" height="16" rx="2" /><text x="${mid + (k - rows / 2) * gap}" y="${slotY + 11}">${m}</text></g>`).join('');
  return `<svg class="plinko-board arc-plinko" viewBox="0 0 ${width} ${slotY + 20}">${pegs.join('')}${pockets}<circle id="plinko-ball" cx="${mid}" cy="${top - 10}" r="5" class="${running(plinko) ? '' : 'hidden'}" /></svg>`;
}
function wheelTable() {
  const n = WHEEL.segments.length, step = 360 / n;
  const wedge = (i) => {
    const a0 = ((i * step - 90) * Math.PI) / 180, a1 = (((i + 1) * step - 90) * Math.PI) / 180;
    const p = (a, r) => `${(100 + Math.cos(a) * r).toFixed(2)} ${(100 + Math.sin(a) * r).toFixed(2)}`;
    return `<path d="M${p(a0, 58)} L${p(a0, 96)} A96 96 0 0 1 ${p(a1, 96)} L${p(a1, 58)} A58 58 0 0 0 ${p(a0, 58)}Z" fill="${WHEEL_TONE[WHEEL.segments[i]]}" />`;
  };
  const spinning = running(wheel);
  const landing = wheel ? -(wheel.result.detail.slot + 0.5) * step : wheelRest;
  const style = spinning ? `--from:${wheelRest}deg;--to:${landing - 360 * 6}deg;animation-delay:-${Math.min(WHEEL_TIME, now() - wheel.at).toFixed(2)}s` : `transform:rotate(${landing}deg)`;
  const shown = wheel && settled(wheel) ? wheel.result.detail.multiplier : null;
  const legend = [...new Set(WHEEL.segments)].sort((a, b) => a - b).map((m) => `<li${shown === m ? ' class="hit"' : ''}><i style="background:${WHEEL_TONE[m]}"></i><b>×${m}</b><small>${WHEEL.segments.filter((value) => value === m).length} of ${n}</small></li>`).join('');
  return `<div class="arc-wheel"><div class="arc-wheel-face"><svg viewBox="0 0 200 200" class="arc-wheel-disc${spinning ? ' spinning' : ''}" style="${style}">${Array.from({ length: n }, (_, i) => wedge(i)).join('')}${Array.from({ length: n }, (_, i) => { const a = ((i * step - 90) * Math.PI) / 180; return `<path d="M${(100 + Math.cos(a) * 58).toFixed(2)} ${(100 + Math.sin(a) * 58).toFixed(2)} L${(100 + Math.cos(a) * 96).toFixed(2)} ${(100 + Math.sin(a) * 96).toFixed(2)}" stroke="#0a0e12" stroke-width="1" />`; }).join('')}<circle cx="100" cy="100" r="96.5" fill="none" stroke="rgba(230,237,241,.3)" /></svg>
    <i class="arc-wheel-pin"></i><div class="arc-wheel-hub"><b>${shown === null ? (spinning ? '···' : 'SPIN') : `×${shown}`}</b></div></div><ul class="arc-legend">${legend}</ul></div>`;
}
function hiloTable() {
  const card = hilo && !settled(hilo) ? hilo.result.detail.card : game.profile.hiloCard || 7;
  const face = (value, extra = '') => `<div class="playing-card${extra}"><b>${CARD_NAMES[value]}</b></div>`;
  const ladder = CARD_NAMES.slice(1).map((name, i) => `<i class="${i + 1 === card ? 'on' : ''}">${name}</i>`).join('');
  return `<div class="arc-hilo"><div class="card-row">${face(hilo && settled(hilo) ? hilo.result.detail.card : card)}${hilo ? (settled(hilo) ? face(hilo.result.detail.next, ' flip') : '<div class="playing-card back"></div>') : '<div class="playing-card back"></div>'}</div>
    <div class="arc-ladder">${ladder}</div></div>`;
}
function diceTable() {
  const rolling = running(dice);
  const roll = dice && !rolling ? dice.result.detail.roll : null;
  const won = roll !== null && roll < dice.result.detail.target;
  return `<div class="arc-dice"><b class="arc-dice-face${roll === null ? '' : won ? ' up' : ' down'}" id="dice-roll" data-rolling="${rolling ? 1 : ''}">${roll ?? (dice ? '··' : '--')}</b>
    <div class="arc-track"><i class="win" style="width:${target - 1}%"></i>${roll === null ? '' : `<em class="${won ? 'up' : 'down'}" style="left:${roll - 0.5}%"></em>`}<span style="left:${target - 1}%"><small>${target}</small></span></div>
    <div class="arc-track-ends"><small>1</small><small>Roll under ${target} to win</small><small>100</small></div></div>`;
}
function slotsTable() {
  const reels = [0, 1, 2].map((index) => {
    const final = slots?.result.detail.reels[index];
    if (!final) return `<div class="arc-reel"><div class="slot-strip"><span>${SLOTS.symbols[index + 1].icon}</span></div></div>`;
    const strip = [...Array.from({ length: 14 }, (_, i) => SLOTS.symbols[(i * 7 + index * 3) % SLOTS.symbols.length].icon), SLOTS.symbols.find((sym) => sym.id === final).icon];
    return `<div class="arc-reel"><div class="slot-strip spinning" style="--end:${-(strip.length - 1) * SLOT_ROW}px;animation-duration:${SLOT_TIMES[index]}s;animation-delay:-${Math.min(SLOT_TIMES[index], now() - slots.at)}s">${strip.map((symbol) => `<span>${symbol}</span>`).join('')}</div></div>`;
  }).join('');
  const table = SLOTS.symbols.slice().reverse().map((sym) => `<li><b>${sym.icon}${sym.icon}${sym.icon}</b><span>×${sym.three}</span><b>${sym.icon}${sym.icon}</b><span>×${sym.two}</span></li>`).join('');
  return `<div class="arc-slots"><div class="arc-reels">${reels}</div><ul class="slot-table">${table}</ul></div>`;
}
function coinTable() {
  const end = flip ? (flip.result.detail.side === 'heads' ? 1800 : 1980) : 0;
  return `<div class="arc-coin"><div class="flip-coin${flip ? ' flipping' : ''}" style="${flip ? `--end:${end}deg;animation-delay:-${Math.min(1.6, now() - flip.at)}s` : ''}"><span class="face heads">H</span><span class="face tails">T</span></div></div>`;
}
const TABLES = { crash: crashTable, mines: minesTable, plinko: plinkoTable, wheel: wheelTable, hilo: hiloTable, dice: diceTable, slots: slotsTable, coinflip: coinTable };

// ---------------------------------------------------------------- the bet panel
function resultLine() {
  let diff = null;
  if (pick === 'crash') { const result = crashGame?.phase === 'done' ? crashGame.result : null; if (result) diff = result.payout - result.stake; }
  else if (pick === 'mines') { if (minesOver && !mines) diff = minesOver.payout - minesOver.stake; }
  else { const state = stateOf(pick); if (settled(state)) diff = state.result.payout - state.result.stake; }
  if (diff === null) return '<p class="arc-result">&nbsp;</p>';
  return `<p class="arc-result ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? `+${diff.toLocaleString('en')}` : diff < 0 ? diff.toLocaleString('en') : 'Even'}</p>`;
}
function optionsHtml() {
  if (pick === 'crash') return `<label class="arc-field-row">Auto cash-out<input id="crash-auto" type="number" min="${CRASH.minAuto}" max="${CRASH.max}" step="0.1" placeholder="Off" value="${escapeHtml(crashAuto)}" ${crashGame?.phase === 'running' ? 'disabled' : ''} /></label>`;
  if (pick === 'mines') return `<div class="arc-field-row">Mines<div class="arc-seg">${MINES.counts.map((n) => `<button type="button" data-mine-count="${n}" class="${mineCount === n ? 'active' : ''}" ${mines ? 'disabled' : ''}>${n}</button>`).join('')}</div></div>`;
  if (pick === 'coinflip') return `<div class="arc-field-row">Call it<div class="arc-seg">${['heads', 'tails'].map((value) => `<button type="button" data-coin-side="${value}" class="${side === value ? 'active' : ''}">${value === 'heads' ? 'Heads' : 'Tails'}</button>`).join('')}</div></div>`;
  if (pick === 'dice') return `<label class="arc-field-row">Target <output>${target}</output><input type="range" id="dice-target" min="${DICE.min}" max="${DICE.max}" step="1" value="${target}" /></label><p class="arc-odds"><span>${target - 1}% chance</span><b>×${diceMultiplier(target)}</b></p>`;
  return '';
}
function actionHtml() {
  const entry = GAMES.find((item) => item.id === pick);
  if (pick === 'crash') {
    const live = crashGame?.phase === 'running';
    return live ? `<button type="button" class="arc-go out" data-crash-out="1">Cash out ${coins(Math.floor(crashGame.stake * crashAt(net.time() - crashGame.start)))}</button>` : `<button type="button" class="arc-go" data-crash-start="1" ${busy ? 'disabled' : ''}>Bet ${coins(stake)}</button>`;
  }
  if (pick === 'mines') {
    if (!mines) return `<button type="button" class="arc-go" data-mines-start="1" ${busy ? 'disabled' : ''}>${entry.go} ${coins(stake)}</button>`;
    return `<button type="button" class="arc-go out" data-mines-out="1" ${busy || !mines.picked.length ? 'disabled' : ''}>${mines.picked.length ? `Cash out ${coins(Math.floor(mines.stake * mines.multiplier))}` : 'Turn a tile over'}</button>`;
  }
  if (pick === 'hilo') {
    const card = hilo && !settled(hilo) ? hilo.result.detail.card : game.profile.hiloCard || 7;
    const odds = (id) => { const m = hiloMultiplier(card, id); return m ? `×${m} · ${Math.round(hiloOdds(card, id) * 100)}%` : 'no chance'; };
    const off = (id) => (busy || running(hilo) || !hiloMultiplier(card, id) ? 'disabled' : '');
    return `<div class="arc-pair"><button type="button" class="arc-go" data-hilo="higher" ${off('higher')}>Higher<small>${odds('higher')}</small></button><button type="button" class="arc-go alt" data-hilo="lower" ${off('lower')}>Lower<small>${odds('lower')}</small></button></div>`;
  }
  return `<button type="button" class="arc-go" data-play-game="${pick}" ${busy || running(stateOf(pick)) ? 'disabled' : ''}>${entry.go} ${coins(stake)}</button>`;
}
function betHtml() {
  const locked = Boolean(mines) || crashGame?.phase === 'running';
  const chip = (label, value) => `<button type="button" data-stake="${value}" ${locked ? 'disabled' : ''}>${label}</button>`;
  return `<aside class="panel arc-bet">
    <p class="eyebrow">Your bet</p>
    <label class="arc-stake"><span>Stake</span><input id="game-stake" type="number" inputmode="numeric" min="${STAKE.min}" max="${STAKE.max}" step="1" value="${stake}" ${locked ? 'disabled' : ''} /></label>
    <div class="arc-chips">${chip('½', 'half')}${chip('2×', 'double')}${chip('Min', 'min')}${chip('Max', 'max')}</div>
    <div class="arc-chips quick">${[10, 50, 100, 250].map((n) => chip(n, n)).join('')}</div>
    ${optionsHtml()}
    ${actionHtml()}
    ${resultLine()}
    <small class="muted">Every game keeps about 5%. Play for fun.</small>
  </aside>`;
}

// ---------------------------------------------------------------- the page
const WHEN = (at) => { const s = (Date.now() - at) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
export function arcadeHtml() {
  // A field laid before a refresh is still there on the server: ask once, so it can be finished.
  if (!minesAsked && net.connected) { minesAsked = true; net.send({ type: 'mines', action: 'state' }); }
  const entry = GAMES.find((item) => item.id === pick);
  const tiles = GAMES.map((item) => `<button type="button" class="arc-tile${item.id === pick ? ' active' : ''}" data-arcade="${item.id}">${icon(item.id)}<b>${item.short || item.name}</b><small>${item.top}</small></button>`).join('');
  const played = game.profile.gameLog || [];
  const total = played.reduce((sum, bet) => sum + whole(bet.payout) - whole(bet.stake), 0);
  const wins = played.filter((bet) => whole(bet.payout) > whole(bet.stake)).length;
  const best = played.reduce((top, bet) => Math.max(top, whole(bet.payout) - whole(bet.stake)), 0);
  const log = played.map((bet) => { const diff = whole(bet.payout) - whole(bet.stake); return `<div class="arc-bet-row"><span>${NAMES[bet.game] || escapeHtml(bet.game)}<small>${escapeHtml(bet.note || '')}</small></span><em>${whole(bet.stake).toLocaleString('en')}</em><b class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${diff.toLocaleString('en')}</b><small>${WHEN(bet.at)}</small></div>`; }).join('') || '<p class="muted">No bets yet.</p>';
  return `<div class="arcade">
    <nav class="arc-tiles" aria-label="Games">${tiles}</nav>
    <div class="arc-desk">
      ${betHtml()}
      <section class="panel arc-table on-${pick}"><header><div><p class="eyebrow">${entry.name} <small>up to ${entry.top}</small></p><span>${entry.blurb}</span></div></header><div class="arc-stage">${TABLES[pick]()}</div></section>
      <aside class="panel arc-log"><p class="eyebrow">Last ${played.length} bets</p>
        <div class="arc-stats"><span><small>Net</small><b class="${total > 0 ? 'up' : total < 0 ? 'down' : ''}">${total > 0 ? '+' : ''}${total.toLocaleString('en')}</b></span><span><small>Won</small><b>${played.length ? Math.round((wins / played.length) * 100) : 0}%</b></span><span><small>Best</small><b>${best ? `+${best.toLocaleString('en')}` : '0'}</b></span></div>
        <div class="arc-bets">${log}</div></aside>
    </div></div>`;
}

// ---------------------------------------------------------------- clicks and typing
export function onArcadeClick(button) {
  const d = button.dataset;
  if (d.arcade) { if (GAMES.some((item) => item.id === d.arcade)) pick = d.arcade; play('ui'); startFrame(); return true; }
  if (d.stake) {
    const cap = Math.max(STAKE.min, Math.min(STAKE.max, game.profile.coins));
    stake = d.stake === 'max' ? cap : d.stake === 'min' ? STAKE.min : d.stake === 'half' ? Math.max(STAKE.min, Math.floor(stake / 2)) : d.stake === 'double' ? Math.min(STAKE.max, Math.max(STAKE.min, stake * 2)) : Number(d.stake);
    play('ui');
    return true;
  }
  if (d.coinSide) { side = d.coinSide === 'tails' ? 'tails' : 'heads'; play('ui'); return true; }
  if (d.mineCount && !mines) { mineCount = Number(d.mineCount); minesOver = null; play('ui'); return true; }
  if (d.crashStart) {
    if (!stakeOk()) return true;
    const auto = Number(crashAuto);
    request({ type: 'crash', action: 'start', stake, auto: auto >= CRASH.minAuto ? auto : null });
    return true;
  }
  if (d.crashOut) { net.send({ type: 'crash', action: 'out' }); play('ui'); return true; }
  if (d.minesStart) { if (!stakeOk()) return true; minesOver = null; request({ type: 'mines', action: 'start', stake, count: mineCount }); play('ready'); return true; }
  if (d.minesOut) { request({ type: 'mines', action: 'out' }); return true; }
  if (d.mineCell !== undefined && mines) { request({ type: 'mines', action: 'pick', cell: Number(d.mineCell) }); return true; }
  if (d.hilo) { if (!stakeOk()) return true; request({ type: 'game', game: 'hilo', stake, pick: d.hilo }); play('ready'); return true; }
  if (d.playGame) {
    if (!stakeOk()) return true;
    request({ type: 'game', game: d.playGame, stake, pick: side, target });
    play('ready');
    return true;
  }
  return false;
}
export function onArcadeInput(input) {
  if (input.id === 'game-stake') { stake = Math.floor(Number(input.value) || 0); const label = document.querySelector('.arc-go:not(.out) .coins'); if (label) label.lastChild.textContent = whole(stake).toLocaleString('en'); return true; }
  if (input.id === 'crash-auto') { crashAuto = input.value; return true; }
  if (input.id === 'dice-target') {
    // Updated in place: redrawing would drop the slider mid-drag.
    target = Number(input.value);
    const panel = input.closest('.arc-bet');
    panel.querySelector('output').textContent = target;
    panel.querySelector('.arc-odds').innerHTML = `<span>${target - 1}% chance</span><b>×${diceMultiplier(target)}</b>`;
    const track = document.querySelector('.arc-track');
    if (track) { track.querySelector('.win').style.width = `${target - 1}%`; const mark = track.querySelector('span'); mark.style.left = `${target - 1}%`; mark.querySelector('small').textContent = target; track.querySelector('em')?.remove(); }
    const ends = document.querySelector('.arc-track-ends small:nth-child(2)'); if (ends) ends.textContent = `Roll under ${target} to win`;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- what the server says
// The profile that came with a result is held until the animation has shown it: the balance in the
// bar should not give the ending away.
function later(seconds, profile, sound) {
  setTimeout(() => { if (profile) game.profile = profile; if (sound) play(sound); ctx.refreshCoins(); ctx.redraw(); }, seconds * 1000);
}
export function initArcade(context) {
  ctx = context;
  net.on('coins-result', (message) => {
    if (message.crashStarted) {
      busy = false;
      game.profile = message.profile;
      crashGame = { phase: 'running', ...message.crashStarted };
      play('ready'); ctx.refreshCoins(); ctx.redraw(); startFrame();
      return;
    }
    if ('mines' in message) {
      busy = false;
      mines = message.mines;
      if (message.profile) game.profile = message.profile;
      if (mines?.picked.length) play('xp', { volume: 0.5 });
      ctx.refreshCoins(); ctx.redraw();
      return;
    }
    if (!message.game) return;
    busy = false;
    const result = message.game;
    if (result.game === 'crash') {
      crashGame = { ...(crashGame || {}), phase: 'done', result };
      game.profile = message.profile;
      play(result.payout > result.stake ? 'buy' : 'deny'); ctx.refreshCoins(); ctx.redraw();
      return;
    }
    if (result.game === 'mines') {
      mines = null; minesOver = result;
      game.profile = message.profile;
      play(result.payout > result.stake ? 'buy' : 'deny'); ctx.refreshCoins(); ctx.redraw();
      return;
    }
    const state = { result, at: now() };
    if (result.game === 'wheel' && wheel) wheelRest = (-(wheel.result.detail.slot + 0.5) * (360 / WHEEL.segments.length)) % 360;
    ({ coinflip: () => { flip = state; }, dice: () => { dice = state; }, slots: () => { slots = state; }, plinko: () => { plinko = state; }, hilo: () => { hilo = state; }, wheel: () => { wheel = state; } })[result.game]?.();
    later(GAME_TIME[result.game] || 0, message.profile, result.payout > result.stake ? 'buy' : 'deny');
    ctx.redraw();
    startFrame();
  });
  net.on('coins-error', () => { busy = false; });
}
// The dice face flickers through numbers until the roll lands.
setInterval(() => { const face = document.querySelector('#dice-roll[data-rolling="1"]'); if (face) face.textContent = String(1 + Math.floor(Math.random() * 100)).padStart(2, '0'); }, 60);

// Crash and Plinko move every frame; the page itself only redraws when something settles.
export function startFrame() { if (!framing) { framing = true; requestAnimationFrame(frame); } }
function frame() {
  const board = document.querySelector('.arcade');
  const active = crashGame?.phase === 'running' || running(plinko);
  if (!board || !active) { framing = false; return; }
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
      const step = Math.min(PLINKO.rows, (now() - plinko.at) / PLINKO_STEP);
      const row = Math.floor(step), frac = step - row;
      const rightsAt = (r) => path.slice(0, r).reduce((sum, v) => sum + v, 0);
      const x0 = mid + (rightsAt(row) - row / 2) * gap, x1 = mid + (rightsAt(Math.min(PLINKO.rows, row + 1)) - (row + 1) / 2) * gap;
      ball.setAttribute('cx', (x0 + (x1 - x0) * frac).toFixed(1));
      ball.setAttribute('cy', (top - 8 + (row + frac) * rowH - Math.sin(frac * Math.PI) * 5).toFixed(1));
      ball.classList.remove('hidden');
    }
  }
  requestAnimationFrame(frame);
}
export const arcadeBusy = () => crashGame?.phase === 'running' || Boolean(mines) || anyRunning();
