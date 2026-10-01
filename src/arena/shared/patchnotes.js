// What changed, for the people playing. Newest first.
//
// Every commit that changes anything a player loads or plays adds an entry at the top, in the same
// commit: `tests/patchnotes.test.mjs` fails otherwise. A pilot is shown everything newer than the last
// entry they read, once, the first time they sign in after it lands; the whole list is on the Patch
// notes card in the menu footer.
//
// id: goes up by one each time and is never reused (it is what "have they read this" is checked against).
// date: the day it shipped. title: a few words. tag: Update, Fix or Event. notes: one short line each,
// written the way the rest of the game talks. Lead with what the player can now do or see.
export const PATCH_NOTES = [
  {
    id: 3, date: '2026-10-01', tag: 'Update', title: 'What is switched off',
    notes: [
      'Anything pulled from the game, and why, now shows in the tab on the right of every screen.',
    ],
  },
  {
    id: 2, date: '2026-10-01', tag: 'Update', title: 'New paint, new pilot',
    notes: [
      'Every menu repainted. The Shop is three clear tabs: Item Shop, Crates, Skins.',
      'Games rebuilt: one table at a time, with Mines and Wheel added.',
      'A new pilot model with proper legs: it crouches, runs and plants its feet like a person.',
      'Hit zones now match the pilot you see, crouched head included.',
      'Bots walk their aim onto you instead of being laser or useless, and have to look for who shot them.',
      'Every knife has its own draw and its own swings.',
      'Kills confirm at the bottom of your screen, with doubles and triples.',
      'Battle royale: the aircraft camera turns the right way, and nobody is left riding it after the drop.',
      'Planned downtime shows on every screen ahead of time, and an update takes over the screen while it lands.',
      'These notes: shown once after each update, and kept in the menu footer.',
    ],
  },
  {
    id: 1, date: '2026-10-01', tag: 'Update', title: 'Sharper everything',
    notes: [
      'Blade crate: thirteen knives, each with its own model.',
      'Every map resurfaced: brick, timber, plaster, stone and water you can tell apart.',
      'Bloom, a real sky with clouds, reflections on steel and glass, grass and dust.',
      'Iron sights sit on the gun instead of floating over it.',
      'Scopes and guns rebuilt in finer detail.',
    ],
  },
];

export const latestNoteId = () => PATCH_NOTES.reduce((top, note) => Math.max(top, note.id), 0);
// Everything a pilot has not read yet, newest first. `seen` is the id of the last entry they closed.
export const notesSince = (seen) => PATCH_NOTES.filter((note) => note.id > (Number(seen) || 0));
