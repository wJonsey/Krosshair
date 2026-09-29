// The developers' terminal, on /. It sends the line exactly as typed and prints what the server says:
// every word is resolved, and every rule checked, on the server (server/gifts.js). What lives here is
// the typing: completion, history, and a place to read the answers.
// Like the K menu, it brings its own styles and markup so it touches nothing else in the game.
import { DEV_COMMANDS, GIFT_KINDS, giftChoices, giftKind, giftWord, slug } from '../shared/gifts.js';
import { game, store, stored } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const CSS = `
.dev-term { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 60; width: min(820px, calc(100vw - 32px)); display: none; flex-direction: column; background: rgba(6, 10, 13, .95); border: 1px solid rgba(0, 255, 198, .45); box-shadow: 0 0 40px rgba(0, 255, 198, .14), 0 18px 60px rgba(0, 0, 0, .6); font: 400 12px/1.5 var(--mono); color: var(--frost); }
.dev-term.on { display: flex; }
.dev-term header { display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-bottom: 1px solid rgba(0, 255, 198, .22); background: linear-gradient(90deg, rgba(0, 255, 198, .12), transparent 70%); }
.dev-term header b { font: 700 11px var(--mono); letter-spacing: .22em; color: #00ffc6; }
.dev-term header small { flex: 1; color: var(--graphite); font-size: 10px; letter-spacing: .06em; }
.dev-term header button { background: none; border: 0; color: var(--haze); font: 700 11px var(--mono); letter-spacing: .12em; padding: 0 2px; }
.dev-term header button:hover { color: #00ffc6; }
.dev-term .term-out { height: min(38vh, 340px); overflow-y: auto; padding: 8px 12px; white-space: pre-wrap; word-break: break-word; overscroll-behavior: contain; }
.dev-term .term-out div { min-height: 1.5em; }
.dev-term .t-cmd { color: var(--signal); }
.dev-term .t-good { color: #00ffc6; }
.dev-term .t-bad { color: var(--rival); }
.dev-term .t-warn { color: var(--signal); }
.dev-term .t-dim { color: var(--haze); }
.dev-term .t-dev { color: #00ffc6; opacity: .8; }
.dev-term .t-wait { color: var(--graphite); }
.dev-term .term-hints { display: flex; flex-wrap: wrap; gap: 4px 6px; min-height: 30px; padding: 6px 12px; border-top: 1px solid rgba(230, 237, 241, .07); }
.dev-term .term-hints span { padding: 1px 7px; border: 1px solid rgba(230, 237, 241, .14); color: var(--haze); font-size: 11px; cursor: pointer; }
.dev-term .term-hints span.pick { border-color: #00ffc6; color: #00ffc6; }
.dev-term .term-hints em { color: var(--graphite); font-style: normal; font-size: 11px; }
.dev-term .term-line { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-top: 1px solid rgba(0, 255, 198, .22); }
.dev-term .term-line span { color: #00ffc6; font-weight: 700; }
.dev-term input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--frost); font: 400 14px var(--mono); caret-color: #00ffc6; }
@media (max-width: 560px) { .dev-term { bottom: 8px; } .dev-term header small { display: none; } }
`;

const COMMANDS = DEV_COMMANDS.map((command) => command.name);
const HISTORY = 60;

// What the word under the cursor could become, from the words before it.
function completions(line, names) {
  const body = line.replace(/^\//, '');
  if ((body.match(/"/g) || []).length % 2) return [];          // inside a quoted note: that is prose
  const words = body.split(/\s+/);
  const partial = words.pop() || '';
  const want = slug(partial);
  // Everything that carries on from what is typed, but not the word itself once it is finished.
  const starts = (list) => [...new Set(list)].filter((word) => slug(word).startsWith(want) && word.toLowerCase() !== partial.toLowerCase());
  if (!words.length) return starts(COMMANDS);
  const command = words[0].toLowerCase();
  const pilots = () => {
    // A list of names: complete the one after the last comma.
    const done = partial.includes(',') ? partial.slice(0, partial.lastIndexOf(',') + 1) : '';
    const tail = slug(partial.slice(done.length));
    return [...new Set(['all', 'online', ...names])].filter((name) => slug(name).startsWith(tail) && slug(name) !== tail).map((name) => done + name);
  };
  if (command === 'who') return words.length === 1 ? pilots().filter((name) => !['all', 'online'].includes(name)) : [];
  if (command === 'items') return words.length === 1 ? starts(GIFT_KINDS) : [];
  if (command !== 'give' && command !== 'gift') return [];
  if (words.length === 1) return pilots();
  // Walk what has been typed to know what comes next: a kind, its value, a crate count, or the note.
  let expect = 'kind', kind = null;
  for (const word of words.slice(2)) {
    if (expect === 'note') break;
    if (expect === 'count' && /^\d+$/.test(word)) { expect = 'kind'; continue; }
    if (expect === 'kind' || expect === 'count') {
      if (word === '+') { expect = 'kind'; continue; }
      kind = giftKind(word);
      expect = kind ? 'value' : 'note';
      continue;
    }
    if (expect === 'value') expect = kind === 'crate' ? 'count' : 'kind';
  }
  if (expect === 'value') {
    if (kind === 'coins' || kind === 'xp') return starts(['100', '500', '1k', '5k', '10k', '50k']);
    return starts(giftChoices(kind).map(giftWord));
  }
  if (expect === 'count') return starts(['1', '3', '5', '10', ...GIFT_KINDS]);
  if (expect === 'kind') return starts(['+', ...GIFT_KINDS]);
  return [];
}

export function initTerminal() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const panel = document.createElement('div');
  panel.className = 'dev-term';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Dev terminal');
  panel.innerHTML = `<header><b>DEV TERMINAL</b><small>Tab completes · ↑ ↓ history · Esc closes · /help</small><button type="button" data-close>ESC</button></header>
    <div class="term-out" aria-live="polite"></div><div class="term-hints"></div>
    <label class="term-line"><span>&gt;</span><input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="600" aria-label="Command"></label>`;
  document.body.append(panel);
  const out = panel.querySelector('.term-out');
  const hints = panel.querySelector('.term-hints');
  const input = panel.querySelector('input');

  const allowed = () => Boolean(game.profile?.dev && game.username);
  const isOpen = () => panel.classList.contains('on');
  let names = [];
  let history = stored('devHistory', []);
  let back = -1;                  // where in the history ↑ has got to
  let draft = '';
  let cycle = null;               // Tab pressed again on the same word: step through the choices
  let asked = 0;
  const waiting = new Map();      // request id → the placeholder line

  function print(text, tone = 'info') {
    const line = document.createElement('div');
    line.className = `t-${tone}`;
    line.textContent = text;
    out.append(line);
    while (out.childElementCount > 400) out.firstElementChild.remove();
    out.scrollTop = out.scrollHeight;
    return line;
  }
  function showHints() {
    const list = completions(input.value, names);
    hints.replaceChildren();
    if (!list.length) {
      const help = DEV_COMMANDS.find((command) => input.value.replace(/^\//, '').split(/\s+/)[0].toLowerCase() === command.name);
      const tip = document.createElement('em');
      tip.textContent = help ? help.usage : 'Type a command. /help lists them.';
      hints.append(tip);
      return;
    }
    list.slice(0, 14).forEach((word, index) => {
      const chip = document.createElement('span');
      chip.textContent = word;
      if (cycle ? cycle.list[cycle.index] === word : index === 0) chip.className = 'pick';
      chip.addEventListener('mousedown', (event) => { event.preventDefault(); take(word); });
      hints.append(chip);
    });
    if (list.length > 14) { const more = document.createElement('em'); more.textContent = `+${list.length - 14}`; hints.append(more); }
  }
  // Put a completion in place of the word being typed.
  function take(word, keepCycle = false) {
    const value = input.value;
    const cut = value.lastIndexOf(' ') + 1;
    input.value = `${value.slice(0, cut)}${word}${keepCycle ? '' : ' '}`;
    if (!keepCycle) cycle = null;
    showHints();
  }
  function tab(backwards) {
    if (cycle && cycle.value === input.value) {
      cycle.index = (cycle.index + (backwards ? cycle.list.length - 1 : 1)) % cycle.list.length;
      take(cycle.list[cycle.index], true);
      cycle.value = input.value;
      showHints();
      return;
    }
    const list = completions(input.value, names);
    if (!list.length) return;
    if (list.length === 1) { take(list[0]); return; }
    cycle = { list, index: 0, value: '' };
    take(list[0], true);
    cycle.value = input.value;
    showHints();
  }

  function submit() {
    const line = input.value.trim();
    input.value = '/';
    cycle = null; back = -1; draft = '';
    showHints();
    if (!line || line === '/') return;
    history = [line, ...history.filter((entry) => entry !== line)].slice(0, HISTORY);
    store('devHistory', history);
    print(`> ${line}`, 'cmd');
    if (/^\/?clear$/i.test(line)) { out.replaceChildren(); return; }
    const id = ++asked;
    waiting.set(id, print('...', 'wait'));
    net.send({ type: 'dev-cmd', id, line });
    play('ui', { volume: 0.4 });
  }

  function open() {
    if (!allowed() || isOpen()) return;
    panel.classList.add('on');
    document.exitPointerLock?.();
    input.value = '/';
    if (!out.childElementCount) print('Krosshair dev terminal. /help lists the commands.', 'dim');
    // Names for completing: asked each time it opens, so a pilot who signed up since is in there.
    net.send({ type: 'dev-cmd', names: true });
    showHints();
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(1, 1); });
    play('ui');
  }
  function close() {
    if (!isOpen()) return;
    panel.classList.remove('on');
    input.blur();
    play('uiBack');
  }

  input.addEventListener('keydown', (event) => {
    // Nothing typed here is a key for the game.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Enter') { event.preventDefault(); submit(); return; }
    if (event.key === 'Tab') { event.preventDefault(); tab(event.shiftKey); return; }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (back === -1) draft = input.value;
      back = Math.max(-1, Math.min(history.length - 1, back + (event.key === 'ArrowUp' ? 1 : -1)));
      input.value = back === -1 ? draft : history[back];
      cycle = null;
      showHints();
    }
  });
  input.addEventListener('input', () => { cycle = null; showHints(); });
  input.addEventListener('keyup', (event) => event.stopPropagation());
  panel.querySelector('[data-close]').addEventListener('click', close);
  // A click on the output leaves the cursor where it was, so reading back never loses the line.
  out.addEventListener('mouseup', () => { if (!getSelection()?.toString()) input.focus(); });

  net.on('dev-names', (message) => { names = Array.isArray(message.names) ? message.names : []; showHints(); });
  net.on('dev-cmd', (message) => {
    const placeholder = waiting.get(message.id);
    waiting.delete(message.id);
    const lines = Array.isArray(message.lines) ? message.lines : [];
    if (!lines.length) { placeholder?.remove(); return; }
    lines.forEach((line, index) => {
      if (index === 0 && placeholder) { placeholder.className = `t-${line.tone || 'info'}`; placeholder.textContent = line.text; } else print(line.text, line.tone || 'info');
    });
    out.scrollTop = out.scrollHeight;
    if (lines.some((line) => line.tone === 'good')) play('ready', { volume: 0.5 });
    else if (lines.some((line) => line.tone === 'bad')) play('deny', { volume: 0.5 });
  });

  // / opens it. Captured, so the game's own key handling can't swallow it first.
  window.addEventListener('keydown', (event) => {
    const slash = event.code === 'Slash' || event.key === '/';
    if (!slash || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (typing || !allowed() || document.getElementById('boot')) return;
    event.preventDefault();
    event.stopPropagation();
    // Already up but something else took the focus (a present, a click on the menu): take it back.
    if (isOpen()) { input.focus(); return; }
    open();
  }, true);

  return { isOpen, open, close };
}
