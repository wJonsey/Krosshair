// The Item Shop catalogue. This file is server only and never reaches a browser: an unreleased set,
// its name, its blurb, its debut and everything in it stay here until the day it lands. The server hands
// the client only the sets that have already been out, so a snoop through the page source finds nothing
// about what is coming. (The painters and the geometry still live in the client, keyed by id, so a
// determined reader can find ids. The names, sets, prices and dates are what this keeps.)
import { COSMETICS } from '../shared/constants.js';
import { FINISHES } from '../shared/economy.js';
import { setCatalogue } from '../shared/itemshop.js';

export const ALL_SETS = [
  { id: 'deepcover', name: 'Deep Cover', blurb: 'Quiet work. No markings.', debut: '2026-09-21',
    items: [['finish', 'nightwork'], ['finish', 'blackbox'], ['headgear', 'balaclava'], ['charm', 'dogtag']] },
  // Launch week: one a day, so the shop has enough to deal four a day and still turn over.
  { id: 'redline', name: 'Redline', blurb: 'Built to go one way, fast.', debut: '2026-09-25',
    items: [['finish', 'polestart'], ['finish', 'gridstart'], ['headgear', 'racehelm'], ['tracer', '#ff5a3d']] },
  { id: 'quarry', name: 'Quarry', blurb: 'Cut out of a hillside and barely finished.', debut: '2026-09-26',
    items: [['finish', 'quarry'], ['finish', 'limestone'], ['finish', 'slatefall'], ['finish', 'dustveil']] },
  { id: 'tempest', name: 'Tempest', blurb: 'Weather that came in off the sea.', debut: '2026-09-27',
    items: [['finish', 'tempest'], ['finish', 'squall'], ['finish', 'thunderhead'], ['finish', 'downpour']] },
  { id: 'crucible', name: 'Crucible', blurb: 'Poured, cooled, never cleaned up.', debut: '2026-09-28',
    items: [['finish', 'crucible'], ['finish', 'slagline'], ['finish', 'whitehot'], ['finish', 'quench']] },
  { id: 'overgrowth', name: 'Overgrowth', blurb: 'Left alone long enough for the green to win.', debut: '2026-09-29',
    items: [['finish', 'overgrowth'], ['finish', 'creeper'], ['finish', 'mossback'], ['finish', 'thornline']] },
  { id: 'signal', name: 'Signal', blurb: 'Lights meant to be seen from a long way off.', debut: '2026-09-30',
    items: [['finish', 'flarepath'], ['finish', 'semaphore'], ['finish', 'starshell'], ['finish', 'lantern']] },
  { id: 'neonwake', name: 'Neon Wake', blurb: 'Rain, and everything reflected in it.', debut: '2026-10-01',
    items: [['finish', 'neonwake'], ['finish', 'wetstreet'], ['visor', '#2ad1ff'], ['tracer', '#2ad1ff']] },
  // Then one a week.
  { id: 'saltmarsh', name: 'Saltmarsh', blurb: 'Tide came in and took the paint with it.', debut: '2026-10-08',
    items: [['finish', 'saltmarsh'], ['finish', 'brackish'], ['pattern', 'reedbed']] },
  { id: 'ironworks', name: 'Ironworks', blurb: 'Cut, welded, never finished properly.', debut: '2026-10-15',
    items: [['finish', 'ironworks'], ['finish', 'millscale'], ['headgear', 'weldmask'], ['charm', 'boltring']] },
  { id: 'bloom', name: 'Bloom', blurb: 'Somebody painted flowers on a rifle.', debut: '2026-10-22',
    items: [['finish', 'bloom'], ['finish', 'nightgarden'], ['pattern', 'petals']] },
  { id: 'coldsnap', name: 'Cold Snap', blurb: 'Frozen through, then frozen again.', debut: '2026-10-29',
    items: [['finish', 'coldsnap'], ['finish', 'blackice'], ['face', 'frostmask'], ['tracer', '#bfe9ff']] },
  { id: 'hex', name: 'Hex', blurb: 'Old marks that still mean something.', debut: '2026-11-05',
    items: [['finish', 'hex'], ['finish', 'sigil'], ['pack', 'grimoire'], ['charm', 'talisman']] },
  { id: 'roadwork', name: 'Roadwork', blurb: 'Hard to miss. That is the idea.', debut: '2026-11-12',
    items: [['finish', 'roadwork'], ['finish', 'chevron'], ['headgear', 'hivis']] },
  { id: 'apparition', name: 'Apparition', blurb: 'Half there on a good day.', debut: '2026-11-19',
    items: [['finish', 'apparition'], ['finish', 'seance'], ['face', 'shroud'], ['tracer', '#d8ccff']] },
  { id: 'sunfall', name: 'Sunfall', blurb: 'The last twenty minutes of the day.', debut: '2026-11-26',
    items: [['finish', 'sunfall'], ['finish', 'emberline'], ['pattern', 'duskfade']] },
  { id: 'vault', name: 'Vault', blurb: 'Spend it on something loud.', debut: '2026-12-03',
    items: [['finish', 'vault'], ['finish', 'bullion'], ['charm', 'keyring'], ['title', 'Loaded']] },
  { id: 'static', name: 'Static', blurb: 'Signal lost. Kept firing.', debut: '2026-12-10',
    items: [['finish', 'static'], ['finish', 'lostsignal'], ['visor', '#8affc9'], ['pack', 'jammer']] },
  { id: 'lowtide', name: 'Low Tide', blurb: 'Dragged up off the sea floor.', debut: '2026-12-17',
    items: [['finish', 'lowtide'], ['finish', 'barnacle'], ['face', 'rebreather']] },
];

// The pieces themselves. They are pushed into the shared registries on the server at boot, and sent to a
// client only once their set has debuted.
export const EXCLUSIVE_FINISHES = [
  { id: 'nightwork', name: 'Night Work', rarity: 'epic', shop: 'item' },
  { id: 'blackbox', name: 'Black Box', rarity: 'epic', shop: 'item' },
  { id: 'neonwake', name: 'Neon Wake', rarity: 'legendary', shop: 'item' },
  { id: 'wetstreet', name: 'Wet Street', rarity: 'epic', shop: 'item' },
  { id: 'saltmarsh', name: 'Saltmarsh', rarity: 'epic', shop: 'item' },
  { id: 'brackish', name: 'Brackish', rarity: 'rare', shop: 'item' },
  { id: 'ironworks', name: 'Ironworks', rarity: 'epic', shop: 'item' },
  { id: 'millscale', name: 'Mill Scale', rarity: 'rare', shop: 'item' },
  { id: 'bloom', name: 'Bloom', rarity: 'legendary', shop: 'item' },
  { id: 'nightgarden', name: 'Night Garden', rarity: 'legendary', shop: 'item' },
  { id: 'coldsnap', name: 'Cold Snap', rarity: 'epic', shop: 'item' },
  { id: 'blackice', name: 'Black Ice', rarity: 'legendary', shop: 'item' },
  { id: 'hex', name: 'Hex', rarity: 'epic', shop: 'item' },
  { id: 'sigil', name: 'Sigil', rarity: 'legendary', shop: 'item' },
  { id: 'roadwork', name: 'Roadwork', rarity: 'rare', shop: 'item' },
  { id: 'chevron', name: 'Chevron', rarity: 'rare', shop: 'item' },
  { id: 'apparition', name: 'Apparition', rarity: 'legendary', shop: 'item' },
  { id: 'seance', name: 'Seance', rarity: 'epic', shop: 'item' },
  { id: 'sunfall', name: 'Sunfall', rarity: 'epic', shop: 'item' },
  { id: 'emberline', name: 'Ember Line', rarity: 'legendary', shop: 'item' },
  { id: 'vault', name: 'Vault', rarity: 'legendary', shop: 'item' },
  { id: 'bullion', name: 'Bullion', rarity: 'epic', shop: 'item' },
  { id: 'static', name: 'Static', rarity: 'rare', shop: 'item' },
  { id: 'lostsignal', name: 'Lost Signal', rarity: 'legendary', shop: 'item' },
  { id: 'lowtide', name: 'Low Tide', rarity: 'epic', shop: 'item' },
  { id: 'barnacle', name: 'Barnacle', rarity: 'rare', shop: 'item' },
  { id: 'polestart', name: 'Pole Position', rarity: 'epic', shop: 'item' },
  { id: 'gridstart', name: 'Grid Start', rarity: 'legendary', shop: 'item' },
  { id: 'quarry', name: 'Quarry', rarity: 'epic', shop: 'item' },
  { id: 'limestone', name: 'Limestone', rarity: 'rare', shop: 'item' },
  { id: 'slatefall', name: 'Slatefall', rarity: 'epic', shop: 'item' },
  { id: 'dustveil', name: 'Dust Veil', rarity: 'rare', shop: 'item' },
  { id: 'tempest', name: 'Tempest', rarity: 'legendary', shop: 'item' },
  { id: 'squall', name: 'Squall', rarity: 'epic', shop: 'item' },
  { id: 'thunderhead', name: 'Thunderhead', rarity: 'legendary', shop: 'item' },
  { id: 'downpour', name: 'Downpour', rarity: 'rare', shop: 'item' },
  { id: 'crucible', name: 'Crucible', rarity: 'legendary', shop: 'item' },
  { id: 'slagline', name: 'Slag Line', rarity: 'rare', shop: 'item' },
  { id: 'whitehot', name: 'White Hot', rarity: 'legendary', shop: 'item' },
  { id: 'quench', name: 'Quench', rarity: 'epic', shop: 'item' },
  { id: 'overgrowth', name: 'Overgrowth', rarity: 'epic', shop: 'item' },
  { id: 'creeper', name: 'Creeper', rarity: 'rare', shop: 'item' },
  { id: 'mossback', name: 'Mossback', rarity: 'epic', shop: 'item' },
  { id: 'thornline', name: 'Thornline', rarity: 'rare', shop: 'item' },
  { id: 'flarepath', name: 'Flare Path', rarity: 'legendary', shop: 'item' },
  { id: 'semaphore', name: 'Semaphore', rarity: 'rare', shop: 'item' },
  { id: 'starshell', name: 'Starshell', rarity: 'legendary', shop: 'item' },
  { id: 'lantern', name: 'Lantern', rarity: 'epic', shop: 'item' },
];
export const EXCLUSIVE_COSMETICS = {
  visor: [
    { id: '#2ad1ff', name: 'Wake Blue', shop: 'item' },
    { id: '#8affc9', name: 'Signal Green', shop: 'item' },
  ],
  tracer: [
    { id: '#2ad1ff', name: 'Wake Blue', shop: 'item' },
    { id: '#bfe9ff', name: 'Frostline', shop: 'item' },
    { id: '#d8ccff', name: 'Seance', shop: 'item' },
    { id: '#ff5a3d', name: 'Redline', shop: 'item' },
  ],
  title: [
    { id: 'Loaded', name: 'Loaded', shop: 'item' },
  ],
  headgear: [
    { id: 'balaclava', name: 'Balaclava', shop: 'item' },
    { id: 'weldmask', name: 'Welding mask', shop: 'item' },
    { id: 'hivis', name: 'Hi-vis hard hat', shop: 'item' },
    { id: 'racehelm', name: 'Race helmet', shop: 'item' },
  ],
  face: [
    { id: 'frostmask', name: 'Frost mask', shop: 'item' },
    { id: 'shroud', name: 'Shroud', shop: 'item' },
    { id: 'rebreather', name: 'Rebreather', shop: 'item' },
  ],
  pack: [
    { id: 'grimoire', name: 'Grimoire', shop: 'item' },
    { id: 'jammer', name: 'Jammer', shop: 'item' },
  ],
  pattern: [
    { id: 'reedbed', name: 'Reedbed', shop: 'item' },
    { id: 'petals', name: 'Petals', shop: 'item' },
    { id: 'duskfade', name: 'Duskfade', shop: 'item' },
  ],
  charm: [
    { id: 'dogtag', name: 'Stamped tags', shop: 'item' },
    { id: 'boltring', name: 'Bolt ring', shop: 'item' },
    { id: 'talisman', name: 'Talisman', shop: 'item' },
    { id: 'keyring', name: 'Key ring', shop: 'item' },
  ],
};

// Put them where the shared code already looks, so every existing check works unchanged.
export function installCatalogue() {
  for (const finish of EXCLUSIVE_FINISHES) if (!FINISHES.some((entry) => entry.id === finish.id)) FINISHES.push(finish);
  for (const [kind, items] of Object.entries(EXCLUSIVE_COSMETICS)) {
    for (const item of items) if (!COSMETICS[kind].some((entry) => entry.id === item.id)) COSMETICS[kind].push(item);
  }
  setCatalogue(ALL_SETS);
}

// What a client is allowed to know today: the sets that have been out, and the pieces in them.
export function publicCatalogue(key) {
  const sets = ALL_SETS.filter((set) => key >= set.debut);
  const wanted = new Set(sets.flatMap((set) => set.items.map(([kind, id]) => `${kind}:${id}`)));
  return {
    sets,
    finishes: EXCLUSIVE_FINISHES.filter((finish) => wanted.has(`finish:${finish.id}`)),
    cosmetics: Object.fromEntries(Object.entries(EXCLUSIVE_COSMETICS)
      .map(([kind, items]) => [kind, items.filter((item) => wanted.has(`${kind}:${item.id}`))])
      .filter(([, items]) => items.length)),
  };
}
