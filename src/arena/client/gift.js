// A present from a developer, full screen: it drops in, you open it, and it shows what was inside and
// the note that came with it. What was inside was already given when it was sent (server/gifts.js),
// so this is only the unwrapping, and closing it early costs nothing.
//
// It never lands in the middle of a fight. A gift that arrives mid round waits for the round to end,
// for you to die, or for you to be back in the menu.
import { COSMETICS } from '../shared/constants.js';
import { RARITY } from '../shared/economy.js';
import { KIND_LABEL } from '../shared/gifts.js';
import { bus, game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';
import { input, padName } from './input.js';
import { skinArt } from './weaponart.js';

const CSS = `
.gift-veil { position: fixed; inset: 0; z-index: 80; display: none; place-items: center; overflow: hidden; background: radial-gradient(ellipse at 50% 46%, rgba(20, 58, 54, .78), rgba(6, 9, 12, .95) 62%); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); font-family: var(--body); color: var(--frost); }
.gift-veil.on { display: grid; animation: gift-fade .35s var(--ease) both; }
.gift-veil .gift-inner { position: relative; display: flex; flex-direction: column; align-items: center; width: min(760px, calc(100vw - 32px)); max-height: 100vh; padding: 28px 0; }
.gift-kicker { font: 700 11px var(--mono); letter-spacing: .34em; color: #00ffc6; text-transform: uppercase; }
.gift-title { margin: 8px 0 0; font: 400 clamp(20px, 3.6vw, 32px)/1.15 var(--display); letter-spacing: .04em; text-align: center; }
.gift-title b { color: var(--signal); font-weight: 400; }
.gift-stage { position: relative; width: 300px; height: 300px; margin: 18px 0 6px; display: grid; place-items: center; }
.gift-rays { position: absolute; inset: -140px; border-radius: 50%; opacity: 0; background: repeating-conic-gradient(from 0deg, rgba(255, 213, 140, .34) 0 7deg, transparent 7deg 21deg); -webkit-mask: radial-gradient(circle, #000 12%, transparent 62%); mask: radial-gradient(circle, #000 12%, transparent 62%); pointer-events: none; }
.gift-glow { position: absolute; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(0, 255, 198, .35), transparent 68%); animation: gift-breathe 2.6s ease-in-out infinite; pointer-events: none; }
.gift-shadow { position: absolute; bottom: 40px; width: 170px; height: 22px; border-radius: 50%; background: rgba(0, 0, 0, .55); filter: blur(8px); animation: gift-shadow 2.4s ease-in-out infinite; }
.gift-box { position: relative; width: 176px; height: 196px; margin-top: 30px; cursor: pointer; border: 0; padding: 0; background: none; animation: gift-drop .9s cubic-bezier(.3, 1.45, .5, 1) both, gift-idle 2.4s ease-in-out .9s infinite; transform-origin: 50% 100%; }
.gift-box:focus-visible { outline: 0; }
.gift-box:focus-visible .gift-body, .gift-box:hover .gift-body { box-shadow: inset 0 -18px 30px rgba(0, 0, 0, .28), 0 0 0 2px rgba(255, 213, 140, .7), 0 0 44px rgba(0, 255, 198, .45); }
.gift-box:hover { animation: gift-drop .9s cubic-bezier(.3, 1.45, .5, 1) both, gift-eager .5s ease-in-out infinite; }
.gift-body { position: absolute; left: 8px; right: 8px; bottom: 0; height: 132px; border-radius: 6px; background:
  linear-gradient(90deg, transparent 43%, #ffb547 43%, #ffcf7a 50%, #ffb547 57%, transparent 57%),
  repeating-linear-gradient(135deg, rgba(255, 255, 255, .05) 0 10px, transparent 10px 20px),
  linear-gradient(160deg, #23a293, #0f5a53 70%, #0b403b);
  box-shadow: inset 0 -18px 30px rgba(0, 0, 0, .28), 0 12px 30px rgba(0, 0, 0, .4); transition: box-shadow .2s; }
.gift-lid { position: absolute; left: 0; right: 0; top: 40px; height: 36px; border-radius: 6px; z-index: 2; transform-origin: 70% 100%; background:
  linear-gradient(90deg, transparent 42%, #ffb547 42%, #ffd894 50%, #ffb547 58%, transparent 58%),
  linear-gradient(180deg, #34c3b1, #1a8175);
  box-shadow: 0 6px 14px rgba(0, 0, 0, .35); }
.gift-bow { position: absolute; left: 50%; top: -30px; width: 0; height: 0; }
.gift-bow i { position: absolute; top: 0; width: 46px; height: 32px; border: 9px solid #ffb547; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; background: rgba(255, 181, 71, .18); }
.gift-bow i:first-child { right: 2px; transform: rotate(-24deg); transform-origin: 100% 100%; }
.gift-bow i:nth-child(2) { left: 2px; transform: rotate(24deg); transform-origin: 0 100%; }
.gift-bow b { position: absolute; left: -12px; top: 16px; width: 24px; height: 20px; border-radius: 6px; background: linear-gradient(180deg, #ffd894, #f09a1f); box-shadow: 0 2px 6px rgba(0, 0, 0, .35); }
.gift-prompt { min-height: 20px; margin-top: 4px; font: 500 12px var(--mono); letter-spacing: .18em; color: var(--haze); text-transform: uppercase; animation: gift-blink 1.6s ease-in-out infinite; }
.gift-prompt kbd { margin: 0 4px; color: var(--frost); }
.gift-veil.shake .gift-box { animation: gift-shake .09s linear infinite !important; }
.gift-veil.shake .gift-glow { animation: gift-charge .75s ease-in forwards; }
.gift-veil.shake .gift-prompt, .gift-veil.open .gift-prompt { visibility: hidden; }
.gift-veil.open .gift-box { animation: gift-sink .7s var(--ease) forwards !important; cursor: default; }
.gift-veil.open .gift-lid { animation: gift-lid .9s cubic-bezier(.2, .7, .3, 1) forwards; }
.gift-veil.open .gift-rays { animation: gift-rays-in .6s var(--ease) forwards, gift-spin 16s linear infinite; }
.gift-veil.open .gift-glow { animation: none; opacity: 0; transition: opacity .6s; }
.gift-flash { position: absolute; inset: 0; background: #fff6de; opacity: 0; pointer-events: none; }
.gift-veil.open .gift-flash { animation: gift-flash .5s ease-out; }
.gift-bits { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.gift-bits i { position: absolute; width: var(--w); height: var(--h); background: var(--c); border-radius: 2px; opacity: 0; }
.gift-veil.open .gift-bits i { animation: gift-bit var(--t) cubic-bezier(.15, .7, .35, 1) var(--d) forwards; }
.gift-reveal { display: none; flex-direction: column; align-items: center; width: 100%; margin-top: -120px; position: relative; z-index: 3; }
.gift-veil.open .gift-reveal { display: flex; }
.gift-items { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; width: 100%; }
.gift-item { position: relative; width: 158px; padding: 0 0 12px; background: rgba(10, 15, 19, .92); border: 1px solid var(--tint, rgba(230, 237, 241, .2)); box-shadow: 0 0 26px color-mix(in srgb, var(--tint, #00ffc6) 28%, transparent), 0 14px 30px rgba(0, 0, 0, .45); text-align: center; opacity: 0; transform: translateY(26px) scale(.8); animation: gift-card .55s cubic-bezier(.3, 1.5, .5, 1) var(--delay) forwards; }
.gift-art { height: 92px; display: grid; place-items: center; background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--tint, #00ffc6) 30%, transparent), transparent 70%); border-bottom: 1px solid rgba(230, 237, 241, .08); overflow: hidden; }
.gift-art img { width: 150px; height: 84px; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, .5)); }
.gift-coin { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; font: 700 22px var(--display); color: #7a4b00; background: radial-gradient(circle at 35% 30%, #fff1c2, #ffc74f 40%, #d98f11 80%); box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .18), 0 0 22px rgba(255, 199, 79, .55); animation: gift-coin 2.2s ease-in-out infinite; }
.gift-xp { font: 400 26px var(--display); color: #9bb4ff; text-shadow: 0 0 18px rgba(155, 180, 255, .7); }
.gift-swatch { width: 56px; height: 56px; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 2px rgba(255, 255, 255, .5), 0 0 0 6px rgba(255, 255, 255, .08), 0 0 26px var(--swatch); }
.gift-glyph { font: 400 13px var(--display); letter-spacing: .12em; color: var(--tint, var(--frost)); text-transform: uppercase; }
.gift-item strong { display: block; margin: 10px 10px 0; font: 600 14px/1.25 var(--body); }
.gift-item small { display: block; margin-top: 3px; font: 500 10px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--tint, var(--haze)); }
.gift-item em { display: block; margin-top: 4px; font: 400 11px var(--mono); font-style: normal; color: var(--haze); }
.gift-note { position: relative; max-width: 560px; margin: 22px 0 0; padding: 14px 18px 14px 20px; background: rgba(10, 15, 19, .88); border-left: 3px solid #00ffc6; opacity: 0; animation: gift-card .6s var(--ease) var(--delay) forwards; }
.gift-note p { margin: 0; font: 400 16px/1.5 var(--body); white-space: pre-wrap; word-break: break-word; }
.gift-note cite { display: block; margin-top: 8px; font: 700 10px var(--mono); letter-spacing: .2em; color: #00ffc6; font-style: normal; text-transform: uppercase; }
.gift-actions { display: flex; gap: 10px; margin-top: 22px; opacity: 0; animation: gift-card .5s var(--ease) var(--delay) forwards; }
.gift-actions button { min-width: 180px; padding: 12px 22px; border: 1px solid var(--signal); background: var(--signal); color: #1a1206; font: 700 12px var(--mono); letter-spacing: .2em; text-transform: uppercase; }
.gift-actions button:hover, .gift-actions button:focus-visible { background: #ffc873; outline: 0; box-shadow: 0 0 24px rgba(255, 181, 71, .5); }
.gift-count { position: absolute; top: 16px; right: 18px; font: 700 10px var(--mono); letter-spacing: .2em; color: var(--haze); }
@keyframes gift-fade { from { opacity: 0; } }
@keyframes gift-drop { from { transform: translateY(-110vh) rotate(-14deg); } }
@keyframes gift-idle { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-8px) rotate(-2.5deg); } 50% { transform: translateY(0) rotate(0); } 62% { transform: translateY(-3px) rotate(3deg); } 70% { transform: rotate(-2deg); } 78% { transform: rotate(1deg); } }
@keyframes gift-eager { 0%, 100% { transform: rotate(0) scale(1.03); } 25% { transform: rotate(-4deg) scale(1.05); } 75% { transform: rotate(4deg) scale(1.05); } }
@keyframes gift-shadow { 0%, 100% { transform: scaleX(1); opacity: .55; } 25% { transform: scaleX(.86); opacity: .4; } }
@keyframes gift-breathe { 0%, 100% { transform: scale(.9); opacity: .7; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes gift-blink { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
@keyframes gift-shake { 0% { transform: translate(0, 0) rotate(0) scale(1.04); } 25% { transform: translate(-5px, 1px) rotate(-5deg) scale(1.06); } 50% { transform: translate(4px, -2px) rotate(4deg) scale(1.03); } 75% { transform: translate(-3px, 2px) rotate(-3deg) scale(1.07); } 100% { transform: translate(5px, 0) rotate(5deg) scale(1.05); } }
@keyframes gift-charge { to { transform: scale(1.9); opacity: 1; background: radial-gradient(circle, rgba(255, 222, 150, .75), rgba(0, 255, 198, .25) 45%, transparent 70%); } }
@keyframes gift-lid { 0% { transform: translate(0, 0) rotate(0); } 30% { transform: translate(-30px, -170px) rotate(-38deg); opacity: 1; } 100% { transform: translate(-150px, -60vh) rotate(-160deg); opacity: 0; } }
@keyframes gift-sink { to { transform: translateY(40px) scale(.84); opacity: .22; } }
@keyframes gift-rays-in { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
@keyframes gift-spin { to { rotate: 360deg; } }
@keyframes gift-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
@keyframes gift-bit { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)); } }
@keyframes gift-card { to { opacity: 1; transform: none; } }
@keyframes gift-coin { 0%, 100% { transform: rotateY(0); } 50% { transform: rotateY(180deg); } }
@media (prefers-reduced-motion: reduce) {
  .gift-box, .gift-box:hover, .gift-glow, .gift-shadow, .gift-prompt { animation: none !important; }
  .gift-veil.open .gift-rays { animation: gift-rays-in .3s both; }
  .gift-veil.open .gift-bits i, .gift-veil.open .gift-flash { animation: none; }
  .gift-item, .gift-note, .gift-actions { animation-duration: .01s !important; }
}
@media (max-height: 640px) { .gift-stage { width: 220px; height: 220px; margin: 6px 0 0; } .gift-reveal { margin-top: -80px; } }
`;

const CONFETTI = ['#ffb547', '#00ffc6', '#6ce6d1', '#ff5a8c', '#9bb4ff', '#ffe28a', '#f2f0ea'];
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cosmeticName = (kind, id) => COSMETICS[kind]?.find((item) => item.id === id)?.name || id;
const isColour = (id) => /^#[0-9a-f]{6}$/i.test(String(id));
// A colour dark enough to vanish on the card (Void Black, Blackout) still needs a border and a label
// you can read, so those fall back to frost; the swatch itself stays the true colour.
const readable = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? hex : '#c9d3da';
};

// One thing that was inside, as a card.
function card(item, index) {
  const delay = `${0.25 + index * 0.11}s`;
  let art, name, label, tint = '#00ffc6', note = '';
  if (item.kind === 'coins') {
    art = '<div class="gift-coin">C</div>';
    name = `${Number(item.amount).toLocaleString('en')}`;
    label = 'Coins';
    tint = '#ffc74f';
  } else if (item.kind === 'xp') {
    art = '<div class="gift-xp">XP</div>';
    name = `+${Number(item.amount).toLocaleString('en')}`;
    label = 'Experience';
    tint = '#9bb4ff';
    if (item.to > item.from) note = `Level ${item.from} to ${item.to}`;
  } else if (item.kind === 'skin') {
    const rarity = RARITY[item.rarity];
    tint = rarity?.color || tint;
    let url = '';
    try { url = skinArt('m44', item.id); } catch { url = ''; }
    art = url ? `<img src="${url}" alt="">` : `<div class="gift-glyph">${esc(rarity?.name || 'Skin')}</div>`;
    name = item.name;
    label = `${rarity?.name || ''} skin`;
    if (item.crate) note = item.had ? `From a ${item.crate}. Duplicate: +${item.refund || 0} coins` : `From a ${item.crate}`;
    else if (item.had) note = 'Already yours';
  } else {
    name = item.name || cosmeticName(item.kind, item.id);
    label = KIND_LABEL[item.kind] || item.kind;
    art = isColour(item.id) ? `<div class="gift-swatch" style="--swatch:${item.id}"></div>` : `<div class="gift-glyph">${esc(label)}</div>`;
    if (isColour(item.id)) tint = readable(item.id);
    if (item.had) note = 'Already yours';
  }
  return `<div class="gift-item" style="--delay:${delay};--tint:${tint}"><div class="gift-art">${art}</div><strong>${esc(name)}</strong><small>${esc(label)}</small>${note ? `<em>${esc(note)}</em>` : ''}</div>`;
}

export function initGifts() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const veil = document.createElement('div');
  veil.className = 'gift-veil';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.setAttribute('aria-label', 'A gift');
  document.body.append(veil);

  let queue = [];                 // gifts still to show, oldest first
  const seen = new Set();         // opened in this tab, so a late list never shows one twice
  let current = null;
  let stage = 'idle';             // idle → shut → opening → open
  let timers = [];
  let returnTo = null;            // whatever had the focus before the present took it

  const later = (ms, run) => timers.push(setTimeout(run, ms));
  const isOpen = () => veil.classList.contains('on');
  // Never mid fight: alive, in a match, with the round running.
  const busy = () => {
    // Not over the intro, and not over a card that is asking them something.
    if (document.querySelector('#boot, .notice-card:not(.hidden), .loading-card:not(.hidden)')) return true;
    return game.screen === 'game' && Boolean(game.you?.alive) && ['live', 'overtime', 'buy'].includes(game.room?.phase);
  };

  function prompt() {
    return input.mode === 'pad' ? `Press <kbd>${esc(padName('Pad0'))}</kbd> to open` : 'Click to open';
  }

  function show(gift) {
    if (!isOpen()) returnTo = document.activeElement;
    current = gift;
    stage = 'shut';
    timers.forEach(clearTimeout); timers = [];
    const bits = Array.from({ length: 64 }, () => {
      const angle = Math.random() * Math.PI * 2, reach = 160 + Math.random() * 360;
      const wide = Math.random() < 0.5;
      return `<i style="--x:${Math.round(Math.cos(angle) * reach)}px;--y:${Math.round(Math.sin(angle) * reach * 0.8 - 80)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${CONFETTI[Math.floor(Math.random() * CONFETTI.length)]};--w:${wide ? 10 : 6}px;--h:${wide ? 5 : 12}px;--t:${(1.1 + Math.random() * 0.9).toFixed(2)}s;--d:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
    }).join('');
    const more = queue.length;
    veil.className = 'gift-veil on';
    veil.innerHTML = `
      <div class="gift-flash"></div>
      ${more ? `<div class="gift-count">${more} MORE WAITING</div>` : ''}
      <div class="gift-inner">
        <div class="gift-kicker">Incoming</div>
        <h2 class="gift-title">A gift from <b>${esc(gift.from || 'the devs')}</b></h2>
        <div class="gift-stage">
          <div class="gift-rays"></div><div class="gift-glow"></div><div class="gift-shadow"></div>
          <div class="gift-bits">${bits}</div>
          <button type="button" class="gift-box" aria-label="Open the gift"><div class="gift-body"></div><div class="gift-lid"><div class="gift-bow"><i></i><i></i><b></b></div></div></button>
        </div>
        <div class="gift-prompt">${prompt()}</div>
        <div class="gift-reveal"></div>
      </div>`;
    const box = veil.querySelector('.gift-box');
    box.addEventListener('click', unwrap);
    document.exitPointerLock?.();
    later(60, () => box.focus({ preventScroll: true }));
    later(650, () => play('land', { volume: 0.7 }));
  }

  function unwrap() {
    if (stage !== 'shut' || !current) return;
    stage = 'opening';
    const gift = current;
    seen.add(gift.id);
    // Told straight away: it has been opened, whatever happens to this screen next.
    net.send({ type: 'gift-open', id: gift.id });
    veil.classList.add('shake');
    play('riser', { volume: 0.7 });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    later(reduced ? 80 : 780, () => {
      veil.classList.remove('shake');
      veil.classList.add('open');
      play('crateOpen');
      const items = Array.isArray(gift.items) ? gift.items : [];
      const noteDelay = 0.35 + items.length * 0.11;
      veil.querySelector('.gift-reveal').innerHTML = `
        <div class="gift-items">${items.map(card).join('') || '<div class="gift-item" style="--delay:.2s"><div class="gift-art"><div class="gift-glyph">Empty</div></div><strong>Nothing inside</strong></div>'}</div>
        ${gift.message ? `<div class="gift-note" style="--delay:${noteDelay.toFixed(2)}s"><p>${esc(gift.message)}</p><cite>${esc(gift.from || 'the devs')}</cite></div>` : ''}
        <div class="gift-actions" style="--delay:${(noteDelay + (gift.message ? 0.25 : 0)).toFixed(2)}s"><button type="button" data-collect>${queue.length ? `Next gift (${queue.length})` : 'Collect'}</button></div>`;
      const collect = veil.querySelector('[data-collect]');
      collect.addEventListener('click', done);
      later(reduced ? 50 : (noteDelay + 0.3) * 1000, () => { stage = 'open'; collect.focus({ preventScroll: true }); });
      later(reduced ? 0 : 420, () => play('xp', { volume: 0.8 }));
    });
  }

  function done() {
    if (stage !== 'open' && stage !== 'opening') return;
    play('ready');
    stage = 'idle';
    current = null;
    timers.forEach(clearTimeout); timers = [];
    veil.className = 'gift-veil';
    veil.replaceChildren();
    next();
    // Back to where they were, the terminal's line included, once the last present is put away.
    if (!isOpen() && returnTo?.isConnected && returnTo !== document.body) returnTo.focus({ preventScroll: true });
    if (!isOpen()) returnTo = null;
  }

  function next() {
    if (isOpen() || !queue.length) return;
    if (busy()) return;         // the poll below tries again
    show(queue.shift());
  }

  // The server sends every unopened gift whenever the list changes. Anything already on screen or
  // opened in this tab is left alone.
  net.on('gifts', (message) => {
    const list = Array.isArray(message.gifts) ? message.gifts : [];
    queue = list.filter((gift) => gift && gift.id && !seen.has(gift.id) && gift.id !== current?.id);
    next();
  });
  setInterval(next, 1000);

  // Keyboard and pad: the one obvious action for whatever is on screen.
  const act = () => {
    if (!isOpen()) return false;
    if (stage === 'shut') unwrap(); else if (stage === 'open') done();
    return true;
  };
  window.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    // Nothing reaches the game while a present is up.
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') { event.preventDefault(); if (!event.repeat) act(); }
    else if (event.key === 'Escape') { event.preventDefault(); if (stage === 'open') done(); }
  }, true);
  // In a match the pad is read by the player loop, which says so on the bus. In the menus the menu pad
  // clicks whatever has focus, and the focus is already on the box or the button.
  bus.on('pad-ui', (action) => { if (game.screen === 'game' && action === 'confirm') act(); });

  return { isOpen };
}
