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
const sizeOf = (w: number) => clamp01((w - 0.45) / 1.35);
/** Half the painted width (map px): small streams are about two pixels, the biggest rivers about four, and steep reaches are narrower. */
const halfWidth = (size: number, drop: number) => 0.5 * (1.8 + 2.4 * size) * (1.12 - 0.3 * smoothstep(0.45, 1.6, drop));

/** Distance, edge, size and drop for every pixel within reach of a river, in and around `tile`. Null when no river comes near. */
export function rasterRivers(rivers: RiverPath[], hf: HeightField, kmPerPx: number, tile: Rect): RiverRaster | null {
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
      z[k] = hf.sample(p[2 * k], p[2 * k + 1]);
      if (k) s[k] = s[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    }
    let a = 0, b = 0;
    for (let k = 0; k < n; k++) {
      while (s[k] - s[a] > 3) a++;
      while (b < n - 1 && s[b] - s[k] < 3) b++;
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
  return p === 0 ? 0 : (0.03 + 0.1 * rugged) * (0.7 + 0.9 * size) * p * p;
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
  const brisk = smoothstep(0.45, 1.6, p.drop), rapid = smoothstep(1.2, 3.2, p.drop), fall = smoothstep(4, 9, p.drop);
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
  toward(0.55 * fall * bank, 228, 235, 238); // spray round a fall

  const cov = clamp01(0.5 - re);
  if (cov <= 0) { col[0] = R; col[1] = G; col[2] = B; return; }
  // water: pale and clear when small, deep blue when big, milky pale blue in the highlands, brackish where it meets the sea
  let wr = 104 + (48 - 104) * size, wg = 142 + (82 - 142) * size, wb = 164 + (126 - 164) * size;
  const calm = 1 - brisk;
  const dark = 1 - 0.14 * calm * size;
  wr *= dark; wg *= dark; wb *= dark;
  const gl = 0.5 * hi * (1 - 0.5 * calm);
  wr += (156 - wr) * gl; wg += (196 - wg) * gl; wb += (210 - wb) * gl;
  wr += (124 - wr) * 0.5 * est; wg += (168 - wg) * 0.5 * est; wb += (196 - wb) * 0.5 * est;
  // shallow slow water shows the bed
  const bed = 0.3 * (1 - size) * calm * (1 - est);
  wr += (R * 0.62 - wr) * bed; wg += (G * 0.62 - wg) * bed; wb += (B * 0.62 - wb) * bed;
  // it picks up the colour of what is round it
  const refl = 0.2 + 0.15 * (1 - size);
  wr += (R * 0.8 - wr) * refl; wg += (G * 0.8 - wg) * refl; wb += (B * 0.8 - wb) * refl;
  // the same light as the ground, streaks along the flow and ripples that grow with the speed, white water on rapids and falls
  const lum = 0.8 + 0.22 * Math.min(1.3, p.f);
  const streak = Math.sin(p.along * (1.1 + 1.2 * brisk) + p.fine * 1.5) * (0.03 + 0.08 * brisk);
  const rip = lum * (1 + streak + p.fine * (0.03 + 0.08 * brisk));
  wr *= rip; wg *= rip; wb *= rip;
  const foam = clamp01(rapid * 0.75 * smoothstep(-0.4, 0.45, p.fine + 0.1) + fall * 0.9);
  wr += (234 * lit - wr) * foam; wg += (240 * lit - wg) * foam; wb += (242 * lit - wb) * foam;
  // under the canopy narrow rivers vanish in places
  const cover = (0.5 * p.jw + 0.3 * p.veg * (1 - p.jw)) * (1 - 0.7 * size) * smoothstep(-0.3, 0.5, p.crown) * (1 - 0.8 * foam);
  const a = cov * (0.95 - 0.08 * (1 - size)) * (1 - 0.6 * cover);
  col[0] = R + (wr - R) * a; col[1] = G + (wg - G) * a; col[2] = B + (wb - B) * a;
}
