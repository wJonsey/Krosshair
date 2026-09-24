// Discord login without touching Discord: fetch is stubbed, accounts go to a temp file.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from '../server/accounts.js';
import { DiscordAuth, callbackPage } from '../server/discord.js';

const env = { DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'secret', DISCORD_BOT_TOKEN: 'bot', PUBLIC_URL: 'https://example.test/' };
const request = { headers: { host: 'localhost:4174' } };
const store = () => new AccountStore(path.join(os.tmpdir(), `krosshair-accounts-${process.pid}-${Math.random()}.json`));

test('discord login needs an application id; the secret only picks the flow; joining needs the bot token', () => {
  // With no env var the committed application id (shared/constants.js) is used.
  assert.match(new DiscordAuth({}).clientId, /^(\d{15,25})?$/);
  assert.equal(new DiscordAuth({ DISCORD_CLIENT_ID: 'not-a-number' }).enabled, false);
  const idOnly = new DiscordAuth({ DISCORD_CLIENT_ID: '111111111111111111' });
  assert.equal(idOnly.enabled, true);
  assert.equal(new URL(idOnly.start(request)).searchParams.get('response_type'), 'token');
  assert.equal(new URL(new DiscordAuth(env).start(request)).searchParams.get('response_type'), 'code');
  const noBot = new URL(new DiscordAuth({ ...env, DISCORD_BOT_TOKEN: '' }).start(request));
  assert.equal(noBot.searchParams.get('scope'), 'identify');
  const full = new URL(new DiscordAuth(env).start(request));
  assert.equal(full.searchParams.get('scope'), 'identify guilds.join');
  assert.equal(full.searchParams.get('redirect_uri'), 'https://example.test/auth/discord/callback');
  assert.ok(!full.searchParams.get('scope').includes('email'));
});

test('callback exchanges the code, reads the user and adds them to the server', async () => {
  const discord = new DiscordAuth(env);
  const state = new URL(discord.start(request)).searchParams.get('state');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push([options.method || 'GET', String(url), options]);
    if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'user-token', scope: 'identify guilds.join' }), { status: 200 });
    if (String(url).endsWith('/users/@me')) return new Response(JSON.stringify({ id: '123456789012345678', username: 'long.shot', global_name: 'Long Shot!', avatar: 'abc123' }), { status: 200 });
    return new Response(null, { status: 201 });
  };
  try {
    const { user, joined } = await discord.finish(request, 'code', state);
    assert.equal(user.id, '123456789012345678');
    assert.equal(joined, true);
    const join = calls.find(([method]) => method === 'PUT');
    assert.match(join[1], /\/guilds\/1550214491696799824\/members\/123456789012345678$/);
    assert.equal(join[2].headers.Authorization, 'Bot bot');
    await assert.rejects(discord.finish(request, 'code', state), /expired/); // a state works once
  } finally { globalThis.fetch = realFetch; }
});

test('first discord login creates the account, later ones find it; names are made safe and unique', () => {
  const accounts = store();
  const first = accounts.discordSignIn({ id: '123456789012345678', username: 'long.shot', globalName: 'Long Shot!', avatar: 'abc123' });
  assert.equal(first.created, true);
  assert.equal(first.account.username, 'LongShot');
  const again = accounts.discordSignIn({ id: '123456789012345678', username: 'renamed', globalName: 'Renamed', avatar: null });
  assert.equal(again.created, false);
  assert.equal(again.account.username, 'LongShot');
  assert.equal(accounts.resume(again.session), first.account);
  assert.equal(accounts.discordSignIn({ id: '223456789012345678', username: 'x', globalName: 'Long Shot!' }).account.username, 'LongShot2');
  assert.equal(accounts.discordSignIn({ id: '323456789012345678', username: '!!', globalName: '…' }).account.username, 'Pilot');
  assert.equal(accounts.discordSignIn({ id: 'not-an-id', username: 'x' }), null);
});

test('a new discord account adopts guest progress once; password login never opens it', async () => {
  const accounts = store();
  const { account } = accounts.discordSignIn({ id: '123456789012345678', username: 'pilot', globalName: 'Pilot One' });
  assert.equal(accounts.claim(account, 'guest-token-0123456789'), true);
  assert.equal(account.profileToken, 'guest-token-0123456789');
  assert.equal(accounts.claim(account, 'another-token-0123456789'), false);
  assert.equal(await accounts.login('PilotOne', 'anything-at-all'), null);
});

test('the callback page keeps the session out of URLs and escapes errors', () => {
  const page = callbackPage({ session: 'tok</script>en', joined: true });
  assert.ok(!page.includes('</script>en'));
  assert.ok(page.includes("location.replace('/')"));
  assert.ok(callbackPage({ error: '<b>no</b>' }).includes('&lt;b&gt;no&lt;/b&gt;'));
});

test('implicit login only trusts a token that Discord says was issued to this application', async () => {
  const discord = new DiscordAuth({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_BOT_TOKEN: 'bot' });
  const realFetch = globalThis.fetch;
  let appId = '111111111111111111';
  const puts = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/oauth2/@me')) return new Response(JSON.stringify({ application: { id: appId }, scopes: ['identify', 'guilds.join'], user: { id: '123456789012345678', username: 'pilot', global_name: 'Pilot', avatar: null } }), { status: 200 });
    puts.push(String(url)); return new Response(null, { status: 204 });
  };
  try {
    const state = () => new URL(discord.start(request)).searchParams.get('state');
    const ok = await discord.finishToken('a-real-looking-token', state());
    assert.equal(ok.user.id, '123456789012345678');
    assert.equal(ok.joined, true);
    assert.equal(puts.length, 1);
    appId = '999999999999999999';
    await assert.rejects(discord.finishToken('token-from-another-app', state()), /isn’t for Krosshair/);
    await assert.rejects(discord.finishToken('a-real-looking-token', 'made-up-state'), /expired/);
  } finally { globalThis.fetch = realFetch; }
});

test('settings, key binds and crosshair are saved to the profile, cleaned', async () => {
  const { ProfileStore } = await import('../server/profiles.js');
  const profiles = new ProfileStore(path.join(os.tmpdir(), `krosshair-profiles-${process.pid}-${Math.random()}.json`));
  const token = 'guest-token-0123456789';
  profiles.get(token);
  profiles.savePrefs(token, { settings: { fov: 999, quality: 'ultra', showFps: true, fpsCap: 144, binds: { forward: ['KeyI', null], 'bad key!': ['x'], reload: ['<script>', 'KeyR'] }, crosshair: { color: '#00FF66', dot: { on: true, size: 99, opacity: 1 }, inner: { on: true, length: 5, thickness: 2, offset: 3, opacity: 1 } }, evil: 'x' } });
  const saved = profiles.view(token).settings;
  assert.equal(saved.fov, 120);
  assert.equal(saved.quality, 'ultra');
  assert.equal(saved.fpsCap, 144);
  assert.deepEqual(saved.binds, { forward: ['KeyI', null], reload: [null, 'KeyR'] });
  assert.equal(saved.crosshair.color, '#00ff66');
  assert.equal(saved.crosshair.dot.size, 12);
  assert.equal(saved.evil, undefined);
});

// The table of logins in progress was shared by everyone, so one script filling it shut the door on
// every real login for ten minutes. Each address holds only a few at once.
test('one address cannot fill the table of logins in progress', () => {
  const discord = new DiscordAuth({ DISCORD_CLIENT_ID: '123456789012345678', PUBLIC_URL: 'https://krosshair.test' });
  const request = { headers: { host: 'krosshair.test' } };
  let opened = 0;
  for (let i = 0; i < 2500; i += 1) if (discord.start(request, '203.0.113.9')) opened += 1;
  assert.ok(opened <= 10, `one address opened ${opened} logins`);
  assert.ok(discord.start(request, '198.51.100.4'), 'somebody else could not log in');
});
