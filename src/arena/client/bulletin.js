// Things the game has to tell every pilot, whatever screen they are on:
//   - planned downtime: a tab on the right edge of every screen, counting down, from the moment a
//     developer sets it until it is over;
//   - an update landing: the screen is taken over while the server restarts, and gives itself back when
//     the new build is up;
//   - patch notes: shown once, the first time a pilot signs in after an update.
// Like the present and the dev tools it brings its own markup and styles, so it works over the menus,
// the lobby, a match and the end screen without any of them knowing about it.
import { PATCH_NOTES, latestNoteId, notesSince } from '../shared/patchnotes.js';
import { DOWNTIME, downtimeEnd, downtimeLive, featureName, outageReason, untilLabel } from '../shared/outage.js';
import { MAP_INFO, ROYALE_MAP } from '../shared/map.js';
import { WEAPONS } from '../shared/constants.js';
import { bus, game, store, stored } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const CSS = `
.downtime-tab { position: fixed; right: 0; top: 38%; z-index: 70; width: 214px; padding: 12px 14px 12px 20px; pointer-events: none; color: var(--frost); background: linear-gradient(90deg, rgba(10, 14, 18, .94), rgba(14, 19, 25, .9)); border: 1px solid rgba(255, 181, 71, .38); border-right: 0; box-shadow: -12px 0 40px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .05); transform: translateX(105%); transition: transform .5s var(--ease), opacity .3s; }
.downtime-tab.on { transform: none; }
.downtime-tab::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; background: repeating-linear-gradient(-45deg, var(--signal) 0 6px, #14100a 6px 12px); }
.dt-pulled:empty { display: none; }
.dt-plan + .dt-pulled { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }
.downtime-tab.only-pulled .dt-pulled { margin-top: 0; padding-top: 0; border-top: 0; }
.dt-pulled p { margin: 6px 0 0; font: 400 11px/1.4 var(--body); color: var(--haze); }
.downtime-tab .dt-pulled b { display: block; margin: 0; font: 400 12px/1.2 var(--display); letter-spacing: .02em; color: var(--frost); text-transform: uppercase; animation: none; }
body[data-screen='game'] .dt-pulled p { font-size: 10px; }
.downtime-tab small { display: block; font: 600 9px/1 var(--mono); letter-spacing: .22em; color: var(--signal); text-transform: uppercase; }
.downtime-tab b { display: block; margin-top: 7px; font: 400 21px/1 var(--display); letter-spacing: .02em; }
.downtime-tab em { display: block; margin-top: 6px; font: 500 11px/1.2 var(--mono); font-style: normal; letter-spacing: .1em; color: var(--frost); }
.downtime-tab span { display: block; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--hairline); font: 400 11px/1.4 var(--body); color: var(--haze); }
.downtime-tab.soon { border-color: rgba(255, 90, 78, .6); }
.downtime-tab.soon::before { background: repeating-linear-gradient(-45deg, var(--rival) 0 6px, #170b0a 6px 12px); animation: downtime-march .7s linear infinite; }
.downtime-tab.soon small { color: var(--rival); }
.downtime-tab.soon b { animation: downtime-beat 1s ease-in-out infinite; }
/* In the menus it sits low on the right, clear of the page's own controls; in a match, under the kill feed. */
body[data-screen='home'] .downtime-tab, body[data-screen='lobby'] .downtime-tab { top: auto; bottom: 74px; }
body[data-screen='game'] .downtime-tab { top: auto; bottom: 200px; width: 188px; padding: 9px 11px 9px 17px; opacity: .8; }
body[data-screen='game'] .downtime-tab b { font-size: 17px; }
body[data-screen='game'] .downtime-tab span { display: none; }
@keyframes downtime-march { to { background-position: 0 17px; } }
@keyframes downtime-beat { 50% { opacity: .55; } }

.update-screen { position: fixed; inset: 0; z-index: 120; display: none; color: var(--frost); font-family: var(--body); }
.update-screen.on { display: block; }
.update-screen .hazard { position: absolute; left: 0; right: 0; height: 12px; background: repeating-linear-gradient(-45deg, var(--signal) 0 14px, #120e08 14px 28px); animation: update-march 1s linear infinite; box-shadow: 0 0 34px rgba(255, 181, 71, .35); }
.update-screen .hazard.top { top: 0; } .update-screen .hazard.bottom { bottom: 0; animation-direction: reverse; }
.update-screen .veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 42%, rgba(46, 31, 8, .55), rgba(5, 7, 10, .96) 68%); backdrop-filter: blur(10px) saturate(.6); animation: update-fade .5s var(--ease) both; }
.update-screen .core { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 0; text-align: center; padding: 40px 24px; animation: update-rise .6s var(--ease) both; }
.update-screen .kicker { font: 600 11px/1 var(--mono); letter-spacing: .42em; color: var(--signal); text-transform: uppercase; }
.update-screen h2 { margin: 16px 0 0; font: 400 clamp(30px, 6vw, 76px)/1 var(--display); letter-spacing: .02em; text-transform: uppercase; }
.update-screen h2 em { font-style: normal; color: var(--haze); }
.update-screen p { margin: 16px 0 0; max-width: 520px; color: var(--haze); font-size: 15px; line-height: 1.55; }
.update-dial { position: relative; width: 190px; height: 190px; margin-bottom: 30px; display: grid; place-items: center; }
.update-dial svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.update-dial circle { fill: none; stroke-width: 3; }
.update-dial .track { stroke: rgba(230, 237, 241, .1); }
.update-dial .sweep { stroke: var(--signal); stroke-linecap: butt; transition: stroke-dashoffset 1s linear; filter: drop-shadow(0 0 8px rgba(255, 181, 71, .7)); }
.update-dial .ticks { stroke: rgba(230, 237, 241, .28); stroke-width: 7; stroke-dasharray: 1.2 13.18; }
.update-dial b { font: 400 62px/1 var(--display); }
.update-dial small { position: absolute; bottom: 44px; font: 500 9px var(--mono); letter-spacing: .3em; color: var(--haze); }
.update-screen.down .update-dial .sweep { stroke-dasharray: 120 432 !important; stroke-dashoffset: 0 !important; transition: none; animation: update-spin 1.3s linear infinite; transform-origin: 50% 50%; }
.update-screen.down .update-dial b { font-size: 30px; letter-spacing: .1em; }
.update-steps { display: flex; gap: 8px; margin-top: 28px; padding: 0; list-style: none; font: 500 10px var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--graphite); }
.update-steps li { padding: 8px 12px; border: 1px solid var(--hairline); }
.update-steps li.done { color: var(--ally); border-color: rgba(108, 230, 209, .4); }
.update-steps li.now { color: var(--void); background: var(--signal); border-color: var(--signal); }
/* In a match the countdown stays out of the way: a frame round the view, not a wall over it. */
.update-screen.frame { pointer-events: none; }
.update-screen.frame .veil { background: radial-gradient(ellipse at 50% 50%, transparent 46%, rgba(40, 24, 4, .5) 100%); backdrop-filter: none; }
.update-screen.frame .core { place-content: start center; padding-top: 86px; }
.update-screen.frame .update-dial { width: 92px; height: 92px; margin-bottom: 12px; }
.update-screen.frame .update-dial b { font-size: 30px; }
.update-screen.frame .update-dial small, .update-screen.frame .update-steps, .update-screen.frame p { display: none; }
.update-screen.frame h2 { font-size: 22px; margin-top: 10px; text-shadow: 0 2px 16px #000; }
.update-screen.frame .kicker { text-shadow: 0 2px 12px #000; }
@keyframes update-march { to { background-position: 39.6px 0; } }
@keyframes update-fade { from { opacity: 0; } }
@keyframes update-rise { from { opacity: 0; transform: translateY(18px); } }
@keyframes update-spin { to { transform: rotate(360deg); } }

.notes-veil { position: fixed; inset: 0; z-index: 95; display: none; place-items: center; padding: 24px; background: rgba(4, 6, 9, .84); backdrop-filter: blur(10px); }
.notes-veil.on { display: grid; animation: update-fade .3s var(--ease) both; }
.notes-card { position: relative; display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); width: min(980px, 100%); max-height: min(720px, calc(100vh - 48px)); background: linear-gradient(180deg, rgba(18, 24, 31, .98), rgba(9, 13, 17, .98)); border: 1px solid var(--hairline-strong); box-shadow: 0 40px 120px rgba(0, 0, 0, .7), inset 0 1px 0 rgba(255, 255, 255, .06); animation: update-rise .45s var(--ease) both; overflow: hidden; }
.notes-card::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, var(--signal), transparent 70%); }
.notes-side { position: relative; display: flex; flex-direction: column; padding: 34px 28px 28px; background: radial-gradient(circle at 20% 0%, rgba(255, 181, 71, .16), transparent 60%), rgba(255, 255, 255, .015); border-right: 1px solid var(--hairline); overflow: hidden; }
.notes-side .ring { position: absolute; right: -90px; bottom: -90px; width: 260px; height: 260px; border-radius: 50%; border: 1px solid rgba(255, 181, 71, .2); box-shadow: 0 0 0 26px rgba(255, 181, 71, .035), 0 0 0 60px rgba(255, 181, 71, .02); }
.notes-side small { font: 600 10px var(--mono); letter-spacing: .3em; color: var(--signal); text-transform: uppercase; }
.notes-side h2 { margin: 14px 0 0; font: 400 clamp(26px, 3vw, 38px)/1.05 var(--display); text-transform: uppercase; }
.notes-side h2 em { font-style: normal; color: var(--haze); }
.notes-side p { margin: 14px 0 0; color: var(--haze); font-size: 13px; line-height: 1.55; }
.notes-side .count { margin-top: auto; padding-top: 22px; font: 500 10px var(--mono); letter-spacing: .16em; color: var(--graphite); text-transform: uppercase; }
.notes-side button { position: relative; margin-top: 14px; padding: 14px 18px; border: 0; background: var(--signal); color: var(--void); font: 600 11px var(--mono); letter-spacing: .16em; text-transform: uppercase; cursor: pointer; transition: filter .15s, transform .15s var(--ease); }
.notes-side button:hover { filter: brightness(1.12); transform: translateY(-1px); }
.notes-list { padding: 26px 30px 30px; overflow-y: auto; }
.notes-entry { padding: 0 0 22px 22px; border-left: 1px solid var(--hairline-strong); position: relative; animation: update-rise .5s var(--ease) both; }
.notes-entry:last-child { padding-bottom: 0; }
.notes-entry::before { content: ''; position: absolute; left: -5px; top: 4px; width: 9px; height: 9px; background: var(--void); border: 1px solid var(--haze); transform: rotate(45deg); }
.notes-mark { margin: 0 0 14px; font: 600 10px var(--mono); letter-spacing: .24em; text-transform: uppercase; color: var(--signal); }
.notes-mark + .notes-entry + .notes-mark { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--hairline); color: var(--haze); }
.notes-mark small { margin-left: 10px; color: var(--graphite); letter-spacing: .12em; }
.notes-entry.fresh::before { background: var(--signal); border-color: var(--signal); box-shadow: 0 0 12px rgba(255, 181, 71, .8); }
.notes-entry header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; }
.notes-entry header i { padding: 3px 7px; font: 600 9px var(--mono); font-style: normal; letter-spacing: .16em; text-transform: uppercase; color: var(--void); background: var(--ally); }
.notes-entry header i.fix { background: var(--armour); } .notes-entry header i.event { background: var(--loss); }
.notes-entry header b { font: 400 17px/1.2 var(--display); text-transform: uppercase; }
.notes-entry header time { margin-left: auto; font: 500 10px var(--mono); letter-spacing: .14em; color: var(--graphite); text-transform: uppercase; }
.notes-entry ul { margin: 10px 0 0; padding: 0; list-style: none; }
.notes-entry li { position: relative; padding: 4px 0 4px 16px; color: #c3ccd3; font-size: 13.5px; line-height: 1.5; }
.notes-entry li::before { content: ''; position: absolute; left: 0; top: 12px; width: 6px; height: 1px; background: var(--signal); }
@media (max-width: 760px) { .notes-card { grid-template-columns: 1fr; overflow-y: auto; } .notes-side { border-right: 0; border-bottom: 1px solid var(--hairline); } .notes-list { overflow: visible; } }
`;

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clockTime = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// "Today", "Tomorrow" or the day, so a time a week out is not read as tonight.
function dayLabel(at) {
  const day = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const gap = Math.round((day(at) - day(Date.now())) / 86400000);
  return gap === 0 ? 'Today' : gap === 1 ? 'Tomorrow' : new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function initBulletin() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  // ---------------------------------------------------------------- planned downtime
  const tab = document.createElement('aside');
  tab.className = 'downtime-tab';
  tab.setAttribute('aria-live', 'polite');
  tab.innerHTML = '<div class="dt-plan"><small></small><b></b><em></em><span></span></div><div class="dt-pulled"></div>';
  document.body.append(tab);
  const [tabKicker, tabTime, tabCount, tabNote] = tab.firstChild.children;
  const planBox = tab.firstChild, pulledBox = tab.lastChild;
  // What a developer has pulled from the game, and why: the same tab, under any planned downtime.
  let pulledKey = null;
  function paintPulled() {
    const out = game.outages || {};
    const mapName = (id) => (id === ROYALE_MAP ? 'Kestrel Island' : MAP_INFO.find((info) => info.id === id)?.title || id);
    const rows = [
      ...Object.entries(out.feature || {}).map(([id, entry]) => [featureName(id), entry]),
      ...Object.entries(out.map || {}).map(([id, entry]) => [mapName(id), entry]),
      ...Object.entries(out.weapon || {}).map(([id, entry]) => [WEAPONS[id]?.name || id, entry]),
    ];
    const key = JSON.stringify(rows);
    if (key !== pulledKey) {
      pulledKey = key;
      pulledBox.innerHTML = rows.length ? `<small>Disabled right now</small>${rows.map(([name, entry]) => `<p><b>${esc(name)}</b>${esc(outageReason(entry))}</p>`).join('')}` : '';
    }
    return rows.length;
  }
  const write = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  function paintDowntime() {
    const downtime = game.downtime;
    const now = Date.now();
    const pulled = paintPulled(), planned = downtimeLive(downtime, now);
    planBox.style.display = planned ? '' : 'none';
    tab.classList.toggle('on', planned || pulled > 0);
    tab.classList.toggle('only-pulled', !planned && pulled > 0);
    if (!planned) { tab.classList.remove('soon'); return; }
    const started = now >= downtime.at;
    tab.classList.toggle('soon', started || downtime.at - now < 5 * 60 * 1000);
    write(tabKicker, started ? 'Downtime now' : 'Planned downtime');
    write(tabTime, started ? 'Offline' : `${dayLabel(downtime.at) === 'Today' ? '' : `${dayLabel(downtime.at)} `}${clockTime(downtime.at)}`);
    write(tabCount, started ? `Back about ${clockTime(downtimeEnd(downtime))}` : `In ${untilLabel(downtime.at - now)}`);
    const why = downtime.note ? `${downtime.note}${/[.!?]$/.test(downtime.note) ? '' : '.'} ` : '';
    write(tabNote, `${why}About ${downtime.minutes >= 60 ? `${Math.round(downtime.minutes / 6) / 10} h` : `${downtime.minutes} min`}.`);
  }
  net.on('downtime', (message) => { game.downtime = message.downtime || null; bus.emit('downtime'); });
  bus.on('downtime', paintDowntime);
  bus.on('outages', paintDowntime);
  setInterval(paintDowntime, 1000);
  paintDowntime();

  // ---------------------------------------------------------------- an update landing
  const update = document.createElement('div');
  update.className = 'update-screen';
  update.setAttribute('role', 'alert');
  const RING = 2 * Math.PI * 88;
  update.innerHTML = `<div class="veil"></div><div class="hazard top"></div><div class="hazard bottom"></div>
    <div class="core">
      <div class="update-dial"><svg viewBox="0 0 190 190"><circle class="track" cx="95" cy="95" r="88" /><circle class="ticks" cx="95" cy="95" r="76" /><circle class="sweep" cx="95" cy="95" r="88" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="0" /></svg><b data-u="count"></b><small data-u="unit">SECONDS</small></div>
      <span class="kicker" data-u="kicker"></span><h2 data-u="title"></h2><p data-u="body"></p>
      <ul class="update-steps"><li data-step="warn">Warning</li><li data-step="restart">Restart</li><li data-step="link">Reconnect</li><li data-step="load">Load</li></ul>
    </div>`;
  document.body.append(update);
  const part = (name) => update.querySelector(`[data-u="${name}"]`);
  const sweep = update.querySelector('.sweep');
  let restart = null;      // { endsAt, total }: set by the server's warning, cleared once the game is back
  let ticker = null;
  function steps(now) {
    const order = ['warn', 'restart', 'link', 'load'];
    update.querySelectorAll('[data-step]').forEach((item) => { const at = order.indexOf(item.dataset.step), on = order.indexOf(now); item.className = at < on ? 'done' : at === on ? 'now' : ''; });
  }
  function paintUpdate() {
    if (!restart) return;
    const left = Math.max(0, Math.ceil((restart.endsAt - Date.now()) / 1000));
    const playing = game.screen === 'game';
    if (left > 0 && net.connected) {
      update.className = `update-screen on${playing ? ' frame' : ''}`;
      write(part('count'), String(left));
      write(part('unit'), 'SECONDS');
      sweep.style.strokeDashoffset = String(RING * (1 - left / Math.max(1, restart.total)));
      write(part('kicker'), 'Update incoming');
      part('title').innerHTML = playing ? 'Server restarting' : 'Server <em>restarting</em>';
      write(part('body'), playing ? '' : 'A new build is going in. Stay here: this page reconnects and reloads by itself, usually inside a minute.');
      steps('warn');
      return;
    }
    update.className = 'update-screen on down';
    write(part('count'), restart.loading ? 'LOAD' : 'WAIT');
    write(part('unit'), '');
    write(part('kicker'), restart.loading ? 'Update installed' : 'Updating');
    part('title').innerHTML = restart.loading ? 'New build <em>loading</em>' : 'Back in <em>a moment</em>';
    write(part('body'), restart.loading ? 'Loading the new version.' : 'The server is restarting with the new build. Nothing to do: this page comes back by itself. Coins, levels and skins are saved.');
    steps(restart.loading ? 'load' : net.connected ? 'load' : restart.dropped ? 'link' : 'restart');
  }
  function endUpdate() {
    restart = null;
    clearInterval(ticker); ticker = null;
    update.className = 'update-screen';
  }
  net.on('notice', (message) => {
    if (message.kind !== 'restart') return;
    const seconds = Math.max(0, Number(message.seconds) || 0);
    restart = { endsAt: Date.now() + seconds * 1000, total: seconds, dropped: false, loading: false };
    clearInterval(ticker);
    ticker = setInterval(paintUpdate, 250);
    paintUpdate();
    play('deny', { volume: 0.6 });
  });
  bus.on('net-status', ({ state }) => {
    if (!restart) return;
    if (state === 'closed') restart.dropped = true;
    // Same build came back (a restart with nothing new in it): hand the screen back.
    if (state === 'updating') restart.loading = true;
    paintUpdate();
  });
  // Config with the same build stamp means the server is back and there is nothing to reload for.
  bus.on('config', () => { if (restart?.dropped && !restart.loading) setTimeout(() => { if (restart && !restart.loading) endUpdate(); }, 600); });
  // Never hold the screen for ever: if the server has not come back in five minutes, let them see the page.
  setInterval(() => { if (restart && Date.now() - restart.endsAt > 5 * 60 * 1000) endUpdate(); }, 5000);

  // ---------------------------------------------------------------- patch notes
  const veil = document.createElement('div');
  veil.className = 'notes-veil';
  document.body.append(veil);
  let showing = null;      // the newest id on the card, to mark as read when it closes
  const seenId = () => Math.max(Number(game.profile?.notesSeen) || 0, Number(stored('notesSeen', 0)) || 0);
  const when = (date) => new Date(`${date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  // Two readers. Someone back after one update is told what is new. Someone who has been away for
  // several is told so, and gets every one of them: the newest first, then the ones before it under
  // their own heading. Either way it is shown once: closing it marks the newest as read, and nothing
  // comes up again until the next update lands.
  function showNotes(list, { fresh = true } = {}) {
    if (!list.length) return;
    showing = fresh ? list[0].id : null;
    const seen = seenId();
    const missed = fresh && list.length > 1;
    const entry = (note, index) => `<article class="notes-entry${note.id > seen ? ' fresh' : ''}" style="animation-delay:${Math.min(index, 6) * 0.06}s">
        <header><i class="${esc(String(note.tag || 'Update').toLowerCase())}">${esc(note.tag || 'Update')}</i><b>${esc(note.title)}</b><time>${esc(when(note.date))}</time></header>
        <ul>${note.notes.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></article>`;
    const body = missed
      ? `<p class="notes-mark">Latest</p>${entry(list[0], 0)}<p class="notes-mark">Before that <small>${list.length - 1} more you missed</small></p>${list.slice(1).map((note, index) => entry(note, index + 1)).join('')}`
      : list.map(entry).join('');
    const kicker = !fresh ? 'Patch notes' : missed ? 'While you were away' : 'New since you last played';
    const title = missed ? `You missed <em>${list.length} updates</em>` : "What's <em>new</em>";
    const line = !fresh ? 'Every update, newest first.' : missed ? `Everything that changed since ${esc(when(list[list.length - 1].date))}, newest first.` : 'The game was updated since you were last here.';
    veil.innerHTML = `<div class="notes-card" role="dialog" aria-modal="true" aria-label="Patch notes">
      <div class="notes-side"><i class="ring"></i><small>${kicker}</small>
        <h2>${title}</h2>
        <p>${line}</p>
        <span class="count">${fresh ? 'Shown once. They stay under Patch notes in the footer.' : `${list.length} update${list.length === 1 ? '' : 's'}`}</span>
        <button type="button" data-notes-close>${fresh ? 'Got it' : 'Close'}</button></div>
      <div class="notes-list">${body}</div></div>`;
    veil.classList.add('on');
    play('ui');
    setTimeout(() => veil.querySelector('[data-notes-close]')?.focus(), 0);
  }
  function closeNotes() {
    if (!veil.classList.contains('on')) return;
    veil.classList.remove('on');
    veil.innerHTML = '';
    if (showing) {
      store('notesSeen', showing);
      if (game.profile) game.profile.notesSeen = Math.max(game.profile.notesSeen || 0, showing);
      if (game.username) net.send({ type: 'prefs', notesSeen: showing });
    }
    showing = null;
    play('ready');
  }
  veil.addEventListener('click', (event) => { if (event.target === veil || event.target.closest('[data-notes-close]')) closeNotes(); });
  addEventListener('keydown', (event) => { if (veil.classList.contains('on') && (event.code === 'Escape' || event.code === 'Enter')) { event.preventDefault(); event.stopPropagation(); closeNotes(); } }, true);
  // Never over a fight, the loading screen, a present or another card: it waits its turn.
  const busy = () => Boolean(document.querySelector('#boot, .notice-card:not(.hidden), .loading-card:not(.hidden), .gift-veil.on, .update-screen.on')) || game.screen === 'game';
  let offered = false;
  function offerNotes() {
    if (offered || veil.classList.contains('on') || !game.profile) return;
    const seen = seenId();
    // A pilot who has never played has nothing to catch up on: start them at the newest entry.
    const brandNew = !seen && !(game.profile.history?.length) && (game.profile.xp || 0) === 0;
    if (brandNew) { offered = true; store('notesSeen', latestNoteId()); if (game.username) net.send({ type: 'prefs', notesSeen: latestNoteId() }); return; }
    const unread = notesSince(seen);
    if (!unread.length) { offered = true; return; }
    if (busy()) return;
    offered = true;
    // Every one they missed, however long they were gone (the list scrolls).
    showNotes(unread);
  }
  bus.on('signed-in', () => { offered = false; setTimeout(offerNotes, 900); });
  setInterval(offerNotes, 1500);

  // The footer's Patch notes link: the whole list, read or not.
  bus.on('open-notes', () => showNotes(PATCH_NOTES.slice(0, 30), { fresh: false }));
}

// What a developer's form sends: { at, minutes, note }, or null to take the plan down. The server checks
// the account, so calling this from anyone else's page does nothing.
export function planDowntime(plan) {
  net.send(plan ? { type: 'downtime', at: plan.at, minutes: plan.minutes ?? DOWNTIME.defaultMinutes, note: plan.note || '' } : { type: 'downtime', clear: true });
}
