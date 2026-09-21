// Anti-cheat, page side.
//
// It watches for script injection — userscript managers, scripts appended to
// the document after boot, browser built-ins that have been swapped out, and
// the game's own entry points being replaced. When it finds one it escalates:
// warn, then make the screen genuinely unpleasant to play on, then ask the
// server to kick the tab. Every stage reverses the moment the page comes back
// clean, so "turn the script off" is always the way out.
//
// Developer tools are deliberately untouched: no detection, no debugger traps,
// no console clearing. Reading the code and poking at it is fine.
import { net } from './net.js';
import { FLAG, GUARD, guardSignature, reasonText } from '../shared/guard.js';

// ---------------------------------------------------------------- boot snapshot
// Grabbed while this module evaluates, before anything else gets a chance to
// swap them out. Everything later is compared against these.
const nativeToString = Function.prototype.toString;
const defineProperty = Object.defineProperty;
const getDescriptor = Object.getOwnPropertyDescriptor;
const setTimer = globalThis.setTimeout;
const clearTimer = globalThis.clearTimeout;

function looksNative(fn) {
  try { return /\{\s*\[native code\]\s*\}/.test(nativeToString.call(fn)); } catch { return false; }
}

// Only built-ins a cheat actually needs. Things ordinary extensions like to
// patch (fetch, XHR, addEventListener) are left out to keep false alarms down.
function nativeWatchlist() {
  const gl = globalThis.WebGLRenderingContext?.prototype;
  const gl2 = globalThis.WebGL2RenderingContext?.prototype;
  const entries = [
    ['Function.prototype.toString', nativeToString],
    ['WebSocket.prototype.send', globalThis.WebSocket?.prototype?.send],
    ['WebSocket.prototype.close', globalThis.WebSocket?.prototype?.close],
    ['JSON.parse', JSON.parse],
    ['JSON.stringify', JSON.stringify],
    ['Math.random', Math.random],
    ['performance.now', globalThis.performance?.now],
    ['requestAnimationFrame', globalThis.requestAnimationFrame],
    ['HTMLCanvasElement.getContext', globalThis.HTMLCanvasElement?.prototype?.getContext],
    // Wallhacks live here: draw calls and depth state on the GL context.
    ['WebGL.drawElements', gl?.drawElements],
    ['WebGL.drawArrays', gl?.drawArrays],
    ['WebGL.depthFunc', gl?.depthFunc],
    ['WebGL.disable', gl?.disable],
    ['WebGL2.drawElements', gl2?.drawElements],
    ['WebGL2.depthFunc', gl2?.depthFunc],
  ];
  return entries.filter(([, fn]) => typeof fn === 'function').map(([name, fn]) => ({ name, fn }));
}
const natives = nativeWatchlist();

// Scripts already on the page when we booted are the real ones.
const knownScripts = new WeakSet();
try { for (const node of document.querySelectorAll('script')) knownScripts.add(node); } catch { /* no DOM yet */ }
const scriptHosts = new Set([location.host, 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

// ---------------------------------------------------------------- state
const found = new Map();   // flag name → { detail, at, oneShot }
let flags = 0;
let since = 0;             // performance.now() seconds of the first unresolved detection
let stage = 0;             // 0 clean · 1 warned · 2 sabotaged · 3 kicked
let salt = null;
let heartbeatTimer = null;
let scanTimer = null;
let sabotage = null;
let lockedUntil = 0;
let overlay = null;
let notify = () => {};
let player = null;
let bootLook = null;

const seconds = () => performance.now() / 1000;

// An injected script or a poked cheat flag is a moment in time, not a state we
// can re-read, so those two stop counting once they have gone quiet for a
// while. Anything still installed re-trips within the second.
const oneShot = new Set(['injected', 'honeypot']);
const EVENT_TTL = GUARD.grace + GUARD.sabotage + 20;

function trip(name, detail) {
  const already = found.get(name);
  if (already) { already.at = seconds(); return; }
  found.set(name, { detail: detail || reasonText(name), at: seconds(), oneShot: oneShot.has(name) });
  flags |= FLAG[name] || 0;
  if (!since) since = seconds();
  console.warn(`[anti-cheat] ${name}: ${found.get(name).detail}`);
  review();
}

function clear(name) {
  if (!found.delete(name)) return;
  flags &= ~(FLAG[name] || 0);
  if (!found.size) { since = 0; review(); }
}

function expire() {
  const t = seconds();
  for (const [name, entry] of found) if (entry.oneShot && t - entry.at > EVENT_TTL) clear(name);
}

function worst() {
  for (const name of ['userscript', 'injected', 'api', 'patched', 'honeypot']) if (found.has(name)) return name;
  return 'injected';
}

// The most serious thing currently wrong, in words.
function headline() { return found.get(worst())?.detail || 'script injection'; }

// ---------------------------------------------------------------- detectors
// 1. Userscript managers. With @grant none a userscript runs in the page, so
//    its plumbing is visible from here.
const userscriptGlobals = ['GM_info', 'GM', 'GM_xmlhttpRequest', 'GM_setValue', 'GM_getValue', 'GM_addStyle',
  'GM_registerMenuCommand', 'GM_addElement', 'GM_notification', 'GM_setClipboard', 'unsafeWindow', '_GM_info', 'monkeyWindow'];

function scanUserscripts() {
  const hits = [];
  for (const name of userscriptGlobals) {
    try { if (name in globalThis && globalThis[name] !== undefined) hits.push(name); } catch { /* blocked getter */ }
  }
  // Tampermonkey and Violentmonkey both hang an object off window.external for
  // their "is it installed" handshake.
  try {
    const external = globalThis.external;
    for (const name of ['Tampermonkey', 'Violentmonkey', 'Greasemonkey']) if (external && external[name]) hits.push(`external.${name}`);
  } catch { /* cross-origin-ish */ }
  try { if (document.documentElement.hasAttribute('data-tampermonkey')) hits.push('data-tampermonkey'); } catch { /* no DOM */ }
  if (hits.length) trip('userscript', `userscript manager exposed ${hits.slice(0, 4).join(', ')}`);
  else clear('userscript');
}

// 2. Scripts appended after boot. Extension content scripts live in an isolated
//    world and never show up here; a userscript bridging into the page does.
function checkScript(node) {
  if (!node || node.nodeName !== 'SCRIPT' || knownScripts.has(node)) return;
  knownScripts.add(node);
  const src = node.src || '';
  if (src) {
    let host = '';
    try { host = new URL(src, location.href).host; } catch { host = 'unparseable'; }
    if (!scriptHosts.has(host)) trip('injected', `a script was loaded from ${host}`);
    return;
  }
  if ((node.textContent || '').trim().length > 0) trip('injected', 'inline script added to the page');
}

function watchDom() {
  try {
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        checkScript(node);
        if (node.querySelectorAll) for (const nested of node.querySelectorAll('script')) checkScript(nested);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* observer unavailable */ }
}

// 3. Built-ins that no longer look native, or are no longer the ones we booted with.
function scanNatives() {
  for (const entry of natives) {
    let live;
    try { live = pathValue(entry.name); } catch { continue; }
    if (live === undefined) continue;
    if (live !== entry.fn || !looksNative(live)) return trip('patched', `${entry.name} has been replaced`);
  }
  clear('patched');
}

function pathValue(name) {
  switch (name) {
    case 'Function.prototype.toString': return Function.prototype.toString;
    case 'WebSocket.prototype.send': return globalThis.WebSocket?.prototype?.send;
    case 'WebSocket.prototype.close': return globalThis.WebSocket?.prototype?.close;
    case 'JSON.parse': return JSON.parse;
    case 'JSON.stringify': return JSON.stringify;
    case 'Math.random': return Math.random;
    case 'performance.now': return globalThis.performance?.now;
    case 'requestAnimationFrame': return globalThis.requestAnimationFrame;
    case 'HTMLCanvasElement.getContext': return globalThis.HTMLCanvasElement?.prototype?.getContext;
    case 'WebGL.drawElements': return globalThis.WebGLRenderingContext?.prototype?.drawElements;
    case 'WebGL.drawArrays': return globalThis.WebGLRenderingContext?.prototype?.drawArrays;
    case 'WebGL.depthFunc': return globalThis.WebGLRenderingContext?.prototype?.depthFunc;
    case 'WebGL.disable': return globalThis.WebGLRenderingContext?.prototype?.disable;
    case 'WebGL2.drawElements': return globalThis.WebGL2RenderingContext?.prototype?.drawElements;
    case 'WebGL2.depthFunc': return globalThis.WebGL2RenderingContext?.prototype?.depthFunc;
    default: return undefined;
  }
}

// 4. The game's own entry points. window.__arena is handy for debugging and for
//    the screenshot harness, so it stays readable — it just stops being a place
//    to bolt an aimbot onto.
let watchedApi = [];
function sealApi(api) {
  try {
    defineProperty(globalThis, '__arena', { value: Object.seal(api), writable: false, configurable: false, enumerable: true });
  } catch { /* already locked */ }
  watchedApi = [
    { label: 'net.send', owner: net, key: 'send' },
    { label: 'net.enter', owner: net, key: 'enter' },
    { label: 'player.look', owner: Object.getPrototypeOf(player), key: 'look' },
    { label: 'player.tryFire', owner: Object.getPrototypeOf(player), key: 'tryFire' },
    { label: 'player.update', owner: Object.getPrototypeOf(player), key: 'update' },
  ].filter((entry) => typeof entry.owner?.[entry.key] === 'function').map((entry) => ({ ...entry, fn: entry.owner[entry.key] }));
}

function scanApi() {
  try {
    const descriptor = getDescriptor(globalThis, '__arena');
    if (!descriptor || descriptor.writable || descriptor.configurable || !Object.isSealed(descriptor.value)) {
      return trip('api', 'the window.__arena handle was rebuilt');
    }
  } catch { /* ignore */ }
  for (const entry of watchedApi) {
    // Sabotage swaps player.look on the instance on purpose; the prototype is
    // what we watch, so that is not a false alarm.
    if (entry.owner[entry.key] !== entry.fn) return trip('api', `${entry.label} has been replaced`);
  }
  clear('api');
}

// 5. Honeypots. Bait names a cheat script reaches for. They trip on assignment
//    only — never on a read — so that typing `window.` in the console, which
//    evaluates getters for autocomplete, cannot set one of these off.
const honeypots = ['aimbot', 'wallhack', 'godMode', 'noRecoil', 'infiniteAmmo', 'triggerBot', 'espEnabled', '__arenaCheat', '__arenaGod', '__arenaHack'];
function layHoneypots() {
  for (const name of honeypots) {
    try {
      if (name in globalThis) continue;
      let held;
      defineProperty(globalThis, name, {
        configurable: false,
        enumerable: false,
        get() { return held; },
        set(value) { held = value; trip('honeypot', `something set window.${name}`); },
      });
    } catch { /* taken already */ }
  }
}

// ---------------------------------------------------------------- escalation
function review() {
  if (stage === 3) return;
  if (!found.size) return standDown();
  const held = since ? seconds() - since : 0;
  if (stage === 0) return warn();
  if (stage === 1 && held >= GUARD.grace) return haze();
  if (stage === 2 && held >= GUARD.grace + GUARD.sabotage) return requestKick();
}

function warn() {
  stage = 1;
  banner(`Script injection detected — ${headline()}. Turn it off and this clears itself.`);
  notify('Anti-cheat: script injection detected. Turn the script off to keep playing.', 'warn');
}

function haze() {
  stage = 2;
  banner(`Still injected — ${headline()}. The game will stop cooperating until it is off.`);
  notify('Anti-cheat: your aim and your screen are being scrambled. Turn the script off.', 'warn');
  startSabotage();
}

function requestKick() {
  stage = 3;
  stopSabotage();
  net.send({ type: 'guard-report', reason: worst(), flags, detail: String(headline()).slice(0, 160) });
  // If the server is older than this page, or the socket is already gone, the
  // page locks itself out anyway.
  setTimer(() => { if (stage === 3 && !overlay) showKick({ reason: worst(), seconds: GUARD.lockout }); }, 3000);
}

// Called when the last detection goes away before the kick; the kick screen
// has its own way back in.
function standDown() {
  since = 0;
  if (stage === 0) return;
  stage = 0;
  stopSabotage();
  banner(null);
  notify('Anti-cheat: page is clean again.', 'good');
}

function banner(text) {
  const element = document.querySelector('#net-banner');
  if (!element) return;
  if (!text) { if (element.dataset.guard) { element.dataset.guard = ''; element.textContent = ''; element.classList.add('hidden'); } return; }
  element.dataset.guard = '1';
  element.textContent = text;
  element.classList.remove('hidden');
}

// ---------------------------------------------------------------- sabotage
// Local-only and fully reversible: nothing here is sent to the server, so the
// other nine people in the match are not dragged into it.
function styleSheet() {
  if (document.querySelector('#guard-style')) return;
  const style = document.createElement('style');
  style.id = 'guard-style';
  style.textContent = `
@keyframes guard-haze { 0% { filter: hue-rotate(0deg) saturate(1.4) blur(0px); transform: none; }
  25% { filter: hue-rotate(50deg) saturate(2.4) blur(1.6px); transform: rotate(.35deg) scale(1.01); }
  50% { filter: hue-rotate(-40deg) saturate(.4) blur(.4px) invert(.08); transform: translate(6px,-4px); }
  75% { filter: hue-rotate(120deg) saturate(3) blur(2.4px); transform: rotate(-.45deg) scale(.99); }
  100% { filter: hue-rotate(0deg) saturate(1.4) blur(0px); transform: none; } }
#arena-shell.guard-hazed #game-root { animation: guard-haze 2.6s ease-in-out infinite; }
#arena-shell.guard-hazed #hud { animation: guard-haze 3.7s ease-in-out infinite reverse; opacity: .75; }
#arena-shell.guard-hazed::after { content: 'SCRIPT INJECTION DETECTED // TURN IT OFF'; position: fixed; inset: auto 0 18% 0;
  text-align: center; font: 600 22px/1.4 'Geist Mono', monospace; letter-spacing: .28em; color: #ff5470;
  text-shadow: 0 0 18px rgba(255,84,112,.8); pointer-events: none; z-index: 60; animation: guard-haze 1.1s linear infinite; }
#guard-block { position: fixed; inset: 0; z-index: 9999; display: grid; place-content: center; gap: 14px; padding: 8vw; text-align: center;
  background: radial-gradient(circle at 50% 40%, rgba(60,0,14,.96), rgba(4,4,8,.99)); color: #ffe9ee; font-family: 'Geist', system-ui, sans-serif; }
#guard-block h2 { font: 600 30px/1.2 'Michroma', 'Geist', sans-serif; letter-spacing: .06em; margin: 0; color: #ff5470; }
#guard-block p { margin: 0; max-width: 46ch; font-size: 15px; line-height: 1.6; opacity: .88; }
#guard-block ol { text-align: left; max-width: 46ch; margin: 0 auto; font-size: 14px; line-height: 1.8; opacity: .8; }
#guard-block b { font-family: 'Geist Mono', monospace; font-size: 34px; color: #ffc857; }`;
  document.head.appendChild(style);
}

function startSabotage() {
  if (sabotage) return;
  styleSheet();
  document.querySelector('#arena-shell')?.classList.add('guard-hazed');
  // Aim: gain that wanders, an axis that flips, and a slow pull off target.
  if (player && !bootLook) {
    bootLook = player.look.bind(player);
    player.look = (dx, dy) => {
      const wobble = Math.sin(seconds() * 1.7);
      const gain = 0.45 + wobble * 0.9;                 // goes negative: the axis inverts
      bootLook(dx * gain + (Math.random() - 0.5) * 0.004, dy * (0.5 + Math.cos(seconds() * 1.1) * 0.7));
    };
  }
  sabotage = setInterval(() => {
    if (bootLook) bootLook(Math.sin(seconds() * 0.9) * 0.012, Math.cos(seconds() * 0.7) * 0.008);
    // Every few seconds the mouse is handed back, which is hard to miss.
    if (Math.random() < 0.06) document.exitPointerLock?.();
  }, 50);
}

function stopSabotage() {
  if (!sabotage) return;
  clearInterval(sabotage);
  sabotage = null;
  document.querySelector('#arena-shell')?.classList.remove('guard-hazed');
  if (bootLook && player) { delete player.look; bootLook = null; }
}

// ---------------------------------------------------------------- kick screen
function showKick(message) {
  styleSheet();
  lockedUntil = seconds() + (Number(message.seconds) || GUARD.lockout);
  stage = 3;
  stopSabotage();
  banner(null);
  net.holdRoom(null);
  net.suspend?.();
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'guard-block';
    overlay.innerHTML = `<h2>Kicked by anti-cheat</h2><p id="guard-why"></p>
      <ol><li>Open your userscript manager and disable its scripts for this site (or switch the extension off).</li>
      <li>Close any console snippets or injected bookmarklets.</li>
      <li>Wait for the countdown, then reload.</li></ol>
      <b id="guard-count"></b><p id="guard-state">Checking…</p>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('#guard-why').textContent = `We found ${reasonText(message.reason)}. Developer tools are fine — this is about injected scripts.`;
  overlay.style.display = 'grid';
  tickKick();
}

let kickTimer = null;
function tickKick() {
  clearTimer(kickTimer);
  if (!overlay) return;
  const left = Math.max(0, Math.ceil(lockedUntil - seconds()));
  overlay.querySelector('#guard-count').textContent = left ? `${left}s` : '';
  const dirty = found.size > 0;
  overlay.querySelector('#guard-state').textContent = dirty
    ? `Still running: ${headline()}. The countdown restarts while it is on.`
    : left > 0 ? 'Page looks clean — sit out the rest of the countdown.' : 'Page looks clean. Letting you back in…';
  // Kicked until it is off: while anything is still injected the clock resets.
  if (dirty) lockedUntil = Math.max(lockedUntil, seconds() + 5);
  if (!dirty && left <= 0) return rejoin();
  kickTimer = setTimer(tickKick, 500);
}

function rejoin() {
  if (overlay) overlay.style.display = 'none';
  stage = 0;
  since = 0;
  net.resume?.();
  notify('Anti-cheat cleared — you are back in.', 'good');
}

// ---------------------------------------------------------------- heartbeat
function heartbeat() {
  if (!salt || stage === 3) return;
  net.send({ type: 'guard', sig: guardSignature(salt, flags), flags });
}

// ---------------------------------------------------------------- start
export function startGuard(options) {
  player = options.player;
  notify = options.notify || notify;
  sealApi(options.api);
  layHoneypots();
  watchDom();
  scanUserscripts();
  scanNatives();
  scanApi();
  scanTimer = setInterval(() => { scanUserscripts(); scanNatives(); scanApi(); expire(); review(); }, 1000);
  heartbeatTimer = setInterval(heartbeat, GUARD.heartbeat * 1000);

  net.on('guard-challenge', (message) => { salt = message.salt; heartbeat(); });
  net.on('kicked', (message) => showKick(message));
  return { found, stop() { clearInterval(scanTimer); clearInterval(heartbeatTimer); stopSabotage(); } };
}
