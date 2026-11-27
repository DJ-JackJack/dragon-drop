/**
 * The ground the painted style puts on land that is neither jungle nor desert (those have their own looks in painted.ts).
 *
 * Almost all the land of a wet archipelago has moisture near the top of the scale, so the variety comes mostly from temperature, which falls with
 * latitude and with height: tundra where it is coldest, boreal conifer forest, temperate mixed forest, warm broadleaf forest, and (before the
 * jungle takes over) the hottest land. Above the treeline the forest gives way to alpine meadow. Where it is drier the forest gives way to steppe, or
 * savanna when it is warm; on low flat ground in a wet climate, and along big rivers, there is marsh. The weights overlap smoothly (the temperature bands add up to one), so one biome fades into the next with no hard line.
 */
import { type Rect, clipRect, expandRect } from "./geom.ts";
import { smoothstep } from "./noise.ts";
import { WATER_SMALL } from "./riverPaint.ts";

export type Biome = "tundra" | "boreal" | "temperate" | "warm" | "alpine" | "savanna" | "steppe" | "marsh";
export const BIOMES: Biome[] = ["tundra", "boreal", "temperate", "warm", "alpine", "savanna", "steppe", "marsh"];
/**
 * Ground that lies on top of the biomes in particular places: the water's edge (beach, mangrove swamp, reed-lined shores), the cold heights (glacier, moorland
 * and peat bog), dry country (Mediterranean scrub, badlands, salt flats, and stony desert, which is the desert's version where the ground is rugged), and
 * the wet forests (cool temperate rainforest on wet coasts, cloud forest on warm wet mountainsides, bamboo stands, and autumn colour in the cooler woods).
 */
export type Ground = "beach" | "mangrove" | "reeds" | "glacier" | "moor" | "chaparral" | "badlands" | "saltflat" | "stony" | "rainforest" | "cloud" | "bamboo" | "autumn";
export const GROUNDS: Ground[] = ["beach", "mangrove", "reeds", "glacier", "moor", "chaparral", "badlands", "saltflat", "stony", "rainforest", "cloud", "bamboo", "autumn"];
export type BiomeWeights = Record<Biome | Ground, number>;

export const emptyBiomeWeights = (): BiomeWeights => ({
  tundra: 0, boreal: 0, temperate: 0, warm: 0, alpine: 0, savanna: 0, steppe: 0, marsh: 0,
  beach: 0, mangrove: 0, reeds: 0, glacier: 0, moor: 0, chaparral: 0, badlands: 0, saltflat: 0, stony: 0, rainforest: 0, cloud: 0, bamboo: 0, autumn: 0,
});

/** Where a pixel is in relation to the water: px from the sea (a coast cell is 1) and from the nearest lake (99 when none is near). */
export interface Site {
  ld: number;
  shore: number;
}
const INLAND: Site = { ld: 255, shore: 99 };

/**
 * How much of a cell's ground is each biome, 0..1, from its temperature and moisture (0..1), height (normalised: 0.1 is about 400 m) and how rugged
 * the ground is (0 flat .. 1 mountain), and `nearWater` (0..1) how close it is to a big river's floodplain. Jungle and desert are separate (jungleWeight,
 * desertWeight): they take over at the hot and the very dry ends.
 */
export function biomeWeights(t: number, m: number, e: number, rugged: number, out: BiomeWeights = emptyBiomeWeights(), nearWater = 0, site: Site = INLAND): BiomeWeights {
  // (the painter calls this for every pixel, and its sixty smoothsteps were a good part of painting a brush patch, docs/BRUSH-SPEED.md: the ones used
  // more than once are worked out once, and each product stops at its first zero factor, `(v = a) && (v *= b) && ...`. The numbers are exactly those
  // of the plain formulas: the same factors, multiplied in the same order.)
  let v = 0;
  const wet = smoothstep(0.4, 0.7, m);
  const t1426 = smoothstep(0.14, 0.26, t), t3446 = smoothstep(0.34, 0.46, t), t5872 = smoothstep(0.58, 0.72, t), t5568 = smoothstep(0.55, 0.68, t);
  const cold = 1 - t1426;
  const cool = t1426 * (1 - t3446);
  const mild = t3446 * (1 - t5872);
  const warm = t5872;
  const dry = (v = 1 - wet) && (v *= smoothstep(0.12, 0.26, m));
  // trees thin out and stop at about 700 m up (normalised 0.17 to 0.3): above that the forest's share becomes alpine meadow
  const high = smoothstep(0.17, 0.3, e);
  out.tundra = cold;
  out.boreal = cool * wet * (1 - high);
  out.temperate = mild * wet * (1 - high);
  out.warm = warm * wet * (1 - high);
  out.alpine = (cool + mild + warm) * wet * high;
  out.steppe = dry * (1 - t5568) * (1 - cold);
  out.savanna = dry * t5568;
  // marsh: low, gentle ground in a very wet climate (not where it is frozen)
  const lowFlat = (1 - rugged) * (1 - 0.6 * cold) * smoothstep(0.1, 0.2, t);
  const m5580 = smoothstep(0.55, 0.8, m), e0310 = 1 - smoothstep(0.03, 0.1, e);
  const lakeWet = (v = 1 - smoothstep(1, 6, site.shore)) && (v *= m5580) && (v *= e0310) && (v *= lowFlat); // low flat ground round a lake
  out.marsh = Math.max((v = smoothstep(0.72, 0.9, m)) && (v *= 1 - smoothstep(0.012, 0.05, e)) && (v *= lowFlat), m5580 * e0310 * lowFlat * nearWater, lakeWet);

  const flat = 1 - rugged;
  // the water's edge: a beach on low gentle coast, mangrove where it is warm and wet (further in along a river), reeds along a lake's shore
  out.beach = (v = 1 - smoothstep(1, 3, site.ld)) && (v *= 1 - smoothstep(0.02, 0.06, e)) && (v *= flat);
  out.mangrove = (v = t5568) && (v *= smoothstep(0.7, 0.9, m)) && (v *= 1 - smoothstep(0.012, 0.04, e)) && (v *= flat) && (v *= 1 - smoothstep(4, 10 + 8 * nearWater, site.ld));
  out.reeds = (v = 1 - smoothstep(1.2, 4.5, site.shore)) && (v *= smoothstep(0.3, 0.5, m)) && (v *= smoothstep(0.05, 0.15, t));
  // the cold heights: glacier on the highest, coldest, snowiest ground; heather moor and peat bog on cool wet uplands
  out.glacier = (v = 1 - smoothstep(0.05, 0.12, t)) && (v *= smoothstep(0.18, 0.32, e)) && (v *= smoothstep(0.3, 0.55, m));
  out.moor = (v = smoothstep(0.18, 0.28, t)) && (v *= 1 - smoothstep(0.4, 0.5, t)) && (v *= m5580) && (v *= smoothstep(0.06, 0.1, e)) && (v *= 1 - smoothstep(0.17, 0.26, e));
  // dry country: scrub where it is warm and not quite dry, badlands where dry ground is rugged, salt flats on very dry low flats, stony ground on rugged desert
  out.chaparral = (v = smoothstep(0.45, 0.58, t)) && (v *= 1 - smoothstep(0.76, 0.86, t)) && (v *= smoothstep(0.3, 0.4, m)) && (v *= 1 - smoothstep(0.5, 0.62, m));
  out.badlands = (v = smoothstep(0.08, 0.16, m)) && (v *= 1 - smoothstep(0.2, 0.4, m)) && (v *= smoothstep(0.35, 0.7, rugged)) && (v *= smoothstep(0.45, 0.6, t));
  out.saltflat = (v = 1 - smoothstep(0.05, 0.2, m)) && (v *= flat) && (v *= 1 - smoothstep(0.02, 0.08, e)) && (v *= smoothstep(0.4, 0.6, t));
  out.stony = smoothstep(0.25, 0.6, rugged);
  // the wet forests: temperate rainforest on a wet cool-to-mild coast below the treeline, cloud forest on warm wet mountainsides, bamboo in warm lowland woods,
  // and autumn colour in the cooler half of the mixed woods (these three are patchy: the painter breaks them up with noise)
  const below = 1 - high;
  out.rainforest = (v = smoothstep(0.28, 0.4, t)) && (v *= 1 - smoothstep(0.52, 0.62, t)) && (v *= smoothstep(0.85, 0.97, m)) && (v *= 1 - smoothstep(12, 36, site.ld)) && (v *= below);
  out.cloud = (v = smoothstep(0.5, 0.6, t)) && (v *= smoothstep(0.7, 0.9, m)) && (v *= smoothstep(0.1, 0.14, e)) && (v *= 1 - smoothstep(0.2, 0.3, e));
  out.bamboo = (v = smoothstep(0.45, 0.55, t)) && (v *= 1 - smoothstep(0.72, 0.82, t)) && (v *= smoothstep(0.6, 0.85, m)) && (v *= 1 - smoothstep(0.1, 0.17, e));
  out.autumn = (v = smoothstep(0.3, 0.38, t)) && (v *= 1 - smoothstep(0.5, 0.58, t)) && (v *= smoothstep(0.5, 0.75, m)) && (v *= below);
  // standing water leaves no room for woodland colour
  const dryLand = 1 - out.marsh;
  out.rainforest *= dryLand; out.cloud *= dryLand; out.bamboo *= dryLand; out.autumn *= dryLand;
  return out;
}

/** Distance (px, up to `reach`) from each pixel in and round `tile` to the nearest lake cell; null when no lake is within reach. */
export interface ShoreRaster {
  r: Rect;
  dist: Float32Array;
}
export function lakeShoreDistance(lakes: Uint8Array, W: number, H: number, tile: Rect, reach: number): ShoreRaster | null {
  const r = clipRect(expandRect(tile, reach + 1), W, H);
  if (!r) return null;
  const w = r.w, h = r.h, big = reach + 4, dist = new Float32Array(w * h);
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const lake = lakes[(r.y + y) * W + r.x + x] !== 0; dist[y * w + x] = lake ? 0 : big; if (lake) any = true; }
  if (!any) return null;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = dist[i];
    if (x > 0) v = Math.min(v, dist[i - 1] + 1);
    if (y > 0) { v = Math.min(v, dist[i - w] + 1); if (x > 0) v = Math.min(v, dist[i - w - 1] + D); if (x < w - 1) v = Math.min(v, dist[i - w + 1] + D); }
    dist[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let v = dist[i];
    if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, dist[i + w] + 1); if (x < w - 1) v = Math.min(v, dist[i + w + 1] + D); if (x > 0) v = Math.min(v, dist[i + w - 1] + D); }
    dist[i] = v;
  }
  return { r, dist };
}

/** The biome with the most weight (for describing a place). */
export function dominantBiome(w: BiomeWeights): Biome {
  let best: Biome = "temperate", v = -1;
  for (const b of BIOMES) if (w[b] > v) { v = w[b]; best = b; }
  return best;
}

/** What the painter knows about one pixel (reused for every pixel). Noise values are -1..1. */
export interface BiomePixel {
  t: number;
  m: number;
  /** Texture noise: canopy crowns (fine), clumps, hue drift, rock grain, fine grain, lowland relief. */
  cn: number;
  cl: number;
  hu: number;
  rk: number;
  fine: number;
  hills: number;
  /** Height (normalised: 0.1 is about 400 m) and how rugged the ground is (0 flat .. 1 mountain). */
  e: number;
  rg: number;
  /** Map position and the direction the wind travels (steppe grass streaks across it). */
  x: number;
  y: number;
  dux: number;
  duy: number;
  len: number;
}

const mix = (col: number[], tr: number, tg: number, tb: number, a: number) => {
  if (a <= 0) return;
  col[0] += (tr - col[0]) * a; col[1] += (tg - col[1]) * a; col[2] += (tb - col[2]) * a;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const cellHash = (ix: number, iy: number) => {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** Distance (in cells) to the nearest edge of a cellular pattern with cells `size` px across: 0 on a crack, about 0.5 in a cell's middle. Fixed to the map, so tiles agree. */
export function cellEdge(x: number, y: number, size: number): number {
  const gx = x / size, gy = y / size, ix = Math.floor(gx), iy = Math.floor(gy);
  let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i + cellHash(ix + i, iy + j), cy = iy + j + cellHash(iy + j + 7919, ix + i + 104729);
    const d = Math.hypot(gx - cx, gy - cy);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return (d2 - d1) * 0.5;
}

/**
 * Put the ground of the weighted biomes over the base colour in `col` (RGB 0..255, changed in place). `open` (0..1) is how much room the
 * biomes have: less in jungle and desert, which paint themselves. `openDry` is the room for badlands and salt flats, which can lie in a desert (only
 * jungle shuts them out).
 */
export function paintBiomes(col: number[], w: BiomeWeights, p: BiomePixel, open: number, openDry: number = open) {
  const { cn, cl, hu, rk, fine } = p;

  if (w.tundra * open > 0.01) {
    // tundra: mats of moss and russet dwarf shrub, pale grey lichen, bare frost-shattered gravel, cracked patterned ground, small pools,
    // and flecks of snow lying in the hollows on the very coldest ground
    const mats = hu * 0.8 + cl * 0.5;
    const moss = smoothstep(-0.2, 0.5, mats), russet = smoothstep(0.2, 0.7, -hu * 0.7 + rk * 0.6), lichen = smoothstep(0.15, 0.65, rk * 0.8 + fine * 0.4), gravel = smoothstep(0.5, 0.85, -cl * 0.6 + rk * 0.5 + hu * 0.3);
    let r = 158, g = 150, b = 140;
    r = lerp(r, 112, moss * 0.45); g = lerp(g, 120, moss * 0.45); b = lerp(b, 96, moss * 0.45);
    r = lerp(r, 168, russet * 0.75); g = lerp(g, 108, russet * 0.75); b = lerp(b, 84, russet * 0.75);
    r = lerp(r, 212, lichen * 0.6); g = lerp(g, 212, lichen * 0.6); b = lerp(b, 204, lichen * 0.6);
    r = lerp(r, 138, gravel * 0.7); g = lerp(g, 132, gravel * 0.7); b = lerp(b, 128, gravel * 0.7);
    const crack = 1 - smoothstep(0, 0.05, Math.abs(hu * 0.9 + cn * 0.35)), dk = 1 - 0.3 * crack * (0.4 + 0.6 * gravel + 0.3 * moss);
    r *= dk; g *= dk; b *= dk;
    const flat = 1 - smoothstep(0.1, 0.35, p.rg), pool = smoothstep(0.6, 0.78, -cl * 0.7 + fine * 0.4 + flat * 0.35) * flat;
    r = lerp(r, 84, pool * 0.85); g = lerp(g, 110, pool * 0.85); b = lerp(b, 126, pool * 0.85);
    const snow = smoothstep(0.5, 0.8, cl * 0.6 + fine * 0.5 + 0.1) * (1 - smoothstep(0.08, 0.18, p.t));
    r = lerp(r, 232, snow * 0.8); g = lerp(g, 236, snow * 0.8); b = lerp(b, 240, snow * 0.8);
    const sp = 1 + fine * 0.13 + cn * 0.07;
    mix(col, r * sp, g * sp, b * sp, w.tundra * open * 0.94);
  }

  if (w.boreal * open > 0.01) {
    // dense dark conifer: small crowns in dark blue-green, lighter stands of larch and birch, mossy bogs in the gaps
    const crown = smoothstep(-0.5, 0.7, cn * 0.8 + cl * 0.5), gap = smoothstep(-0.25, -0.85, cn * 0.6 + cl * 0.4);
    const stand = hu * 0.9 + rk * 0.45, young = smoothstep(0.1, 0.6, stand), old = smoothstep(-0.05, -0.5, stand);
    let r = lerp(12, 34, crown), g = lerp(32, 62, crown), b = lerp(38, 66, crown);
    r = lerp(r, 58, young * 0.45); g = lerp(g, 86, young * 0.45); b = lerp(b, 70, young * 0.45);
    r *= 1 - 0.25 * old; g *= 1 - 0.22 * old; b *= 1 - 0.1 * old;
    r = lerp(r, 84, gap * 0.45); g = lerp(g, 102, gap * 0.45); b = lerp(b, 92, gap * 0.45);
    mix(col, r, g, b, w.boreal * open * 0.94);
  }

  if (w.temperate * open > 0.01) {
    // mixed broadleaf woods: mottled crowns, beech-dark and oak-olive stands, a little autumn gold, open meadows
    const crown = smoothstep(-0.45, 0.65, cn * 0.8 + cl * 0.55), gap = smoothstep(-0.2, -0.9, cn * 0.6 + cl * 0.4);
    const stand = hu * 0.9 + rk * 0.5 + p.hills * 0.5;
    let r = lerp(58, 104, crown), g = lerp(84, 128, crown), b = lerp(36, 50, crown);
    const oak = smoothstep(0.1, 0.5, stand), beech = smoothstep(-0.1, -0.5, stand);
    r = lerp(r, 118, oak * 0.5); g = lerp(g, 126, oak * 0.5); b = lerp(b, 52, oak * 0.5);
    r = lerp(r, 34, beech * 0.45); g = lerp(g, 74, beech * 0.45); b = lerp(b, 42, beech * 0.45);
    const gold = smoothstep(0.55, 0.8, stand) * (1 - smoothstep(0.5, 0.6, p.t));
    r = lerp(r, 158, gold * 0.5); g = lerp(g, 128, gold * 0.5); b = lerp(b, 52, gold * 0.5);
    const meadow = smoothstep(0.5, 0.75, stand + cn * 0.4);
    r = lerp(r, 150, meadow * 0.5); g = lerp(g, 164, meadow * 0.5); b = lerp(b, 84, meadow * 0.5);
    r *= 1 - 0.3 * gap; g *= 1 - 0.26 * gap; b *= 1 - 0.2 * gap;
    mix(col, r, g, b, w.temperate * open * 0.94);
  }

  if (w.warm * open > 0.01) {
    // lush warm broadleaf forest: saturated greens, palm-yellow regrowth
    const crown = smoothstep(-0.5, 0.65, cn * 0.75 + cl * 0.55), gap = smoothstep(-0.2, -0.9, cn * 0.6 + cl * 0.4);
    const stand = hu * 0.9 + rk * 0.4, young = smoothstep(0.1, 0.55, stand), old = smoothstep(-0.05, -0.5, stand);
    let r = lerp(52, 104, crown), g = lerp(118, 172, crown), b = lerp(30, 48, crown);
    r = lerp(r, 150, young * 0.5); g = lerp(g, 186, young * 0.5); b = lerp(b, 58, young * 0.5);
    r *= 1 - 0.25 * old; g *= 1 - 0.22 * old; b *= 1 - 0.14 * old;
    r *= 1 - 0.3 * gap; g *= 1 - 0.26 * gap; b *= 1 - 0.2 * gap;
    mix(col, r, g, b, w.warm * open * 0.94);
  }

  if (w.alpine * open > 0.01) {
    // above the trees: short mountain meadow with moss and a scatter of scree
    const moss = smoothstep(-0.3, 0.5, hu * 0.8 + cl * 0.5), scree = smoothstep(0.1, 0.7, rk + fine * 0.3);
    let r = lerp(150, 112, moss), g = lerp(180, 158, moss), b = lerp(92, 74, moss);
    r = lerp(r, 170, scree * 0.45); g = lerp(g, 166, scree * 0.45); b = lerp(b, 158, scree * 0.45);
    const shade = smoothstep(0.4, 0.9, -cl), flower = smoothstep(0.88, 0.97, fine * 0.8 + cn * 0.4);
    r *= 1 - 0.22 * shade; g *= 1 - 0.18 * shade; b *= 1 - 0.18 * shade;
    // a scatter of mountain flowers: yellow on one side of the hills, violet on the other
    r = lerp(r, hu > 0 ? 222 : 170, flower * 0.6); g = lerp(g, hu > 0 ? 200 : 120, flower * 0.6); b = lerp(b, hu > 0 ? 96 : 172, flower * 0.6);
    const sp = 1 + fine * 0.12 + cn * 0.06;
    mix(col, r * sp, g * sp, b * sp, w.alpine * open * 0.92);
  }

  if (w.savanna * open > 0.01) {
    // warm golden-orange grass over red earth, with scattered flat-topped acacia crowns
    const k = 0.5 + 0.5 * hu;
    let r = lerp(196, 228, k), g = lerp(148, 184, k), b = lerp(66, 92, k);
    const earth = smoothstep(0.3, 0.75, -hu * 0.8 + rk * 0.5), lush = smoothstep(0.5, 0.9, cl * 0.6 + hu * 0.3);
    r = lerp(r, 176, earth * 0.65); g = lerp(g, 104, earth * 0.65); b = lerp(b, 62, earth * 0.65); // red-brown bare earth
    r = lerp(r, 126, lush * 0.45); g = lerp(g, 140, lush * 0.45); b = lerp(b, 64, lush * 0.45); // greener, damper swales
    const tree = smoothstep(0.22, 0.5, cn * 0.7 + cl * 0.3); // scattered acacia crowns
    r = lerp(r, 38, tree * 0.92); g = lerp(g, 68, tree * 0.92); b = lerp(b, 32, tree * 0.92);
    const sp = 1 + fine * 0.12 + cn * 0.06; // grass tufts
    mix(col, r * sp, g * sp, b * sp, w.savanna * open * 0.95);
  }

  if (w.steppe * open > 0.01) {
    // cool sage and pale straw grass in streaks across the wind, with darker sage clumps and dusty bare patches
    const k = 0.5 + 0.5 * hu, ph = (p.x * p.dux + p.y * p.duy) / (p.len * 0.8) + cl * 0.6;
    const stripe = 1 + 0.07 * Math.sin(ph * 2 * Math.PI);
    // (pale straw and khaki: it was a pale green, close to alpine meadow; kept smooth, as open grass is: being lighter, the same streaks showed more)
    let r = lerp(176, 204, k), g = lerp(162, 186, k), b = lerp(104, 122, k);
    const scrub = smoothstep(0.4, 0.8, cn * 0.6 + cl * 0.4);
    r = lerp(r, 128, scrub * 0.35); g = lerp(g, 132, scrub * 0.35); b = lerp(b, 84, scrub * 0.35);
    const bare = smoothstep(0.5, 0.85, -hu * 0.6 + rk * 0.5), swale = smoothstep(0.5, 0.9, cl * 0.7 - hu * 0.3);
    r = lerp(r, 176, bare * 0.5); g = lerp(g, 164, bare * 0.5); b = lerp(b, 132, bare * 0.5); // dusty bare patches
    r = lerp(r, 140, swale * 0.4); g = lerp(g, 150, swale * 0.4); b = lerp(b, 92, swale * 0.4); // greener swales
    const tuft = 1 + fine * 0.12 + cn * 0.06; // grass tufts
    mix(col, r * stripe * tuft, g * stripe * tuft, b * stripe * tuft, w.steppe * open * 0.92);
  }

  if (w.marsh * open > 0.01) {
    // dark wet ground: tussocks of sedge, bright reed beds, and pools of open water that run together
    // (no blue in the wet ground itself, so rivers through a marsh stay easy to follow: olive, khaki, rust and brown-green; a few small pools with crisp
    // edges in the rivers' own colour)
    const pool = smoothstep(0.7, 0.76, -hu * 0.6 - cl * 0.5 + fine * 0.1), reed = smoothstep(0.1, 0.6, cn * 0.5 + hu * 0.5), tussock = smoothstep(0.2, 0.65, cl * 0.6 + fine * 0.4);
    const rust = smoothstep(0.3, 0.75, rk * 0.7 - hu * 0.4);
    let r = lerp(112, 150, tussock * 0.8), g = lerp(112, 136, tussock * 0.8), b = lerp(64, 74, tussock * 0.8);
    r = lerp(r, 184, reed * 0.6); g = lerp(g, 172, reed * 0.6); b = lerp(b, 98, reed * 0.6); // khaki reed beds
    r = lerp(r, 140, rust * 0.5); g = lerp(g, 96, rust * 0.5); b = lerp(b, 60, rust * 0.5); // rusty iron-stained mud
    r = lerp(r, WATER_SMALL[0], pool); g = lerp(g, WATER_SMALL[1], pool); b = lerp(b, WATER_SMALL[2], pool);
    mix(col, r, g, b, w.marsh * open * 0.94);
  }

  if (w.rainforest * open > 0.01) {
    // cool temperate rainforest: deep emerald crowns draped in moss, with pale mist in the hollows
    const crown = smoothstep(-0.5, 0.65, cn * 0.7 + cl * 0.55), moss = smoothstep(0.1, 0.7, hu * 0.7 + cl * 0.4), mist = smoothstep(0.55, 0.9, -cl * 0.6 + fine * 0.5);
    let r = lerp(8, 30, crown), g = lerp(78, 128, crown), b = lerp(56, 84, crown);
    r = lerp(r, 62, moss * 0.45); g = lerp(g, 140, moss * 0.45); b = lerp(b, 74, moss * 0.45);
    r = lerp(r, 130, mist * 0.3); g = lerp(g, 154, mist * 0.3); b = lerp(b, 138, mist * 0.3);
    mix(col, r, g, b, w.rainforest * open * 0.9);
  }

  if (w.cloud * open > 0.01) {
    // cloud forest: blue-green moss-hung trees with banks of pale mist
    const crown = smoothstep(-0.4, 0.6, cn * 0.7 + cl * 0.5), fog = smoothstep(0.0, 0.7, cl * 0.8 + hu * 0.5 + fine * 0.2);
    let r = lerp(40, 76, crown), g = lerp(88, 124, crown), b = lerp(92, 118, crown);
    r = lerp(r, 208, fog * 0.62); g = lerp(g, 220, fog * 0.62); b = lerp(b, 222, fog * 0.62);
    mix(col, r, g, b, w.cloud * open * 0.88);
  }

  if (w.bamboo * open > 0.01) {
    // stands of bamboo: pale, bright yellow-green with a fine streaky grain
    const patch = smoothstep(0.3, 0.8, hu * 0.7 + rk * 0.5 + 0.1), grain = 1 + fine * 0.14 + cn * 0.06;
    const r = lerp(156, 196, 0.5 + 0.5 * cl) * grain, g = lerp(184, 212, 0.5 + 0.5 * cl) * grain, b = lerp(62, 92, 0.5 + 0.5 * cl) * grain;
    mix(col, r, g, b, w.bamboo * open * patch * 0.9);
  }

  if (w.autumn * open > 0.01) {
    // autumn stands in the cooler mixed woods: gold, orange and red among the green
    const patch = smoothstep(0.0, 0.5, hu * 0.8 + rk * 0.6), k = 0.5 + 0.5 * cl;
    const r = k < 0.5 ? lerp(134, 178, k * 2) : lerp(178, 184, (k - 0.5) * 2), g = k < 0.5 ? lerp(56, 100, k * 2) : lerp(100, 146, (k - 0.5) * 2), b = k < 0.5 ? lerp(40, 40, k * 2) : lerp(40, 52, (k - 0.5) * 2);
    mix(col, r, g, b, w.autumn * open * patch * 0.88);
  }

  if (w.chaparral * open > 0.01) {
    // Mediterranean scrub: a mottled mass of dark grey-olive shrubs with stony tan gaps
    const shrub = smoothstep(-0.35, 0.35, cn * 0.7 + cl * 0.5), stone = smoothstep(0.2, 0.8, rk + 0.2 - cl * 0.3);
    let r = lerp(196, 112, shrub), g = lerp(170, 108, shrub), b = lerp(118, 64, shrub);
    const crown = smoothstep(0.1, 0.5, cn);
    r = lerp(r, 62, crown * 0.85); g = lerp(g, 72, crown * 0.85); b = lerp(b, 40, crown * 0.85); // dark shrub crowns
    r = lerp(r, 206, stone * 0.4); g = lerp(g, 186, stone * 0.4); b = lerp(b, 142, stone * 0.4);
    const sp = 1 + fine * 0.1;
    mix(col, r * sp, g * sp, b * sp, w.chaparral * open * 0.92);
  }

  if (w.badlands * openDry > 0.01) {
    // layered rock worn into bands of terracotta, cream, rust and ochre that follow the height
    const ph = (p.e * 150 + hu * 2.5 + cl * 1.5) % 4, band = ph < 0 ? ph + 4 : ph, k = Math.floor(band), f = band - k;
    const pal = [[176, 100, 70], [208, 178, 130], [142, 78, 58], [198, 152, 106]], a = pal[k], c = pal[(k + 1) % 4], s = smoothstep(0.7, 1, f);
    const r = lerp(a[0], c[0], s), g = lerp(a[1], c[1], s), b = lerp(a[2], c[2], s), sp = 1 + fine * 0.07;
    mix(col, r * sp, g * sp, b * sp, w.badlands * openDry * 0.9);
  }

  if (w.saltflat * openDry > 0.01) {
    // a bright white salt crust cracked into polygons, with damp grey-pink patches and rough edges
    const edge = cellEdge(p.x, p.y, 5), crack = 1 - smoothstep(0.015, 0.07, edge + fine * 0.012), damp = smoothstep(0.1, 0.6, -hu * 0.7 - cl * 0.4);
    let r = lerp(236, 214, 0.5 + 0.5 * hu), g = lerp(234, 208, 0.5 + 0.5 * hu), b = lerp(224, 196, 0.5 + 0.5 * hu);
    r = lerp(r, 196, damp * 0.6); g = lerp(g, 178, damp * 0.6); b = lerp(b, 176, damp * 0.6);
    r = lerp(r, 150, crack * 0.7); g = lerp(g, 142, crack * 0.7); b = lerp(b, 126, crack * 0.7);
    const patch = smoothstep(-0.5, 0.0, hu * 0.6 + cl * 0.5);
    mix(col, r, g, b, w.saltflat * openDry * patch * 0.95);
  }

  if (w.moor * open > 0.01) {
    // heather moor in patches over the forest or meadow: purple-brown heather, dark peat, small bog pools
    const patch = smoothstep(-0.2, 0.35, hu * 0.7 + cl * 0.6), heather = smoothstep(-0.4, 0.5, cn * 0.6 + hu * 0.4), pool = smoothstep(0.5, 0.85, -cl * 0.6 + fine * 0.5);
    let r = lerp(84, 120, heather), g = lerp(68, 84, heather), b = lerp(66, 96, heather);
    r = lerp(r, 84, pool * 0.8); g = lerp(g, 102, pool * 0.8); b = lerp(b, 112, pool * 0.8);
    mix(col, r, g, b, w.moor * open * patch * 0.92);
  }

  if (w.mangrove * open > 0.01) {
    // tidal swamp: dark blue-green crowns on grey mud, split by winding channels of brackish water
    const chan = smoothstep(0.05, 0.3, -cl * 0.7 + fine * 0.45 - Math.abs(hu) * 0.2), crown = smoothstep(-0.4, 0.6, cn * 0.7 + cl * 0.4), mud = smoothstep(0.3, 0.8, -hu * 0.6 - cn * 0.3);
    let r = lerp(34, 70, crown), g = lerp(48, 82, crown), b = lerp(26, 40, crown);
    r = lerp(r, 104, mud * 0.6); g = lerp(g, 92, mud * 0.6); b = lerp(b, 72, mud * 0.6);
    r = lerp(r, 84, chan * 0.85); g = lerp(g, 108, chan * 0.85); b = lerp(b, 108, chan * 0.85);
    mix(col, r, g, b, w.mangrove * open * 0.94);
  }

  if (w.reeds * open > 0.01) {
    // a fringe of reeds along a lake's shore: bright yellow-green tufts on dark wet ground
    const tuft = smoothstep(-0.1, 0.5, cn * 0.7 + fine * 0.5), sp = 1 + fine * 0.1;
    mix(col, lerp(98, 176, tuft) * sp, lerp(124, 174, tuft) * sp, lerp(66, 86, tuft) * sp, w.reeds * open * 0.9);
  }

  if (w.beach * open > 0.01) {
    // sand where it is warm or dry, pale shingle where it is cool, with fine ripples
    const warm = smoothstep(0.35, 0.6, p.t) * (0.6 + 0.4 * (1 - smoothstep(0.5, 0.9, p.m))), rip = 1 + fine * 0.05;
    const r = lerp(172, 230, warm), g = lerp(166, 212, warm), b = lerp(150, 160, warm);
    mix(col, r * rip, g * rip, b * rip, w.beach * open * 0.9);
  }
}

/** Glacier: blue-white ice with darker crevasses, over the snow (called after it). */
export function paintGlacier(col: number[], weight: number, p: Pick<BiomePixel, "cl" | "fine" | "hu">) {
  if (weight <= 0.01) return;
  const crev = 1 - smoothstep(0, 0.09, Math.abs(p.cl * 0.9 + p.fine * 0.6)), sheen = 0.5 + 0.5 * p.hu;
  const r = lerp(206, 160, crev * 0.7) * lerp(0.96, 1.03, sheen), g = lerp(226, 192, crev * 0.7) * lerp(0.97, 1.02, sheen), b = lerp(240, 220, crev * 0.7);
  mix(col, r, g, b, weight * 0.85);
}

/** One kind of ground, for the legend: its name, a colour that stands for it, and where it appears. */
export interface GroundInfo {
  /** The id used in get_selection's `biomes` ("temperate", "jungle", "stone"...). */
  id: string;
  name: string;
  group: "Forest" | "Open land" | "Cold" | "Dry" | "Water's edge" | "Set by a region";
  swatch: [number, number, number];
  where: string;
  /** How to get it, in the terms Claude's tools use (climate-region settings, height), or that it is found automatically. */
  recipe: string;
}

/** Every kind of ground the painted style shows, in the order the legend lists them. */
export const GROUND_INFO: GroundInfo[] = [
  { id: "boreal", name: "Conifer forest", group: "Forest", swatch: [28, 50, 52], where: "Cool and wet", recipe: "natural in cool, wet land; as a region: temperature 0.2 to 0.4, moisture 0.6 or more" },
  { id: "temperate", name: "Mixed forest", group: "Forest", swatch: [80, 103, 46], where: "Mild and wet", recipe: "natural in mild, wet land; as a region: temperature 0.4 to 0.6, moisture 0.6 or more" },
  { id: "warm", name: "Warm broadleaf forest", group: "Forest", swatch: [79, 137, 41], where: "Warm and wet", recipe: "natural in warm, wet land; as a region: temperature 0.65 to 0.75, moisture 0.6 or more" },
  { id: "jungle", name: "Jungle", group: "Forest", swatch: [30, 76, 40], where: "Hot and very wet (usually a climate region)", recipe: "region only: temperature 0.9 or more, moisture 0.9 or more" },
  { id: "rainforest", name: "Temperate rainforest", group: "Forest", swatch: [29, 103, 69], where: "A wet, cool-to-mild coast", recipe: "wet coast below the treeline; as a region: temperature 0.3 to 0.55, moisture 0.9 or more (it grows within about 30 px of the sea, in patches)" },
  { id: "cloud", name: "Cloud forest", group: "Forest", swatch: [74, 114, 109], where: "Warm, wet mountainsides", recipe: "warm, wet mountainsides between about 400 and 1200 m; as a region: temperature 0.55 or more, moisture 0.75 or more (patches)" },
  { id: "bamboo", name: "Bamboo", group: "Forest", swatch: [178, 200, 84], where: "Stands in warm lowland woods", recipe: "low ground in warm woods; as a region: temperature 0.5 to 0.75, moisture 0.65 or more (patches)" },
  { id: "autumn", name: "Autumn colour", group: "Forest", swatch: [180, 108, 42], where: "Stands in the cooler mixed woods", recipe: "cooler mixed woods; as a region: temperature 0.3 to 0.55, moisture 0.55 or more (patches)" },
  { id: "alpine", name: "Alpine meadow", group: "Open land", swatch: [136, 167, 89], where: "Above the treeline (about 700 m and up)", recipe: "follows height: forest gives way above about 700 m in any wet climate; raise the land to make it" },
  { id: "steppe", name: "Steppe", group: "Open land", swatch: [184, 170, 111], where: "Drier land, not hot", recipe: "temperature under 0.6, moisture 0.15 to 0.4" },
  { id: "savanna", name: "Savanna", group: "Open land", swatch: [190, 168, 90], where: "Drier land, warm", recipe: "temperature 0.6 or more, moisture 0.15 to 0.4" },
  { id: "chaparral", name: "Mediterranean scrub", group: "Open land", swatch: [149, 137, 91], where: "Warm and not quite dry", recipe: "temperature 0.5 to 0.8, moisture 0.3 to 0.5" },
  { id: "moor", name: "Heather moor and bog", group: "Open land", swatch: [110, 80, 88], where: "Cool, wet uplands, in patches", recipe: "cool, wet uplands between about 250 and 1000 m; as a region: temperature 0.2 to 0.45, moisture 0.6 or more (patches)" },
  { id: "marsh", name: "Marsh", group: "Open land", swatch: [116, 116, 67], where: "Low flat wet ground, river floodplains, lake shores", recipe: "low (under about 100 m), flat, very wet land (moisture 0.75 or more); also along big rivers and round lakes (found automatically)" },
  { id: "tundra", name: "Tundra", group: "Cold", swatch: [147, 143, 131], where: "Cold land", recipe: "temperature under 0.15 (the far north; a region with temperature about 0.08)" },
  { id: "glacier", name: "Glacier", group: "Cold", swatch: [206, 224, 238], where: "The highest, coldest, snowy ground", recipe: "temperature under 0.1 on high ground (over about 700 m) with moisture 0.3 or more; it lies over the snow" },
  { id: "desert", name: "Desert", group: "Dry", swatch: [214, 186, 134], where: "Hot and very dry (usually a climate region)", recipe: "region only: temperature 0.7 or more, moisture 0.05 or less" },
  { id: "stony", name: "Stony desert", group: "Dry", swatch: [142, 120, 94], where: "Desert on rugged ground", recipe: "the same dry climate as desert on rugged, high ground (found automatically)" },
  { id: "badlands", name: "Badlands", group: "Dry", swatch: [190, 120, 84], where: "Dry, rugged country", recipe: "dry (moisture 0.1 to 0.25), warm (temperature 0.5 or more), rugged highland of about 800 to 1100 m" },
  { id: "saltflat", name: "Salt flat", group: "Dry", swatch: [226, 222, 208], where: "Very dry, low, flat basins", recipe: "very dry (moisture under 0.1), warm, low flat ground (under about 100 m)" },
  { id: "beach", name: "Beach", group: "Water's edge", swatch: [214, 198, 150], where: "Low, gentle coast", recipe: "low, gentle coast (found automatically: only the coast's outermost pixels on steep coasts)" },
  { id: "mangrove", name: "Mangrove swamp", group: "Water's edge", swatch: [59, 74, 48], where: "Warm, wet, low coast and river mouths", recipe: "warm (temperature 0.6 or more), very wet (moisture 0.8 or more), low coast and river mouths (found automatically)" },
  { id: "reeds", name: "Reeds", group: "Water's edge", swatch: [148, 154, 84], where: "Along lake shores", recipe: "a few pixels round every lake in a climate that isn't dry or frozen (found automatically)" },
  { id: "stone", name: "Bare dark stone", group: "Set by a region", swatch: [60, 57, 62], where: "A climate region's stone setting", recipe: "add_climate_region with rock 1 (no temperature or moisture needed)" },
  { id: "volcanic", name: "Volcanic ground", group: "Set by a region", swatch: [70, 66, 70], where: "A climate region's volcanic setting", recipe: "add_climate_region with volcanic 1, only where the DM said the land is volcanic" },
];
