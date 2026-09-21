// Rebindable controls. An input code is a KeyboardEvent.code ('KeyW'), a mouse button ('Mouse0') or a
// controller button ('Pad0'). Keyboard and controller keep their own bind tables, so a pad never takes
// a key away from anyone. Every keyboard action has two slots so the classic doubles (CTRL / C to
// crouch) still work after rebinding.
import { bus, game, saveSettings } from './state.js';

export const ACTIONS = [
  ['forward', 'Move forward', 'Movement'], ['back', 'Move back', 'Movement'], ['left', 'Strafe left', 'Movement'], ['right', 'Strafe right', 'Movement'],
  ['jump', 'Jump', 'Movement'], ['sprint', 'Sprint', 'Movement'], ['crouch', 'Crouch · slide', 'Movement'], ['walk', 'Walk · hold breath', 'Movement'],
  ['fire', 'Fire', 'Weapons'], ['scope', 'Aim / scope', 'Weapons'], ['reload', 'Reload', 'Weapons'],
  ['primary', 'Primary weapon', 'Weapons'], ['sidearm', 'Sidearm', 'Weapons'], ['melee', 'Blade', 'Weapons'],
  ['gadget1', 'Gadget 1', 'Weapons'], ['gadget2', 'Gadget 2', 'Weapons'], ['armoury', 'Armoury', 'Weapons'], ['interact', 'Pick up (royale)', 'Weapons'], ['inspect', 'Inspect weapon', 'Weapons'],
  ['ping', 'Ping location', 'Team'], ['radio', 'Radio commands', 'Team'], ['chat', 'Chat to all', 'Team'], ['teamChat', 'Chat to team', 'Team'], ['scoreboard', 'Scoreboard', 'Team'],
].map(([id, label, group]) => ({ id, label, group }));

export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space', null], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft', 'KeyC'], walk: ['AltLeft', 'KeyG'],
  fire: ['Mouse0', null], scope: ['Mouse2', null], reload: ['KeyR', null],
  primary: ['Digit1', null], sidearm: ['Digit2', null], melee: ['Digit3', null],
  gadget1: ['KeyQ', null], gadget2: ['KeyE', null], armoury: ['KeyB', null], interact: ['KeyF', null], inspect: ['KeyV', null],
  ping: ['KeyZ', 'Mouse1'], radio: ['KeyX', null], chat: ['Enter', null], teamChat: ['KeyY', null], scoreboard: ['Tab', null],
};
// Keys the game keeps for itself.
export const RESERVED = ['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight'];

// Which kind of controller a pad is, by its id, so the prompts show the right letters.
// Every pad reports the same button numbers; only the printing on them changes. A Nintendo pad has its
// face buttons the other way round, so its names are swapped to match what the pilot is looking at.
const DPAD = { Pad12: 'D-UP', Pad13: 'D-DOWN', Pad14: 'D-LEFT', Pad15: 'D-RIGHT' };
export const PAD_LAYOUTS = {
  xbox: { name: 'Xbox', names: { Pad0: 'A', Pad1: 'B', Pad2: 'X', Pad3: 'Y', Pad4: 'LB', Pad5: 'RB', Pad6: 'LT', Pad7: 'RT', Pad8: 'VIEW', Pad9: 'MENU', Pad10: 'L3', Pad11: 'R3', ...DPAD, Pad16: 'GUIDE' } },
  playstation: { name: 'PlayStation', names: { Pad0: '✕', Pad1: '○', Pad2: '□', Pad3: '△', Pad4: 'L1', Pad5: 'R1', Pad6: 'L2', Pad7: 'R2', Pad8: 'SHARE', Pad9: 'OPTIONS', Pad10: 'L3', Pad11: 'R3', ...DPAD, Pad16: 'PS' } },
  nintendo: { name: 'Nintendo', names: { Pad0: 'B', Pad1: 'A', Pad2: 'Y', Pad3: 'X', Pad4: 'L', Pad5: 'R', Pad6: 'ZL', Pad7: 'ZR', Pad8: '-', Pad9: '+', Pad10: 'L-STICK', Pad11: 'R-STICK', ...DPAD, Pad16: 'HOME' } },
  steam: { name: 'Steam Deck', names: { Pad0: 'A', Pad1: 'B', Pad2: 'X', Pad3: 'Y', Pad4: 'L1', Pad5: 'R1', Pad6: 'L2', Pad7: 'R2', Pad8: 'VIEW', Pad9: 'MENU', Pad10: 'L3', Pad11: 'R3', ...DPAD, Pad16: 'STEAM' } },
  generic: { name: 'Generic', names: { Pad0: 'BTN 1', Pad1: 'BTN 2', Pad2: 'BTN 3', Pad3: 'BTN 4', Pad4: 'L1', Pad5: 'R1', Pad6: 'L2', Pad7: 'R2', Pad8: 'SELECT', Pad9: 'START', Pad10: 'L3', Pad11: 'R3', ...DPAD, Pad16: 'HOME' } },
};
export const PAD_LAYOUT_IDS = Object.keys(PAD_LAYOUTS);
// Vendor ids are the reliable part of a pad's name; the words around them vary by browser.
function detectLayout(id = '') {
  const text = String(id);
  if (/057e|nintendo|switch pro|joy-?con/i.test(text)) return 'nintendo';
  if (/28de|steam ?deck|valve/i.test(text)) return 'steam';
  if (/054c|dualshock|dualsense|playstation/i.test(text)) return 'playstation';
  if (/045e|xbox|xinput/i.test(text)) return 'xbox';
  if (/wireless controller/i.test(text)) return 'playstation';   // Sony's own name for itself
  return 'generic';
}
export const PAD_CODES = Object.keys(PAD_LAYOUTS.xbox.names);
// What the game is being played with right now. It flips on the first press of either kind.
export const input = { mode: 'kbm', padName: '', layout: 'xbox' };
export function setInputMode(mode, pad = null) {
  if (pad) {
    const id = pad.id || '';
    if (id !== input.padName) { input.padName = id; input.layout = detectLayout(id); bus.emit('input-mode', input.mode); }
  }
  if (input.mode === mode) return;
  input.mode = mode;
  bus.emit('input-mode', mode);
}
// The layout the prompts use: whatever the pilot picked, or whatever the pad says it is.
export const padLayout = () => (PAD_LAYOUTS[game.settings.padLayout] ? game.settings.padLayout : input.layout);
export const padName = (code) => PAD_LAYOUTS[padLayout()].names[code] || String(code || '').toUpperCase();

// Controller binds live in their own table.
export const DEFAULT_PAD_BINDS = {
  fire: 'Pad7', scope: 'Pad6', jump: 'Pad0', sprint: 'Pad10', crouch: 'Pad1', reload: 'Pad2',
  swap: 'Pad3', gadget1: 'Pad4', gadget2: 'Pad5', melee: 'Pad11', ping: 'Pad12', interact: 'Pad14',
  armoury: 'Pad15', inspect: 'Pad13', scoreboard: 'Pad8', menu: 'Pad9',
};
// Actions a controller can hold, in the order the settings page lists them.
export const PAD_ACTIONS = [
  ['fire', 'Fire'], ['scope', 'Aim / scope'], ['jump', 'Jump'], ['sprint', 'Sprint'], ['crouch', 'Crouch · slide'],
  ['reload', 'Reload'], ['swap', 'Swap weapon'], ['melee', 'Blade'], ['gadget1', 'Gadget 1'], ['gadget2', 'Gadget 2'],
  ['interact', 'Pick up (royale)'], ['armoury', 'Armoury'], ['inspect', 'Inspect weapon'], ['ping', 'Ping location'],
  ['scoreboard', 'Scoreboard'], ['menu', 'Pause / back'],
].map(([id, label]) => ({ id, label }));
export function padBindFor(action) {
  const saved = game.settings.padBinds?.[action];
  return saved === null ? null : saved || DEFAULT_PAD_BINDS[action] || null;
}
export const padHeld = (codes, action) => { const code = padBindFor(action); return Boolean(code && codes.has(code)); };
export const padActionFor = (code) => PAD_ACTIONS.find((action) => padBindFor(action.id) === code)?.id || null;
export const padLabel = (action) => { const code = padBindFor(action); return code ? padName(code) : 'UNBOUND'; };
// One pad button does one thing: setting it takes it off whatever had it.
export function setPadBind(action, code) {
  const binds = { ...(game.settings.padBinds || {}) };
  let displaced = null;
  if (code) for (const other of PAD_ACTIONS) {
    if (other.id === action || padBindFor(other.id) !== code) continue;
    binds[other.id] = null;
    displaced = other.label;
  }
  binds[action] = code;
  game.settings.padBinds = binds;
  saveSettings();
  return displaced;
}
export function resetPadBinds() { game.settings.padBinds = {}; saveSettings(); }

export function bindsFor(action) {
  const saved = game.settings.binds?.[action];
  return Array.isArray(saved) ? [saved[0] ?? null, saved[1] ?? null] : DEFAULT_BINDS[action] || [null, null];
}
export const isBound = (action, code) => bindsFor(action).includes(code);
export const held = (keys, action) => bindsFor(action).some((code) => code && keys.has(code));
export const actionsFor = (code) => ACTIONS.filter((action) => isBound(action.id, code)).map((action) => action.id);
export const mouseCode = (event) => `Mouse${event.button}`;

const NAMES = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5', Space: 'SPACE', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', AltLeft: 'L-ALT', AltRight: 'R-ALT', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', CapsLock: 'CAPS', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
export function codeLabel(code) {
  if (!code) return '-';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6).toUpperCase()}`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}
// "L-CTRL / C" for prompts and the tutorial.
export const keyLabel = (action) => bindsFor(action).filter(Boolean).map(codeLabel).join(' / ') || 'UNBOUND';
// On a controller the prompts name the controller's button instead.
export function bindLabel(action) {
  if (input.mode === 'pad') { const code = padBindFor(action); if (code) return padName(code); }
  return keyLabel(action);
}

// Bind a code to one slot of an action. A code can only do one thing, so it is taken off whatever had it.
// Returns the label of the action that lost it, if any.
export function setBind(action, slot, code) {
  const binds = { ...(game.settings.binds || {}) };
  let displaced = null;
  if (code) {
    for (const other of ACTIONS) {
      const current = bindsFor(other.id);
      const index = current.indexOf(code);
      if (index === -1 || (other.id === action && index === slot)) continue;
      const next = [...current]; next[index] = null;
      binds[other.id] = next;
      if (other.id !== action) displaced = other.label;
    }
  }
  const mine = [...(binds[action] || bindsFor(action))];
  mine[slot] = code;
  binds[action] = mine;
  game.settings.binds = binds;
  saveSettings();
  return displaced;
}
export function resetBinds() { game.settings.binds = {}; saveSettings(); }
