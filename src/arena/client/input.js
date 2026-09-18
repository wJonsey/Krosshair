// Rebindable controls. An input code is a KeyboardEvent.code ('KeyW') or a mouse button ('Mouse0').
// Every action has two slots so the classic doubles (CTRL / C to crouch) still work after rebinding.
import { game, saveSettings } from './state.js';

export const ACTIONS = [
  ['forward', 'Move forward', 'Movement'], ['back', 'Move back', 'Movement'], ['left', 'Strafe left', 'Movement'], ['right', 'Strafe right', 'Movement'],
  ['jump', 'Jump', 'Movement'], ['crouch', 'Crouch (silent)', 'Movement'], ['walk', 'Walk · hold breath', 'Movement'],
  ['fire', 'Fire', 'Weapons'], ['scope', 'Aim / scope', 'Weapons'], ['reload', 'Reload', 'Weapons'],
  ['primary', 'Primary weapon', 'Weapons'], ['sidearm', 'Sidearm', 'Weapons'], ['melee', 'Blade', 'Weapons'],
  ['gadget1', 'Gadget 1', 'Weapons'], ['gadget2', 'Gadget 2', 'Weapons'], ['armoury', 'Armoury', 'Weapons'],
  ['ping', 'Ping location', 'Team'], ['radio', 'Radio commands', 'Team'], ['chat', 'Chat to all', 'Team'], ['teamChat', 'Chat to team', 'Team'], ['scoreboard', 'Scoreboard', 'Team'],
].map(([id, label, group]) => ({ id, label, group }));

export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space', null], crouch: ['ControlLeft', 'KeyC'], walk: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0', null], scope: ['Mouse2', null], reload: ['KeyR', null],
  primary: ['Digit1', null], sidearm: ['Digit2', null], melee: ['Digit3', null],
  gadget1: ['KeyQ', null], gadget2: ['KeyE', null], armoury: ['KeyB', null],
  ping: ['KeyZ', 'Mouse1'], radio: ['KeyX', null], chat: ['Enter', null], teamChat: ['KeyY', null], scoreboard: ['Tab', null],
};
// Keys the game keeps for itself.
export const RESERVED = ['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight'];

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
export const bindLabel = (action) => bindsFor(action).filter(Boolean).map(codeLabel).join(' / ') || 'UNBOUND';

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
