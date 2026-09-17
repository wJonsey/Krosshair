// Accounts: username + password, or Discord. No email, no verification.
// Passwords are never stored: each account keeps a random salt and an scrypt hash.
// Login hands the browser a random session token; the file only keeps its SHA-256,
// so a copy of data/accounts.json can't be used to sign in. data/ is git-ignored.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

const KDF = { name: 'scrypt', N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_LIMIT = 10;
const USERNAME = /^[A-Za-z0-9_-]{3,16}$/;

function derive(password, salt, kdf = KDF) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, kdf.keylen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
const hashSession = (token) => createHash('sha256').update(token).digest('hex');

export class AccountStore {
  constructor(file) {
    this.file = file;
    this.accounts = new Map(); // lower-case username → account
    this.sessions = new Map(); // session hash → lower-case username
    this.discord = new Map();  // Discord user id → lower-case username
    this.saveTimer = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      for (const account of Object.values(data.accounts || {})) {
        const key = account.username.toLowerCase();
        this.accounts.set(key, account);
        if (account.discordId) this.discord.set(account.discordId, key);
        for (const session of account.sessions || []) this.sessions.set(session.hash, key);
      }
    } catch { /* first boot */ }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify({ version: 1, accounts: Object.fromEntries(this.accounts) }), { mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      } catch (error) { console.warn('account save failed', error.message); }
    }, 500);
  }

  static usernameError(username) {
    if (typeof username !== 'string' || !USERNAME.test(username)) return 'Usernames are 3–16 letters, numbers, - or _.';
    return null;
  }
  static passwordError(password) {
    if (typeof password !== 'string' || password.length < 8) return 'Passwords need at least 8 characters.';
    if (password.length > 128) return 'Passwords can be at most 128 characters.';
    return null;
  }

  taken(username) { return this.accounts.has(String(username).toLowerCase()); }
  ownsProfile(profileToken) { return [...this.accounts.values()].some((account) => account.profileToken === profileToken); }

  // profileToken: the progress this account starts with (a guest profile being claimed), or null for a fresh one.
  async signup(username, password, profileToken = null) {
    const problem = AccountStore.usernameError(username) || AccountStore.passwordError(password);
    if (problem) return { error: problem };
    if (this.taken(username)) return { error: 'That username is taken.' };
    const salt = randomBytes(16);
    const hash = await derive(password, salt);
    // Re-check: another signup for the same name may have finished while we were hashing.
    if (this.taken(username)) return { error: 'That username is taken.' };
    const account = { username, created: Date.now(), kdf: KDF, salt: salt.toString('base64'), hash: hash.toString('base64'), profileToken: profileToken || randomUUID(), sessions: [] };
    this.accounts.set(username.toLowerCase(), account);
    return { account, session: this.openSession(account) };
  }

  async login(username, password) {
    const account = typeof username === 'string' ? this.accounts.get(username.toLowerCase()) : null;
    if (typeof password !== 'string' || password.length > 128) return null;
    if (account && !account.hash) return null; // Discord-only account: there is no password to check
    // Unknown usernames still pay for a hash so response time doesn't reveal which names exist.
    const salt = account ? Buffer.from(account.salt, 'base64') : randomBytes(16);
    const derived = await derive(password, salt, account?.kdf);
    if (!account) return null;
    const expected = Buffer.from(account.hash, 'base64');
    if (expected.length !== derived.length || !timingSafeEqual(expected, derived)) return null;
    return { account, session: this.openSession(account) };
  }

  // A callsign from a Discord name: same alphabet as typed usernames, never one that is taken.
  freeUsername(wanted) {
    let base = String(wanted || '').normalize('NFKD').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
    if (base.length < 3) base = 'Pilot';
    if (!this.taken(base)) return base;
    for (let n = 2; n < 10000; n += 1) { const name = `${base.slice(0, 16 - String(n).length)}${n}`; if (!this.taken(name)) return name; }
    return `Pilot${randomBytes(4).toString('hex')}`;
  }

  // Sign-up and login are the same step with Discord: the first visit creates the account.
  discordSignIn(user) {
    if (!user || !/^\d{5,25}$/.test(user.id)) return null;
    let account = this.accounts.get(this.discord.get(user.id));
    const created = !account;
    if (!account) {
      // claimOpen: the browser's guest progress may be attached once, on its first connection (see claim()).
      account = { username: this.freeUsername(user.globalName || user.username), discordId: user.id, created: Date.now(), profileToken: randomUUID(), claimOpen: true, sessions: [] };
      this.accounts.set(account.username.toLowerCase(), account);
      this.discord.set(user.id, account.username.toLowerCase());
    }
    account.discordName = String(user.username || '').slice(0, 40);
    account.avatar = /^[a-z0-9_]{1,64}$/i.test(user.avatar || '') ? user.avatar : null;
    return { account, created, session: this.openSession(account) };
  }
  // A brand-new Discord account adopts the guest profile this browser was already playing on.
  claim(account, profileToken) {
    if (!account.claimOpen) return false;
    account.claimOpen = false;
    this.scheduleSave();
    if (!profileToken || this.ownsProfile(profileToken)) return false;
    account.profileToken = profileToken;
    return true;
  }

  openSession(account) {
    const token = randomBytes(32).toString('base64url');
    const hash = hashSession(token);
    account.sessions = [{ hash, created: Date.now(), seen: Date.now() }, ...(account.sessions || [])];
    for (const old of account.sessions.splice(SESSION_LIMIT)) this.sessions.delete(old.hash);
    this.sessions.set(hash, account.username.toLowerCase());
    this.scheduleSave();
    return token;
  }

  resume(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const hash = hashSession(token);
    const account = this.accounts.get(this.sessions.get(hash));
    if (!account) return null;
    const session = account.sessions.find((entry) => entry.hash === hash);
    if (session && Date.now() - session.seen > 3600e3) { session.seen = Date.now(); this.scheduleSave(); }
    return account;
  }

  logout(token) {
    if (typeof token !== 'string') return;
    const hash = hashSession(token);
    const account = this.accounts.get(this.sessions.get(hash));
    this.sessions.delete(hash);
    if (!account) return;
    account.sessions = account.sessions.filter((entry) => entry.hash !== hash);
    this.scheduleSave();
  }
}
