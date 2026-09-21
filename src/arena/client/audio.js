// Every sound effect in the game is synthesised here with WebAudio: no sample files.
//
// How a sound is built
//  · Layers. A gunshot is not one noise: it is a mechanical click, a supersonic crack, the muzzle blast
//    (distorted, so it has grit), a sub thump you feel, two or three body resonances that give each weapon
//    its voice, then the tail (the sound coming back off the arena), and finally the action cycling and a
//    casing landing. Footsteps are heel then toe. Metal rings with inharmonic partials, like real plate.
//  · Space. Positional sounds get HRTF panning, a distance low-pass and speed-of-sound delay, so a far rifle
//    arrives late and as a dull thud, so you can range a shooter by ear. Two generated reverbs (open yard,
//    hard room) are cross-faded by how sheltered the listener is.
//  · Variation. Nothing plays the same twice: pitch, level and timing all move a few percent per trigger.
//
// Music is the one thing that can come from files: see the "music" section and src/arena/music/README.md.
import { game } from './state.js';

let ctx = null;
let master = null, musicOut = null;
let sfx = null;          // the match: shots, steps, impacts, weather, reverb returns
let uiBus = null;        // menu clicks and chimes, which must keep working when the match is silenced
let verbSend = null;
let outdoorWet = null, indoorWet = null;
let noiseBuffer = null;
let shaperCurve = null;
let ambience = null;
let ambienceLevel = 0.6;
let shelter = 0;
const listener = { x: 0, y: 0, z: 0 };
const loops = new Map();
const rnd = (min, max) => min + Math.random() * (max - min);
const vary = (amount = 0.05) => 1 + rnd(-amount, amount);

// Impulse responses are generated: decaying noise that gets darker as it dies away (air and walls eat
// the highs first), with a few discrete early reflections on top.
function makeImpulse(seconds, power, taps, darken) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const k = i / length;
      const white = Math.random() * 2 - 1;
      const cutoff = 1 - Math.min(0.97, k * darken);       // one-pole low-pass that closes over time
      low += (white - low) * cutoff;
      data[i] = low * (1 - k) ** power;
    }
    for (const [time, gain] of taps) {
      const at = Math.floor((time + (channel ? 0.0017 : 0)) * ctx.sampleRate);
      for (let i = 0; i < 90 && at + i < length; i += 1) data[at + i] += (Math.random() * 2 - 1) * gain * (1 - i / 90);
    }
  }
  return impulse;
}

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = game.settings.volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 10; limiter.attack.value = 0.002; limiter.release.value = 0.18;
  master.connect(limiter).connect(ctx.destination);
  // Music has its own way out. On the master bus a burst of gunfire pins the limiter and drags the music
  // down with it, which sounded like the track cutting out whenever a fight started.
  musicOut = ctx.createGain();
  musicOut.gain.value = game.settings.volume;
  musicOut.connect(ctx.destination);
  sfx = ctx.createGain();
  sfx.connect(master);
  uiBus = ctx.createGain();
  uiBus.connect(master);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  // Soft-clip curve: pushes a blast into saturation the way a microphone and the ear do.
  shaperCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i += 1) { const x = (i / 511.5) - 1; shaperCurve[i] = Math.tanh(x * 2.6) * 0.9; }
  verbSend = ctx.createGain();
  const outdoor = ctx.createConvolver(); outdoor.buffer = makeImpulse(2.4, 3.0, [[0.061, 0.5], [0.113, 0.38], [0.187, 0.3], [0.262, 0.2], [0.41, 0.12]], 1.5);
  const indoor = ctx.createConvolver(); indoor.buffer = makeImpulse(1.1, 2.2, [[0.012, 0.7], [0.021, 0.6], [0.034, 0.5], [0.049, 0.4], [0.071, 0.3]], 0.9);
  outdoorWet = ctx.createGain(); outdoorWet.gain.value = 0.5;
  indoorWet = ctx.createGain(); indoorWet.gain.value = 0;
  verbSend.connect(outdoor).connect(outdoorWet).connect(sfx);
  verbSend.connect(indoor).connect(indoorWet).connect(sfx);
  return ctx;
}

// For checking levels from the console: window.__arena.audio.meter(800).then(console.log) → { state, peak, rms }.
export async function meter(ms = 500) {
  if (!ensure()) return { state: 'unsupported' };
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  master.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let peak = 0, sum = 0, count = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) { analyser.getFloatTimeDomainData(data); for (const v of data) { peak = Math.max(peak, Math.abs(v)); sum += v * v; count += 1; } await new Promise((resolve) => setTimeout(resolve, 20)); }
  // The loudest few frequencies at the end of the window: a steady tone or buzz shows up here.
  analyser.fftSize = 8192;
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  await new Promise((resolve) => setTimeout(resolve, 250));
  analyser.getFloatFrequencyData(spectrum);
  const tones = [...spectrum].map((db, bin) => [Math.round(bin * ctx.sampleRate / analyser.fftSize), Math.round(db)]).filter(([hz]) => hz > 30).sort((m, n) => n[1] - m[1]).slice(0, 6);
  master.disconnect(analyser);
  return { state: ctx.state, peak: Number(peak.toFixed(3)), rms: Number(Math.sqrt(sum / Math.max(1, count)).toFixed(4)), tones };
}

export function unlockAudio() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  startMusic();
}
export function setVolume(value) { if (master) master.gain.setTargetAtTime(value, ctx.currentTime, 0.05); if (musicOut) musicOut.gain.setTargetAtTime(value, ctx.currentTime, 0.05); applyMusicVolume(); }

export function setListener(camera) {
  if (!ctx) return;
  listener.x = camera.position.x; listener.y = camera.position.y; listener.z = camera.position.z;
  const l = ctx.listener;
  const e = camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(listener.x, t); l.positionY.setValueAtTime(listener.y, t); l.positionZ.setValueAtTime(listener.z, t);
    l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
    l.upX.setValueAtTime(ux, t); l.upY.setValueAtTime(uy, t); l.upZ.setValueAtTime(uz, t);
  } else { l.setPosition(listener.x, listener.y, listener.z); l.setOrientation(fx, fy, fz, ux, uy, uz); }
}

// Builds the output chain for one sound. Returns { out, at, dist }.
function route({ pos = null, volume = 1, ref = 4, send = 0.2, maxDelay = 0.35, ui = false } = {}) {
  const out = ctx.createGain();
  out.gain.value = volume;
  let at = ctx.currentTime + 0.001;
  let dist = 0;
  let tail = out;
  if (pos) {
    dist = Math.hypot(pos[0] - listener.x, pos[1] - listener.y, pos[2] - listener.z);
    at += Math.min(maxDelay, dist / 343);
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = Math.max(650, 18000 / (1 + dist / 24));
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = ref; panner.rolloffFactor = 1.1; panner.maxDistance = 400;
    if (panner.positionX) { panner.positionX.value = pos[0]; panner.positionY.value = pos[1]; panner.positionZ.value = pos[2]; } else panner.setPosition(pos[0], pos[1], pos[2]);
    out.connect(muffle).connect(panner);
    tail = panner;
  }
  tail.connect(ui ? uiBus : sfx);
  // Distant sounds are mostly their reflections.
  if (send > 0 && !ui) { const bus = ctx.createGain(); bus.gain.value = send * (1 + Math.min(1.5, dist / 60)); tail.connect(bus).connect(verbSend); }
  return { out, at, dist };
}

// ------------------------------------------------------------------ building blocks
function noise(dest, at, { type = 'lowpass', freq = 1200, q = 0.8, attack = 0.002, decay = 0.2, gain = 1, sweepTo = null, drive = false }) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.setValueAtTime(freq, at); filter.Q.value = q;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), at + attack + decay);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  source.connect(filter);
  if (drive) { const shaper = ctx.createWaveShaper(); shaper.curve = shaperCurve; const pre = ctx.createGain(); pre.gain.value = 2.2; filter.connect(pre).connect(shaper).connect(amp); } else filter.connect(amp);
  amp.connect(dest);
  source.start(at, Math.random() * 1.5);
  source.stop(at + attack + decay + 0.05);
}

function tone(dest, at, { wave = 'sine', freq = 440, to = null, attack = 0.003, decay = 0.2, gain = 0.5, detune = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  osc.detune.value = detune;
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + attack + decay);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  osc.connect(amp).connect(dest);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

// Struck metal: a handful of damped partials at inharmonic ratios. partials: [[ratio, gain, decay], …]
const PLATE = [[1, 1, 1], [2.76, 0.55, 0.7], [5.4, 0.35, 0.45], [8.93, 0.2, 0.3]];
const SMALL_PART = [[1, 1, 1], [1.59, 0.6, 0.8], [2.31, 0.4, 0.6]];
function modal(dest, at, base, partials, { gain = 0.3, decay = 0.3 } = {}) {
  for (const [ratio, level, life] of partials) tone(dest, at, { freq: Math.min(15000, base * ratio * vary(0.01)), attack: 0.0008, decay: decay * life, gain: gain * level });
}
// FM bell: a sine whose pitch is wobbled by a faster sine that dies away, which is what gives a bell its "ting".
function bell(dest, at, freq, { decay = 0.5, gain = 0.2, ratio = 3.5, index = 2.2 } = {}) {
  const carrier = ctx.createOscillator(), mod = ctx.createOscillator(), depth = ctx.createGain(), amp = ctx.createGain();
  carrier.frequency.value = freq; mod.frequency.value = freq * ratio;
  depth.gain.setValueAtTime(freq * index, at); depth.gain.exponentialRampToValueAtTime(1, at + decay * 0.6);
  amp.gain.setValueAtTime(0.0001, at); amp.gain.exponentialRampToValueAtTime(gain, at + 0.004); amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  mod.connect(depth).connect(carrier.frequency);
  carrier.connect(amp).connect(dest);
  carrier.start(at); mod.start(at); carrier.stop(at + decay + 0.05); mod.stop(at + decay + 0.05);
}
// A scatter of tiny noise bursts: gravel under a boot, plaster falling, a casing skittering.
function grains(dest, at, count, span, { type = 'bandpass', low = 1200, high = 4000, q = 1.5, decay = 0.02, gain = 0.3 } = {}) {
  for (let i = 0; i < count; i += 1) noise(dest, at + Math.random() * span, { type, freq: rnd(low, high), q, attack: 0.001, decay: decay * rnd(0.6, 1.6), gain: gain * rnd(0.4, 1) });
}
const click = (out, at, freq = 2200, gain = 0.4, decay = 0.03) => noise(out, at, { type: 'bandpass', freq: freq * vary(0.06), q: 3, attack: 0.0008, decay, gain });
// Two machined parts meeting: a tick of noise and a short metallic ring.
const clack = (out, at, freq = 2600, gain = 0.4) => { click(out, at, freq * 0.8, gain, 0.018); modal(out, at, freq, SMALL_PART, { gain: gain * 0.22, decay: 0.05 }); };

// ------------------------------------------------------------------ weapons
// Classes carry the recipe; each weapon picks a class and bends it (pitch < 1 = bigger, deeper).
//   sub [from Hz, to Hz, decay, gain] · blast [lp from, lp to, decay, gain] · crack [hp Hz, decay, gain]
//   body [[Hz, q, gain], …] · tail [decay, gain, lp] · action: what the gun does after the shot
const GUN_CLASS = {
  sniper: { sub: [92, 34, 0.5, 1], blast: [5200, 320, 0.2, 1], crack: [3400, 0.012, 1], body: [[420, 3, 0.7], [980, 4, 0.45], [2300, 5, 0.25]], tail: [1.5, 0.5, 1500], action: 'none', ref: 15, send: 0.6 },
  dmr: { sub: [120, 46, 0.26, 0.8], blast: [5600, 420, 0.13, 0.85], crack: [3800, 0.01, 0.85], body: [[520, 3, 0.55], [1250, 4, 0.4], [2700, 5, 0.22]], tail: [0.9, 0.36, 1700], action: 'semi', ref: 12, send: 0.45 },
  rifle: { sub: [138, 56, 0.15, 0.68], blast: [6000, 520, 0.09, 0.75], crack: [4200, 0.008, 0.75], body: [[640, 3, 0.5], [1500, 4, 0.36], [3100, 5, 0.2]], tail: [0.62, 0.27, 1900], action: 'auto', ref: 10.5, send: 0.36 },
  lmg: { sub: [104, 42, 0.19, 0.85], blast: [5000, 400, 0.11, 0.85], crack: [3600, 0.009, 0.75], body: [[460, 3, 0.6], [1100, 4, 0.4], [2500, 5, 0.2]], tail: [0.75, 0.3, 1600], action: 'auto', ref: 12, send: 0.4 },
  smg: { sub: [175, 80, 0.085, 0.5], blast: [6500, 700, 0.06, 0.6], crack: [4600, 0.006, 0.55], body: [[820, 3, 0.45], [1900, 4, 0.34], [3600, 5, 0.18]], tail: [0.4, 0.18, 2200], action: 'auto', ref: 8, send: 0.25 },
  shotgun: { sub: [78, 30, 0.42, 1.05], blast: [3600, 240, 0.24, 1.1], crack: [2200, 0.02, 0.7], body: [[300, 2.5, 0.8], [720, 3, 0.5], [1500, 4, 0.25]], tail: [1.15, 0.5, 1200], action: 'none', ref: 12, send: 0.55 },
  pistol: { sub: [185, 72, 0.1, 0.55], blast: [6200, 600, 0.07, 0.65], crack: [4000, 0.007, 0.6], body: [[760, 3, 0.45], [1750, 4, 0.34], [3300, 5, 0.18]], tail: [0.5, 0.2, 2000], action: 'semi', ref: 8, send: 0.3 },
  magnum: { sub: [108, 40, 0.32, 0.95], blast: [4800, 330, 0.17, 0.95], crack: [3000, 0.012, 0.85], body: [[400, 3, 0.7], [950, 4, 0.45], [2100, 5, 0.24]], tail: [1.05, 0.42, 1500], action: 'none', ref: 12, send: 0.5 },
  suppressed: { sub: [240, 120, 0.04, 0.16], blast: [2200, 500, 0.05, 0.22], crack: [1500, 0.012, 0.1], body: [[900, 2, 0.16]], tail: [0.12, 0.04, 1500], action: 'semi', ref: 3, send: 0.05 },
};
// A launcher: nothing supersonic leaves it, so there is no crack, just a deep push and a long roar
// that carries a long way.
GUN_CLASS.launcher = { sub: [70, 26, 0.8, 1.25], blast: [3400, 180, 0.45, 1.1], crack: [900, 0.03, 0.35], body: [[180, 3, 0.9], [520, 4, 0.55], [1400, 5, 0.3]], tail: [2.4, 0.9, 900], action: 'none', ref: 22, send: 0.8 };

const GUNS = {
  m44: ['sniper', 1, 1], vesper: ['sniper', 1.13, 0.9], harbinger: ['sniper', 0.7, 1.22], recon: ['dmr', 1, 1],
  talon: ['rifle', 1, 1], ronin: ['rifle', 0.86, 1.08], halcyon: ['rifle', 1.12, 0.92], anvil: ['lmg', 1, 1],
  wasp: ['smg', 1, 1], hornet: ['smg', 1.2, 0.9], breaker: ['shotgun', 1, 1], maul: ['shotgun', 1.12, 0.92], sawn: ['shotgun', 0.84, 1.12],
  p9: ['pistol', 1, 1], pike: ['pistol', 1.16, 0.9], viper: ['magnum', 1, 1], wren: ['suppressed', 1, 1],
  nin: ['launcher', 1, 1.15],
};

function casing(out, at) {
  // Brass on the floor: a bright first bounce, then two or three quicker, quieter ones.
  let time = at + rnd(0.34, 0.52), level = 0.085;
  const pitch = rnd(3400, 4600);
  for (let bounce = 0; bounce < 3; bounce += 1) { modal(out, time, pitch * vary(0.04), SMALL_PART, { gain: level, decay: 0.07 }); time += rnd(0.07, 0.13) * (1 - bounce * 0.25); level *= 0.5; }
}

export function playShot(weaponId, pos = null, volume = 1) {
  if (!ensure() || ctx.state !== 'running') return;
  const [className, pitch, level] = GUNS[weaponId] || GUNS.p9;   // anything unlisted falls back, so keep GUNS complete
  const spec = GUN_CLASS[className];
  const own = !pos;
  const { out, at, dist } = route({ pos, volume: volume * level * (own ? 0.54 : 1.5), ref: spec.ref, send: spec.send });
  const p = pitch * vary(0.035), g = vary(0.08);
  const far = Math.min(1, dist / 110);        // 0 next to you … 1 across the map
  const room = shelter;                        // indoors the tail is shorter and boomier
  const [subFrom, subTo, subDecay, subGain] = spec.sub;
  const [lpFrom, lpTo, blastDecay, blastGain] = spec.blast;
  const [crackFreq, crackDecay, crackGain] = spec.crack;
  if (own || dist < 30) click(out, at, 3800, 0.25 * (1 - far), 0.006);
  // Up close the crack leads; at range it is the first thing to go.
  noise(out, at, { type: 'highpass', freq: crackFreq * p, attack: 0.0006, decay: crackDecay * (1 + far), gain: crackGain * g * (1 - far * 0.8) });
  noise(out, at + 0.0015, { freq: lpFrom * p, sweepTo: lpTo * p, q: 0.7, attack: 0.0012, decay: blastDecay / p, gain: blastGain * g, drive: true });
  tone(out, at, { freq: subFrom * p, to: subTo * p, attack: 0.002, decay: subDecay / p, gain: subGain * g * (1 + room * 0.25) });
  for (const [freq, q, gain] of spec.body) noise(out, at + 0.002, { type: 'bandpass', freq: freq * p * vary(0.03), q, attack: 0.001, decay: (0.05 + 0.06 / p) * (1 + room * 0.4), gain: gain * g * (1 - far * 0.5) });
  // The tail: the report rolling back off whatever is around. Outdoors it is long with a slap echo; indoors short and thick.
  const [tailDecay, tailGain, tailLp] = spec.tail;
  const tailLength = tailDecay * (1 - room * 0.55) * (1 + far * 0.5);
  noise(out, at + 0.012, { freq: tailLp * (1 - far * 0.45), sweepTo: 260, q: 0.5, attack: 0.02, decay: tailLength, gain: tailGain * g * (1 + far * 0.7 + room * 0.3) });
  if (room < 0.5 && tailDecay > 0.5) noise(out, at + rnd(0.1, 0.17), { freq: tailLp * 0.6, sweepTo: 220, q: 0.5, attack: 0.015, decay: tailLength * 0.6, gain: tailGain * 0.4 * g });
  // What the gun itself does next: only worth hearing when it is yours or close.
  if (own || dist < 12) {
    const near = own ? 1 : 0.5;
    if (spec.action === 'auto' || spec.action === 'semi') { clack(out, at + 0.042 / p, 2300 * p, 0.2 * near); if (own || dist < 7) casing(out, at); }
    if (className === 'magnum') click(out, at + 0.05, 1500, 0.12 * near, 0.02);
  }
}

// ------------------------------------------------------------------ impacts
const IMPACTS = {
  concrete: (out, at) => { noise(out, at, { freq: 1500, sweepTo: 300, attack: 0.001, decay: 0.09, gain: 0.8, drive: true }); noise(out, at, { type: 'highpass', freq: 3500, attack: 0.0008, decay: 0.03, gain: 0.35 }); grains(out, at + 0.04, 7, 0.35, { low: 1500, high: 5000, decay: 0.012, gain: 0.16 }); },
  metal: (out, at) => { const f = rnd(900, 2100); noise(out, at, { type: 'highpass', freq: 3500, attack: 0.0006, decay: 0.025, gain: 0.5 }); modal(out, at, f, PLATE, { gain: 0.3, decay: 0.55 }); if (Math.random() < 0.3) tone(out, at + 0.01, { freq: rnd(2600, 3600), to: rnd(900, 1500), attack: 0.002, decay: 0.32, gain: 0.07 }); },
  wood: (out, at) => { tone(out, at, { freq: 260 * vary(0.1), to: 110, attack: 0.001, decay: 0.07, gain: 0.7 }); tone(out, at, { freq: 610 * vary(0.1), to: 300, attack: 0.001, decay: 0.04, gain: 0.3 }); noise(out, at, { freq: 2200, sweepTo: 500, attack: 0.001, decay: 0.05, gain: 0.5 }); grains(out, at + 0.02, 4, 0.12, { low: 1800, high: 3800, decay: 0.01, gain: 0.14 }); },
  glass: (out, at) => { noise(out, at, { type: 'highpass', freq: 5200, attack: 0.0006, decay: 0.06, gain: 0.55 }); modal(out, at, rnd(3200, 4400), SMALL_PART, { gain: 0.14, decay: 0.16 }); },
  cloth: (out, at) => { noise(out, at, { freq: 700, sweepTo: 250, attack: 0.002, decay: 0.07, gain: 0.4 }); noise(out, at, { type: 'bandpass', freq: 2400, q: 0.8, attack: 0.002, decay: 0.03, gain: 0.12 }); },
  gravel: (out, at) => { noise(out, at, { freq: 900, sweepTo: 250, attack: 0.001, decay: 0.07, gain: 0.55 }); grains(out, at, 9, 0.22, { low: 1400, high: 4200, decay: 0.014, gain: 0.22 }); },
  grass: (out, at) => { noise(out, at, { freq: 520, sweepTo: 180, attack: 0.002, decay: 0.09, gain: 0.55 }); grains(out, at + 0.01, 4, 0.15, { low: 900, high: 2200, decay: 0.02, gain: 0.1 }); },
  energy: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 1100, to: 180, attack: 0.001, decay: 0.2, gain: 0.26 }); noise(out, at, { type: 'bandpass', freq: 2600, q: 2, attack: 0.001, decay: 0.12, gain: 0.3 }); bell(out, at, 620, { decay: 0.3, gain: 0.08, ratio: 1.41, index: 4 }); },
  flesh: (out, at) => { noise(out, at, { freq: 900, sweepTo: 200, attack: 0.001, decay: 0.08, gain: 0.8, drive: true }); tone(out, at, { freq: 160, to: 62, attack: 0.002, decay: 0.11, gain: 0.6 }); noise(out, at + 0.01, { type: 'bandpass', freq: 2600, q: 1, attack: 0.002, decay: 0.035, gain: 0.14 }); },
};

export function playImpact(material, pos, volume = 0.8) {
  if (!ensure() || ctx.state !== 'running') return;
  const make = IMPACTS[material] || IMPACTS.concrete;
  const { out, at } = route({ pos, volume, ref: 3, send: 0.18 });
  make(out, at);
}

// ------------------------------------------------------------------ footsteps
// A step is a heel strike and, a few hundredths of a second later, the ball of the foot. Surfaces differ
// in what those two contacts excite: a dull slab, a ringing plate, a hollow board, a bed of loose stones.
const STEPS = {
  concrete: (out, at, w) => { noise(out, at, { freq: 380 * vary(0.15), sweepTo: 140, attack: 0.002, decay: 0.06, gain: 0.75 * w }); tone(out, at, { freq: 95, to: 55, attack: 0.002, decay: 0.05, gain: 0.35 * w }); noise(out, at + 0.03, { type: 'bandpass', freq: 2300 * vary(0.2), q: 0.9, attack: 0.002, decay: 0.035, gain: 0.16 * w }); },
  metal: (out, at, w) => { noise(out, at, { freq: 500, sweepTo: 200, attack: 0.002, decay: 0.05, gain: 0.5 * w }); modal(out, at, rnd(280, 380), PLATE, { gain: 0.16 * w, decay: 0.22 }); noise(out, at + 0.032, { type: 'bandpass', freq: 3000, q: 1.2, attack: 0.001, decay: 0.03, gain: 0.14 * w }); },
  wood: (out, at, w) => { tone(out, at, { freq: 150 * vary(0.12), to: 88, attack: 0.002, decay: 0.08, gain: 0.6 * w }); tone(out, at, { freq: 410 * vary(0.12), to: 250, attack: 0.002, decay: 0.035, gain: 0.2 * w }); noise(out, at + 0.028, { freq: 1200, attack: 0.002, decay: 0.035, gain: 0.22 * w }); if (Math.random() < 0.12) tone(out, at + 0.04, { wave: 'triangle', freq: rnd(500, 700), to: rnd(380, 480), attack: 0.02, decay: 0.12, gain: 0.04 * w }); },
  gravel: (out, at, w) => { noise(out, at, { freq: 600, sweepTo: 200, attack: 0.003, decay: 0.06, gain: 0.4 * w }); grains(out, at, 8, 0.13, { low: 1300, high: 4200, decay: 0.013, gain: 0.26 * w }); },
  grass: (out, at, w) => { noise(out, at, { freq: 420, sweepTo: 150, attack: 0.004, decay: 0.08, gain: 0.45 * w }); noise(out, at + 0.015, { type: 'bandpass', freq: 3200, q: 0.7, attack: 0.012, decay: 0.07, gain: 0.09 * w }); },
  cloth: (out, at, w) => noise(out, at, { freq: 380, sweepTo: 160, attack: 0.004, decay: 0.07, gain: 0.35 * w }),
  glass: (out, at, w) => { STEPS.concrete(out, at, w * 0.8); grains(out, at, 3, 0.08, { type: 'highpass', low: 4000, high: 7000, decay: 0.012, gain: 0.1 * w }); },
};
export function playFootstep(surface, pos = null, volume = 0.5) {
  if (!ensure() || ctx.state !== 'running') return;
  const { out, at } = route({ pos, volume: pos ? volume * 2 : volume * 0.75, ref: 2.5, send: surface === 'metal' ? 0.3 : 0.12, maxDelay: 0.1 });
  (STEPS[surface] || STEPS.concrete)(out, at, vary(0.18));
  // Your own kit moves with you: webbing and a slung rifle, very quietly.
  if (!pos && Math.random() < 0.6) noise(out, at + rnd(0.02, 0.07), { type: 'bandpass', freq: rnd(1800, 3200), q: 0.8, attack: 0.008, decay: 0.05, gain: 0.05 });
}

// ------------------------------------------------------------------ everything else
const SOUNDS = {
  // --- weapon handling
  dry: (out, at) => { click(out, at, 2100, 0.35, 0.012); modal(out, at, 3100, SMALL_PART, { gain: 0.05, decay: 0.04 }); },
  bolt: (out, at) => {
    // Lift, draw back (the case leaves), push forward, lock down.
    clack(out, at, 2100, 0.3);
    noise(out, at + 0.05, { type: 'bandpass', freq: 1400, sweepTo: 2400, q: 1.4, attack: 0.02, decay: 0.09, gain: 0.16 });
    clack(out, at + 0.17, 1700, 0.42);
    modal(out, at + 0.24, rnd(3300, 4000), SMALL_PART, { gain: 0.07, decay: 0.08 });
    noise(out, at + 0.34, { type: 'bandpass', freq: 2200, sweepTo: 1300, q: 1.4, attack: 0.02, decay: 0.08, gain: 0.16 });
    clack(out, at + 0.45, 1900, 0.45);
    clack(out, at + 0.56, 2700, 0.32);
  },
  pump: (out, at) => {
    noise(out, at, { type: 'bandpass', freq: 800, sweepTo: 1500, q: 1.2, attack: 0.015, decay: 0.07, gain: 0.3 }); clack(out, at + 0.075, 1300, 0.5);
    modal(out, at + 0.11, 2900, SMALL_PART, { gain: 0.05, decay: 0.07 });
    noise(out, at + 0.2, { type: 'bandpass', freq: 1500, sweepTo: 800, q: 1.2, attack: 0.015, decay: 0.07, gain: 0.3 }); clack(out, at + 0.275, 1600, 0.55);
  },
  reloadOut: (out, at) => { clack(out, at, 1500, 0.32); noise(out, at + 0.03, { type: 'bandpass', freq: 1100, sweepTo: 600, q: 1, attack: 0.02, decay: 0.11, gain: 0.2 }); },
  reloadIn: (out, at) => { noise(out, at, { type: 'bandpass', freq: 700, sweepTo: 1300, q: 1, attack: 0.02, decay: 0.08, gain: 0.2 }); clack(out, at + 0.085, 1300, 0.5); tone(out, at + 0.085, { freq: 170, to: 90, attack: 0.002, decay: 0.05, gain: 0.25 }); },
  reloadDone: (out, at) => { noise(out, at, { type: 'bandpass', freq: 1800, sweepTo: 2600, q: 1.5, attack: 0.012, decay: 0.05, gain: 0.16 }); clack(out, at + 0.07, 2200, 0.5); },
  equip: (out, at) => { noise(out, at, { type: 'bandpass', freq: 900, sweepTo: 2200, q: 0.8, attack: 0.03, decay: 0.12, gain: 0.16 }); clack(out, at + 0.12, 1800, 0.26); },
  scope: (out, at) => { noise(out, at, { type: 'bandpass', freq: 1300, sweepTo: 2600, q: 0.7, attack: 0.03, decay: 0.09, gain: 0.07 }); click(out, at + 0.09, 1400, 0.05, 0.02); },
  swing: (out, at) => noise(out, at, { type: 'bandpass', freq: 700, sweepTo: 3600, q: 1.8, attack: 0.04, decay: 0.13, gain: 0.4 }),
  stab: (out, at) => { IMPACTS.flesh(out, at); modal(out, at, 3400, SMALL_PART, { gain: 0.05, decay: 0.08 }); },
  // A gun charm tapping the receiver: a tiny bright ring.
  charm: (out, at) => { click(out, at, 5200, 0.12, 0.004); modal(out, at, rnd(4300, 5600), SMALL_PART, { gain: 0.05, decay: 0.09 }); },
  // --- hit feedback
  hitmarker: (out, at) => { click(out, at, 3400, 0.32, 0.008); tone(out, at, { freq: 1850, attack: 0.001, decay: 0.03, gain: 0.12 }); },
  headshot: (out, at) => { click(out, at, 4600, 0.4, 0.008); modal(out, at, 2250, [[1, 1, 1], [1.62, 0.55, 0.8], [2.27, 0.35, 0.6]], { gain: 0.22, decay: 0.34 }); },
  kill: (out, at) => { tone(out, at, { freq: 110, to: 60, attack: 0.002, decay: 0.12, gain: 0.28 }); bell(out, at + 0.02, 880, { decay: 0.4, gain: 0.13, ratio: 2, index: 1.2 }); bell(out, at + 0.12, 1320, { decay: 0.5, gain: 0.11, ratio: 2, index: 1.2 }); },
  hurt: (out, at) => { tone(out, at, { freq: 150, to: 55, attack: 0.002, decay: 0.18, gain: 0.8 }); noise(out, at, { freq: 1100, sweepTo: 250, attack: 0.002, decay: 0.12, gain: 0.5, drive: true }); noise(out, at + 0.06, { type: 'bandpass', freq: 1600, sweepTo: 900, q: 1.2, attack: 0.03, decay: 0.16, gain: 0.07 }); },
  helmet: (out, at) => { noise(out, at, { type: 'highpass', freq: 4000, attack: 0.0006, decay: 0.02, gain: 0.5 }); modal(out, at, 1350, PLATE, { gain: 0.3, decay: 0.5 }); tone(out, at + 0.02, { freq: 5200, attack: 0.01, decay: 0.9, gain: 0.03 }); },
  death: (out, at) => { tone(out, at, { freq: 190, to: 38, attack: 0.004, decay: 1.1, gain: 0.4 }); noise(out, at, { freq: 900, sweepTo: 120, attack: 0.01, decay: 0.9, gain: 0.3 }); tone(out, at, { freq: 5600, attack: 0.05, decay: 1.6, gain: 0.025 }); },
  heartbeat: (out, at) => { tone(out, at, { freq: 58, to: 42, attack: 0.008, decay: 0.12, gain: 0.75 }); tone(out, at + 0.2, { freq: 50, to: 38, attack: 0.008, decay: 0.14, gain: 0.5 }); },
  // A round going past: the snap of the shock wave, then the hiss falling away behind it.
  whizz: (out, at) => { noise(out, at, { type: 'highpass', freq: 3800, attack: 0.0005, decay: 0.012, gain: 0.9 }); noise(out, at + 0.004, { type: 'bandpass', freq: 3600, sweepTo: 420, q: 5, attack: 0.004, decay: 0.24, gain: 0.7 }); },
  glassBreak: (out, at) => { noise(out, at, { type: 'highpass', freq: 2800, attack: 0.0008, decay: 0.12, gain: 0.85, drive: true }); for (let i = 0; i < 12; i += 1) modal(out, at + Math.random() ** 1.6 * 0.7, rnd(2400, 6800), SMALL_PART, { gain: rnd(0.03, 0.1), decay: rnd(0.05, 0.2) }); grains(out, at + 0.12, 14, 0.8, { type: 'highpass', low: 4500, high: 9000, decay: 0.01, gain: 0.12 }); },
  land: (out, at) => { noise(out, at, { freq: 420, sweepTo: 110, attack: 0.002, decay: 0.12, gain: 0.7 }); tone(out, at, { freq: 85, to: 45, attack: 0.002, decay: 0.1, gain: 0.5 }); noise(out, at + 0.02, { type: 'bandpass', freq: 2400, q: 0.8, attack: 0.006, decay: 0.06, gain: 0.08 }); },
  jump: (out, at) => { noise(out, at, { freq: 480, sweepTo: 200, attack: 0.003, decay: 0.06, gain: 0.25 }); noise(out, at + 0.015, { type: 'bandpass', freq: 2600, q: 0.8, attack: 0.01, decay: 0.05, gain: 0.05 }); },
  // --- interface: small, tactile, glassy. Nothing here should ever be annoying on the hundredth click.
  ui: (out, at) => { click(out, at, 3000, 0.2, 0.006); bell(out, at, 1568, { decay: 0.09, gain: 0.09, ratio: 2, index: 0.8 }); },
  uiBack: (out, at) => { click(out, at, 2000, 0.17, 0.008); bell(out, at, 1046, { decay: 0.1, gain: 0.08, ratio: 2, index: 0.8 }); },
  ready: (out, at) => { bell(out, at, 784, { decay: 0.3, gain: 0.1, ratio: 2, index: 1 }); bell(out, at + 0.09, 1175, { decay: 0.45, gain: 0.1, ratio: 2, index: 1 }); tone(out, at, { freq: 98, to: 70, attack: 0.004, decay: 0.12, gain: 0.12 }); },
  deny: (out, at) => { for (const offset of [0, 0.11]) { tone(out, at + offset, { freq: 150, to: 110, attack: 0.003, decay: 0.07, gain: 0.2 }); noise(out, at + offset, { freq: 700, attack: 0.002, decay: 0.04, gain: 0.1 }); } },
  buy: (out, at) => { clack(out, at, 1900, 0.3); bell(out, at + 0.05, 1760, { decay: 0.25, gain: 0.07 }); bell(out, at + 0.1, 2637, { decay: 0.3, gain: 0.05 }); },
  tick: (out, at) => { click(out, at, 2600, 0.14, 0.006); tone(out, at, { freq: 1200, attack: 0.001, decay: 0.03, gain: 0.06 }); },
  tickFinal: (out, at) => { bell(out, at, 1568, { decay: 0.5, gain: 0.13, ratio: 2, index: 1.4 }); tone(out, at, { freq: 196, attack: 0.004, decay: 0.3, gain: 0.1 }); },
  chat: (out, at) => bell(out, at, 1318, { decay: 0.12, gain: 0.04, ratio: 2, index: 0.6 }),
  ping: (out, at) => { bell(out, at, 1480, { decay: 0.22, gain: 0.1, ratio: 3, index: 1 }); bell(out, at + 0.09, 1976, { decay: 0.3, gain: 0.09, ratio: 3, index: 1 }); },
  marked: (out, at) => { for (const offset of [0, 0.1]) { click(out, at + offset, 3600, 0.12, 0.006); tone(out, at + offset, { wave: 'triangle', freq: 1400, attack: 0.001, decay: 0.05, gain: 0.09 }); } },
  xp: (out, at) => [784, 988, 1175, 1568].forEach((f, i) => bell(out, at + i * 0.065, f, { decay: 0.4, gain: 0.07, ratio: 2, index: 1 })),
  // --- crates: a latch thrown, the lid going up with the air rushing out, the build-up before a good card turns, the dupe stamp
  latch: (out, at) => { clack(out, at, 1500, 0.5); tone(out, at, { freq: 210, to: 120, attack: 0.002, decay: 0.05, gain: 0.2 }); modal(out, at + 0.012, 2600, SMALL_PART, { gain: 0.06, decay: 0.12 }); },
  crateOpen: (out, at) => { noise(out, at, { type: 'bandpass', freq: 300, sweepTo: 2400, q: 0.9, attack: 0.05, decay: 0.45, gain: 0.35 }); tone(out, at, { wave: 'sawtooth', freq: 140, to: 95, attack: 0.02, decay: 0.3, gain: 0.05 }); tone(out, at + 0.42, { freq: 90, to: 48, attack: 0.003, decay: 0.18, gain: 0.45 }); noise(out, at + 0.42, { freq: 900, sweepTo: 200, attack: 0.002, decay: 0.12, gain: 0.3 }); bell(out, at + 0.1, 784, { decay: 0.9, gain: 0.06, ratio: 2, index: 1.4 }); },
  riser: (out, at) => { noise(out, at, { type: 'bandpass', freq: 220, sweepTo: 5200, q: 2.2, attack: 1.6, decay: 0.25, gain: 0.16 }); tone(out, at, { wave: 'sawtooth', freq: 55, to: 220, attack: 1.5, decay: 0.3, gain: 0.07 }); tone(out, at, { freq: 330, to: 1320, attack: 1.6, decay: 0.2, gain: 0.04 }); },
  stamp: (out, at) => { tone(out, at, { freq: 120, to: 45, attack: 0.002, decay: 0.16, gain: 0.6 }); noise(out, at, { freq: 1400, sweepTo: 260, attack: 0.001, decay: 0.09, gain: 0.5, drive: true }); noise(out, at + 0.02, { type: 'highpass', freq: 3000, attack: 0.002, decay: 0.05, gain: 0.12 }); },
  // --- round and match stingers: low brass-like swells and bells, through the hall
  roundStart: (out, at) => { for (const [f, d] of [[55, 0], [82.5, 7], [110, -6]]) tone(out, at, { wave: 'sawtooth', freq: f, to: f * 1.5, attack: 0.25, decay: 0.7, gain: 0.09, detune: d }); noise(out, at, { type: 'bandpass', freq: 300, sweepTo: 2600, q: 0.8, attack: 0.5, decay: 0.2, gain: 0.08 }); bell(out, at + 0.62, 659, { decay: 0.9, gain: 0.14, ratio: 2, index: 1.6 }); bell(out, at + 0.62, 988, { decay: 0.9, gain: 0.08, ratio: 2, index: 1.6 }); },
  roundWin: (out, at) => [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, d]) => { bell(out, at + d, f, { decay: 0.8, gain: 0.1, ratio: 2, index: 1.3 }); tone(out, at + d, { wave: 'triangle', freq: f / 2, attack: 0.01, decay: 0.5, gain: 0.06 }); }),
  roundLoss: (out, at) => [[440, 0], [370, 0.16], [311, 0.32], [220, 0.5]].forEach(([f, d]) => { tone(out, at + d, { wave: 'triangle', freq: f, attack: 0.02, decay: 0.7, gain: 0.11 }); tone(out, at + d, { wave: 'sawtooth', freq: f / 2, attack: 0.04, decay: 0.6, gain: 0.035, detune: -8 }); }),
  matchWin: (out, at) => { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { bell(out, at + i * 0.12, f, { decay: 1.3, gain: 0.1, ratio: 2, index: 1.4 }); tone(out, at + i * 0.12, { wave: 'triangle', freq: f / 2, attack: 0.01, decay: 0.9, gain: 0.07 }); }); for (const f of [131, 196, 262]) tone(out, at + 0.72, { wave: 'sawtooth', freq: f, attack: 0.3, decay: 1.8, gain: 0.05, detune: rnd(-8, 8) }); },
  matchLoss: (out, at) => { [392, 349, 294, 233, 196].forEach((f, i) => tone(out, at + i * 0.22, { wave: 'triangle', freq: f, attack: 0.03, decay: 1, gain: 0.1 })); for (const f of [98, 147]) tone(out, at + 0.9, { wave: 'sawtooth', freq: f, attack: 0.4, decay: 1.8, gain: 0.05, detune: rnd(-8, 8) }); },
  overtime: (out, at) => { for (let i = 0; i < 3; i += 1) { tone(out, at + i * 0.32, { wave: 'sawtooth', freq: 392, to: 784, attack: 0.02, decay: 0.24, gain: 0.08 }); tone(out, at + i * 0.32, { wave: 'sawtooth', freq: 196, to: 392, attack: 0.02, decay: 0.24, gain: 0.06, detune: 9 }); } },
  clutch: (out, at) => { for (const [f, d] of [[41, 0], [82, 6], [123, -7]]) tone(out, at, { wave: 'sawtooth', freq: f, attack: 0.08, decay: 1.6, gain: 0.12, detune: d }); noise(out, at, { freq: 200, attack: 0.05, decay: 1.2, gain: 0.12 }); },
  // --- gadgets
  pulse: (out, at) => { tone(out, at, { freq: 240, to: 2600, attack: 0.02, decay: 0.55, gain: 0.2 }); noise(out, at, { type: 'bandpass', freq: 500, sweepTo: 5000, q: 3, attack: 0.02, decay: 0.55, gain: 0.12 }); bell(out, at + 0.55, 1760, { decay: 0.7, gain: 0.12, ratio: 1.5, index: 2 }); },
  shield: (out, at) => { noise(out, at, { type: 'bandpass', freq: 300, sweepTo: 3000, q: 2, attack: 0.04, decay: 0.3, gain: 0.35 }); for (const f of [110, 165]) tone(out, at + 0.22, { wave: 'sawtooth', freq: f, attack: 0.05, decay: 0.6, gain: 0.08, detune: rnd(-10, 10) }); clack(out, at + 0.02, 1200, 0.3); },
  shieldBreak: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 800, to: 60, attack: 0.002, decay: 0.5, gain: 0.3 }); SOUNDS.glassBreak(out, at); },
  decoy: (out, at) => { for (let i = 0; i < 6; i += 1) bell(out, at + i * 0.045, 700 + i * 260, { decay: 0.14, gain: 0.05, ratio: 1.41, index: 3 }); },
  decoyPop: (out, at) => { tone(out, at, { wave: 'square', freq: 1500, to: 160, attack: 0.001, decay: 0.22, gain: 0.14 }); noise(out, at, { type: 'highpass', freq: 3000, attack: 0.001, decay: 0.14, gain: 0.3 }); grains(out, at + 0.03, 8, 0.2, { low: 2000, high: 7000, decay: 0.01, gain: 0.1 }); },
  stim: (out, at) => { click(out, at, 2400, 0.3, 0.01); noise(out, at + 0.02, { type: 'highpass', freq: 5500, attack: 0.01, decay: 0.35, gain: 0.22 }); tone(out, at + 0.25, { freq: 392, to: 784, attack: 0.1, decay: 0.6, gain: 0.07 }); },
  ghost: (out, at) => { noise(out, at, { type: 'bandpass', freq: 2400, sweepTo: 180, q: 2, attack: 0.03, decay: 0.7, gain: 0.25 }); tone(out, at, { freq: 660, to: 110, attack: 0.03, decay: 0.7, gain: 0.05 }); },
  droneDown: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 340, to: 50, attack: 0.002, decay: 0.55, gain: 0.25 }); noise(out, at, { freq: 2200, sweepTo: 300, attack: 0.002, decay: 0.3, gain: 0.4, drive: true }); grains(out, at + 0.3, 6, 0.3, { low: 1500, high: 4000, decay: 0.012, gain: 0.15 }); },
  // Thunder: the crack, then the roll: the same event arriving by longer and longer paths.
  explosion: (out, at) => {
    noise(out, at, { type: 'highpass', freq: 1800, attack: 0.001, decay: 0.09, gain: 0.7, drive: true });
    noise(out, at + 0.01, { freq: 420, sweepTo: 55, attack: 0.006, decay: 0.9, gain: 1, drive: true });
    tone(out, at + 0.01, { freq: 90, sweepTo: 32, type: 'sine', attack: 0.004, decay: 0.7, gain: 0.8 });
    for (let i = 0; i < 6; i += 1) noise(out, at + 0.12 + i * rnd(0.04, 0.12), { type: 'bandpass', freq: rnd(700, 2600), attack: 0.002, decay: rnd(0.05, 0.16), gain: 0.16 / (i * 0.5 + 1) });
  },
  thunder: (out, at) => { noise(out, at, { type: 'highpass', freq: 1200, attack: 0.002, decay: 0.18, gain: 0.5, drive: true }); noise(out, at + 0.04, { freq: 900, sweepTo: 90, attack: 0.03, decay: 1.2, gain: 0.9, drive: true }); for (let i = 0; i < 5; i += 1) noise(out, at + 0.5 + i * rnd(0.35, 0.6), { freq: rnd(90, 190), attack: 0.2, decay: rnd(0.8, 1.5), gain: 0.55 / (i + 1) }); },
};

const UI_SOUNDS = new Set(['ui', 'uiBack', 'ready', 'deny', 'buy', 'chat', 'xp', 'tick', 'tickFinal', 'latch', 'crateOpen', 'riser', 'stamp', 'roundWin', 'matchWin']);
export function play(name, options = {}) {
  if (!ensure() || ctx.state !== 'running') return;
  const make = SOUNDS[name];
  if (!make) return;
  const { out, at } = route({ send: 0.12, ui: UI_SOUNDS.has(name), ...options });
  make(out, at + (options.delay || 0));
}

// Leaving a match cuts its sound dead (tails, echoes and anything already scheduled) instead of
// letting the last firefight ring on over the menu. Coming back in opens it up again.
let worldOn = true;
export function setWorldAudio(on) {
  if (!ctx || on === worldOn) return;
  worldOn = on;
  sfx.gain.cancelScheduledValues(ctx.currentTime);
  sfx.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.05 : 0.03);
}

// Continuous sounds (the recon drone). Returns a handle with move()/stop().
export function startLoop(key, kind, pos = null) {
  if (!ensure() || ctx.state !== 'running' || loops.has(key)) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  let panner = null;
  if (pos) {
    panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3; panner.rolloffFactor = 1.4;
    out.connect(panner).connect(sfx);
  } else out.connect(sfx);
  const nodes = [];
  if (kind === 'drone') {
    // Four small rotors, never quite in tune, plus the air they chop.
    [142, 147, 284, 291, 431].forEach((freq, i) => { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq; const g = ctx.createGain(); g.gain.value = 0.07 / (1 + i * 0.5); osc.connect(g).connect(out); osc.start(); nodes.push(osc); });
    const air = ctx.createBufferSource(); air.buffer = noiseBuffer; air.loop = true; const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1900; band.Q.value = 0.8; const airGain = ctx.createGain(); airGain.gain.value = 0.1; air.connect(band).connect(airGain).connect(out); air.start(); nodes.push(air);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 27; const depth = ctx.createGain(); depth.gain.value = 0.3; lfo.connect(depth).connect(out.gain); lfo.start(); nodes.push(lfo);
  }
  out.gain.setTargetAtTime(pos ? 0.9 : 0.25, ctx.currentTime, 0.2);
  const handle = {
    move(x, y, z) { if (panner?.positionX) { panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z; } },
    stop() { out.gain.setTargetAtTime(0, ctx.currentTime, 0.08); setTimeout(() => { nodes.forEach((n) => n.stop()); out.disconnect(); }, 400); loops.delete(key); },
  };
  loops.set(key, handle);
  return handle;
}
export function loop(key) { return loops.get(key); }
export function stopAllLoops() { [...loops.values()].forEach((handle) => handle.stop()); }

// ------------------------------------------------------------------ weather and place
// Beds sit well under the action: footsteps and distant shots have to read over them.
export function setAmbience(variant) {
  if (!ensure()) return;
  if (ambience) { const old = ambience; clearInterval(old.timer); old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5); setTimeout(() => { old.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); }, 2500); ambience = null; }
  if (!variant) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(sfx);
  const sources = [];
  // One band of noise whose level (and, for wind, pitch) wanders slowly.
  const bed = (type, freq, q, level, lfoRate = 0, sweep = 0) => {
    const source = ctx.createBufferSource(); source.buffer = noiseBuffer; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const amp = ctx.createGain(); amp.gain.value = level;
    if (lfoRate) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate; lfo.start(); sources.push(lfo);
      const depth = ctx.createGain(); depth.gain.value = level * 0.6; lfo.connect(depth).connect(amp.gain);
      if (sweep) { const bend = ctx.createGain(); bend.gain.value = sweep; lfo.connect(bend).connect(filter.frequency); }
    }
    source.connect(filter).connect(amp).connect(gain); source.start(0, Math.random());
    sources.push(source);
  };
  let timer = null;
  if (variant === 'storm') {
    bed('lowpass', 480, 0.5, 0.06, 0.11, 120);                       // wind
    bed('highpass', 2800, 0.3, 0.024); bed('bandpass', 1100, 0.4, 0.022, 0.23);   // rain: hiss and body
    timer = setInterval(() => { if (ctx.state === 'running' && ambience && Math.random() < 0.8) grains(gain, ctx.currentTime + 0.01, 3, 0.25, { type: 'bandpass', low: 1800, high: 5200, q: 2.5, decay: 0.012, gain: 0.05 }); }, 260);   // drops landing close by
  } else if (variant === 'night') {
    bed('lowpass', 260, 0.5, 0.035, 0.07, 60); bed('lowpass', 120, 0.4, 0.02);   // still air: no pitched drone, under the soundtrack a fixed note reads as a buzz
    timer = setInterval(() => { if (ctx.state === 'running' && ambience && Math.random() < 0.35) { const t = ctx.currentTime + 0.02, f = rnd(4100, 4700); for (let i = 0; i < 3; i += 1) tone(gain, t + i * 0.055, { freq: f, attack: 0.008, decay: 0.03, gain: 0.006 }); } }, 900);    // a cricket, far off
  } else if (variant === 'snow') {
    bed('bandpass', 520, 1.4, 0.06, 0.09, 260); bed('lowpass', 240, 0.5, 0.04, 0.05);
  } else if (variant === 'haze') {
    bed('bandpass', 700, 0.8, 0.04, 0.08, 220); bed('highpass', 3500, 0.3, 0.008, 0.19);
  } else {
    bed('lowpass', 320, 0.5, 0.045, 0.1, 80); bed('lowpass', 140, 0.4, 0.03);   // light wind, and the city a long way off
  }
  gain.gain.setTargetAtTime(ambienceLevel, ctx.currentTime, 1.2);
  ambience = { gain, sources, timer };
}
// Under a roof: the weather falls away, and the room takes over from the open-air reverb.
export function setAmbienceShelter(amount) {
  shelter = Math.max(0, Math.min(1, amount));
  if (!ctx) return;
  if (ambience) ambience.gain.gain.setTargetAtTime(ambienceLevel * (1 - shelter * 0.65), ctx.currentTime, 0.4);
  outdoorWet.gain.setTargetAtTime(0.5 * (1 - shelter * 0.8), ctx.currentTime, 0.3);
  indoorWet.gain.setTargetAtTime(0.55 * shelter, ctx.currentTime, 0.3);
}
// Settings → Audio → Weather volume.
export function setAmbienceVolume(value) { ambienceLevel = Math.max(0, Math.min(1, Number(value))); if (ambience) ambience.gain.gain.setTargetAtTime(ambienceLevel * (1 - shelter * 0.65), ctx.currentTime, 0.2); }

// ------------------------------------------------------------------ music
// Your own tracks: put audio files in src/arena/music/ and list them in src/arena/music/tracks.json:
//   { "menu": ["my-theme.mp3"], "match": ["buy-phase.mp3"] }
// "menu" plays in the menus and lobby, "match" between rounds. With no files (or no manifest) a quiet
// generated pad plays in the menus instead, so the game is never silent. During live rounds music drops
// out unless Settings → Audio → "Music during rounds" is on. Footsteps matter more than a chorus.
let tracks = null;            // null = not loaded yet, { menu: [], match: [] } once it is
let musicScene = 'menu';
let musicEl = null, musicList = null, musicIndex = 0, musicFade = null;
let pad = null;
const musicBase = new URL('../music/', import.meta.url).href;
// In a match the music sits just under the menu level (a touch lower again while a round is live) and all
// of it rides the Music volume slider (and the master volume, since it plays through `master`).
const sceneLevel = () => (musicScene === 'combat' ? (game.settings.musicInMatch ? 0.8 : 0) : musicScene === 'match' ? 0.88 : 1);
// The slider's 100% is deliberately half of full scale: that is as loud as the soundtrack should ever get
// next to the game's own sounds, so the whole travel of the slider is usable.
const MUSIC_CEILING = 0.5;
const musicLevel = () => Math.max(0, Math.min(1, (game.settings.music ?? 0.9))) * MUSIC_CEILING * sceneLevel();

// A track is a file name, or { file, loopStart, loopEnd } for a seamless loop: the file carries half a
// second of lead-in and lead-out around the loop, and the game cycles between the two points sample-accurately
// (a plain <audio loop> always leaves a small gap, which is why looped tracks go through WebAudio instead).
const trackName = (entry) => (typeof entry === 'string' ? entry : entry?.file);
async function loadTracks() {
  if (tracks) return tracks;
  tracks = { menu: [], match: [] };
  try {
    const response = await fetch(`${musicBase}tracks.json`, { cache: 'no-cache' });
    if (response.ok) { const data = await response.json(); for (const key of ['menu', 'match']) if (Array.isArray(data[key])) tracks[key] = data[key].filter((entry) => /^[\w.-]+\.(mp3|ogg|wav|m4a|flac)$/i.test(trackName(entry) || '')).slice(0, 20); }
  } catch { /* no manifest: the generated pad plays */ }
  return tracks;
}

function fadeElement(el, to, seconds, then) {
  clearInterval(musicFade);
  const from = el.volume, start = performance.now();
  musicFade = setInterval(() => { const k = Math.min(1, (performance.now() - start) / (seconds * 1000)); el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k >= 1) { clearInterval(musicFade); then?.(); } }, 50);
}
// Seamless loop through WebAudio. Returns a player with the same shape the <audio> path uses.
const decoded = new Map();
const CROSSFADE = 2.6; // seconds; a little over a bar at 110 BPM
// `phase` (seconds into the loop) lets a new track come in at the same point in the bar the old one had
// reached. When two loops share a tempo and length (the lobby and in-game themes do), a crossfade between
// them then stays on the beat instead of smearing two rhythms together.
async function loopPlayer(entry, phase = 0, phaseNow = null) {
  if (!decoded.has(entry.file)) decoded.set(entry.file, fetch(`${musicBase}${encodeURIComponent(entry.file)}`).then((r) => r.arrayBuffer()).then((data) => ctx.decodeAudioData(data)));
  const buffer = await decoded.get(entry.file);
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer; source.loop = true;
  source.loopStart = Math.max(0, Number(entry.loopStart) || 0);
  source.loopEnd = Math.min(buffer.duration, Number(entry.loopEnd) || buffer.duration);
  const length = source.loopEnd - source.loopStart;
  gain.gain.value = 0;
  source.connect(gain).connect(musicOut || master);
  const startedAt = ctx.currentTime + 0.02;
  const live = phaseNow?.();
  const from = live === null || live === undefined ? phase : live + 0.02;
  const offset = ((from % length) + length) % length;
  source.start(startedAt, source.loopStart + offset);
  return {
    length,
    position() { return (((ctx.currentTime - startedAt + offset) % length) + length) % length; },
    // Equal-power-ish fades: a linear ramp in gain sounds like a dip in the middle of a crossfade.
    setLevel(level, seconds = 0.6) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3); },
    stop(seconds = 0.75) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setTargetAtTime(0, ctx.currentTime, seconds / 3); setTimeout(() => { try { source.stop(); gain.disconnect(); } catch { /* gone */ } }, seconds * 1000 + 600); },
  };
}
let musicPlayer = null, musicToken = 0, musicPending = false;
function playFromList(list) {
  if (musicList === list && (musicEl || musicPlayer || musicPending)) return;
  const old = musicEl, oldPlayer = musicPlayer;
  if (old) fadeElement(old, 0, 0.8, () => old.pause());
  musicList = list; musicEl = null; musicPlayer = null; musicPending = false;
  const token = ++musicToken;
  if (!list?.length) { oldPlayer?.stop(); return; }
  musicIndex = Math.floor(Math.random() * list.length);
  const entry = list[musicIndex];
  if (typeof entry === 'object' && list.length === 1) {
    // Loop to loop (lobby → match and back): wait for the new track to decode, bring it in at the old one's
    // place in the bar, and cross-fade over one bar's worth of time. The old track keeps playing until then.
    // Until the swap the old track stays the current one, so a second scene change cannot orphan it.
    musicPlayer = oldPlayer; musicPending = true;
    loopPlayer(entry, 0, () => (musicPlayer && musicPlayer !== undefined ? musicPlayer.position() : null)).then((player) => {
      if (token !== musicToken) { player.stop(0.1); return; }
      musicPending = false;
      const synced = oldPlayer && Math.abs(oldPlayer.length - player.length) < 0.01;
      const fade = synced ? CROSSFADE : 1.2;
      musicPlayer = player;
      player.setLevel(musicLevel(), fade);
      oldPlayer?.stop(fade);
    }).catch((error) => { console.warn(`music: could not play ${entry.file}`, error.message); musicList = null; musicPending = false; });
    return;
  }
  oldPlayer?.stop();
  const el = new Audio();
  el.preload = 'auto';
  el.loop = list.length === 1;
  el.volume = 0;
  el.src = `${musicBase}${encodeURIComponent(trackName(entry))}`;
  el.addEventListener('ended', () => { musicIndex = (musicIndex + 1) % list.length; el.src = `${musicBase}${encodeURIComponent(trackName(list[musicIndex]))}`; el.play().catch(() => {}); });
  el.addEventListener('error', () => console.warn(`music: could not play ${trackName(list[musicIndex])}. Check the name in music/tracks.json`));
  musicEl = el;
  el.play().then(() => fadeElement(el, musicLevel() * game.settings.volume, 1.5)).catch(() => { /* needs a click first; startMusic runs again on the next one */ musicEl = null; musicList = null; });
}

// Generated menu pad: slow four-chord cycle, detuned saws through a low-pass that opens and closes.
const PAD_CHORDS = [[73.4, 110, 174.6, 261.6, 329.6], [58.3, 87.3, 146.8, 220, 261.6], [87.3, 130.8, 220, 329.6, 392], [65.4, 98, 164.8, 246.9, 293.7]];
function startPad() {
  if (pad || !ctx) return;
  const out = ctx.createGain(); out.gain.value = 0;
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700; filter.Q.value = 0.6;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045; const sweep = ctx.createGain(); sweep.gain.value = 380; lfo.connect(sweep).connect(filter.frequency); lfo.start();
  filter.connect(out); out.connect(musicOut || master);
  const wet = ctx.createGain(); wet.gain.value = 0.9; out.connect(wet).connect(verbSend);
  let chord = Math.floor(Math.random() * PAD_CHORDS.length);
  const voice = () => {
    if (!pad || ctx.state !== 'running') return;
    const at = ctx.currentTime + 0.05;
    for (const freq of PAD_CHORDS[chord]) for (const detune of [-7, 6]) {
      const osc = ctx.createOscillator(), amp = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq; osc.detune.value = detune + rnd(-3, 3);
      amp.gain.setValueAtTime(0.0001, at); amp.gain.exponentialRampToValueAtTime(0.05, at + 3.5); amp.gain.setValueAtTime(0.05, at + 7); amp.gain.exponentialRampToValueAtTime(0.0001, at + 13);
      osc.connect(amp).connect(filter); osc.start(at); osc.stop(at + 13.2);
    }
    if (Math.random() < 0.7) bell(filter, at + rnd(2, 6), PAD_CHORDS[chord][rnd(2, 5) | 0] * 4, { decay: 3.5, gain: 0.05, ratio: 2, index: 1 });
    chord = (chord + 1) % PAD_CHORDS.length;
  };
  pad = { out, lfo, timer: setInterval(voice, 9000) };
  voice();
}
function stopPad() { if (!pad) return; const old = pad; pad = null; clearInterval(old.timer); old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6); setTimeout(() => { try { old.lfo.stop(); old.out.disconnect(); } catch { /* gone */ } }, 4000); }

function applyMusicVolume() {
  const level = musicLevel();
  if (musicEl && !musicEl.paused) fadeElement(musicEl, level * game.settings.volume, 0.6);
  musicPlayer?.setLevel(level);
  if (pad) pad.out.gain.setTargetAtTime(level * 0.5, ctx.currentTime, 0.5);
}
async function startMusic() {
  if (!ctx || ctx.state !== 'running') return;
  const loaded = await loadTracks();
  const wanted = musicScene === 'menu' ? loaded.menu : loaded.match.length ? loaded.match : loaded.menu;
  // Decode the other scene's loop ahead of time so the first lobby → match transition has nothing to wait for.
  for (const entry of [...loaded.menu, ...loaded.match]) if (typeof entry === 'object' && !decoded.has(entry.file)) decoded.set(entry.file, fetch(`${musicBase}${encodeURIComponent(entry.file)}`).then((r) => r.arrayBuffer()).then((data) => ctx.decodeAudioData(data)));
  const level = musicLevel();
  if (wanted.length && level > 0) { stopPad(); playFromList(wanted); } else {
    playFromList(null);
    if (!loaded.menu.length && !loaded.match.length && musicScene === 'menu' && level > 0) startPad(); else stopPad();
  }
  applyMusicVolume();
}
// scene: 'menu' (menus and lobby) · 'match' (buy phase, between rounds, end screen) · 'combat' (a live round)
export function setMusicScene(scene) { if (scene === musicScene) return; musicScene = scene; startMusic(); }
export function refreshMusic() { startMusic(); }
// For checking transitions from the console: window.__arena.audio.music()
export function musicState() { return { scene: musicScene, track: trackName(musicList?.[musicIndex]) || (pad ? '(generated pad)' : null), position: musicPlayer ? Number(musicPlayer.position().toFixed(3)) : null, pending: musicPending, level: Number(musicLevel().toFixed(2)) }; }

let lastSpoken = 0;
export function announce(text, priority = false) {
  if (!game.settings.announcer || !window.speechSynthesis) return;
  const nowMs = performance.now();
  if (!priority && nowMs - lastSpoken < 1200) return;
  lastSpoken = nowMs;
  if (priority) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find((v) => /en[-_]GB/i.test(v.lang) && /male|daniel|george/i.test(v.name)) || voices.find((v) => /^en/i.test(v.lang)) || null;
  utterance.rate = 1.02; utterance.pitch = 0.72; utterance.volume = Math.min(1, game.settings.volume * 0.9);
  speechSynthesis.speak(utterance);
}
