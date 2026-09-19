// The developers' accounts. They get the Dev class: items nobody else can buy, win or trade.
// Matched on Discord only (the id, or the Discord username, which Discord keeps unique), never on the
// Krosshair name, since anyone can pick a display name.
const DEV_DISCORD_IDS = new Set(['794250832064938015']);          // gking09
const DEV_DISCORD_NAMES = new Set(['gking09', 'wjonsey']);

export function isDev(account) {
  if (!account?.discordId) return false;
  return DEV_DISCORD_IDS.has(String(account.discordId)) || DEV_DISCORD_NAMES.has(String(account.discordName || '').toLowerCase());
}
