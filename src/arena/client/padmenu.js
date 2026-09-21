// The menus on a controller. The in-game pad is polled by the player loop, which does not run out here,
// so this has its own loop that only ticks while a menu is up.
//
// Focus is the game's own focus: moving lands on real buttons and inputs, so the keyboard, the mouse and
// the pad all drive the same thing, and anything added to a page works without being registered here.
// Directions are spatial rather than document order: in a grid of cards, down goes to the card below.
import { game } from './state.js';
import { setInputMode } from './input.js';
import { play } from './audio.js';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const REPEAT_FIRST = 0.36, REPEAT_AFTER = 0.11;
const DEAD = 0.45;

const seen = (element) => {
  const box = element.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return null;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) < 0.05) return null;
  return box;
};
// Inside an open card (a notice, the dev panel), only that card's buttons are reachable: a modal should
// trap the pad the same way it traps a click.
function scope() {
  const card = [...document.querySelectorAll('.notice-card, .online-card, .loading-card')].find((el) => !el.classList.contains('hidden'));
  return card || document.querySelector('.menu-shell') || document.body;
}
const options = () => [...scope().querySelectorAll(FOCUSABLE)].map((el) => ({ el, box: seen(el) })).filter((entry) => entry.box);

// The nearest thing that way: mostly along the direction travelled, with a penalty for drifting sideways.
function step(from, dir) {
  const list = options();
  if (!list.length) return null;
  if (!from) return list[0].el;
  const box = from.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  let best = null, bestScore = Infinity;
  for (const { el, box: other } of list) {
    if (el === from) continue;
    const ox = other.left + other.width / 2, oy = other.top + other.height / 2;
    const along = dir === 'left' ? cx - ox : dir === 'right' ? ox - cx : dir === 'up' ? cy - oy : oy - cy;
    if (along <= 2) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(oy - cy) : Math.abs(ox - cx);
    const score = along + across * 2.4;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function move(dir) {
  const from = document.activeElement && scope().contains(document.activeElement) ? document.activeElement : null;
  const next = step(from, dir) || options()[0]?.el;
  if (!next || next === from) return;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  play('ui', { volume: 0.35 });
}
// Bumpers page through whatever tabs the page has, which is how a pad expects to move between them.
function tab(direction) {
  // In priority order, not document order: a comma list would find whichever came first in the page,
  // which on the skins wall is the rarity filter rather than the tabs.
  const row = document.querySelector('.shop-tabs') || document.querySelector('.group-tabs') || document.querySelector('.board-tabs') || document.querySelector('.segmented');
  if (!row) return;
  const buttons = [...row.querySelectorAll('button')];
  const at = buttons.findIndex((button) => button.classList.contains('active'));
  const next = buttons[(Math.max(0, at) + direction + buttons.length) % buttons.length];
  if (next) { next.click(); play('ui'); }
}
function back() {
  // Escape closes whatever is open. With nothing open it is the way back to the front page.
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  play('uiBack');
}

export function initPadMenu() {
  let prev = new Set(), wait = 0, held = false, last = performance.now();
  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game.screen === 'game') { prev = new Set(); return; }
    const pad = [...(navigator.getGamepads?.() || [])].find((entry) => entry && entry.connected);
    if (!pad) { prev = new Set(); return; }
    const down = new Set();
    pad.buttons.forEach((button, index) => { if (button.pressed || button.value > 0.4) down.add(`Pad${index}`); });
    const axis = (index) => { const value = pad.axes[index] || 0; return Math.abs(value) < DEAD ? 0 : Math.sign(value); };
    const dx = (down.has('Pad15') ? 1 : 0) - (down.has('Pad14') ? 1 : 0) || axis(0) || axis(2);
    const dy = (down.has('Pad13') ? 1 : 0) - (down.has('Pad12') ? 1 : 0) || axis(1) || axis(3);
    if (down.size || dx || dy) setInputMode('pad', pad);
    const tapped = (code) => down.has(code) && !prev.has(code);

    if (!dx && !dy) { wait = 0; held = false; } else if ((wait -= dt) <= 0) {
      wait = held ? REPEAT_AFTER : REPEAT_FIRST;
      held = true;
      if (dy) move(dy > 0 ? 'down' : 'up'); else move(dx > 0 ? 'right' : 'left');
    }
    if (tapped('Pad0')) { const focused = document.activeElement; if (focused && focused !== document.body) { focused.click(); play('ready', { volume: 0.5 }); } else move('down'); }
    if (tapped('Pad1') || tapped('Pad9')) back();
    if (tapped('Pad4')) tab(-1);
    if (tapped('Pad5')) tab(1);
    prev = down;
  };
  requestAnimationFrame(frame);
}
