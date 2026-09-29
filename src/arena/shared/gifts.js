// Developer gifts: what can be given, and how a word typed into the terminal finds the thing it means.
// Shared so the terminal can complete what you type. The server decides everything: it resolves every
// word again, checks every rule, and only it ever hands anything out.
import { COSMETICS } from './constants.js';
import { CRATES, FINISHES } from './economy.js';

export const GIFT_LIMITS = {
  coins: 1000000,     // per pilot, per gift
  xp: 1000000,
  crates: 10,         // crates of one kind in one gift
  items: 8,           // things in one gift
  message: 200,       // characters in the note
  inbox: 25,          // unopened gifts kept per pilot; the oldest goes first
};
export const COSMETIC_KINDS = Object.keys(COSMETICS);
export const GIFT_KINDS = ['coins', 'xp', 'skin', 'crate', ...COSMETIC_KINDS];
// What people actually type.
const ALIASES = { coin: 'coins', credits: 'coins', money: 'coins', exp: 'xp', level: 'xp', skins: 'skin', finish: 'skin', camo: 'skin', crates: 'crate', box: 'crate', colour: 'suit', color: 'suit', hat: 'headgear', helmet: 'headgear', mask: 'face', backpack: 'pack', trail: 'tracer' };
export const giftKind = (word) => {
  const lower = String(word || '').toLowerCase();
  const kind = ALIASES[lower] || lower;
  return GIFT_KINDS.includes(kind) ? kind : null;
};
export const KIND_LABEL = { coins: 'Coins', xp: 'XP', skin: 'Skin', crate: 'Crate', suit: 'Suit', visor: 'Visor', tracer: 'Tracer', title: 'Title', headgear: 'Headgear', face: 'Face', pack: 'Pack', pattern: 'Pattern', charm: 'Charm' };

// Lower case, letters and digits only, so "Void Black", "void-black" and "voidblack" are one word.
export const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9#]/g, '');

// Everything a kind offers, as { id, name }. `hide(kind, id)` drops anything the caller must not name:
// the server passes the Item Shop pieces that have not landed yet, so a secret stays one even here.
export function giftChoices(kind, hide = null) {
  const all = kind === 'skin' ? FINISHES.map((finish) => ({ id: finish.id, name: finish.name, rarity: finish.rarity }))
    : kind === 'crate' ? Object.values(CRATES).map((crate) => ({ id: crate.id, name: crate.name }))
      : COSMETICS[kind] ? COSMETICS[kind].map((item) => ({ id: item.id, name: item.name, dev: Boolean(item.dev) })) : [];
  return hide ? all.filter((choice) => !hide(kind, choice.id)) : all;
}
// The word the terminal completes to: the id when it is a plain word, the name's slug when it is not.
// A suit is '#ec6a9e' underneath, and nobody wants to type that.
export const giftWord = (choice) => (/^[a-z0-9]+$/i.test(choice.id) ? choice.id.toLowerCase() : slug(choice.name));

// One typed word to one thing: the exact id, then the exact name, then the only one it starts.
// Returns { item } or { options } when it could be several, or {} when it is nothing.
export function findGift(kind, word, hide = null) {
  const want = slug(word);
  if (!want) return {};
  const choices = giftChoices(kind, hide);
  const exact = choices.find((choice) => slug(choice.id) === want) || choices.find((choice) => slug(choice.name) === want);
  if (exact) return { item: exact };
  const starts = choices.filter((choice) => slug(choice.id).startsWith(want) || slug(choice.name).startsWith(want));
  if (starts.length === 1) return { item: starts[0] };
  return starts.length ? { options: starts.slice(0, 8) } : {};
}

// '5k' and '1.5m' and '10,000' all mean what they say.
export function giftAmount(word) {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(String(word || '').replace(/,/g, ''));
  if (!match) return null;
  const value = Math.floor(Number(match[1]) * ({ k: 1e3, m: 1e6 }[match[2].toLowerCase()] || 1));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Words, with "quoted phrases" kept together and marked, so a quoted note is always read as the note.
export function tokenize(line) {
  const tokens = [];
  const pattern = /"([^"]*)"?|'([^']*)'?|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(line || '')))) {
    const quoted = match[1] !== undefined || match[2] !== undefined;
    tokens.push({ text: quoted ? (match[1] ?? match[2]) : match[3], quoted });
  }
  return tokens;
}

// The terminal's commands, for /help and for completing the first word.
export const DEV_COMMANDS = [
  { name: 'give', usage: '/give <pilot|all|online> <what> [+ more] ["note"]', about: 'Send a gift. It arrives as a present they open.' },
  { name: 'who', usage: '/who <pilot>', about: 'Coins, level, skins and whether they are on.' },
  { name: 'online', usage: '/online', about: 'Every signed in pilot on the server.' },
  { name: 'items', usage: '/items <kind> [search]', about: 'What a kind has to give, and the word for each.' },
  { name: 'confirm', usage: '/confirm', about: 'Send a gift to everyone that is waiting on you.' },
  { name: 'cancel', usage: '/cancel', about: 'Drop a gift that is waiting on /confirm.' },
  { name: 'clear', usage: '/clear', about: 'Wipe the terminal.' },
  { name: 'help', usage: '/help', about: 'This.' },
];
