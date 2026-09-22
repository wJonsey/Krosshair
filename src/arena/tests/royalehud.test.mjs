// The loot card: what you are looking at on the island. It is drawn from a change test, which is right
// for rebuilding its contents and wrong for deciding whether it shows, because taking an item clears
// what you are looking at without the card knowing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
const guard = royale.slice(royale.indexOf('if (look !== state.look)'), royale.indexOf("for (const loot of state.loot.values()) if (loot.mesh)"));

test('whether the card shows is decided every frame, not only when it changes', () => {
  const [inside, outside] = [guard.slice(0, guard.indexOf('}') + 1), guard.slice(guard.indexOf('}') + 1)];
  assert.ok(!/classList\.toggle\('on'/.test(inside), 'the card must not be shown or hidden from inside the change test');
  assert.match(outside, /swap\.classList\.toggle\('on', Boolean\(look\)\)/, 'it follows what you are looking at, unconditionally');
});

test('rebuilding the card is still guarded, or it redraws every frame', () => {
  assert.match(guard, /if \(look !== state\.look\) \{[\s\S]*swap\.innerHTML/, 'innerHTML belongs behind the change test');
});

// The bug, as a state machine. Taking an item sets state.look to null; if the server removes the loot
// before the next frame, look is null too, and a card that only reacts to changes never hears about it.
const run = (decideEveryFrame) => {
  const swap = { on: false };
  const state = { look: null };
  const frame = (look, take) => {
    if (look !== state.look) {
      state.look = look;
      if (!decideEveryFrame) swap.on = Boolean(look);
    }
    if (decideEveryFrame) swap.on = Boolean(look);
    if (take && look) state.look = null; // royale-take sent
  };
  const item = { id: 'ak' };
  frame(item, false);   // looking at it
  frame(item, true);    // press interact
  frame(null, false);   // server removed it the very next frame
  frame(null, false);   // and it stays gone
  return swap.on;
};

test('the old structure leaves the card up after a pickup, the new one does not', () => {
  assert.equal(run(false), true, 'this is the reported bug: the card outlived the item');
  assert.equal(run(true), false, 'deciding every frame clears it');
});

test('walking away from an item you never took still clears the card', () => {
  const swap = { on: false }; const state = { look: null };
  const frame = (look) => { if (look !== state.look) state.look = look; swap.on = Boolean(look); };
  const item = { id: 'ak' };
  frame(item); assert.equal(swap.on, true);
  frame(null); assert.equal(swap.on, false, 'out of reach, so no card');
});

test('dying with the card up does not leave it on the screen', () => {
  // look is only worked out while alive, so death makes it null and the card must follow.
  assert.match(royale, /if \(player\.alive && !player\.drop\) \{/, 'look is only computed while alive and on foot');
  assert.match(guard.slice(guard.indexOf('}') + 1), /classList\.toggle\('on', Boolean\(look\)\)/, 'so an unconditional toggle clears it on death too');
});
