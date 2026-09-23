// The HUDs run every frame. Writing the same text or style again still makes the browser re-check the
// page, so anything written from a per-frame update goes through a helper that skips a write when
// nothing moved. These look for the plain writes that used to happen every frame regardless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('the royale HUD writes text and markup only when it changes', () => {
  const royale = readFileSync(new URL('../client/royale.js', import.meta.url), 'utf8');
  const update = between(royale, '    update(dt) {', '\n  };\n}');
  assert.ok(update.length > 1000, 'could not find the royale update');
  const plain = [...update.matchAll(/^.*(?:\.textContent|\.innerHTML) = .*$/gm)].map((m) => m[0].trim())
    .filter((line) => !/^const put(Html)? =/.test(line) && !/if \(look\)/.test(line));
  assert.deepEqual(plain, [], 'a per-frame write that happens even when nothing changed');
  assert.match(update, /if \(showMap && performance\.now\(\) - lastBigMap > 33\)/, 'the whole island map is redrawn every frame');
});

test('the main HUD skips per-frame writes that change nothing', () => {
  const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');
  for (const line of ['dom.fxSuppress.style.opacity =', 'dom.droneTime.textContent =', 'dom.breath.style.width =', 'dom.scopeZoom.textContent =', 'dom.povAmmo.textContent =']) {
    assert.ok(!hud.includes(line), `${line} is written every frame again`);
  }
});
