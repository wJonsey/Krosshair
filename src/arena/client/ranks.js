// Rank emblems for the ranked ladder: a hex plate in the tier's colour, one to three chevrons for the
// division (I is the highest), a reticle for Apex, and a dashed plate while placements are running.
import { rankInfo } from '../shared/constants.js';

const HEX = '20,2 36,11 36,29 20,38 4,29 4,11';

export function rankBadge(info, size = 32) {
  const c = info.color;
  const svg = (body) => `<svg class="rank-badge" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  if (!info.placed) return svg(`<polygon points="${HEX}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="3 3"/><text x="20" y="25" text-anchor="middle" font-size="13" font-weight="700" fill="${c}">?</text>`);
  const plate = `<polygon points="${HEX}" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="2"/>`;
  if (!info.division) return svg(`${plate}<circle cx="20" cy="20" r="8" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M20 7v8M20 25v8M7 20h8M25 20h8" stroke="${c}" stroke-width="2.2"/><circle cx="20" cy="20" r="2" fill="${c}"/>`);
  const count = { III: 1, II: 2, I: 3 }[info.division];
  const top = 20 - (count - 1) * 3.5;
  const chevrons = Array.from({ length: count }, (_, i) => `<path d="M12 ${top + i * 7 + 3}l8-6 8 6" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return svg(plate + chevrons);
}

// Badge + name in one line, for lobbies and lists.
export function rankChip(rating, rankedMatches, size = 16) {
  const info = rankInfo(rating, rankedMatches);
  return `<span class="rank-chip" style="--rank:${info.color}">${rankBadge(info, size)}${info.placed ? info.name : 'Placements'}</span>`;
}
