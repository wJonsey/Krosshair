// Custom crosshair: a centre dot plus inner and outer line sets, each with its own length, thickness,
// offset and opacity, an optional outline, and a shareable code. Drawn with plain elements so the HUD,
// the editor preview and the presets all use the same markup.
import { game } from './state.js';

export const DEFAULT_CROSSHAIR = {
  color: '#e6edf1',
  outline: { on: true, opacity: 0.6, thickness: 1 },
  dot: { on: true, size: 2, opacity: 1 },
  inner: { on: true, opacity: 1, length: 7, thickness: 1, offset: 4 },
  outer: { on: false, opacity: 0.4, length: 3, thickness: 2, offset: 14 },
  dynamic: true, // lines open up with movement and recoil
  tee: false,    // drop the top line
};
export const CROSSHAIR_PRESETS = [
  ['Krosshair', DEFAULT_CROSSHAIR],
  ['Dot', { ...DEFAULT_CROSSHAIR, color: '#6ce6d1', dot: { on: true, size: 4, opacity: 1 }, inner: { ...DEFAULT_CROSSHAIR.inner, on: false }, dynamic: false }],
  ['Small cross', { ...DEFAULT_CROSSHAIR, color: '#00ff66', dot: { on: false, size: 2, opacity: 1 }, inner: { on: true, opacity: 1, length: 4, thickness: 2, offset: 2 }, dynamic: false }],
  ['Classic', { ...DEFAULT_CROSSHAIR, color: '#ffffff', dot: { on: false, size: 2, opacity: 1 }, inner: { on: true, opacity: 1, length: 8, thickness: 2, offset: 5 }, outer: { on: true, opacity: 0.35, length: 2, thickness: 2, offset: 16 } }],
  ['Tee', { ...DEFAULT_CROSSHAIR, color: '#ffb547', tee: true, inner: { on: true, opacity: 1, length: 6, thickness: 2, offset: 3 } }],
  ['Box', { ...DEFAULT_CROSSHAIR, color: '#ff5a4e', dot: { on: false, size: 2, opacity: 1 }, inner: { on: true, opacity: 1, length: 2, thickness: 6, offset: 4 }, dynamic: false }],
];
export const CROSSHAIR_COLORS = ['#e6edf1', '#ffffff', '#00ff66', '#6ce6d1', '#ffee00', '#ffb547', '#ff5a4e', '#ff4fd8', '#4fb3ff'];

const clampNum = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback);
const LIMITS = { opacity: [0, 1], thickness: [1, 10], length: [0, 30], offset: [0, 40], size: [1, 12] };
// Anything from storage or a pasted code goes through here, so a bad value can never break the HUD.
export function cleanCrosshair(raw) {
  const d = DEFAULT_CROSSHAIR, c = raw && typeof raw === 'object' ? raw : {};
  const group = (key) => {
    const out = {};
    for (const [field, fallback] of Object.entries(d[key])) out[field] = field === 'on' ? Boolean(c[key]?.on ?? fallback) : clampNum(c[key]?.[field], ...LIMITS[field], fallback);
    return out;
  };
  return { color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : d.color, outline: group('outline'), dot: group('dot'), inner: group('inner'), outer: group('outer'), dynamic: Boolean(c.dynamic ?? d.dynamic), tee: Boolean(c.tee ?? d.tee) };
}
export const currentCrosshair = () => cleanCrosshair(game.settings.crosshair || DEFAULT_CROSSHAIR);

// Share codes: K1;c=e6edf1;ol=1,0.6,1;d=1,2,1;i=1,1,7,1,4;o=0,0.4,3,2,14;dy=1;t=0
export function crosshairCode(c) {
  const n = (value) => String(Math.round(value * 100) / 100);
  const lines = (g) => [g.on ? 1 : 0, n(g.opacity), n(g.length), n(g.thickness), n(g.offset)].join(',');
  return ['K1', `c=${c.color.slice(1)}`, `ol=${[c.outline.on ? 1 : 0, n(c.outline.opacity), n(c.outline.thickness)].join(',')}`, `d=${[c.dot.on ? 1 : 0, n(c.dot.size), n(c.dot.opacity)].join(',')}`, `i=${lines(c.inner)}`, `o=${lines(c.outer)}`, `dy=${c.dynamic ? 1 : 0}`, `t=${c.tee ? 1 : 0}`].join(';');
}
export function crosshairFromCode(text) {
  const parts = String(text).trim().split(';');
  if (parts.shift() !== 'K1') return null;
  const f = Object.fromEntries(parts.map((part) => part.split('=')).filter((pair) => pair.length === 2));
  const list = (key) => (f[key] || '').split(',');
  const lines = (key) => { const [on, opacity, length, thickness, offset] = list(key); return { on: on === '1', opacity, length, thickness, offset }; };
  const [olOn, olOpacity, olThickness] = list('ol'), [dOn, dSize, dOpacity] = list('d');
  return cleanCrosshair({ color: `#${f.c}`, outline: { on: olOn === '1', opacity: olOpacity, thickness: olThickness }, dot: { on: dOn === '1', size: dSize, opacity: dOpacity }, inner: lines('i'), outer: lines('o'), dynamic: f.dy === '1', tee: f.t === '1' });
}

// Lines sit `offset` px from the centre plus --spread, which the HUD drives when the crosshair is dynamic.
export function crosshairHtml(raw) {
  const c = cleanCrosshair(raw);
  const edge = c.outline.on ? `box-shadow:0 0 0 ${c.outline.thickness}px rgba(0,0,0,${c.outline.opacity});` : '';
  const set = (g, name) => {
    if (!g.on || g.length === 0) return '';
    const gap = `calc(${g.offset}px + var(--spread, 0px))`, half = g.thickness / 2;
    const base = `position:absolute;background:${c.color};opacity:${g.opacity};${edge}`;
    const vertical = `${base}width:${g.thickness}px;height:${g.length}px;left:${-half}px;`, horizontal = `${base}height:${g.thickness}px;width:${g.length}px;top:${-half}px;`;
    return `${c.tee ? '' : `<i class="xl ${name}" style="${vertical}bottom:${gap}"></i>`}<i class="xl ${name}" style="${vertical}top:${gap}"></i><i class="xl ${name}" style="${horizontal}right:${gap}"></i><i class="xl ${name}" style="${horizontal}left:${gap}"></i>`;
  };
  const dot = `<b class="xd" style="position:absolute;left:${-c.dot.size / 2}px;top:${-c.dot.size / 2}px;width:${c.dot.size}px;height:${c.dot.size}px;background:${c.color};opacity:${c.dot.opacity};${edge}${c.dot.on ? '' : 'display:none;'}"></b>`;
  return `${set(c.outer, 'outer')}${set(c.inner, 'inner')}${dot}`;
}
