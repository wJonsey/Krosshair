// The Social drawer: friends, requests and the party you queue with.
// It slides out from the menu bar rather than being a page, so you can check who is on without
// leaving whatever you were doing. The server sends one 'social' message holding every list, so
// this file only draws what it is given.
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const avatarHtml = (who, size) => (who.avatar ? `<img class="avatar" src="${escapeHtml(who.avatar)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" />` : `<i class="avatar blank" style="width:${size}px;height:${size}px">${escapeHtml(who.name.slice(0, 1).toUpperCase())}</i>`);

export const FRIENDS_MARK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="7.5" r="3"/><path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3 3 0 0 1 0 5.6"/></svg>';

let social = null;
let search = { name: '', pilot: undefined, looking: false };
let searchTimer = null;
let onCount = () => {};
const collapsed = new Set();
const invites = new Map(); // party id -> { from, at }

// The drawer lives on the body so it can sit over whatever is behind it, like the settings card.
const drawer = document.createElement('div');
drawer.className = 'social-drawer hidden';
drawer.setAttribute('aria-label', 'Friends');
document.body.append(drawer);
const inviteStack = document.createElement('div');
inviteStack.className = 'invite-stack';
document.body.append(inviteStack);

export function initSocial(onChange) { onCount = onChange || (() => {}); }
export function socialBadge() { return social ? social.requestsIn.length + invites.size : 0; }
export function friendsOnline() { return social ? social.friends.filter((who) => who.online).length : 0; }
export function partySize() { return social?.party?.members.length || 1; }
export function socialOpen() { return !drawer.classList.contains('hidden'); }

export function openSocial() {
  if (!game.username) return;
  drawer.classList.remove('hidden');
  if (!social) askSocial();
  drawFriends();
  setTimeout(() => drawer.querySelector('#social-search')?.focus(), 60);
}
export function closeSocial() { drawer.classList.add('hidden'); }
export function toggleSocial() { if (socialOpen()) { play('uiBack'); closeSocial(); } else { play('ui'); openSocial(); } }

export function askSocial() { net.send({ type: 'social' }); }

net.on('social', (message) => { social = message; refresh(); });
net.on('friends-result', (message) => {
  if (message.friends) social = { ...(social || {}), ...message };
  if (message.error) flash(message.error, 'bad');
  refresh();
});
net.on('party-result', (message) => {
  if (message.friends) social = { ...(social || {}), ...message };
  if (message.error) flash(message.error, 'bad');
  refresh();
});
net.on('lookup-result', (message) => {
  if (String(message.query || '').toLowerCase() !== search.name.toLowerCase()) return;
  search = { ...search, pilot: message.pilot, looking: false };
  refresh();
});
// An invite is the one thing that has to interrupt you: it expires, and only you can answer it.
net.on('party-invite', (message) => {
  invites.set(message.id, { from: message.from, size: message.size, at: Date.now() });
  play('ui');
  drawInvites();
  onCount();
});

function refresh() { if (socialOpen()) drawFriends(); drawInvites(); onCount(); }
let flashText = null;
let flashTimer = null;
function flash(text, tone) {
  flashText = { text, tone };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashText = null; if (socialOpen()) drawFriends(); }, 4000);
}

// The button that sits in the menu bar next to the online count.
export function socialButtonHtml() {
  if (!game.username) return '';
  const waiting = socialBadge();
  const party = partySize();
  return `<button type="button" id="social-button" class="social-chip${socialOpen() ? ' active' : ''}" title="Friends" aria-label="Friends">${FRIENDS_MARK}<b>${friendsOnline()}</b>${party > 1 ? `<i class="party-pip">${party}</i>` : ''}${waiting ? `<i class="badge">${waiting}</i>` : ''}</button>`;
}

function rowHtml(who, { note, actions, flag = false, tone = '' } = {}) {
  const where = note || (who.online ? who.where : 'Offline');
  return `<div class="social-row${tone ? ` ${tone}` : ''}">
    ${avatarHtml(who, 30)}
    <span class="social-who"><b>${escapeHtml(who.name)}</b><small>${escapeHtml(where)}</small></span>
    ${flag ? '<i class="social-flag" aria-hidden="true">!</i>' : who.online === undefined ? '' : `<i class="live-dot${who.online ? '' : ' off'}" title="${who.online ? 'Online' : 'Offline'}"></i>`}
    <span class="social-actions">${actions}</span>
  </div>`;
}
const act = (action, name, label, cls = 'mini') => `<button type="button" class="${cls}" data-social="${action}" data-name="${escapeHtml(name)}">${label}</button>`;

function groupHtml(key, title, rows, count) {
  if (!count) return '';
  const shut = collapsed.has(key);
  return `<section class="social-group${shut ? ' shut' : ''}">
    <button type="button" class="social-head" data-social="fold" data-name="${key}" aria-expanded="${!shut}"><b>${title}</b><small>${count}</small><i class="chev" aria-hidden="true">&#9662;</i></button>
    <div class="social-body">${rows}</div>
  </section>`;
}

function partyHtml() {
  const party = social.party;
  const members = party?.members || [];
  const leader = party && party.leader.toLowerCase() === (game.username || '').toLowerCase();
  if (members.length <= 1) return '<div class="party-solo"><p class="muted">Flying solo. Invite a friend and you queue together.</p></div>';
  const me = members.find((member) => member.name.toLowerCase() === (game.username || '').toLowerCase());
  const slots = members.map((member) => `<div class="party-slot${member.leader ? ' leader' : ''}">
      ${avatarHtml(member, 32)}
      <b>${escapeHtml(member.name)}</b>
      <small>${member.leader ? 'Leader' : member.ready ? 'Ready' : 'Not ready'}</small>
      ${leader && !member.leader ? `<span class="slot-actions">${act('promote', member.name, 'Lead', 'mini ghost')}${act('kick', member.name, '&#10005;', 'mini ghost')}</span>` : ''}
    </div>`).join('');
  return `<div class="party-box">
    <p class="social-sub">Party <small>${members.length}/${party.limit}</small></p>
    <div class="party-slots">${slots}</div>
    <div class="party-foot">
      ${act('leave', '', 'Leave', 'mini ghost')}
      ${!leader ? act(me?.ready ? 'unready' : 'ready', '', me?.ready ? 'Ready &#10003;' : 'Ready up') : ''}
      ${party.queued ? '<small class="muted">In a match.</small>' : leader ? '<small class="muted">Start from Play and they come too.</small>' : ''}
    </div>
  </div>`;
}

function drawFriends() {
  const keep = drawer.querySelector('#social-search');
  const kept = keep ? { value: keep.value, focus: document.activeElement === keep } : null;
  drawer.innerHTML = shellHtml();
  if (kept) {
    const box = drawer.querySelector('#social-search');
    if (box) { box.value = kept.value; if (kept.focus) { box.focus(); box.setSelectionRange(kept.value.length, kept.value.length); } }
  }
}

function shellHtml() {
  if (!game.username) return '<div class="social-inner"><p class="muted">Log in to add friends.</p></div>';
  const head = `<header class="social-top"><b>Friends</b><button type="button" class="social-x" data-social="close" aria-label="Close">&#10005;</button></header>`;
  if (!social) return `<div class="social-inner">${head}<p class="muted">Loading&#8230;</p></div>`;

  const found = search.pilot;
  const known = found && [...social.friends, ...social.requestsOut, ...social.requestsIn, ...social.blocked].some((who) => who.name.toLowerCase() === found.name.toLowerCase());
  const result = search.looking ? '<p class="muted">Looking&#8230;</p>'
    : search.name.length < 2 ? ''
    : !found ? `<p class="muted">No pilot called &#8220;${escapeHtml(search.name)}&#8221;.</p>`
    : found.you ? '<p class="muted">That is you.</p>'
    : `<div class="found-row">${avatarHtml(found, 30)}<span class="social-who"><b>${escapeHtml(found.name)}</b><small>${escapeHtml(found.title)} &#183; LV ${found.level}</small></span>${known ? '<small class="muted">On your list</small>' : act('add', found.name, 'Add')}</div>`;

  const invited = social.requestsIn.map((who) => rowHtml(who, {
    note: 'Wants to be friends', flag: true, tone: 'invite',
    actions: `${act('accept', who.name, 'Accept')}${act('reject', who.name, '&#10005;', 'mini ghost')}`,
  })).join('');

  const room = (social.party?.members.length || 1) < (social.party?.limit || 5);
  const inParty = (who) => (social.party?.members || []).some((member) => member.name === who.name);
  const canInvite = (who) => who.online && room && !inParty(who);
  const actionsFor = (who) => `${canInvite(who) ? act('invite', who.name, 'Invite') : ''}${act('remove', who.name, 'Remove', 'mini ghost')}${act('block', who.name, 'Block', 'mini ghost')}`;
  const online = social.friends.filter((who) => who.online);
  const offline = social.friends.filter((who) => !who.online);

  return `<div class="social-inner">
    ${head}
    ${flashText ? `<p class="social-flash ${flashText.tone}">${escapeHtml(flashText.text)}</p>` : ''}
    ${partyHtml()}
    <label class="social-search"><input id="social-search" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Add a friend by name" value="${escapeHtml(search.name)}" /></label>
    ${result}
    <div class="social-lists">
      ${groupHtml('invites', 'Friend invites', invited, social.requestsIn.length)}
      ${groupHtml('online', 'Online', online.map((who) => rowHtml(who, { actions: actionsFor(who) })).join(''), online.length)}
      ${groupHtml('offline', 'Offline', offline.map((who) => rowHtml(who, { actions: actionsFor(who) })).join(''), offline.length)}
      ${groupHtml('sent', 'Sent', social.requestsOut.map((who) => rowHtml(who, { note: 'Waiting', actions: act('reject', who.name, 'Cancel', 'mini ghost') })).join(''), social.requestsOut.length)}
      ${groupHtml('recent', 'Recent players', social.recent.map((who) => rowHtml(who, { note: 'You played together', actions: act('add', who.name, 'Add') })).join(''), social.recent.length)}
      ${groupHtml('blocked', 'Blocked', social.blocked.map((who) => rowHtml(who, { note: 'Blocked', actions: act('unblock', who.name, 'Unblock', 'mini ghost') })).join(''), social.blocked.length)}
      ${!social.friends.length && !social.requestsIn.length ? '<p class="muted">No friends yet. Search for a pilot by name, or add someone you just played.</p>' : ''}
    </div>
  </div>`;
}

// Party invites stack in the corner. They are the only thing here that shows itself.
function drawInvites() {
  for (const [id, invite] of invites) if (Date.now() - invite.at > 2 * 60 * 1000) invites.delete(id);
  const mine = social?.party?.members.length > 1;
  inviteStack.innerHTML = [...invites].map(([id, invite]) => `<div class="invite-card">
      ${avatarHtml(invite.from, 34)}
      <span class="social-who"><b>${escapeHtml(invite.from.name)}</b><small>Invited you to a party${mine ? ' (you would leave yours)' : ''}</small></span>
      <span class="invite-actions">
        <button type="button" class="mini" data-invite="join" data-id="${escapeHtml(id)}">Join</button>
        <button type="button" class="mini ghost" data-invite="no" data-id="${escapeHtml(id)}" aria-label="Decline">&#10005;</button>
      </span>
    </div>`).join('');
}

drawer.addEventListener('click', (event) => {
  if (event.target === drawer) { play('uiBack'); return closeSocial(); }
  const target = event.target.closest('button');
  if (target && onSocialClick(target)) drawFriends();
});
drawer.addEventListener('input', (event) => { if (event.target.id === 'social-search') onSocialInput(event.target); });
drawer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { play('uiBack'); closeSocial(); } });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && socialOpen()) { play('uiBack'); closeSocial(); } });
inviteStack.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-invite]');
  if (!target) return;
  const id = target.dataset.id;
  if (target.dataset.invite === 'join') { net.send({ type: 'party', action: 'join', id }); play('ui'); }
  else play('uiBack');
  invites.delete(id);
  drawInvites();
  onCount();
});

// Returns true when the drawer should be drawn again.
export function onSocialClick(target) {
  const action = target.dataset.social;
  if (!action) return false;
  const name = target.dataset.name || '';
  if (action === 'close') { play('uiBack'); closeSocial(); return false; }
  if (action === 'fold') { if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name); play('ui'); return true; }
  const friendAction = { add: 'add', accept: 'accept', reject: 'reject', remove: 'remove', block: 'block', unblock: 'unblock' }[action];
  if (friendAction) {
    net.send({ type: 'friends', action: friendAction, name });
    play(['block', 'reject', 'remove'].includes(action) ? 'uiBack' : 'ui');
    if (action === 'add') { search = { name: '', pilot: undefined, looking: false }; }
    return true;
  }
  const partyAction = { invite: 'invite', kick: 'kick', promote: 'promote', leave: 'leave' }[action];
  if (partyAction) {
    net.send({ type: 'party', action: partyAction, name });
    play(['kick', 'leave'].includes(partyAction) ? 'uiBack' : 'ui');
    return true;
  }
  if (action === 'ready' || action === 'unready') { net.send({ type: 'party', action: 'ready', ready: action === 'ready' }); play('ui'); return true; }
  return false;
}

export function onSocialInput(element) {
  if (element.id !== 'social-search') return false;
  const name = element.value.trim();
  search = { ...search, name, pilot: name.length < 2 ? undefined : search.pilot, looking: name.length >= 2 };
  clearTimeout(searchTimer);
  if (name.length >= 2) searchTimer = setTimeout(() => net.send({ type: 'lookup', name }), 300);
  return false;
}
