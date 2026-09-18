// Guest profiles (never saved) and the ranked ladder (placements, divisions, promotions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profiles.js';
import { PLACEMENT_MATCHES, RANK_TIERS, rankInfo } from '../shared/constants.js';

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), 'krosshair-ranked-'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
  await profiles.load();
  return profiles;
}
const saved = async (profiles) => JSON.parse(await readFile(profiles.file, 'utf8'));

test('guest profiles are never written to disk, and go once the guest has left', async () => {
  const profiles = await store();
  const guest = ProfileStore.newToken(), pilot = ProfileStore.newToken();
  profiles.holdGuest(guest);
  profiles.get(guest).xp = 500;
  profiles.get(pilot).xp = 700;
  profiles.scheduleSave(); profiles.flush();
  const disk = await saved(profiles);
  assert.ok(disk[ProfileStore.key(pilot)]);
  assert.equal(disk[ProfileStore.key(guest)], undefined);
  assert.equal(profiles.isGuest(guest), true);
  assert.equal(profiles.isGuest(pilot), false, 'a saved profile can never be picked up as a guest');
  profiles.releaseGuest(guest, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(profiles.isGuest(guest), false);
  assert.equal(profiles.profiles.has(ProfileStore.key(guest)), false);
  // A match that ends after the guest has gone still never lands on disk.
  profiles.recordMatch(guest, { won: true, kills: 3 });
  profiles.scheduleSave(); profiles.flush();
  assert.equal((await saved(profiles))[ProfileStore.key(guest)], undefined);
});

test('a guest who logs in keeps the session: the profile becomes a saved one', async () => {
  const profiles = await store();
  const guest = ProfileStore.newToken();
  profiles.holdGuest(guest);
  profiles.get(guest).xp = 900;
  profiles.releaseGuest(guest, 5);
  profiles.keepGuest(guest);
  await new Promise((resolve) => setTimeout(resolve, 20));
  profiles.flush();
  assert.equal((await saved(profiles))[ProfileStore.key(guest)].xp, 900);
});

test('the ladder: placements first, then three divisions a tier, Apex on top', () => {
  assert.equal(rankInfo(1500, 0).placed, false);
  assert.deepEqual(rankInfo(1500, PLACEMENT_MATCHES - 1).placement, { played: PLACEMENT_MATCHES - 1, total: PLACEMENT_MATCHES });
  assert.equal(rankInfo(900).name, 'Bronze III');
  assert.equal(rankInfo(1000).name, 'Bronze II');
  assert.equal(rankInfo(1099).name, 'Bronze I');
  assert.equal(rankInfo(1100).name, 'Silver III');
  assert.equal(rankInfo(1249).name, 'Silver I');
  assert.equal(rankInfo(1250).next, 'Gold II');
  assert.equal(rankInfo(1840).next, 'Apex');
  assert.equal(rankInfo(2400).name, 'Apex');
  // Every step up the rating never moves the rank down.
  let step = -1;
  for (let sr = 800; sr < 2200; sr += 5) { const info = rankInfo(sr); assert.ok(info.step >= step, `${sr} went down`); step = info.step; assert.ok(info.progress >= 0 && info.progress <= 1); }
  assert.equal(step, (RANK_TIERS.length - 1) * 3);
});

test('placement matches move the rating twice as far, and the report says what changed', async () => {
  const profiles = await store();
  const token = ProfileStore.newToken();
  const report = profiles.recordMatch(token, { won: true, ranked: true, ratingDelta: 30 });
  assert.deepEqual(report.rank, { before: 1000, after: 1030, matchesBefore: 0, matchesAfter: 1 });
  assert.equal(report.ratingDelta, 30);
  const casual = profiles.recordMatch(token, { won: true, ranked: false });
  assert.equal(casual.rank, null);
});

test('a ranked room doubles the swing for pilots still in placements', async () => {
  const { Room } = await import('../server/room.js');
  const summaries = new Map();
  const ratings = { new: { xp: 0, rating: 1000, rankedMatches: 0 }, old: { xp: 0, rating: 1000, rankedMatches: 20 } };
  const profiles = {
    get: (token) => ratings[token.split('-')[0]],
    view: (token) => ({ level: 1, rating: 1000, rankedMatches: ratings[token.split('-')[0]].rankedMatches }),
    recordMatch: (token, summary) => { summaries.set(token, summary); return {}; },
  };
  const room = new Room({ name: 'ranked-t', queue: 'ranked', isPublic: true, profiles, onEmpty: () => {} });
  clearInterval(room.interval);
  const socket = () => ({ readyState: 1, send: () => {} });
  const look = { color: '#ec6a9e', accent: '#6ce6d1', tracer: '#ffc857', title: 'Recruit' };
  const a = room.join(socket(), { token: 'new-token-0123456789', session: 's1', name: 'Newcomer' }, look);
  const b = room.join(socket(), { token: 'old-token-0123456789', session: 's2', name: 'Veteran' }, look);
  assert.notEqual(a.team, b.team);
  room.scores = { [a.team]: 5, [b.team]: 2 };
  room.endMatch();
  assert.equal(Math.round(summaries.get('new-token-0123456789').ratingDelta), 30, 'placement: K = 60 at even odds');
  assert.equal(Math.round(summaries.get('old-token-0123456789').ratingDelta), -15, 'placed: K = 30 at even odds');
  room.close();
});
