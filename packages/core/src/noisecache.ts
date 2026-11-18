/**
 * Static texture-noise fields for the Painted Relief style. They depend only on the map's
 * size and seed, so they're computed once per map (in a worker in the editor) and reused
 * for every redraw - which keeps brush strokes fast.
 */
import { Simplex2D, subSeed } from "./noise.ts";

export interface NoiseCache {
  W: number;
  H: number;
  seed: number;
  /** Eroded-fBm + ridged mountain detail, ~[-0.8, 0.8]. */
  mtn: Float32Array;
  /** Lowland micro-relief, ~[-1, 1]. */
  hills: Float32Array;
  /** Texture fields quantised to int8 (value/127 ~ [-1, 1]). */
  canopy: Int8Array;
  clump: Int8Array;
  hue: Int8Array;
  rock: Int8Array;
  fine: Int8Array;
  oceanLarge: Int8Array;
  oceanSmall: Int8Array;
  shelfWarp: Int8Array;
  climateT: Int8Array;
  climateM: Int8Array;
  climateDetail: Int8Array;
}

/** Feature-size factor relative to a 2048-px-wide map (the prototype's render size). */
export function styleScale(W: number) {
  return W / 2048;
}

/** Evaluate f at every pixel of rows [ya, yb). */
function rows(W: number, ya: number, yb: number, f: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(W * (yb - ya));
  for (let y = ya; y < yb; y++) for (let x = 0; x < W; x++) out[(y - ya) * W + x] = f(x, y);
  return out;
}

/** A smooth field evaluated at 1/div resolution and upsampled bilinearly, for rows [ya, yb). */
function coarse(W: number, ya: number, yb: number, div: number, f: (x: number, y: number) => number): Float32Array {
  const cw = Math.ceil(W / div) + 2;
  const cy0 = Math.floor(ya / div), cy1 = Math.floor((yb - 1) / div) + 2; // coarse rows needed
  const c = new Float32Array(cw * (cy1 - cy0));
  for (let cy = cy0; cy < cy1; cy++) for (let cx = 0; cx < cw; cx++) c[(cy - cy0) * cw + cx] = f(cx * div, cy * div);
  const out = new Float32Array(W * (yb - ya));
  for (let y = ya; y < yb; y++) {
    const gy = y / div, y0 = Math.floor(gy), fy = gy - y0, r0 = (y0 - cy0) * cw, r1 = r0 + cw;
    for (let x = 0; x < W; x++) {
      const gx = x / div, x0 = Math.floor(gx), fx = gx - x0;
      const a = c[r0 + x0], b = c[r0 + x0 + 1], d = c[r1 + x0], e = c[r1 + x0 + 1];
      out[(y - ya) * W + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    }
  }
  return out;
}

function q8(a: Float32Array): Int8Array {
  const out = new Int8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(a[i] * 127)));
  return out;
}

const LAYERS = ["mtn", "hills", "canopy", "clump", "hue", "rock", "fine", "oceanLarge", "oceanSmall", "shelfWarp", "climateT", "climateM", "climateDetail"] as const;

/** Rows [y0, y1) of a noise cache: identical to the same rows of a full build. */
export type NoiseBand = Omit<NoiseCache, "W" | "H" | "seed"> & { W: number; H: number; seed: number; y0: number; y1: number };

export function buildNoiseCache(W: number, H: number, seed: number): NoiseCache {
  const { y0: _a, y1: _b, ...cache } = buildNoiseBand(W, H, seed, 0, H);
  return cache;
}

/** Build rows [y0, y1) only, so several workers can share the job. */
export function buildNoiseBand(W: number, H: number, seed: number, y0: number, y1: number): NoiseBand {
  const k = styleScale(W);
  const S = (n: number) => Math.max(1.5, n * k);
  const nz = (salt: number) => new Simplex2D(subSeed(seed, 100 + salt));
  const bh = y1 - y0;
  // the mountain texture uses vertical gradients, so it needs one extra row each side
  const ha = Math.max(0, y0 - 1), hb = Math.min(H, y1 + 1);

  const nWx = nz(1), nWy = nz(2);
  const wx = coarse(W, ha, hb, 4, (x, y) => nWx.fbm(x, y, S(40), 3) * S(10));
  const wy = coarse(W, ha, hb, 4, (x, y) => nWy.fbm(x, y, S(40), 3) * S(10));

  // eroded fBm: higher octaves damped where accumulated slope is steep (gully-and-spur texture)
  const mtn = new Float32Array(W * bh);
  const gxAcc = new Float32Array(W * bh), gyAcc = new Float32Array(W * bh);
  const oct = nz(3);
  let amp = 1, norm = 0, s = S(36);
  for (let o = 0; o < 7; o++) {
    const n = rows(W, ha, hb, (x, y) => oct.noise((x + wx[(y - ha) * W + x]) / s + o * 13.1, (y + wy[(y - ha) * W + x]) / s - o * 7.7));
    for (let y = y0; y < y1; y++) {
      const r = (y - ha) * W, up = (Math.max(0, y - 1) - ha) * W, dn = (Math.min(H - 1, y + 1) - ha) * W;
      for (let x = 0; x < W; x++) {
        const i = (y - y0) * W + x;
        const gx = (n[r + Math.min(W - 1, x + 1)] - n[r + Math.max(0, x - 1)]) * 0.5;
        const gy = (n[dn + x] - n[up + x]) * 0.5;
        gxAcc[i] += gx * s * amp;
        gyAcc[i] += gy * s * amp;
        mtn[i] += (amp * n[r + x]) / (1 + 0.9 * (gxAcc[i] * gxAcc[i] + gyAcc[i] * gyAcc[i]));
      }
    }
    norm += amp;
    amp *= 0.5;
    s = Math.max(1.5, s / 2);
  }
  const rid = nz(4);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y - y0) * W + x, wi = (y - ha) * W + x;
      mtn[i] = mtn[i] / norm + 0.45 * (rid.ridged(x + wx[wi], y + wy[wi], S(18), 4) - 0.5);
    }
  }

  const grid = (f: (x: number, y: number) => number) => rows(W, y0, y1, f);
  const crs = (div: number, f: (x: number, y: number) => number) => coarse(W, y0, y1, div, f);
  const h1 = nz(5), h2 = nz(6);
  const hills = grid((x, y) => h1.fbm(x, y, S(26), 4) * 0.6 + h2.fbm(x, y, S(7), 3) * 0.4);
  const c1 = nz(7), c2 = nz(8);
  const canopy = grid((x, y) => c1.fbm(x, y, S(2.5), 2) * 0.6 + c2.fbm(x, y, S(6), 2) * 0.4);
  const cl = nz(9), hu = nz(10), ro = nz(11), fi = nz(12), o1 = nz(13), o2 = nz(14), sw = nz(15);
  return {
    ...climateLayers(W, seed, y0, y1),
    W, H, seed, y0, y1, mtn, hills,
    canopy: q8(canopy),
    clump: q8(grid((x, y) => cl.fbm(x, y, S(14), 3))),
    hue: q8(crs(4, (x, y) => hu.fbm(x, y, S(70), 3))),
    rock: q8(grid((x, y) => ro.fbm(x, y, S(20), 3))),
    fine: q8(grid((x, y) => fi.fbm(x, y, S(3), 2))),
    oceanLarge: q8(crs(4, (x, y) => o1.fbm(x, y, S(120), 4))),
    oceanSmall: q8(grid((x, y) => o2.fbm(x, y, S(8), 2))),
    shelfWarp: q8(crs(2, (x, y) => sw.fbm(x, y, S(50), 4))),
  };
}

/** The three large-scale fields the climate model reads (cheap: evaluated on coarse grids). */
export type ClimateNoise = Pick<NoiseCache, "W" | "H" | "seed" | "climateT" | "climateM" | "climateDetail">;

function climateLayers(W: number, seed: number, y0: number, y1: number) {
  const k = styleScale(W);
  const S = (n: number) => Math.max(1.5, n * k);
  const nz = (salt: number) => new Simplex2D(subSeed(seed, 100 + salt));
  const t = nz(16), m = nz(17), md = nz(18);
  return {
    climateT: q8(coarse(W, y0, y1, 8, (x, y) => t.fbm(x, y, S(300), 3))),
    climateM: q8(coarse(W, y0, y1, 8, (x, y) => m.fbm(x, y, S(220), 4))),
    climateDetail: q8(coarse(W, y0, y1, 4, (x, y) => md.fbm(x, y, S(45), 3))),
  };
}

/** Just the climate fields: identical to the same layers of a full build, in a fraction of the time. */
export function buildClimateNoise(W: number, H: number, seed: number): ClimateNoise {
  return { W, H, seed, ...climateLayers(W, seed, 0, H) };
}

/** Stitch bands (covering every row once) into a full cache. */
export function mergeNoiseBands(bands: NoiseBand[]): NoiseCache {
  const { W, H, seed } = bands[0];
  const out = { W, H, seed } as NoiseCache;
  for (const name of LAYERS) {
    const Ctor = bands[0][name].constructor as Float32ArrayConstructor | Int8ArrayConstructor;
    const full = new Ctor(W * H);
    for (const b of bands) full.set(b[name] as never, b.y0 * W);
    (out as unknown as Record<string, unknown>)[name] = full;
  }
  return out;
}

/** Transferable buffers (for posting a cache from a Web Worker). */
export function noiseCacheBuffers(c: NoiseCache): ArrayBuffer[] {
  return [c.mtn, c.hills, c.canopy, c.clump, c.hue, c.rock, c.fine, c.oceanLarge, c.oceanSmall, c.shelfWarp, c.climateT, c.climateM, c.climateDetail]
    .map((a) => a.buffer as ArrayBuffer);
}
