// The Social page: friends, requests, blocks, and the party you queue with.
// The server sends one 'social' message holding every list, so this file only draws what it is given.
import { game } from './state.js';
import { net } from './net.js';
import { play } from './audio.js';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const avatarHtml = (who, size) => (who.avatar ? `<img class="avatar" src="${escapeHtml(who.avatar)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" />` : `<i class="avatar blank" style="width:${size}px;height:${size}px">${escapeHtml(who.name.slice(0, 1).toUpperCase())}</i>`);

// Everything the page draws. null until the first 'social' lands, so the page can say it is loading.
let social = null;
let search = { name: '', pilot: undefined, looking: false };
let searchTimer = null;
let redraw = () => {};
const collapsed = new Set();

export function initSocial(onChange) { redraw = onChange; }
export function socialLoaded() { return social !== null; }
// The number for the Social tab's badge: anything waiting on an answer.
export function socialBadge() { return social ? social.requestsIn.length : 0; }
export function partySize() { return social?.party?.members.length || 1; }

net.on('social', (message) => { social = message; redraw(); });
net.on('friends-result', (message) => { if (message.friends) social = { ...(social || {}), ...message }; redraw(); });
net.on('party-result', (message) => { if (message.friends) social = { ...(social || {}), ...message }; redraw(); });
net.on('lookup-result', (message) => {
  if (message.query.toLowerCase() !== search.name.toLowerCase()) return;
  search = { ...search, pilot: message.pilot, looking: false };
  redraw();
});

export function askSocial() { net.send({ type: 'social' }); }

function rowHtml(who, { note, actions, flag = false, tone = '' } = {}) {
  const where = note || (who.online ? who.where : 'Offline');
  return `<div class="social-row${tone ? ` ${tone}` : ''}">
    ${avatarHtml(who, 32)}
    <span class="social-who"><b>${escapeHtml(who.name)}</b><small>${escapeHtml(where)} · LV ${who.level}</small></span>
    ${flag ? '<i class="social-flag" aria-hidden="true">!</i>' : `<i class="live-dot${who.online ? '' : ' off'}" title="${who.online ? 'Online' : 'Offline'}"></i>`}
    <span class="social-actions">${actions}</span>
  </div>`;
}
const act = (action, name, label, cls = 'mini') => `<button type="button" class="${cls}" data-social="${action}" data-name="${escapeHtml(name)}">${label}</button>`;

function groupHtml(key, title, rows, count) {
  const shut = collapsed.has(key);
  return `<section class="social-group${shut ? ' shut' : ''}">
    <button type="button" class="social-head" data-social="fold" data-name="${key}" aria-expanded="${!shut}"><b>${title}</b><small>${count}</small><i class="chev" aria-hidden="true">▾</i></button>
    <div class="social-body">${rows || '<p class="muted">Nothing here.</p>'}</div>
  </section>`;
}

function partyHtml() {
  const party = social.party;
  const members = party?.members || [];
  const leader = party && party.leader.toLowerCase() === (game.username || '').toLowerCase();
  const slots = Array.from({ length: party?.limit || 5 }, (_, index) => {
    const member = members[index];
    if (!member) return '<div class="party-slot empty"><i aria-hidden="true">+</i><small>Open</small></div>';
    return `<div class="party-slot${member.leader ? ' leader' : ''}">
      ${avatarHtml(member, 40)}
      <b>${escapeHtml(member.name)}</b>
      <small>${member.leader ? 'Leader' : member.ready ? 'Ready' : 'Not ready'}</small>
      ${leader && !member.leader ? `<span class="slot-actions">${act('promote', member.name, 'Promote', 'mini ghost')}${act('kick', member.name, 'Remove', 'mini ghost')}</span>` : ''}
    </div>`;
  }).join('');
  const me = members.find((member) => member.name.toLowerCase() === (game.username || '').toLowerCase());
  return `<div class="panel party-panel">
    <p class="eyebrow">Party <small>${members.length}/${party?.limit || 5}</small></p>
    <div class="party-slots">${slots}</div>
    <div class="party-foot">
      ${members.length > 1 ? act('leave', '', 'Leave party', 'mini ghost') : '<small class="muted">Invite a friend to queue together.</small>'}
      ${members.length > 1 && !leader ? act(me?.ready ? 'unready' : 'ready', '', me?.ready ? 'Ready ✓' : 'Ready up') : ''}
      ${party?.queued ? '<small class="muted">In a match.</small>' : ''}
    </div>
    ${leader && members.length > 1 ? '<small class="muted">Start a match from Play and your party comes with you.</small>' : ''}
  </div>`;
}

export function socialPageHtml(tabs = '') {
  if (!game.username) return `<section class="page-wide">${tabs}<p class="eyebrow">Social</p><h1 class="page-title">Friends need an <em>account.</em></h1><p class="muted">Log in to add friends and queue in a party.</p></section>`;
  if (!social) { askSocial(); return `<section class="page-wide">${tabs}<p class="eyebrow">Social</p><h1 class="page-title">Your <em>squad.</em></h1><p class="muted">Loading…</p></section>`; }

  const found = search.pilot;
  const already = found && [...social.friends, ...social.requestsOut, ...social.blocked].some((who) => who.name.toLowerCase() === found.name.toLowerCase());
  const searchResult = search.looking ? '<p class="muted">Looking…</p>'
    : search.name.length < 2 ? ''
    : !found ? `<p class="muted">No pilot called “${escapeHtml(search.name)}”.</p>`
    : found.you ? '<p class="muted">That is you.</p>'
    : `<div class="pilot-card">${avatarHtml(found, 44)}<div><b>${escapeHtml(found.name)}</b><small>${escapeHtml(found.title)} · LV ${found.level}</small></div>${already ? '<small class="muted">Already on your list.</small>' : act('add', found.name, 'Send request')}</div>`;

  const invites = social.requestsIn.map((who) => rowHtml(who, {
    note: 'Wants to be friends', flag: true, tone: 'invite',
    actions: `${act('accept', who.name, 'Accept')}${act('reject', who.name, 'Reject', 'mini ghost')}${act('block', who.name, 'Block', 'mini ghost')}`,
  })).join('');

  const canInvite = (who) => who.online && !(social.party?.members || []).some((member) => member.name === who.name) && (social.party?.members.length || 1) < (social.party?.limit || 5);
  const friendActions = (who) => `${canInvite(who) ? act('invite', who.name, 'Invite') : ''}${act('remove', who.name, 'Remove', 'mini ghost')}${act('block', who.name, 'Block', 'mini ghost')}`;
  const online = social.friends.filter((who) => who.online);
  const offline = social.friends.filter((who) => !who.online);

  return `<section class="page-main social-page">
      ${tabs}
      <p class="eyebrow">Social</p>
      <h1 class="page-title">Your <em>squad.</em></h1>
      <div class="panel social-find">
        <label class="field"><span>Find a pilot</span><input id="social-search" type="text" maxlength="16" autocomplete="off" placeholder="Their username" value="${escapeHtml(search.name)}" /></label>
        ${searchResult}
      </div>
      ${groupHtml('invites', 'Friend invites', invites, social.requestsIn.length)}
      ${groupHtml('online', 'Online', online.map((who) => rowHtml(who, { actions: friendActions(who) })).join(''), online.length)}
      ${groupHtml('offline', 'Offline', offline.map((who) => rowHtml(who, { actions: friendActions(who) })).join(''), offline.length)}
      ${social.requestsOut.length ? groupHtml('sent', 'Sent', social.requestsOut.map((who) => rowHtml(who, { note: 'Waiting for an answer', actions: act('reject', who.name, 'Cancel', 'mini ghost') })).join(''), social.requestsOut.length) : ''}
      ${social.recent.length ? groupHtml('recent', 'Recent players', social.recent.map((who) => rowHtml(who, { note: 'You played together', actions: `${act('add', who.name, 'Add')}${act('block', who.name, 'Block', 'mini ghost')}` })).join(''), social.recent.length) : ''}
      ${social.blocked.length ? groupHtml('blocked', 'Blocked', social.blocked.map((who) => rowHtml(who, { note: 'Blocked', actions: act('unblock', who.name, 'Unblock', 'mini ghost') })).join(''), social.blocked.length) : ''}
    </section>
    <aside class="page-side">${partyHtml()}</aside>`;
}

// Returns true when the page should be drawn again.
export function onSocialClick(target) {
  const action = target.dataset.social;
  if (!action) return false;
  const name = target.dataset.name || '';
  if (action === 'fold') {
    if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
    play('ui');
    return true;
  }
  const friendAction = { add: 'add', accept: 'accept', reject: 'reject', remove: 'remove', block: 'block', unblock: 'unblock' }[action];
  if (friendAction) {
    net.send({ type: 'friends', action: friendAction, name });
    play(action === 'block' || action === 'reject' || action === 'remove' ? 'uiBack' : 'ui');
    if (action === 'add') search = { name: '', pilot: undefined, looking: false };
    return true;
  }
  const partyAction = { invite: 'invite', kick: 'kick', promote: 'promote', leave: 'leave' }[action];
  if (partyAction) {
    net.send({ type: 'party', action: partyAction, name });
    play(partyAction === 'kick' || partyAction === 'leave' ? 'uiBack' : 'ui');
    return true;
  }
  if (action === 'ready' || action === 'unready') {
    net.send({ type: 'party', action: 'ready', ready: action === 'ready' });
    play('ui');
    return true;
  }
  return false;
}

export function onSocialInput(element) {
  if (element.id !== 'social-search') return false;
  const name = element.value.trim();
  search = { ...search, name, pilot: name.length < 2 ? undefined : search.pilot, looking: name.length >= 2 };
  clearTimeout(searchTimer);
  if (name.length >= 2) searchTimer = setTimeout(() => net.send({ type: 'lookup', name }), 300);
  return false; // let the pilot keep typing; the reply redraws
}
// The search box survives a redraw, like the other pages' inputs.
export function keepSocialInput() { return document.querySelector('#social-search')?.value ?? null; }
export function restoreSocialInput(value) {
  const box = document.querySelector('#social-search');
  if (box && value !== null && value !== undefined) { box.value = value; if (document.activeElement !== box) box.setSelectionRange(value.length, value.length); }
}
