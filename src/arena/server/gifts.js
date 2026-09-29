// The developers' terminal, and the gifts it sends. The browser only sends the line that was typed:
// every word is resolved again here, every rule is checked here, and nothing is handed out anywhere else.
//
// A gift is given the moment it is sent, so coins land even if the present is never opened, and a
// restart loses nothing. What the pilot sees later is the unwrapping: each gift waits in an inbox on
// their profile until they open it, which is also how someone who was offline still gets the moment.
import { randomUUID } from 'node:crypto';
import { COSMETICS, levelFromXp } from '../shared/constants.js';
import { CRATES, RARITY, finishInfo } from '../shared/economy.js';
import { exclusiveSetOf, released } from '../shared/itemshop.js';
import { DEV_COMMANDS, GIFT_KINDS, GIFT_LIMITS, KIND_LABEL, findGift, giftAmount, giftChoices, giftKind, giftWord, slug, tokenize } from '../shared/gifts.js';
import { ProfileStore } from './profiles.js';
import { giftCrate } from './economy.js';

// Item Shop pieces are keyed as 'finish' in the catalogue; gifts call them skins.
const shopKind = (kind) => (kind === 'skin' ? 'finish' : kind);
// Anything from a set that has not landed yet does not exist, as far as this terminal is concerned.
// A developer's screen is still a browser, and the rule is that an unreleased name never reaches one.
const unreleased = (kind, id) => { const set = exclusiveSetOf(shopKind(kind), id); return Boolean(set) && !released(set); };
const isDevItem = (kind, id) => (kind === 'skin' ? finishInfo(id)?.rarity === 'dev' : kind in COSMETICS && Boolean(COSMETICS[kind].find((item) => item.id === id)?.dev));
const exclusive = (kind, id) => Boolean(exclusiveSetOf(shopKind(kind), id));

const say = (text, tone = 'info') => ({ text, tone });
const CONFIRM_SECONDS = 60;

// One thing a gift can hold, as the pilot will be shown it.
function describe(entry) {
  if (entry.kind === 'coins') return `${entry.amount.toLocaleString('en')} coins`;
  if (entry.kind === 'xp') return `${entry.amount.toLocaleString('en')} XP`;
  if (entry.kind === 'crate') return `${entry.count > 1 ? `${entry.count} x ` : ''}${CRATES[entry.id].name}`;
  return `${entry.name} (${KIND_LABEL[entry.kind].toLowerCase()})`;
}

// Hand one gift to one pilot. Returns the inbox entry, with every piece as it actually landed.
export function giveGift(profiles, token, items, from, message) {
  const profile = profiles.wallet(token);
  const landed = [];
  for (const entry of items) {
    if (entry.kind === 'coins') {
      profiles.credit(token, entry.amount, 'gift', `Gift from ${from}`);
      landed.push({ kind: 'coins', amount: entry.amount });
    } else if (entry.kind === 'xp') {
      const before = levelFromXp(profile.xp);
      profile.xp = Math.min(Number.MAX_SAFE_INTEGER, (profile.xp || 0) + entry.amount);
      landed.push({ kind: 'xp', amount: entry.amount, from: before, to: levelFromXp(profile.xp) });
    } else if (entry.kind === 'skin') {
      const info = finishInfo(entry.id);
      const had = profile.finishes.includes(entry.id);
      if (!had) profile.finishes.push(entry.id);
      landed.push({ kind: 'skin', id: entry.id, name: info.name, rarity: info.rarity, had });
    } else if (entry.kind === 'crate') {
      // Each crate is rolled for this pilot on their own: a gift to everyone is a crate each, not one drop.
      for (let n = 0; n < entry.count; n += 1) {
        const drop = giftCrate(profiles, token, entry.id);
        if (!drop) continue;
        landed.push({ kind: 'skin', id: drop.finish, name: finishInfo(drop.finish)?.name || drop.finish, rarity: drop.rarity, had: drop.duplicate, refund: drop.refund, crate: CRATES[entry.id].name });
      }
    } else {
      const key = `${entry.kind}:${entry.id}`;
      const had = profile.owned.includes(key);
      if (!had) profile.owned.push(key);
      landed.push({ kind: entry.kind, id: entry.id, name: entry.name, had });
    }
  }
  const gift = { id: randomUUID().slice(0, 12), from, message, at: Date.now(), items: landed };
  profile.gifts = [...(profile.gifts || []), gift].slice(-GIFT_LIMITS.inbox);
  profiles.scheduleSave();
  return gift;
}

// ctx: { profiles, accounts, online() -> [account names signed in now], deliver(token), log(text) }
export function createDevConsole(ctx) {
  const waiting = new Map();   // developer → { run, text, until }
  const accountNamed = (name) => ctx.accounts.accounts.get(String(name || '').toLowerCase()) || null;
  const profileOf = (account) => ctx.profiles.profiles.get(ProfileStore.key(account.profileToken)) || null;
  const nearNames = (word) => {
    const want = slug(word);
    return [...ctx.accounts.accounts.values()].map((account) => account.username).filter((name) => slug(name).startsWith(want.slice(0, 3))).slice(0, 5);
  };

  // Who a gift is for. 'all' is every account there is; 'online' is everyone signed in right now.
  function recipients(word) {
    const lower = String(word || '').toLowerCase();
    if (lower === 'all') return { everyone: true, list: [...ctx.accounts.accounts.values()] };
    if (lower === 'online') return { everyone: true, list: ctx.online().map(accountNamed).filter(Boolean) };
    const list = [];
    for (const name of lower.split(',').filter(Boolean)) {
      const account = accountNamed(name);
      if (!account) {
        const near = nearNames(name);
        return { error: `No account called ${name}.${near.length ? ` Did you mean ${near.join(', ')}?` : ''}` };
      }
      if (!list.includes(account)) list.push(account);
    }
    return list.length ? { list } : { error: 'Who is it for? A name, all, or online.' };
  }

  // The things after the name: `coins 500 + skin redline crate neon 3 "note"`. A "+" between them is
  // allowed and never needed. The first word that is not a kind starts the note, and so does anything quoted.
  function parseItems(tokens) {
    const items = [];
    let i = 0;
    while (i < tokens.length) {
      if (tokens[i].text === '+' && !tokens[i].quoted) { i += 1; continue; }
      const kind = tokens[i].quoted ? null : giftKind(tokens[i].text);
      if (!kind) break;
      const word = tokens[i + 1]?.text;
      if (kind === 'coins' || kind === 'xp') {
        const amount = giftAmount(word);
        if (!amount) return { error: `How much ${kind === 'xp' ? 'XP' : 'coins'}? Try ${kind} 500.` };
        if (amount > GIFT_LIMITS[kind]) return { error: `${GIFT_LIMITS[kind].toLocaleString('en')} ${kind === 'xp' ? 'XP' : 'coins'} is the most in one gift.` };
        const same = items.find((entry) => entry.kind === kind);
        if (same) same.amount = Math.min(GIFT_LIMITS[kind], same.amount + amount); else items.push({ kind, amount });
        i += 2;
        continue;
      }
      if (!word) return { error: `Which ${KIND_LABEL[kind].toLowerCase()}? /items ${kind} lists them.` };
      const found = findGift(kind, word, unreleased);
      if (found.options) return { error: `${word} could be ${found.options.map((option) => giftWord(option)).join(', ')}.` };
      if (!found.item) return { error: `No ${KIND_LABEL[kind].toLowerCase()} called ${word}. /items ${kind} lists them.` };
      i += 2;
      if (kind === 'crate') {
        let count = 1;
        const next = tokens[i];
        if (next && !next.quoted && /^\d+$/.test(next.text)) {
          count = Number(next.text);
          if (count < 1 || count > GIFT_LIMITS.crates) return { error: `1 to ${GIFT_LIMITS.crates} crates at a time.` };
          i += 1;
        }
        items.push({ kind, id: found.item.id, count });
      } else items.push({ kind, id: found.item.id, name: found.item.name });
      if (items.length > GIFT_LIMITS.items) return { error: `${GIFT_LIMITS.items} things in one gift at most.` };
    }
    if (!items.length) return { error: `Give what? ${GIFT_KINDS.join(', ')}.` };
    const note = tokens.slice(i).map((token) => token.text).join(' ').replace(/\s+/g, ' ').trim();
    if (note.length > GIFT_LIMITS.message) return { error: `Keep the note under ${GIFT_LIMITS.message} characters.` };
    return { items, note };
  }

  function give(dev, tokens, confirmed = false) {
    if (tokens.length < 3) return [say('/give <pilot|all|online> <what> [+ more] ["note"]', 'dim'), say('eg /give nin coins 5k + skin redline "Thanks for the launcher idea"', 'dim')];
    const who = recipients(tokens[1].text);
    if (who.error) return [say(who.error, 'bad')];
    const parsed = parseItems(tokens.slice(2));
    if (parsed.error) return [say(parsed.error, 'bad')];
    const { items, note } = parsed;
    // Dev things only ever go to dev accounts. Nobody else can hold them, and one given away would be
    // quietly stripped off their look anyway.
    const devOnly = items.filter((entry) => entry.kind !== 'crate' && entry.id && isDevItem(entry.kind, entry.id));
    if (devOnly.length) {
      const outsiders = who.list.filter((account) => !profileOf(account)?.dev);
      if (outsiders.length) return [say(`${devOnly.map(describe).join(', ')} is dev only, and ${who.everyone ? 'not everyone there is a dev' : `${outsiders[0].username} is not a dev`}.`, 'bad')];
    }
    if (!who.list.length) return [say('Nobody to give it to.', 'bad')];
    const summary = items.map(describe).join(' + ');
    const target = who.everyone ? `${who.list.length} ${who.list.length === 1 ? 'pilot' : 'pilots'}` : who.list.map((account) => account.username).join(', ');
    // A gift to everyone cannot be taken back, so it waits for a second word.
    if (who.everyone && !confirmed) {
      waiting.set(dev, { run: () => give(dev, tokens, true), until: Date.now() + CONFIRM_SECONDS * 1000 });
      return [
        say(`${summary} to ${target}${tokens[1].text.toLowerCase() === 'all' ? ', every account there is' : ', everyone on right now'}.`, 'warn'),
        ...(note ? [say(`Note: ${note}`, 'dim')] : []),
        say(`This can't be undone. /confirm within ${CONFIRM_SECONDS}s, or /cancel.`, 'warn'),
      ];
    }
    let online = 0;
    for (const account of who.list) {
      giveGift(ctx.profiles, account.profileToken, items, dev, note);
      if (ctx.deliver(account.profileToken)) online += 1;
    }
    ctx.log(`gift: ${dev} gave ${summary} to ${who.everyone ? target : who.list.map((account) => account.username).join(', ')}${note ? ` ("${note}")` : ''}`);
    const extras = items.filter((entry) => entry.kind !== 'coins' && entry.kind !== 'xp' && entry.kind !== 'crate' && exclusive(entry.kind, entry.id));
    return [
      say(`Sent ${summary} to ${target}.`, 'good'),
      say(who.list.length === 1 ? (online ? 'They are on. It is opening on their screen.' : 'They are offline. It will be waiting when they log in.') : `${online} on now will see it open. The rest get it when they log in.`, 'dim'),
      ...(extras.length ? [say(`${extras.map(describe).join(', ')} is an Item Shop exclusive.`, 'dim')] : []),
    ];
  }

  function who(tokens) {
    const account = accountNamed(tokens[1]?.text);
    if (!account) return [say(tokens[1] ? `No account called ${tokens[1].text}.` : '/who <pilot>', tokens[1] ? 'bad' : 'dim')];
    const profile = profileOf(account);
    if (!profile) return [say(`${account.username} has never played.`, 'dim')];
    const on = ctx.online().some((name) => name.toLowerCase() === account.username.toLowerCase());
    return [
      say(`${account.username}${profile.dev ? ' (dev)' : ''}: ${on ? 'online' : 'offline'}`, 'good'),
      say(`Level ${levelFromXp(profile.xp || 0)}, ${(profile.xp || 0).toLocaleString('en')} XP, ${(profile.coins || 0).toLocaleString('en')} coins`),
      say(`${(profile.finishes || []).length} skins, ${(profile.owned || []).length} gear, ${(profile.gifts || []).length} unopened gifts`),
    ];
  }

  function items(tokens) {
    const kind = giftKind(tokens[1]?.text);
    if (!kind) return [say(`/items <kind>. Kinds: ${GIFT_KINDS.join(', ')}.`, 'dim')];
    if (kind === 'coins' || kind === 'xp') return [say(`${kind} takes an amount: ${kind} 500, ${kind} 5k, ${kind} 1m.`, 'dim')];
    const search = slug(tokens.slice(2).map((token) => token.text).join(''));
    const list = giftChoices(kind, unreleased).filter((choice) => !search || slug(choice.name).includes(search) || slug(choice.id).includes(search));
    if (!list.length) return [say('Nothing matches.', 'dim')];
    const shown = list.slice(0, 40).map((choice) => {
      const tag = choice.rarity ? ` ${RARITY[choice.rarity]?.name || choice.rarity}` : choice.dev ? ' Dev' : '';
      return say(`${giftWord(choice).padEnd(16)} ${choice.name}${tag}${exclusive(kind, choice.id) ? ' (Item Shop)' : ''}`, choice.dev || choice.rarity === 'dev' ? 'dev' : 'info');
    });
    return [...shown, ...(list.length > 40 ? [say(`and ${list.length - 40} more. Add a search word.`, 'dim')] : [])];
  }

  // Returns the lines to print, each { text, tone }.
  function run(dev, line) {
    const tokens = tokenize(String(line || '').trim().replace(/^\//, ''));
    const command = (tokens[0]?.text || '').toLowerCase();
    // Anything else typed in the meantime drops a waiting gift, so a stray /confirm later cannot fire it.
    if (command !== 'confirm' && command !== 'cancel') waiting.delete(dev);
    switch (command) {
      case '': return [];
      case 'give': case 'gift': return give(dev, tokens);
      case 'confirm': {
        const held = waiting.get(dev);
        waiting.delete(dev);
        if (!held || held.until < Date.now()) return [say('Nothing waiting on you.', 'dim')];
        return held.run();
      }
      case 'cancel': return [say(waiting.delete(dev) ? 'Dropped.' : 'Nothing waiting on you.', 'dim')];
      case 'who': return who(tokens);
      case 'online': {
        const names = ctx.online();
        return [say(`${names.length} signed in`, 'good'), ...(names.length ? [say(names.join(', '))] : [])];
      }
      case 'items': return items(tokens);
      case 'help': return DEV_COMMANDS.map((entry) => say(`${entry.usage.padEnd(52)} ${entry.about}`, 'dim'));
      default: return [say(`No command ${command}. /help lists them.`, 'bad')];
    }
  }

  // Every account name, for completing a name as it is typed.
  const names = () => [...ctx.accounts.accounts.values()].map((account) => account.username);
  return { run, names };
}
