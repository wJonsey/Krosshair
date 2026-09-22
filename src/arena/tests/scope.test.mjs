// The scope picture is a second full render of the world, every frame, while you are aimed. It only
// ever shows inside the lens, so it needs the pixels the lens covers on screen and not a fixed square.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viewmodel = readFileSync(new URL('../client/viewmodel.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
const steps = JSON.parse(viewmodel.match(/const SCOPE_STEPS = (\[[^\]]*\]);/)[1]);

// The same arithmetic lensPixels does, so the sizes can be checked without a WebGL context.
const lensPixels = (fraction, height) => {
  const across = fraction * height * 1.35;
  return steps.find((step) => step >= across) ?? steps[steps.length - 1];
};

test('the picture is never drawn bigger than it used to be', () => {
  assert.equal(Math.max(...steps), 768, 'the ceiling is the fixed size this replaced, so it cannot cost more');
  for (const fraction of [0.01, 0.2, 0.5, 2]) for (const height of [720, 1080, 1440, 2160]) {
    assert.ok(lensPixels(fraction, height) <= 768, `${fraction} of ${height} asked for more than 768`);
  }
});

test('a small lens costs far less than a large one', () => {
  const hip = lensPixels(0.062, 1080);   // scope down at the hip: a coin's worth of screen
  const eye = lensPixels(0.31, 1080);    // up at the eye
  assert.ok(hip < eye, 'a lens covering less of the screen is drawn smaller');
  assert.ok(hip * hip <= eye * eye * 0.3, `the hip should cost a fraction of the eye, got ${hip} against ${eye}`);
});

test('the picture is never drawn smaller than the lens it fills', () => {
  for (const fraction of [0.05, 0.1, 0.2, 0.3, 0.45]) {
    const across = fraction * 1080;
    const drawn = lensPixels(fraction, 1080);
    if (across * 1.35 <= 768) assert.ok(drawn >= across, `a ${Math.round(across)}px lens drawn at ${drawn} would be soft`);
  }
});

test('the steps rise, so a growing lens reallocates rarely and never thrashes', () => {
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] > steps[i - 1], 'steps must be in order');
  assert.ok(steps.length <= 5, 'few enough steps that coming up to the eye is a handful of resizes at most');
});

test('the render actually uses the size, and only resizes when it changes', () => {
  assert.match(main, /viewmodel\.lensPixels\(renderer\.getDrawingBufferSize\(\w+\)\.y\)/, 'sized from the real drawing buffer, not the CSS size');
  assert.match(main, /if \(viewmodel\.scopeTarget\.width !== \w+\) viewmodel\.scopeTarget\.setSize\(/, 'a resize every frame would cost more than it saves');
  assert.ok(main.indexOf('setSize') < main.indexOf('renderer.render(arena.scene, scopeCamera)'), 'resized before it is drawn into');
});

test('SCOPE_STEPS is declared before the class that uses it', () => {
  assert.ok(viewmodel.indexOf('const SCOPE_STEPS') < viewmodel.indexOf('export class ViewModel'), 'or it throws on the first scoped frame');
});

// Aiming used to render the viewmodel into a full screen 4x multisampled float buffer, resolve it, blur
// every pixel on the screen with seventeen taps and then draw the gun again. That ran on every gun the
// moment you aimed, iron sights included, where there is no glass to justify any of it. It halved the
// frame rate and the judder read as the screen shaking.
test('aiming does not cost a full screen pass on every gun', () => {
  const draw = main.slice(main.indexOf('function drawViewmodel'), main.indexOf('const scopeCamera'));
  assert.ok(!/setRenderTarget\(/.test(draw), 'drawing the gun must not go via a render target');
  assert.ok(!/blur/i.test(draw), 'and must not blur');
  assert.equal((draw.match(/renderer\.render\(/g) || []).length, 1, 'the gun is drawn once, not three times');
});

test('nothing allocates a multisampled full screen buffer any more', () => {
  const targets = [...main.matchAll(/new THREE\.WebGLRenderTarget\(([^)]*)\)/g)].map((m) => m[1]);
  for (const args of targets) assert.ok(!/samples:/.test(args), `a multisampled target is back: ${args}`);
});

test('a gun with no glass pays nothing extra for aiming', () => {
  assert.match(viewmodel, /scopeWanted\(\) \{\s*\n\s*if \(!this\.current\?\.userData\.lens/, 'the scope pass is gated on the gun actually having a lens');
});
