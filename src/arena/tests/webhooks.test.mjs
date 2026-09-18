// Discord webhooks without Discord: fetch is stubbed and state goes to a temp file.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Webhooks } from '../server/webhooks.js';

const URL_OK = 'https://discord.com/api/webhooks/123456789012345678/abc-DEF_123';
const make = (env) => new Webhooks({ env, root: process.cwd(), stateFile: path.join(os.tmpdir(), `krosshair-hooks-${process.pid}-${Math.random()}.json`), siteUrl: 'https://krosshair.online' });
async function capture(run) {
  const posts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { posts.push({ url: String(url), body: JSON.parse(options.body) }); return new Response(null, { status: 204 }); };
  try { await run(posts); } finally { globalThis.fetch = realFetch; }
  return posts;
}

test('webhooks are off unless the URL is a real Discord webhook', async () => {
  assert.deepEqual(make({}).status(), { updates: false, leaderboard: false });
  assert.equal(make({ DISCORD_WEBHOOK_UPDATES: 'https://evil.example/api/webhooks/1/x' }).status().updates, false);
  assert.equal(make({ DISCORD_WEBHOOK_UPDATES: URL_OK }).status().updates, true);
  const posts = await capture(async () => { await make({}).announceRestart({ seconds: 20, pilots: 3, matches: 1 }); });
  assert.equal(posts.length, 0);
});

test('a restart warns that matches will be lost, and never pings anyone', async () => {
  const posts = await capture(async () => { await make({ DISCORD_WEBHOOK_UPDATES: URL_OK }).announceRestart({ seconds: 20, pilots: 3, matches: 1 }); });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, URL_OK);
  assert.match(posts[0].body.embeds[0].description, /20 seconds/);
  assert.match(posts[0].body.embeds[0].description, /disconnected/);
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });
});

test('boot announces a commit once, not on every restart', async () => {
  const hooks = make({ DISCORD_WEBHOOK_UPDATES: URL_OK });
  hooks.commit = () => ({ hash: 'abc1234', subject: 'Add _maps_', author: 'George' });
  const posts = await capture(async () => { await hooks.announceBoot(); await hooks.announceBoot(); });
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.embeds[0].description, /Add \\_maps\\_/);
  hooks.commit = () => ({ hash: 'def5678', subject: 'Next', author: 'George' });
  assert.equal((await capture(async () => { await hooks.announceBoot(); })).length, 1);
});

test('the leaderboard posts when a podium changes, and stays quiet otherwise', async () => {
  const hooks = make({ DISCORD_WEBHOOK_LEADERBOARD: URL_OK });
  const board = (names) => ({ rating: { label: 'Skill rating', top: names.map((name, index) => ({ name, value: 1500 - index * 50, level: 9 })) } });
  const format = (id, row) => `${row.value} SR`;
  const posts = await capture(async () => {
    await hooks.announceBoards(board(['Ana', 'Bo', 'Cy', 'Di']), format);   // first look: just remember it
    await hooks.announceBoards(board(['Ana', 'Bo', 'Cy', 'Di']), format);   // nothing changed
    await hooks.announceBoards(board(['Ana', 'Bo', 'Cy', 'Ed']), format);   // 4th place is not the podium
    await hooks.announceBoards(board(['Bo', 'Ana', 'Cy', 'Ed']), format);   // new #1
  });
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.embeds[0].title, /Bo takes #1 in Skill rating/);
  assert.match(posts[0].body.embeds[0].fields[0].value, /🥇 \*\*Bo\*\* · 1500 SR/);
});
