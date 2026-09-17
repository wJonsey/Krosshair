// "Log in with Discord": OAuth2 code flow, no email scope. The first login creates the account, every
// login after that finds it again by Discord ID, and each login adds the pilot to the community server
// (they see "Join servers for you" on Discord's consent screen before agreeing).
//
// Needs a Discord application — see README "Discord login". Without the env vars the feature is simply off.
import { randomBytes } from 'node:crypto';

const DISCORD_API = 'https://discord.com/api/v10';
const STATE_TTL = 10 * 60 * 1000;

export class DiscordAuth {
  constructor(env = process.env) {
    this.clientId = String(env.DISCORD_CLIENT_ID || '').trim();
    this.clientSecret = String(env.DISCORD_CLIENT_SECRET || '').trim();
    this.botToken = String(env.DISCORD_BOT_TOKEN || '').trim().replace(/^Bot\s+/i, '');
    this.guildId = env.DISCORD_GUILD_ID || '1550214491696799824'; // the Krosshair server behind discord.gg/uFVygVtKzt
    this.publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');
    this.api = env.DISCORD_API || DISCORD_API; // overridable so the flow can be tested against a stand-in
    this.states = new Map(); // state → created at; proves the callback belongs to a login we started
  }

  get enabled() { return Boolean(this.clientId && this.clientSecret); }
  get autoJoin() { return Boolean(this.enabled && this.botToken && this.guildId); }

  // Discord only redirects to URLs registered on the application, so this must match one of them exactly.
  redirectUri(request) {
    if (this.publicUrl) return `${this.publicUrl}/auth/discord/callback`;
    const proto = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${request.headers.host}/auth/discord/callback`;
  }

  start(request) {
    const t = Date.now();
    for (const [state, at] of this.states) if (t - at > STATE_TTL) this.states.delete(state);
    if (this.states.size > 2000) return null;
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, t);
    const query = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri(request), scope: this.autoJoin ? 'identify guilds.join' : 'identify', state, prompt: 'none' });
    return `https://discord.com/oauth2/authorize?${query}`;
  }

  // Returns { user, joined } or throws with a message that is safe to show.
  async finish(request, code, state) {
    const at = this.states.get(state);
    this.states.delete(state);
    if (!at || Date.now() - at > STATE_TTL) throw new Error('That login link expired. Start again from the game.');
    const tokenResponse = await fetch(`${this.api}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(request) }),
    });
    if (!tokenResponse.ok) throw new Error('Discord did not accept that login. Try again.');
    const token = await tokenResponse.json();
    const userResponse = await fetch(`${this.api}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userResponse.ok) throw new Error('Could not read your Discord profile. Try again.');
    const user = await userResponse.json();
    let joined = false;
    if (this.autoJoin && String(token.scope || '').includes('guilds.join')) joined = await this.join(user.id, token.access_token);
    return { user: { id: String(user.id), username: user.username, globalName: user.global_name || null, avatar: user.avatar || null }, joined };
  }

  // 201 = added, 204 = already a member. Anything else is logged and the login carries on.
  async join(userId, accessToken) {
    try {
      const response = await fetch(`${this.api}/guilds/${this.guildId}/members/${userId}`, { method: 'PUT', headers: { Authorization: `Bot ${this.botToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken }) });
      if (response.status === 201 || response.status === 204) return true;
      console.warn(`discord auto-join failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    } catch (error) { console.warn('discord auto-join failed', error.message); }
    return false;
  }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
// The page Discord sends the browser back to. It drops the session into the same localStorage key the
// game reads, then returns to the menu — the token never appears in a URL.
export function callbackPage({ session = null, error = null, joined = false }) {
  const script = session ? `try{localStorage.setItem('krosshair:authSession',${JSON.stringify(JSON.stringify(session))});sessionStorage.setItem('krosshair:discord',${JSON.stringify(joined ? 'joined' : 'in')});}catch(e){}location.replace('/');` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Krosshair</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0e12;color:#e6edf1;font:15px/1.6 system-ui,sans-serif;text-align:center}a{color:#ffb547}</style></head><body><main>${error ? `<p>${escapeHtml(error)}</p><p><a href="/">Back to Krosshair</a></p>` : '<p>Signed in. Returning to Krosshair…</p>'}</main>${script ? `<script>${script.replace(/</g, '\\u003c')}</script>` : ''}</body></html>`;
}
