// Match chat: a few lines over the match that clear themselves, and the match's worth behind them for
// when the box is open. It is held in memory only and goes when the match does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../arena.css', import.meta.url), 'utf8');
const limits = Object.fromEntries([...hud.matchAll(/(CHAT_SHOWN|CHAT_OPEN|CHAT_HISTORY|CHAT_FADE) = (\d+)/g)].map((m) => [m[1], Number(m[2])]));

test('the backlog holds more than the overlay shows', () => {
  assert.ok(limits.CHAT_HISTORY > limits.CHAT_OPEN, 'a backlog no deeper than the box is not a backlog');
  assert.ok(limits.CHAT_OPEN > limits.CHAT_SHOWN, 'opening the box must show more than was already on screen');
  assert.ok(limits.CHAT_FADE >= 4000, 'a few seconds, not a blink');
});

// The whole point: the overlay still clears itself, so this is what makes anything readable afterwards.
test('opening the box draws the backlog and closing it goes back to fading', () => {
  const open = hud.slice(hud.indexOf('  openChat('), hud.indexOf('  closeChat('));
  const close = hud.slice(hud.indexOf('  closeChat('), hud.indexOf('  toggleQuick('));
  assert.match(open, /chatLog\.classList\.add\('open'\)/, 'the log is marked open so it stops fading');
  assert.match(open, /this\.chatBacklog\(\)/, 'and is filled with what was said');
  assert.match(close, /chatLog\.classList\.remove\('open'\)/, 'closing puts the fading back');
  assert.match(close, /this\.fadeChat\(\)/, 'and the lines left over start their timers');
  assert.match(css, /\.chat-log\.open div \{[^}]*opacity: 1/, 'an open log must not fade out from under you');
});

// A faded line that is still in the DOM would reappear blank when the box opens.
test('a line that faded while the box was shut does not come back empty', () => {
  const chat = hud.slice(hud.indexOf('  chat(message) {'), hud.indexOf('  clearChat('));
  assert.match(chat, /if \(this\.chatOpen\) \{ this\.chatBacklog\(\); return; \}/, 'with the box open the backlog is redrawn rather than appended to');
  assert.match(chat, /if \(!this\.chatOpen\) line\.classList\.add\('faded'\)/, 'and a timer that fires after it opens must not fade what you are reading');
});

test('the backlog is capped, so a long match cannot grow it without end', () => {
  const chat = hud.slice(hud.indexOf('  chat(message) {'), hud.indexOf('  clearChat('));
  assert.match(chat, /while \(this\.chatHistory\.length > CHAT_HISTORY\) this\.chatHistory\.shift\(\)/, 'nothing trims the backlog');
  // The same arithmetic, so the cap is shown to actually hold.
  const history = [];
  for (let i = 0; i < limits.CHAT_HISTORY * 3; i += 1) {
    history.push(i);
    while (history.length > limits.CHAT_HISTORY) history.shift();
  }
  assert.equal(history.length, limits.CHAT_HISTORY);
  assert.equal(history[history.length - 1], limits.CHAT_HISTORY * 3 - 1, 'the newest is kept');
});

test('chat goes when the match does, and is never written down', () => {
  assert.match(hud, /clearChat\(\) \{\s*\n\s*this\.chatHistory = \[\];/, 'clearing must empty the backlog itself');
  assert.match(hud, /clearChat\(\)[\s\S]{0,120}chatLog\.replaceChildren\(\)/, 'and what is on screen with it');
  const welcome = main.slice(main.indexOf("net.on('welcome'"), main.indexOf("const isEnemyTeam"));
  assert.match(welcome, /hud\.clearChat\(\)/, 'a new match starts with nothing said in it');
  // In memory only: match chat is nobody's business afterwards.
  assert.ok(!/chatHistory[\s\S]{0,80}(localStorage|sessionStorage|store\()/.test(hud), 'match chat must not be persisted anywhere');
});

// Names come from Discord and the text is typed by players, so both are escaped in both branches.
test('nothing said in a match can put markup on anyone else’s screen', () => {
  const line = hud.slice(hud.indexOf('  chatLine(message) {'), hud.indexOf('  chatBacklog('));
  const inserts = [...line.matchAll(/\$\{(?!escapeHtml)([^}]*)\}/g)].map((m) => m[1].trim());
  for (const insert of inserts) {
    assert.ok(/^(enemy \?|message\.scope ===|message\.dead \?|message\.bot \?)/.test(insert),
      `an unescaped value reaches the chat log: ${insert}`);
  }
  assert.equal((line.match(/escapeHtml\(message\.name\)/g) || []).length, 2, 'both branches escape the name');
  assert.equal((line.match(/escapeHtml\(message\.text\)/g) || []).length, 2, 'and both escape what was said');
});
