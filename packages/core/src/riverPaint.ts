/**
 * Rivers painted into the map instead of drawn over it.
 *
 * The painter works out, for every pixel near a river, how far it is from the water's edge, how big the river is there and how steeply it drops
 * (metres per km of its length). From those it paints water that takes its light and colour from the ground, banks that follow the land (green
 * floodplain on the flats, gravel and rock where it is steep or high, an oasis ribbon through desert, mud at the mouth), rapids and falls where it
 * drops, canopy that hides narrow rivers in jungle, and a valley that deepens with the river (the shading sees a V cut into steep ground), so a
 * river looks like it runs down a slope through the land it crosses.
 */
import type { HeightField } from "./doc.ts";
import { type Rect, clipRect, expandRect } from "./geom.ts";
import type { RiverPath } from "./hydrology.ts";
import { smoothstep } from "./noise.ts";

/**
 * River water, in the lakes' lighter colour family (the lakes read better than the rivers did, which were dark and greyish like the forests: a map
 * session's notes, 2026-11-25): a small stream and a big river. Lighter than every dark ground, so a river can still be followed in greyscale.
 */
export const WATER_SMALL: [number, number, number] = [112, 158, 204];
export const WATER_BIG: [number, number, number] = [84, 130, 194];
/** The shallow sea a river's mouth blends into (the painter's coastal shallows). */
const MOUTH: [number, number, number] = [146, 176, 198];

/**
 * The narrow shoreline round a river or a lake (the person, 2026-11-25: "a small shoreline around each one that is painted with the biome in mind but not
 * exactly like the main biome paint"): taken from the ground but calm and set apart from it, pale on dark ground (forest, marsh, jungle: a grassy or muddy
 * bank), darker on light ground; wet dark rock on snow, damp dark sand in the desert. Written into `out`.
 */
export function shoreTone(col: number[], p: { sw: number; dw: number; jw: number; rw: number }, out: number[]): number[] {
  const L = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
  // a calm version of the ground: half its own colour, half a plain bank colour, then lifted or lowered away from both the ground and the water
  let r = col[0] * 0.45 + 150 * 0.55, g = col[1] * 0.45 + 150 * 0.55, b = col[2] * 0.45 + 116 * 0.55;
  const pale = 1 - smoothstep(95, 135, L); // dark ground gets a pale bank
  r += (196 - r) * 0.55 * pale; g += (190 - g) * 0.55 * pale; b += (150 - b) * 0.55 * pale;
  const dk = 1 - pale; // light ground gets a dark, wet one
  r += (88 - r) * 0.5 * dk; g += (84 - g) * 0.5 * dk; b += (74 - b) * 0.5 * dk;
  const mud = 0.6 * p.jw;
  r += (170 - r) * mud; g += (150 - g) * mud; b += (108 - b) * mud;
  const sand = 0.75 * p.dw;
  r += (146 - r) * sand; g += (118 - g) * sand; b += (84 - b) * sand;
  const rock = 0.6 * Math.max(p.rw * 0.6, p.sw);
  r += (92 - r) * rock; g += (96 - g) * rock; b += (104 - b) * rock;
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}
/** How wide the shoreline is (map px) beside a river of `size` 0..1. */
export const shoreWidth = (size: number) => 0.9 + 0.6 * size;

/** Farthest (map px) that banks and valley reach from the water's edge. */
export const RIVER_REACH = 18;
/** The `edge` value where there is no river. */
export const NO_RIVER = 1e3;

export interface RiverRaster {
  /** The area covered: the tile with 2 px round it (clipped to the map), so the shading can look at each pixel's neighbours. */
  r: Rect;
  /** Distance (map px) from each pixel centre to the nearest river's water edge; negative inside the water. */
  edge: Float32Array;
  /** 0..1: how big the nearest river is there. */
  size: Float32Array;
  /** Metres the nearest river drops per km of its length there. */
  drop: Float32Array;
  /** Distance (map px) along the nearest river from its head to the nearest point of its path: the water's streaks run along it. */
  along: Float32Array;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SHORE = [0, 0, 0];
const sizeOf = (w: number) => clamp01((w - 0.45) / 1.35);
/** Half the painted width (map px): small streams are about two pixels, the biggest rivers about four, and steep reaches are narrower. */
const halfWidth = (size: number, drop: number) => 0.5 * (1.8 + 2.4 * size) * (1.12 - 0.3 * smoothstep(0.45, 1.6, drop));

/**
 * Distance, edge, size and drop for every pixel within reach of a river, in and around `tile`. Null when no river comes near. Heights below `sea` count
 * as the sea's (a river reaching the sea doesn't "fall" down the seabed: that made white water at river mouths).
 */
export function rasterRivers(rivers: RiverPath[], hf: HeightField, kmPerPx: number, tile: Rect, sea = -Infinity): RiverRaster | null {
  const r = clipRect(expandRect(tile, 2), hf.w, hf.h);
  if (!r || !rivers.length) return null;
  // a river matters if some part of it is within reach of the tile
  const m = RIVER_REACH + 3, wx0 = tile.x - m, wy0 = tile.y - m, wx1 = tile.x + tile.w + m, wy1 = tile.y + tile.h + m;
  let edge: Float32Array | null = null, size: Float32Array | null = null, drop: Float32Array | null = null, along: Float32Array | null = null;

  for (const rv of rivers) {
    const p = rv.pts, n = p.length >> 1;
    if (n < 2) continue;
    let touches = false;
    for (let k = 0; k < n && !touches; k++) { const x = p[2 * k], y = p[2 * k + 1]; if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) touches = true; }
    if (!touches) continue;
    if (!edge) { edge = new Float32Array(r.w * r.h).fill(NO_RIVER); size = new Float32Array(r.w * r.h); drop = new Float32Array(r.w * r.h); along = new Float32Array(r.w * r.h); }

    // height and distance along the river at each point, then how steeply it drops over a few px either side of each point
    const z = new Float32Array(n), s = new Float32Array(n), dr = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      z[k] = Math.max(sea, hf.sample(p[2 * k], p[2 * k + 1]));
      if (k) s[k] = s[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    }
    // (over 6 px either side: a carved channel's small steps don't read as falls)
    let a = 0, b = 0;
    for (let k = 0; k < n; k++) {
      while (s[k] - s[a] > 6) a++;
      while (b < n - 1 && s[b] - s[k] < 6) b++;
      const run = (s[b] - s[a]) * kmPerPx;
      dr[k] = run > 1e-6 ? Math.max(0, (z[a] - z[b]) / run) : 0;
    }
    // work on points about half a pixel apart (the path is much denser than a pixel)
    const keep: number[] = [0];
    for (let k = 1; k < n - 1; k++) if (s[k] - s[keep[keep.length - 1]] >= 0.5) keep.push(k);
    keep.push(n - 1);

    for (let q = 0; q + 1 < keep.length; q++) {
      const i0 = keep[q], i1 = keep[q + 1];
      const ax = p[2 * i0], ay = p[2 * i0 + 1], bx = p[2 * i1], by = p[2 * i1 + 1];
      const sz = (sizeOf(rv.widths[i0]) + sizeOf(rv.widths[i1])) / 2, dd = (dr[i0] + dr[i1]) / 2;
      const hw = halfWidth(sz, dd), reach = hw + RIVER_REACH;
      const x0 = Math.max(r.x, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(r.x + r.w - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(r.y, Math.floor(Math.min(ay, by) - reach)), y1 = Math.min(r.y + r.h - 1, Math.ceil(Math.max(ay, by) + reach));
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
      for (let y = y0; y <= y1; y++) {
        const row = (y - r.y) * r.w - r.x;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          let t = ((px - ax) * dx + (py - ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const e = Math.hypot(ax + t * dx - px, ay + t * dy - py) - hw;
          const i = row + x;
          if (e < edge![i]) { edge![i] = e; size![i] = sz; drop![i] = dd; along![i] = s[i0] + t * (s[i1] - s[i0]); }
        }
      }
    }
  }
  return edge ? { r, edge, size: size!, drop: drop!, along: along! } : null;
}

// ------------------------------------------------------------------------------------------------- the valley

/** How far the valley reaches from the water's edge (map px). */
const valleyReach = (size: number) => 7 + 13 * size;
/** 1 at the water's edge, 0 at the edge of the valley. */
export function valleyProfile(re: number, size: number): number {
  const rv = valleyReach(size);
  return re >= rv ? 0 : 1 - smoothstep(0, rv, re > 0 ? re : 0);
}
/**
 * How deep the river has cut the ground here, in the painter's normalised height units: deeper in rugged country and for bigger rivers,
 * a shallow dip on the flats. Only the shading sees it (the heights are untouched).
 */
export function valleyDepth(re: number, size: number, rugged: number): number {
  const p = valleyProfile(re, size);
  // (gentle beside small rivers: the dark side of a deep valley next to a thin river read as part of the water, or as a dry groove)
  return p === 0 ? 0 : (0.03 + 0.1 * rugged) * (0.35 + 1.1 * size) * p * p;
}

// ------------------------------------------------------------------------------------------------- water and banks

/** Everything the river painting needs to know about one pixel (filled in by the painter, reused for every pixel). */
export interface RiverPixel {
  /** Distance to the water's edge (negative inside the water), river size 0..1, and drop in metres per km. */
  re: number;
  size: number;
  drop: number;
  /** Normalised height, temperature and moisture (0..1). */
  e: number;
  t: number;
  m: number;
  /** Weights 0..1 of jungle, desert, vegetation, bare rock, snow. */
  jw: number;
  dw: number;
  veg: number;
  rw: number;
  sw: number;
  /** The relief shading factor already applied to the ground (about 0.4..1.4). */
  f: number;
  /** Texture noise -1..1 (fine ripples), and canopy crowns (high) against gaps (low). */
  fine: number;
  crown: number;
  /** Distance to the sea in px (a coast cell is 1; far inland up to 255). */
  ld: number;
  /** Distance along the river from its head (map px). */
  along: number;
  /** Bare stone cover 0..1 from a climate region (a ring of rocky islets, say): where it is high, the banks stay stone instead of turning green or damp. */
  stone: number;
}

/** Paint the banks and the water of a river over the ground colour in `col` (RGB 0..255, changed in place). */
export function paintRiverPixel(col: number[], p: RiverPixel) {
  const { re, size } = p;
  const hi = smoothstep(0.18, 0.42, p.e);
  // (white water only where it really drops: rapids from about 2 m a km, falls from about 8)
  const brisk = smoothstep(0.45, 1.6, p.drop), rapid = smoothstep(2, 4.5, p.drop), fall = smoothstep(8, 16, p.drop);
  const flat = (1 - brisk) * (1 - smoothstep(0.03, 0.14, p.e));
  const est = 1 - smoothstep(2, 10, p.ld);
  const reach = Math.min(RIVER_REACH, (2.5 + 3.5 * size) * (1 + 1.1 * flat) * (1 + 0.8 * est));
  if (re >= reach) return;
  const bank = 1 - smoothstep(0, reach, re > 0 ? re : 0);
  const lit = Math.min(1.25, Math.max(0.6, p.f));
  let R = col[0], G = col[1], B = col[2];
  const toward = (a: number, tr: number, tg: number, tb: number) => { R += (tr * lit - R) * a; G += (tg * lit - G) * a; B += (tb * lit - B) * a; };

  // wet ground along the banks: damp and darker, green where plants can grow, rock where it is steep or high, an oasis in the desert
  const growth = 1 - 0.95 * p.stone; // bare stone grows nothing
  const damp = 1 - 0.36 * bank * (0.6 + 0.4 * bank) * (1 + 0.4 * p.jw) * growth;
  R *= damp; G *= damp; B *= damp;
  toward(0.72 * growth * bank * (1 - 0.7 * p.jw) * (1 - 0.92 * p.sw) * (1 - 0.8 * p.rw) * (1 - 0.6 * hi), 34 + 14 * p.t, 80 + 8 * p.t, 36 - 10 * p.t);
  toward(0.4 * growth * bank * p.jw * (1 - p.sw), 22, 56, 32); // wet, dark jungle along a river
  toward(0.62 * growth * bank * p.dw * (1 - p.sw), 92, 124, 56);
  toward(bank * (0.55 * rapid + 0.5 * hi + 0.25 * brisk) * (1 - 0.6 * p.jw) * (1 - p.sw) * 0.7, 134, 126, 114);
  toward(0.22 * growth * bank * flat * (1 - p.jw) * (1 - p.dw), 96, 114, 64);
  toward(0.25 * growth * bank * est, 178, 164, 124);
  toward(0.25 * fall * (1 - smoothstep(0, 2, re)), 228, 235, 238); // a little spray right beside a fall

  // the shoreline: a narrow band of calm ground set apart from both the ground and the water (shoreTone), so the river stands out on any ground
  const sw = shoreWidth(size);
  if (re > -0.5 && re < sw + 0.5) {
    const k = (re < sw - 0.5 ? 1 : 1 - (re - (sw - 0.5))) * 0.6;
    shoreTone([R, G, B], p, SHORE);
    R += (SHORE[0] * lit - R) * k; G += (SHORE[1] * lit - G) * k; B += (SHORE[2] * lit - B) * k;
  }

  const cov = clamp01(0.5 - re);
  if (cov <= 0) { col[0] = R; col[1] = G; col[2] = B; return; }
  // water: the lakes' colour family, a little deeper blue when big, milky pale blue in the highlands, the shallow sea's colour where it meets the sea
  let wr = WATER_SMALL[0] + (WATER_BIG[0] - WATER_SMALL[0]) * size, wg = WATER_SMALL[1] + (WATER_BIG[1] - WATER_SMALL[1]) * size, wb = WATER_SMALL[2] + (WATER_BIG[2] - WATER_SMALL[2]) * size;
  const calm = 1 - brisk;
  const gl = 0.5 * hi * (1 - 0.5 * calm);
  wr += (156 - wr) * gl; wg += (196 - wg) * gl; wb += (210 - wb) * gl;
  wr += (MOUTH[0] - wr) * 0.85 * est; wg += (MOUTH[1] - wg) * 0.85 * est; wb += (MOUTH[2] - wb) * 0.85 * est;
  // a hint of the bed in a shallow slow stream, and of what is round it (small: dark ground pulled the water dark and greyish)
  const bed = 0.08 * (1 - size) * calm * (1 - est);
  wr += (R * 0.62 - wr) * bed; wg += (G * 0.62 - wg) * bed; wb += (B * 0.62 - wb) * bed;
  const refl = 0.05 + 0.04 * (1 - size);
  wr += (R * 0.8 - wr) * refl; wg += (G * 0.8 - wg) * refl; wb += (B * 0.8 - wb) * refl;
  // the same light as the ground, streaks along the flow and ripples that grow with the speed, white water on rapids and falls
  // (water is flat and level: only a little of the ground's light)
  const lum = 0.9 + 0.1 * Math.min(1.3, p.f);
  const streak = Math.sin(p.along * (1.1 + 1.2 * brisk) + p.fine * 1.5) * (0.02 + 0.06 * brisk);
  const rip = lum * (1 + streak + p.fine * (0.02 + 0.06 * brisk));
  wr *= rip; wg *= rip; wb *= rip;
  // white water as small flecks on rapids and falls, never blotches
  const foam = clamp01((rapid * 0.6 + fall * 0.8) * smoothstep(0.15, 0.55, p.fine + 0.25 * Math.sin(p.along * 2.3)));
  wr += (234 * lit - wr) * foam; wg += (240 * lit - wg) * foam; wb += (242 * lit - wb) * foam;
  // under the canopy narrow rivers vanish in places
  const cover = (0.5 * p.jw + 0.3 * p.veg * (1 - p.jw)) * (1 - 0.7 * size) * smoothstep(-0.3, 0.5, p.crown) * (1 - 0.8 * foam);
  const a = cov * (0.95 - 0.08 * (1 - size)) * (1 - 0.6 * cover);
  col[0] = R + (wr - R) * a; col[1] = G + (wg - G) * a; col[2] = B + (wb - B) * a;
}
