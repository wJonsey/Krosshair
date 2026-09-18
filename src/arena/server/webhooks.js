// Discord webhooks: one channel hears about updates and restarts, one about the leaderboard.
// Both URLs are secrets (anyone holding one can post to the channel), so they live in .env:
//   DISCORD_WEBHOOK_UPDATES, DISCORD_WEBHOOK_LEADERBOARD
// Unset means off. A webhook that fails never takes the game down with it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const COLORS = { warn: 0xffb547, good: 0x6ce6d1, info: 0x8c99a4, gold: 0xffc857 };
const esc = (text) => String(text).replace(/([_*~`|>\\])/g, '\\$1');
const validUrl = (url) => /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url || '');

export class Webhooks {
  constructor({ env = process.env, root, stateFile, siteUrl = '' }) {
    this.updates = String(env.DISCORD_WEBHOOK_UPDATES || '').trim();
    this.leaderboard = String(env.DISCORD_WEBHOOK_LEADERBOARD || '').trim();
    this.allowAny = Boolean(env.DISCORD_WEBHOOK_TEST); // tests point these at a stand-in server
    this.root = root;
    this.stateFile = stateFile;
    this.siteUrl = siteUrl;
    this.state = { commit: null, boards: {} };
    try { this.state = { ...this.state, ...JSON.parse(readFileSync(stateFile, 'utf8')) }; } catch { /* first boot */ }
  }

  usable(url) { return Boolean(url) && (this.allowAny || validUrl(url)); }
  status() { return { updates: this.usable(this.updates), leaderboard: this.usable(this.leaderboard) }; }
  save() { try { mkdirSync(path.dirname(this.stateFile), { recursive: true }); writeFileSync(this.stateFile, JSON.stringify(this.state)); } catch (error) { console.warn('webhook state save failed', error.message); } }

  async post(url, embed, timeoutMs = 4000) {
    if (!this.usable(url)) return false;
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify({ username: 'Krosshair', allowed_mentions: { parse: [] }, embeds: [{ ...embed, timestamp: new Date().toISOString() }] }) });
      if (!response.ok) console.warn(`discord webhook refused: ${response.status}`);
      return response.ok;
    } catch (error) { console.warn('discord webhook failed', error.message); return false; }
  }

  // The commit this server is running, straight from the checkout. Null when it is not a git checkout.
  commit() {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%h%x1f%s%x1f%an'], { cwd: this.root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const [hash, subject, author] = out.split('\x1f');
      return hash ? { hash, subject: (subject || '').slice(0, 200), author: (author || '').slice(0, 60) } : null;
    } catch { return null; }
  }

  // Boot: say so only when the code actually changed, so a plain restart or a crash loop does not spam the channel.
  async announceBoot() {
    const commit = this.commit();
    if (!commit || commit.hash === this.state.commit) return false;
    const first = this.state.commit === null;
    this.state.commit = commit.hash;
    this.save();
    if (first && !this.usable(this.updates)) return false;
    return this.post(this.updates, {
      title: '✅ Update live', color: COLORS.good,
      description: `**${esc(commit.subject)}**\n\`${commit.hash}\` · ${commit.author}\n\nBack up.${this.siteUrl ? ` [Play now](${this.siteUrl})` : ''}`,
    });
  }

  // Shutdown for a deploy: everyone in a match is about to be dropped.
  announceRestart({ seconds, pilots, matches }) {
    return this.post(this.updates, {
      title: '⚠️ Update incoming', color: COLORS.warn,
      description: `Server restarts in **${seconds} seconds**. **Anyone in a match will be disconnected.**\n\nBack in about a minute.`,
      fields: [{ name: 'Online now', value: String(pilots), inline: true }, { name: 'Matches running', value: String(matches), inline: true }],
    }, 2500);
  }

  // Leaderboard: post when a podium changes. rows: { boardId: { label, top: [{ name, value, level }] } }
  async announceBoards(boards, format) {
    const changed = [];
    for (const [id, board] of Object.entries(boards)) {
      const podium = board.top.slice(0, 3).map((row) => row.name);
      const before = this.state.boards[id];
      if (podium.length && JSON.stringify(podium) !== JSON.stringify(before || [])) changed.push({ id, board, before: before || [], podium });
    }
    if (!changed.length) return false;
    // The very first look just records where things stand; there is nobody to congratulate yet.
    const firstLook = !Object.keys(this.state.boards).length;
    for (const entry of changed) this.state.boards[entry.id] = entry.podium;
    this.save();
    if (firstLook || !this.usable(this.leaderboard)) return false;
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const headline = changed.find((entry) => entry.podium[0] !== entry.before[0]);
    return this.post(this.leaderboard, {
      title: headline ? `🏆 ${esc(headline.podium[0])} takes #1 in ${headline.board.label}` : '🏆 Leaderboard shake-up', color: COLORS.gold,
      description: this.siteUrl ? `[See the full standings](${this.siteUrl}/#leaderboard)` : undefined,
      fields: changed.slice(0, 6).map(({ id, board, before }) => ({
        name: board.label, inline: true,
        value: board.top.slice(0, 5).map((row, place) => `${medals[place]} **${esc(row.name)}** · ${format(id, row)}${place < 3 && before[place] !== row.name ? ' ⬆' : ''}`).join('\n').slice(0, 1000),
      })),
    });
  }
}
