// What every wall, floor and prop on every map is made of. A map is boxes; this is what makes a box
// read as brick, poured concrete, old plaster, a wet road or a crate. Nothing here is a picture: each
// surface is worked out per pixel from where the pixel is in the world, so it never repeats, never
// stretches and costs no downloads. Each pattern gives three things: colour, a height (which lights as
// real relief: mortar sits back, planks have gaps, corrugated iron has ribs) and how rough or shiny it is.
// On top of the pattern every box gets what real objects have: worn, slightly rounded edges, dirt where
// it meets the ground and streaks running down from its top.
import * as THREE from 'three';
import { MATERIALS } from '../shared/constants.js';

export const PATTERNS = {
  noise: 0, panels: 1, bricks: 2, planks: 3, ribs: 4, tiles: 5, stripes: 6, windows: 7, strata: 8, asphalt: 9, plaster: 10, ashlar: 11,
  grass: 12, gravel: 13, sand: 14, snow: 15, marble: 16, cobble: 17, crate: 18, foliage: 19, plates: 20, bags: 21, ice: 22, water: 23, brushed: 24,
};
// Per pattern: how chipped its edges get, how much dirt it holds, and how wide the rounded edge is (m).
const WEAR = {
  default: { edge: 0.5, grime: 0.6, bevel: 0.016 },
  panels: { edge: 0.55, grime: 0.75, bevel: 0.02 }, bricks: { edge: 0.35, grime: 0.6, bevel: 0.012 }, plaster: { edge: 0.5, grime: 0.8, bevel: 0.02 }, ashlar: { edge: 0.4, grime: 0.6, bevel: 0.022 },
  planks: { edge: 0.4, grime: 0.4, bevel: 0.01 }, crate: { edge: 0.45, grime: 0.3, bevel: 0.012 }, ribs: { edge: 0.8, grime: 0.55, bevel: 0.012 }, plates: { edge: 0.8, grime: 0.5, bevel: 0.014 }, brushed: { edge: 0.7, grime: 0.3, bevel: 0.012 },
  tiles: { edge: 0.25, grime: 0.2, bevel: 0.012 }, marble: { edge: 0.15, grime: 0.1, bevel: 0.01 }, cobble: { edge: 0.1, grime: 0.2, bevel: 0.02 }, asphalt: { edge: 0.15, grime: 0, bevel: 0.015 }, strata: { edge: 0.3, grime: 0.3, bevel: 0.05 },
  bags: { edge: 0, grime: 0.4, bevel: 0.05 }, foliage: { edge: 0, grime: 0, bevel: 0.09 }, snow: { edge: 0, grime: 0, bevel: 0.07 }, ice: { edge: 0.5, grime: 0, bevel: 0.02 },
  grass: { edge: 0, grime: 0, bevel: 0.04 }, gravel: { edge: 0, grime: 0, bevel: 0.03 }, sand: { edge: 0, grime: 0, bevel: 0.05 }, water: { edge: 0, grime: 0, bevel: 0 }, stripes: { edge: 0, grime: 0.2, bevel: 0.006 }, windows: { edge: 0, grime: 0, bevel: 0 },
};
// One clock for everything that moves (water).
export const SURFACE_TIME = { value: 0 };
// 1 while the world is being drawn into a linear buffer (bloom, the scope, reflections) instead of straight
// to the screen: colours that were picked as display values are handed over as light instead.
export const LINEAR_OUT = { value: 0 };
export const EXPOSURE = { value: 1 };
// A display colour taken back to the light that tone maps to it: the screen curve undone, then the film
// curve (ACES, as three.js applies it) solved backwards. Lets a colour chosen by eye sit in a linear picture.
export const TO_LIGHT = `uniform float uExposure;
vec3 toLight(vec3 c) {
  c = clamp(c, 0.0, 0.985);
  c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  c = mat3(0.64304, 0.05927, 0.00596, 0.31119, 0.93144, 0.06393, 0.04578, 0.00929, 0.93012) * c;
  c = clamp(c, 0.0, 0.985);
  vec3 qa = 1.0 - 0.983729 * c, qb = 0.0245786 - 0.432951 * c, qc = -(0.000090537 + 0.238081 * c);
  c = (-qb + sqrt(max(qb * qb - 4.0 * qa * qc, 0.0))) / (2.0 * qa);
  c = mat3(1.76474, -0.14703, -0.03634, -0.67578, 1.16025, -0.16244, -0.08896, -0.01322, 1.19877) * c;
  return max(c, 0.0) * 0.6 / max(uExposure, 0.05);
}
// And the way forward again: light to the colour it will be shown as.
vec3 toShown(vec3 c) {
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * (c * uExposure / 0.6);
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.432951) + 0.238081);
  c = clamp(mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

export const NOISE_GLSL = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.15; }
// A scatter of points, one per grid cell: x is the distance to the nearest, y is a number that belongs to it.
vec2 cells(vec2 p) { vec2 i = floor(p), f = fract(p); float best = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = vec2(h21(i + g), h21(i + g + 17.3)); float d = length(g + o - f); if (d < best) { best = d; id = h21(i + g + 3.1); } }
  return vec2(best, id); }
// How much of a pattern at this frequency still fits on screen. Detail finer than a pixel is dropped
// instead of drawn, which is what stops distant walls and floors crawling as you move.
float aaFade(float px, float freq) { return 1.0 - smoothstep(0.3, 0.9, px * freq); }
// A thin line where v crosses 0.5, w wide: cracks, veins.
float lineAt(float v, float w) { return 1.0 - smoothstep(0.0, w, abs(v - 0.5)); }
`;

const VERTEX_HEAD = '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec3 vBox;\nvarying vec3 vHalf;';
const VERTEX_BODY = `#include <begin_vertex>
  vec4 wpos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpos = instanceMatrix * wpos;
    vec3 bsize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #else
    vec3 bsize = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  #endif
  wpos = modelMatrix * wpos;
  vWPos = wpos.xyz;
  vWNrm = normal;
  // The box this vertex belongs to, in metres from its centre, and half its size: the fragment shader
  // uses them to find edges, the foot and the top of every box.
  vHalf = bsize * 0.5;
  vBox = position * bsize;`;

const FRAGMENT_HEAD = `#include <common>
varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vBox; varying vec3 vHalf;
uniform float uWindowGlow; uniform float uHaze; uniform vec3 uHazeColor; uniform float uTime; uniform float uLinearOut;
${TO_LIGHT}
uniform float uEdge; uniform float uGrime; uniform float uBevel;
${NOISE_GLSL}`;

const FRAGMENT_COLOR = `#include <color_fragment>
  vec3 an = abs(vWNrm);
  vec2 suv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
  float px = max(fwidth(suv.x), fwidth(suv.y));
  float fMid = aaFade(px, 6.1), fFine = aaFade(px, 23.0), fLine = aaFade(px, 3.0), fTiny = aaFade(px, 70.0);
  float n1 = vnoise(suv * 1.3), n6 = vnoise(suv * 6.1), n23 = vnoise(suv * 23.0);
  // Faded detail hands its share back as flat mid grey, so nothing gets darker or lighter with range.
  float grain = n1 * 0.55 + mix(0.5, n6, fMid) * 0.3 + mix(0.5, n23, fFine) * 0.15;
  float shade = mix(0.8, 1.08, grain);
  float glow = 0.0;
  float sHeight = (n23 - 0.5) * 0.0012 * fFine;   // relief in metres; lit as a bump further down
  float sRough = 0.0;                              // added to the material's roughness
  float sMetal = 1.0;                              // multiplies its metalness (rust is not metal)
  float wallFace = 1.0 - an.y;
  // This box, in metres: this face's own 2D coordinates, its half size, and from those how far the
  // pixel is from the nearest edge of the face, from the foot of the box and from its top.
  vec2 fl = an.y > 0.5 ? vBox.xz : (an.x > 0.5 ? vBox.zy : vBox.xy);
  vec2 fh = an.y > 0.5 ? vHalf.xz : (an.x > 0.5 ? vHalf.zy : vHalf.xy);
  float edge = min(fh.x - abs(fl.x), fh.y - abs(fl.y));
  float up = vBox.y + vHalf.y, down = vHalf.y - vBox.y;
  #if PATTERN == 1
    // Poured concrete: formwork panels, the tie holes the forms leave, rain stains.
    vec2 cell = suv / vec2(2.4, 1.2);
    vec2 ce = (0.5 - abs(fract(cell) - 0.5)) * vec2(2.4, 1.2);
    float seam = (1.0 - smoothstep(0.004, 0.014, min(ce.x, ce.y))) * fLine;
    shade *= 1.0 - 0.3 * seam; sHeight -= seam * 0.004;
    shade *= 0.93 + 0.13 * h21(floor(cell));
    vec2 tie = (fract(cell * 2.0) - 0.5) * vec2(1.2, 0.6);
    float hole = (1.0 - smoothstep(0.016, 0.03, length(tie))) * aaFade(px, 14.0);
    shade *= 1.0 - 0.45 * hole; sHeight -= hole * 0.006;
    float stain = mix(smoothstep(0.6, 0.95, fbm(suv * 0.35)), smoothstep(0.55, 0.92, vnoise(vec2(suv.x * 1.7, suv.y * 0.16))), wallFace);
    shade *= 1.0 - 0.15 * stain;
    // Pitting: small air holes in the pour.
    float pit = step(0.9, h21(floor(suv * 55.0))) * fTiny;
    shade *= 1.0 - 0.18 * pit;
  #elif PATTERN == 2
    // Brickwork: staggered courses, recessed mortar, every brick fired a little differently.
    vec2 bs = vec2(0.36, 0.12);
    vec2 b = suv / bs;
    b.x += step(1.0, mod(b.y, 2.0)) * 0.5;
    vec2 bd = (0.5 - abs(fract(b) - 0.5)) * bs;
    float mortar = 1.0 - smoothstep(0.005, 0.013, min(bd.x, bd.y));
    float bid = h21(floor(b)), bid2 = h21(floor(b) + 31.7);
    float fBrick = aaFade(px, 7.0);
    shade *= mix(1.0, 0.8 + 0.36 * bid, fBrick);
    shade *= mix(1.0, 1.0 - 0.3 * step(0.9, bid2), fBrick);                 // the odd over-burnt brick
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.33, 0.3), mortar * 0.8 * fBrick);
    sHeight += (-mortar * 0.007 + (vnoise(suv * 34.0) - 0.5) * 0.0025 * (1.0 - mortar)) * fBrick;
    sRough += mortar * 0.05;
  #elif PATTERN == 3 || PATTERN == 18
    // Boards: each one its own tone, grain running along it, gaps between, end joints, the odd knot.
    float across = an.y > 0.5 ? suv.x : suv.y, along = an.y > 0.5 ? suv.y : suv.x;
    float pl = across / 0.19, pid = floor(pl), pf = fract(pl) - 0.5;
    float lj = (along + h21(vec2(pid, 5.0)) * 2.4) / 2.4;
    float gap = max(smoothstep(0.455, 0.5, abs(pf)), smoothstep(0.4965, 0.5, abs(fract(lj) - 0.5)));
    float boardId = h21(vec2(pid, floor(lj)));
    float fBoard = aaFade(px, 4.5);
    shade *= mix(1.0, 0.8 + 0.36 * boardId, fBoard);
    float g = vnoise(vec2(along * 2.4 + boardId * 37.0, across * 52.0));
    float rings = vnoise(vec2(along * 0.7 + boardId * 11.0, across * 150.0));
    shade *= 0.9 + 0.2 * mix(0.5, g, fFine) + 0.08 * (mix(0.5, rings, fTiny) - 0.5);
    vec2 kn = vec2((fract(lj) - (0.2 + 0.6 * h21(vec2(pid, floor(lj) + 9.0)))) * 2.4, pf * 0.19);
    float knot = (1.0 - smoothstep(0.012, 0.034, length(kn * vec2(0.6, 1.0)))) * step(0.62, h21(vec2(pid + 3.0, floor(lj)))) * fFine;
    shade *= 1.0 - 0.42 * knot;
    shade *= 1.0 - 0.5 * fBoard * gap;
    sHeight += (-gap * 0.006 + (g - 0.5) * 0.0018) * fBoard;
    #if PATTERN == 18
      // A crate: a frame of battens round every face and a brace across the sides, standing proud.
      float frame = 1.0 - smoothstep(0.086, 0.094, edge);
      vec2 dn = normalize(vec2(fh.y, -fh.x));
      float brace = (1.0 - smoothstep(0.05, 0.058, abs(dot(fl, dn)))) * wallFace;
      float proud = max(frame, brace);
      float lip = (smoothstep(0.078, 0.086, edge) - smoothstep(0.094, 0.102, edge)) + (smoothstep(0.042, 0.05, abs(dot(fl, dn))) - smoothstep(0.058, 0.066, abs(dot(fl, dn)))) * wallFace * (1.0 - frame);
      shade *= mix(0.84, 1.1, proud) * (1.0 - 0.3 * clamp(lip, 0.0, 1.0) * fLine);
      sHeight += proud * 0.012;
      // Nail heads at the corners of the frame.
      vec2 corner = fh - abs(fl) - 0.045;
      float nail = (1.0 - smoothstep(0.008, 0.014, length(corner))) * fFine;
      shade *= 1.0 - 0.5 * nail;
    #endif
  #elif PATTERN == 4
    // Corrugated steel: real ribs, paint worn through to rust, streaks running down from the top.
    float fRib = aaFade(px, 5.0);
    float corr = sin(suv.x * 31.4);
    shade *= 0.9 + 0.1 * corr * fRib;
    sHeight += corr * 0.011 * fRib;
    float worn = smoothstep(0.66, 0.9, fbm(suv * 0.9 + 11.0));
    float drip = wallFace * smoothstep(0.62, 0.92, vnoise(vec2(suv.x * 2.9, 3.0))) * exp(-down * 1.1);
    float rusty = clamp(worn * 0.7 + drip * 0.6, 0.0, 1.0);
    // Rust shows as a stain on the paint, darker on dark paint: never brighter than the metal it is on.
    vec3 rustCol = mix(diffuseColor.rgb, vec3(0.34, 0.19, 0.11), 0.75) * (0.75 + 0.3 * n6);
    diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, rusty * 0.5);
    sRough += rusty * 0.3; sMetal *= 1.0 - rusty * 0.7;
    shade *= 1.0 - 0.2 * vnoise(suv * 0.7) * step(0.55, vnoise(suv * 2.3));
  #elif PATTERN == 20
    // Plate steel: welded sheets, a row of rivets inside every seam, scuffs.
    vec2 pc = suv / vec2(1.6, 1.0);
    vec2 pe = (0.5 - abs(fract(pc) - 0.5)) * vec2(1.6, 1.0);
    float pseam = (1.0 - smoothstep(0.003, 0.011, min(pe.x, pe.y))) * fLine;
    shade *= 1.0 - 0.35 * pseam; sHeight -= pseam * 0.003;
    shade *= 0.95 + 0.1 * h21(floor(pc));
    float nearSeam = 1.0 - smoothstep(0.012, 0.022, min(abs(pe.x - 0.05), abs(pe.y - 0.05)));
    float rivet = (1.0 - smoothstep(0.011, 0.019, length((fract(suv / 0.2) - 0.5) * 0.2))) * nearSeam * aaFade(px, 12.0);
    shade *= 1.0 + 0.3 * rivet; sHeight += rivet * 0.004;
    float scuff = smoothstep(0.62, 0.9, fbm(suv * vec2(0.7, 2.6) + 4.0));
    shade *= 1.0 - 0.14 * scuff; sRough += scuff * 0.2;
  #elif PATTERN == 24
    // Cast or brushed metal: fine drawn grain, a soft patina.
    float brush = vnoise(vec2(suv.x * 3.0, suv.y * 90.0));
    shade *= 0.92 + 0.14 * mix(0.5, brush, fFine);
    float patina = smoothstep(0.55, 0.9, fbm(suv * 1.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 1.05, 0.95), patina * 0.35);
    sRough += patina * 0.25;
  #elif PATTERN == 5
    // Paving slabs: grout lines, each slab its own tone, the odd cracked one, moss in the joints.
    vec2 t = suv / 0.75;
    vec2 td = (0.5 - abs(fract(t) - 0.5)) * 0.75;
    float grout = (1.0 - smoothstep(0.005, 0.016, min(td.x, td.y))) * fLine;
    float tid = h21(floor(t));
    shade *= 0.9 + 0.2 * tid;
    shade *= 1.0 - 0.42 * grout; sHeight -= grout * 0.005;
    // A cracked slab breaks once, edge to edge, along a line that wanders a little.
    float cx = (fract(t).x - 0.5) + (vnoise(vec2(suv.y * 3.2, tid * 31.0)) - 0.5) * 0.4 + (tid - 0.9) * 2.0;
    float crack = (1.0 - smoothstep(0.004, 0.016, abs(cx))) * step(0.86, tid) * fMid;
    shade *= 1.0 - 0.35 * crack; sHeight -= crack * 0.002;
    float moss = grout * smoothstep(0.5, 0.8, vnoise(suv * 0.5 + 8.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.28, 0.14), moss * 0.6);
  #elif PATTERN == 16
    // Polished marble: veins that wander, fine joints, a floor you can see the light in.
    vec2 mt = suv / 1.2;
    vec2 md = (0.5 - abs(fract(mt) - 0.5)) * 1.2;
    float mj = (1.0 - smoothstep(0.002, 0.007, min(md.x, md.y))) * fLine;
    // Veins run one way across the stone and wander: a sine bent by noise, sharpened to a line.
    float warp = fbm(suv * 0.7);
    float v1 = sin((suv.x * 0.8 + suv.y * 0.45) * 2.4 + warp * 9.0), v2 = sin((suv.x * 0.3 - suv.y * 0.9) * 5.2 + warp * 13.0 + 2.0);
    float vein = pow(1.0 - abs(v1), 9.0) * 0.85 + pow(1.0 - abs(v2), 14.0) * 0.4;
    shade *= 0.95 + 0.1 * warp;
    shade *= 1.0 - 0.3 * clamp(vein, 0.0, 1.0) * fMid;
    shade *= 0.96 + 0.08 * h21(floor(mt));
    shade *= 1.0 - 0.3 * mj;
    sRough -= 0.12 - 0.1 * clamp(vein, 0.0, 1.0);
  #elif PATTERN == 17
    // Cobbles: rounded setts packed tight, dark in the gaps.
    #if DETAIL == 1
      vec2 cb = cells(suv / 0.17);
      float sett = 1.0 - smoothstep(0.22, 0.5, cb.x);
      float fCob = aaFade(px, 9.0);
      shade *= mix(1.0, (0.62 + 0.5 * sett) * (0.85 + 0.3 * cb.y), fCob);
      sHeight += sett * 0.014 * fCob;
      sRough -= sett * 0.1;
    #else
      shade *= 0.9 + 0.2 * h21(floor(suv / 0.17));
    #endif
  #elif PATTERN == 9
    // Asphalt: aggregate in tar, cracks, darker patch repairs, the odd slick of oil.
    float agg = vnoise(suv * 44.0);
    shade *= 0.9 + 0.2 * mix(0.5, agg, fTiny);
    float fleck = step(0.9, h21(floor(suv * 70.0))) * fTiny;
    shade *= 1.0 + 0.3 * fleck;
    float crackZone = smoothstep(0.5, 0.7, vnoise(suv * 0.13 + 2.0));
    float crack = lineAt(fbm(suv * 0.55 + 6.0), 0.012) * crackZone * fMid;
    shade *= 1.0 - 0.5 * crack; sHeight -= crack * 0.004;
    vec2 pq = suv / vec2(5.5, 3.5);
    vec2 pd = 0.5 - abs(fract(pq) - 0.5);
    float repair = step(0.84, h21(floor(pq))) * smoothstep(0.0, 0.03, min(pd.x, pd.y));
    shade *= 1.0 - 0.16 * repair;
    float oil = smoothstep(0.66, 0.9, fbm(suv * 0.22 + 5.0));
    sRough -= 0.42 * oil; shade *= 1.0 - 0.14 * oil;
    sHeight += (agg - 0.5) * 0.002 * fTiny;
  #elif PATTERN == 10
    // Old render: trowel mottling, hairline cracks, damp at the foot, and here and there a patch that
    // has fallen away to show the brick behind.
    float mottle = fbm(suv * 0.8);
    shade *= 0.9 + 0.18 * mottle;
    float crackMask = smoothstep(0.5, 0.72, vnoise(suv * 0.28 + 9.0));
    float hair = lineAt(fbm(suv * 1.15 + 3.0), 0.011) * crackMask * fMid;
    shade *= 1.0 - 0.36 * hair; sHeight -= hair * 0.002;
    float bare = smoothstep(0.76, 0.8, fbm(suv * 0.42 + 20.0)) * wallFace * aaFade(px, 2.0);
    vec2 pb = suv / vec2(0.36, 0.12);
    pb.x += step(1.0, mod(pb.y, 2.0)) * 0.5;
    vec2 pbd = (0.5 - abs(fract(pb) - 0.5)) * vec2(0.36, 0.12);
    float pm = 1.0 - smoothstep(0.005, 0.013, min(pbd.x, pbd.y));
    vec3 brickCol = mix(vec3(0.46, 0.25, 0.19) * (0.8 + 0.4 * h21(floor(pb))), vec3(0.4, 0.37, 0.34), pm);
    diffuseColor.rgb = mix(diffuseColor.rgb, brickCol, bare * 0.92);
    sHeight -= bare * (0.008 + pm * 0.006);
    sHeight += (vnoise(suv * 9.0) - 0.5) * 0.002 * fMid;
  #elif PATTERN == 11
    // Dressed stone: courses of blocks cut to different lengths, chisel marks on every face.
    float rowH = 0.42;
    float row = floor(suv.y / rowH);
    vec2 sb = vec2(suv.x / 0.84 + h21(vec2(row, 1.0)) * 0.9, suv.y / rowH);
    vec2 sd = (0.5 - abs(fract(sb) - 0.5)) * vec2(0.84, rowH);
    float joint = (1.0 - smoothstep(0.004, 0.016, min(sd.x, sd.y))) * fLine;
    float sid = h21(floor(sb) + row * 13.0);
    shade *= 0.86 + 0.26 * sid;
    shade *= 1.0 - 0.4 * joint; sHeight -= joint * 0.008;
    float chisel = vnoise(suv * vec2(14.0, 7.0) + sid * 40.0);
    shade *= 0.94 + 0.12 * mix(0.5, chisel, fFine);
    sHeight += (chisel - 0.5) * 0.004 * fFine * (1.0 - joint);
    float lichen = smoothstep(0.7, 0.9, fbm(suv * 0.6 + 14.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.3), lichen * 0.25);
  #elif PATTERN == 12
    // Grass: never one green. Lush and dry patches, bare earth where it is worn, blades up close.
    float patchy = fbm(suv * 0.2);
    float worn = smoothstep(0.3, 0.16, fbm(suv * 0.33 + 12.0));
    float blades = vnoise(suv * vec2(41.0, 37.0));
    float clump = vnoise(suv * 4.5);
    vec3 tone = mix(vec3(0.82, 1.06, 0.78), vec3(1.3, 1.18, 0.7), smoothstep(0.42, 0.78, patchy));
    diffuseColor.rgb *= tone;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.16, 0.1) * (0.8 + 0.4 * n6), worn * 0.62);
    // Grass has no metre-wide blotches: the broad mottling every surface starts with is taken back out.
    shade = (0.9 + 0.08 * n1) * (0.86 + 0.26 * mix(0.5, blades, fTiny) + 0.1 * (mix(0.5, clump, fMid) - 0.5));
    sHeight += ((blades - 0.5) * 0.003 * fTiny + (clump - 0.5) * 0.002 * fMid) * (1.0 - worn);
  #elif PATTERN == 19
    // Foliage: clusters of leaves, light on the outside, dark between them.
    #if DETAIL == 1
      vec2 lf = cells(suv / 0.15);
      float leaf = 1.0 - smoothstep(0.12, 0.5, lf.x);
      float fLeaf = aaFade(px, 10.0);
      shade *= mix(1.0, (0.5 + 0.75 * leaf) * (0.8 + 0.4 * lf.y), fLeaf);
      diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.85, 1.05, 0.8), vec3(1.2, 1.15, 0.7), lf.y), fLeaf * 0.7);
      sHeight += leaf * 0.03 * fLeaf;
    #else
      shade *= 0.8 + 0.4 * n6;
    #endif
    shade *= 0.88 + 0.24 * vnoise(suv * 0.9);
  #elif PATTERN == 13
    // Gravel: stones of every grey, packed.
    #if DETAIL == 1
      vec2 gv = cells(suv / 0.06);
      float pebble = 1.0 - smoothstep(0.15, 0.5, gv.x);
      float fPeb = aaFade(px, 26.0);
      shade *= mix(1.0, (0.62 + 0.45 * pebble) * (0.78 + 0.44 * gv.y), fPeb);
      sHeight += pebble * 0.008 * fPeb;
    #endif
    shade *= 0.9 + 0.2 * fbm(suv * 0.4);
  #elif PATTERN == 14
    // Sand: wind ripples, dunes of lighter and darker grain, footprints of nothing.
    float sw = fbm(suv * 0.35);
    float ripple = sin(suv.x * 9.0 + sw * 9.0 + suv.y * 1.5);
    shade *= 0.93 + 0.1 * sw + 0.035 * ripple * aaFade(px, 2.0) * an.y;
    sHeight += ripple * 0.006 * aaFade(px, 2.0) * an.y;
    shade *= 1.0 + 0.25 * step(0.93, h21(floor(suv * 90.0))) * fTiny;
  #elif PATTERN == 15
    // Snow: soft drifts, blue in the hollows, a glitter of crystals in the light.
    float drift = fbm(suv * 0.3);
    shade = 0.92 + 0.1 * drift + 0.03 * (n6 - 0.5) * fMid;
    diffuseColor.rgb *= mix(vec3(0.86, 0.92, 1.04), vec3(1.0), smoothstep(0.3, 0.7, drift));
    sHeight += drift * 0.05 + (n6 - 0.5) * 0.004 * fMid;
    glow = step(0.988, h21(floor(suv * 130.0))) * fTiny * 0.5;
  #elif PATTERN == 22
    // Ice: clear in places, frosted in others, white cracks running through it.
    float frost = smoothstep(0.4, 0.75, fbm(suv * 0.7));
    float icrack = lineAt(fbm(suv * 0.9 + 4.0), 0.014) * fMid + lineAt(fbm(suv * 2.4 + 9.0), 0.012) * 0.5 * fFine;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), clamp(frost * 0.45 + icrack * 0.7, 0.0, 1.0));
    sRough += frost * 0.45;
    sHeight -= icrack * 0.002;
  #elif PATTERN == 21
    // Sandbags: stacked and slumped, each one a pillow of hessian with a stitched seam.
    vec2 gs = vec2(0.56, 0.2);
    vec2 gb = suv / gs;
    gb.x += step(1.0, mod(gb.y, 2.0)) * 0.5;
    vec2 gf = (fract(gb) - 0.5) * 2.0;
    float pillow = (1.0 - pow(abs(gf.x), 5.0)) * (1.0 - pow(abs(gf.y), 3.0));
    float fBag = aaFade(px, 5.0);
    shade *= mix(1.0, (0.62 + 0.5 * pillow) * (0.88 + 0.24 * h21(floor(gb))), fBag);
    sHeight += pillow * 0.03 * fBag;
    float weave = sin(suv.x * 260.0) * sin(suv.y * 260.0);
    shade *= 1.0 + 0.06 * weave * fTiny;
    float stitch = (1.0 - smoothstep(0.02, 0.05, abs(gf.y))) * step(0.5, fract(suv.x * 18.0)) * fFine;
    shade *= 1.0 - 0.2 * stitch;
  #elif PATTERN == 6
    // Awning cloth: broad stripes, the weave, soft folds.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.84), step(0.5, fract(suv.x / 0.9)) * 0.85 * aaFade(px, 1.1));
    float fold = sin(suv.x * 5.2 + n1 * 3.0);
    shade *= 0.93 + 0.09 * fold;
    sHeight += fold * 0.01;
    shade *= 1.0 + 0.05 * sin(suv.x * 300.0) * sin(suv.y * 300.0) * fTiny;
  #elif PATTERN == 8
    // Sedimentary bands on cliff faces; tops stay plain. Cracks follow the beds.
    float warp = vnoise(suv * 0.12) * 2.4;
    float bands = vnoise(vec2(2.7, suv.y * 1.7 + warp)) * 0.6 + vnoise(vec2(9.1, suv.y * 5.3 + warp)) * 0.4;
    shade *= mix(1.0, 0.72 + 0.5 * bands, 1.0 - an.y);
    float bed = (1.0 - an.y) * smoothstep(0.44, 0.5, abs(fract(suv.y * 0.55 + warp * 0.3) - 0.5));
    shade *= 1.0 - 0.22 * aaFade(px, 1.0) * bed;
    float fracture = lineAt(fbm(suv * vec2(0.5, 0.25) + 2.0), 0.02) * fMid;
    shade *= 1.0 - 0.3 * fracture;
    sHeight += (bands - 0.5) * 0.05 * (1.0 - an.y) - bed * 0.03 - fracture * 0.02 + (n6 - 0.5) * 0.01 * fMid;
  #elif PATTERN == 23
    // Water: two layers of ripples drifting across each other, foam where it meets a wall.
    vec2 flow = vec2(uTime * 0.045, uTime * 0.03);
    float w1 = fbm(suv * 0.8 + flow), w2 = fbm(suv * 2.1 - flow * 1.7 + 5.0);
    float wave = w1 * 0.65 + w2 * 0.35;
    shade = 0.82 + 0.3 * wave;
    sHeight = wave * 0.05 * an.y;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.9, 0.95), smoothstep(0.62, 0.8, wave) * 0.25);
    float foam = (1.0 - smoothstep(0.0, 0.35, edge)) * smoothstep(0.35, 0.7, vnoise(suv * 3.0 + flow * 6.0)) * an.y;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 0.97), foam * 0.6);
    sRough += foam * 0.5;
  #elif PATTERN == 7
    vec2 w = suv / vec2(2.2, 3.0);
    vec2 we = abs(fract(w) - 0.5);
    float pane = (1.0 - smoothstep(0.3, 0.34, we.x)) * (1.0 - smoothstep(0.26, 0.3, we.y)) * (1.0 - an.y);
    float lit = step(0.74, h21(floor(w) + 7.0));
    glow = pane * lit * uWindowGlow;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.03, 0.05), pane);
  #endif
  // A big surface is never one flat tone.
  shade *= 0.94 + 0.12 * vnoise(suv * 0.09 + 31.0);
  // Every box: edges knocked and paler, dirt gathered at the foot, streaks run down from the top.
  float knock = (1.0 - smoothstep(0.0, 0.022 + 0.05 * n6, edge)) * uEdge;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.035, knock * 0.6);
  sRough += knock * 0.1;
  float tall = smoothstep(0.9, 1.6, vHalf.y * 2.0);
  float foot = wallFace * exp(-up * 4.5) * tall;
  float streak = wallFace * smoothstep(0.5, 0.9, vnoise(vec2((an.x > 0.5 ? vWPos.z : vWPos.x) * 2.3, 1.7))) * exp(-down * 1.0) * smoothstep(1.8, 2.6, vHalf.y * 2.0);
  shade *= 1.0 - uGrime * (0.34 * foot + 0.2 * streak);
  diffuseColor.rgb *= shade;`;

// Roughness and metalness pick up what the pattern decided.
const FRAGMENT_ROUGH = '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + sRough, 0.05, 1.0);';
const FRAGMENT_METAL = '#include <metalnessmap_fragment>\nmetalnessFactor *= sMetal;';
// The height becomes a normal the lights can see, and the last couple of centimetres of every face
// lean toward the neighbouring face, so a box has a rounded edge that catches the light instead of a line.
const FRAGMENT_NORMAL = `#include <normal_fragment_maps>
  #if DETAIL == 1
    vec3 sigX = dFdx(-vViewPosition), sigY = dFdy(-vViewPosition);
    vec3 r1 = cross(sigY, normal), r2 = cross(normal, sigX);
    float det = dot(sigX, r1) * faceDirection;
    // Far enough away that a pixel covers centimetres, relief is flattened out: no shimmer at range.
    vec3 grad = sign(det) * (dFdx(sHeight) * r1 + dFdy(sHeight) * r2) * (1.0 - smoothstep(0.012, 0.05, px));
    normal = normalize(abs(det) * normal - grad);
    if (uBevel > 0.0) {
      vec3 de = vHalf - abs(vBox);
      vec3 lean = an.y > 0.5 ? (de.x < de.z ? vec3(sign(vBox.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(vBox.z)))
        : (an.x > 0.5 ? (de.y < de.z ? vec3(0.0, sign(vBox.y), 0.0) : vec3(0.0, 0.0, sign(vBox.z))) : (de.x < de.y ? vec3(sign(vBox.x), 0.0, 0.0) : vec3(0.0, sign(vBox.y), 0.0)));
      float rounding = 1.0 - smoothstep(0.0, uBevel, edge);
      normal = normalize(normal + mat3(viewMatrix) * lean * rounding * rounding * 0.85 * aaFade(px, 0.25 / uBevel));
    }
  #endif`;

// as: draw this material with another pattern (the backdrop towers are a wall colour with windows).
export function surfaceMaterial(key, detail = 1, as = null) {
  const spec = as ? { ...MATERIALS[key], pattern: as } : MATERIALS[key];
  const material = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.rough ?? 0.8, metalness: spec.metal ?? 0.05 });
  // glow: what the tube or lamp gives off. With bloom on it is turned up well past white (world.js), so it glows.
  if (spec.emissive) { material.emissive = new THREE.Color(spec.color); material.emissiveIntensity = spec.emissive; material.userData.glow = spec.emissive; }
  const pattern = PATTERNS[spec.pattern] ?? -1;
  if (pattern < 0) return material;
  const wear = WEAR[spec.pattern] || WEAR.default;
  material.userData.uniforms = {
    uWindowGlow: { value: 0.5 }, uHaze: { value: 0 }, uHazeColor: { value: new THREE.Color() }, uTime: SURFACE_TIME, uLinearOut: LINEAR_OUT, uExposure: EXPOSURE,
    uEdge: { value: wear.edge }, uGrime: { value: wear.grime }, uBevel: { value: wear.bevel },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData.uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERTEX_HEAD).replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_HEAD)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGH)
      .replace('#include <metalnessmap_fragment>', FRAGMENT_METAL)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (PATTERN == 15 ? vec3(0.9, 0.95, 1.0) : vec3(1.0, 0.78, 0.45)) * glow * 1.6;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#if PATTERN == 7\nif (uLinearOut > 0.5) gl_FragColor.rgb = toLight(mix(toShown(gl_FragColor.rgb), uHazeColor, uHaze * (1.0 - glow * 0.85))) + gl_FragColor.rgb * glow * 0.5;\nelse gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, uHaze * (1.0 - glow * 0.85));\n#endif');
  };
  material.defines = { PATTERN: pattern, DETAIL: detail ? 1 : 0 };
  material.customProgramCacheKey = () => `surface-${pattern}-${detail ? 1 : 0}`;
  return material;
}
