// Every sound in the game is synthesised here with WebAudio: no asset files.
// Positional sounds get HRTF panning, distance low-pass and speed-of-sound delay,
// so a far-off rifle crack arrives late and muffled — you can locate shooters by ear.
import { game } from './state.js';

let ctx = null;
let master = null;
let reverb = null;
let noiseBuffer = null;
let ambience = null;
const listener = { x: 0, y: 0, z: 0 };
const loops = new Map();

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = game.settings.volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.ratio.value = 8; limiter.attack.value = 0.002; limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  // Generated impulse response: an open yard with hard walls.
  const impulse = ctx.createBuffer(2, ctx.sampleRate * 1.8, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const ir = impulse.getChannelData(channel);
    for (let i = 0; i < ir.length; i += 1) ir[i] = (Math.random() * 2 - 1) * (1 - i / ir.length) ** 3.2;
  }
  reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(master);
  return ctx;
}

export function unlockAudio() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
}
export function setVolume(value) { if (master) master.gain.setTargetAtTime(value, ctx.currentTime, 0.05); }

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
function route({ pos = null, volume = 1, ref = 4, send = 0.2, maxDelay = 0.35 } = {}) {
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
    muffle.frequency.value = Math.max(700, 17000 / (1 + dist / 28));
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = ref; panner.rolloffFactor = 1.1; panner.maxDistance = 400;
    if (panner.positionX) { panner.positionX.value = pos[0]; panner.positionY.value = pos[1]; panner.positionZ.value = pos[2]; } else panner.setPosition(pos[0], pos[1], pos[2]);
    out.connect(muffle).connect(panner);
    tail = panner;
  }
  tail.connect(master);
  if (send > 0) { const bus = ctx.createGain(); bus.gain.value = send; tail.connect(bus).connect(reverb); }
  return { out, at, dist };
}

function noise(dest, at, { type = 'lowpass', freq = 1200, q = 0.8, attack = 0.002, decay = 0.2, gain = 1, sweepTo = null }) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.setValueAtTime(freq, at); filter.Q.value = q;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + decay);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  source.connect(filter).connect(amp).connect(dest);
  source.start(at, Math.random());
  source.stop(at + attack + decay + 0.05);
}

function tone(dest, at, { wave = 'sine', freq = 440, to = null, attack = 0.003, decay = 0.2, gain = 0.5 }) {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  osc.connect(amp).connect(dest);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

const SHOTS = {
  m44: { thump: [95, 38, 0.42, 1], crack: [2600, 0.09, 0.9], body: [900, 0.55, 0.9], ref: 14, send: 0.6 },
  recon: { thump: [120, 50, 0.22, 0.8], crack: [3000, 0.06, 0.8], body: [1300, 0.28, 0.7], ref: 11, send: 0.45 },
  talon: { thump: [140, 60, 0.13, 0.65], crack: [3200, 0.045, 0.7], body: [1500, 0.18, 0.6], ref: 10, send: 0.35 },
  wasp: { thump: [170, 80, 0.08, 0.5], crack: [3400, 0.035, 0.6], body: [1900, 0.11, 0.5], ref: 8, send: 0.25 },
  breaker: { thump: [80, 34, 0.36, 1], crack: [1800, 0.1, 0.9], body: [650, 0.5, 1], ref: 12, send: 0.55 },
  p9: { thump: [190, 70, 0.1, 0.6], crack: [3100, 0.04, 0.7], body: [1600, 0.16, 0.55], ref: 8, send: 0.3 },
  viper: { thump: [110, 44, 0.3, 0.9], crack: [2400, 0.07, 0.85], body: [1000, 0.4, 0.8], ref: 12, send: 0.5 },
};

const IMPACTS = {
  concrete: (out, at) => { noise(out, at, { freq: 900, decay: 0.12, gain: 0.7 }); noise(out, at, { type: 'highpass', freq: 3000, decay: 0.05, gain: 0.25 }); },
  metal: (out, at) => { const f = 1500 + Math.random() * 1500; tone(out, at, { freq: f, decay: 0.35, gain: 0.35 }); tone(out, at, { freq: f * 1.51, decay: 0.2, gain: 0.2 }); noise(out, at, { type: 'highpass', freq: 4000, decay: 0.04, gain: 0.4 }); },
  wood: (out, at) => { tone(out, at, { freq: 230, to: 120, decay: 0.09, gain: 0.6 }); noise(out, at, { freq: 1400, decay: 0.07, gain: 0.5 }); },
  glass: (out, at) => { noise(out, at, { type: 'highpass', freq: 5000, decay: 0.08, gain: 0.5 }); tone(out, at, { freq: 3800, decay: 0.12, gain: 0.2 }); },
  cloth: (out, at) => noise(out, at, { freq: 600, decay: 0.08, gain: 0.35 }),
  gravel: (out, at) => noise(out, at, { type: 'bandpass', freq: 1800, decay: 0.1, gain: 0.5 }),
  grass: (out, at) => noise(out, at, { freq: 500, decay: 0.09, gain: 0.4 }),
  energy: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 900, to: 200, decay: 0.18, gain: 0.3 }); noise(out, at, { type: 'bandpass', freq: 2400, decay: 0.1, gain: 0.3 }); },
  flesh: (out, at) => { noise(out, at, { freq: 700, decay: 0.1, gain: 0.7 }); tone(out, at, { freq: 150, to: 70, decay: 0.12, gain: 0.5 }); },
};

const click = (out, at, freq = 2200, gain = 0.4, decay = 0.03) => noise(out, at, { type: 'bandpass', freq, q: 3, decay, gain });

const SOUNDS = {
  dry: (out, at) => click(out, at, 1500, 0.4),
  bolt: (out, at) => { click(out, at, 1800, 0.5, 0.04); click(out, at + 0.16, 1200, 0.55, 0.05); click(out, at + 0.42, 1500, 0.55, 0.05); click(out, at + 0.55, 2400, 0.4, 0.03); },
  pump: (out, at) => { noise(out, at, { type: 'bandpass', freq: 900, q: 2, decay: 0.09, gain: 0.6 }); noise(out, at + 0.2, { type: 'bandpass', freq: 1300, q: 2, decay: 0.08, gain: 0.6 }); },
  reloadOut: (out, at) => { click(out, at, 1100, 0.5, 0.05); noise(out, at + 0.05, { freq: 500, decay: 0.12, gain: 0.25 }); },
  reloadIn: (out, at) => { click(out, at, 1700, 0.55, 0.04); click(out, at + 0.07, 900, 0.4, 0.05); },
  reloadDone: (out, at) => { click(out, at, 2000, 0.5, 0.03); click(out, at + 0.09, 2600, 0.45, 0.03); },
  equip: (out, at) => { noise(out, at, { type: 'bandpass', freq: 700, decay: 0.12, gain: 0.3 }); click(out, at + 0.1, 1900, 0.3); },
  scope: (out, at) => noise(out, at, { type: 'bandpass', freq: 500, sweepTo: 1600, decay: 0.12, gain: 0.18 }),
  swing: (out, at) => noise(out, at, { type: 'bandpass', freq: 900, sweepTo: 3000, q: 1.5, decay: 0.16, gain: 0.45 }),
  stab: (out, at) => { IMPACTS.flesh(out, at); tone(out, at, { freq: 2600, decay: 0.08, gain: 0.15 }); },
  hitmarker: (out, at) => { tone(out, at, { wave: 'square', freq: 1700, decay: 0.035, gain: 0.16 }); click(out, at, 3200, 0.3, 0.02); },
  headshot: (out, at) => { tone(out, at, { freq: 2350, decay: 0.3, gain: 0.3 }); tone(out, at, { freq: 3520, decay: 0.22, gain: 0.2 }); click(out, at, 4200, 0.5, 0.02); },
  kill: (out, at) => { tone(out, at, { wave: 'triangle', freq: 660, decay: 0.16, gain: 0.3 }); tone(out, at + 0.09, { wave: 'triangle', freq: 990, decay: 0.3, gain: 0.32 }); },
  hurt: (out, at) => { tone(out, at, { freq: 140, to: 60, decay: 0.2, gain: 0.8 }); noise(out, at, { freq: 800, decay: 0.12, gain: 0.5 }); },
  helmet: (out, at) => { tone(out, at, { freq: 1200, decay: 0.4, gain: 0.4 }); tone(out, at, { freq: 1830, decay: 0.3, gain: 0.25 }); },
  death: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 220, to: 40, decay: 0.9, gain: 0.35 }); noise(out, at, { freq: 400, decay: 0.7, gain: 0.3 }); },
  heartbeat: (out, at) => { tone(out, at, { freq: 62, decay: 0.12, gain: 0.7 }); tone(out, at + 0.19, { freq: 52, decay: 0.14, gain: 0.5 }); },
  whizz: (out, at) => noise(out, at, { type: 'bandpass', freq: 3200, sweepTo: 500, q: 4, decay: 0.2, gain: 0.9 }),
  glassBreak: (out, at) => { noise(out, at, { type: 'highpass', freq: 3500, decay: 0.35, gain: 0.8 }); for (let i = 0; i < 9; i += 1) tone(out, at + Math.random() * 0.3, { freq: 2200 + Math.random() * 4200, decay: 0.1 + Math.random() * 0.2, gain: 0.12 }); },
  land: (out, at) => noise(out, at, { freq: 300, decay: 0.12, gain: 0.5 }),
  jump: (out, at) => noise(out, at, { freq: 500, decay: 0.07, gain: 0.2 }),
  ui: (out, at) => tone(out, at, { wave: 'triangle', freq: 880, decay: 0.05, gain: 0.12 }),
  uiBack: (out, at) => tone(out, at, { wave: 'triangle', freq: 520, decay: 0.06, gain: 0.12 }),
  buy: (out, at) => { click(out, at, 2400, 0.4); tone(out, at + 0.03, { wave: 'triangle', freq: 1180, decay: 0.12, gain: 0.18 }); },
  deny: (out, at) => { tone(out, at, { wave: 'square', freq: 170, decay: 0.12, gain: 0.16 }); tone(out, at + 0.13, { wave: 'square', freq: 130, decay: 0.16, gain: 0.16 }); },
  ready: (out, at) => { tone(out, at, { wave: 'triangle', freq: 740, decay: 0.1, gain: 0.2 }); tone(out, at + 0.1, { wave: 'triangle', freq: 1110, decay: 0.2, gain: 0.2 }); },
  tick: (out, at) => tone(out, at, { wave: 'square', freq: 1000, decay: 0.05, gain: 0.12 }),
  tickFinal: (out, at) => tone(out, at, { wave: 'square', freq: 1500, decay: 0.3, gain: 0.16 }),
  roundStart: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 110, to: 220, decay: 0.7, gain: 0.22 }); tone(out, at + 0.5, { wave: 'triangle', freq: 660, decay: 0.5, gain: 0.25 }); tone(out, at + 0.5, { wave: 'triangle', freq: 990, decay: 0.6, gain: 0.18 }); },
  roundWin: (out, at) => [523, 659, 784, 1047].forEach((f, i) => tone(out, at + i * 0.11, { wave: 'triangle', freq: f, decay: 0.5, gain: 0.22 })),
  roundLoss: (out, at) => [440, 370, 311, 220].forEach((f, i) => tone(out, at + i * 0.15, { wave: 'triangle', freq: f, decay: 0.6, gain: 0.2 })),
  matchWin: (out, at) => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { tone(out, at + i * 0.13, { wave: 'triangle', freq: f, decay: 0.9, gain: 0.22 }); tone(out, at + i * 0.13, { wave: 'sine', freq: f / 2, decay: 0.9, gain: 0.15 }); }),
  matchLoss: (out, at) => [392, 349, 294, 233, 196].forEach((f, i) => tone(out, at + i * 0.2, { wave: 'triangle', freq: f, decay: 0.9, gain: 0.2 })),
  overtime: (out, at) => { for (let i = 0; i < 3; i += 1) tone(out, at + i * 0.32, { wave: 'sawtooth', freq: 440, to: 880, decay: 0.26, gain: 0.16 }); },
  clutch: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 82, decay: 1.4, gain: 0.3 }); tone(out, at, { wave: 'sawtooth', freq: 123, decay: 1.4, gain: 0.2 }); },
  pulse: (out, at) => { tone(out, at, { freq: 300, to: 2400, decay: 0.6, gain: 0.3 }); tone(out, at + 0.55, { freq: 1800, decay: 0.5, gain: 0.25 }); },
  marked: (out, at) => { tone(out, at, { wave: 'square', freq: 1320, decay: 0.07, gain: 0.12 }); tone(out, at + 0.1, { wave: 'square', freq: 1320, decay: 0.07, gain: 0.12 }); },
  shield: (out, at) => { noise(out, at, { type: 'bandpass', freq: 400, sweepTo: 2600, decay: 0.3, gain: 0.5 }); tone(out, at + 0.25, { wave: 'sawtooth', freq: 180, decay: 0.5, gain: 0.2 }); },
  shieldBreak: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 700, to: 80, decay: 0.5, gain: 0.35 }); SOUNDS.glassBreak(out, at); },
  decoy: (out, at) => { for (let i = 0; i < 5; i += 1) tone(out, at + i * 0.05, { freq: 900 + i * 320, decay: 0.12, gain: 0.12 }); },
  decoyPop: (out, at) => { tone(out, at, { wave: 'square', freq: 1400, to: 200, decay: 0.25, gain: 0.2 }); noise(out, at, { type: 'highpass', freq: 3000, decay: 0.15, gain: 0.3 }); },
  stim: (out, at) => { noise(out, at, { type: 'highpass', freq: 5000, decay: 0.4, gain: 0.3 }); tone(out, at + 0.2, { freq: 440, to: 880, decay: 0.6, gain: 0.12 }); },
  ghost: (out, at) => noise(out, at, { type: 'bandpass', freq: 2000, sweepTo: 200, decay: 0.7, gain: 0.3 }),
  droneDown: (out, at) => { tone(out, at, { wave: 'sawtooth', freq: 320, to: 60, decay: 0.5, gain: 0.3 }); noise(out, at, { freq: 1500, decay: 0.3, gain: 0.4 }); },
  ping: (out, at) => { tone(out, at, { freq: 1500, decay: 0.12, gain: 0.18 }); tone(out, at + 0.08, { freq: 2000, decay: 0.2, gain: 0.16 }); },
  chat: (out, at) => tone(out, at, { freq: 1240, decay: 0.06, gain: 0.08 }),
  thunder: (out, at) => { noise(out, at, { freq: 140, decay: 3.5, gain: 1, attack: 0.05 }); noise(out, at + 0.1, { freq: 600, decay: 0.8, gain: 0.5 }); },
  xp: (out, at) => [784, 988, 1175].forEach((f, i) => tone(out, at + i * 0.07, { wave: 'triangle', freq: f, decay: 0.25, gain: 0.15 })),
};

export function play(name, options = {}) {
  if (!ensure() || ctx.state !== 'running') return;
  const make = SOUNDS[name];
  if (!make) return;
  const { out, at } = route({ send: 0.12, ...options });
  make(out, at + (options.delay || 0));
}

export function playShot(weaponId, pos = null, volume = 1) {
  if (!ensure() || ctx.state !== 'running') return;
  const spec = SHOTS[weaponId] || SHOTS.p9;
  const { out, at, dist } = route({ pos, volume: volume * (pos ? 1.6 : 0.9), ref: spec.ref, send: spec.send });
  const [f0, f1, thumpDecay, thumpGain] = spec.thump;
  tone(out, at, { freq: f0, to: f1, decay: thumpDecay, gain: thumpGain });
  noise(out, at, { type: 'highpass', freq: spec.crack[0], decay: spec.crack[1], gain: spec.crack[2] * (dist > 60 ? 0.4 : 1) });
  noise(out, at, { freq: spec.body[0], sweepTo: spec.body[0] / 3, decay: spec.body[1], gain: spec.body[2] });
}

export function playImpact(material, pos, volume = 0.8) {
  if (!ensure() || ctx.state !== 'running') return;
  const make = IMPACTS[material] || IMPACTS.concrete;
  const { out, at } = route({ pos, volume, ref: 3, send: 0.15 });
  make(out, at);
}

export function playFootstep(surface, pos = null, volume = 0.5) {
  if (!ensure() || ctx.state !== 'running') return;
  const { out, at } = route({ pos, volume: pos ? volume * 1.8 : volume * 0.5, ref: 2.5, send: surface === 'metal' ? 0.3 : 0.1, maxDelay: 0.1 });
  if (surface === 'metal') { tone(out, at, { freq: 320 + Math.random() * 80, decay: 0.12, gain: 0.3 }); noise(out, at, { type: 'bandpass', freq: 1800, decay: 0.05, gain: 0.35 }); } else if (surface === 'gravel' || surface === 'grass') noise(out, at, { type: 'bandpass', freq: 1500 + Math.random() * 600, q: 0.7, decay: 0.11, gain: 0.5 });
  else if (surface === 'wood') { tone(out, at, { freq: 170, to: 100, decay: 0.08, gain: 0.5 }); noise(out, at, { freq: 900, decay: 0.05, gain: 0.3 }); } else { noise(out, at, { freq: 420 + Math.random() * 160, decay: 0.08, gain: 0.7 }); noise(out, at, { type: 'highpass', freq: 2500, decay: 0.03, gain: 0.12 }); }
}

// Continuous sounds (drone motor, shield hum). Returns a handle with move()/stop().
export function startLoop(key, kind, pos = null) {
  if (!ensure() || ctx.state !== 'running' || loops.has(key)) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  let panner = null;
  if (pos) {
    panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3; panner.rolloffFactor = 1.4;
    out.connect(panner).connect(master);
  } else out.connect(master);
  const nodes = [];
  if (kind === 'drone') {
    [138, 277, 415].forEach((freq, i) => { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq + Math.random() * 4; const g = ctx.createGain(); g.gain.value = 0.12 / (i + 1); osc.connect(g).connect(out); osc.start(); nodes.push(osc); });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 31; const depth = ctx.createGain(); depth.gain.value = 0.35; lfo.connect(depth).connect(out.gain); lfo.start(); nodes.push(lfo);
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

// Wind / rain / night hum beds.
export function setAmbience(variant) {
  if (!ensure()) return;
  if (ambience) { const old = ambience; old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5); setTimeout(() => { old.sources.forEach((s) => s.stop()); }, 2500); ambience = null; }
  if (!variant) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const sources = [];
  const bed = (type, freq, q, level, lfoRate) => {
    const source = ctx.createBufferSource(); source.buffer = noiseBuffer; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const amp = ctx.createGain(); amp.gain.value = level;
    if (lfoRate) { const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate; const depth = ctx.createGain(); depth.gain.value = level * 0.6; lfo.connect(depth).connect(amp.gain); lfo.start(); sources.push(lfo); }
    source.connect(filter).connect(amp).connect(gain); source.start(0, Math.random());
    sources.push(source);
  };
  bed('lowpass', variant === 'storm' ? 500 : 320, 0.5, variant === 'storm' ? 0.2 : 0.09, 0.13);
  if (variant === 'storm') { bed('highpass', 2600, 0.3, 0.1, 0); bed('bandpass', 1200, 0.4, 0.07, 0.31); }
  if (variant === 'night') { const hum = ctx.createOscillator(); hum.frequency.value = 55; const g = ctx.createGain(); g.gain.value = 0.035; hum.connect(g).connect(gain); hum.start(); sources.push(hum); }
  gain.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
  ambience = { gain, sources, base: 1 };
}
// Rain and wind fall away when you step under a roof or into the underpass.
export function setAmbienceShelter(amount) { if (ambience) ambience.gain.gain.setTargetAtTime(1 - amount * 0.65, ctx.currentTime, 0.4); }

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
