/**
 * Sketch to terrain: turn a drawing (a reference image) into a heightmap.
 *
 * The sea is the background colour (detected from the image's edges). Anything else is land.
 * Optionally, strokes in a marker colour (red by default) are mountain ranges. Drawings that
 * only outline their islands (the same colour inside and out) use `enclosed: "land"`.
 */
import { distanceTo, gaussianBlur, removeSmall } from "./fields.ts";
import type { Rect } from "./geom.ts";
import { Simplex2D, smoothstep, subSeed } from "./noise.ts";
import { erodeTerrain } from "./hydrology.ts";

export interface SketchImage {
  w: number;
  h: number;
  /** RGBA bytes. */
  data: ArrayLike<number>;
}

export type RGB = [number, number, number];

export interface SketchParams {
  /** The sea / background colour. Omitted: found from the image's edges. */
  seaColour?: RGB;
  /** How far (RGB distance) from the sea colour always counts as sea (default 48). */
  tolerance?: number;
  /**
   * "nearest" (default): a pixel is also sea if it is closer to the sea colour than to the typical
   * land colours (handles pale coast halos). "tolerance": only the tolerance above decides.
   */
  classify?: "nearest" | "tolerance";
  /**
   * Background-coloured areas the sea can't reach: "sea" (default) makes them lakes or inner seas;
   * "land" is for drawings that only outline their islands.
   */
  enclosed?: "sea" | "land";
  /** Colour of strokes that mark mountain ranges (default red). null: no mountain strokes. */
  mountainColour?: RGB | null;
  mountainTolerance?: number;
  /** "contain" keeps the drawing's proportions (default); "whole" stretches it over the whole map. */
  fit?: "contain" | "whole";
  /** Space left round the drawing when fitting, as a fraction of the map (default 0.04). */
  margin?: number;
  /** Typical inland height of low ground, metres (default 500). */
  landHeightM?: number;
  mountainHeightM?: number;
  /** 0 smooth coast .. 1 very ragged (default 0.5). */
  coastRoughness?: number;
  /** Erosion passes to weather the result (default 2, 0 to skip). */
  erosionPasses?: number;
  seed?: number;
}

export const DEFAULT_MOUNTAIN_COLOUR: RGB = [220, 40, 40];

const dist2 = (r: number, g: number, b: number, c: RGB) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

/**
 * Colour distance that cares about hue more than brightness: lighter or darker shades of the same
 * colour (a pale halo round a coast, a shaded coast) stay close to each other.
 */
function hueDist2(r: number, g: number, b: number, c: RGB): number {
  const o1 = r - g, o2 = (r + g) / 2 - b, l = (r + g + b) / 3;
  const p1 = c[0] - c[1], p2 = (c[0] + c[1]) / 2 - c[2], m = (c[0] + c[1] + c[2]) / 3;
  return (o1 - p1) ** 2 + (o2 - p2) ** 2 + (0.35 * (l - m)) ** 2;
}

/** Shrink an image by averaging boxes of pixels, so large drawings classify quickly. */
function shrink(img: SketchImage, maxSide: number): SketchImage {
  const k = Math.max(img.w, img.h) / maxSide;
  if (k <= 1) return img;
  const w = Math.round(img.w / k), h = Math.round(img.h / k);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * img.w + xx) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++; }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

/** The most common colour along the image's edge (taken as the sea). */
export function detectSeaColour(img: SketchImage): RGB {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const o = (y * img.w + x) * 4, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  };
  const t = Math.min(3, Math.floor(Math.min(img.w, img.h) / 2));
  for (let k = 0; k < t; k++) {
    for (let x = 0; x < img.w; x++) { add(x, k); add(x, img.h - 1 - k); }
    for (let y = 0; y < img.h; y++) { add(k, y); add(img.w - 1 - k, y); }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];
}

/** The share of pixels (0..1) in the marker colour: a quick way to tell whether a sketch has mountain strokes. */
export function mountainStrokeShare(img: SketchImage, colour: RGB = DEFAULT_MOUNTAIN_COLOUR, tol = 90): number {
  const small = shrink(img, 512);
  const t2 = tol * tol;
  let n = 0;
  for (let i = 0; i < small.w * small.h; i++) if (dist2(small.data[i * 4], small.data[i * 4 + 1], small.data[i * 4 + 2], colour) <= t2) n++;
  return n / (small.w * small.h);
}

/** Hue-aware distance within which a colour counts as a shade of the sea. */
const SEA_FAMILY = 36;

/**
 * Up to three typical land colours: the most common colours that aren't the sea. Used so a pixel
 * counts as sea when it's closer to the sea colour than to any land colour (which makes pale coast
 * halos and antialiased edges sea, not land).
 */
function landColours(img: SketchImage, isSea: Uint8Array, isMountain: Uint8Array, sea: RGB): RGB[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    if (isSea[i] || isMountain[i]) continue;
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    // lighter or darker shades of the sea (an inner sea, a pale halo) are sea, whatever their count
    if (hueDist2(r, g, b, sea) < SEA_FAMILY * SEA_FAMILY) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
    total++;
  }
  const sorted = [...bins.values()].sort((x, y) => y.n - x.n);
  const out: RGB[] = [];
  for (const e of sorted) {
    if (out.length >= 3 || (out.length > 0 && e.n < total * 0.01)) break;
    const c: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (out.every((o) => dist2(c[0], c[1], c[2], o) > 60 * 60)) out.push(c);
  }
  return out;
}

export interface SketchMasks {
  w: number;
  h: number;
  land: Uint8Array;
  mountain: Uint8Array;
  seaColour: RGB;
}

/** Classify the drawing into land, sea and mountain masks of size ow x oh (the whole image maps to ow x oh). */
export function classifySketch(input: SketchImage, p: SketchParams, ow: number, oh: number): SketchMasks {
  const img = shrink(input, 1536);
  const { w, h } = img;
  const sea = p.seaColour ?? detectSeaColour(img);
  const tol2 = (p.tolerance ?? 48) ** 2;
  const mcol = p.mountainColour === undefined ? DEFAULT_MOUNTAIN_COLOUR : p.mountainColour;
  const mtol2 = (p.mountainTolerance ?? 90) ** 2;
  const bg = new Uint8Array(w * h), mtn = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    if (mcol && dist2(r, g, b, mcol) <= mtol2 && dist2(r, g, b, sea) > tol2) mtn[i] = 1;
    else if (dist2(r, g, b, sea) <= tol2) bg[i] = 1;
  }
  if (p.classify !== "tolerance") {
    // second pass: anything nearer to the sea colour than to every typical land colour is sea too
    const lands = landColours(img, bg, mtn, sea);
    if (lands.length) {
      for (let i = 0; i < w * h; i++) {
        if (bg[i] || mtn[i]) continue;
        const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
        const ds = hueDist2(r, g, b, sea);
        let dl = Infinity;
        for (const c of lands) dl = Math.min(dl, hueDist2(r, g, b, c));
        if (ds < dl) bg[i] = 1;
      }
    }
  }
  // background the sea can reach from the image's edge is sea; the rest is enclosed
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i: number) => { if (bg[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (top) {
    const i = stack[--top], x = i % w, y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const enclosedLand = (p.enclosed ?? "sea") === "land";
  const landSrc = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) landSrc[i] = !bg[i] || (enclosedLand && bg[i] && !outside[i]) ? 1 : 0;
  // down to the output size by area share: land if at least half covered, mountain strokes if a little is (they are thin)
  const land = new Uint8Array(ow * oh), mountain = new Uint8Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const y0 = Math.floor((y * h) / oh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / oh));
    for (let x = 0; x < ow; x++) {
      const x0 = Math.floor((x * w) / ow), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / ow));
      let l = 0, m = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = yy * w + xx; l += landSrc[i]; m += mtn[i]; n++; }
      land[y * ow + x] = l * 2 >= n ? 1 : 0;
      mountain[y * ow + x] = m / n >= 0.18 ? 1 : 0;
    }
  }
  for (let i = 0; i < ow * oh; i++) if (mountain[i]) land[i] = 1;
  return { w: ow, h: oh, land, mountain, seaColour: sea };
}

/** Largest value within r pixels (a square window), separable. */
function maxFilter(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) if (src[y * W + k] > m) m = src[y * W + k];
      tmp[y * W + x] = m;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) if (tmp[k * W + x] > m) m = tmp[k * W + x];
      out[y * W + x] = m;
    }
  }
  return out;
}

/** The rectangle (map px) the drawing occupies on a W x H map. */
export function sketchRegion(sw: number, sh: number, W: number, H: number, fit: "contain" | "whole" = "contain", margin = 0.04): Rect {
  if (fit === "whole") return { x: 0, y: 0, w: W, h: H };
  const m = Math.min(0.3, Math.max(0, margin));
  const s = Math.min((W * (1 - 2 * m)) / sw, (H * (1 - 2 * m)) / sh);
  const w = Math.max(8, Math.round(sw * s)), h = Math.max(8, Math.round(sh * s));
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}

export interface SketchResult {
  data: Float32Array;
  region: Rect;
  landFraction: number;
  seaColour: RGB;
  mountainCells: number;
}

/** Build a whole-map heightmap (metres) from the drawing. */
export function sketchToHeights(img: SketchImage, map: { W: number; H: number; seaLevel: number }, p: SketchParams = {}): SketchResult {
  const { W, H, seaLevel } = map;
  const N = W * H;
  const region = sketchRegion(img.w, img.h, W, H, p.fit, p.margin);
  const cls = classifySketch(img, p, region.w, region.h);
  let land: Uint8Array = new Uint8Array(N);
  const mtn: Uint8Array = new Uint8Array(N);
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const i = (region.y + y) * W + region.x + x;
      land[i] = cls.land[y * region.w + x]; mtn[i] = cls.mountain[y * region.w + x];
    }
  }
  // tidy specks: land bits and sea bits smaller than a few pixels
  const speck = Math.max(4, Math.round(N * 0.00002));
  land = removeSmall(land, W, H, speck);
  const sea0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) sea0[i] = land[i] ? 0 : 1;
  const sea1 = removeSmall(sea0, W, H, speck);
  for (let i = 0; i < N; i++) land[i] = sea1[i] ? 0 : 1;

  const seed = p.seed ?? 1;
  const landH = p.landHeightM ?? 500, mtnH = p.mountainHeightM ?? 2600;
  const rough = Math.min(1, Math.max(0, p.coastRoughness ?? 0.5));
  // signed distance to the coast (positive on land), with a ragged edge
  const toSea = distanceTo(land.map((v) => 1 - v) as Uint8Array, W, H);
  const toLand = distanceTo(land, W, H);
  const coastN = new Simplex2D(subSeed(seed, 601)), hillN = new Simplex2D(subSeed(seed, 602)), ridgeN = new Simplex2D(subSeed(seed, 603)), seaN = new Simplex2D(subSeed(seed, 604));
  const sd = new Float32Array(N);
  const amp = 0.011 * W * rough;
  // thin strips of land (or channels of water) keep their shape: the ragged-coast noise fades out where
  // the feature is only a few pixels wide, measured as the widest point of the same kind nearby
  let thick: Float32Array | null = null;
  if (amp > 0) {
    const r = Math.max(2, Math.ceil(amp * 1.2));
    const widthLand = new Float32Array(N), widthSea = new Float32Array(N);
    for (let i = 0; i < N; i++) { if (land[i]) widthLand[i] = toSea[i]; else widthSea[i] = toLand[i]; }
    const wl = maxFilter(widthLand, W, H, r), ws = maxFilter(widthSea, W, H, r);
    thick = new Float32Array(N);
    for (let i = 0; i < N; i++) thick[i] = land[i] ? wl[i] : ws[i];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = land[i] ? toSea[i] - 0.5 : -(toLand[i] - 0.5);
      let n = 0;
      if (amp > 0) {
        const fade = smoothstep(1.5, amp * 1.4 + 1.5, thick![i]);
        n = (coastN.fbm(x, y, 0.035 * W, 4) * amp + coastN.fbm(x, y, 0.008 * W, 3) * amp * 0.35) * fade;
      }
      sd[i] = d + n;
    }
  }
  // mountain field: strokes blurred into ranges, broken up by ridged noise
  let mtnField: Float32Array | null = null;
  let mountainCells = 0;
  for (let i = 0; i < N; i++) mountainCells += mtn[i];
  if (mountainCells > 0) {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) raw[i] = mtn[i];
    mtnField = gaussianBlur(raw, W, H, Math.max(2, 0.0075 * W));
    let max = 0;
    for (let i = 0; i < N; i++) if (mtnField[i] > max) max = mtnField[i];
    if (max > 0) for (let i = 0; i < N; i++) mtnField[i] /= max;
  }
  const ramp = 0.05 * W;
  const data = new Float32Array(N);
  let landCells = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, s = sd[i];
      if (s > 0) {
        landCells++;
        const inland = smoothstep(0, ramp, s);
        let hgt = 14 + (landH - 14) * inland + hillN.fbm(x, y, 0.07 * W, 4) * 0.32 * landH * smoothstep(0, ramp * 0.5, s);
        if (mtnField) {
          const m = Math.pow(mtnField[i], 0.85);
          hgt += mtnH * m * (0.6 + 0.9 * ridgeN.ridged(x, y, 0.03 * W, 4)) * smoothstep(0, ramp * 0.5, s);
        }
        data[i] = seaLevel + Math.max(2, hgt);
      } else {
        const out = -s;
        const depth = 25 + 4300 * (1 - Math.exp(-out / (0.09 * W))) + seaN.fbm(x, y, 0.1 * W, 3) * 120 * smoothstep(0, ramp, out);
        data[i] = seaLevel - Math.max(2, depth);
      }
    }
  }
  const passes = p.erosionPasses ?? 2;
  if (passes > 0) erodeTerrain(data, W, H, seaLevel, { passes, strength: 0.35 });
  return { data, region, landFraction: landCells / N, seaColour: cls.seaColour, mountainCells };
}
